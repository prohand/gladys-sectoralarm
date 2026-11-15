// -----------------------------------------------------------------------------
// Reading the Sector Alarm answers.
//
// The API is undocumented and its shapes vary with the panel generation:
// serials come as `SerialNo`, `Serial` or `SerialString`, the "house check"
// lists come either as Sections > Places > Components or as Floors > Rooms >
// Devices, a temperature is sometimes a string. Every function here takes
// whatever came back and returns plain, predictable objects — or nothing,
// never an exception.
// -----------------------------------------------------------------------------

/** Alarm modes, as the integration names them everywhere (keys are forever). */
export const ALARM_MODES = {
  DISARMED: 'disarmed',
  PARTIAL: 'partial',
  ARMED: 'armed',
};

// `Status` of GetPanelStatus. 0 (and anything else) means "unknown".
const STATUS_TO_MODE = {
  1: ALARM_MODES.DISARMED,
  2: ALARM_MODES.PARTIAL,
  3: ALARM_MODES.ARMED,
};

/** What the sensors of the "house check" routes measure. */
export const SENSOR_VALUES = {
  CLOSED: 'closed',
  SMOKE: 'smoke',
  LEAK: 'leak',
  TEMPERATURE: 'temperature',
  HUMIDITY: 'humidity',
  BATTERY_LOW: 'battery_low',
};

const asArray = (value) => (Array.isArray(value) ? value : []);

function asText(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function asBoolean(value) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (value === 1 || value === 0) {
    return value === 1;
  }
  if (typeof value === 'string') {
    const lower = value.trim().toLowerCase();
    if (['true', '1', 'yes'].includes(lower)) return true;
    if (['false', '0', 'no'].includes(lower)) return false;
  }
  return null;
}

function asNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  // "21,5" is how some locales print it.
  const number = Number(typeof value === 'string' ? value.replace(',', '.') : value);
  return Number.isFinite(number) ? number : null;
}

function serialOf(item) {
  return asText(item?.SerialNo) ?? asText(item?.SerialString) ?? asText(item?.Serial);
}

/** GetPanelList -> [{ id, name }] */
export function parsePanelList(data) {
  return asArray(data)
    .map((item) => ({
      id: asText(item?.PanelId),
      name: asText(item?.DisplayName) ?? asText(item?.PanelId),
    }))
    .filter((panel) => panel.id);
}

/** GetPanel -> what the panel can do and which accessories it declares. */
export function parsePanelInfo(data) {
  const info = data && typeof data === 'object' ? data : {};
  const capabilities = asArray(info.Capabilities).map(String);
  return {
    name: asText(info.DisplayName) ?? asText(info.PanelDisplayName),
    codeLength: asNumber(info.PanelCodeLength) ?? 0,
    quickArm: asBoolean(info.QuickArmEnabled) ?? false,
    // Unknown -> assume yes: hiding a mode the panel has is worse than an
    // order the API refuses with a message.
    canPartialArm: asBoolean(info.CanPartialArm) ?? true,
    legacy: capabilities.includes('UseLegacyHomeScreen'),
    locks: parseLocks(info.Locks),
    plugs: parseSmartplugs(info.Smartplugs),
    legacyTemperatures: parseLegacyTemperatures(info.Temperatures),
  };
}

/** GetPanelStatus -> { online, mode } (mode null when unknown). */
export function parsePanelStatus(data) {
  return {
    online: asBoolean(data?.IsOnline),
    mode: STATUS_TO_MODE[asNumber(data?.Status)] ?? null,
  };
}

/** GetLockStatus (or GetPanel.Locks) -> [{ serial, name, locked, batteryLow }] */
export function parseLocks(data) {
  return asArray(data)
    .map((item) => {
      const status = asText(item?.Status)?.toLowerCase();
      return {
        serial: serialOf(item),
        name: asText(item?.Label) ?? asText(item?.Name),
        locked:
          status === 'lock' || status === 'locked' ? true : status === 'unlock' ? false : null,
        batteryLow: asBoolean(item?.BatteryLow ?? item?.LowBattery),
      };
    })
    .filter((lock) => lock.serial);
}

