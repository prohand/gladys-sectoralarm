import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startIntegration } from './helpers/setup.js';

const feature = (device, key) => device.features.find((f) => f.external_id.endsWith(`:${key}`));

test('on connection: devices, states, transports and status are published', async (t) => {
  const { gladys, integration, device } = await startIntegration();
  t.after(() => integration.stop());
  const names = gladys.fake.discoveredDevices.map((d) => d.name);
  assert.deepEqual(names, [
    'Home',
    'Front door',
    'Lamp',
    'Garden door',
    'Hall',
    'Kitchen',
    'Living room',
  ]);
  const panel = device('panel');
  assert.deepEqual(
    feature(panel, 'mode').supported_options.map((o) => o.value),
    ['disarmed', 'partial', 'armed'],
  );
  assert.equal(gladys.fake.lastState(feature(panel, 'mode').external_id), 'disarmed');
  assert.equal(gladys.fake.lastState(feature(device('lock'), 'lock').external_id), 1);
  // Opening: 1 = closed in Gladys.
  const door = gladys.fake.discoveredDevices.find((d) => d.name === 'Garden door');
  assert.equal(gladys.fake.lastState(feature(door, 'opening').external_id), 1);
  assert.ok(gladys.fake.transports.every((entry) => entry.transport === 'cloud'));
  assert.deepEqual(gladys.fake.connectionStatus, { connected: true });
  // No device is polled by Gladys: the integration reads the panel itself.
  assert.ok(gladys.fake.discoveredDevices.every((d) => d.poll_frequency === undefined));
});

test('without an account: no device, and the status says what to fill in', async (t) => {
  const { gladys, integration, sector } = await startIntegration({ config: {} });
  t.after(() => integration.stop());
  assert.equal(sector.requests.length, 0);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /email and the password/);
});

test('wrong password: the status says so', async (t) => {
  const { gladys, integration } = await startIntegration({
    config: { email: 'user@example.com', password: 'nope' },
  });
  t.after(() => integration.stop());
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.fr, /refuse l’e-mail ou le mot de passe/);
});

test('arming from Gladys sends the order, shows it, and fires the trigger once confirmed', async (t) => {
  const { gladys, integration, sector, device } = await startIntegration();
  t.after(() => integration.stop());
  const panel = device('panel');
  const mode = feature(panel, 'mode');
  assert.deepEqual(await gladys.fake.setValue(panel, mode, 'armed'), { success: true });
  assert.equal(gladys.fake.lastState(mode.external_id), 'armed');
  assert.equal(sector.account.status.Status, 3);
  await integration.refresh();
  assert.deepEqual(
    gladys.fake.sceneEvents.map((e) => [e.key, e.data.mode, e.data.previous_mode]),
    [['alarm_mode_changed', 'armed', 'disarmed']],
  );
});

test('a mode the panel cannot do, or a disarm without code, is refused', async (t) => {
  const account = (await import('./helpers/fakeSector.js')).defaultAccount();
  account.panel.CanPartialArm = false;
  const { gladys, integration, device } = await startIntegration({
    config: { email: 'user@example.com', password: 'secret' },
    account,
  });
  t.after(() => integration.stop());
  const panel = device('panel');
  const mode = feature(panel, 'mode');
  assert.deepEqual(
    mode.supported_options.map((o) => o.value),
    ['disarmed', 'armed'],
  );
  assert.equal((await gladys.fake.setValue(panel, mode, 'partial')).success, false);
  assert.equal((await gladys.fake.setValue(panel, mode, 'disarmed')).success, false);
});

test('locks and plugs follow the orders', async (t) => {
  const { gladys, integration, sector, device } = await startIntegration();
  t.after(() => integration.stop());
  const lock = device('lock');
  await gladys.fake.setValue(lock, feature(lock, 'lock'), 0);
  assert.equal(sector.account.locks[0].Status, 'unlock');
  assert.equal(gladys.fake.lastState(feature(lock, 'lock').external_id), 0);
  const plug = device('plug');
  await gladys.fake.setValue(plug, feature(plug, 'power'), 1);
  assert.equal(sector.account.plugs[0].Status, 'On');
  const sensor = device('sensor');
  assert.equal((await gladys.fake.setValue(sensor, sensor.features[0], 1)).success, false);
});

