import pg from 'pg';

const { Pool } = pg;

async function migrate() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });

  console.log('Connecting to database...');
  
  try {
    const client = await pool.connect();
    console.log('Connected. Running migrations...');

    // Add encrypted credential columns to broker_connections
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'broker_connections' AND column_name = 'encrypted_credentials'
        ) THEN
          ALTER TABLE broker_connections ADD COLUMN encrypted_credentials TEXT;
          RAISE NOTICE 'Added encrypted_credentials column';
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'broker_connections' AND column_name = 'credentials_iv'
        ) THEN
          ALTER TABLE broker_connections ADD COLUMN credentials_iv TEXT;
          RAISE NOTICE 'Added credentials_iv column';
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'broker_connections' AND column_name = 'credentials_auth_tag'
        ) THEN
          ALTER TABLE broker_connections ADD COLUMN credentials_auth_tag TEXT;
          RAISE NOTICE 'Added credentials_auth_tag column';
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'broker_connections' AND column_name = 'access_token_expires_at'
        ) THEN
          ALTER TABLE broker_connections ADD COLUMN access_token_expires_at TIMESTAMP;
          RAISE NOTICE 'Added access_token_expires_at column';
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'broker_connections' AND column_name = 'created_at'
        ) THEN
          ALTER TABLE broker_connections ADD COLUMN created_at TIMESTAMP DEFAULT NOW();
          RAISE NOTICE 'Added created_at column';
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'broker_connections' AND column_name = 'updated_at'
        ) THEN
          ALTER TABLE broker_connections ADD COLUMN updated_at TIMESTAMP DEFAULT NOW();
          RAISE NOTICE 'Added updated_at column';
        END IF;
      END $$;
    `);

    // Add SnapTrade columns to users table
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'users' AND column_name = 'snaptrade_user_id'
        ) THEN
          ALTER TABLE users ADD COLUMN snaptrade_user_id VARCHAR;
          RAISE NOTICE 'Added snaptrade_user_id column to users';
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'users' AND column_name = 'snaptrade_user_secret'
        ) THEN
          ALTER TABLE users ADD COLUMN snaptrade_user_secret VARCHAR;
          RAISE NOTICE 'Added snaptrade_user_secret column to users';
        END IF;
      END $$;
    `);
    console.log('Added SnapTrade columns to users table');

    // Create snaptrade_connections table if it doesn't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS snaptrade_connections (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::VARCHAR,
        user_id VARCHAR NOT NULL,
        brokerage_authorization_id VARCHAR NOT NULL,
        broker_name TEXT NOT NULL DEFAULT '',
        broker_slug TEXT,
        account_id VARCHAR,
        account_name TEXT,
        account_number TEXT,
        account_type TEXT,
        is_active BOOLEAN DEFAULT true,
        is_trading_enabled BOOLEAN DEFAULT false,
        last_sync_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('Created/verified snaptrade_connections table');
    
    // Fix existing snaptrade_connections table if it has wrong column names
    await client.query(`
      DO $$
      BEGIN
        -- Rename brokerage_name to broker_name if old column exists
        IF EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'snaptrade_connections' AND column_name = 'brokerage_name'
        ) AND NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'snaptrade_connections' AND column_name = 'broker_name'
        ) THEN
          ALTER TABLE snaptrade_connections RENAME COLUMN brokerage_name TO broker_name;
          RAISE NOTICE 'Renamed brokerage_name to broker_name';
        END IF;

        -- Add missing columns
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'snaptrade_connections' AND column_name = 'broker_slug'
        ) THEN
          ALTER TABLE snaptrade_connections ADD COLUMN broker_slug TEXT;
          RAISE NOTICE 'Added broker_slug column';
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'snaptrade_connections' AND column_name = 'account_type'
        ) THEN
          ALTER TABLE snaptrade_connections ADD COLUMN account_type TEXT;
          RAISE NOTICE 'Added account_type column';
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'snaptrade_connections' AND column_name = 'is_active'
        ) THEN
          ALTER TABLE snaptrade_connections ADD COLUMN is_active BOOLEAN DEFAULT true;
          RAISE NOTICE 'Added is_active column';
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'snaptrade_connections' AND column_name = 'is_trading_enabled'
        ) THEN
          ALTER TABLE snaptrade_connections ADD COLUMN is_trading_enabled BOOLEAN DEFAULT false;
          RAISE NOTICE 'Added is_trading_enabled column';
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'snaptrade_connections' AND column_name = 'last_sync_at'
        ) THEN
          ALTER TABLE snaptrade_connections ADD COLUMN last_sync_at TIMESTAMP;
          RAISE NOTICE 'Added last_sync_at column';
        END IF;
      END $$;
    `);
    console.log('Fixed snaptrade_connections table columns');

    // Add user_id column to watchlists table
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'watchlists' AND column_name = 'user_id'
        ) THEN
          ALTER TABLE watchlists ADD COLUMN user_id VARCHAR;
          RAISE NOTICE 'Added user_id column to watchlists';
        END IF;
      END $$;
    `);

    // Create opportunity_defaults table if it doesn't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS opportunity_defaults (
        user_id VARCHAR PRIMARY KEY,
        default_mode TEXT NOT NULL DEFAULT 'single',
        default_strategy_id TEXT NOT NULL DEFAULT 'VCP',
        default_scan_scope TEXT NOT NULL DEFAULT 'watchlist',
        default_watchlist_id TEXT,
        default_symbol TEXT,
        default_market_index TEXT,
        default_filter_preset TEXT NOT NULL DEFAULT 'balanced',
        auto_run_on_load BOOLEAN DEFAULT false,
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('Created/verified opportunity_defaults table');

    // Create user_settings table if it doesn't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_settings (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::VARCHAR,
        user_id VARCHAR NOT NULL,
        show_tooltips VARCHAR NOT NULL DEFAULT 'true',
        push_notifications_enabled VARCHAR NOT NULL DEFAULT 'false',
        breakout_alerts_enabled VARCHAR NOT NULL DEFAULT 'true',
        stop_alerts_enabled VARCHAR NOT NULL DEFAULT 'true',
        ema_alerts_enabled VARCHAR NOT NULL DEFAULT 'true',
        approaching_alerts_enabled VARCHAR NOT NULL DEFAULT 'true',
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('Created/verified user_settings table');

    // Add preferred_data_source column to user_settings
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'user_settings' AND column_name = 'preferred_data_source'
        ) THEN
          ALTER TABLE user_settings ADD COLUMN preferred_data_source VARCHAR NOT NULL DEFAULT 'twelvedata';
          RAISE NOTICE 'Added preferred_data_source column';
        END IF;
      END $$;
    `);
    console.log('Added/verified preferred_data_source column');

    // Add tutorial tracking columns to user_settings
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'user_settings' AND column_name = 'has_seen_welcome_tutorial'
        ) THEN
          ALTER TABLE user_settings ADD COLUMN has_seen_welcome_tutorial VARCHAR NOT NULL DEFAULT 'false';
          RAISE NOTICE 'Added has_seen_welcome_tutorial column';
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'user_settings' AND column_name = 'has_seen_scanner_tutorial'
        ) THEN
          ALTER TABLE user_settings ADD COLUMN has_seen_scanner_tutorial VARCHAR NOT NULL DEFAULT 'false';
          RAISE NOTICE 'Added has_seen_scanner_tutorial column';
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'user_settings' AND column_name = 'has_seen_vcp_tutorial'
        ) THEN
          ALTER TABLE user_settings ADD COLUMN has_seen_vcp_tutorial VARCHAR NOT NULL DEFAULT 'false';
          RAISE NOTICE 'Added has_seen_vcp_tutorial column';
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'user_settings' AND column_name = 'has_seen_alerts_tutorial'
        ) THEN
          ALTER TABLE user_settings ADD COLUMN has_seen_alerts_tutorial VARCHAR NOT NULL DEFAULT 'false';
          RAISE NOTICE 'Added has_seen_alerts_tutorial column';
        END IF;
      END $$;
    `);
    console.log('Added/verified tutorial tracking columns');

    // Set all existing users to have seen tutorials (so they don't get popups after migration)
    const updateResult = await client.query(`
      UPDATE user_settings 
      SET has_seen_welcome_tutorial = 'true',
          has_seen_scanner_tutorial = 'true',
          has_seen_vcp_tutorial = 'true',
          has_seen_alerts_tutorial = 'true'
      WHERE has_seen_welcome_tutorial = 'false'
    `);
    console.log(`Marked ${updateResult.rowCount} existing users as having seen tutorials`);

    // Create automation_endpoints table if it doesn't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS automation_endpoints (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::VARCHAR,
        user_id VARCHAR NOT NULL,
        name TEXT NOT NULL,
        webhook_url TEXT NOT NULL,
        webhook_secret_encrypted TEXT,
        webhook_secret_iv TEXT,
        webhook_secret_auth_tag TEXT,
        is_active BOOLEAN DEFAULT true,
        last_tested_at TIMESTAMP,
        last_test_success BOOLEAN,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('Created/verified automation_endpoints table');

    // Create trades table if it doesn't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS trades (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::VARCHAR,
        user_id VARCHAR NOT NULL,
        symbol TEXT NOT NULL,
        strategy_id TEXT NOT NULL,
        endpoint_id VARCHAR,
        alert_event_id VARCHAR,
        entry_execution_id VARCHAR,
        exit_execution_id VARCHAR,
        side TEXT NOT NULL DEFAULT 'LONG',
        status TEXT NOT NULL DEFAULT 'OPEN',
        entry_price REAL,
        exit_price REAL,
        quantity REAL,
        stop_loss REAL,
        target REAL,
        pnl REAL,
        pnl_percent REAL,
        setup_payload JSONB,
        entry_timestamp TIMESTAMP DEFAULT NOW(),
        exit_timestamp TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('Created/verified trades table');

    // Add alert_event_id column to trades table if it doesn't exist
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'trades' AND column_name = 'alert_event_id'
        ) THEN
          ALTER TABLE trades ADD COLUMN alert_event_id VARCHAR;
          RAISE NOTICE 'Added alert_event_id column to trades';
        END IF;
      END $$;
    `);
    console.log('Verified alert_event_id column exists in trades');

    // Create execution_requests table if it doesn't exist (matches Drizzle schema)
    await client.query(`
      CREATE TABLE IF NOT EXISTS execution_requests (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::VARCHAR,
        user_id VARCHAR NOT NULL,
        symbol TEXT NOT NULL,
        strategy_id TEXT NOT NULL,
        timeframe TEXT,
        setup_payload JSONB,
        automation_profile_id VARCHAR,
        status TEXT NOT NULL DEFAULT 'CREATED',
        algo_pilotx_reference TEXT,
        redirect_url TEXT,
        error_message TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('Created/verified execution_requests table');

    // Add missing columns to execution_requests table
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'execution_requests' AND column_name = 'timeframe'
        ) THEN
          ALTER TABLE execution_requests ADD COLUMN timeframe TEXT;
          RAISE NOTICE 'Added timeframe column to execution_requests';
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'execution_requests' AND column_name = 'setup_payload'
        ) THEN
          ALTER TABLE execution_requests ADD COLUMN setup_payload JSONB;
          RAISE NOTICE 'Added setup_payload column to execution_requests';
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'execution_requests' AND column_name = 'automation_profile_id'
        ) THEN
          ALTER TABLE execution_requests ADD COLUMN automation_profile_id VARCHAR;
          RAISE NOTICE 'Added automation_profile_id column to execution_requests';
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'execution_requests' AND column_name = 'algo_pilotx_reference'
        ) THEN
          ALTER TABLE execution_requests ADD COLUMN algo_pilotx_reference TEXT;
          RAISE NOTICE 'Added algo_pilotx_reference column to execution_requests';
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'execution_requests' AND column_name = 'redirect_url'
        ) THEN
          ALTER TABLE execution_requests ADD COLUMN redirect_url TEXT;
          RAISE NOTICE 'Added redirect_url column to execution_requests';
        END IF;
      END $$;
    `);
    console.log('Verified all columns exist in execution_requests');

    // Add missing columns to alert_rules table
    await client.query(`
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
          ALTER TABLE alert_rules ADD COLUMN condition_type TEXT DEFAULT 'STAGE_ENTERED';
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
          ALTER TABLE alert_rules ADD COLUMN strategy TEXT DEFAULT 'VCP';
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
    await client.query(`ALTER TABLE alert_rules ALTER COLUMN symbol DROP NOT NULL;`);
    console.log('Verified all columns exist in alert_rules');

    // Create opportunity_first_seen table for tracking when opportunities were first detected
    await client.query(`
      CREATE TABLE IF NOT EXISTS opportunity_first_seen (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::VARCHAR,
        ticker TEXT NOT NULL UNIQUE,
        stage TEXT NOT NULL,
        strategy TEXT,
        first_seen_at TIMESTAMP DEFAULT NOW() NOT NULL,
        last_seen_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
    `);
    console.log('Created/verified opportunity_first_seen table');

    // Create opportunities table for Opportunity Outcome Report
    await client.query(`
      CREATE TABLE IF NOT EXISTS opportunities (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::VARCHAR,
        user_id VARCHAR NOT NULL,
        symbol TEXT NOT NULL,
        strategy_id TEXT NOT NULL,
        strategy_name TEXT NOT NULL,
        timeframe TEXT NOT NULL DEFAULT '1d',
        stage_at_detection TEXT NOT NULL,
        detected_at TIMESTAMP NOT NULL,
        detected_price REAL,
        resistance_price REAL,
        stop_reference_price REAL,
        entry_trigger_price REAL,
        rvol REAL,
        score INTEGER,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        resolved_at TIMESTAMP,
        resolution_outcome TEXT,
        resolution_reason TEXT,
        max_price_after REAL,
        min_price_after REAL,
        max_favorable_move_percent REAL,
        max_adverse_move_percent REAL,
        bars_tracked INTEGER NOT NULL DEFAULT 0,
        active_duration_minutes INTEGER,
        dedupe_key TEXT UNIQUE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    
    // Create indexes for efficient querying
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_opportunities_user_detected ON opportunities(user_id, detected_at DESC);
      CREATE INDEX IF NOT EXISTS idx_opportunities_user_symbol ON opportunities(user_id, symbol);
      CREATE INDEX IF NOT EXISTS idx_opportunities_user_strategy ON opportunities(user_id, strategy_id);
      CREATE INDEX IF NOT EXISTS idx_opportunities_user_status ON opportunities(user_id, status);
    `);
    console.log('Created/verified opportunities table with indexes');

    // Add resolution_price and pnl_percent columns to opportunities table
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'opportunities' AND column_name = 'resolution_price'
        ) THEN
          ALTER TABLE opportunities ADD COLUMN resolution_price REAL;
          RAISE NOTICE 'Added resolution_price column to opportunities';
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'opportunities' AND column_name = 'pnl_percent'
        ) THEN
          ALTER TABLE opportunities ADD COLUMN pnl_percent REAL;
          RAISE NOTICE 'Added pnl_percent column to opportunities';
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'opportunities' AND column_name = 'last_price'
        ) THEN
          ALTER TABLE opportunities ADD COLUMN last_price REAL;
          RAISE NOTICE 'Added last_price column to opportunities';
        END IF;
      END $$;
    `);
    console.log('Added/verified resolution_price, pnl_percent, and last_price columns in opportunities');

    console.log('Migrations complete!');
    client.release();
  } catch (error) {
    console.error('Migration failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
