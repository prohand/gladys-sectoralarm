# Sector Alarm

This integration connects Gladys to your **Sector Alarm** home alarm system:
arm and disarm the panel, lock and unlock the smart locks, switch the smart
plugs, and follow the sensors (doors and windows, smoke, water leaks,
temperature, humidity).

## Before you start

- **Gladys 5.3 or later** is required.
- A **Sector Alarm account**: the email and password you use in the Sector
  Alarm mobile app.
- Gladys needs **internet access**. Sector Alarm has no local API: everything
  goes through the Sector Alarm cloud (`mypagesapi.sectoralarm.net`). That is
  why the integration is tagged **cloud**.

## Configuration

| Field                    | What to put in it                                                                                                          |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| **Email**                | The email of your Sector Alarm account.                                                                                    |
| **Password**             | Its password. Stored as a secret, never written to the logs.                                                               |
| **Panel code**           | The code you type on the keypad. Optional, see below.                                                                      |
| **Panel id**             | Empty to follow every panel of the account. Otherwise one id, or several separated by commas.                              |
| **Refresh interval (s)** | How often Sector Alarm is read. 60 s by default, 30 s minimum. Sector Alarm limits requests: below a minute brings little. |

Save, then click **Test the connection**: the answer lists the panels found,
their mode, whether they are online and how many accessories they have. Then
open the **Discovery** tab of the integration and create the devices you want.

### The panel code

The code is **only** needed to:

- disarm the alarm from Gladys (a scene, the device card);
- lock or unlock a smart lock;
- arm a panel whose **quick arm** is turned off.

Without a code, Gladys can still read everything and arm a panel that has quick
arm on. Leave it empty if you do not want Gladys to be able to disarm.

## Devices

| Device in Gladys           | Features                                              | Values                         |
| -------------------------- | ----------------------------------------------------- | ------------------------------ |
| **Panel** (one per panel)  | Alarm mode (a list: Disarmed, Partially armed, Armed) | `disarmed`, `partial`, `armed` |
| **Smart lock**             | Lock (controllable), Battery low                      | 1 = locked, 0 = unlocked       |
| **Smart plug**             | Power (controllable)                                  | 1 = on, 0 = off                |
| **Door / window sensor**   | Opening, Battery low                                  | 1 = closed, 0 = open           |
| **Smoke detector**         | Smoke, often Temperature                              | 1 = smoke detected             |
| **Leakage detector**       | Water leak                                            | 1 = leak detected              |
| **Temperature / humidity** | Temperature (°C), Humidity (%)                        |                                |

"Partially armed" only appears on a panel that supports it. Each device shows a
**cloud** badge; it turns **unreachable** when the panel is offline or when
Sector Alarm does not answer.

Gladys does not poll the devices one by one: the integration reads each panel
as a whole, at the refresh interval, and only sends Gladys the values that
changed. After an order, the panel is read again a few seconds later to confirm.

## Dashboard widget

Add the **Sector Alarm** widget to a dashboard. It shows:

- the alarm mode (red armed, orange partially armed, green disarmed);
- the connection of the panel;
- the doors and windows left open, the locks left unlocked;
- a smoke or water alert.

Its buttons: **Arm** and **Partial** (with a confirmation), **Disarm**,
**Refresh**.

> **Security.** A dashboard can hang on a wall, and anyone can tap it. The
> **Disarm** button therefore **never** uses the code of the configuration: it
> opens a small form where the code must be typed every time.

With several panels, pick the one to show in the widget settings.

## Scenes

### Triggers

| Trigger                                | Key                        | Filters             | Variables                                                                    |
| -------------------------------------- | -------------------------- | ------------------- | ---------------------------------------------------------------------------- |
| **The alarm mode changes**             | `alarm_mode_changed`       | Panel, New mode     | `mode`, `previous_mode`, `panel_name`, `user`, `channel`                     |
| **A panel goes offline or comes back** | `panel_connection_changed` | Panel, Connection   | `state` (`offline` / `online`), `panel_name`                                 |
| **A smart lock is used**               | `lock_operated`            | Lock, What happened | `action` (`lock` / `unlock` / `lock_failed`), `lock_name`, `user`, `channel` |

`user` and `channel` come from the Sector Alarm event log (who, and with what:
keypad, app, tag…); they are empty when the log does not say.

The triggers fire on **changes** seen between two refreshes, from wherever they
come (keypad, app, tag or Gladys). Nothing fires for the first read after a
start: the history is not news. A change that comes and goes between two
refreshes may be missed: lower the refresh interval if that matters.

Examples:

- _When the alarm is disarmed, if nobody is home, send me a notification with
  `{{triggerEvent.data.user}}`._
- _When the panel goes offline, send a message._
- _When the front door is unlocked, turn on the hall light._

### Actions

| Action                    | Key              | Fields           | Outputs                             |
| ------------------------- | ---------------- | ---------------- | ----------------------------------- |
| **Set the alarm mode**    | `set_alarm_mode` | Panel, Mode      | `applied` (yes/no), `mode`, `error` |
| **Read Sector Alarm now** | `refresh_now`    | Panel (optional) | `mode`, `online`                    |

`set_alarm_mode` uses the panel code of the configuration. A refused order does
not stop the scene: check `applied` in a condition, and use `error` in a
notification. Example: _at 11 pm, arm the alarm partially; if `applied` is no,
send me `error`._

The standard Gladys actions also drive the devices: the alarm mode, the locks
and the plugs can be set with **Control a device**.

## Buttons of the configuration screen

- **Test the connection**: logs in again and reads every panel.
- **Refresh now**: reads Sector Alarm without waiting.

## Troubleshooting

| What you see                                     | What to do                                                                                                                      |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| "Sector Alarm refused the email or the password" | Check them in the Sector Alarm app, then save again.                                                                            |
| "Sector Alarm asks to slow down"                 | Sector Alarm limits requests. The integration waits longer between reads, then goes back to normal. Raise the refresh interval. |
| "Sector Alarm cannot be reached"                 | Check the internet access of Gladys.                                                                                            |
| "The panel code is required…"                    | Fill in the panel code, or arm only with quick arm.                                                                             |
| A sensor is missing                              | Click **Refresh now**, then look at the **Discovery** tab: a new accessory appears there.                                       |
| The mode is stuck while the panel is offline     | On purpose: an offline panel reports "armed" whatever it is, so Gladys keeps the last known mode.                               |

## Privacy

Your email, password and panel code stay in Gladys, as secrets, and are sent
only to Sector Alarm (`mypagesapi.sectoralarm.net`). The integration does not
use any other service.

This integration is not made by, nor endorsed by, Sector Alarm. It uses the
same API as the Sector Alarm app, which may change without notice.
