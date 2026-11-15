import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERROR_CODES, jwtPayload, SectorClient } from '../src/sector/client.js';
import { createFakeSector, fakeJwt, PANEL_ID } from './helpers/fakeSector.js';

function setup() {
  const sector = createFakeSector();
  const client = new SectorClient({ fetch: sector.fetch });
  client.configure({ email: 'user@example.com', password: 'secret' });
  return { sector, client };
}

const logins = (sector) =>
  sector.requests.filter((r) => r.route === 'POST /api/Login/Login').length;

test('a JWT payload is read without being verified', () => {
  assert.equal(jwtPayload(fakeJwt(123)).exp, 123);
  assert.equal(jwtPayload('nonsense'), null);
});

test('logs in once, then reuses the token', async () => {
  const { sector, client } = setup();
  await client.getPanelList();
  await client.getPanelStatus(PANEL_ID);
  assert.equal(logins(sector), 1);
  assert.match(sector.requests[1].auth, /^Bearer /);
  assert.deepEqual(sector.requests[0].body, { UserId: 'user@example.com', Password: 'secret' });
});

test('a token refused anyway is renewed once', async () => {
  const { sector, client } = setup();
  await client.getPanelList();
  client.token = 'stale';
  const panels = await client.getPanelList();
  assert.equal(panels.length, 1);
  assert.equal(logins(sector), 2);
});

test('a token past its expiry is renewed before the request', async () => {
  let now = Date.now();
  const sector = createFakeSector(undefined, { now: () => now });
  const client = new SectorClient({ fetch: sector.fetch, now: () => now });
  client.configure({ email: 'user@example.com', password: 'secret' });
  await client.getPanelList();
  now += 2 * 3600 * 1000;
  await client.getPanelList();
  assert.equal(logins(sector), 2);
});

test('concurrent requests share one login', async () => {
  const { sector, client } = setup();
  await Promise.all([
    client.getPanelList(),
    client.getPanelStatus(PANEL_ID),
    client.getLogs(PANEL_ID),
  ]);
  assert.equal(logins(sector), 1);
});

test('wrong credentials are a LOGIN error', async () => {
  const { client } = setup();
  client.configure({ email: 'user@example.com', password: 'wrong' });
  await assert.rejects(client.getPanelList(), (err) => err.code === ERROR_CODES.LOGIN);
});

test('no credentials at all: NOT_CONFIGURED, nothing sent', async () => {
  const sector = createFakeSector();
  const client = new SectorClient({ fetch: sector.fetch });
  await assert.rejects(client.getPanelList(), (err) => err.code === ERROR_CODES.NOT_CONFIGURED);
  assert.equal(sector.requests.length, 0);
});

test('429, 404 and network errors are told apart', async () => {
  const { sector, client } = setup();
  sector.account.failures['GET /api/panel/GetPanelStatus'] = 429;
  await assert.rejects(
    client.getPanelStatus(PANEL_ID),
    (err) => err.code === ERROR_CODES.RATE_LIMIT,
  );
  sector.account.failures['GET /api/panel/GetPanelStatus'] = 500;
  await assert.rejects(client.getPanelStatus(PANEL_ID), (err) => err.code === ERROR_CODES.HTTP);
  sector.account.doors = null;
  await assert.rejects(
    client.getDoorsAndWindows(PANEL_ID),
    (err) => err.code === ERROR_CODES.NOT_SUPPORTED,
  );
  sector.account.unreachable = true;
  await assert.rejects(client.getPanelList(), (err) => err.code === ERROR_CODES.NETWORK);
});

test('orders send the payload the app sends', async () => {
  const { sector, client } = setup();
  await client.arm(PANEL_ID);
  await client.partialArm(PANEL_ID, '1234');
  await client.disarm(PANEL_ID, '1234');
  await client.lock(PANEL_ID, 'LOCK1', '1234');
  await client.setSmartplug(PANEL_ID, '42', true);
  const orders = sector.requests.filter((r) => r.route.startsWith('POST /api/Panel/'));
  assert.deepEqual(orders[0].body, { PanelId: PANEL_ID });
  assert.deepEqual(orders[1].body, { PanelId: PANEL_ID, PanelCode: '1234' });
  assert.deepEqual(orders[3].body, {
    PanelId: PANEL_ID,
    PanelCode: '1234',
    LockSerial: 'LOCK1',
    SerialNo: 'LOCK1',
  });
  assert.deepEqual(orders[4].query, { switchId: '42', panelId: PANEL_ID });
  assert.equal(sector.account.status.Status, 1);
  assert.equal(sector.account.plugs[0].Status, 'On');
});

test('disarming and the locks refuse to go without a code', async () => {
  const { sector, client } = setup();
  await assert.rejects(
    client.disarm(PANEL_ID, ''),
    (err) => err.code === ERROR_CODES.CODE_REQUIRED,
  );
  await assert.rejects(
    client.unlock(PANEL_ID, 'LOCK1'),
    (err) => err.code === ERROR_CODES.CODE_REQUIRED,
  );
  assert.equal(sector.requests.length, 0);
});

test('the password never appears in an error message', async () => {
  const { sector, client } = setup();
  sector.account.failures['POST /api/Login/Login'] = 500;
  await assert.rejects(client.getPanelList(), (err) => !err.message.includes('secret'));
});
