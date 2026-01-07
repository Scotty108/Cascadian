/**
 * Build High-Return Leaderboard
 *
 * Two-stage pipeline:
 * 1. SQL pre-filter: Find top N candidates by approximate return
 * 2. CCR-v1 validation: Calculate actual metrics
 *
 * Filters:
 * - No external ERC1155 transfers (CLOB-only)
 * - 10+ markets traded
 * - >$200 realized PnL
 * - Active in last 60 days
 *
 * Ranks by: avg_return_pct = realized_pnl / volume * 100
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../../lib/clickhouse/client';
import { computeCCRv1 } from '../../lib/pnl/ccrEngineV1';

const CANDIDATE_LIMIT = 200; // SQL pre-filter top N
const MIN_PNL = 200;
const MIN_MARKETS = 10;
const MIN_RETURN_PCT = 5; // 5% minimum return

interface LeaderboardEntry {
  rank: number;
  wallet: string;
  realized_pnl: number;
  volume: number;
  avg_return_pct: number;
  win_rate: number;
  win_count: number;
  loss_count: number;
  markets: number;
  resolved: number;
  pnl_confidence: string;
}

async function getCandidates(): Promise<{ wallet: string; approx_return: number }[]> {
  console.log(`\nStage 1: SQL pre-filter (top ${CANDIDATE_LIMIT} by approx return)...`);

  const query = `
    WITH
    -- CLOB activity
    clob_stats AS (
      SELECT
        lower(trader_wallet) as wallet,
        countDistinct(token_id) as markets,
        sumIf(usdc_amount, side = 'buy') / 1e6 as buy_volume,
        sumIf(usdc_amount, side = 'sell') / 1e6 as sell_volume
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
        AND role = 'maker'
        AND trade_time >= now() - INTERVAL 60 DAY
      GROUP BY wallet
      HAVING markets >= ${MIN_MARKETS}
        AND buy_volume >= 100  -- Min investment
    ),
    -- CTF redemptions
    redemptions AS (
      SELECT
        lower(user_address) as wallet,
        sum(toFloat64OrZero(amount_or_payout)) / 1e6 as redemption_value
      FROM pm_ctf_events
      WHERE event_type = 'PayoutRedemption'
        AND is_deleted = 0
        AND event_timestamp >= now() - INTERVAL 60 DAY
      GROUP BY wallet
    )
    -- Note: Removed external ERC1155 filter (too aggressive, blocks 100% of wallets)
    -- CCR-v1's external_sell_ratio metric will identify problematic wallets

    SELECT
      c.wallet,
      round((c.sell_volume + coalesce(r.redemption_value, 0) - c.buy_volume) / c.buy_volume * 100, 2) as approx_return
    FROM clob_stats c
    LEFT JOIN redemptions r ON c.wallet = r.wallet
    WHERE (c.sell_volume + coalesce(r.redemption_value, 0)) > c.buy_volume  -- Profitable
    ORDER BY approx_return DESC
    LIMIT ${CANDIDATE_LIMIT}
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as { wallet: string; approx_return: number }[];

  console.log(`  Found ${rows.length} candidates`);
  return rows;
}

async function validateWithCCR(
  candidates: { wallet: string; approx_return: number }[]
): Promise<LeaderboardEntry[]> {
  console.log(`\nStage 2: CCR-v1 validation (${candidates.length} wallets)...`);
  console.log('  This will take ~' + Math.round(candidates.length * 5 / 60) + ' minutes\n');

  const results: LeaderboardEntry[] = [];
  const startTime = Date.now();

  for (let i = 0; i < candidates.length; i++) {
    const { wallet } = candidates[i];
    const pct = ((i + 1) / candidates.length * 100).toFixed(0);
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const eta = Math.round((elapsed / (i + 1)) * (candidates.length - i - 1));

    process.stdout.write(`\r  [${pct}%] ${i + 1}/${candidates.length} | ETA: ${eta}s | ${wallet.slice(0, 12)}...`);

    try {
      const ccr = await computeCCRv1(wallet);

      // Skip debug output
      const avgReturn = ccr.volume_traded > 0
        ? (ccr.realized_pnl / ccr.volume_traded) * 100
        : 0;

      // Apply filters
      if (ccr.realized_pnl >= MIN_PNL && avgReturn >= MIN_RETURN_PCT) {
        results.push({
          rank: 0,
          wallet,
          realized_pnl: ccr.realized_pnl,
          volume: ccr.volume_traded,
          avg_return_pct: avgReturn,
          win_rate: ccr.win_rate,
          win_count: ccr.win_count,
          loss_count: ccr.loss_count,
          markets: ccr.positions_count,
          resolved: ccr.resolved_count,
          pnl_confidence: ccr.pnl_confidence,
        });
      }
    } catch (e: unknown) {
      // Skip errors silently
    }
  }

  console.log(`\n\n  Validated ${results.length} wallets meeting criteria`);
  return results;
}

async function main() {
  console.log('='.repeat(80));
  console.log('HIGH-RETURN LEADERBOARD BUILDER');
  console.log('='.repeat(80));
  console.log(`\nFilters: ${MIN_MARKETS}+ markets, $${MIN_PNL}+ PnL, ${MIN_RETURN_PCT}%+ return, CLOB-only`);

  // Stage 1: SQL pre-filter
  const candidates = await getCandidates();

  if (candidates.length === 0) {
    console.log('\nNo candidates found. Try relaxing filters.');
    return;
  }

  // Stage 2: CCR-v1 validation
  const results = await validateWithCCR(candidates);

  // Sort and rank
  results.sort((a, b) => b.avg_return_pct - a.avg_return_pct);
  results.forEach((r, i) => (r.rank = i + 1));

  // Output
  console.log('\n' + '='.repeat(100));
  console.log('TOP HIGH-RETURN TRADERS');
  console.log('='.repeat(100));
  console.log('');
  console.log(
    'Rank | Wallet                                     | PnL          | Volume       | Return % | Win Rate | Conf'
  );
  console.log('-'.repeat(100));

  for (const r of results.slice(0, 50)) {
    console.log(
      String(r.rank).padStart(4) +
        ' | ' +
        r.wallet.padEnd(42) +
        ' | ' +
        ('$' + r.realized_pnl.toFixed(0)).padStart(12) +
        ' | ' +
        ('$' + (r.volume / 1000).toFixed(1) + 'K').padStart(12) +
        ' | ' +
        (r.avg_return_pct.toFixed(1) + '%').padStart(8) +
        ' | ' +
        ((r.win_rate * 100).toFixed(0) + '%').padStart(8) +
        ' | ' +
        r.pnl_confidence.slice(0, 4)
    );
  }

  console.log('-'.repeat(100));
  console.log(`\nTotal qualifying traders: ${results.length}`);

  // Stats
  if (results.length > 0) {
    const avgReturn = results.reduce((s, r) => s + r.avg_return_pct, 0) / results.length;
    const avgWinRate = results.reduce((s, r) => s + r.win_rate, 0) / results.length;
    console.log(`Average return: ${avgReturn.toFixed(1)}%`);
    console.log(`Average win rate: ${(avgWinRate * 100).toFixed(0)}%`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('Error:', e);
    process.exit(1);
  });
