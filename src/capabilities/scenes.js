// -----------------------------------------------------------------------------
// Scene triggers and scene actions (Gladys 5.1+).
//
// Triggers — something HAPPENED on the Sector Alarm side:
//   - alarm_mode_changed       the panel went from one mode to another, with who
//                              did it and how when the event log says so;
//   - panel_connection_changed the panel went offline, or came back;
//   - lock_operated            a smart lock was locked or unlocked (or failed
//                              to), with who did it and how.
// They fire on TRANSITIONS only, seen between two refreshes: never for the
// first read after a start, which is not news.
//
// Actions — operations a scene author places in a scene:
//   - set_alarm_mode           arm, partially arm or disarm a panel;
//   - refresh_now              read Sector Alarm now instead of waiting.
//
// Keys are stored in users' scenes: never rename them.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { ALARM_MODES } from '../sector/parse.js';
import { panelIds } from '../devices/alarmPanel.js';
import { findPanel, setAlarmMode } from '../devices/index.js';
import { lockDevice } from '../devices/accessories.js';

const logger = createLogger({ name: 'scenes' });

export const SCENE_TRIGGERS = {
  ALARM_MODE_CHANGED: 'alarm_mode_changed',
  PANEL_CONNECTION_CHANGED: 'panel_connection_changed',
  LOCK_OPERATED: 'lock_operated',
};

export const SCENE_ACTIONS = {
  SET_ALARM_MODE: 'set_alarm_mode',
  REFRESH_NOW: 'refresh_now',
};

/** The `state` values of panel_connection_changed. */
export const CONNECTION_STATES = { ONLINE: 'online', OFFLINE: 'offline' };

/** The `action` values of lock_operated (the EventType of the log). */
export const LOCK_ACTIONS = { LOCK: 'lock', UNLOCK: 'unlock', LOCK_FAILED: 'lock_failed' };

// Log event types that are about arming or disarming the panel.
const isArmingRecord = (record) => /arm/.test(record.eventType) && !record.lockName;

/**
 * Fire the triggers a refresh result stands for.
 *
 * @param {object} gladys the SDK client
 * @param {object} panel the PanelState just refreshed
 * @param {object} result what `panel.refresh()` returned
 * @returns {Promise<number>} how many events were fired
 */
export async function fireSceneEvents(gladys, panel, result) {
  const device = panelIds(gladys, panel.id).device;
  const events = [];

  if (result.modeChange) {
    // Who did it: the newest arming record of this refresh, when the log has
    // one. The mode is read from the status, never from the log.
    const record = result.logRecords.filter(isArmingRecord).pop();
    events.push([
      SCENE_TRIGGERS.ALARM_MODE_CHANGED,
      {
        device,
        mode: result.modeChange.mode,
        previous_mode: result.modeChange.previous,
        panel_name: panel.name,
        user: record?.user ?? null,
        channel: record?.channel ?? null,
      },
    ]);
  }

  if (result.onlineChange) {
    events.push([
      SCENE_TRIGGERS.PANEL_CONNECTION_CHANGED,
      {
        device,
        state: result.onlineChange.online ? CONNECTION_STATES.ONLINE : CONNECTION_STATES.OFFLINE,
        panel_name: panel.name,
      },
    ]);
  }

  for (const record of result.logRecords) {
    if (!Object.values(LOCK_ACTIONS).includes(record.eventType)) {
      continue;
    }
    const lock = panel.lockNamed(record.lockName);
    if (!lock) {
      logger.debug(`Log record for an unknown lock "${record.lockName}" ignored`);
      continue;
    }
    events.push([
      SCENE_TRIGGERS.LOCK_OPERATED,
      {
        device: lockDevice.ids(gladys, panel.id, lock.serial).device,
        action: record.eventType,
        lock_name: lock.name ?? record.lockName,
        user: record.user,
        channel: record.channel,
      },
    ]);
  }

  let fired = 0;
  for (const [key, data] of events) {
    try {
      await gladys.publishSceneEvent(key, data);
      fired += 1;
      logger.info(`Scene event ${key} (${JSON.stringify({ ...data, device: undefined })})`);
    } catch (err) {
      logger.warn(`Could not publish the scene event ${key}: ${err.message}`);
    }
  }
  return fired;
}

/**
 * The handlers of the scene actions, keyed by SCENE_ACTIONS values.
 *
 * @param {object} context
 * @param {object} context.gladys
 * @param {() => Array<object>} context.panels the panels known right now
 * @param {object} context.client the Sector Alarm client
 * @param {() => object} context.config the current configuration
 * @param {(panel?: object) => Promise<void>} context.refresh read Sector Alarm now
 * @param {(panel: object) => Promise<void>} context.afterOrder publish what an order changed
 */
export function sceneActionHandlers({ gladys, panels, client, config, refresh, afterOrder }) {
  const panelFor = (externalId) => {
    const known = panels();
    if (!externalId) {
      return known[0] ?? null;
    }
    return findPanel(gladys, known, externalId);
  };

  return {
    // Never a failure: the outcome is an output, the scene author gates on it
    // (`applied`), and the reason is there to send in a notification.
    async [SCENE_ACTIONS.SET_ALARM_MODE](fields) {
      const panel = panelFor(fields.device);
      if (!panel) {
        return { applied: false, mode: null, error: 'No Sector Alarm panel for this device' };
      }
      try {
        await setAlarmMode(client, panel, fields.mode, config().panel_code);
        await afterOrder(panel);
        return { applied: true, mode: panel.mode, error: null };
      } catch (err) {
        logger.warn(`Scene action set_alarm_mode failed: ${err.message}`);
        return { applied: false, mode: panel.mode, error: err.message };
      }
    },

    async [SCENE_ACTIONS.REFRESH_NOW](fields) {
      const panel = panelFor(fields?.device);
      await refresh(panel ?? undefined);
      return {
        mode: panel?.mode ?? null,
        online: panel?.online ?? null,
      };
    },
  };
}

/** The alarm modes a scene can ask for. */
export const SCENE_MODES = Object.values(ALARM_MODES);
