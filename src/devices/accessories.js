// -----------------------------------------------------------------------------
// Device types: SMART LOCK, SMART PLUG and SENSOR.
//
// The accessories a panel reports. Their external ids are built from the panel
// id AND the serial Sector Alarm gives them: a serial is only unique within a
// panel, and an account may have several.
//
// Values, as Gladys reads them:
//   - lock          1 = locked, 0 = unlocked
//   - switch        1 = on, 0 = off
//   - opening       1 = closed, 0 = open (the Gladys convention)
//   - smoke / leak  1 = detected
//   - battery-low   1 = the battery is low
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import { SENSOR_VALUES } from '../sector/parse.js';

const binary = (value) => (value ? 1 : 0);

const state = (externalId, value) => ({ device_feature_external_id: externalId, state: value });

// --- Smart lock ----------------------------------------------------------------

export const lockDevice = {
  type: 'lock',
  FEATURES: { LOCK: 'lock', BATTERY_LOW: 'battery-low' },

  ids(gladys, panelId, serial) {
    return gladys.externalIds('lock', `${panelId}-${serial}`);
  },

  buildDevice(gladys, panel, lock) {
    const ids = this.ids(gladys, panel.id, lock.serial);
    const features = [
      {
        name: 'Lock',
        external_id: ids.feature(this.FEATURES.LOCK),
        category: DEVICE_FEATURE_CATEGORIES.LOCK,
        type: DEVICE_FEATURE_TYPES.LOCK.BINARY,
        read_only: false,
        has_feedback: true,
        keep_history: true,
        min: 0,
        max: 1,
      },
    ];
    if (lock.batteryLow !== null && lock.batteryLow !== undefined) {
      features.push(batteryLowFeature(ids));
    }
    return {
      name: lock.name || `Lock ${lock.serial}`,
      external_id: ids.device,
      model: 'Sector Alarm smart lock',
      params: [
        { name: 'panel_id', value: panel.id },
        { name: 'serial', value: lock.serial },
      ],
      features,
    };
  },

  states(gladys, panel, lock) {
    const ids = this.ids(gladys, panel.id, lock.serial);
    const states = [];
    if (lock.locked !== null && lock.locked !== undefined) {
      states.push(state(ids.feature(this.FEATURES.LOCK), binary(lock.locked)));
    }
    if (lock.batteryLow !== null && lock.batteryLow !== undefined) {
      states.push(state(ids.feature(this.FEATURES.BATTERY_LOW), binary(lock.batteryLow)));
    }
    return states;
  },
};

// --- Smart plug ----------------------------------------------------------------

export const plugDevice = {
  type: 'plug',
  FEATURES: { POWER: 'power' },

  ids(gladys, panelId, serial) {
    return gladys.externalIds('plug', `${panelId}-${serial}`);
  },

  buildDevice(gladys, panel, plug) {
    const ids = this.ids(gladys, panel.id, plug.serial);
    return {
      name: plug.name || `Smart plug ${plug.serial}`,
      external_id: ids.device,
      model: 'Sector Alarm smart plug',
      params: [
        { name: 'panel_id', value: panel.id },
        { name: 'serial', value: plug.serial },
      ],
      features: [
        {
          name: 'Power',
          external_id: ids.feature(this.FEATURES.POWER),
          category: DEVICE_FEATURE_CATEGORIES.SWITCH,
          type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
          read_only: false,
          has_feedback: true,
          keep_history: true,
          min: 0,
          max: 1,
        },
      ],
    };
  },

  states(gladys, panel, plug) {
    if (plug.on === null || plug.on === undefined) {
      return [];
    }
    const ids = this.ids(gladys, panel.id, plug.serial);
    return [state(ids.feature(this.FEATURES.POWER), binary(plug.on))];
  },
};

// --- Sensors (doors and windows, smoke, leakage, temperature, humidity) ---------

function batteryLowFeature(ids) {
  return {
    name: 'Battery low',
    external_id: ids.feature('battery-low'),
    category: DEVICE_FEATURE_CATEGORIES.BATTERY_LOW,
    type: DEVICE_FEATURE_TYPES.BATTERY_LOW.BINARY,
    read_only: true,
    has_feedback: false,
    keep_history: true,
    min: 0,
    max: 1,
  };
}

