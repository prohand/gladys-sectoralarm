// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code actually registers — these tests keep both in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULT_CONFIG, MAX_POLL_SECONDS, MIN_POLL_SECONDS } from '../src/config.js';
import { SCENE_ACTIONS, SCENE_TRIGGERS } from '../src/capabilities/scenes.js';
import { ALARM_WIDGET } from '../src/capabilities/widget.js';
import { LANGUAGES } from '../src/i18n.js';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const manifest = JSON.parse(await read('../gladys-assistant-integration.json'));
const pkg = JSON.parse(await read('../package.json'));
const source = await read('../src/integration.js');

test('version, image tag and package.json agree', () => {
  assert.equal(manifest.version, pkg.version);
  assert.equal(manifest.docker_image, `ghcr.io/prohand/gladys-sectoralarm:${pkg.version}`);
  assert.match(
    manifest.cover_image,
    /^https:\/\/raw\.githubusercontent\.com\/prohand\/gladys-sectoralarm\//,
  );
});

test('every manifest action is registered', () => {
  for (const action of manifest.actions ?? []) {
    assert.match(source, new RegExp(`onAction\\('${action.key}'`), `action "${action.key}"`);
  }
});

// The store schema is the admission authority: a field type outside this list,
// or a placeholder that is not a multi-language object, gets the integration
// rejected by the indexer.
const FIELD_TYPES = [
  'string',
  'number',
  'boolean',
  'select',
  'multi_select',
  'secret',
  'oauth2',
  'section',
];

test('every field uses a type the store accepts', () => {
  const allFields = [
    ...manifest.config_schema,
    ...(manifest.actions ?? []).flatMap((a) => a.fields ?? []),
    ...(manifest.widgets ?? []).flatMap((w) => w.settings ?? []),
    ...(manifest.scene_triggers ?? []).flatMap((t) => t.fields ?? []),
    ...(manifest.scene_actions ?? []).flatMap((a) => a.fields ?? []),
  ];
  for (const field of allFields) {
    assert.ok(
      FIELD_TYPES.includes(field.type),
      `field "${field.key}": unknown type "${field.type}"`,
    );
    assert.match(field.key, /^[a-z0-9_]+$/, `field key "${field.key}" must be snake_case`);
    if (field.placeholder !== undefined) {
      assert.equal(typeof field.placeholder, 'object', `field "${field.key}": placeholder object`);
      assert.ok(['string', 'number', 'secret'].includes(field.type), `field "${field.key}"`);
    }
    if (field.min !== undefined || field.max !== undefined) {
      assert.equal(field.type, 'number', `field "${field.key}": min/max are number-only`);
    }
    if (field.source !== undefined) {
      assert.equal(field.source, 'devices');
      assert.equal(field.options, undefined, `field "${field.key}": source and options`);
    }
  }
});

test('the secrets are secret fields', () => {
  for (const key of ['password', 'panel_code']) {
    assert.equal(manifest.config_schema.find((f) => f.key === key).type, 'secret', key);
  }
});

test('config_schema defaults and bounds stay consistent with the code', () => {
  for (const field of manifest.config_schema) {
    if (field.type === 'section') {
      assert.equal(field.default, undefined);
      assert.equal(field.required, undefined);
      assert.ok(!(field.key in DEFAULT_CONFIG));
      continue;
    }
    assert.ok(field.key in DEFAULT_CONFIG, `config key "${field.key}" missing in DEFAULT_CONFIG`);
    if (field.default !== undefined) {
      assert.equal(DEFAULT_CONFIG[field.key], field.default, `default of ${field.key}`);
    }
  }
  const poll = manifest.config_schema.find((f) => f.key === 'poll_frequency');
  assert.equal(poll.min, MIN_POLL_SECONDS);
  assert.equal(poll.max, MAX_POLL_SECONDS);
});

const CATEGORIES = [
  'climate',
  'lighting',
  'energy',
  'security',
  'multimedia',
  'appliances',
  'environment',
  'protocols',
  'network',
  'notifications',
  'assistants',
  'services',
  'transport',
  'vehicles',
  'servers',
  'leisure',
];

