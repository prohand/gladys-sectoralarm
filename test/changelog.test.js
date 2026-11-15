import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { rollChangelog } from '../.github/scripts/changelog-release.mjs';

const REPO = 'https://github.com/prohand/gladys-sectoralarm';

test('the Unreleased section moves under the new version', () => {
  const text = `# Changelog\n\n## [Unreleased]\n\n### Added\n\n- Thing\n\n## [1.0.0] - 2026-01-01\n\n- First\n\n[Unreleased]: ${REPO}/compare/v1.0.0...HEAD\n[1.0.0]: ${REPO}/releases/tag/v1.0.0\n`;
  const rolled = rollChangelog(text, '1.1.0', '2026-02-01');
  assert.match(rolled, /## \[Unreleased\]\n\n## \[1\.1\.0\] - 2026-02-01\n\n### Added\n\n- Thing/);
  assert.match(rolled, new RegExp(`\\[Unreleased\\]: ${REPO}/compare/v1\\.1\\.0\\.\\.\\.HEAD`));
  assert.match(
    rolled,
    new RegExp(`\\[1\\.1\\.0\\]: ${REPO}/compare/v1\\.0\\.0\\.\\.\\.v1\\.1\\.0`),
  );
});

test('the first release links to its tag', () => {
  const text = `# Changelog\n\n## [Unreleased]\n\n- First\n\n[Unreleased]: ${REPO}/commits/main\n`;
  const rolled = rollChangelog(text, '1.0.0', '2026-01-01');
  assert.match(rolled, new RegExp(`\\[1\\.0\\.0\\]: ${REPO}/releases/tag/v1\\.0\\.0`));
});

test('an empty Unreleased section still writes the version', () => {
  const rolled = rollChangelog('# C\n\n## [Unreleased]\n', '1.0.1', '2026-01-01');
  assert.match(rolled, /Maintenance release/);
});

test('the real CHANGELOG.md has an Unreleased section the script can roll', async () => {
  const text = await readFile(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  assert.match(text, /^## \[Unreleased\]$/m);
  assert.notEqual(rollChangelog(text, '9.9.9', '2026-01-01'), text);
});
