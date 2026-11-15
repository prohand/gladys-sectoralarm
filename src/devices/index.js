// -----------------------------------------------------------------------------
// Device registry: from the panels read on Sector Alarm to the Gladys devices,
// their states and their transport badges, and back from a Gladys command to
// the Sector Alarm order.
//
// Every function takes the list of PanelState (src/sector/panel.js): the
// devices are whatever the account reports, nothing is declared by hand.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { ERROR_CODES, SectorError } from '../sector/client.js';
import { ALARM_MODES } from '../sector/parse.js';
import { alarmPanel, FEATURES as PANEL_FEATURES, modesOf, panelIds } from './alarmPanel.js';
import { lockDevice, plugDevice, sensorDevice } from './accessories.js';

const logger = createLogger({ name: 'devices' });

/** Every device of every panel, with what it is. */
function* everyDevice(gladys, panels) {
  for (const panel of panels) {
    yield { kind: 'panel', panel, item: panel, blueprint: alarmPanel };
    for (const lock of panel.locks.values()) {
      yield { kind: 'lock', panel, item: lock, blueprint: lockDevice };
    }
    for (const plug of panel.plugs.values()) {
      yield { kind: 'plug', panel, item: plug, blueprint: plugDevice };
    }
    for (const sensor of panel.sensors.values()) {
      yield { kind: 'sensor', panel, item: sensor, blueprint: sensorDevice };
    }
  }
}

function buildOne({ kind, panel, item, blueprint }, gladys) {
  return kind === 'panel'
    ? blueprint.buildDevice(gladys, panel)
    : blueprint.buildDevice(gladys, panel, item);
}

/** The discovery payload: every panel and every accessory it reports. */
export function buildDiscoveredDevices(gladys, panels) {
  return [...everyDevice(gladys, panels)]
    .map((entry) => buildOne(entry, gladys))
    .filter((device) => device.features.length > 0);
}

/** The current value of every feature known, in the publishStates format. */
export function buildStates(gladys, panels) {
  return [...everyDevice(gladys, panels)].flatMap(({ kind, panel, item, blueprint }) =>
    kind === 'panel' ? blueprint.states(gladys, panel) : blueprint.states(gladys, panel, item),
  );
}

/**
 * The transport badge of every device: an accessory is only reachable
 * through its panel, so it shares the panel's.
 */
export function buildTransportEntries(gladys, panels) {
  return [...everyDevice(gladys, panels)].map((entry) => ({
    external_id: buildOne(entry, gladys).external_id,
    transport: alarmPanel.transport(entry.panel),
  }));
}

/** The panel and the accessory behind a Gladys device external_id. */
export function findDevice(gladys, panels, externalId) {
  for (const entry of everyDevice(gladys, panels)) {
    if (buildOne(entry, gladys).external_id === externalId) {
      return entry;
    }
  }
  return null;
}

/** The panel behind a device external_id (a panel or any of its accessories). */
export function findPanel(gladys, panels, externalId) {
  return findDevice(gladys, panels, externalId)?.panel ?? null;
}

/**
 * Put a panel in a mode: arm, partially arm, disarm.
 *
 * Arming takes the code only when "quick arm" is off on the panel; disarming
 * always does. The code is the one of the configuration — never one typed on a
 * dashboard, unless the caller passes it explicitly.
 */
export async function setAlarmMode(client, panel, mode, code) {
  if (!modesOf(panel).includes(mode)) {
    throw new SectorError(`Unknown alarm mode "${mode}" for panel ${panel.id}`, {
      code: ERROR_CODES.NOT_SUPPORTED,
    });
  }
  logger.info(`Panel ${panel.id}: ${panel.mode ?? 'unknown'} -> ${mode}`);
  if (mode === ALARM_MODES.DISARMED) {
    await client.disarm(panel.id, code);
  } else {
    if (panel.armNeedsCode && !code) {
      throw new SectorError(
        'The panel code is required to arm this panel (quick arm is off): fill it in the configuration',
        { code: ERROR_CODES.CODE_REQUIRED },
      );
    }
    const send = mode === ALARM_MODES.PARTIAL ? client.partialArm : client.arm;
    await send.call(client, panel.id, code || undefined);
  }
  // Sector accepted the order: show it now, the next refresh confirms it.
  panel.mode = mode;
}

/**
 * Run a Gladys command (onSetValue) on Sector Alarm.
 *
 * @returns {Promise<Array<object>>} the states to publish once accepted
 */
export async function runCommand(gladys, { panels, client, config, device, feature, value }) {
  const found = findDevice(gladys, panels, device.external_id);
  if (!found) {
    throw new Error(`Unknown Sector Alarm device ${device.external_id}`);
  }
  const { kind, panel, item } = found;

  if (kind === 'panel') {
    if (feature.external_id !== panelIds(gladys, panel.id).feature(PANEL_FEATURES.MODE)) {
      throw new Error(`Unknown feature ${feature.external_id}`);
    }
    await setAlarmMode(client, panel, String(value), config.panel_code);
    return alarmPanel.states(gladys, panel);
  }

  if (kind === 'lock') {
    const lock = value === 1 || value === '1';
    logger.info(`Lock ${item.serial}: ${lock ? 'lock' : 'unlock'}`);
    if (lock) {
      await client.lock(panel.id, item.serial, config.panel_code);
    } else {
      await client.unlock(panel.id, item.serial, config.panel_code);
    }
    item.locked = lock;
    return lockDevice.states(gladys, panel, item);
  }

  if (kind === 'plug') {
    const on = value === 1 || value === '1';
    logger.info(`Plug ${item.serial}: ${on ? 'on' : 'off'}`);
    await client.setSmartplug(panel.id, item.id, on);
    item.on = on;
    return plugDevice.states(gladys, panel, item);
  }

  throw new Error(`${device.external_id} is a sensor: it cannot be controlled`);
}
