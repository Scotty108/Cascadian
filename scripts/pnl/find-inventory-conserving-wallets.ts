/**
 * Find Inventory-Conserving Wallets
 *
 * These are wallets where CLOB-only data is complete enough that
 * no position goes significantly negative.
 *
 * Wallets with large negative positions are acquiring tokens outside CLOB
 * (splits, merges, transfers) and our CLOB-only PnL formula won't work for them.
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { clickhouse } from '../../lib/clickhouse/client';

// Threshold: max negative token position allowed
const MAX_NEGATIVE_THRESHOLD = -1000; // tokens

async function main() {
  console.log('\n=== Finding Inventory-Conserving Wallets ===\n');

  // Step 1: Find wallets with their worst (most negative) position
  console.log('Step 1: Computing worst position per wallet in pm_unified_ledger_v9_clob_tbl...');
  console.log('(This may take a while for 500M+ rows)\n');

  // First, let's see how many total distinct wallets exist
  const walletCountResult = await clickhouse.query({
    query: `SELECT countDistinct(wallet_address) as cnt FROM pm_unified_ledger_v9_clob_tbl`,
    format: 'JSONEachRow'
  });
  const walletCount = ((await walletCountResult.json()) as any[])[0]?.cnt || 0;
  console.log(`Total distinct wallets in V9 CLOB ledger: ${walletCount.toLocaleString()}`);

  // Count wallets with inventory violations
  console.log('\nStep 2: Counting wallets with inventory violations...');
  console.log(`Threshold: positions with < ${MAX_NEGATIVE_THRESHOLD} tokens are violations\n`);

  const violationQuery = `
    WITH position_totals AS (
      SELECT
        wallet_address,
        condition_id,
        outcome_index,
        sum(token_delta) as net_tokens
      FROM pm_unified_ledger_v9_clob_tbl
      WHERE source_type = 'CLOB'
        AND condition_id IS NOT NULL
        AND condition_id != ''
      GROUP BY wallet_address, condition_id, outcome_index
    ),
    wallet_violations AS (
      SELECT
        wallet_address,
        min(net_tokens) as worst_position,
        countIf(net_tokens < ${MAX_NEGATIVE_THRESHOLD}) as violation_count
      FROM position_totals
      GROUP BY wallet_address
    )
    SELECT
      countIf(violation_count = 0) as conserving_wallets,
      countIf(violation_count > 0) as violating_wallets,
      countIf(worst_position < -100000) as severe_violations,
      countIf(worst_position >= -1000 AND worst_position < -100) as minor_violations,
      count() as total_wallets
    FROM wallet_violations
  `;

  try {
    const result = await clickhouse.query({
      query: violationQuery,
      format: 'JSONEachRow'
    });
    const stats = ((await result.json()) as any[])[0];

    console.log('=== Inventory Conservation Stats ===');
    console.log(`Total wallets analyzed: ${stats.total_wallets.toLocaleString()}`);
    console.log(`Conserving (no violations): ${stats.conserving_wallets.toLocaleString()} (${(stats.conserving_wallets / stats.total_wallets * 100).toFixed(1)}%)`);
    console.log(`Violating (any violations): ${stats.violating_wallets.toLocaleString()} (${(stats.violating_wallets / stats.total_wallets * 100).toFixed(1)}%)`);
    console.log(`Minor violations (-1000 to -100): ${stats.minor_violations.toLocaleString()}`);
    console.log(`Severe violations (< -100k tokens): ${stats.severe_violations.toLocaleString()}`);
  } catch (e: any) {
    console.log(`ERROR: ${e.message?.slice(0, 200)}`);
  }

  // Step 3: Cross-reference with activity criteria
  console.log('\n\nStep 3: Conserving wallets with significant activity...');

  const activeConservingQuery = `
    WITH position_totals AS (
      SELECT
        wallet_address,
        condition_id,
        outcome_index,
        sum(token_delta) as net_tokens
      FROM pm_unified_ledger_v9_clob_tbl
      WHERE source_type = 'CLOB'
        AND condition_id IS NOT NULL
      GROUP BY wallet_address, condition_id, outcome_index
    ),
    wallet_stats AS (
      SELECT
        wallet_address,
        min(net_tokens) as worst_position,
        countIf(net_tokens < ${MAX_NEGATIVE_THRESHOLD}) as violation_count
      FROM position_totals
      GROUP BY wallet_address
    ),
    activity AS (
      SELECT
        wallet_address,
        count() as trade_count,
        sum(abs(usdc_delta)) as volume
      FROM pm_unified_ledger_v9_clob_tbl
      WHERE source_type = 'CLOB'
      GROUP BY wallet_address
    )
    SELECT
      countIf(ws.violation_count = 0 AND a.trade_count >= 20 AND a.volume > 500) as conserving_active_20,
      countIf(ws.violation_count = 0 AND a.trade_count >= 50 AND a.volume > 1000) as conserving_active_50,
      countIf(ws.violation_count = 0 AND a.trade_count >= 100 AND a.volume > 5000) as conserving_active_100
    FROM wallet_stats ws
    JOIN activity a ON ws.wallet_address = a.wallet_address
  `;

  try {
    const result = await clickhouse.query({
      query: activeConservingQuery,
      format: 'JSONEachRow'
    });
    const stats = ((await result.json()) as any[])[0];

    console.log('=== Conserving + Active Wallets ===');
    console.log(`Conserving with 20+ trades, >$500 vol: ${stats.conserving_active_20?.toLocaleString() || 'N/A'}`);
    console.log(`Conserving with 50+ trades, >$1000 vol: ${stats.conserving_active_50?.toLocaleString() || 'N/A'}`);
    console.log(`Conserving with 100+ trades, >$5000 vol: ${stats.conserving_active_100?.toLocaleString() || 'N/A'}`);
  } catch (e: any) {
    console.log(`ERROR: ${e.message?.slice(0, 200)}`);
  }

  // Step 4: Sample some conserving wallets and show their stats
  console.log('\n\nStep 4: Sample conserving wallets...');

  const sampleQuery = `
    WITH position_totals AS (
      SELECT
        wallet_address,
        condition_id,
        outcome_index,
        sum(token_delta) as net_tokens
      FROM pm_unified_ledger_v9_clob_tbl
      WHERE source_type = 'CLOB'
        AND condition_id IS NOT NULL
      GROUP BY wallet_address, condition_id, outcome_index
    ),
    wallet_stats AS (
      SELECT
        wallet_address,
        min(net_tokens) as worst_position,
        countIf(net_tokens < ${MAX_NEGATIVE_THRESHOLD}) as violation_count
      FROM position_totals
      GROUP BY wallet_address
    ),
    activity AS (
      SELECT
        wallet_address,
        count() as trade_count,
        sum(usdc_delta) as net_pnl,
        sum(abs(usdc_delta)) as volume
      FROM pm_unified_ledger_v9_clob_tbl
      WHERE source_type = 'CLOB'
      GROUP BY wallet_address
    )
    SELECT
      a.wallet_address,
      a.trade_count,
      a.net_pnl,
      a.volume,
      ws.worst_position
    FROM wallet_stats ws
    JOIN activity a ON ws.wallet_address = a.wallet_address
    WHERE ws.violation_count = 0
      AND a.trade_count >= 50
      AND a.volume > 1000
    ORDER BY a.net_pnl DESC
    LIMIT 10
  `;

  try {
    const result = await clickhouse.query({
      query: sampleQuery,
      format: 'JSONEachRow'
    });
    const samples = await result.json() as any[];

    console.log('=== Top Conserving Wallets by PnL ===');
    console.log('wallet | trades | PnL | volume | worst_pos');
    console.log('-'.repeat(80));
    for (const w of samples) {
      console.log(`${w.wallet_address.slice(0, 10)}... | ${w.trade_count} | $${Number(w.net_pnl).toLocaleString(undefined, {maximumFractionDigits: 0})} | $${Number(w.volume).toLocaleString(undefined, {maximumFractionDigits: 0})} | ${Number(w.worst_position).toFixed(0)}`);
    }
  } catch (e: any) {
    console.log(`ERROR: ${e.message?.slice(0, 200)}`);
  }

  console.log('\n');
}

main().catch(console.error);
