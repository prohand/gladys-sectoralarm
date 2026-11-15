// -----------------------------------------------------------------------------
// Integration configuration.
//
// Filled in by the user in Gladys, from the `config_schema` declared in
// `gladys-assistant-integration.json`. The SDK fetches it (`gladys.getConfig()`)
// and notifies every change (`gladys.onConfigUpdated()`).
//
// This module only provides the defaults and normalizes the received object,
// so the rest of the code never deals with `undefined` or with numbers typed
// as strings.
// -----------------------------------------------------------------------------

// Defaults: they MUST stay consistent with the `default` values of the
// manifest `config_schema` (checked by test/manifest.test.js).
export const DEFAULT_CONFIG = {
  email: '',
  password: '',
  // The code typed on the keypad. Needed to disarm and to drive the locks,
  // and to arm when "quick arm" is off on the panel.
  panel_code: '',
  // Empty: every panel of the account. Otherwise one id, or several
  // separated by commas.
  panel_id: '',
  // Seconds between two reads of the Sector Alarm cloud.
  poll_frequency: 60,
};

// Sector Alarm rate-limits its API (HTTP 429): never read faster than this,
// whatever the user typed.
export const MIN_POLL_SECONDS = 30;
export const MAX_POLL_SECONDS = 3600;

/**
 * Merge the user config with the defaults.
 *
 * @param {Record<string, unknown>} raw config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const text = (value) => (typeof value === 'string' ? value.trim() : String(value ?? '').trim());
  const seconds = Number(raw.poll_frequency ?? DEFAULT_CONFIG.poll_frequency);
  return {
    ...DEFAULT_CONFIG,
    email: text(raw.email),
    // A password may legitimately start or end with a space: keep it as typed.
    password: typeof raw.password === 'string' ? raw.password : '',
    // A keypad code is digits only: anything else is a typing slip.
    panel_code: text(raw.panel_code).replace(/\s+/g, ''),
    panel_id: text(raw.panel_id),
    panelIds: text(raw.panel_id)
      .split(/[\s,;]+/)
      .filter(Boolean),
    poll_frequency: Number.isFinite(seconds)
      ? Math.min(MAX_POLL_SECONDS, Math.max(MIN_POLL_SECONDS, Math.round(seconds)))
      : DEFAULT_CONFIG.poll_frequency,
  };
}

/** Whether the account fields are filled in at all. */
export function hasCredentials(config) {
  return Boolean(config.email && config.password);
}

/**
 * The email with its local part masked, for the logs: enough to tell two
 * accounts apart, not enough to be an address.
 */
export function maskEmail(email) {
  const [local, domain] = String(email ?? '').split('@');
  if (!domain) {
    return '***';
  }
  return `${local.slice(0, 1)}***@${domain}`;
}
