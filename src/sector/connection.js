// -----------------------------------------------------------------------------
// What the Configuration screen says about the link to Sector Alarm: the
// connection status, and the answer of the "Test the connection" button.
// Every text is { en, fr, de, es }.
// -----------------------------------------------------------------------------

import { hasCredentials } from '../config.js';
import { localize, pick } from '../i18n.js';
import { ERROR_CODES } from './client.js';
import { listPanels, PanelState } from './panel.js';

/** A failure, said the way a user can act on it. */
export function describeError(err) {
  switch (err?.code) {
    case ERROR_CODES.NOT_CONFIGURED:
      return {
        en: 'Fill in the email and the password of your Sector Alarm account.',
        fr: 'Renseignez l’e-mail et le mot de passe de votre compte Sector Alarm.',
        de: 'Gib die E-Mail-Adresse und das Passwort deines Sector-Alarm-Kontos ein.',
        es: 'Indique el correo y la contraseña de su cuenta Sector Alarm.',
      };
    case ERROR_CODES.LOGIN:
      return {
        en: 'Sector Alarm refused the email or the password: check them (the ones of the Sector Alarm app).',
        fr: 'Sector Alarm refuse l’e-mail ou le mot de passe : vérifiez-les (ce sont ceux de l’application Sector Alarm).',
        de: 'Sector Alarm lehnt E-Mail oder Passwort ab: Prüfe sie (es sind die der Sector-Alarm-App).',
        es: 'Sector Alarm rechaza el correo o la contraseña: compruébelos (son los de la app Sector Alarm).',
      };
    case ERROR_CODES.RATE_LIMIT:
      return {
        en: 'Sector Alarm asks to slow down (too many requests): the integration waits and tries again.',
        fr: 'Sector Alarm demande de ralentir (trop de requêtes) : l’intégration patiente et réessaie.',
        de: 'Sector Alarm bittet um weniger Anfragen: Die Integration wartet und versucht es erneut.',
        es: 'Sector Alarm pide reducir el ritmo (demasiadas peticiones): la integración espera y vuelve a intentarlo.',
      };
    case ERROR_CODES.NETWORK:
      return {
        en: 'Sector Alarm cannot be reached: check the internet access of Gladys.',
        fr: 'Sector Alarm est injoignable : vérifiez l’accès à Internet de Gladys.',
        de: 'Sector Alarm ist nicht erreichbar: Prüfe den Internetzugang von Gladys.',
        es: 'No se puede contactar con Sector Alarm: compruebe el acceso a Internet de Gladys.',
      };
    case ERROR_CODES.CODE_REQUIRED:
      return {
        en: 'This order needs the panel code: fill it in the configuration.',
        fr: 'Cet ordre demande le code de la centrale : renseignez-le dans la configuration.',
        de: 'Dieser Befehl braucht den Code der Zentrale: Trage ihn in der Konfiguration ein.',
        es: 'Esta orden necesita el código de la central: indíquelo en la configuración.',
      };
    case ERROR_CODES.REFUSED:
      return {
        en: 'Sector Alarm refused the order: check the panel code.',
        fr: 'Sector Alarm a refusé l’ordre : vérifiez le code de la centrale.',
        de: 'Sector Alarm hat den Befehl abgelehnt: Prüfe den Code der Zentrale.',
        es: 'Sector Alarm ha rechazado la orden: compruebe el código de la central.',
      };
    default:
      return localize((language) =>
        pick(language, {
          en: `Sector Alarm error: ${err?.message ?? err}`,
          fr: `Erreur Sector Alarm : ${err?.message ?? err}`,
          de: `Sector-Alarm-Fehler: ${err?.message ?? err}`,
          es: `Error de Sector Alarm: ${err?.message ?? err}`,
        }),
      );
  }
}

const MODE_NAMES = {
  armed: { en: 'armed', fr: 'armée', de: 'scharf', es: 'armada' },
  partial: {
    en: 'partially armed',
    fr: 'armée partiellement',
    de: 'teilweise scharf',
    es: 'armada parcial',
  },
  disarmed: { en: 'disarmed', fr: 'désarmée', de: 'unscharf', es: 'desarmada' },
};

/** One line per panel, in one language. */
function panelLine(language, panel) {
  const mode =
    MODE_NAMES[panel.mode]?.[language] ??
    pick(language, {
      en: 'mode unknown',
      fr: 'mode inconnu',
      de: 'Modus unbekannt',
      es: 'modo desconocido',
    });
  const online =
    panel.online === false
      ? pick(language, { en: 'offline', fr: 'hors ligne', de: 'offline', es: 'sin conexión' })
      : pick(language, { en: 'online', fr: 'en ligne', de: 'online', es: 'en línea' });
  const accessories = panel.locks.size + panel.plugs.size + panel.sensors.size;
  const devices = pick(language, {
    en: `${accessories} accessor${accessories === 1 ? 'y' : 'ies'}`,
    fr: `${accessories} accessoire${accessories > 1 ? 's' : ''}`,
    de: `${accessories} Zubehör`,
    es: `${accessories} accesorio${accessories === 1 ? '' : 's'}`,
  });
  return `${panel.name} (${panel.id}): ${mode}, ${online}, ${devices}`;
}

/**
 * The "Test the connection" button: log in again from scratch, list the
 * panels and read each one, as a fresh start would.
 */
export async function testConnection(client, config) {
  if (!hasCredentials(config)) {
    return describeError({ code: ERROR_CODES.NOT_CONFIGURED });
  }
  try {
    client.invalidateToken();
    const panels = [];
    for (const { id, name } of await listPanels(client, config)) {
      const panel = new PanelState({ id, name });
      await panel.refresh(client);
      panels.push(panel);
    }
    if (panels.length === 0) {
      return {
        en: 'Connected, but this account has no panel.',
        fr: 'Connecté, mais ce compte n’a aucune centrale.',
        de: 'Verbunden, aber dieses Konto hat keine Zentrale.',
        es: 'Conectado, pero esta cuenta no tiene ninguna central.',
      };
    }
    return localize((language) =>
      [
        pick(language, {
          en: `Connected to Sector Alarm, ${panels.length} panel(s):`,
          fr: `Connecté à Sector Alarm, ${panels.length} centrale(s) :`,
          de: `Mit Sector Alarm verbunden, ${panels.length} Zentrale(n):`,
          es: `Conectado a Sector Alarm, ${panels.length} central(es):`,
        }),
        ...panels.map((panel) => `- ${panelLine(language, panel)}`),
      ].join('\n'),
    );
  } catch (err) {
    return describeError(err);
  }
}
