// -----------------------------------------------------------------------------
// What the integration knows about one Sector Alarm panel.
//
// A panel is read as a whole: its status (mode, online), then everything
// attached to it — locks, smart plugs and the "house check" sensors (doors and
// windows, smoke, leakage, temperature, humidity) — and its event log. One
// `refresh()` does all of it, in parallel, and says what changed since the
// previous one so the scene triggers can fire on transitions only.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { ERROR_CODES } from './client.js';
import {
  mergeSensors,
  parseHouseCheck,
  parseLegacyTemperatures,
  parseLocks,
  parseLogs,
  parsePanelInfo,
  parsePanelList,
  parsePanelStatus,
  parseSmartplugs,
} from './parse.js';

const logger = createLogger({ name: 'sector-panel' });

// The "house check" routes, by the kind of sensor they list. Older panels
// ("legacy home screen") have none of them; newer ones only some: a route that
// answers 404/400 is dropped for the panel's lifetime, as the app does.
const HOUSE_CHECK_ROUTES = {
  doors: 'getDoorsAndWindows',
  humidity: 'getHumidity',
  temperature: 'getTemperatures',
  leak: 'getLeakageDetectors',
  smoke: 'getSmokeDetectors',
};

// How many log records to read per refresh: enough to never miss one between
// two refreshes, small enough to stay cheap.
const LOG_PAGE_SIZE = 10;

export class PanelState {
  /**
   * @param {{ id: string, name?: string }} panel
   * @param {{ now?: () => number }} [options]
   */
  constructor({ id, name }, { now = Date.now } = {}) {
    this.id = id;
    this.name = name ?? id;
    this.now = now;
    this.info = null;
    this.online = null;
    // The mode shown in Gladys: an accepted order sets it at once.
    this.mode = null;
    // The mode Sector Alarm last REPORTED: what the transitions (and the
    // alarm_mode_changed trigger) compare to, so that an order given from
    // Gladys fires the trigger too, once the panel confirms it.
    this.reportedMode = null;
    /** @type {Map<string, { serial, name, locked, batteryLow }>} */
    this.locks = new Map();
    /** @type {Map<string, { id, serial, name, on }>} */
    this.plugs = new Map();
    /** @type {Map<string, { serial, name, type, values }>} */
    this.sensors = new Map();
    this.unsupported = new Set();
    // Time of the newest log record seen: older ones were already handled.
    this.logCursor = null;
    this.updatedAt = null;
    this.lastError = null;
    // false when the last status read failed (cloud down, rate limit...).
    this.reachable = null;
  }

  /** The panel details: code length, quick arm, partial arm, accessories. */
  async loadInfo(client) {
    this.info = parsePanelInfo(await client.getPanel(this.id));
    if (this.info.name && this.name === this.id) {
      this.name = this.info.name;
    }
    for (const lock of this.info.locks) {
      this.locks.set(lock.serial, { ...lock, ...this.locks.get(lock.serial) });
    }
    for (const plug of this.info.plugs) {
      this.plugs.set(plug.serial, { ...plug, ...this.plugs.get(plug.serial) });
    }
    return this.info;
  }

  /** Whether the code is needed to arm (quick arm off). */
  get armNeedsCode() {
    return !(this.info?.quickArm ?? false);
  }

  get canPartialArm() {
    return this.info?.canPartialArm ?? true;
  }

