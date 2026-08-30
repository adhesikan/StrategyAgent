import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { db } from "./db";
import { brokerConnections } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { configurePushService } from "./push-service";
import { startAlertEngine, isWithinAnyTradingHours } from "./alert-engine";
import { storage } from "./storage";
import cron from "node-cron";
import { resolveOpportunities, updateOpportunityPrices } from "./opportunity-service";
import { startScheduledScanService } from "./scheduled-scan-service";
import { fetchQuotesFromBroker } from "./broker-service";
import { runMigrations } from 'stripe-replit-sync';
import { getStripeSync } from "./stripeClient";
import { WebhookHandlers } from "./webhookHandlers";
import { ensureInstitutionalSecurityEnrichmentSchema } from "./services/institutional/security-enrichment-migration";
import { ensureInstitutionalManagerCohortSchema } from "./services/institutional/manager-cohort-migration";
import { ensureExternalApiSecuritySchema } from "./services/external-api-security";
import { sanitizeApiResponseForLog } from "./services/api-log-sanitizer";

// ── Global process survival handlers ────────────────────────────────────────
// Express 4 async handlers that throw without try/catch produce unhandled
// rejections. Node.js 15+ terminates on unhandledRejection by default.
// These handlers log the event and keep the process alive so that
// /api/broker/ping and other healthy routes remain reachable.
// They do NOT suppress the error — every rejection is still logged in full.
process.on("unhandledRejection", (reason: unknown) => {
  console.error(JSON.stringify({
    event:  "unhandledRejection",
    reason: String(reason instanceof Error ? reason.stack : reason).slice(0, 500),
    ts:     new Date().toISOString(),
  }));
  // Do NOT call process.exit — the process must survive for Railway health checks.
});

process.on("uncaughtException", (err: Error, origin: string) => {
  console.error(JSON.stringify({
    event:  "uncaughtException",
    origin,
    message: err?.message?.slice(0, 300),
    stack:   err?.stack?.slice(0, 600),
    ts:      new Date().toISOString(),
  }));
  // Uncaught exceptions are more severe; log and keep alive for Railway.
  // The specific route that failed will have already sent a 5xx if it had
  // its own try/catch; if not, the client will see a connection reset.
});

