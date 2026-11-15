// -----------------------------------------------------------------------------
// Dashboard widget "Sector Alarm" (Gladys 5.1+).
//
// What the panel is doing at a glance — its mode, whether it is online, the
// doors and windows left open, the locks left unlocked, a smoke or water alert
// — and buttons to arm, partially arm, disarm and refresh.
//
// Security: a dashboard may hang on a wall, and the user tapping it is
// anonymous. Arming uses the code of the configuration (it only makes the
// house safer) behind a confirmation; DISARMING never does: the button opens
// a form where the code must be typed, every time.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { ALARM_MODES, SENSOR_VALUES } from '../sector/parse.js';
import { modesOf } from '../devices/alarmPanel.js';
import { findPanel, setAlarmMode } from '../devices/index.js';

export const ALARM_WIDGET = 'sector_alarm';

export const WIDGET_ACTIONS = {
  ARM: 'arm',
  PARTIAL: 'partial',
  DISARM: 'disarm',
  REFRESH: 'refresh',
};

const MODE_STATUS = {
  [ALARM_MODES.ARMED]: {
    value: { en: 'Armed', fr: 'Armée', de: 'Scharf', es: 'Armada' },
    color: WIDGET_COLORS.DANGER,
  },
  [ALARM_MODES.PARTIAL]: {
    value: {
      en: 'Partially armed',
      fr: 'Partiellement armée',
      de: 'Teilweise scharf',
      es: 'Armada parcial',
    },
    color: WIDGET_COLORS.WARNING,
  },
  [ALARM_MODES.DISARMED]: {
    value: { en: 'Disarmed', fr: 'Désarmée', de: 'Unscharf', es: 'Desarmada' },
    color: WIDGET_COLORS.SUCCESS,
  },
};

const UNKNOWN = { en: 'Unknown', fr: 'Inconnu', de: 'Unbekannt', es: 'Desconocido' };

/** The panel a widget instance shows: the one of its setting, or the first. */
export function widgetPanel(gladys, panels, settings) {
  if (settings?.device) {
    const panel = findPanel(gladys, panels, settings.device);
    if (panel) {
      return panel;
    }
  }
  return panels[0] ?? null;
}

function count(items, predicate) {
  return [...items].filter(predicate).length;
}

