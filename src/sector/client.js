// -----------------------------------------------------------------------------
// Sector Alarm cloud client.
//
// Sector Alarm has no local API: everything goes through the "My pages" API
// its mobile app uses, at https://mypagesapi.sectoralarm.net. The routes and
// payloads below are the ones the app sends (the same the Home Assistant
// community integration relies on). Nothing here is documented by Sector
// Alarm: every answer is read defensively (see src/sector/parse.js).
//
// Authentication: POST /api/Login/Login returns a JWT (`AuthorizationToken`),
// sent as a Bearer token. It is cached until a few seconds before its `exp`,
// and renewed once when the API answers 401/403 anyway.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'sector-client' });

export const API_URL = 'https://mypagesapi.sectoralarm.net';

// The HTTP client of the Android app. Some routes answer differently (or not
// at all) to an unknown client, so the integration presents itself the same way.
const USER_AGENT = 'okhttp/5.1.0';

// The API usually answers in well under a second; a hung request must not
// hold a refresh (or an order the user waits for) forever.
const REQUEST_TIMEOUT_MS = 15_000;

// Renew the token this long before it really expires: a request sent with a
// token that dies on the way is a 401 for nothing.
const TOKEN_MARGIN_MS = 30_000;

/** Why a request failed, as the rest of the code needs to tell. */
export const ERROR_CODES = {
  // The email or the password is refused: nothing will work until the user
  // fixes the configuration.
  LOGIN: 'LOGIN',
  // The account fields are empty.
  NOT_CONFIGURED: 'NOT_CONFIGURED',
  // 401/403 on a data route, even with a fresh token.
  AUTH: 'AUTH',
  // 429: Sector Alarm asks us to slow down.
  RATE_LIMIT: 'RATE_LIMIT',
  // The route does not exist for this panel (404), or not in this shape (400).
  NOT_SUPPORTED: 'NOT_SUPPORTED',
  // Any other HTTP status.
  HTTP: 'HTTP',
  // No answer: DNS, TLS, connection refused, timeout.
  NETWORK: 'NETWORK',
  // An order that needs the keypad code, and no code was configured.
  CODE_REQUIRED: 'CODE_REQUIRED',
  // An order refused with 401/403 even with a fresh token: in practice, a
  // wrong panel code.
  REFUSED: 'REFUSED',
};

