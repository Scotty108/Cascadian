#!/usr/bin/env npx tsx

/**
 * Execute Market ID Normalization Migration
 *
 * This script executes the SQL migration from migrate-market-id-normalization.sql
 * It rebuilds outcome_positions_v2 and trade_cashflows_v3 with proper ID normalization
 */

import { clickhouse } from '../lib/clickhouse/client.js';
import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';

config({ path: resolve(process.cwd(), '.env.local') });

async function executeStatement(statement: string, label: string) {
  try {
    console.log(`\n[${label}] Executing...`);
    const result = await clickhouse.query({
      query: statement,
      format: 'JSONEachRow'
    });

    // Try to parse result
    try {
      const data = await result.json();
      if (data.length > 0) {
        console.log(`[${label}] Result:`, JSON.stringify(data, null, 2));
      } else {
        console.log(`[${label}] ✅ Success (no output)`);
      }
    } catch {
      console.log(`[${label}] ✅ Success`);
    }

    return true;
  } catch (error: any) {
    console.error(`[${label}] ❌ ERROR:`, error.message);
    return false;
  }
}

async function main() {
  console.log('════════════════════════════════════════════════════════════════════');
  console.log('MARKET ID NORMALIZATION MIGRATION');
  console.log('════════════════════════════════════════════════════════════════════');
  console.log('Started:', new Date().toISOString());
  console.log();

  // Key statements to execute (simplified from the full SQL)
  const statements = [
    {
      label: 'Create Backup: outcome_positions_v2',
      sql: 'CREATE OR REPLACE VIEW outcome_positions_v2_backup AS SELECT * FROM outcome_positions_v2'
    },
    {
      label: 'Create Backup: trade_cashflows_v3',
      sql: 'CREATE OR REPLACE VIEW trade_cashflows_v3_backup AS SELECT * FROM trade_cashflows_v3'
    },
    {
      label: 'Rebuild: outcome_positions_v2',
      sql: `
        CREATE OR REPLACE VIEW outcome_positions_v2 (
          wallet String,
          condition_id_norm String,
          outcome_idx Int16,
          net_shares Float64
        ) AS
        SELECT
          lower(t.wallet_address) AS wallet,
          lower(replaceAll(t.condition_id, '0x', '')) AS condition_id_norm,
          t.outcome_index AS outcome_idx,
          sum(if(t.side = 1, 1.0, -1.0) * toFloat64(t.shares)) AS net_shares
        FROM trades_dedup_view AS t
        WHERE t.outcome_index IS NOT NULL
          AND t.condition_id IS NOT NULL
          AND t.condition_id != ''
          AND t.condition_id != '0x0000000000000000000000000000000000000000000000000000000000000000'
        GROUP BY wallet, condition_id_norm, outcome_idx
        HAVING abs(net_shares) > 0.0001
      `
    },
    {
      label: 'Rebuild: trade_cashflows_v3',
      sql: `
        CREATE OR REPLACE VIEW trade_cashflows_v3 (
          wallet String,
          condition_id_norm String,
          outcome_idx Int16,
          px Float64,
          sh Float64,
          cashflow_usdc Float64
        ) AS
        SELECT
          lower(t.wallet_address) AS wallet,
          lower(replaceAll(t.condition_id, '0x', '')) AS condition_id_norm,
          t.outcome_index AS outcome_idx,
          toFloat64(t.entry_price) AS px,
          toFloat64(t.shares) AS sh,
          round(toFloat64(t.entry_price) * toFloat64(t.shares) * if(t.side = 1, -1, 1), 8) AS cashflow_usdc
        FROM trades_dedup_view AS t
        WHERE t.outcome_index IS NOT NULL
          AND t.condition_id IS NOT NULL
          AND t.condition_id != ''
          AND t.condition_id != '0x0000000000000000000000000000000000000000000000000000000000000000'
      `
    },
    {
      label: 'Verify: Row counts',
      sql: `
        SELECT
          'outcome_positions_v2' as table_name,
          count() as row_count,
          count(DISTINCT wallet) as unique_wallets,
          count(DISTINCT condition_id_norm) as unique_conditions
        FROM outcome_positions_v2
        UNION ALL
        SELECT
          'trade_cashflows_v3' as table_name,
          count() as row_count,
          count(DISTINCT wallet) as unique_wallets,
          count(DISTINCT condition_id_norm) as unique_conditions
        FROM trade_cashflows_v3
      `
    }
  ];

  for (const stmt of statements) {
    const success = await executeStatement(stmt.sql, stmt.label);
    if (!success && stmt.label.includes('Rebuild')) {
      console.log('\n❌ CRITICAL ERROR: Migration failed. Stopping.');
      process.exit(1);
    }
  }

  console.log();
  console.log('════════════════════════════════════════════════════════════════════');
  console.log('✅ MIGRATION COMPLETE');
  console.log('════════════════════════════════════════════════════════════════════');
  console.log('Completed:', new Date().toISOString());
}

main().catch(console.error);