test('the categories stay inside the vocabulary the store indexes', () => {
  const { categories } = manifest;
  assert.ok(categories.length >= 1 && categories.length <= 3);
  for (const category of categories) {
    assert.ok(CATEGORIES.includes(category), `unknown category "${category}"`);
  }
});

test('Sector Alarm is a cloud service: the cloud transport tag only', () => {
  assert.deepEqual(manifest.transports, ['cloud']);
});

test('the Gladys floor covers every field the manifest declares', () => {
  // widgets and scene declarations need 5.1, `keywords` 5.3.
  const [major, minor] = manifest.gladys_version.replace(/^>=/, '').split('.').map(Number);
  assert.ok(major > 5 || (major === 5 && minor >= 3), manifest.gladys_version);
});

test('the search keywords follow the store rules', () => {
  const { keywords } = manifest;
  assert.ok(keywords.length >= 1 && keywords.length <= 10);
  const normalized = keywords.map((keyword) => keyword.trim().toLowerCase());
  assert.equal(new Set(normalized).size, keywords.length, 'keywords must be unique');
  for (const keyword of normalized) {
    assert.ok(keyword.length >= 2 && keyword.length <= 30, `keyword "${keyword}"`);
  }
});

test('the widget and scene actions are handled, the triggers are the ones fired', () => {
  assert.deepEqual(
    manifest.widgets.map((w) => w.key),
    [ALARM_WIDGET],
  );
  assert.match(source, /onWidgetGet\(ALARM_WIDGET/);
  assert.match(source, /onWidgetAction\(ALARM_WIDGET/);
  assert.deepEqual(
    manifest.scene_actions.map((a) => a.key).sort(),
    Object.values(SCENE_ACTIONS).sort(),
  );
  for (const key of Object.keys(SCENE_ACTIONS)) {
    assert.match(source, new RegExp(`onSceneAction\\(SCENE_ACTIONS\\.${key}`));
  }
  assert.deepEqual(
    manifest.scene_triggers.map((t) => t.key).sort(),
    Object.values(SCENE_TRIGGERS).sort(),
  );
});

/** Every multi-language object of the manifest, with where it sits. */
function multiLanguageTexts(node, path = 'manifest') {
  if (Array.isArray(node)) {
    return node.flatMap((child, index) => multiLanguageTexts(child, `${path}[${index}]`));
  }
  if (node === null || typeof node !== 'object') {
    return [];
  }
  const keys = Object.keys(node);
  if (keys.includes('en') && keys.every((key) => /^[a-z]{2}$/.test(key))) {
    return [{ path, text: node }];
  }
  return keys.flatMap((key) => multiLanguageTexts(node[key], `${path}.${key}`));
}

test('every multi-language text of the manifest carries en, fr, de and es', () => {
  const texts = multiLanguageTexts(manifest);
  assert.ok(texts.length > 50, `only ${texts.length} texts found`);
  for (const { path, text } of texts) {
    assert.deepEqual(Object.keys(text).sort(), [...LANGUAGES].sort(), `${path}: languages`);
    for (const language of LANGUAGES) {
      assert.ok(text[language].trim().length > 0, `${path}.${language} is empty`);
    }
  }
});

test('the per-language length limits of the store hold in every language', () => {
  const within = (text, min, max, where) => {
    for (const language of LANGUAGES) {
      const { length } = text[language];
      assert.ok(length >= min && length <= max, `${where}.${language}: ${length} characters`);
    }
  };
  assert.ok(manifest.name.length >= 3 && manifest.name.length <= 30);
  within(manifest.description, 10, 100, 'description');
  for (const widget of manifest.widgets) {
    within(widget.label, 3, 30, `widget ${widget.key} label`);
    within(widget.description, 1, 100, `widget ${widget.key} description`);
  }
  for (const section of manifest.config_schema.filter((f) => f.type === 'section')) {
    within(section.description, 1, 1000, `section ${section.key} description`);
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//);
    }
  }
});

test('the user documentation exists in every language', async () => {
  for (const language of LANGUAGES) {
    const text = await read(`../docs/${language}.md`);
    assert.ok(text.length > 1000, `docs/${language}.md is too short`);
    for (const key of [...Object.values(SCENE_TRIGGERS), ...Object.values(SCENE_ACTIONS)]) {
      assert.ok(text.includes(key), `docs/${language}.md does not mention ${key}`);
    }
  }
});
