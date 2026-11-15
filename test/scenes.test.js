import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { startIntegration } from './helpers/setup.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const declared = (list, key) => list.find((entry) => entry.key === key);

test('set_alarm_mode arms, and its outputs are the declared ones', async (t) => {
  const { gladys, integration, sector, device } = await startIntegration();
  t.after(() => integration.stop());
  const { success, data } = await gladys.fake.sceneAction('set_alarm_mode', {
    device: device('panel').external_id,
    mode: 'partial',
  });
  assert.equal(success, true);
  assert.deepEqual(data.outputs, { applied: true, mode: 'partial', error: null });
  assert.equal(sector.account.status.Status, 2);
  const outputs = declared(manifest.scene_actions, 'set_alarm_mode').outputs.map((o) => o.key);
  assert.deepEqual(Object.keys(data.outputs).sort(), outputs.sort());
});

test('set_alarm_mode on an accessory acts on its panel', async (t) => {
  const { gladys, integration, sector, device } = await startIntegration();
  t.after(() => integration.stop());
  await gladys.fake.sceneAction('set_alarm_mode', {
    device: device('lock').external_id,
    mode: 'armed',
  });
  assert.equal(sector.account.status.Status, 3);
});

test('a refused order is an output, never a failed action', async (t) => {
  const { gladys, integration, device } = await startIntegration({
    config: { email: 'user@example.com', password: 'secret' },
  });
  t.after(() => integration.stop());
  const { success, data } = await gladys.fake.sceneAction('set_alarm_mode', {
    device: device('panel').external_id,
    mode: 'disarmed',
  });
  assert.equal(success, true);
  assert.equal(data.outputs.applied, false);
  assert.match(data.outputs.error, /panel code is required/);
});

test('refresh_now reads the panel and answers its mode', async (t) => {
  const { gladys, integration, sector } = await startIntegration();
  t.after(() => integration.stop());
  sector.account.status.Status = 3;
  const { data } = await gladys.fake.sceneAction('refresh_now', {});
  assert.deepEqual(data.outputs, { mode: 'armed', online: true });
});

test('every event the integration fires carries only declared keys', async (t) => {
  const { gladys, integration, sector } = await startIntegration();
  t.after(() => integration.stop());
  sector.account.status = { IsOnline: true, Status: 3 };
  sector.account.logs.Records.unshift(
    { User: 'Ann', Channel: 'Tag', Time: '2026-11-03T10:00:00Z', EventType: 'armed', LockName: '' },
    {
      User: 'Ann',
      Channel: 'App',
      Time: '2026-11-03T10:01:00Z',
      EventType: 'lock_failed',
      LockName: 'Front door',
    },
  );
  await integration.refresh();
  sector.account.status.IsOnline = false;
  await integration.refresh();
  const keys = gladys.fake.sceneEvents.map((event) => event.key).sort();
  assert.deepEqual(keys, ['alarm_mode_changed', 'lock_operated', 'panel_connection_changed']);
  for (const event of gladys.fake.sceneEvents) {
    const trigger = declared(manifest.scene_triggers, event.key);
    const allowed = [...trigger.fields, ...trigger.variables].map((entry) => entry.key);
    for (const key of Object.keys(event.data)) {
      assert.ok(allowed.includes(key), `${event.key}: "${key}" is not declared`);
    }
  }
  const armed = gladys.fake.sceneEvents.find((event) => event.key === 'alarm_mode_changed');
  assert.equal(armed.data.user, 'Ann');
  assert.equal(armed.data.channel, 'Tag');
});

test('the options of the trigger filters are the values the code sends', () => {
  const options = (trigger, field) =>
    declared(declared(manifest.scene_triggers, trigger).fields, field)
      .options.map((o) => o.value)
      .sort();
  assert.deepEqual(options('alarm_mode_changed', 'mode'), ['armed', 'disarmed', 'partial']);
  assert.deepEqual(options('panel_connection_changed', 'state'), ['offline', 'online']);
  assert.deepEqual(options('lock_operated', 'action'), ['lock', 'lock_failed', 'unlock']);
});
