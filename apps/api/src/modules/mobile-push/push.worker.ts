import { randomUUID } from 'node:crypto';
import { sql } from '@ks-os/database';
import type { FastifyInstance } from 'fastify';
import { communicationsDatabase, type CommunicationsDatabase } from '../communications/communications.database.js';
import { configuredPushAdapters } from './push.config.js';
import { authorizePush, type PushDelivery, type PushEligibility } from './push.policy.js';
import type { PushAdapter, PushOutcome } from './push.types.js';

type Options = { now?: () => number; random?: () => number; authorize?: (db: CommunicationsDatabase, row: PushDelivery) => Promise<PushEligibility> };
export class MobilePushWorker {
  private now: () => number; private random: () => number; private authorize: NonNullable<Options['authorize']>;
  constructor(private db: CommunicationsDatabase, private adapters: PushAdapter[], options: Options = {}) { this.now = options.now ?? Date.now; this.random = options.random ?? Math.random; this.authorize = options.authorize ?? authorizePush; }
  close() { for (const adapter of this.adapters) adapter.close?.(); }
  async process(limit = 20) {
    if (!this.adapters.length) return { claimed: 0, accepted: 0, cancelled: 0, retry: 0, failed: 0 };
    const lease = randomUUID();
    const rows = await this.db.transaction(async db => {
      await db.query(sql`UPDATE mobile_push_deliveries SET status=CASE WHEN expires_at<=now() THEN 'EXPIRED' WHEN attempt_count>=6 THEN 'FAILED' ELSE 'RETRY' END,lease_id=NULL,lease_expires_at=NULL,next_attempt_at=now(),last_error_code='PUSH_LEASE_EXPIRED',updated_at=now() WHERE status='PROCESSING' AND lease_expires_at<=now()`);
      await db.query(sql`UPDATE mobile_push_deliveries SET status='EXPIRED',last_error_code='PUSH_EXPIRED',updated_at=now() WHERE status IN ('PENDING','RETRY') AND expires_at<=now()`);
      const claimed = await db.query<PushDelivery>(sql`WITH candidates AS (
        SELECT id FROM mobile_push_deliveries WHERE status IN ('PENDING','RETRY') AND next_attempt_at<=now() AND expires_at>now() AND attempt_count<6 ORDER BY next_attempt_at,created_at,id FOR UPDATE SKIP LOCKED LIMIT ${Math.max(1, Math.min(20, limit))}
      ) UPDATE mobile_push_deliveries q SET status='PROCESSING',attempt_count=q.attempt_count+1,lease_id=${lease},lease_expires_at=now()+interval '3 minutes',updated_at=now() FROM candidates WHERE q.id=candidates.id RETURNING q.*`);
      for (const row of claimed) await db.query(sql`INSERT INTO mobile_push_attempts(delivery_id,attempt,lease_id) VALUES(${row.id},${row.attempt_count},${lease})`);
      return claimed;
    });
    const summary = { claimed: rows.length, accepted: 0, cancelled: 0, retry: 0, failed: 0 }; let next = 0;
    const run = async () => { while (next < rows.length) { const row = rows[next++]; let outcome: PushOutcome | { kind: 'cancelled'; code: string };
      try {
        const first = await this.authorize(this.db, row);
        if ('reason' in first) outcome = { kind: 'cancelled', code: first.reason };
        else {
          const adapter = this.adapters.find(value => value.matches(first.target));
          if (!adapter) outcome = { kind: 'rejected', code: 'PUSH_PROVIDER_UNAVAILABLE' };
          else {
            // OAuth exchange may perform network I/O; recheck all state afterwards, immediately before delivery.
            await adapter.prepare?.(); const current = await this.authorize(this.db, row);
            outcome = 'reason' in current ? { kind: 'cancelled', code: current.reason } : await adapter.send(current.target, current.payload, row.id);
          }
        }
      } catch { outcome = { kind: 'retry', code: 'PUSH_PROCESSING_UNAVAILABLE', retryAfterMs: 60000 }; }
      const result = await this.finish(row, outcome); summary[result]++;
    } };
    await Promise.all(Array.from({ length: Math.min(4, rows.length) }, run));
    return summary;
  }
  private async finish(row: PushDelivery, outcome: PushOutcome | { kind: 'cancelled'; code: string }): Promise<'accepted' | 'cancelled' | 'retry' | 'failed'> {
    let status = outcome.kind === 'accepted' ? 'ACCEPTED' : outcome.kind === 'cancelled' ? 'CANCELLED' : outcome.kind === 'retry' ? 'RETRY' : 'FAILED';
    const delay = outcome.kind === 'retry' ? Math.max(outcome.retryAfterMs ?? 0, Math.min(3600000, 60000 * 2 ** (row.attempt_count - 1)) * (1 + Math.max(0, Math.min(1, this.random())) * .25)) : 0;
    const next = this.now() + delay;
    if (status === 'RETRY' && (row.attempt_count >= 6 || next >= new Date(row.expires_at).getTime())) status = next >= new Date(row.expires_at).getTime() ? 'EXPIRED' : 'FAILED';
    await this.db.transaction(async db => {
      const changed = await db.query(sql`UPDATE mobile_push_deliveries SET status=${status},next_attempt_at=${new Date(next).toISOString()}::timestamptz,lease_id=NULL,lease_expires_at=NULL,
        last_error_code=${outcome.kind === 'accepted' ? null : outcome.code},provider_reference=${outcome.kind === 'accepted' ? outcome.providerId ?? null : null},accepted_at=${outcome.kind === 'accepted' ? new Date(this.now()).toISOString() : null}::timestamptz,updated_at=now()
        WHERE id=${row.id} AND status='PROCESSING' AND lease_id=${row.lease_id} RETURNING id`);
      await db.query(sql`UPDATE mobile_push_attempts SET completed_at=now(),outcome=${outcome.kind},error_code=${outcome.kind === 'accepted' ? null : outcome.code} WHERE delivery_id=${row.id} AND lease_id=${row.lease_id} AND completed_at IS NULL`);
      if (changed.length && outcome.kind === 'invalid') {
        // An old in-flight invalid response must never destroy a newly rotated/re-registered token.
        await db.query(sql`UPDATE mobile_push_registrations SET invalidated_at=now(),token_ciphertext='',updated_at=now() WHERE id=${row.registration_id} AND token_version=${row.token_version}
          ${outcome.invalidSince ? sql`AND token_updated_at<=${new Date(outcome.invalidSince).toISOString()}::timestamptz` : sql``}`);
      }
    });
    return status === 'ACCEPTED' ? 'accepted' : status === 'CANCELLED' ? 'cancelled' : status === 'RETRY' ? 'retry' : 'failed';
  }
  async cleanup() {
    await this.db.query(sql`UPDATE mobile_push_registrations SET revoked_at=now(),token_ciphertext='',updated_at=now() WHERE revoked_at IS NULL AND last_seen_at<now()-interval '90 days'`);
    await this.db.query(sql`DELETE FROM mobile_push_deliveries WHERE status IN ('ACCEPTED','CANCELLED','FAILED','EXPIRED') AND updated_at<now()-interval '30 days'`);
  }
}
export function startMobilePushWorker(app: FastifyInstance) {
  let adapters: PushAdapter[]; try { adapters = configuredPushAdapters(); } catch { app.log.error('Mobile push configuration is invalid; delivery worker is disabled.'); return; }
  if (!adapters.length) return;
  const worker = new MobilePushWorker(communicationsDatabase(), adapters); let running: Promise<void> | undefined, stopping = false, lastCleanup = 0;
  const run = () => { if (running || stopping) return; running = (async () => {
    try { const result = await worker.process(); if (result.claimed) app.log.info({ mobilePush: result }, 'Mobile push batch processed'); if (Date.now() - lastCleanup > 3600000) { await worker.cleanup(); lastCleanup = Date.now(); } }
    catch { app.log.warn('Mobile push batch unavailable; durable jobs will be retried.'); }
  })().finally(() => { running = undefined; }); };
  const timer = setInterval(run, 5000); timer.unref(); run();
  app.addHook('onClose', async () => { stopping = true; clearInterval(timer); await running; worker.close(); });
}
