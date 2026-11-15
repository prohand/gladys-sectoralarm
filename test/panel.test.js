import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SectorClient } from '../src/sector/client.js';
import { listPanels, PanelState } from '../src/sector/panel.js';
import { normalizeConfig } from '../src/config.js';
import { createFakeSector, PANEL_ID } from './helpers/fakeSector.js';

function setup() {
  const sector = createFakeSector();
  const client = new SectorClient({ fetch: sector.fetch });
  client.configure({ email: 'user@example.com', password: 'secret' });
  return { sector, client, panel: new PanelState({ id: PANEL_ID, name: 'Home' }) };
}

test('a refresh reads the status, the accessories and the sensors', async () => {
  const { client, panel } = setup();
  const result = await panel.refresh(client);
  assert.deepEqual(result.errors, []);
  assert.equal(panel.mode, 'disarmed');
  assert.equal(panel.online, true);
  assert.equal(panel.reachable, true);
  assert.equal(panel.locks.get('LOCK1').locked, true);
  assert.equal(panel.plugs.get('PLUG1').on, false);
  assert.deepEqual(panel.sensors.get('CLIM1').values, { temperature: 21.5, humidity: 45 });
  assert.deepEqual(panel.sensors.get('DOOR1').values, { closed: true, battery_low: false });
  assert.deepEqual(panel.sensors.get('SMOKE1').values, { smoke: false, temperature: 20 });
});

test('the first refresh is no transition, the next ones are', async () => {
  const { sector, client, panel } = setup();
  assert.equal((await panel.refresh(client)).modeChange, null);
  sector.account.status.Status = 3;
  assert.deepEqual((await panel.refresh(client)).modeChange, {
    previous: 'disarmed',
    mode: 'armed',
  });
  assert.equal((await panel.refresh(client)).modeChange, null);
  sector.account.status.IsOnline = false;
  assert.deepEqual((await panel.refresh(client)).onlineChange, { previous: true, online: false });
});

test('an offline panel keeps its last known mode', async () => {
  const { sector, client, panel } = setup();
  await panel.refresh(client);
  // Sector reports "armed" for an offline panel: not a real arming.
  sector.account.status = { IsOnline: false, Status: 3 };
  const result = await panel.refresh(client);
  assert.equal(panel.mode, 'disarmed');
  assert.equal(result.modeChange, null);
});

test('a route the panel lacks is dropped for good, other failures are kept as errors', async () => {
  const { sector, client, panel } = setup();
  sector.account.leak = null;
  sector.account.failures['GET /api/panel/GetLockStatus'] = 500;
  const result = await panel.refresh(client);
  assert.equal(result.errors.length, 1);
  assert.ok(panel.unsupported.has('leak'));
  await panel.refresh(client);
  const leakReads = sector.requests.filter((r) => r.route.includes('leakagedetectors')).length;
  assert.equal(leakReads, 1);
  // The lock keeps the value of GetPanel.
  assert.equal(panel.locks.get('LOCK1').locked, true);
});

test('a failed status read makes the panel unreachable and throws', async () => {
  const { sector, client, panel } = setup();
  await panel.refresh(client);
  sector.account.failures['GET /api/panel/GetPanelStatus'] = 503;
  await assert.rejects(panel.refresh(client));
  assert.equal(panel.reachable, false);
});

test('legacy panels read their temperatures from the panel route only', async () => {
  const { sector, client, panel } = setup();
  sector.account.panel.Capabilities = ['UseLegacyHomeScreen'];
  sector.account.panel.Temperatures = [{ Label: 'Hall', SerialNo: 'T1', Temperature: '18' }];
  await panel.refresh(client);
  assert.deepEqual(panel.sensors.get('T1').values, { temperature: 18 });
  assert.equal(sector.requests.filter((r) => r.route.includes('housecheck')).length, 0);
});

test('only the log records newer than the last refresh are news', async () => {
  const { sector, client, panel } = setup();
  assert.deepEqual((await panel.refresh(client)).logRecords, []);
  sector.account.logs.Records.unshift({
    User: 'Bob',
    Channel: 'Keypad',
    Time: '2026-11-02T10:00:00Z',
    EventType: 'unlock',
    LockName: 'Front door',
  });
  const { logRecords } = await panel.refresh(client);
  assert.deepEqual(
    logRecords.map((r) => [r.eventType, r.user]),
    [['unlock', 'Bob']],
  );
  assert.deepEqual((await panel.refresh(client)).logRecords, []);
  assert.equal(panel.lockNamed('front DOOR').serial, 'LOCK1');
});

test('listPanels: every panel, or only the configured ones', async () => {
  const { client } = setup();
  assert.deepEqual(await listPanels(client, normalizeConfig({})), [{ id: PANEL_ID, name: 'Home' }]);
  assert.deepEqual(await listPanels(client, normalizeConfig({ panel_id: '999' })), [
    { id: '999', name: '999' },
  ]);
});