// Run inline migrations on startup (more reliable than separate script)
async function runStartupMigrations() {
  try {
    log("Running startup migrations...", "migrations");
    
    // Add missing columns to alert_rules table
    await db.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'alert_rules' AND column_name = 'is_global'
        ) THEN
          ALTER TABLE alert_rules ADD COLUMN is_global BOOLEAN DEFAULT false;
          RAISE NOTICE 'Added is_global column to alert_rules';
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'alert_rules' AND column_name = 'send_push_notification'
        ) THEN
          ALTER TABLE alert_rules ADD COLUMN send_push_notification BOOLEAN DEFAULT true;
          RAISE NOTICE 'Added send_push_notification column to alert_rules';
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'alert_rules' AND column_name = 'send_webhook'
        ) THEN
          ALTER TABLE alert_rules ADD COLUMN send_webhook BOOLEAN DEFAULT false;
          RAISE NOTICE 'Added send_webhook column to alert_rules';
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'alert_rules' AND column_name = 'triggered_symbols'
        ) THEN
          ALTER TABLE alert_rules ADD COLUMN triggered_symbols TEXT[];
          RAISE NOTICE 'Added triggered_symbols column to alert_rules';
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'alert_rules' AND column_name = 'scan_interval'
        ) THEN
          ALTER TABLE alert_rules ADD COLUMN scan_interval TEXT;
          RAISE NOTICE 'Added scan_interval column to alert_rules';
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'alert_rules' AND column_name = 'strategies'
        ) THEN
          ALTER TABLE alert_rules ADD COLUMN strategies TEXT[];
          RAISE NOTICE 'Added strategies column to alert_rules';
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'alert_rules' AND column_name = 'score_threshold'
        ) THEN
          ALTER TABLE alert_rules ADD COLUMN score_threshold INTEGER;
          RAISE NOTICE 'Added score_threshold column to alert_rules';
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'alert_rules' AND column_name = 'min_strategies'
        ) THEN
          ALTER TABLE alert_rules ADD COLUMN min_strategies INTEGER;
          RAISE NOTICE 'Added min_strategies column to alert_rules';
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'alert_rules' AND column_name = 'automation_endpoint_id'
        ) THEN
          ALTER TABLE alert_rules ADD COLUMN automation_endpoint_id VARCHAR;
          RAISE NOTICE 'Added automation_endpoint_id column to alert_rules';
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'alert_rules' AND column_name = 'watchlist_id'
        ) THEN
          ALTER TABLE alert_rules ADD COLUMN watchlist_id VARCHAR;
          RAISE NOTICE 'Added watchlist_id column to alert_rules';
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'alert_rules' AND column_name = 'automation_profile_id'
        ) THEN
          ALTER TABLE alert_rules ADD COLUMN automation_profile_id VARCHAR;
          RAISE NOTICE 'Added automation_profile_id column to alert_rules';
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'alert_rules' AND column_name = 'is_enabled'
        ) THEN
          ALTER TABLE alert_rules ADD COLUMN is_enabled BOOLEAN DEFAULT true;
          RAISE NOTICE 'Added is_enabled column to alert_rules';
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'alert_rules' AND column_name = 'created_at'
        ) THEN
          ALTER TABLE alert_rules ADD COLUMN created_at TIMESTAMP DEFAULT NOW();
          RAISE NOTICE 'Added created_at column to alert_rules';
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'alert_rules' AND column_name = 'updated_at'
        ) THEN
          ALTER TABLE alert_rules ADD COLUMN updated_at TIMESTAMP DEFAULT NOW();
          RAISE NOTICE 'Added updated_at column to alert_rules';
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'alert_rules' AND column_name = 'last_evaluated_at'
        ) THEN
          ALTER TABLE alert_rules ADD COLUMN last_evaluated_at TIMESTAMP;
          RAISE NOTICE 'Added last_evaluated_at column to alert_rules';
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'alert_rules' AND column_name = 'last_state'
        ) THEN
          ALTER TABLE alert_rules ADD COLUMN last_state JSONB;
          RAISE NOTICE 'Added last_state column to alert_rules';
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'alert_rules' AND column_name = 'timeframe'
        ) THEN
          ALTER TABLE alert_rules ADD COLUMN timeframe TEXT DEFAULT '1d';
          RAISE NOTICE 'Added timeframe column to alert_rules';
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'alert_rules' AND column_name = 'condition_type'
        ) THEN
          ALTER TABLE alert_rules ADD COLUMN condition_type TEXT NOT NULL DEFAULT 'STAGE_ENTERED';
          RAISE NOTICE 'Added condition_type column to alert_rules';
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'alert_rules' AND column_name = 'condition_payload'
        ) THEN
          ALTER TABLE alert_rules ADD COLUMN condition_payload JSONB;
          RAISE NOTICE 'Added condition_payload column to alert_rules';
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'alert_rules' AND column_name = 'strategy'
        ) THEN
          ALTER TABLE alert_rules ADD COLUMN strategy TEXT NOT NULL DEFAULT 'VCP';
          RAISE NOTICE 'Added strategy column to alert_rules';
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'alert_rules' AND column_name = 'symbol'
        ) THEN
          ALTER TABLE alert_rules ADD COLUMN symbol TEXT;
          RAISE NOTICE 'Added symbol column to alert_rules';
        END IF;
      END $$;
    `);

    // Fix: Make symbol column nullable for global alerts
    await db.execute(sql`
      ALTER TABLE alert_rules ALTER COLUMN symbol DROP NOT NULL;
    `);

    // Ensure composite unique on ticker_universe_members
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS ticker_universe_members_universe_symbol_idx
      ON ticker_universe_members (universe_id, symbol);
    `);

    // Add onboarding columns to user_settings
    await db.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'user_settings' AND column_name = 'trader_type'
        ) THEN
          ALTER TABLE user_settings ADD COLUMN trader_type TEXT DEFAULT 'swing';
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'user_settings' AND column_name = 'onboarding_step'
        ) THEN
          ALTER TABLE user_settings ADD COLUMN onboarding_step INTEGER DEFAULT 0;
        END IF;
      END $$;
    `);

    // Add auto_reconnect column to broker_connections
    await db.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'broker_connections' AND column_name = 'auto_reconnect'
        ) THEN
          ALTER TABLE broker_connections ADD COLUMN auto_reconnect BOOLEAN DEFAULT false;
          RAISE NOTICE 'Added auto_reconnect column to broker_connections';
        END IF;
      END $$;
    `);

    // Add Stripe subscription columns to partner_users
    await db.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'partner_users' AND column_name = 'stripe_customer_id'
        ) THEN
          ALTER TABLE partner_users ADD COLUMN stripe_customer_id TEXT;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'partner_users' AND column_name = 'stripe_subscription_id'
        ) THEN
          ALTER TABLE partner_users ADD COLUMN stripe_subscription_id TEXT;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'partner_users' AND column_name = 'subscription_status'
        ) THEN
          ALTER TABLE partner_users ADD COLUMN subscription_status TEXT;
        END IF;
      END $$;
    `);
    
    // Sector & Theme Intelligence snapshot tables (Sprint 2.3.3)
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS sector_intelligence_snapshots (
        id          VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        sector      TEXT    NOT NULL,
        score       INTEGER NOT NULL,
        label       TEXT    NOT NULL,
        metrics     JSONB   NOT NULL DEFAULT '{}',
        top_symbols JSONB   NOT NULL DEFAULT '[]',
        changes     JSONB   NOT NULL DEFAULT '{}',
        generated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_sis_sector
        ON sector_intelligence_snapshots(sector)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_sis_generated_at
        ON sector_intelligence_snapshots(generated_at)
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS theme_intelligence_snapshots (
        id           VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        theme_id     TEXT    NOT NULL,
        theme_name   TEXT    NOT NULL,
        score        INTEGER NOT NULL,
        label        TEXT    NOT NULL,
        metrics      JSONB   NOT NULL DEFAULT '{}',
        top_symbols  JSONB   NOT NULL DEFAULT '[]',
        changes      JSONB   NOT NULL DEFAULT '{}',
        generated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_tis_theme_id
        ON theme_intelligence_snapshots(theme_id)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_tis_generated_at
        ON theme_intelligence_snapshots(generated_at)
    `);

    await ensureInstitutionalSecurityEnrichmentSchema();
    await ensureInstitutionalManagerCohortSchema();
    await ensureExternalApiSecuritySchema();

    const skipCleanup = await db.execute(sql`
      DELETE FROM agent_decisions WHERE action = 'SKIP'
    `);
    log(`Cleaned up ${skipCleanup.rowCount ?? 0} SKIP records from agent_decisions`, "migrations");

    log("Startup migrations completed successfully", "migrations");
  } catch (error) {
    log(`Startup migrations error (non-fatal): ${error}`, "migrations");
  }
}

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.post(
  '/api/stripe/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const signature = req.headers['stripe-signature'];
    if (!signature) {
      return res.status(400).json({ error: 'Missing stripe-signature' });
    }
    try {
      const sig = Array.isArray(signature) ? signature[0] : signature;
      if (!Buffer.isBuffer(req.body)) {
        console.error('STRIPE WEBHOOK ERROR: req.body is not a Buffer');
        return res.status(500).json({ error: 'Webhook processing error' });
      }
      await WebhookHandlers.processWebhook(req.body as Buffer, sig);
      res.status(200).json({ received: true });
    } catch (error: any) {
      console.error('Webhook error:', error.message);
      res.status(400).json({ error: 'Webhook processing error' });
    }
  }
);