/** The status rows of one panel. */
function statusItems(panel) {
  const items = [];
  const mode = MODE_STATUS[panel.mode];
  items.push({
    label: { en: 'Alarm', fr: 'Alarme', de: 'Alarm', es: 'Alarma' },
    icon: 'shield',
    value: mode?.value ?? UNKNOWN,
    color: mode?.color ?? WIDGET_COLORS.NEUTRAL,
  });

  const reachable = panel.online !== false && panel.reachable !== false;
  items.push({
    label: { en: 'Connection', fr: 'Connexion', de: 'Verbindung', es: 'Conexión' },
    icon: reachable ? 'wifi' : 'wifi-off',
    value: reachable
      ? { en: 'Online', fr: 'En ligne', de: 'Online', es: 'En línea' }
      : { en: 'Offline', fr: 'Hors ligne', de: 'Offline', es: 'Sin conexión' },
    color: reachable ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.DANGER,
  });

  const sensors = [...panel.sensors.values()];
  const openings = sensors.filter((s) => SENSOR_VALUES.CLOSED in s.values);
  if (openings.length > 0) {
    const open = count(openings, (s) => s.values[SENSOR_VALUES.CLOSED] === false);
    items.push({
      label: {
        en: 'Doors & windows',
        fr: 'Portes et fenêtres',
        de: 'Türen & Fenster',
        es: 'Puertas y ventanas',
      },
      icon: 'square',
      value:
        open === 0
          ? { en: 'All closed', fr: 'Tout est fermé', de: 'Alles zu', es: 'Todo cerrado' }
          : {
              en: `${open} open`,
              fr: `${open} ouverte${open > 1 ? 's' : ''}`,
              de: `${open} offen`,
              es: `${open} abierta${open > 1 ? 's' : ''}`,
            },
      color: open === 0 ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.WARNING,
    });
  }

  const locks = [...panel.locks.values()].filter((lock) => lock.locked !== null);
  if (locks.length > 0) {
    const unlocked = count(locks, (lock) => lock.locked === false);
    items.push({
      label: { en: 'Locks', fr: 'Serrures', de: 'Schlösser', es: 'Cerraduras' },
      icon: unlocked === 0 ? 'lock' : 'unlock',
      value:
        unlocked === 0
          ? {
              en: 'All locked',
              fr: 'Tout est verrouillé',
              de: 'Alle verriegelt',
              es: 'Todo cerrado',
            }
          : {
              en: `${unlocked} unlocked`,
              fr: `${unlocked} déverrouillée${unlocked > 1 ? 's' : ''}`,
              de: `${unlocked} entriegelt`,
              es: `${unlocked} abierta${unlocked > 1 ? 's' : ''}`,
            },
      color: unlocked === 0 ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.WARNING,
    });
  }

  const smoke = count(sensors, (s) => s.values[SENSOR_VALUES.SMOKE] === true);
  const leak = count(sensors, (s) => s.values[SENSOR_VALUES.LEAK] === true);
  const detectors = sensors.filter(
    (s) => SENSOR_VALUES.SMOKE in s.values || SENSOR_VALUES.LEAK in s.values,
  );
  if (detectors.length > 0) {
    let value = { en: 'None', fr: 'Aucune', de: 'Keine', es: 'Ninguna' };
    if (smoke > 0 && leak > 0) {
      value = { en: 'Smoke & water', fr: 'Fumée et eau', de: 'Rauch & Wasser', es: 'Humo y agua' };
    } else if (smoke > 0) {
      value = { en: 'Smoke!', fr: 'Fumée !', de: 'Rauch!', es: '¡Humo!' };
    } else if (leak > 0) {
      value = { en: 'Water leak!', fr: "Fuite d'eau !", de: 'Wasserleck!', es: '¡Fuga de agua!' };
    }
    items.push({
      label: { en: 'Alerts', fr: 'Alertes', de: 'Warnungen', es: 'Alertas' },
      icon: 'alert-triangle',
      value,
      color: smoke + leak > 0 ? WIDGET_COLORS.DANGER : WIDGET_COLORS.SUCCESS,
    });
  }
  return items;
}

/**
 * The content of the widget.
 *
 * @param {object} gladys the SDK client
 * @param {Array<object>} panels the panels known right now
 * @param {object} [settings] the widget instance settings
 */
export function buildAlarmWidget(gladys, panels, settings = {}) {
  const panel = widgetPanel(gladys, panels, settings);
  if (!panel) {
    return {
      ttl_seconds: 60,
      components: [
        {
          type: 'text',
          variant: 'body',
          text: {
            en: 'No Sector Alarm panel yet: check the email and password in the integration configuration.',
            fr: "Aucune centrale Sector Alarm pour l'instant : vérifiez l'e-mail et le mot de passe dans la configuration de l'intégration.",
            de: 'Noch keine Sector-Alarm-Zentrale: Prüfe E-Mail und Passwort in der Konfiguration der Integration.',
            es: 'Todavía no hay ninguna central Sector Alarm: compruebe el correo y la contraseña en la configuración de la integración.',
          },
        },
      ],
    };
  }

  const params = { panel: panel.id };
  const buttons = [
    {
      type: 'button',
      label: { en: 'Arm', fr: 'Armer', de: 'Scharf schalten', es: 'Armar' },
      icon: 'shield',
      style: 'danger',
      action: { key: WIDGET_ACTIONS.ARM, params, confirm: true },
    },
  ];
  if (modesOf(panel).includes(ALARM_MODES.PARTIAL)) {
    buttons.push({
      type: 'button',
      label: { en: 'Partial', fr: 'Partiel', de: 'Teilweise', es: 'Parcial' },
      icon: 'home',
      style: 'secondary',
      action: { key: WIDGET_ACTIONS.PARTIAL, params, confirm: true },
    });
  }
  buttons.push(
    {
      type: 'button',
      label: { en: 'Disarm', fr: 'Désarmer', de: 'Unscharf schalten', es: 'Desarmar' },
      icon: 'shield-off',
      style: 'primary',
      action: {
        key: WIDGET_ACTIONS.DISARM,
        params,
        fields: [
          {
            key: 'code',
            type: 'string',
            label: {
              en: 'Panel code',
              fr: 'Code de la centrale',
              de: 'Zentralen-Code',
              es: 'Código de la central',
            },
            required: true,
          },
        ],
      },
    },
    {
      type: 'button',
      label: { en: 'Refresh', fr: 'Actualiser', de: 'Aktualisieren', es: 'Actualizar' },
      icon: 'refresh-cw',
      style: 'secondary',
      action: { key: WIDGET_ACTIONS.REFRESH, params },
    },
  );

  return {
    // The integration nudges the widget after every refresh that changed
    // something: the TTL is only a safety net.
    ttl_seconds: 120,
    components: [
      { type: 'text', variant: 'heading', text: String(panel.name).slice(0, 40) },
      { type: 'status', items: statusItems(panel) },
      ...buttons,
    ],
  };
}

