# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) and to human contributors
working in this repository.

## What this is

A Gladys Assistant **external integration** (Node 22+, ESM, no build step, one runtime
dependency: `@gladysassistant/integration-sdk`) for **Sector Alarm** home alarm systems:
the alarm panel (disarmed / partially armed / armed), smart locks, smart plugs and the
"house check" sensors (doors and windows, smoke, water leaks, temperature, humidity).
Requires Gladys 5.3+. Started from the official
[JavaScript template](https://github.com/GladysAssistant/integration-template-js); the
GitHub workflows are the same as [gladys-devmel](https://github.com/prohand/gladys-devmel).

**Cloud only**: Sector Alarm has no local API. Everything goes through
`https://mypagesapi.sectoralarm.net` (the API of the Sector Alarm mobile app,
undocumented), with the user's email and password. Manifest `transports: ["cloud"]`.

## Commands

```bash
npm install
npm test                                    # node --test (built-in runner)
node --test test/panel.test.js              # one file
node --test --test-name-pattern "offline"   # one test by name
npm run lint                                # eslint .
npm run format:check                        # prettier --check . (CI gate)
npm run format                              # prettier --write .
npx github:GladysAssistant/integration-store .   # store admission checks
```

CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on Node 22 and 24,
plus the store checks and a Docker build on pull requests. Releases: **Actions → Release**
only (bumps `package.json`, manifest `version` + `docker_image`, rolls `CHANGELOG.md`,
re-runs Prettier, tags, builds the multi-arch image, publishes the GitHub Release).

## Architecture

```
index.js                     SDK bootstrap only: creates the integration, shutdown, connect()
src/integration.js           every SDK handler, the refresh timer, publishing (testable)
src/config.js                DEFAULT_CONFIG (mirrors the manifest defaults) + normalization
src/i18n.js                  LANGUAGES = en, fr, de, es + localize/pick helpers
src/sector/client.js         HTTP client: login (JWT cached until exp), routes, SectorError codes
src/sector/parse.js          tolerant readers of every API answer (shapes vary per panel)
src/sector/panel.js          PanelState: one refresh = status + accessories + sensors + logs
src/sector/connection.js     connection status messages + "Test the connection"
src/devices/alarmPanel.js    panel device: `text`/`select` mode feature, transport badge
src/devices/accessories.js   lock, plug and sensor devices
src/devices/index.js         discovery, states, transports, commands (setAlarmMode, runCommand)
src/capabilities/scenes.js   scene triggers (fired on transitions) + scene actions
src/capabilities/widget.js   "Sector Alarm" dashboard widget + its button actions
docs/{en,fr,de,es}.md        user documentation, re-hosted by Gladys (kept in sync)
test/helpers/fakeSector.js   fake Sector Alarm API (a `fetch`), no network in tests
test/helpers/setup.js        the integration on the SDK fake Gladys + the fake API
```

### Invariants worth knowing

- **External ids are forever**: `panel:<panelId>`, `lock:<panelId>-<serial>`,
  `plug:<panelId>-<serial>`, `sensor:<panelId>-<serial>`, built with
  `gladys.externalIds()`. A serial is only unique within a panel. Feature keys
  (`mode`, `lock`, `power`, `opening`, `smoke`, `leak`, `temperature`, `humidity`,
  `battery-low`), trigger, action and widget keys are stored by users: never rename them.
- **No Gladys polling**: devices are published WITHOUT `poll_frequency`. The integration
  reads each panel as a whole on its own timer (`poll_frequency` config, seconds, 30 to 3600) and publishes with `publishChangedStates` (30 min heartbeat). One `onPoll` per
  device would multiply the API calls, and Sector Alarm rate-limits (HTTP 429 → backoff).
- **Gladys value conventions**: opening-sensor 1 = closed / 0 = open; lock 1 = locked;
  smoke / leak / battery-low 1 = detected. The alarm mode is a `text`/`select` feature
  whose state is a string (`disarmed`, `partial`, `armed`) published as `{ text }`.
- **Offline panels report "armed"**: while `IsOnline` is false the mode read is ignored
  and the last known mode kept.
- **Transitions, not snapshots**: `PanelState.reportedMode` (what Sector last reported)
  drives `alarm_mode_changed`, so an order from Gladys fires it too once confirmed, while
  `mode` is updated at once for display. The first refresh after a start fires nothing;
  log records older than the cursor are never replayed.
- **House check routes** answering 404/400 are dropped for the panel's lifetime; legacy
  panels (`UseLegacyHomeScreen`) only have `GetTemperatures`.
- **Secrets**: never log the password, the panel code or the token; the email is logged
  masked (`maskEmail`). The widget's Disarm button never uses the stored code: it asks
  for it in a form every time. Arming is allowed with the stored code behind `confirm`.
- **Scene actions never fail on a refused order**: `set_alarm_mode` returns
  `{ applied: false, error }`; the scene author gates on the output.

### Manifest

`test/manifest.test.js` keeps `gladys-assistant-integration.json` (config schema,
actions, widget, scene declarations, `keywords`, categories, `transports: ["cloud"]`,
`gladys_version >=5.3.0`, every text in en/fr/de/es, store length limits) in sync with
`DEFAULT_CONFIG`, the handlers and the docs.

## Rules

- **Versions belong to the Release workflow.** Never edit `version` in `package.json` or
  the manifest, nor the `docker_image` tag, by hand — except on the hand-pushed tag path
  (`git tag vX.Y.Z`), which needs all three bumped together first.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]` in
  `CHANGELOG.md` (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`). Never write a
  version heading: the Release workflow does.
- **User-facing text** is `{ en, fr, de, es }`: manifest texts, action answers, connection
  status, widget content, and `docs/*.md`, kept in sync.
- **The container rootfs is read-only**: write only under `/data` (nothing is written
  today).
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why, in English.
  Tests never touch the network: extend `test/helpers/fakeSector.js` instead.
