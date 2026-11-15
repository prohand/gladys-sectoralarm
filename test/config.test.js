import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, hasCredentials, maskEmail, normalizeConfig } from '../src/config.js';

test('an empty configuration gets the defaults', () => {
  const config = normalizeConfig();
  assert.equal(config.poll_frequency, DEFAULT_CONFIG.poll_frequency);
  assert.deepEqual(config.panelIds, []);
  assert.equal(hasCredentials(config), false);
});

test('values typed as strings are read as numbers, and kept within bounds', () => {
  assert.equal(normalizeConfig({ poll_frequency: '120' }).poll_frequency, 120);
  assert.equal(normalizeConfig({ poll_frequency: 5 }).poll_frequency, 30);
  assert.equal(normalizeConfig({ poll_frequency: 99999 }).poll_frequency, 3600);
  assert.equal(normalizeConfig({ poll_frequency: 'abc' }).poll_frequency, 60);
});

test('the account is trimmed, the password kept as typed', () => {
  const config = normalizeConfig({ email: ' a@b.c ', password: ' pass ', panel_code: ' 12 34 ' });
  assert.equal(config.email, 'a@b.c');
  assert.equal(config.password, ' pass ');
  assert.equal(config.panel_code, '1234');
  assert.equal(hasCredentials(config), true);
});

test('several panel ids can be listed', () => {
  assert.deepEqual(normalizeConfig({ panel_id: '123, 456;789' }).panelIds, ['123', '456', '789']);
  assert.deepEqual(normalizeConfig({ panel_id: '  ' }).panelIds, []);
});

test('the logs never show the full email', () => {
  assert.equal(maskEmail('john.doe@example.com'), 'j***@example.com');
  assert.equal(maskEmail('nonsense'), '***');
  assert.equal(maskEmail(undefined), '***');
});
