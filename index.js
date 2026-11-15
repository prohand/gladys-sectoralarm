// -----------------------------------------------------------------------------
// Entry point of the Sector Alarm integration.
//
// Role of this file: wire the SDK to the Sector Alarm client (src/sector/) and
// to the device catalog (src/devices/). It holds NO API logic:
//   1. it instantiates the SDK (connection, auth, reconnection: handled for you);
//   2. it registers the event handlers BEFORE connect();
//   3. it connects, reads the panels, publishes their devices and keeps them
//      fresh with its own refresh timer.
//
// Environment variables provided by the Gladys supervisor to the container:
//   - GLADYS_HOST_API_URL         (host API URL)
//   - GLADYS_INTEGRATION_TOKEN    (integration-scoped JWT)
//   - GLADYS_INTEGRATION_SELECTOR (integration identifier)
// The SDK reads them automatically: `new GladysIntegration()` is enough.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { createIntegration } from './src/integration.js';

// A promise rejected with nobody listening — a timer callback, a
// fire-and-forget publication — would terminate Node. Log it, keep running.
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', reason);
});

const gladys = new GladysIntegration();
const integration = createIntegration(gladys);

// --- Graceful shutdown -------------------------------------------------------
gladys.handleShutdown((signal) => {
  logger.info(`Received ${signal} -> graceful shutdown`);
  integration.stop();
});

// --- Startup -----------------------------------------------------------------
logger.info('Starting the Sector Alarm integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
