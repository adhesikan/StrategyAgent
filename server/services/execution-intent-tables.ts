/**
 * server/services/execution-intent-tables.ts — Sprint 2.8.6
 *
 * Raw SQL DDL for execution intent tables.
 * All tables are created idempotently (IF NOT EXISTS).
 * Never use Drizzle ORM here — same raw-SQL pattern as order-confirmation-service.ts.
 *
 * Tables:
 *   execution_intents               — the canonical execution record
 *   execution_submission_attempts   — one row per submission attempt
 *   execution_fills                 — fill records from broker
 *   execution_position_links        — portfolio position linkage after fill
 *
 * The execution_audit_events table (shared/schema.ts:3892) is reused with new event types.
 */

export async function ensureExecutionIntentTables(): Promise<void> {
  const { pool } = await import("../db");

  // ── execution_intents ────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS execution_intents (
      id                        VARCHAR PRIMARY KEY,
      user_id                   VARCHAR NOT NULL,
      confirmation_id           VARCHAR NOT NULL,
      confirmation_snapshot_hash VARCHAR NOT NULL,
      trade_plan_id             VARCHAR NOT NULL,
      provider                  TEXT NOT NULL,
      account_ref               TEXT NOT NULL,
      account_ref_masked        TEXT NOT NULL,
      execution_mode            TEXT NOT NULL,
      state                     TEXT NOT NULL DEFAULT 'INTENT_CREATED',
      idempotency_key           VARCHAR NOT NULL,
      submission_fingerprint    TEXT,
      instrument_type           TEXT NOT NULL,
      structure_type            TEXT NOT NULL,
      symbol                    TEXT NOT NULL,
      intent_json               JSONB NOT NULL DEFAULT '{}',
      broker_order_ref          TEXT,
      client_order_tag          TEXT,
      filled_qty                NUMERIC,
      ordered_qty               NUMERIC,
      fill_price                NUMERIC,
      final_validation_at       TIMESTAMPTZ,
      submitted_at              TIMESTAMPTZ,
      acknowledged_at           TIMESTAMPTZ,
      reconciled_at             TIMESTAMPTZ,
      filled_at                 TIMESTAMPTZ,
      linked_at                 TIMESTAMPTZ,
      error_code                TEXT,
      error_message             TEXT,
      attempt_count             INTEGER NOT NULL DEFAULT 0,
      created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    ALTER TABLE execution_intents
      ADD CONSTRAINT IF NOT EXISTS uq_ei_idempotency_key UNIQUE (idempotency_key);
  `);

  // One confirmed snapshot → at most one intent per user
  await pool.query(`
    ALTER TABLE execution_intents
      ADD CONSTRAINT IF NOT EXISTS uq_ei_confirmation_user
        UNIQUE (confirmation_id, user_id);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_ei_user_id
      ON execution_intents(user_id);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_ei_state
      ON execution_intents(state);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_ei_trade_plan_id
      ON execution_intents(trade_plan_id);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_ei_broker_order_ref
      ON execution_intents(broker_order_ref)
      WHERE broker_order_ref IS NOT NULL;
  `);

  // ── execution_submission_attempts ────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS execution_submission_attempts (
      id                    VARCHAR PRIMARY KEY,
      execution_intent_id   VARCHAR NOT NULL,
      user_id               VARCHAR NOT NULL,
      attempt_number        INTEGER NOT NULL DEFAULT 1,
      started_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      completed_at          TIMESTAMPTZ,
      outcome               TEXT NOT NULL DEFAULT 'IN_PROGRESS',
      broker_order_ref      TEXT,
      error_code            TEXT,
      error_message         TEXT,
      timeout_ms            INTEGER NOT NULL DEFAULT 30000,
      timed_out             BOOLEAN NOT NULL DEFAULT false
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_esa_intent_id
      ON execution_submission_attempts(execution_intent_id);
  `);

  // ── execution_fills ──────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS execution_fills (
      id                    VARCHAR PRIMARY KEY,
      execution_intent_id   VARCHAR NOT NULL,
      user_id               VARCHAR NOT NULL,
      fill_sequence         INTEGER NOT NULL DEFAULT 1,
      ordered_qty           NUMERIC NOT NULL,
      filled_qty            NUMERIC NOT NULL,
      remaining_qty         NUMERIC NOT NULL DEFAULT 0,
      fill_price            NUMERIC,
      fill_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
      commission            NUMERIC,
      fees                  NUMERIC,
      broker_fill_id        TEXT,
      raw_status_from_broker TEXT NOT NULL DEFAULT 'unknown',
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_ef_intent_id
      ON execution_fills(execution_intent_id);
  `);

  // ── execution_position_links ─────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS execution_position_links (
      id                    VARCHAR PRIMARY KEY,
      execution_intent_id   VARCHAR NOT NULL,
      user_id               VARCHAR NOT NULL,
      portfolio_id          TEXT,
      symbol                TEXT NOT NULL,
      link_strategy         TEXT NOT NULL DEFAULT 'estimated',
      linked_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_epl_intent_id
      ON execution_position_links(execution_intent_id);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_epl_user_id
      ON execution_position_links(user_id);
  `);
}

