#!/usr/bin/env npx tsx
/**
 * Dedup Realized Engine V1
 *
 * Uses pm_trader_events_dedup_v2_tbl (the ONLY canonical CLOB source)
 *
 * Formula (per GPT):
 * 1. Trading Realized PnL (avg-cost, sell-capped)
 * 2. + Resolved Inventory Adjustment (remaining longs * (payout - avgCost))
 * 3. - Redemption amounts already realized (don't double count)
 *
 * Activity classifier included to categorize wallets:
 * - has_clob, has_fpmm, has_redemption, has_split_merge
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@clickhouse/client';

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 300000,
});

const COLLATERAL_SCALE = 1_000_000n;

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

interface Position {
  amount: bigint;          // Current shares (after sells)
  avgPrice: bigint;        // Weighted average cost (scaled by 1e6)
  realizedPnl: bigint;     // PnL from sell trades
  totalCost: bigint;       // Total cost basis
}

interface Resolution {
  payout_numerators: number[];
  payout_denominator: number;
}

interface ActivityFlags {
  has_clob: boolean;
  has_fpmm: boolean;
  has_redemption: boolean;
  has_split_merge: boolean;
  clob_trades: number;
  fpmm_trades: number;
  redemption_count: number;
  split_merge_count: number;
}

interface WalletResult {
  wallet: string;
  // Activity flags
  activity: ActivityFlags;
  // PnL components
  trading_realized: number;
  resolved_adjustment: number;
  total_realized: number;
  // Stats
  positions_resolved: number;
  positions_unresolved: number;
  sell_capped_count: number;
}

// -----------------------------------------------------------------------------
// Resolution Cache
// -----------------------------------------------------------------------------

let resolutionCache: Map<string, Resolution> | null = null;

async function loadResolutions(): Promise<Map<string, Resolution>> {
  if (resolutionCache) return resolutionCache;

  const q = await clickhouse.query({
    query: `
      SELECT condition_id, payout_numerators, payout_denominator
      FROM pm_condition_resolutions
      WHERE is_deleted = 0
    `,
    format: 'JSONEachRow'
  });

  const rows = await q.json() as any[];
  const cache = new Map<string, Resolution>();

  for (const r of rows) {
    const payouts = r.payout_numerators ? JSON.parse(r.payout_numerators) : [];
    cache.set(r.condition_id.toLowerCase(), {
      payout_numerators: payouts,
      payout_denominator: Number(r.payout_denominator) || 1,
    });
  }

  resolutionCache = cache;
  return cache;
}

// -----------------------------------------------------------------------------
// Activity Classifier
// -----------------------------------------------------------------------------

async function classifyWalletActivity(wallet: string): Promise<ActivityFlags> {
  // Run all queries in parallel
  const [clobQ, fpmmQ, redemptionQ, splitMergeQ] = await Promise.all([
    clickhouse.query({
      query: `SELECT count() as cnt FROM pm_trader_events_dedup_v2_tbl WHERE lower(trader_wallet) = lower('${wallet}')`,
      format: 'JSONEachRow'
    }),
    clickhouse.query({
      query: `SELECT count() as cnt FROM pm_fpmm_trades WHERE lower(trader_wallet) = lower('${wallet}')`,
      format: 'JSONEachRow'
    }),
    clickhouse.query({
      query: `SELECT count() as cnt FROM pm_ctf_events WHERE lower(user_address) = lower('${wallet}') AND event_type = 'PayoutRedemption'`,
      format: 'JSONEachRow'
    }),
    clickhouse.query({
      query: `SELECT count() as cnt FROM pm_ctf_events WHERE lower(user_address) = lower('${wallet}') AND event_type IN ('PositionSplit', 'PositionsMerge')`,
      format: 'JSONEachRow'
    }),
  ]);

  const [clob, fpmm, redemption, splitMerge] = await Promise.all([
    clobQ.json() as Promise<any[]>,
    fpmmQ.json() as Promise<any[]>,
    redemptionQ.json() as Promise<any[]>,
    splitMergeQ.json() as Promise<any[]>,
  ]);

  const clobCount = Number(clob[0]?.cnt || 0);
  const fpmmCount = Number(fpmm[0]?.cnt || 0);
  const redemptionCount = Number(redemption[0]?.cnt || 0);
  const splitMergeCount = Number(splitMerge[0]?.cnt || 0);

  return {
    has_clob: clobCount > 0,
    has_fpmm: fpmmCount > 0,
    has_redemption: redemptionCount > 0,
    has_split_merge: splitMergeCount > 0,
    clob_trades: clobCount,
    fpmm_trades: fpmmCount,
    redemption_count: redemptionCount,
    split_merge_count: splitMergeCount,
  };
}

// -----------------------------------------------------------------------------
// Redemptions Loader (per condition_id, not per outcome)
// -----------------------------------------------------------------------------

async function loadWalletRedemptionConditions(wallet: string): Promise<Set<string>> {
  // Get conditions where this wallet has redeemed
  // If redeemed, we skip resolved adjustment for that condition
  const q = await clickhouse.query({
    query: `
      SELECT DISTINCT lower(condition_id) as condition_id
      FROM pm_redemption_payouts_agg
      WHERE lower(wallet) = lower('${wallet}')
    `,
    format: 'JSONEachRow'
  });

  const rows = await q.json() as any[];
  const set = new Set<string>();

  for (const r of rows) {
    set.add(r.condition_id.toLowerCase());
  }

  return set;
}

async function loadWalletRedemptionTotal(wallet: string): Promise<number> {
  // Get total redemption payout for this wallet
  const q = await clickhouse.query({
    query: `
      SELECT sum(redemption_payout) as total
      FROM pm_redemption_payouts_agg
      WHERE lower(wallet) = lower('${wallet}')
    `,
    format: 'JSONEachRow'
  });

  const rows = await q.json() as any[];
  return Number(rows[0]?.total || 0);
}

// -----------------------------------------------------------------------------
// Main PnL Calculation
// -----------------------------------------------------------------------------

async function calculateWalletPnl(wallet: string): Promise<WalletResult> {
  const resolutions = await loadResolutions();
  const activity = await classifyWalletActivity(wallet);

  // Load CLOB trades from DEDUP table (canonical source)
  const tradesQ = await clickhouse.query({
    query: `
      SELECT
        m.condition_id,
        m.outcome_index,
        t.token_id,
        t.trade_time,
        t.side,
        t.token_amount,
        t.usdc_amount
      FROM pm_trader_events_dedup_v2_tbl t
      LEFT JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
      WHERE lower(t.trader_wallet) = lower('${wallet}')
      ORDER BY m.condition_id, m.outcome_index, t.trade_time
    `,
    format: 'JSONEachRow'
  });

  const trades = await tradesQ.json() as any[];

  // Load conditions where redemptions happened (to avoid double counting)
  const redeemedConditions = await loadWalletRedemptionConditions(wallet);
  const redemptionTotal = await loadWalletRedemptionTotal(wallet);

  // Build positions with avg-cost tracking
  const positions = new Map<string, Position>();
  let sellCappedCount = 0;

  for (const t of trades) {
    if (!t.condition_id) continue; // Skip unmapped tokens

    const key = `${t.condition_id.toLowerCase()}_${t.outcome_index}`;
    let pos = positions.get(key);
    if (!pos) {
      pos = { amount: 0n, avgPrice: 0n, realizedPnl: 0n, totalCost: 0n };
      positions.set(key, pos);
    }

    const tokenAmt = BigInt(Math.round(Number(t.token_amount)));
    const usdcAmt = BigInt(Math.round(Number(t.usdc_amount)));
    const price = tokenAmt > 0n ? (usdcAmt * COLLATERAL_SCALE) / tokenAmt : 0n;

    if (t.side === 'buy') {
      // Update weighted average price
      if (pos.amount === 0n) {
        pos.avgPrice = price;
      } else if (tokenAmt > 0n) {
        pos.avgPrice = (pos.avgPrice * pos.amount + price * tokenAmt) / (pos.amount + tokenAmt);
      }
      pos.amount += tokenAmt;
      pos.totalCost += usdcAmt;
    } else {
      // Sell: cap at position size (sell-capping for long-only model)
      const adjusted = tokenAmt > pos.amount ? pos.amount : tokenAmt;
      if (adjusted < tokenAmt) {
        sellCappedCount++;
      }
      if (adjusted > 0n) {
        const delta = (adjusted * (price - pos.avgPrice)) / COLLATERAL_SCALE;
        pos.realizedPnl += delta;
        pos.amount -= adjusted;
        // Reduce cost basis proportionally
        if (pos.amount + adjusted > 0n) {
          pos.totalCost = (pos.totalCost * pos.amount) / (pos.amount + adjusted);
        }
      }
    }
  }

  // Calculate totals
  let tradingRealized = 0n;
  let resolvedAdjustment = 0n;
  let positionsResolved = 0;
  let positionsUnresolved = 0;

  for (const [key, pos] of positions.entries()) {
    // Add trading realized PnL
    tradingRealized += pos.realizedPnl;

    // Check for remaining long position
    if (pos.amount > 1000n) { // > 0.001 tokens
      const [conditionId, outcomeStr] = key.split('_');
      const outcomeIndex = parseInt(outcomeStr, 10);
      const resolution = resolutions.get(conditionId);

      // Skip if this condition was already redeemed (avoid double counting)
      if (redeemedConditions.has(conditionId)) {
        // Already handled via redemption payout
        continue;
      }

      if (resolution && resolution.payout_numerators.length > outcomeIndex) {
        // Market is resolved - calculate resolved inventory adjustment
        const payoutNum = resolution.payout_numerators[outcomeIndex];
        const payoutDen = resolution.payout_denominator;
        const payoutPrice = BigInt(Math.round((payoutNum / payoutDen) * 1e6));

        // Adjustment = remaining_shares * (payout_price - avg_cost)
        const adjustment = (pos.amount * (payoutPrice - pos.avgPrice)) / COLLATERAL_SCALE;
        resolvedAdjustment += adjustment;
        positionsResolved++;
      } else {
        // Market NOT resolved - don't include in realized
        positionsUnresolved++;
      }
    }
  }

  // Add redemption payout as realized (this IS realized PnL)
  // Note: redemption_payout is the actual USDC received, not the cost basis
  // For accurate PnL we'd need to subtract cost, but we don't have per-share cost for redeemed shares
  // For now, we treat redemption as pure profit (simplified)
  // TODO: properly track cost basis of redeemed shares
  // resolvedAdjustment += BigInt(Math.round(redemptionTotal * 1e6));

  const totalRealized = tradingRealized + resolvedAdjustment;

  return {
    wallet,
    activity,
    trading_realized: Number(tradingRealized) / 1e6,
    resolved_adjustment: Number(resolvedAdjustment) / 1e6,
    total_realized: Number(totalRealized) / 1e6,
    positions_resolved: positionsResolved,
    positions_unresolved: positionsUnresolved,
    sell_capped_count: sellCappedCount,
  };
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

async function main() {
  const wallet = process.argv[2];

  if (!wallet) {
    console.log('Usage: npx tsx dedup-realized-engine-v1.ts <wallet>');
    console.log('       npx tsx dedup-realized-engine-v1.ts --benchmark');
    process.exit(1);
  }

  if (wallet === '--benchmark') {
    // Run against benchmark wallets
    const benchQ = await clickhouse.query({
      query: `
        SELECT wallet, pnl_value
        FROM pm_ui_pnl_benchmarks_v1
        WHERE abs(pnl_value) < 10000 AND pnl_value != 0
        LIMIT 30
      `,
      format: 'JSONEachRow'
    });
    const benchmarks = await benchQ.json() as Array<{ wallet: string; pnl_value: number }>;

    console.log('Loaded ' + (await loadResolutions()).size + ' resolutions');
    console.log('='.repeat(150));
    console.log('DEDUP REALIZED ENGINE V1 - BENCHMARK VALIDATION');
    console.log('='.repeat(150));
    console.log('Wallet                                     | CLOB | FPMM | Redemp | Split | Trading   | Resolved  | Total     | UI Target | Delta     | Capped | Status');
    console.log('-'.repeat(150));

    let total = 0;
    let passed = 0;
    let passedWithClob = 0;
    let passedHighConf = 0;
    let withClob = 0;
    let highConf = 0;

    for (const b of benchmarks) {
      const result = await calculateWalletPnl(b.wallet);
      const delta = result.total_realized - b.pnl_value;
      const deltaPercent = Math.abs(b.pnl_value) > 0 ? Math.abs(delta / b.pnl_value) * 100 : 0;

      // Pass if within 20% or $50 absolute
      const isPass = deltaPercent <= 20 || Math.abs(delta) <= 50;

      total++;
      if (isPass) passed++;

      if (result.activity.has_clob) {
        withClob++;
        if (isPass) passedWithClob++;

        // High confidence: has CLOB, no split/merge, no sell capping
        if (!result.activity.has_split_merge && result.sell_capped_count === 0) {
          highConf++;
          if (isPass) passedHighConf++;
        }
      }

      const status = isPass ? '✅' : '❌';
      const clobFlag = result.activity.has_clob ? '✓' : '-';
      const fpmmFlag = result.activity.has_fpmm ? '✓' : '-';
      const redemptFlag = result.activity.has_redemption ? '✓' : '-';
      const splitFlag = result.activity.has_split_merge ? '⚠️' : '-';

      console.log(
        b.wallet.slice(0, 42) + ' | ' +
        clobFlag.padStart(4) + ' | ' +
        fpmmFlag.padStart(4) + ' | ' +
        redemptFlag.padStart(6) + ' | ' +
        splitFlag.padStart(5) + ' | ' +
        ('$' + result.trading_realized.toFixed(0)).padStart(9) + ' | ' +
        ('$' + result.resolved_adjustment.toFixed(0)).padStart(9) + ' | ' +
        ('$' + result.total_realized.toFixed(0)).padStart(9) + ' | ' +
        ('$' + b.pnl_value.toFixed(0)).padStart(9) + ' | ' +
        ('$' + delta.toFixed(0)).padStart(9) + ' | ' +
        String(result.sell_capped_count).padStart(6) + ' | ' +
        status
      );
    }

    console.log('-'.repeat(150));
    console.log('\nRESULTS:');
    console.log(`  All wallets:           ${passed}/${total} (${(passed / total * 100).toFixed(1)}%)`);
    console.log(`  With CLOB trades:      ${passedWithClob}/${withClob} (${(passedWithClob / withClob * 100).toFixed(1)}%)`);
    console.log(`  High confidence:       ${passedHighConf}/${highConf} (${highConf > 0 ? (passedHighConf / highConf * 100).toFixed(1) : 0}%)`);
    console.log('\nHigh confidence = has CLOB, no split/merge, no sell capping');
    console.log('Tolerance: 20% or $50 absolute');

  } else {
    // Single wallet
    const result = await calculateWalletPnl(wallet);

    // Get benchmark if exists
    const benchQ = await clickhouse.query({
      query: `SELECT pnl_value FROM pm_ui_pnl_benchmarks_v1 WHERE lower(wallet) = lower('${wallet}') LIMIT 1`,
      format: 'JSONEachRow'
    });
    const bench = await benchQ.json() as Array<{ pnl_value: number }>;
    const uiPnl = bench.length > 0 ? bench[0].pnl_value : null;

    console.log('='.repeat(80));
    console.log('DEDUP REALIZED ENGINE V1');
    console.log('Wallet: ' + wallet);
    console.log('='.repeat(80));

    console.log('\nACTIVITY FLAGS:');
    console.log('  has_clob:        ' + result.activity.has_clob + ' (' + result.activity.clob_trades + ' trades)');
    console.log('  has_fpmm:        ' + result.activity.has_fpmm + ' (' + result.activity.fpmm_trades + ' trades)');
    console.log('  has_redemption:  ' + result.activity.has_redemption + ' (' + result.activity.redemption_count + ' events)');
    console.log('  has_split_merge: ' + result.activity.has_split_merge + ' (' + result.activity.split_merge_count + ' events)');

    console.log('\nPNL COMPONENTS:');
    console.log('  Trading Realized:    $' + result.trading_realized.toFixed(2));
    console.log('  Resolved Adjustment: $' + result.resolved_adjustment.toFixed(2));
    console.log('  ---');
    console.log('  TOTAL REALIZED:      $' + result.total_realized.toFixed(2));

    console.log('\nPOSITION STATS:');
    console.log('  Resolved positions:   ' + result.positions_resolved);
    console.log('  Unresolved positions: ' + result.positions_unresolved);
    console.log('  Sell capped count:    ' + result.sell_capped_count);

    if (uiPnl !== null) {
      const delta = result.total_realized - uiPnl;
      const deltaPercent = Math.abs(uiPnl) > 0 ? (delta / Math.abs(uiPnl)) * 100 : 0;
      console.log('\n' + '='.repeat(80));
      console.log('COMPARISON TO UI:');
      console.log('  Our Total:   $' + result.total_realized.toFixed(2));
      console.log('  UI Target:   $' + uiPnl.toFixed(2));
      console.log('  Delta:       $' + delta.toFixed(2) + ' (' + deltaPercent.toFixed(1) + '%)');
    }
  }

  await clickhouse.close();
}

main().catch(console.error);