test('a lock used on the keypad fires lock_operated with who and how', async (t) => {
  const { gladys, integration, sector, device } = await startIntegration();
  t.after(() => integration.stop());
  sector.account.locks[0].Status = 'unlock';
  sector.account.logs.Records.unshift({
    User: 'Bob',
    Channel: 'Keypad',
    Time: '2026-11-02T10:00:00Z',
    EventType: 'unlock',
    LockName: 'Front door',
  });
  await integration.refresh();
  const [event] = gladys.fake.sceneEvents;
  assert.equal(event.key, 'lock_operated');
  assert.deepEqual(event.data, {
    device: device('lock').external_id,
    action: 'unlock',
    lock_name: 'Front door',
    user: 'Bob',
    channel: 'Keypad',
  });
  assert.equal(gladys.fake.lastState(feature(device('lock'), 'lock').external_id), 0);
});

test('a panel going offline: trigger, unreachable badge', async (t) => {
  const { gladys, integration, sector } = await startIntegration();
  t.after(() => integration.stop());
  sector.account.status.IsOnline = false;
  await integration.refresh();
  assert.deepEqual(
    gladys.fake.sceneEvents.map((e) => [e.key, e.data.state]),
    [['panel_connection_changed', 'offline']],
  );
  assert.ok(gladys.fake.transports.slice(-7).every((entry) => entry.transport === 'unreachable'));
});

test('the cloud down: every panel unreachable, status says it', async (t) => {
  const { gladys, integration, sector } = await startIntegration();
  t.after(() => integration.stop());
  sector.account.unreachable = true;
  await integration.refresh();
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /cannot be reached/);
});

test('a new accessory is published again, unchanged states are not', async (t) => {
  const { gladys, integration, sector } = await startIntegration();
  t.after(() => integration.stop());
  const statesBefore = gladys.fake.states.length;
  await integration.refresh();
  assert.equal(gladys.fake.states.length, statesBefore);
  sector.account.leak.Floors[0].Rooms[0].Devices.push({
    SerialString: 'LEAK2',
    Label: 'Bath',
    Alarm: true,
  });
  await integration.refresh();
  assert.ok(gladys.fake.discoveredDevices.some((d) => d.name === 'Bath'));
});

test('test_connection lists the panels in every language', async (t) => {
  const { gladys, integration } = await startIntegration();
  t.after(() => integration.stop());
  const { success, data } = await gladys.fake.action('test_connection', {});
  assert.equal(success, true);
  assert.match(data.message.en, /Home \(01234567\): disarmed, online, 6 accessories/);
  assert.match(data.message.fr, /désarmée, en ligne/);
  assert.match(data.message.de, /unscharf/);
  assert.match(data.message.es, /desarmada/);
});

test('the refresh action answers', async (t) => {
  const { gladys, integration } = await startIntegration();
  t.after(() => integration.stop());
  const { success, data } = await gladys.fake.action('refresh', {});
  assert.equal(success, true);
  assert.ok(data.message.en);
});

test('a configuration saved again re-reads everything', async (t) => {
  const { gladys, integration } = await startIntegration();
  t.after(() => integration.stop());
  await gladys.fake.configUpdated({ email: '', password: '' });
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.deepEqual(integration.panels(), []);
});

test('the connection status is sent when it changes, not at every refresh', async (t) => {
  const { gladys, integration, sector } = await startIntegration();
  t.after(() => integration.stop());
  await integration.refresh();
  await integration.refresh();
  assert.equal(gladys.fake.connectionStatuses.length, 1);
  sector.account.unreachable = true;
  await integration.refresh();
  await integration.refresh();
  assert.equal(gladys.fake.connectionStatuses.length, 2);
});
