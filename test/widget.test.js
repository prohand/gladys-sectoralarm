import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { buildAlarmWidget, WIDGET_ACTIONS } from '../src/capabilities/widget.js';
import { startIntegration } from './helpers/setup.js';

const widgetGet = async (gladys, settings = {}) =>
  (await gladys.fake.widgetGet('sector_alarm', { settings })).data.content;

test('the content is rendered exactly as sent', async (t) => {
  const { gladys, integration } = await startIntegration();
  t.after(() => integration.stop());
  // [] = nothing the core would drop, truncate or trim to the content budget.
  assert.deepEqual(validateWidgetContent(await widgetGet(gladys)), []);
});

test('alerts, open doors and unlocked locks show up', async (t) => {
  const { gladys, integration, sector } = await startIntegration();
  t.after(() => integration.stop());
  sector.account.smoke.Floors[0].Rooms[0].Devices[0].Alarm = true;
  sector.account.doors.Floors[0].Rooms[0].Devices[0].Closed = false;
  sector.account.locks[0].Status = 'unlock';
  sector.account.status = { IsOnline: false, Status: 3 };
  await integration.refresh();
  const content = await widgetGet(gladys);
  assert.deepEqual(validateWidgetContent(content), []);
  const items = content.components.find((c) => c.type === 'status').items;
  const value = (label) => items.find((item) => item.label.en === label).value.en;
  assert.equal(value('Alerts'), 'Smoke!');
  assert.equal(value('Doors & windows'), '1 open');
  assert.equal(value('Locks'), '1 unlocked');
  assert.equal(value('Connection'), 'Offline');
});

test('the widget of a chosen device shows its panel', async (t) => {
  const { gladys, integration, device } = await startIntegration();
  t.after(() => integration.stop());
  const content = await widgetGet(gladys, { device: device('lock').external_id });
  assert.equal(content.components[0].text, 'Home');
});

test('no panel yet: a valid empty state', () => {
  const content = buildAlarmWidget(createFakeGladys(), []);
  assert.deepEqual(validateWidgetContent(content), []);
});

test('arming takes a confirmation; disarming asks for the code every time', async (t) => {
  const { gladys, integration } = await startIntegration();
  t.after(() => integration.stop());
  const buttons = (await widgetGet(gladys)).components.filter((c) => c.type === 'button');
  const action = (key) => buttons.find((b) => b.action.key === key).action;
  assert.equal(action(WIDGET_ACTIONS.ARM).confirm, true);
  assert.equal(action(WIDGET_ACTIONS.PARTIAL).confirm, true);
  assert.deepEqual(
    action(WIDGET_ACTIONS.DISARM).fields.map((f) => [f.key, f.required]),
    [['code', true]],
  );
});

test('every button is handled and answers a short toast', async (t) => {
  const { gladys, integration, sector } = await startIntegration();
  t.after(() => integration.stop());
  const buttons = (await widgetGet(gladys)).components.filter((c) => c.type === 'button');
  for (const { action } of buttons) {
    const values = action.fields ? { code: '1234' } : undefined;
    const { success, data } = await gladys.fake.widgetAction(
      'sector_alarm',
      action.key,
      action.params,
      {
        settings: {},
        values,
      },
    );
    assert.equal(success, true, action.key);
    assert.ok(data.message.en.length <= 200);
  }
  assert.equal(sector.account.status.Status, 1);
});

test('disarming from the widget never uses the stored code', async (t) => {
  const { gladys, integration, sector } = await startIntegration();
  t.after(() => integration.stop());
  sector.account.status.Status = 3;
  await integration.refresh();
  const params = { panel: '01234567' };
  const noCode = await gladys.fake.widgetAction('sector_alarm', 'disarm', params, { settings: {} });
  assert.equal(noCode.success, false);
  const wrongCode = await gladys.fake.widgetAction('sector_alarm', 'disarm', params, {
    settings: {},
    values: { code: '0000' },
  });
  assert.equal(wrongCode.success, false);
  assert.match(wrongCode.error, /check the panel code/);
  assert.equal(sector.account.status.Status, 3);
});

test('an unknown widget action fails', async (t) => {
  const { gladys, integration } = await startIntegration();
  t.after(() => integration.stop());
  const { success } = await gladys.fake.widgetAction('sector_alarm', 'nope', {}, { settings: {} });
  assert.equal(success, false);
});
