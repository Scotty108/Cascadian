#!/usr/bin/env npx tsx

/**
 * Execute Market ID Normalization Migration (CORRECTED)
 *
 * Builds outcome_positions_v2 and trade_cashflows_v3 directly from clob_fills
 * (not from broken trades_dedup_view)
 */

import { clickhouse } from '../lib/clickhouse/client.js';
import { config } from 'dotenv';
import { resolve } from 'path';

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
  console.log('MARKET ID NORMALIZATION MIGRATION (CORRECTED - FROM CLOB_FILLS)');
  console.log('════════════════════════════════════════════════════════════════════');
  console.log('Started:', new Date().toISOString());
  console.log();

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
          lower(cf.proxy_wallet) AS wallet,
          lower(replaceAll(cf.condition_id, '0x', '')) AS condition_id_norm,
          -- Extract outcome index from asset_id (last digit maps to outcome)
          -- For now, default to 0 until we decode asset_id properly
          0 AS outcome_idx,
          sum(if(cf.side = 'BUY', 1.0, -1.0) * cf.size) AS net_shares
        FROM clob_fills AS cf
        WHERE cf.condition_id IS NOT NULL
          AND cf.condition_id != ''
          AND cf.condition_id != '0x0000000000000000000000000000000000000000000000000000000000000000'
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
          lower(cf.proxy_wallet) AS wallet,
          lower(replaceAll(cf.condition_id, '0x', '')) AS condition_id_norm,
          0 AS outcome_idx,
          cf.price AS px,
          cf.size AS sh,
          round(cf.price * cf.size * if(cf.side = 'BUY', -1, 1), 8) AS cashflow_usdc
        FROM clob_fills AS cf
        WHERE cf.condition_id IS NOT NULL
          AND cf.condition_id != ''
          AND cf.condition_id != '0x0000000000000000000000000000000000000000000000000000000000000000'
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
