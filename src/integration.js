// -----------------------------------------------------------------------------
// The integration itself: every SDK handler, the refresh loop and the state
// they share. index.js only creates it with the real SDK client; the tests
// create it with the SDK's fake Gladys and a fake Sector Alarm.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { hasCredentials, maskEmail, normalizeConfig } from './config.js';
import { ERROR_CODES, SectorClient } from './sector/client.js';
import { describeError, testConnection } from './sector/connection.js';
import { listPanels, PanelState } from './sector/panel.js';
import {
  buildDiscoveredDevices,
  buildStates,
  buildTransportEntries,
  findPanel,
  runCommand,
} from './devices/index.js';
import { fireSceneEvents, SCENE_ACTIONS, sceneActionHandlers } from './capabilities/scenes.js';
import { ALARM_WIDGET, buildAlarmWidget, runWidgetAction } from './capabilities/widget.js';

const logger = createLogger({ name: 'sector-alarm' });

// An order is confirmed by reading the panel again, a few seconds later: the
// cloud takes a moment to report the new mode.
const CONFIRM_AFTER_ORDER_MS = 5_000;

// Re-send unchanged values this often, so a stable sensor stays recently
// dated in Gladys.
const STATE_HEARTBEAT_MS = 30 * 60 * 1000;

// After a 429, wait this much longer each time, up to the cap.
const MAX_BACKOFF_MS = 15 * 60 * 1000;

/**
 * @param {object} gladys the SDK client (real or fake)
 * @param {object} [options]
 * @param {SectorClient} [options.client] injected by the tests
 * @returns {{ refresh: Function, stop: Function, panels: () => PanelState[] }}
 */