/** GetSmartplugStatus (or GetPanel.Smartplugs) -> [{ id, serial, name, on }] */
export function parseSmartplugs(data) {
  return asArray(data)
    .map((item) => {
      const status = asText(item?.Status)?.toLowerCase();
      return {
        id: asText(item?.Id),
        serial: serialOf(item) ?? asText(item?.Id),
        name: asText(item?.Label) ?? asText(item?.Name),
        on: status === 'on' ? true : status === 'off' ? false : null,
      };
    })
    .filter((plug) => plug.id && plug.serial);
}

/** GetTemperatures (legacy panels) -> sensor readings. */
export function parseLegacyTemperatures(data) {
  return asArray(data)
    .map((item) => ({
      serial: serialOf(item),
      name: asText(item?.Label) ?? asText(item?.Name),
      type: 'temperature',
      values: compact({ [SENSOR_VALUES.TEMPERATURE]: asNumber(item?.Temperature) }),
    }))
    .filter((sensor) => sensor.serial && Object.keys(sensor.values).length > 0);
}

/** Every component of a "house check" answer, whatever its layout. */
function houseCheckComponents(data) {
  if (!data || typeof data !== 'object') {
    return [];
  }
  const fromFloors = asArray(data.Floors).flatMap((floor) =>
    asArray(floor?.Rooms).flatMap((room) => asArray(room?.Devices)),
  );
  const fromSections = asArray(data.Sections).flatMap((section) =>
    asArray(section?.Places).flatMap((place) => asArray(place?.Components)),
  );
  return [...fromFloors, ...fromSections];
}

function compact(values) {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== null && value !== undefined),
  );
}

/**
 * One "house check" answer -> sensor readings.
 *
 * `Alarm` means "smoke" on the smoke route and "water" on the leakage route:
 * the route says what the component is, so it is passed in.
 *
 * @param {unknown} data the answer
 * @param {'doors'|'smoke'|'leak'|'temperature'|'humidity'} kind the route
 */
export function parseHouseCheck(data, kind) {
  return houseCheckComponents(data)
    .map((item) => {
      const alarm = asBoolean(item?.Alarm);
      const values = compact({
        [SENSOR_VALUES.CLOSED]: asBoolean(item?.Closed),
        [SENSOR_VALUES.SMOKE]: kind === 'smoke' ? alarm : null,
        [SENSOR_VALUES.LEAK]: kind === 'leak' ? alarm : null,
        [SENSOR_VALUES.TEMPERATURE]: asNumber(item?.Temperature),
        [SENSOR_VALUES.HUMIDITY]: asNumber(item?.Humidity),
        [SENSOR_VALUES.BATTERY_LOW]: asBoolean(item?.LowBattery ?? item?.BatteryLow),
      });
      return {
        serial: serialOf(item),
        name: asText(item?.Label) ?? asText(item?.Name),
        type: asText(item?.Type) ?? kind,
        values,
      };
    })
    .filter((sensor) => sensor.serial && Object.keys(sensor.values).length > 0);
}

/**
 * Merge sensor readings by serial: one physical component is often listed by
 * several routes (a smoke detector also reports a temperature).
 *
 * @returns {Map<string, { serial, name, type, values }>}
 */
export function mergeSensors(...lists) {
  const merged = new Map();
  for (const sensor of lists.flat()) {
    const known = merged.get(sensor.serial);
    if (!known) {
      merged.set(sensor.serial, { ...sensor, values: { ...sensor.values } });
      continue;
    }
    known.name = known.name ?? sensor.name;
    Object.assign(known.values, sensor.values);
  }
  return merged;
}

/** Log records -> [{ time, eventType, user, channel, lockName }], oldest first. */
export function parseLogs(data) {
  const records = asArray(data?.Records ?? data);
  return records
    .map((item) => {
      const time = Date.parse(asText(item?.Time) ?? '');
      return {
        time: Number.isFinite(time) ? time : null,
        eventType: asText(item?.EventType)?.toLowerCase() ?? null,
        user: asText(item?.User),
        channel: asText(item?.Channel),
        lockName: asText(item?.LockName),
      };
    })
    .filter((record) => record.time !== null && record.eventType)
    .sort((a, b) => a.time - b.time);
}