// One feature per value a sensor reports. Order = display order.
const SENSOR_FEATURES = [
  {
    value: SENSOR_VALUES.CLOSED,
    key: 'opening',
    name: 'Opening',
    category: DEVICE_FEATURE_CATEGORIES.OPENING_SENSOR,
    type: DEVICE_FEATURE_TYPES.SENSOR.BINARY,
    min: 0,
    max: 1,
    toState: (closed) => binary(closed),
  },
  {
    value: SENSOR_VALUES.SMOKE,
    key: 'smoke',
    name: 'Smoke',
    category: DEVICE_FEATURE_CATEGORIES.SMOKE_SENSOR,
    type: DEVICE_FEATURE_TYPES.SENSOR.BINARY,
    min: 0,
    max: 1,
    toState: binary,
  },
  {
    value: SENSOR_VALUES.LEAK,
    key: 'leak',
    name: 'Water leak',
    category: DEVICE_FEATURE_CATEGORIES.LEAK_SENSOR,
    type: DEVICE_FEATURE_TYPES.SENSOR.BINARY,
    min: 0,
    max: 1,
    toState: binary,
  },
  {
    value: SENSOR_VALUES.TEMPERATURE,
    key: 'temperature',
    name: 'Temperature',
    category: DEVICE_FEATURE_CATEGORIES.TEMPERATURE_SENSOR,
    type: DEVICE_FEATURE_TYPES.SENSOR.DECIMAL,
    unit: DEVICE_FEATURE_UNITS.CELSIUS,
    min: -40,
    max: 80,
    toState: (value) => value,
  },
  {
    value: SENSOR_VALUES.HUMIDITY,
    key: 'humidity',
    name: 'Humidity',
    category: DEVICE_FEATURE_CATEGORIES.HUMIDITY_SENSOR,
    type: DEVICE_FEATURE_TYPES.SENSOR.DECIMAL,
    unit: DEVICE_FEATURE_UNITS.PERCENT,
    min: 0,
    max: 100,
    toState: (value) => value,
  },
  {
    value: SENSOR_VALUES.BATTERY_LOW,
    key: 'battery-low',
    name: 'Battery low',
    category: DEVICE_FEATURE_CATEGORIES.BATTERY_LOW,
    type: DEVICE_FEATURE_TYPES.BATTERY_LOW.BINARY,
    min: 0,
    max: 1,
    toState: binary,
  },
];

// A friendlier model than the raw Sector type, when it is known.
const SENSOR_MODELS = {
  doors: 'door/window sensor',
  smoke: 'smoke detector',
  leak: 'leakage detector',
  temperature: 'temperature sensor',
  humidity: 'humidity sensor',
};

export const sensorDevice = {
  type: 'sensor',
  FEATURES: Object.fromEntries(SENSOR_FEATURES.map((f) => [f.value, f.key])),

  ids(gladys, panelId, serial) {
    return gladys.externalIds('sensor', `${panelId}-${serial}`);
  },

  buildDevice(gladys, panel, sensor) {
    const ids = this.ids(gladys, panel.id, sensor.serial);
    const features = SENSOR_FEATURES.filter((spec) => spec.value in sensor.values).map((spec) => ({
      name: spec.name,
      external_id: ids.feature(spec.key),
      category: spec.category,
      type: spec.type,
      ...(spec.unit ? { unit: spec.unit } : {}),
      read_only: true,
      has_feedback: false,
      keep_history: true,
      min: spec.min,
      max: spec.max,
    }));
    return {
      name: sensor.name || `Sensor ${sensor.serial}`,
      external_id: ids.device,
      model: `Sector Alarm ${SENSOR_MODELS[sensor.type] ?? sensor.type ?? 'sensor'}`.trim(),
      params: [
        { name: 'panel_id', value: panel.id },
        { name: 'serial', value: sensor.serial },
      ],
      features,
    };
  },

  states(gladys, panel, sensor) {
    const ids = this.ids(gladys, panel.id, sensor.serial);
    return SENSOR_FEATURES.filter((spec) => spec.value in sensor.values).map((spec) =>
      state(ids.feature(spec.key), spec.toState(sensor.values[spec.value])),
    );
  },
};