export function createIntegration(gladys, { client = new SectorClient() } = {}) {
  let config = normalizeConfig();
  /** @type {PanelState[]} */
  let panels = [];
  let timer = null;
  let confirmTimer = null;
  let refreshing = null;
  let backoffMs = 0;
  // What the discovery last published, to publish again only when an
  // accessory appears or disappears.
  let discoveryKey = null;
  let transportKey = null;

  // --- Publishing ---------------------------------------------------------------

  async function publishDiscovery({ force = false } = {}) {
    const devices = buildDiscoveredDevices(gladys, panels);
    const key = JSON.stringify(
      devices.map((device) => [device.external_id, device.features.map((f) => f.external_id)]),
    );
    if (!force && key === discoveryKey) {
      return;
    }
    await gladys.publishDiscoveredDevices(devices);
    discoveryKey = key;
  }

  async function publishStates() {
    const states = buildStates(gladys, panels);
    if (states.length > 0) {
      await gladys.publishChangedStates(states, { heartbeat: STATE_HEARTBEAT_MS });
    }
  }

  async function publishTransports({ force = false } = {}) {
    const entries = buildTransportEntries(gladys, panels);
    const key = JSON.stringify(entries);
    if (entries.length === 0 || (!force && key === transportKey)) {
      return;
    }
    // The host API takes 100 entries per call.
    for (let start = 0; start < entries.length; start += 100) {
      await gladys.publishTransports(entries.slice(start, start + 100));
    }
    transportKey = key;
  }

  // The status shown in the Configuration screen, sent only when it changes:
  // a refresh every minute is no reason for a host API call every minute.
  let statusKey = null;
  async function reportStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === statusKey) {
      return;
    }
    try {
      await gladys.setConnectionStatus(connected, message);
      statusKey = key;
    } catch (err) {
      logger.debug(`Could not report the connection status: ${err.message}`);
    }
  }

  function refreshWidget() {
    try {
      gladys.requestWidgetRefresh(ALARM_WIDGET);
    } catch (err) {
      logger.debug(`Could not refresh the widget: ${err.message}`);
    }
  }

  /** Everything Gladys shows, after a refresh or an order. */
  async function publishAll() {
    await publishDiscovery();
    await publishStates();
    await publishTransports().catch((err) =>
      logger.warn(`Could not publish the transports: ${err.message}`),
    );
    refreshWidget();
  }

  // --- Reading Sector Alarm -------------------------------------------------------

  /**
   * Read every panel (or one) again, fire the scene triggers of what changed,
   * and publish. One refresh at a time: a second request joins the running one.
   */
  async function refresh(only) {
    if (refreshing) {
      return refreshing;
    }
    refreshing = (async () => {
      const targets = only ? [only] : panels;
      const errors = [];
      for (const panel of targets) {
        try {
          const result = await panel.refresh(client);
          await fireSceneEvents(gladys, panel, result);
          for (const err of result.errors) {
            logger.warn(`Panel ${panel.id}: ${err.message}`);
          }
          errors.push(...result.errors);
        } catch (err) {
          logger.warn(`Panel ${panel.id} could not be read: ${err.message}`);
          errors.push(err);
        }
      }
      backoffMs = errors.some((err) => err?.code === ERROR_CODES.RATE_LIMIT)
        ? Math.min(MAX_BACKOFF_MS, Math.max(backoffMs * 2, config.poll_frequency * 1000))
        : 0;
      await publishAll();
      const fatal = errors.find((err) => err?.code === ERROR_CODES.LOGIN);
      if (fatal) {
        await reportStatus(false, describeError(fatal));
      } else if (targets.length > 0 && targets.every((panel) => panel.reachable === false)) {
        await reportStatus(false, describeError(errors[0]));
      } else if (targets.length > 0) {
        await reportStatus(true);
      }
    })().finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  function schedule() {
    stopTimer();
    if (!hasCredentials(config) || panels.length === 0) {
      return;
    }
    const delay = config.poll_frequency * 1000 + backoffMs;
    timer = setTimeout(async () => {
      timer = null;
      try {
        await refresh();
      } catch (err) {
        logger.error('Refresh failed', err);
      }
      schedule();
    }, delay);
    timer.unref?.();
  }

  function stopTimer() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  /** After an accepted order: show it now, and confirm it shortly. */
  async function afterOrder(panel) {
    await publishAll().catch((err) =>
      logger.warn(`Could not publish after an order: ${err.message}`),
    );
    if (confirmTimer) {
      clearTimeout(confirmTimer);
    }
    confirmTimer = setTimeout(() => {
      confirmTimer = null;
      refresh(panel).catch((err) => logger.debug(`Confirmation read failed: ${err.message}`));
    }, CONFIRM_AFTER_ORDER_MS);
    confirmTimer.unref?.();
  }

  // --- (Re)initialization ---------------------------------------------------------

  async function initialize(rawConfig) {
    // A (re)connection or a save: say the status again, whatever it was.
    statusKey = null;
    config = normalizeConfig(rawConfig ?? {});
    client.configure(config);
    stopTimer();
    if (!hasCredentials(config)) {
      panels = [];
      logger.info('No Sector Alarm account configured yet');
      await reportStatus(false, describeError({ code: ERROR_CODES.NOT_CONFIGURED }));
      return;
    }
    logger.info(`Connecting to Sector Alarm as ${maskEmail(config.email)}`);
    let listed;
    try {
      listed = await listPanels(client, config);
    } catch (err) {
      logger.error(`Could not list the Sector Alarm panels: ${err.message}`);
      await reportStatus(false, describeError(err));
      // A network glitch at start-up must not leave the integration idle
      // until the next save: try again at the next tick.
      if (err?.code !== ERROR_CODES.LOGIN) {
        timer = setTimeout(
          () => initializeOrReport(async () => rawConfig),
          config.poll_frequency * 1000,
        );
        timer.unref?.();
      }
      return;
    }
    // Keep the state of the panels already known (log cursor, last mode): a
    // reconnection is not a reason to forget what the triggers compare to.
    const known = new Map(panels.map((panel) => [panel.id, panel]));
    panels = listed.map(({ id, name }) => {
      const panel = known.get(id) ?? new PanelState({ id, name });
      panel.name = name ?? panel.name;
      return panel;
    });
    logger.info(`${panels.length} Sector Alarm panel(s): ${panels.map((p) => p.id).join(', ')}`);
    discoveryKey = null;
    transportKey = null;
    await refresh();
    schedule();
  }

  async function initializeOrReport(readConfig) {
    try {
      await initialize(await readConfig());
    } catch (err) {
      logger.error('Initialization failed', err);
      await reportStatus(false, {
        en: 'Initialization failed, check the integration logs.',
        fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
        de: 'Die Initialisierung ist fehlgeschlagen, prüfe die Protokolle der Integration.',
        es: 'La inicialización ha fallado, consulte los registros de la integración.',
      });
    }
  }

  // --- Handlers -------------------------------------------------------------------

  // Discovery: Gladys asks for the list of devices. Read Sector Alarm again
  // first: a lock installed yesterday should show up now.
  gladys.onScanRequest(async () => {
    logger.info('onScanRequest -> reading Sector Alarm');
    await refresh();
    await publishDiscovery({ force: true });
  });

  // Command: the user changed the alarm mode, a lock or a plug.
  gladys.onSetValue(async (device, feature, value) => {
    logger.info(`onSetValue <- ${feature.external_id} = ${value}`);
    // Throwing sends a success:false acknowledgement: Gladys shows the error.
    const states = await runCommand(gladys, { panels, client, config, device, feature, value });
    const panel = findPanel(gladys, panels, device.external_id);
    if (states.length > 0) {
      await gladys.publishChangedStates(states);
    }
    if (panel) {
      await afterOrder(panel);
    }
  });

  // No onPoll: the integration reads each panel, all its devices at once, on
  // its own timer. The devices are published without poll_frequency, so
  // Gladys never polls them one by one (one API burst per device).

  // Manifest action: the "Test the connection" button.
  gladys.onAction('test_connection', async () => {
    logger.info('Action test_connection');
    return testConnection(client, config);
  });

  // Manifest action: read Sector Alarm now.
  gladys.onAction('refresh', async () => {
    logger.info('Action refresh');
    await refresh();
    return {
      en: 'Sector Alarm read again.',
      fr: 'Sector Alarm relu.',
      de: 'Sector Alarm neu gelesen.',
      es: 'Sector Alarm leído de nuevo.',
    };
  });

  // Scene actions (Gladys 5.1+).
  const sceneHandlers = sceneActionHandlers({
    gladys,
    panels: () => panels,
    client,
    config: () => config,
    refresh,
    afterOrder,
  });
  gladys.onSceneAction(SCENE_ACTIONS.SET_ALARM_MODE, (fields) => {
    logger.info(`Scene action set_alarm_mode <- ${fields.mode}`);
    return sceneHandlers[SCENE_ACTIONS.SET_ALARM_MODE](fields);
  });
  gladys.onSceneAction(SCENE_ACTIONS.REFRESH_NOW, (fields) => {
    logger.info('Scene action refresh_now');
    return sceneHandlers[SCENE_ACTIONS.REFRESH_NOW](fields);
  });

  // Dashboard widget (Gladys 5.1+).
  gladys.onWidgetGet(ALARM_WIDGET, async ({ settings } = {}) =>
    buildAlarmWidget(gladys, panels, settings),
  );
  gladys.onWidgetAction(ALARM_WIDGET, async (actionKey, params, { values } = {}) => {
    logger.info(`Widget action ${actionKey}`);
    try {
      return await runWidgetAction(
        { gladys, panels, client, config, refresh, afterOrder },
        actionKey,
        params,
        values,
      );
    } catch (err) {
      // The toast shows the message: say it in words a user can act on.
      if (err?.code) {
        throw new Error(describeError(err).en, { cause: err });
      }
      throw err;
    }
  });

  // Configuration saved by the user.
  gladys.onConfigUpdated(async (newConfig) => {
    logger.info('onConfigUpdated -> new configuration received');
    await initializeOrReport(async () => newConfig);
  });

  // Connection lifecycle. The SDK logs the WebSocket lifecycle itself.
  gladys.on('connected', async () => {
    await initializeOrReport(() => gladys.getConfig());
  });

  gladys.on('disconnected', () => {
    stop();
  });

  function stop() {
    stopTimer();
    if (confirmTimer) {
      clearTimeout(confirmTimer);
      confirmTimer = null;
    }
  }

  return { refresh, stop, panels: () => panels, config: () => config };
}
