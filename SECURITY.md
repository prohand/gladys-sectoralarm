# Security policy

## Supported versions

Only the latest release of the Sector Alarm integration receives security fixes.
Update the integration from the Gladys store before reporting an issue.

| Version      | Supported |
| ------------ | --------- |
| 1.x (latest) | Yes       |
| older        | No        |

## Reporting a vulnerability

Please do **not** open a public issue for a security problem.

Report it privately through GitHub: open the **Security** tab of
[prohand/gladys-sectoralarm](https://github.com/prohand/gladys-sectoralarm/security),
then **Report a vulnerability**.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- any log line that helps (remove emails, passwords, panel codes and tokens first).

You should get a first answer within 7 days. A fix is released as a new version of
the integration, and the advisory is published once users can update.

## Scope

In scope: the code of this repository and the Docker image it publishes — in
particular anything that could leak the Sector Alarm credentials or the panel
code, or let someone disarm the alarm or unlock a door without the code.

Out of scope: Gladys Assistant itself (report to
[GladysAssistant/Gladys](https://github.com/GladysAssistant/Gladys/security)), and
Sector Alarm's own services and API (report to Sector Alarm).

## Good practices for users

- Keep the password and the panel code only in their secret fields.
- Leave the panel code empty if Gladys should never be able to disarm or unlock.
- Protect access to Gladys itself: whoever controls Gladys controls the scenes that
  arm and disarm the alarm.
- Keep Gladys and the integration up to date.