export class SectorError extends Error {
  /**
   * @param {string} message
   * @param {{ code: string, status?: number, cause?: unknown }} details
   */
  constructor(message, { code, status, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'SectorError';
    this.code = code;
    this.status = status;
  }
}

/** The payload of a JWT, or null when it cannot be read. */
export function jwtPayload(token) {
  try {
    const [, payload] = String(token).split('.');
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

export class SectorClient {
  /**
   * @param {object} [options]
   * @param {typeof fetch} [options.fetch] injected by the tests
   * @param {() => number} [options.now] injected by the tests
   */
  constructor({ fetch: fetchImpl = globalThis.fetch, now = Date.now } = {}) {
    this.fetch = fetchImpl;
    this.now = now;
    this.email = '';
    this.password = '';
    this.token = null;
    this.tokenExpiresAt = 0;
    this.loginPromise = null;
  }

  /** Apply the account of the configuration; a change drops the token. */
  configure({ email, password }) {
    if (email !== this.email || password !== this.password) {
      this.email = email;
      this.password = password;
      this.invalidateToken();
    }
  }

  invalidateToken() {
    this.token = null;
    this.tokenExpiresAt = 0;
  }

  /** A valid token, logging in when there is none (one login at a time). */
  async getToken() {
    if (this.token && this.now() < this.tokenExpiresAt) {
      return this.token;
    }
    if (!this.loginPromise) {
      this.loginPromise = this.login().finally(() => {
        this.loginPromise = null;
      });
    }
    return this.loginPromise;
  }

  async login() {
    if (!this.email || !this.password) {
      throw new SectorError('Sector Alarm email and password are not configured', {
        code: ERROR_CODES.NOT_CONFIGURED,
      });
    }
    const response = await this.send('POST', '/api/Login/Login', {
      body: { UserId: this.email, Password: this.password },
    });
    if (response.status === 401 || response.status === 403) {
      throw new SectorError('Sector Alarm refused the email or the password', {
        code: ERROR_CODES.LOGIN,
        status: response.status,
      });
    }
    this.throwUnlessOk(response, 'login');
    const token = response.data?.AuthorizationToken;
    if (typeof token !== 'string' || token.length === 0) {
      throw new SectorError('Sector Alarm login answered without a token', {
        code: ERROR_CODES.HTTP,
        status: response.status,
      });
    }
    const exp = jwtPayload(token)?.exp;
    // Without a readable expiry, keep it ten minutes: the 401 path renews it
    // earlier if the API disagrees.
    const expiresAt = Number.isFinite(exp) ? exp * 1000 : this.now() + 10 * 60 * 1000;
    this.token = token;
    this.tokenExpiresAt = expiresAt - TOKEN_MARGIN_MS;
    logger.debug('Logged in to Sector Alarm');
    return token;
  }

  /**
   * One HTTP exchange, no authentication logic. Never throws on a status,
   * only when no answer came back.
   *
   * @returns {Promise<{ status: number, data: unknown }>}
   */
  async send(method, path, { body, token, query } = {}) {
    const url = new URL(path, API_URL);
    for (const [key, value] of Object.entries(query ?? {})) {
      url.searchParams.set(key, String(value));
    }
    const headers = { Accept: 'application/json', 'User-Agent': USER_AGENT };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    let response;
    try {
      response = await this.fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
      throw new SectorError(
        timeout
          ? `Sector Alarm did not answer within ${REQUEST_TIMEOUT_MS / 1000} s (${method} ${url.pathname})`
          : `Sector Alarm is unreachable (${method} ${url.pathname}): ${err?.message ?? err}`,
        { code: ERROR_CODES.NETWORK, cause: err },
      );
    }
    const text = await response.text().catch(() => '');
    let data = text;
    if (text && (response.headers.get('content-type') ?? '').includes('json')) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    } else if (text) {
      // Some routes answer JSON without saying so.
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    return { status: response.status, data };
  }

  /** Throw the error a non-2xx status stands for. */
  throwUnlessOk(response, what) {
    const { status } = response;
    if (status >= 200 && status < 300) {
      return;
    }
    if (status === 429) {
      throw new SectorError(`Sector Alarm asks to slow down (${what}, HTTP 429)`, {
        code: ERROR_CODES.RATE_LIMIT,
        status,
      });
    }
    if (status === 401 || status === 403) {
      throw new SectorError(`Sector Alarm refused the session (${what}, HTTP ${status})`, {
        code: ERROR_CODES.AUTH,
        status,
      });
    }
    if (status === 404 || status === 400) {
      throw new SectorError(`Sector Alarm does not offer ${what} here (HTTP ${status})`, {
        code: ERROR_CODES.NOT_SUPPORTED,
        status,
      });
    }
    throw new SectorError(`Sector Alarm answered HTTP ${status} (${what})`, {
      code: ERROR_CODES.HTTP,
      status,
    });
  }

  /**
   * An authenticated request: the token is renewed once on 401/403, and any
   * other non-2xx status becomes a SectorError.
   */
  async request(method, path, { body, query, what = path } = {}) {
    let response = await this.send(method, path, { body, query, token: await this.getToken() });
    if (response.status === 401 || response.status === 403) {
      this.invalidateToken();
      response = await this.send(method, path, { body, query, token: await this.getToken() });
    }
    this.throwUnlessOk(response, what);
    return response.data;
  }

  // --- Reading -----------------------------------------------------------------

  getPanelList() {
    return this.request('GET', '/api/account/GetPanelList', { what: 'the panel list' });
  }

  getPanel(panelId) {
    return this.request('GET', '/api/Panel/GetPanel', {
      query: { panelId },
      what: 'the panel details',
    });
  }

  getPanelStatus(panelId) {
    return this.request('GET', '/api/panel/GetPanelStatus', {
      query: { panelId },
      what: 'the panel status',
    });
  }

  getLockStatus(panelId) {
    return this.request('GET', '/api/panel/GetLockStatus', {
      query: { panelId },
      what: 'the lock status',
    });
  }

  getSmartplugStatus(panelId) {
    return this.request('GET', '/api/panel/GetSmartplugStatus', {
      query: { panelId },
      what: 'the smart plug status',
    });
  }

  getLegacyTemperatures(panelId) {
    return this.request('GET', '/api/Panel/GetTemperatures', {
      query: { panelId },
      what: 'the temperatures',
    });
  }

  getDoorsAndWindows(panelId) {
    return this.request('POST', '/api/housecheck/doorsandwindows', {
      body: { PanelId: panelId },
      what: 'the doors and windows',
    });
  }

  getHumidity(panelId) {
    return this.request('GET', `/api/housecheck/panels/${encodeURIComponent(panelId)}/humidity`, {
      what: 'the humidity sensors',
    });
  }

  getTemperatures(panelId) {
    return this.request('POST', '/api/v2/housecheck/temperatures', {
      body: { PanelId: panelId },
      what: 'the temperature sensors',
    });
  }

  getLeakageDetectors(panelId) {
    return this.request('POST', '/api/v2/housecheck/leakagedetectors', {
      body: { PanelId: panelId },
      what: 'the leakage detectors',
    });
  }

  getSmokeDetectors(panelId) {
    return this.request('POST', '/api/v2/housecheck/smokedetectors', {
      body: { PanelId: panelId },
      what: 'the smoke detectors',
    });
  }

  getLogs(panelId, pageSize = 10) {
    return this.request('GET', '/api/v2/panel/logs', {
      query: { panelid: panelId, pageNumber: 1, pageSize },
      what: 'the event log',
    });
  }

  // --- Orders ------------------------------------------------------------------

  /**
   * An order: a request whose 401/403 — the token was already renewed once by
   * `request` — means Sector refused the order itself, usually its code.
   */
  async order(method, path, options) {
    try {
      return await this.request(method, path, options);
    } catch (err) {
      if (err?.code === ERROR_CODES.AUTH) {
        throw new SectorError(
          `Sector Alarm refused ${options.what} (HTTP ${err.status}): check the panel code`,
          { code: ERROR_CODES.REFUSED, status: err.status, cause: err },
        );
      }
      throw err;
    }
  }

  /** Full arming. The code is optional when "quick arm" is on. */
  arm(panelId, code) {
    return this.order('POST', '/api/Panel/Arm', {
      body: { PanelId: panelId, ...(code ? { PanelCode: code } : {}) },
      what: 'arming',
    });
  }

  /** Partial arming ("home"). The code is optional when "quick arm" is on. */
  partialArm(panelId, code) {
    return this.order('POST', '/api/Panel/PartialArm', {
      body: { PanelId: panelId, ...(code ? { PanelCode: code } : {}) },
      what: 'partial arming',
    });
  }

  async disarm(panelId, code) {
    requireCode(code, 'disarm the alarm');
    return this.order('POST', '/api/Panel/Disarm', {
      body: { PanelId: panelId, PanelCode: code },
      what: 'disarming',
    });
  }

  async lock(panelId, serial, code) {
    requireCode(code, 'lock a door');
    return this.order('POST', '/api/Panel/Lock', {
      body: { PanelId: panelId, PanelCode: code, LockSerial: serial, SerialNo: serial },
      what: 'locking',
    });
  }

  async unlock(panelId, serial, code) {
    requireCode(code, 'unlock a door');
    return this.order('POST', '/api/Panel/Unlock', {
      body: { PanelId: panelId, PanelCode: code, LockSerial: serial, SerialNo: serial },
      what: 'unlocking',
    });
  }

  setSmartplug(panelId, plugId, on) {
    return this.order('POST', `/api/Panel/${on ? 'TurnOnSmartplug' : 'TurnOffSmartplug'}`, {
      query: { switchId: plugId, panelId },
      what: on ? 'switching the plug on' : 'switching the plug off',
    });
  }
}

function requireCode(code, what) {
  if (!code) {
    throw new SectorError(`The panel code is required to ${what}: fill it in the configuration`, {
      code: ERROR_CODES.CODE_REQUIRED,
    });
  }
}
