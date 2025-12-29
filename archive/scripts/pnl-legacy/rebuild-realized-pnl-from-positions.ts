#!/usr/bin/env npx tsx

/**
 * Rebuild realized_pnl_by_market_final from outcome_positions_v2 + gamma_resolved
 *
 * Strategy: Atomic rebuild (CREATE TABLE AS SELECT → RENAME)
 * Runtime: ~5-10 minutes
 *
 * Formula:
 * realized_pnl_usd = net_shares * (payout / payout_denominator) - cost_basis
 *
 * Where:
 * - net_shares: from outcome_positions_v2 (aggregated position for wallet+market+outcome)
 * - payout: from gamma_resolved.payout_numerators[outcome_idx + 1] (ClickHouse is 1-indexed!)
 * - payout_denominator: from gamma_resolved
 * - cost_basis: from trade_cashflows_v3 (SUM of cashflows for that position)
 */

import { clickhouse } from '../lib/clickhouse/client.js';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

async function main() {
  console.log('═'.repeat(80));
  console.log('REBUILD: realized_pnl_by_market_final');
  console.log('═'.repeat(80));
  console.log('Strategy: Atomic rebuild from outcome_positions_v2 + gamma_resolved');
  console.log('Runtime: ~5-10 minutes\n');

  const startTime = Date.now();

  // Step 1: Create new table with P&L calculated
  console.log('[1/4] Creating new P&L table with calculated values...');

  await clickhouse.query({
    query: `DROP TABLE IF EXISTS realized_pnl_by_market_new`
  });

  await clickhouse.query({
    query: `
      CREATE TABLE realized_pnl_by_market_new
      ENGINE = MergeTree()
      ORDER BY (wallet, condition_id_norm)
      AS
      SELECT
        op.wallet AS wallet,
        op.condition_id_norm AS condition_id_norm,

        -- Calculate realized P&L for binary markets (Yes/No only)
        -- Winners get net_shares * 1.0, losers get 0
        -- Then subtract cost basis (cashflows spent)
        CASE
          WHEN gr.cid IS NOT NULL THEN
            -- Check if this outcome won
            CASE
              WHEN (op.outcome_idx = 0 AND lower(gr.winning_outcome) = 'yes') OR
                   (op.outcome_idx = 1 AND lower(gr.winning_outcome) = 'no') THEN
                -- Won: get full payout minus cost basis
                op.net_shares - COALESCE(cf_agg.total_cashflow_usd, 0.0)
              ELSE
                -- Lost: only lose the cost basis
                -1.0 * COALESCE(cf_agg.total_cashflow_usd, 0.0)
            END
          ELSE
            0.0  -- Unresolved markets
        END AS realized_pnl_usd

      FROM outcome_positions_v2 AS op

      -- Join with resolutions
      LEFT JOIN gamma_resolved AS gr
        ON op.condition_id_norm = gr.cid

      -- Join with aggregated cashflows for cost basis
      LEFT JOIN (
        SELECT
          wallet,
          condition_id_norm,
          outcome_idx,
          SUM(cashflow_usdc) AS total_cashflow_usd
        FROM trade_cashflows_v3
        GROUP BY wallet, condition_id_norm, outcome_idx
      ) AS cf_agg
        ON op.wallet = cf_agg.wallet
        AND op.condition_id_norm = cf_agg.condition_id_norm
        AND op.outcome_idx = cf_agg.outcome_idx

      WHERE gr.cid IS NOT NULL  -- Only resolved markets
    `
  });

  console.log('   ✅ New table created\n');

  // Step 2: Verify row counts
  console.log('[2/4] Verifying row counts...');

  const [oldResult, newResult] = await Promise.all([
    clickhouse.query({
      query: `
        SELECT
          COUNT(*) as cnt,
          COUNT(DISTINCT wallet) as wallets,
          COUNT(DISTINCT condition_id_norm) as markets
        FROM realized_pnl_by_market_final
      `,
      format: 'JSONEachRow'
    }),
    clickhouse.query({
      query: `
        SELECT
          COUNT(*) as cnt,
          COUNT(DISTINCT wallet) as wallets,
          COUNT(DISTINCT condition_id_norm) as markets
        FROM realized_pnl_by_market_new
      `,
      format: 'JSONEachRow'
    })
  ]);

  const oldData = await oldResult.json();
  const newData = await newResult.json();

  console.log(`   Old table: ${parseInt(oldData[0].cnt).toLocaleString()} rows | ${parseInt(oldData[0].wallets).toLocaleString()} wallets | ${parseInt(oldData[0].markets).toLocaleString()} markets`);
  console.log(`   New table: ${parseInt(newData[0].cnt).toLocaleString()} rows | ${parseInt(newData[0].wallets).toLocaleString()} wallets | ${parseInt(newData[0].markets).toLocaleString()} markets\n`);

  // Step 3: Atomic swap
  console.log('[3/4] Atomic table swap...');

  await clickhouse.query({
    query: `DROP TABLE IF EXISTS realized_pnl_by_market_backup`
  });

  await clickhouse.query({
    query: `RENAME TABLE realized_pnl_by_market_final TO realized_pnl_by_market_backup`
  });

  await clickhouse.query({
    query: `RENAME TABLE realized_pnl_by_market_new TO realized_pnl_by_market_final`
  });

  console.log('   ✅ Swap complete\n');

  // Step 4: Sample verification
  console.log('[4/4] Verifying P&L calculation...');

  const sampleResult = await clickhouse.query({
    query: `
      SELECT
        wallet,
        condition_id_norm,
        realized_pnl_usd
      FROM realized_pnl_by_market_final
      WHERE abs(realized_pnl_usd) > 0
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });

  const samples = await sampleResult.json();
  console.log('   Sample P&L entries:');
  samples.forEach((s: any) => {
    console.log(`     ${s.wallet.substring(0, 12)}... → $${parseFloat(s.realized_pnl_usd).toFixed(2)}`);
  });

  const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

  console.log();
  console.log('═'.repeat(80));
  console.log('✅ REBUILD COMPLETE');
  console.log('═'.repeat(80));
  console.log(`Total time: ${duration} minutes`);
  console.log(`Rows: ${parseInt(newData[0].cnt).toLocaleString()}`);
  console.log(`Wallets: ${parseInt(newData[0].wallets).toLocaleString()}`);
  console.log(`Markets: ${parseInt(newData[0].markets).toLocaleString()}`);
  console.log();
  console.log('💾 Backup: realized_pnl_by_market_backup');
  console.log('═'.repeat(80));
}

main().catch(console.error);
