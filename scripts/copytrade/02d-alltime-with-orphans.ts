/**
 * Phase 2D: All-Time Realized P&L with Orphan Loss Correction
 *
 * KEY FIX: Catches "orphaned" outcomes in sports spread markets.
 * Multi-outcome markets (84+ outcomes) resolve to binary [1,0], orphaning
 * any outcome_index >= 2. These were previously treated as "unresolved"
 * but are actually losses (tokens worth 0).
 *
 * This script produces the CORRECT realized P&L for copy-trading scoring.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@clickhouse/client';
import * as fs from 'fs';

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 600000,
});

export interface AllTimeMetricsFixed {
  wallet: string;
  n_positions: number;
  n_events: number;
  n_trades: number;
  total_notional: number;
  n_resolved: number;
  n_orphaned: number;  // NEW: orphan count
  n_wins: number;
  n_losses: number;
  win_pct: number;
  omega: number;
  realized_pnl: number;
  orphan_pnl: number;  // NEW: orphan loss amount
  gross_wins: number;
  gross_losses: number;
  first_trade: string;
  last_trade: string;
  tier?: string;
}

export async function computeAllTimeWithOrphans(wallets?: string[]): Promise<AllTimeMetricsFixed[]> {
  console.log('=== Phase 2D: All-Time P&L with Orphan Correction ===\n');
  console.log('KEY FIX: Sports spread markets with orphaned outcomes now counted as losses\n');

  // Load Phase 1 candidates if not provided
  if (!wallets) {
    const phase1Path = 'exports/copytrade/phase1_candidates.json';
    if (!fs.existsSync(phase1Path)) {
      throw new Error('Phase 1 output not found. Run 01-build-candidate-universe.ts first.');
    }
    const phase1 = JSON.parse(fs.readFileSync(phase1Path, 'utf-8'));
    wallets = phase1.wallets.map((w: any) => w.wallet);
    console.log(`Loaded ${wallets.length} candidates from Phase 1\n`);
  }

  // Process in batches
  const batchSize = 100;
  const allResults: AllTimeMetricsFixed[] = [];

  for (let i = 0; i < wallets.length; i += batchSize) {
    const batch = wallets.slice(i, i + batchSize);
    const walletList = batch.map(w => `'${w}'`).join(',');
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(wallets.length / batchSize);

    console.log(`Processing batch ${batchNum}/${totalBatches} (${batch.length} wallets)...`);

    // FIXED QUERY: Handles orphaned outcomes correctly
    // For each position:
    // 1. Check if condition is resolved (exists in pm_condition_resolutions)
    // 2. If resolved, check if outcome_index has specific price in vw_pm_resolution_prices
    // 3. If condition resolved but outcome not found, it's an ORPHAN (tokens worth 0)
    const query = `
      SELECT
        wallet,
        count() AS n_positions,
        uniqExact(cond_id) AS n_events,
        sum(trade_count) AS n_trades,
        round(sum(abs_cash_flow), 2) AS total_notional,
        -- Resolution metrics
        sum(is_resolved) AS n_resolved,
        sum(is_orphan) AS n_orphaned,
        sum(is_win) AS n_wins,
        sum(is_loss) AS n_losses,
        round(sum(is_win) / nullIf(sum(is_resolved), 0) * 100, 1) AS win_pct,
        round(sum(win_pnl) / nullIf(abs(sum(loss_pnl)), 0), 2) AS omega,
        round(sum(realized_pnl), 2) AS realized_pnl,
        round(sum(orphan_pnl), 2) AS orphan_pnl,
        round(sum(win_pnl), 2) AS gross_wins,
        round(abs(sum(loss_pnl)), 2) AS gross_losses,
        toString(min(first_trade)) AS first_trade,
        toString(max(last_trade)) AS last_trade
      FROM (
        SELECT
          p.wallet,
          p.condition_id AS cond_id,
          p.outcome_index,
          abs(p.cash_flow) AS abs_cash_flow,
          p.trade_count,
          p.first_trade,
          p.last_trade,
          -- Is condition resolved?
          coalesce(res_cond.is_resolved, 0) AS condition_resolved,
          -- Is this an orphan? (condition resolved but no outcome price)
          if(res_cond.is_resolved = 1 AND res_outcome.resolved_price IS NULL, 1, 0) AS is_orphan,
          -- Is resolved? (condition is resolved, regardless of orphan status)
          coalesce(res_cond.is_resolved, 0) AS is_resolved,
          -- Realized P&L:
          -- - If outcome has price: cash_flow + tokens * price
          -- - If orphan: cash_flow (tokens worth 0)
          -- - If unresolved: 0
          CASE
            WHEN res_outcome.resolved_price IS NOT NULL THEN
              p.cash_flow + (p.final_tokens * res_outcome.resolved_price)
            WHEN res_cond.is_resolved = 1 THEN
              p.cash_flow  -- Orphan: tokens worth 0
            ELSE
              0  -- Unresolved
          END AS realized_pnl,
          -- Orphan P&L separately
          if(res_cond.is_resolved = 1 AND res_outcome.resolved_price IS NULL,
            p.cash_flow, 0) AS orphan_pnl,
          -- Win/loss flags
          if(coalesce(res_cond.is_resolved, 0) = 1 AND
             (CASE
               WHEN res_outcome.resolved_price IS NOT NULL THEN p.cash_flow + (p.final_tokens * res_outcome.resolved_price)
               WHEN res_cond.is_resolved = 1 THEN p.cash_flow
               ELSE 0
             END) > 0, 1, 0) AS is_win,
          if(coalesce(res_cond.is_resolved, 0) = 1 AND
             (CASE
               WHEN res_outcome.resolved_price IS NOT NULL THEN p.cash_flow + (p.final_tokens * res_outcome.resolved_price)
               WHEN res_cond.is_resolved = 1 THEN p.cash_flow
               ELSE 0
             END) <= 0, 1, 0) AS is_loss,
          -- Win/loss amounts
          if(coalesce(res_cond.is_resolved, 0) = 1 AND
             (CASE
               WHEN res_outcome.resolved_price IS NOT NULL THEN p.cash_flow + (p.final_tokens * res_outcome.resolved_price)
               WHEN res_cond.is_resolved = 1 THEN p.cash_flow
               ELSE 0
             END) > 0,
             CASE
               WHEN res_outcome.resolved_price IS NOT NULL THEN p.cash_flow + (p.final_tokens * res_outcome.resolved_price)
               ELSE p.cash_flow
             END, 0) AS win_pnl,
          if(coalesce(res_cond.is_resolved, 0) = 1 AND
             (CASE
               WHEN res_outcome.resolved_price IS NOT NULL THEN p.cash_flow + (p.final_tokens * res_outcome.resolved_price)
               WHEN res_cond.is_resolved = 1 THEN p.cash_flow
               ELSE 0
             END) < 0,
             CASE
               WHEN res_outcome.resolved_price IS NOT NULL THEN p.cash_flow + (p.final_tokens * res_outcome.resolved_price)
               ELSE p.cash_flow
             END, 0) AS loss_pnl
        FROM (
          SELECT
            lower(wallet_address) AS wallet,
            lower(replace(condition_id, '0x', '')) AS condition_id,
            outcome_index,
            sum(usdc_delta) AS cash_flow,
            sum(token_delta) AS final_tokens,
            count() AS trade_count,
            min(event_time) AS first_trade,
            max(event_time) AS last_trade
          FROM pm_unified_ledger_v6
          WHERE lower(wallet_address) IN (${walletList})
            AND source_type = 'CLOB'
            AND condition_id IS NOT NULL
            AND condition_id != ''
          GROUP BY wallet, condition_id, outcome_index
        ) AS p
        -- Join 1: Check if condition is resolved
        LEFT JOIN (
          SELECT lower(condition_id) AS condition_id, 1 AS is_resolved
          FROM pm_condition_resolutions
          WHERE is_deleted = 0
        ) AS res_cond ON p.condition_id = res_cond.condition_id
        -- Join 2: Get specific outcome resolution price
        LEFT JOIN (
          SELECT condition_id, outcome_index, any(resolved_price) AS resolved_price
          FROM vw_pm_resolution_prices
          GROUP BY condition_id, outcome_index
        ) AS res_outcome ON p.condition_id = res_outcome.condition_id AND p.outcome_index = res_outcome.outcome_index
      )
      GROUP BY wallet
    `;

    try {
      const result = await ch.query({ query, format: 'JSONEachRow' });
      const batchResults = await result.json() as AllTimeMetricsFixed[];
      allResults.push(...batchResults);
    } catch (err) {
      console.log(`  Batch ${batchNum} error: ${(err as Error).message.slice(0, 100)}`);
    }
  }

  console.log(`\nComputed P&L with orphan correction for ${allResults.length} wallets`);

  // Get Tier info
  console.log('Fetching tier classifications...');
  const tierQuery = `SELECT wallet, confidence_tier FROM pm_wallet_external_activity_60d`;
  const tierResult = await ch.query({ query: tierQuery, format: 'JSONEachRow' });
  const tiers = await tierResult.json() as any[];
  const tierMap = new Map(tiers.map(t => [t.wallet, t.confidence_tier]));

  for (const r of allResults) {
    r.tier = tierMap.get(r.wallet) || 'Unknown';
  }

  // Show orphan impact
  const withOrphans = allResults.filter(r => r.n_orphaned > 0);
  console.log(`\n${withOrphans.length} wallets have orphaned positions`);
  withOrphans.sort((a, b) => a.orphan_pnl - b.orphan_pnl);
  console.log('\nWorst 10 orphan losses:');
  for (const r of withOrphans.slice(0, 10)) {
    console.log(`  ${r.wallet}: orphan ${r.orphan_pnl.toLocaleString()} | total ${r.realized_pnl.toLocaleString()}`);
  }

  // Gate criteria (same as Phase 2C but now with correct P&L)
  const qualified = allResults.filter(r =>
    r.n_events >= 15 &&
    r.n_resolved >= 8 &&
    r.n_losses >= 4 &&
    r.omega > 1.3 &&
    r.omega < 50 &&
    r.realized_pnl >= 500 &&
    r.total_notional >= 5000 &&
    r.win_pct >= 45 &&
    r.win_pct <= 90
  );

  console.log(`\nAfter gates: ${qualified.length} qualified wallets`);

  // Sort by realized P&L
  qualified.sort((a, b) => b.realized_pnl - a.realized_pnl);

  // Display top 40
  console.log('\n=== TOP 40 by CORRECTED Realized P&L ===');
  console.log('Wallet                                     | Events | Resol | Orph | Win% | Omega | P&L          | Orphan P&L');
  console.log('-------------------------------------------|--------|-------|------|------|-------|--------------|------------');
  for (const r of qualified.slice(0, 40)) {
    const pnl = r.realized_pnl >= 0 ? `+$${r.realized_pnl.toLocaleString()}` : `-$${Math.abs(r.realized_pnl).toLocaleString()}`;
    const orphan = r.orphan_pnl < 0 ? `-$${Math.abs(r.orphan_pnl).toLocaleString()}` : '$0';
    console.log(
      `${r.wallet} | ${String(r.n_events).padStart(6)} | ${String(r.n_resolved).padStart(5)} | ${String(r.n_orphaned).padStart(4)} | ${String(r.win_pct).padStart(4)}% | ${String(r.omega).padStart(5)}x | ${pnl.padStart(12)} | ${orphan.padStart(10)}`
    );
  }

  // Show who got filtered by orphan correction
  const filteredByOrphans = allResults.filter(r =>
    (r.realized_pnl + Math.abs(r.orphan_pnl)) >= 500 &&  // Would have passed without orphan
    r.realized_pnl < 500  // But doesn't pass with orphan
  );
  console.log(`\n=== ${filteredByOrphans.length} wallets filtered OUT by orphan correction ===`);
  filteredByOrphans.sort((a, b) => a.realized_pnl - b.realized_pnl);
  for (const r of filteredByOrphans.slice(0, 10)) {
    const wouldHave = r.realized_pnl - r.orphan_pnl;  // orphan_pnl is negative
    console.log(`  ${r.wallet}: without orphan ${wouldHave.toLocaleString()} → with orphan ${r.realized_pnl.toLocaleString()}`);
  }

  // Save output
  const outputPath = 'exports/copytrade/phase2d_alltime_with_orphans.json';
  fs.writeFileSync(outputPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    phase: '2D',
    description: 'All-Time P&L with orphan loss correction',
    key_fix: 'Sports spread markets - orphaned outcomes (index >= payout array length) now counted as losses',
    gate_criteria: {
      n_events: '>= 15',
      n_resolved: '>= 8',
      n_losses: '>= 4',
      omega: '1.3 - 50',
      realized_pnl: '>= $500 (with orphan correction)',
      total_notional: '>= $5,000',
      win_pct: '45-90%',
    },
    input_count: wallets.length,
    qualified_count: qualified.length,
    wallets_with_orphans: withOrphans.length,
    filtered_by_orphans: filteredByOrphans.length,
    wallets: qualified,
  }, null, 2));
  console.log(`\nSaved to: ${outputPath}`);

  return qualified;
}

async function main() {
  try {
    await computeAllTimeWithOrphans();
  } finally {
    await ch.close();
  }
}

if (require.main === module) {
  main().catch(console.error);
}
