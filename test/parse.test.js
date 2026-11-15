import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALARM_MODES,
  mergeSensors,
  parseHouseCheck,
  parseLocks,
  parseLogs,
  parsePanelInfo,
  parsePanelList,
  parsePanelStatus,
  parseSmartplugs,
} from '../src/sector/parse.js';

test('the panel status maps to the three modes, anything else is unknown', () => {
  assert.deepEqual(parsePanelStatus({ IsOnline: true, Status: 1 }), {
    online: true,
    mode: ALARM_MODES.DISARMED,
  });
  assert.equal(parsePanelStatus({ Status: 2 }).mode, ALARM_MODES.PARTIAL);
  assert.equal(parsePanelStatus({ Status: '3' }).mode, ALARM_MODES.ARMED);
  assert.equal(parsePanelStatus({ Status: 0 }).mode, null);
  assert.deepEqual(parsePanelStatus(null), { online: null, mode: null });
});

test('the panel list keeps the panels with an id', () => {
  assert.deepEqual(parsePanelList([{ PanelId: '1', DisplayName: 'Home' }, { DisplayName: 'x' }]), [
    { id: '1', name: 'Home' },
  ]);
  assert.deepEqual(parsePanelList('not a list'), []);
});

test('panel info: capabilities, and safe defaults when missing', () => {
  const info = parsePanelInfo({
    PanelCodeLength: 6,
    QuickArmEnabled: false,
    CanPartialArm: false,
    Capabilities: ['UseLegacyHomeScreen'],
  });
  assert.equal(info.codeLength, 6);
  assert.equal(info.quickArm, false);
  assert.equal(info.canPartialArm, false);
  assert.equal(info.legacy, true);
  const empty = parsePanelInfo(undefined);
  assert.equal(empty.quickArm, false);
  assert.equal(empty.canPartialArm, true);
  assert.deepEqual(empty.locks, []);
});

test('locks and plugs read their serial whatever its name', () => {
  assert.deepEqual(parseLocks([{ SerialNo: 'A', Label: 'Door', Status: 'unlock' }]), [
    { serial: 'A', name: 'Door', locked: false, batteryLow: null },
  ]);
  assert.equal(parseLocks([{ Serial: 'B', Status: 'lock', BatteryLow: true }])[0].locked, true);
  assert.equal(parseLocks([{ Serial: 'B', Status: 'jammed' }])[0].locked, null);
  assert.deepEqual(parseSmartplugs([{ Id: '7', Serial: 'P', Label: 'Lamp', Status: 'On' }]), [
    { id: '7', serial: 'P', name: 'Lamp', on: true },
  ]);
  // A plug without Id cannot be driven: dropped.
  assert.deepEqual(parseSmartplugs([{ Serial: 'P', Status: 'On' }]), []);
});

test('house check: both layouts, the route says what Alarm means', () => {
  const floors = { Floors: [{ Rooms: [{ Devices: [{ SerialString: 'S', Alarm: true }] }] }] };
  assert.deepEqual(parseHouseCheck(floors, 'smoke')[0].values, { smoke: true });
  assert.deepEqual(parseHouseCheck(floors, 'leak')[0].values, { leak: true });
  const sections = {
    Sections: [
      { Places: [{ Components: [{ SerialNo: 'T', Temperature: '19,5', Humidity: 50 }] }] },
    ],
  };
  assert.deepEqual(parseHouseCheck(sections, 'temperature')[0].values, {
    temperature: 19.5,
    humidity: 50,
  });
  // A component that reports nothing is no sensor.
  assert.deepEqual(
    parseHouseCheck({ Floors: [{ Rooms: [{ Devices: [{ SerialNo: 'X' }] }] }] }, 'doors'),
    [],
  );
  assert.deepEqual(parseHouseCheck(null, 'doors'), []);
});

test('the same component listed by two routes is one sensor', () => {
  const merged = mergeSensors(
    [{ serial: 'A', name: 'Hall', type: 'temperature', values: { temperature: 20 } }],
    [{ serial: 'A', name: null, type: 'humidity', values: { humidity: 40 } }],
  );
  assert.equal(merged.size, 1);
  assert.deepEqual(merged.get('A').values, { temperature: 20, humidity: 40 });
  assert.equal(merged.get('A').name, 'Hall');
});

test('logs come out oldest first, unreadable records dropped', () => {
  const logs = parseLogs({
    Records: [
      { Time: '2026-01-02T00:00:00Z', EventType: 'Armed', User: 'A' },
      { Time: 'garbage', EventType: 'lock' },
      { Time: '2026-01-01T00:00:00Z', EventType: 'unlock', LockName: 'Door' },
    ],
  });
  assert.deepEqual(
    logs.map((record) => record.eventType),
    ['unlock', 'armed'],
  );
});
