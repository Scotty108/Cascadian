#!/usr/bin/env tsx
/**
 * Deploy ETL Guardrail Infrastructure
 * Creates:
 * - pm_trades_attribution_conflicts (quarantine table)
 * - pm_collision_monitor_log (nightly monitoring)
 */

import { config } from 'dotenv';
import { resolve } from 'path';

// Load environment variables
config({ path: resolve(__dirname, '../.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

async function deployGuardrailTables() {
  console.log('🛡️  Deploying ETL Guardrail Infrastructure...\n');

  try {
    // 1. Create Attribution Conflicts Quarantine Table
    console.log('Creating pm_trades_attribution_conflicts table...');
    await clickhouse.command({
      query: `
        CREATE TABLE IF NOT EXISTS pm_trades_attribution_conflicts (
          transaction_hash String,
          wallet_address String,
          wallet_canonical String,
          condition_id_norm_v3 String,
          trade_direction Enum8('BUY'=1, 'SELL'=2, 'UNKNOWN'=0),
          shares Decimal(18, 8),
          usd_value Decimal(18, 2),
          timestamp DateTime,
          detected_at DateTime DEFAULT now(),
          resolution_status Enum8('unresolved'=0, 'resolved'=1, 'ignored'=2) DEFAULT 'unresolved',
          resolution_notes String DEFAULT '',
          source_system String DEFAULT 'etl_guardrail'
        ) ENGINE = MergeTree()
        ORDER BY (detected_at, transaction_hash)
      `
    });
    console.log('✅ pm_trades_attribution_conflicts created\n');

    // 2. Create Collision Monitor Log Table
    console.log('Creating pm_collision_monitor_log table...');
    await clickhouse.command({
      query: `
        CREATE TABLE IF NOT EXISTS pm_collision_monitor_log (
          check_date Date,
          check_timestamp DateTime DEFAULT now(),
          new_conflicts UInt32,
          affected_volume Decimal(18, 2),
          conflict_tx_hashes Array(String),
          conflict_details String
        ) ENGINE = MergeTree()
        ORDER BY (check_date, check_timestamp)
      `
    });
    console.log('✅ pm_collision_monitor_log created\n');

    // 3. Verify tables exist
    console.log('Verifying table creation...');
    const tables = await clickhouse.query({
      query: `
        SELECT
          name,
          engine,
          total_rows,
          formatReadableSize(total_bytes) AS size
        FROM system.tables
        WHERE database = currentDatabase()
          AND name IN ('pm_trades_attribution_conflicts', 'pm_collision_monitor_log')
        ORDER BY name
      `,
      format: 'JSONEachRow'
    });

    console.log('\n📊 Guardrail Tables Status:');
    console.log(JSON.stringify(tables.json(), null, 2));

    console.log('\n✅ Guardrail infrastructure deployed successfully!');

  } catch (error) {
    console.error('❌ Deployment failed:', error);
    throw error;
  }
}

deployGuardrailTables().catch(console.error);
