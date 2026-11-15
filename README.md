# Gladys Sector Alarm

External integration for [Gladys Assistant](https://gladysassistant.com) that
connects your **Sector Alarm** home alarm system, through the Sector Alarm
cloud.

- **Alarm panel**: disarmed, partially armed, armed — read and set from Gladys.
- **Smart locks**: lock / unlock, battery low.
- **Smart plugs**: on / off.
- **Sensors**: doors and windows, smoke, water leaks, temperature, humidity,
  battery low.
- **Dashboard widget** "Sector Alarm": mode, connection, open doors and
  windows, unlocked locks, alerts; Arm / Partial / Disarm / Refresh buttons
  (Disarm always asks for the code).
- **Scene triggers**: `alarm_mode_changed`, `panel_connection_changed`,
  `lock_operated` — with who did it and how, from the Sector Alarm event log.
- **Scene actions**: `set_alarm_mode`, `refresh_now`.
- English, French, German and Spanish.

Transport: **cloud** (Sector Alarm has no local API). Requires **Gladys 5.3+**.

User documentation: [English](docs/en.md) · [Français](docs/fr.md) ·
[Deutsch](docs/de.md) · [Español](docs/es.md).

> This project is not affiliated with Sector Alarm. It uses the same API as
> the Sector Alarm mobile app, which is not documented and may change.

## Project structure

```
.
├─ index.js                          # SDK bootstrap (no logic)
├─ src/
│  ├─ integration.js                 # SDK handlers, refresh timer, publishing
│  ├─ config.js                      # config defaults + normalization
│  ├─ i18n.js                        # en / fr / de / es helpers
│  ├─ sector/                        # Sector Alarm API: client, parsers, panel state
│  ├─ devices/                       # panel, lock, plug and sensor devices
│  └─ capabilities/                  # scene triggers/actions, dashboard widget
├─ docs/                             # user documentation (en, fr, de, es)
├─ test/                             # node --test, fake Gladys + fake Sector Alarm
├─ gladys-assistant-integration.json # manifest
├─ Dockerfile                        # Node 24 Alpine, read-only rootfs ready
├─ CHANGELOG.md                      # Keep a Changelog, rolled by the Release workflow
├─ CLAUDE.md                         # project rules for coding assistants & contributors
├─ SECURITY.md                       # how to report a vulnerability privately
└─ .github/                          # CI, Release, build, GitHub releases, Dependabot
```

## Development

```bash
npm install
npm run format:check
npm run lint
npm test
```

Run it against a Gladys instance:

```bash
GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="sector-alarm" \
LOG_LEVEL=debug \
npm start
```

The tests never touch the network: they run the integration on the SDK's fake
Gladys (`@gladysassistant/integration-sdk/testing`) and on a fake Sector Alarm
API (`test/helpers/fakeSector.js`).

Check the store admission rules locally:

```bash
npx github:GladysAssistant/integration-store .
```

## Releasing

1. Describe the changes under `## [Unreleased]` in [`CHANGELOG.md`](CHANGELOG.md).
2. **Actions → Release → Run workflow**, pick `patch`, `minor` or `major`.

The workflow bumps the version everywhere (`package.json`, manifest `version`
and `docker_image`), rolls the changelog, pushes the `vX.Y.Z` tag, builds the
`linux/amd64` + `linux/arm64` image to `ghcr.io/prohand/gladys-sectoralarm`
(`:X.Y.Z` and `:latest`), publishes the GitHub Release and runs the store
checks.

The very first version (1.0.0) is already written in `package.json` and the
manifest: publish it with a hand-pushed tag, which triggers the same build and
GitHub Release:

```bash
git tag v1.0.0 && git push origin v1.0.0
```

Then add the GitHub topic `gladys-assistant-integration` to the repository and
turn on **Private vulnerability reporting** (see [`SECURITY.md`](SECURITY.md)).

## License

Apache-2.0
