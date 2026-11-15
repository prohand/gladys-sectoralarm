// The integration wired to the SDK's fake Gladys and to the fake Sector Alarm.

import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { createIntegration } from '../../src/integration.js';
import { SectorClient } from '../../src/sector/client.js';
import { createFakeSector } from './fakeSector.js';

export const CONFIG = { email: 'user@example.com', password: 'secret', panel_code: '1234' };

export async function startIntegration({ config = CONFIG, account } = {}) {
  const sector = createFakeSector(account);
  const gladys = createFakeGladys({ config });
  const integration = createIntegration(gladys, {
    client: new SectorClient({ fetch: sector.fetch }),
  });
  await gladys.connect();
  const device = (type) =>
    gladys.fake.discoveredDevices.find((d) => d.external_id.includes(`:${type}:`));
  return { gladys, sector, integration, device };
}