// ─────────────────────────────────────────────────────────────────────────────
// EXECUTION INTENT DB OPERATIONS
// ─────────────────────────────────────────────────────────────────────────────

import type { ExecutionIntent, ExecutionIntentState, ExecutionFill, ExecutionPositionLink } from "../../shared/execution-intent-types";

export async function insertExecutionIntent(intent: ExecutionIntent): Promise<void> {
  const { pool } = await import("../db");
  await pool.query(`
    INSERT INTO execution_intents (
      id, user_id, confirmation_id, confirmation_snapshot_hash, trade_plan_id,
      provider, account_ref, account_ref_masked, execution_mode, state,
      idempotency_key, submission_fingerprint, instrument_type, structure_type,
      symbol, intent_json, ordered_qty, error_code, error_message,
      attempt_count, created_at, updated_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
      $11,$12,$13,$14,$15,$16,$17,$18,$19,
      $20,$21,$22
    )
  `, [
    intent.id, intent.userId, intent.confirmationId, intent.confirmationSnapshotHash,
    intent.tradePlanId, intent.provider, intent.accountRef, intent.accountRefMasked,
    intent.executionMode, intent.state, intent.idempotencyKey, intent.submissionFingerprint,
    intent.instrumentType, intent.structureType, intent.symbol,
    JSON.stringify(intent.intentJson),
    intent.intentJson.quantity,
    intent.errorCode, intent.errorMessage, intent.attemptCount,
    intent.createdAt, intent.updatedAt,
  ]);
}

export async function getExecutionIntentById(id: string, userId: string): Promise<ExecutionIntent | null> {
  const { pool } = await import("../db");
  const r = await pool.query(
    `SELECT * FROM execution_intents WHERE id = $1 AND user_id = $2`,
    [id, userId],
  );
  return r.rows[0] ? rowToIntent(r.rows[0]) : null;
}