const MODE_DONE = {
  [ALARM_MODES.ARMED]: {
    en: 'Alarm armed.',
    fr: 'Alarme armée.',
    de: 'Alarm scharf geschaltet.',
    es: 'Alarma armada.',
  },
  [ALARM_MODES.PARTIAL]: {
    en: 'Alarm partially armed.',
    fr: 'Alarme armée partiellement.',
    de: 'Alarm teilweise scharf geschaltet.',
    es: 'Alarma armada parcialmente.',
  },
  [ALARM_MODES.DISARMED]: {
    en: 'Alarm disarmed.',
    fr: 'Alarme désarmée.',
    de: 'Alarm unscharf geschaltet.',
    es: 'Alarma desarmada.',
  },
};

/**
 * Run a tapped button of the widget and answer its toast.
 *
 * `params` are the ones the content declared (never user input); `values` the
 * form of the Disarm button. Throwing shows the error to the user.
 *
 * @param {object} context
 * @param {object} context.gladys
 * @param {Array<object>} context.panels
 * @param {object} context.client
 * @param {object} context.config
 * @param {(panel: object) => Promise<void>} context.refresh
 * @param {(panel: object) => Promise<void>} context.afterOrder
 */
export async function runWidgetAction(context, actionKey, params, values) {
  const { gladys, panels, client, config, refresh, afterOrder } = context;
  const panel =
    panels.find((candidate) => candidate.id === params?.panel) ?? widgetPanel(gladys, panels, {});
  if (!panel) {
    throw new Error('No Sector Alarm panel');
  }
  if (actionKey === WIDGET_ACTIONS.REFRESH) {
    await refresh(panel);
    return { en: 'Refreshed.', fr: 'Actualisé.', de: 'Aktualisiert.', es: 'Actualizado.' };
  }
  const mode = {
    [WIDGET_ACTIONS.ARM]: ALARM_MODES.ARMED,
    [WIDGET_ACTIONS.PARTIAL]: ALARM_MODES.PARTIAL,
    [WIDGET_ACTIONS.DISARM]: ALARM_MODES.DISARMED,
  }[actionKey];
  if (!mode) {
    throw new Error(`Unknown widget action ${actionKey}`);
  }
  // Disarming takes the code typed in the form, never the stored one. A core
  // too old to know widget forms relays no values: refuse, never guess.
  let code = config.panel_code;
  if (mode === ALARM_MODES.DISARMED) {
    code = String(values?.code ?? '').replace(/\s+/g, '');
    if (!code) {
      throw new Error('Type the panel code to disarm');
    }
  }
  await setAlarmMode(client, panel, mode, code);
  await afterOrder(panel);
  return MODE_DONE[mode];
}
