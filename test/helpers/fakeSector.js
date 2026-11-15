// -----------------------------------------------------------------------------
// A fake Sector Alarm cloud, as a `fetch` implementation: no network in the
// tests. It answers the routes the client uses with the shapes the real API
// returns (see src/sector/parse.js), from a state the tests edit freely, and
// records every request.
// -----------------------------------------------------------------------------

/** A JWT whose payload carries `exp` (seconds), unsigned: only read, never checked. */
export function fakeJwt(exp) {
  const part = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'none' })}.${part({ exp })}.signature`;
}

export const PANEL_ID = '01234567';

/** The state of a typical account: one panel, a lock, a plug and sensors. */
export function defaultAccount() {
  return {
    email: 'user@example.com',
    password: 'secret',
    code: '1234',
    panels: [{ PanelId: PANEL_ID, DisplayName: 'Home' }],
    panel: {
      PanelId: PANEL_ID,
      DisplayName: 'Home',
      PanelCodeLength: 4,
      QuickArmEnabled: true,
      CanPartialArm: true,
      Capabilities: [],
      Locks: [{ Label: 'Front door', Serial: 'LOCK1', Status: 'lock', BatteryLow: false }],
      Smartplugs: [{ Id: '42', Label: 'Lamp', SerialNo: 'PLUG1', Status: 'Off' }],
      Temperatures: [],
    },
    status: { IsOnline: true, Status: 1 },
    locks: [{ Label: 'Front door', Serial: 'LOCK1', Status: 'lock', BatteryLow: false }],
    plugs: [{ Id: '42', Label: 'Lamp', SerialNo: 'PLUG1', Status: 'Off' }],
    doors: {
      Floors: [
        {
          Rooms: [
            {
              Devices: [
                { SerialString: 'DOOR1', Label: 'Garden door', Closed: true, LowBattery: false },
              ],
            },
          ],
        },
      ],
    },
    humidity: {
      Sections: [
        { Places: [{ Components: [{ SerialNo: 'CLIM1', Label: 'Hall', Humidity: 45 }] }] },
      ],
    },
    temperatures: {
      Sections: [
        { Places: [{ Components: [{ SerialNo: 'CLIM1', Label: 'Hall', Temperature: '21.5' }] }] },
      ],
    },
    leak: {
      Floors: [
        { Rooms: [{ Devices: [{ SerialString: 'LEAK1', Label: 'Kitchen', Alarm: false }] }] },
      ],
    },
    smoke: {
      Floors: [
        {
          Rooms: [
            {
              Devices: [
                { SerialString: 'SMOKE1', Label: 'Living room', Alarm: false, Temperature: 20 },
              ],
            },
          ],
        },
      ],
    },
    logs: {
      Records: [
        {
          User: 'Ann',
          Channel: 'App',
          Time: '2026-11-01T10:00:00Z',
          EventType: 'disarmed',
          LockName: '',
        },
      ],
    },
    // Per-route overrides: { 'GET /api/panel/GetPanelStatus': 429 } answers that status.
    failures: {},
  };
}

/**
 * @param {ReturnType<typeof defaultAccount>} [account]
 * @param {{ now?: () => number }} [options]
 */
export function createFakeSector(account = defaultAccount(), { now = Date.now } = {}) {
  const requests = [];
  let tokenSerial = 0;
  const validTokens = new Set();

  const json = (status, body) =>
    new Response(body === undefined || status === 204 ? null : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });

  async function fetch(url, init = {}) {
    const target = new URL(url);
    const method = init.method ?? 'GET';
    const route = `${method} ${target.pathname}`;
    const body = init.body ? JSON.parse(init.body) : undefined;
    const auth = init.headers?.Authorization ?? null;
    requests.push({ route, query: Object.fromEntries(target.searchParams), body, auth });

    if (account.unreachable) {
      throw new TypeError('fetch failed');
    }
    const failure = account.failures[route];
    if (failure) {
      return json(failure, { Message: `forced ${failure}` });
    }

    if (route === 'POST /api/Login/Login') {
      if (body?.UserId !== account.email || body?.Password !== account.password) {
        return json(401, { Message: 'Unauthorized' });
      }
      tokenSerial += 1;
      const token = `${fakeJwt(Math.floor(now() / 1000) + 3600)}${tokenSerial}`;
      validTokens.add(token);
      return json(200, { AuthorizationToken: token });
    }
    if (!auth || !validTokens.has(auth.replace(/^Bearer /, ''))) {
      return json(401, { Message: 'Unauthorized' });
    }
    const panelId = target.searchParams.get('panelId') ?? target.searchParams.get('panelid');
    const wrongPanel = (id) => id !== undefined && id !== null && id !== account.panel.PanelId;

    switch (route) {
      case 'GET /api/account/GetPanelList':
        return json(200, account.panels);
      case 'GET /api/Panel/GetPanel':
        return wrongPanel(panelId) ? json(404) : json(200, account.panel);
      case 'GET /api/panel/GetPanelStatus':
        return json(200, account.status);
      case 'GET /api/panel/GetLockStatus':
        return json(200, account.locks);
      case 'GET /api/panel/GetSmartplugStatus':
        return json(200, account.plugs);
      case 'GET /api/Panel/GetTemperatures':
        return json(200, account.panel.Temperatures);
      case 'POST /api/housecheck/doorsandwindows':
        return account.doors ? json(200, account.doors) : json(404);
      case `GET /api/housecheck/panels/${account.panel.PanelId}/humidity`:
        return account.humidity ? json(200, account.humidity) : json(404);
      case 'POST /api/v2/housecheck/temperatures':
        return account.temperatures ? json(200, account.temperatures) : json(404);
      case 'POST /api/v2/housecheck/leakagedetectors':
        return account.leak ? json(200, account.leak) : json(404);
      case 'POST /api/v2/housecheck/smokedetectors':
        return account.smoke ? json(200, account.smoke) : json(404);
      case 'GET /api/v2/panel/logs':
        return json(200, account.logs);
      case 'POST /api/Panel/Arm':
      case 'POST /api/Panel/PartialArm': {
        if (!account.panel.QuickArmEnabled && body?.PanelCode !== account.code) {
          return json(403, { Message: 'Wrong code' });
        }
        account.status.Status = route.endsWith('PartialArm') ? 2 : 3;
        return json(204);
      }
      case 'POST /api/Panel/Disarm':
        if (body?.PanelCode !== account.code) {
          return json(403, { Message: 'Wrong code' });
        }
        account.status.Status = 1;
        return json(204);
      case 'POST /api/Panel/Lock':
      case 'POST /api/Panel/Unlock': {
        if (body?.PanelCode !== account.code) {
          return json(403, { Message: 'Wrong code' });
        }
        const lock = account.locks.find((item) => item.Serial === body.LockSerial);
        if (!lock) {
          return json(404);
        }
        lock.Status = route.endsWith('Unlock') ? 'unlock' : 'lock';
        return json(204);
      }
      case 'POST /api/Panel/TurnOnSmartplug':
      case 'POST /api/Panel/TurnOffSmartplug': {
        const plug = account.plugs.find((item) => item.Id === target.searchParams.get('switchId'));
        if (!plug) {
          return json(404);
        }
        plug.Status = route.endsWith('TurnOnSmartplug') ? 'On' : 'Off';
        return json(204);
      }
      default:
        return json(404, { Message: `No route ${route}` });
    }
  }

  return { fetch, requests, account };
}