export async function getExecutionIntentsByUser(userId: string, limit = 20): Promise<ExecutionIntent[]> {
  const { pool } = await import("../db");
  const r = await pool.query(
    `SELECT * FROM execution_intents WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [userId, limit],
  );
  return r.rows.map(rowToIntent);
}

export async function getExecutionIntentByConfirmation(confirmationId: string, userId: string): Promise<ExecutionIntent | null> {
  const { pool } = await import("../db");
  const r = await pool.query(
    `SELECT * FROM execution_intents WHERE confirmation_id = $1 AND user_id = $2`,
    [confirmationId, userId],
  );
  return r.rows[0] ? rowToIntent(r.rows[0]) : null;
}

/**
 * Atomic state transition guard.
 * Returns true if the row was updated (this caller won the race).
 * Returns false if another concurrent caller already updated the state.
 */
export async function atomicTransitionState(
  id: string,
  userId: string,
  fromState: ExecutionIntentState,
  toState: ExecutionIntentState,
  extra?: {
    errorCode?: string | null;
    errorMessage?: string | null;
    brokerOrderRef?: string | null;
    clientOrderTag?: string | null;
    filledQty?: number | null;
    fillPrice?: number | null;
    submittedAt?: string | null;
    acknowledgedAt?: string | null;
    reconciledAt?: string | null;
    filledAt?: string | null;
    linkedAt?: string | null;
    finalValidationAt?: string | null;
    submissionFingerprint?: string | null;
    attemptCountDelta?: number;
  },
): Promise<boolean> {
  const { pool } = await import("../db");
  const sets: string[] = ["state = $4", "updated_at = now()"];
  const vals: unknown[] = [id, userId, fromState, toState];

  let i = 5;
  if (extra?.errorCode !== undefined)      { sets.push(`error_code = $${i++}`);        vals.push(extra.errorCode); }
  if (extra?.errorMessage !== undefined)   { sets.push(`error_message = $${i++}`);     vals.push(extra.errorMessage); }
  if (extra?.brokerOrderRef !== undefined) { sets.push(`broker_order_ref = $${i++}`);  vals.push(extra.brokerOrderRef); }
  if (extra?.clientOrderTag !== undefined) { sets.push(`client_order_tag = $${i++}`);  vals.push(extra.clientOrderTag); }
  if (extra?.filledQty !== undefined)      { sets.push(`filled_qty = $${i++}`);        vals.push(extra.filledQty); }
  if (extra?.fillPrice !== undefined)      { sets.push(`fill_price = $${i++}`);        vals.push(extra.fillPrice); }
  if (extra?.submittedAt !== undefined)    { sets.push(`submitted_at = $${i++}`);      vals.push(extra.submittedAt); }
  if (extra?.acknowledgedAt !== undefined) { sets.push(`acknowledged_at = $${i++}`);   vals.push(extra.acknowledgedAt); }
  if (extra?.reconciledAt !== undefined)   { sets.push(`reconciled_at = $${i++}`);     vals.push(extra.reconciledAt); }
  if (extra?.filledAt !== undefined)       { sets.push(`filled_at = $${i++}`);         vals.push(extra.filledAt); }
  if (extra?.linkedAt !== undefined)       { sets.push(`linked_at = $${i++}`);         vals.push(extra.linkedAt); }
  if (extra?.finalValidationAt !== undefined) { sets.push(`final_validation_at = $${i++}`); vals.push(extra.finalValidationAt); }
  if (extra?.submissionFingerprint !== undefined) { sets.push(`submission_fingerprint = $${i++}`); vals.push(extra.submissionFingerprint); }
  if (extra?.attemptCountDelta) { sets.push(`attempt_count = attempt_count + ${extra.attemptCountDelta}`); }

  const r = await pool.query(
    `UPDATE execution_intents SET ${sets.join(", ")} WHERE id = $1 AND user_id = $2 AND state = $3`,
    vals,
  );
  return (r.rowCount ?? 0) > 0;
}

export async function insertSubmissionAttempt(attempt: import("../../shared/execution-intent-types").ExecutionSubmissionAttempt): Promise<void> {
  const { pool } = await import("../db");
  await pool.query(`
    INSERT INTO execution_submission_attempts (
      id, execution_intent_id, user_id, attempt_number, started_at,
      completed_at, outcome, broker_order_ref, error_code, error_message,
      timeout_ms, timed_out
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
  `, [
    attempt.id, attempt.executionIntentId, attempt.userId,
    attempt.attemptNumber, attempt.startedAt, attempt.completedAt,
    attempt.outcome, attempt.brokerOrderRef, attempt.errorCode,
    attempt.errorMessage, attempt.timeoutMs, attempt.timedOut,
  ]);
}

export async function updateSubmissionAttempt(
  id: string,
  outcome: string,
  extra: { brokerOrderRef?: string | null; errorCode?: string | null; errorMessage?: string | null; timedOut?: boolean },
): Promise<void> {
  const { pool } = await import("../db");
  await pool.query(`
    UPDATE execution_submission_attempts
    SET outcome = $2, completed_at = now(),
        broker_order_ref = COALESCE($3, broker_order_ref),
        error_code = COALESCE($4, error_code),
        error_message = COALESCE($5, error_message),
        timed_out = COALESCE($6, timed_out)
    WHERE id = $1
  `, [id, outcome, extra.brokerOrderRef ?? null, extra.errorCode ?? null, extra.errorMessage ?? null, extra.timedOut ?? null]);
}

export async function insertExecutionFill(fill: ExecutionFill): Promise<void> {
  const { pool } = await import("../db");
  await pool.query(`
    INSERT INTO execution_fills (
      id, execution_intent_id, user_id, fill_sequence, ordered_qty,
      filled_qty, remaining_qty, fill_price, fill_at, commission, fees,
      broker_fill_id, raw_status_from_broker, created_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
  `, [
    fill.id, fill.executionIntentId, fill.userId, fill.fillSequence,
    fill.orderedQty, fill.filledQty, fill.remainingQty, fill.fillPrice,
    fill.fillAt, fill.commission, fill.fees, fill.brokerFillId,
    fill.rawStatusFromBroker, fill.createdAt,
  ]);
}

export async function getFillsByIntentId(intentId: string): Promise<ExecutionFill[]> {
  const { pool } = await import("../db");
  const r = await pool.query(
    `SELECT * FROM execution_fills WHERE execution_intent_id = $1 ORDER BY fill_sequence ASC`,
    [intentId],
  );
  return r.rows.map((row: any) => ({
    id: row.id,
    executionIntentId: row.execution_intent_id,
    userId: row.user_id,
    fillSequence: row.fill_sequence,
    orderedQty: Number(row.ordered_qty),
    filledQty: Number(row.filled_qty),
    remainingQty: Number(row.remaining_qty),
    fillPrice: row.fill_price !== null ? Number(row.fill_price) : null,
    fillAt: row.fill_at?.toISOString() ?? new Date().toISOString(),
    commission: row.commission !== null ? Number(row.commission) : null,
    fees: row.fees !== null ? Number(row.fees) : null,
    brokerFillId: row.broker_fill_id,
    rawStatusFromBroker: row.raw_status_from_broker,
    createdAt: row.created_at?.toISOString() ?? new Date().toISOString(),
  }));
}

export async function insertPositionLink(link: ExecutionPositionLink): Promise<void> {
  const { pool } = await import("../db");
  await pool.query(`
    INSERT INTO execution_position_links (
      id, execution_intent_id, user_id, portfolio_id, symbol,
      link_strategy, linked_at, created_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
  `, [
    link.id, link.executionIntentId, link.userId, link.portfolioId,
    link.symbol, link.linkStrategy, link.linkedAt, link.createdAt,
  ]);
}

/** Startup recovery: find stale SUBMISSION_IN_PROGRESS intents (older than threshold). */
export async function getStaleSubmissionInProgressIntents(olderThanMs = 120_000): Promise<ExecutionIntent[]> {
  const { pool } = await import("../db");
  const cutoff = new Date(Date.now() - olderThanMs).toISOString();
  const r = await pool.query(`
    SELECT * FROM execution_intents
    WHERE state IN ('SUBMISSION_IN_PROGRESS', 'SANDBOX_SUBMISSION_IN_PROGRESS')
      AND submitted_at < $1
  `, [cutoff]);
  return r.rows.map(rowToIntent);
}

function rowToIntent(row: any): ExecutionIntent {
  return {
    id: row.id,
    userId: row.user_id,
    confirmationId: row.confirmation_id,
    confirmationSnapshotHash: row.confirmation_snapshot_hash,
    tradePlanId: row.trade_plan_id,
    provider: row.provider,
    accountRef: row.account_ref,
    accountRefMasked: row.account_ref_masked,
    executionMode: row.execution_mode,
    state: row.state,
    idempotencyKey: row.idempotency_key,
    submissionFingerprint: row.submission_fingerprint,
    instrumentType: row.instrument_type,
    structureType: row.structure_type,
    symbol: row.symbol,
    intentJson: typeof row.intent_json === "string" ? JSON.parse(row.intent_json) : (row.intent_json ?? {}),
    brokerOrderRef: row.broker_order_ref,
    clientOrderTag: row.client_order_tag,
    filledQty: row.filled_qty !== null ? Number(row.filled_qty) : null,
    orderedQty: row.ordered_qty !== null ? Number(row.ordered_qty) : null,
    fillPrice: row.fill_price !== null ? Number(row.fill_price) : null,
    finalValidationAt: row.final_validation_at?.toISOString() ?? null,
    submittedAt: row.submitted_at?.toISOString() ?? null,
    acknowledgedAt: row.acknowledged_at?.toISOString() ?? null,
    reconciledAt: row.reconciled_at?.toISOString() ?? null,
    filledAt: row.filled_at?.toISOString() ?? null,
    linkedAt: row.linked_at?.toISOString() ?? null,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    attemptCount: row.attempt_count ?? 0,
    createdAt: row.created_at?.toISOString() ?? new Date().toISOString(),
    updatedAt: row.updated_at?.toISOString() ?? new Date().toISOString(),
  };
}
