# Changelog

All notable changes to this integration are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/), bumped by the Release workflow.

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.0] - 2026-11-15

First release.

### Added

- Sector Alarm account (email, password) read through the Sector Alarm cloud API;
  every panel of the account, or only the ones chosen by id.
- Panel device: alarm mode (disarmed, partially armed, armed) shown and set from
  Gladys; partial mode only on panels that support it.
- Smart locks (lock / unlock, battery low), smart plugs (on / off).
- Sensors: doors and windows, smoke, water leaks, temperature, humidity, battery low.
- Cloud transport badge on every device: `unreachable` while the panel is offline
  or Sector Alarm does not answer.
- Dashboard widget "Sector Alarm": mode, connection, open doors and windows,
  unlocked locks, smoke and water alerts; Arm, Partial, Disarm and Refresh buttons.
- Scene triggers: `alarm_mode_changed` (with who and how, from the event log),
  `panel_connection_changed`, `lock_operated`.
- Scene actions: `set_alarm_mode`, `refresh_now`.
- Configuration buttons: Test the connection, Refresh now.
- English, French, German and Spanish for every text and the documentation.

### Security

- The password and the panel code are secret fields, never logged; the email is
  logged masked.
- The Disarm button of the dashboard widget never uses the stored code: it asks
  for the code every time.

[Unreleased]: https://github.com/prohand/gladys-sectoralarm/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/prohand/gladys-sectoralarm/releases/tag/v1.0.0