// Plan/subscription webhook (separate from partner stripe sync above).
// Must mount BEFORE express.json() so Stripe signature verification sees the raw body.
app.post(
  '/api/billing/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const signature = req.headers['stripe-signature'];
    if (!signature) {
      return res.status(400).json({ error: 'Missing stripe-signature' });
    }
    try {
      const sig = Array.isArray(signature) ? signature[0] : signature;
      if (!Buffer.isBuffer(req.body)) {
        console.error('BILLING WEBHOOK ERROR: req.body is not a Buffer');
        return res.status(500).json({ error: 'Webhook processing error' });
      }
      const { handlePlanWebhook } = await import('./services/billing/stripe');
      await handlePlanWebhook(req.body as Buffer, sig);
      res.status(200).json({ received: true });
    } catch (error: any) {
      console.error('Billing webhook error:', error.message);
      res.status(400).json({ error: 'Webhook processing error' });
    }
  }
);

// Resend email webhook (inbound + delivery events).
// Must mount BEFORE express.json() so svix signature verification sees the raw body.
const resendWebhookHits = new Map<string, { count: number; windowStart: number }>();
app.post(
  '/api/webhooks/resend',
  express.raw({ type: '*/*', limit: '2mb' }),
  async (req, res) => {
    try {
      // Lightweight per-IP rate limit: 120/min.
      const ip = (req.headers['x-forwarded-for']?.toString().split(',')[0] || req.ip || 'unknown').trim();
      const now = Date.now();
      const bucket = resendWebhookHits.get(ip);
      if (!bucket || now - bucket.windowStart > 60_000) {
        resendWebhookHits.set(ip, { count: 1, windowStart: now });
      } else if (++bucket.count > 120) {
        return res.status(429).json({ error: 'Rate limit exceeded' });
      }
      if (resendWebhookHits.size > 5000) resendWebhookHits.clear();

      const secret = process.env.RESEND_WEBHOOK_SECRET;
      if (!secret) {
        console.warn('[email] webhook received but RESEND_WEBHOOK_SECRET is not configured');
        return res.status(503).json({ error: 'Webhook not configured' });
      }
      if (!Buffer.isBuffer(req.body)) {
        return res.status(400).json({ error: 'Invalid payload' });
      }

      const { Webhook } = await import('svix');
      let event: any;
      try {
        const wh = new Webhook(secret);
        event = wh.verify(req.body.toString('utf8'), {
          'svix-id': String(req.headers['svix-id'] || ''),
          'svix-timestamp': String(req.headers['svix-timestamp'] || ''),
          'svix-signature': String(req.headers['svix-signature'] || ''),
        });
      } catch {
        console.warn('[email] webhook signature verification failed');
        return res.status(401).json({ error: 'Invalid signature' });
      }

      const providerEventId = String(req.headers['svix-id'] || event?.data?.email_id || '') || `${event?.type}-${Date.now()}`;
      const { recordAndProcessEvent } = await import('./services/email/inbound-email-service');
      const { duplicate } = await recordAndProcessEvent({
        providerEventId,
        eventType: String(event?.type || 'unknown'),
        payloadData: event?.data,
        occurredAt: event?.created_at,
      });
      res.status(200).json({ received: true, duplicate });
    } catch (error: any) {
      console.error('[email] Resend webhook error:', error?.message);
      res.status(400).json({ error: 'Webhook processing error' });
    }
  }
);

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        const safeResponse = sanitizeApiResponseForLog(
          path,
          req.method,
          capturedJsonResponse,
        );
        logLine += ` :: ${JSON.stringify(safeResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

async function restoreBrokerConnections() {
  try {
    const connections = await db
      .select()
      .from(brokerConnections)
      .where(eq(brokerConnections.isConnected, true));
    
    if (connections.length > 0) {
      log(`Restored ${connections.length} broker connection(s) from database`);
      
      for (const conn of connections) {
        if (conn.accessTokenExpiresAt && conn.accessTokenExpiresAt < new Date()) {
          log(`Broker connection for user ${conn.userId} has expired token - will need re-authentication`);
          await db
            .update(brokerConnections)
            .set({ isConnected: false, updatedAt: new Date() })
            .where(eq(brokerConnections.id, conn.id));
        }
      }
    } else {
      log("No active broker connections found in database");
    }
  } catch (error) {
    log(`Error restoring broker connections: ${error}`);
  }
}

(async () => {
  // Run migrations first to ensure schema is up to date
  await runStartupMigrations();

  // Validate email service env configuration (logs warnings; non-fatal).
  try {
    const { validateEmailEnv } = await import('./services/email/resend-client');
    validateEmailEnv();
  } catch (err: any) {
    console.warn('[email] env validation skipped:', err?.message);
  }

  // Initialize Stripe schema and sync
  try {
    const databaseUrl = process.env.EXTERNAL_DATABASE_URL || process.env.DATABASE_URL;
    if (databaseUrl) {
      log("Initializing Stripe schema...", "stripe");
      await runMigrations({ databaseUrl, schema: 'stripe' });
      log("Stripe schema ready", "stripe");

      const replitDomain = process.env.REPLIT_DOMAINS?.split(',')[0];
      if (replitDomain) {
        const stripeSync = await getStripeSync();
        const webhookBaseUrl = `https://${replitDomain}`;
        const { webhook } = await stripeSync.findOrCreateManagedWebhook(
          `${webhookBaseUrl}/api/stripe/webhook`
        );
        log(`Stripe webhook configured: ${webhook.url}`, "stripe");

        stripeSync.syncBackfill()
          .then(() => log("Stripe data synced", "stripe"))
          .catch((err: any) => log(`Stripe sync error: ${err.message}`, "stripe"));
      } else {
        log("Skipping Stripe webhook setup (no REPLIT_DOMAINS)", "stripe");
      }
    }
  } catch (error: any) {
    log(`Stripe init error (non-fatal): ${error.message}`, "stripe");
  }
  
  configurePushService();
  await restoreBrokerConnections();
  await registerRoutes(httpServer, app);

  // Keep normalized security/theme memberships aligned with the curated
  // registry. This is idempotent and never assigns themes to untrusted maps.
  try {
    const { syncSecurityThemesFromRegistry } = await import(
      "./services/institutional/security-theme-service"
    );
    const themeSync = await syncSecurityThemesFromRegistry();
    log(
      `Institutional theme sync complete: ${themeSync.themesUpserted} definitions, ` +
        `${themeSync.membershipsRebuilt} memberships`,
      "institutional",
    );
  } catch (err: any) {
    log(
      `Institutional theme sync error (non-fatal): ${err?.message}`,
      "institutional",
    );
  }
  
  // Start alert engine (runs every 60 seconds)
  startAlertEngine(
    async () => storage.getAnyActiveBrokerConnection(),
    60000
  );
  log("Alert engine started");

  // Research Collections — seed system collections (idempotent, non-blocking).
  try {
    const { seedSystemCollections } = await import("./services/collection-service");
    seedSystemCollections().catch((err: any) =>
      log(`Collection seeding error (non-fatal): ${err?.message}`, "collection-seed"),
    );
    log("Research collection seeding scheduled");
  } catch (err: any) {
    log(`Collection seed import error (non-fatal): ${err?.message}`, "collection-seed");
  }

  // Opportunity Engine — pre-computes stock opportunities in the background.
  // Runs once at startup (non-blocking) then every 4 hours.
  // Dashboard reads from the cached snapshot via GET /api/opportunities/latest.
  try {
    const { scheduleOpportunityEngine } = await import("./services/opportunity-engine");
    scheduleOpportunityEngine();
    log("Opportunity engine scheduled (4-hour refresh cycle)");
  } catch (err: any) {
    log(`Opportunity engine schedule error (non-fatal): ${err?.message}`, "opportunity-engine");
  }
  
  // Institutional Intelligence ingestion (SEC 13F) — weekly on Sunday nights.
  // Harmless no-op when INSTITUTIONAL_INTELLIGENCE_ENABLED is false or
  // SEC_USER_AGENT is not configured.
  try {
    const { scheduleInstitutionalIngestion } = await import(
      "./services/institutional/ingestion-service"
    );
    scheduleInstitutionalIngestion();
    log("Institutional ingestion scheduled (weekly cycle)");
  } catch (err: any) {
    log(
      `Institutional ingestion schedule error (non-fatal): ${err?.message}`,
      "institutional",
    );
  }

  // Daily market-data ingestion (Twelve Data) — runs after 7:15 PM ET on
  // expected US trading days. Uses a Postgres advisory lock internally so
  // duplicate/multi-instance starts are safe. No-ops when disabled/paused.
  cron.schedule(
    "15 19 * * 1-5",
    async () => {
      try {
        const { runIngestion, isExpectedTradingDay } = await import(
          "./services/daily-market-data/ingestion"
        );
        if (!isExpectedTradingDay()) return;
        log("[MarketData] Running daily ingestion...", "market-data");
        const result = await runIngestion({ runType: "daily", initiatedBy: "scheduler" });
        log(`[MarketData] Daily ingestion finished: ${result.status}`, "market-data");
      } catch (error: any) {
        log(`[MarketData] Daily ingestion error: ${error.message}`, "market-data");
      }
    },
    { timezone: "America/New_York" },
  );
  log("Daily market-data ingestion job scheduled (7:15 PM ET, weekdays)");

  // Seed the curated symbol universe + license config row once (no-ops when
  // already present). Non-blocking; failures are logged only.
  import("./services/daily-market-data/ingestion")
    .then(async ({ seedSymbolUniverseIfEmpty, ensureLicenseConfigRow }) => {
      const seeded = await seedSymbolUniverseIfEmpty();
      await ensureLicenseConfigRow();
      if (seeded > 0) log(`[MarketData] Seeded ${seeded} symbols`, "market-data");
    })
    .catch((e: any) => log(`[MarketData] Startup seed error: ${e.message}`, "market-data"));

  // Start opportunity resolver job (runs every 5 minutes)
  cron.schedule("*/5 * * * *", async () => {
    try {
      log("[Opportunities] Running resolver job...", "opportunities");
      const resolved = await resolveOpportunities();
      if (resolved > 0) {
        log(`[Opportunities] Resolved ${resolved} opportunities`, "opportunities");
      }
    } catch (error: any) {
      log(`[Opportunities] Resolver error: ${error.message}`, "opportunities");
    }
  });
  log("Opportunity resolver job started");

  // Extended hours price tracking job (runs every 5 minutes during 4 AM - 8 PM ET)
  cron.schedule("*/5 * * * *", async () => {
    try {
      // Only track prices during trading hours (including extended hours)
      if (!isWithinAnyTradingHours()) {
        return;
      }
      
      const activeOpportunities = await storage.getActiveOpportunities();
      if (activeOpportunities.length === 0) {
        return;
      }
      
      // Get unique symbols from active opportunities
      const symbols = Array.from(new Set(activeOpportunities.map(o => o.symbol)));
      
      // Get active broker connection
      const connection = await storage.getAnyActiveBrokerConnection();
      if (!connection) {
        return;
      }
      
      const connectionWithToken = await storage.getBrokerConnectionWithToken(connection.userId);
      if (!connectionWithToken || !connectionWithToken.accessToken) {
        return;
      }
      
      // Fetch quotes in batches
      const BATCH_SIZE = 50;
      for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
        const batch = symbols.slice(i, i + BATCH_SIZE);
        try {
          const quotes = await fetchQuotesFromBroker(connectionWithToken, batch);
          
          // Update prices for each symbol
          for (const quote of quotes) {
            if (quote.symbol && quote.last) {
              await updateOpportunityPrices(
                quote.symbol,
                quote.last,
                quote.high,
                quote.low
              );
            }
          }
        } catch (error: any) {
          log(`[Opportunities] Price fetch error for batch: ${error.message}`, "opportunities");
        }
        
        // Small delay between batches
        if (i + BATCH_SIZE < symbols.length) {
          await new Promise(r => setTimeout(r, 200));
        }
      }
    } catch (error: any) {
      log(`[Opportunities] Extended hours tracker error: ${error.message}`, "opportunities");
    }
  });
  log("Extended hours price tracking started (4 AM - 8 PM ET)");

  // Start scheduled scan service (runs at 9:45 AM ET on trading days)
  startScheduledScanService();
  log("Scheduled scan service started");

  // Start exit manager for managed exits (TradeGuard)
  const { startExitManager } = await import("./exit-manager");
  startExitManager();
  log("Exit manager started (TradeGuard)");

  // Start Position Protection worker (user-defined exit rules / trailing stops)
  const { startPositionProtectionWorker } = await import("./position-protection-worker");
  startPositionProtectionWorker();
  log("Position Protection worker started");

  // Start token refresh service for persistent broker connections
  const { startTokenRefreshService } = await import("./token-refresh-service");
  startTokenRefreshService();
  log("Token refresh service started");

  // Start auto agent worker (evaluates opportunities during market hours)
  const { startAgentWorker } = await import("./agent-worker");
  startAgentWorker();
  log("Auto agent worker started");

  // Sync Stripe subscription statuses to partner_users (every 2 minutes)
  cron.schedule("*/2 * * * *", async () => {
    try {
      const partnerUsers = await db.execute(
        sql`SELECT id, stripe_customer_id FROM partner_users WHERE stripe_customer_id IS NOT NULL`
      );
      if (partnerUsers.rows.length === 0) return;

      for (const pu of partnerUsers.rows) {
        try {
          const subResult = await db.execute(
            sql`SELECT id, status FROM stripe.subscriptions WHERE customer = ${pu.stripe_customer_id as string} ORDER BY created DESC LIMIT 1`
          );
          if (subResult.rows[0]) {
            const sub = subResult.rows[0];
            await db.execute(
              sql`UPDATE partner_users SET stripe_subscription_id = ${sub.id as string}, subscription_status = ${sub.status as string} WHERE id = ${pu.id as string}`
            );
          }
        } catch {
          // Skip individual sync errors
        }
      }
    } catch (error: any) {
      // Non-fatal: stripe schema might not exist yet
    }
  });

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // NOTE: /health is registered early in server/routes.ts (first match wins);
  // it includes the non-fatal MCP dependency indicator.

  // Close the MCP session cleanly on shutdown (no-op when MCP is disabled).
  try {
    const { hookMcpShutdown } = await import("./mcp/client");
    hookMcpShutdown();
  } catch {}

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();