  /**
   * Read everything again.
   *
   * The panel status is mandatory: its failure throws. Every other route is
   * best effort — what failed keeps its previous values, and the errors are
   * returned so the caller can tell a rate limit from a route the panel lacks.
   *
   * @returns {Promise<{
   *   modeChange: { previous: string|null, mode: string } | null,
   *   onlineChange: { previous: boolean|null, online: boolean } | null,
   *   logRecords: Array<object>,
   *   errors: Array<Error>,
   * }>}
   */
  async refresh(client) {
    let status;
    try {
      if (!this.info) {
        await this.loadInfo(client);
      }
      status = parsePanelStatus(await client.getPanelStatus(this.id));
    } catch (err) {
      this.reachable = false;
      this.lastError = err;
      throw err;
    }
    this.reachable = true;
    const previousMode = this.reportedMode;
    const previousOnline = this.online;
    if (status.online !== null) {
      this.online = status.online;
    }
    // An offline panel reports "armed" whatever its real mode: keep the last
    // mode read while it was online rather than inventing an arming.
    if (status.mode !== null && status.online !== false) {
      this.mode = status.mode;
      this.reportedMode = status.mode;
    }

    const errors = [];
    const tasks = [];
    if (this.info.locks.length > 0) {
      tasks.push(
        client.getLockStatus(this.id).then((data) => {
          for (const lock of parseLocks(data)) {
            const known = this.locks.get(lock.serial);
            this.locks.set(lock.serial, {
              ...known,
              ...lock,
              name: lock.name ?? known?.name ?? null,
              batteryLow: lock.batteryLow ?? known?.batteryLow ?? null,
            });
          }
        }),
      );
    }
    if (this.info.plugs.length > 0) {
      tasks.push(
        client.getSmartplugStatus(this.id).then((data) => {
          for (const plug of parseSmartplugs(data)) {
            const known = this.plugs.get(plug.serial);
            this.plugs.set(plug.serial, { ...known, ...plug, name: plug.name ?? known?.name });
          }
        }),
      );
    }
    const readings = [];
    if (this.info.legacy) {
      if (this.info.legacyTemperatures.length > 0 && !this.unsupported.has('legacy')) {
        tasks.push(
          client.getLegacyTemperatures(this.id).then((data) => {
            readings.push(parseLegacyTemperatures(data));
          }),
        );
      }
    } else {
      for (const [kind, method] of Object.entries(HOUSE_CHECK_ROUTES)) {
        if (this.unsupported.has(kind)) {
          continue;
        }
        tasks.push(
          client[method](this.id).then(
            (data) => readings.push(parseHouseCheck(data, kind)),
            (err) => {
              if (err?.code === ERROR_CODES.NOT_SUPPORTED) {
                this.unsupported.add(kind);
                logger.info(`Panel ${this.id}: no ${kind} sensors here (${err.message})`);
                return;
              }
              throw err;
            },
          ),
        );
      }
    }
    let logRecords = [];
    tasks.push(
      client.getLogs(this.id, LOG_PAGE_SIZE).then((data) => {
        logRecords = this.takeNewLogs(parseLogs(data));
      }),
    );

    for (const result of await Promise.allSettled(tasks)) {
      if (result.status === 'rejected') {
        errors.push(result.reason);
      }
    }
    for (const sensor of mergeSensors(...readings).values()) {
      const known = this.sensors.get(sensor.serial);
      this.sensors.set(sensor.serial, {
        ...sensor,
        name: sensor.name ?? known?.name ?? null,
        values: { ...known?.values, ...sensor.values },
      });
    }

    this.updatedAt = this.now();
    this.lastError = errors[0] ?? null;
    return {
      modeChange:
        this.reportedMode !== null && previousMode !== null && this.reportedMode !== previousMode
          ? { previous: previousMode, mode: this.reportedMode }
          : null,
      onlineChange:
        this.online !== null && previousOnline !== null && this.online !== previousOnline
          ? { previous: previousOnline, online: this.online }
          : null,
      logRecords,
      errors,
    };
  }

  /**
   * The records newer than the ones already seen. The first read only sets
   * the cursor: the history of the panel is not news, and replaying it would
   * fire a scene for every door locked last week.
   */
  takeNewLogs(records) {
    if (records.length === 0) {
      return [];
    }
    const newest = records[records.length - 1].time;
    if (this.logCursor === null) {
      this.logCursor = newest;
      return [];
    }
    const fresh = records.filter((record) => record.time > this.logCursor);
    this.logCursor = Math.max(this.logCursor, newest);
    return fresh;
  }

  /** The lock a log record names (by label, as the log only has that). */
  lockNamed(name) {
    if (!name) {
      return null;
    }
    const wanted = name.trim().toLowerCase();
    return [...this.locks.values()].find((lock) => lock.name?.toLowerCase() === wanted) ?? null;
  }
}

/**
 * The panels to follow: every panel of the account, or the ones the
 * configuration names. A configured id the account does not list is still
 * tried — the list route is not the only truth — with a warning.
 *
 * @returns {Promise<Array<{ id: string, name: string }>>}
 */
export async function listPanels(client, config) {
  const panels = parsePanelList(await client.getPanelList());
  if (config.panelIds.length === 0) {
    return panels;
  }
  return config.panelIds.map((id) => {
    const found = panels.find((panel) => panel.id === id);
    if (!found) {
      logger.warn(`Panel ${id} is not listed by the account: trying it anyway`);
    }
    return found ?? { id, name: id };
  });
}
