// -----------------------------------------------------------------------------
// Device type: ALARM PANEL
//
// One Gladys device per Sector Alarm panel, carrying its mode as a `text` /
// `select` feature: disarmed, partial (the "home" mode) and armed. Gladys has
// no generic "alarm panel" category; a select is what lets the dashboard show
// the mode AND change it, with the choices this very panel offers (no partial
// mode on a panel that cannot do it).
//
// Whether the panel is reachable is not a feature: it is the transport badge
// (`cloud` online, `unreachable` offline), shown on every device card.
// -----------------------------------------------------------------------------

import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk';
import { ALARM_MODES } from '../sector/parse.js';

export const DEVICE_TYPE = 'panel';

export const FEATURES = { MODE: 'mode' };

const MODE_LABELS = {
  [ALARM_MODES.DISARMED]: 'Disarmed',
  [ALARM_MODES.PARTIAL]: 'Partially armed',
  [ALARM_MODES.ARMED]: 'Armed',
};

/** The external ids of a panel device. */
export function panelIds(gladys, panelId) {
  return gladys.externalIds(DEVICE_TYPE, panelId);
}

/** The modes this panel can be put in, in display order. */
export function modesOf(panel) {
  return [
    ALARM_MODES.DISARMED,
    ...(panel.canPartialArm ? [ALARM_MODES.PARTIAL] : []),
    ALARM_MODES.ARMED,
  ];
}

export const alarmPanel = {
  type: DEVICE_TYPE,

  buildDevice(gladys, panel) {
    const ids = panelIds(gladys, panel.id);
    return {
      name: panel.name || `Sector Alarm ${panel.id}`,
      external_id: ids.device,
      model: 'Sector Alarm panel',
      params: [{ name: 'panel_id', value: panel.id }],
      features: [
        {
          name: 'Alarm mode',
          external_id: ids.feature(FEATURES.MODE),
          category: DEVICE_FEATURE_CATEGORIES.TEXT,
          type: DEVICE_FEATURE_TYPES.TEXT.SELECT,
          read_only: false,
          has_feedback: true,
          keep_history: false,
          min: 0,
          max: 0,
          supported_options: modesOf(panel).map((mode, index) => ({
            value: mode,
            label: MODE_LABELS[mode],
            sort_order: index,
          })),
        },
      ],
    };
  },

  /** The states to publish, `text` for the select. */
  states(gladys, panel) {
    if (!panel.mode) {
      return [];
    }
    return [
      {
        device_feature_external_id: panelIds(gladys, panel.id).feature(FEATURES.MODE),
        text: panel.mode,
      },
    ];
  },

  transport(panel) {
    // Unreachable: the panel itself says it is offline, or the cloud did not
    // answer its last status read.
    if (panel.online === false || panel.reachable === false) {
      return 'unreachable';
    }
    return 'cloud';
  },
};
