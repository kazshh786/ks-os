import { buildApp } from './app.js';
import { env } from './config/env.js';
import { ConversationDeliveryService } from './modules/conversations/conversation-delivery.service.js';
import { MailboxService } from './modules/mailboxes/mailbox.service.js';
import { LiveSiteAvailabilityProducer } from './modules/sites/live-site-availability-producer.service.js';
import { LiveSiteIntelligenceService } from './modules/sites/live-site-intelligence.service.js';

const server = buildApp();
const conversationDelivery = new ConversationDeliveryService();
const mailboxService = new MailboxService();
const liveSiteAvailability = new LiveSiteAvailabilityProducer();
const liveSiteIntelligence = new LiveSiteIntelligenceService();
let conversationWorkerTimer: NodeJS.Timeout | null = null;
let conversationWorkerRunning = false;
let mailboxWorkerTimer: NodeJS.Timeout | null = null;
let mailboxWorkerRunning = false;
let liveSiteIntelligenceTimer: NodeJS.Timeout | null = null;
let liveSiteIntelligenceRunning = false;

const runConversationWorker = async () => {
  if (conversationWorkerRunning) return;
  conversationWorkerRunning = true;
  try {
    const result = await conversationDelivery.process(Number(process.env.CONVERSATION_WORKER_BATCH_SIZE || 20));
    if (result.claimed > 0) server.log.info({ conversationDelivery: result }, 'Conversation delivery batch completed');
  } catch (error) {
    server.log.error({ err: error }, 'Conversation delivery batch failed');
  } finally {
    conversationWorkerRunning = false;
  }
};

const runMailboxWorker = async () => {
  if (mailboxWorkerRunning) return;
  mailboxWorkerRunning = true;
  try {
    const result = await mailboxService.syncDue(Number(process.env.MAILBOX_SYNC_BATCH_SIZE || 10));
    if (result.claimed > 0) server.log.info({ mailboxSync: result }, 'Connected mailbox sync batch completed');
  } catch (error) {
    server.log.error({ err: error }, 'Connected mailbox sync batch failed');
  } finally {
    mailboxWorkerRunning = false;
  }
};

const runLiveSiteIntelligenceWorker = async () => {
  if (liveSiteIntelligenceRunning) return;
  liveSiteIntelligenceRunning = true;
  try {
    const [availability, impacts] = await Promise.all([
      liveSiteAvailability.run(
        Number(process.env.LIVE_SITE_AVAILABILITY_SITE_BATCH_SIZE || 5),
        Number(process.env.LIVE_SITE_AVAILABILITY_SERVICE_BATCH_SIZE || 20),
      ),
      liveSiteIntelligence.processPendingChangesAutomatically(
        Number(process.env.LIVE_SITE_IMPACT_BATCH_SIZE || 100),
      ),
    ]);
    if (availability.producedCount > 0 || impacts.processedCount > 0) {
      server.log.info({ availability, impacts }, 'Live Site Intelligence cycle completed');
    }
  } catch (error) {
    server.log.error({ err: error }, 'Live Site Intelligence cycle failed');
  } finally {
    liveSiteIntelligenceRunning = false;
  }
};

const start = async () => {
  try {
    const port = env.PORT;
    const host = '127.0.0.1';

    await server.listen({ port, host });
    server.log.info(`Server listening on port ${port} in ${env.NODE_ENV} mode`);

    if (process.env.CONVERSATION_WORKER_ENABLED !== 'false') {
      const intervalMs = Math.max(1_000, Number(process.env.CONVERSATION_WORKER_INTERVAL_MS || 5_000));
      conversationWorkerTimer = setInterval(() => void runConversationWorker(), intervalMs);
      conversationWorkerTimer.unref();
      void runConversationWorker();
      server.log.info({ intervalMs }, 'Conversation delivery worker started');
    }

    if (process.env.MAILBOX_SYNC_ENABLED !== 'false') {
      const intervalMs = Math.max(15_000, Number(process.env.MAILBOX_SYNC_INTERVAL_MS || 30_000));
      mailboxWorkerTimer = setInterval(() => void runMailboxWorker(), intervalMs);
      mailboxWorkerTimer.unref();
      void runMailboxWorker();
      server.log.info({ intervalMs }, 'Connected mailbox sync worker started');
    }

    if (process.env.LIVE_SITE_INTELLIGENCE_WORKER_ENABLED !== 'false') {
      const intervalMs = Math.max(
        30_000,
        Number(process.env.LIVE_SITE_INTELLIGENCE_WORKER_INTERVAL_MS || 60_000),
      );
      liveSiteIntelligenceTimer = setInterval(
        () => void runLiveSiteIntelligenceWorker(),
        intervalMs,
      );
      liveSiteIntelligenceTimer.unref();
      void runLiveSiteIntelligenceWorker();
      server.log.info({ intervalMs }, 'Live Site Intelligence worker started');
    }
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

const closeGracefully = async (signal: string) => {
  server.log.info(`Received ${signal}. Shutting down Fastify server...`);
  if (conversationWorkerTimer) clearInterval(conversationWorkerTimer);
  if (mailboxWorkerTimer) clearInterval(mailboxWorkerTimer);
  if (liveSiteIntelligenceTimer) clearInterval(liveSiteIntelligenceTimer);
  await server.close();
  server.log.info('Fastify server shutdown complete. Exiting.');
  process.exit(0);
};

process.on('SIGTERM', () => closeGracefully('SIGTERM'));
process.on('SIGINT', () => closeGracefully('SIGINT'));

start();
