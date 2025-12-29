/**
 * Single Wallet Reconciliation V1
 *
 * Goal: Single-wallet reconciliation to answer "Is Dome total PnL comparable
 * to our CLOB+CTF ledger totals, and if not, exactly which component differs?"
 *
 * Follows the exact methodology:
 * 1. Lock ONE wallet and ONE timestamp window
 * 2. Determine if Dome is "all venues" vs "CLOB only"
 * 3. Reconcile at transaction level, not totals
 * 4. Build a comparable "total" on your side
 * 5. Make the result actionable
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { clickhouse } from '../../lib/clickhouse/client';

const TARGET_WALLET = '0xb48ef6deecd526c0974c35e1f7b5c3bbd12fa144';
const DOME_API_KEY = '3850d9ac-1c76-4f94-b987-85c2b2d14c89';

// ============================================================================
// STEP 1: Lock wallet and timestamp window
// ============================================================================

async function getTimestampWindow(): Promise<{ clobLastTs: Date; clobFirstTs: Date }> {
  const query = `
    SELECT
      max(trade_time) as last_ts,
      min(trade_time) as first_ts
    FROM pm_trader_events_dedup_v2_tbl
    WHERE lower(trader_wallet) = lower('${TARGET_WALLET}')
  `;
  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  return {
    clobLastTs: new Date(rows[0].last_ts),
    clobFirstTs: new Date(rows[0].first_ts),
  };
}

// ============================================================================
// STEP 2: Determine if Dome is "all venues" vs "CLOB only"
// ============================================================================

async function fetchDomeResponse(wallet: string): Promise<any> {
  const url = `https://api.domeapi.io/v1/polymarket/wallet/pnl/${wallet}?granularity=all`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${DOME_API_KEY}`,
      'Content-Type': 'application/json',
    },
  });
  return await response.json();
}

async function getActivityTypeBreakdown(wallet: string, beforeTs: Date): Promise<Map<string, { count: number; usdc: number }>> {
  const breakdown = new Map<string, { count: number; usdc: number }>();
  const tsEpoch = Math.floor(beforeTs.getTime() / 1000);

  // Paginate through Activity API, only items before clob_last_ts
  let offset = 0;
  const limit = 500;
  let processed = 0;

  while (true) {
    const url = `https://data-api.polymarket.com/activity?user=${wallet}&limit=${limit}&offset=${offset}`;
    const response = await fetch(url, { headers: { accept: 'application/json' } });
    const activities = (await response.json()) as any[];

    if (!Array.isArray(activities) || activities.length === 0) break;

    let foundOld = false;
    for (const a of activities) {
      // Filter to timestamp window
      if (a.timestamp > tsEpoch) continue;
      foundOld = true;

      const type = a.type || 'unknown';
      const stats = breakdown.get(type) || { count: 0, usdc: 0 };
      stats.count++;
      stats.usdc += Number(a.usdcSize) || 0;
      breakdown.set(type, stats);
      processed++;
    }

    // If we've processed items older than our window, stop
    const oldestTs = activities[activities.length - 1]?.timestamp;
    if (oldestTs && oldestTs < tsEpoch - 86400 * 365) break;

    offset += limit;
    if (offset > 5000) break; // Safety limit
  }

  return breakdown;
}

async function checkActivityTradeFields(wallet: string, beforeTs: Date): Promise<{ sample: any[]; venueFields: string[] }> {
  const tsEpoch = Math.floor(beforeTs.getTime() / 1000);
  const url = `https://data-api.polymarket.com/activity?user=${wallet}&limit=50`;
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  const activities = (await response.json()) as any[];

  const trades = activities
    .filter(a => a.type === 'TRADE' && a.timestamp <= tsEpoch)
    .slice(0, 10);

  // Look for venue/source identifier fields
  const venueFields: string[] = [];
  const fieldCandidates = ['marketType', 'orderType', 'exchange', 'amm', 'clob', 'venue', 'source', 'matchType'];

  for (const trade of trades) {
    for (const field of fieldCandidates) {
      if (trade[field] !== undefined && !venueFields.includes(field)) {
        venueFields.push(field);
      }
    }
  }

  return { sample: trades, venueFields };
}

async function getTxHashMatchRate(wallet: string, beforeTs: Date): Promise<{
  sampled: number;
  matched: number;
  rate: number;
  unmatchedSample: string[];
}> {
  const tsEpoch = Math.floor(beforeTs.getTime() / 1000);

  // Sample 200 Activity TRADE tx hashes across history
  const offsets = [0, 200, 400, 600, 800];
  const txHashes: string[] = [];

  for (const offset of offsets) {
    const url = `https://data-api.polymarket.com/activity?user=${wallet}&limit=50&offset=${offset}`;
    const response = await fetch(url, { headers: { accept: 'application/json' } });
    const activities = (await response.json()) as any[];

    const trades = activities.filter(a =>
      a.type === 'TRADE' &&
      a.timestamp <= tsEpoch &&
      a.transactionHash
    );

    for (const t of trades) {
      if (txHashes.length < 200) {
        txHashes.push(t.transactionHash.toLowerCase().replace('0x', ''));
      }
    }
  }

  if (txHashes.length === 0) {
    return { sampled: 0, matched: 0, rate: 0, unmatchedSample: [] };
  }

  // Check existence in CLOB
  const placeholders = txHashes.map(h => `'${h}'`).join(',');
  const query = `
    SELECT DISTINCT lower(hex(transaction_hash)) as tx
    FROM pm_trader_events_dedup_v2_tbl
    WHERE lower(trader_wallet) = lower('${wallet}')
      AND lower(hex(transaction_hash)) IN (${placeholders})
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];
  const matchedSet = new Set(rows.map(r => r.tx));

  const unmatched = txHashes.filter(h => !matchedSet.has(h));

  return {
    sampled: txHashes.length,
    matched: matchedSet.size,
    rate: matchedSet.size / txHashes.length,
    unmatchedSample: unmatched.slice(0, 5),
  };
}

// ============================================================================
// STEP 3: Reconcile at transaction level
// ============================================================================

interface TxComparison {
  txHash: string;
  activityUsdc: number;
  activitySide: string;
  activityTokens: number;
  clobUsdc: number;
  clobFee: number;
  clobSide: string;
  clobTokens: number;
  usdcMatch: boolean;
  sideMatch: boolean;
}

async function reconcileTxLevel(wallet: string, beforeTs: Date): Promise<TxComparison[]> {
  const tsEpoch = Math.floor(beforeTs.getTime() / 1000);

  // Get Activity trades
  const url = `https://data-api.polymarket.com/activity?user=${wallet}&limit=100`;
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  const activities = (await response.json()) as any[];

  const trades = activities.filter(a =>
    a.type === 'TRADE' &&
    a.timestamp <= tsEpoch &&
    a.transactionHash
  ).slice(0, 30);

  const comparisons: TxComparison[] = [];

  for (const trade of trades) {
    const txHashNorm = trade.transactionHash.toLowerCase().replace('0x', '');

    // Get CLOB data for this tx
    const query = `
      SELECT
        side,
        usdc_amount / 1e6 as usdc,
        token_amount / 1e6 as tokens,
        fee_amount / 1e6 as fee
      FROM pm_trader_events_dedup_v2_tbl
      WHERE lower(trader_wallet) = lower('${wallet}')
        AND lower(hex(transaction_hash)) = '${txHashNorm}'
    `;

    const result = await clickhouse.query({ query, format: 'JSONEachRow' });
    const rows = (await result.json()) as any[];

    if (rows.length === 0) continue;

    // Sum CLOB values if multiple fills per tx
    let clobUsdc = 0, clobFee = 0, clobTokens = 0;
    let clobSide = rows[0].side;
    for (const r of rows) {
      clobUsdc += Number(r.usdc);
      clobFee += Number(r.fee);
      clobTokens += Number(r.tokens);
    }

    const activityUsdc = Number(trade.usdcSize) || 0;
    const activityTokens = Number(trade.size) || 0;
    const activitySide = trade.side?.toUpperCase() || '';

    comparisons.push({
      txHash: trade.transactionHash.slice(0, 16) + '...',
      activityUsdc,
      activitySide,
      activityTokens,
      clobUsdc,
      clobFee,
      clobSide: clobSide.toUpperCase(),
      clobTokens,
      usdcMatch: Math.abs(activityUsdc - clobUsdc) < 1,
      sideMatch: activitySide === clobSide.toUpperCase(),
    });

    if (comparisons.length >= 20) break;
  }

  return comparisons;
}

// ============================================================================
// STEP 4: Build comparable total
// ============================================================================

async function getClobNetCashflow(wallet: string, beforeTs: Date): Promise<{
  netCashflow: number;
  buyUsdc: number;
  sellUsdc: number;
  totalFees: number;
  tradeCount: number;
}> {
  const query = `
    SELECT
      sum(
        case
          when side = 'buy'  then -(usdc_amount + fee_amount)
          when side = 'sell' then  (usdc_amount - fee_amount)
          else 0
        end
      ) / 1e6 as net_cashflow,
      sumIf(usdc_amount, side = 'buy') / 1e6 as buy_usdc,
      sumIf(usdc_amount, side = 'sell') / 1e6 as sell_usdc,
      sum(fee_amount) / 1e6 as total_fees,
      count(*) as trade_count
    FROM pm_trader_events_dedup_v2_tbl
    WHERE lower(trader_wallet) = lower('${wallet}')
      AND trade_time <= '${beforeTs.toISOString().slice(0, 19).replace('T', ' ')}'
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  return {
    netCashflow: Number(rows[0].net_cashflow),
    buyUsdc: Number(rows[0].buy_usdc),
    sellUsdc: Number(rows[0].sell_usdc),
    totalFees: Number(rows[0].total_fees),
    tradeCount: Number(rows[0].trade_count),
  };
}

async function getRedemptionPayouts(wallet: string, beforeTs: Date): Promise<{
  aggTotal: number;
  aggCount: number;
  ctfTotal: number;
  ctfCount: number;
  match: boolean;
}> {
  // From pm_redemption_payouts_agg
  const aggQuery = `
    SELECT
      sum(payout_usdc) as total,
      count(*) as cnt
    FROM pm_redemption_payouts_agg
    WHERE lower(wallet) = lower('${wallet}')
  `;

  // From vw_ctf_ledger (if exists)
  const ctfQuery = `
    SELECT
      sum(payout_value) as total,
      uniqExact(condition_id) as cnt
    FROM vw_ctf_ledger
    WHERE lower(wallet_address) = lower('${wallet}')
      AND payout_value > 0
  `;

  let aggTotal = 0, aggCount = 0, ctfTotal = 0, ctfCount = 0;

  try {
    const aggResult = await clickhouse.query({ query: aggQuery, format: 'JSONEachRow' });
    const aggRows = (await aggResult.json()) as any[];
    aggTotal = Number(aggRows[0]?.total) || 0;
    aggCount = Number(aggRows[0]?.cnt) || 0;
  } catch {}

  try {
    const ctfResult = await clickhouse.query({ query: ctfQuery, format: 'JSONEachRow' });
    const ctfRows = (await ctfResult.json()) as any[];
    ctfTotal = Number(ctfRows[0]?.total) || 0;
    ctfCount = Number(ctfRows[0]?.cnt) || 0;
  } catch {}

  return {
    aggTotal,
    aggCount,
    ctfTotal,
    ctfCount,
    match: Math.abs(aggTotal - ctfTotal) < 1,
  };
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('='.repeat(80));
  console.log('SINGLE WALLET RECONCILIATION V1');
  console.log('='.repeat(80));
  console.log('');
  console.log(`Target wallet: ${TARGET_WALLET}`);
  console.log('');

  // -------------------------------------------------------------------------
  // STEP 1: Lock wallet and timestamp window
  // -------------------------------------------------------------------------
  console.log('--- STEP 1: Timestamp Window ---');
  const { clobLastTs, clobFirstTs } = await getTimestampWindow();
  console.log(`  CLOB first trade: ${clobFirstTs.toISOString()}`);
  console.log(`  CLOB last trade:  ${clobLastTs.toISOString()}`);
  console.log(`  Window: All Activity API items with timestamp <= ${Math.floor(clobLastTs.getTime() / 1000)}`);
  console.log('');

  // -------------------------------------------------------------------------
  // STEP 2: Determine if Dome is "all venues" vs "CLOB only"
  // -------------------------------------------------------------------------
  console.log('--- STEP 2a: Dome Response Inspection ---');
  const domeResp = await fetchDomeResponse(TARGET_WALLET);
  console.log(`  Dome fields: ${Object.keys(domeResp).join(', ')}`);
  console.log(`  Has breakdown: ${domeResp.breakdown ? 'YES' : 'NO'}`);
  console.log(`  Has realized/unrealized split: ${domeResp.realized !== undefined ? 'YES' : 'NO'}`);
  if (domeResp.pnl_over_time?.length > 0) {
    const latest = domeResp.pnl_over_time[domeResp.pnl_over_time.length - 1];
    console.log(`  Latest pnl_to_date: $${Number(latest.pnl_to_date).toFixed(2)}`);
  }
  console.log('');

  console.log('--- STEP 2b: Activity Type Breakdown ---');
  const activityBreakdown = await getActivityTypeBreakdown(TARGET_WALLET, clobLastTs);
  console.log('  Activity types (within timestamp window):');
  for (const [type, stats] of activityBreakdown) {
    console.log(`    ${type}: ${stats.count} items, $${stats.usdc.toFixed(0)} USDC`);
  }
  console.log('');

  console.log('--- STEP 2c: Check for Venue Fields in TRADE Activities ---');
  const { sample: tradeSample, venueFields } = await checkActivityTradeFields(TARGET_WALLET, clobLastTs);
  console.log(`  Checked ${tradeSample.length} TRADE activities`);
  console.log(`  Venue/source fields found: ${venueFields.length > 0 ? venueFields.join(', ') : 'NONE'}`);
  if (tradeSample.length > 0) {
    console.log('  Sample TRADE fields:', Object.keys(tradeSample[0]).slice(0, 15).join(', '));
  }
  console.log('');

  console.log('--- STEP 2d: TX Hash Match Rate (Activity vs CLOB) ---');
  const matchRate = await getTxHashMatchRate(TARGET_WALLET, clobLastTs);
  console.log(`  Sampled ${matchRate.sampled} Activity TRADE tx hashes`);
  console.log(`  Found in CLOB: ${matchRate.matched}`);
  console.log(`  Match rate: ${(matchRate.rate * 100).toFixed(1)}%`);
  if (matchRate.unmatchedSample.length > 0) {
    console.log('  Sample unmatched tx hashes:');
    for (const tx of matchRate.unmatchedSample) {
      console.log(`    0x${tx.slice(0, 20)}...`);
    }
  }
  console.log('');

  // -------------------------------------------------------------------------
  // STEP 3: Reconcile at transaction level
  // -------------------------------------------------------------------------
  console.log('--- STEP 3: Transaction-Level Reconciliation (20 tx) ---');
  const txComparisons = await reconcileTxLevel(TARGET_WALLET, clobLastTs);
  console.log(`  Compared ${txComparisons.length} transactions`);
  console.log('');
  console.log('  tx_hash          | Act USDC   | CLOB USDC  | Fee     | USDC Match | Side Match');
  console.log('  ' + '-'.repeat(85));

  let usdcMatchCount = 0;
  let sideMatchCount = 0;
  for (const c of txComparisons) {
    const actStr = `$${c.activityUsdc.toFixed(2)}`.padStart(10);
    const clobStr = `$${c.clobUsdc.toFixed(2)}`.padStart(10);
    const feeStr = `$${c.clobFee.toFixed(2)}`.padStart(7);
    const usdcMatch = c.usdcMatch ? 'YES' : 'NO';
    const sideMatch = c.sideMatch ? 'YES' : 'NO';

    console.log(`  ${c.txHash} | ${actStr} | ${clobStr} | ${feeStr} | ${usdcMatch.padStart(10)} | ${sideMatch.padStart(10)}`);

    if (c.usdcMatch) usdcMatchCount++;
    if (c.sideMatch) sideMatchCount++;
  }

  console.log('');
  console.log(`  USDC Match Rate: ${usdcMatchCount}/${txComparisons.length} (${(usdcMatchCount / txComparisons.length * 100).toFixed(1)}%)`);
  console.log(`  Side Match Rate: ${sideMatchCount}/${txComparisons.length} (${(sideMatchCount / txComparisons.length * 100).toFixed(1)}%)`);
  console.log('');

  // -------------------------------------------------------------------------
  // STEP 4: Build comparable total
  // -------------------------------------------------------------------------
  console.log('--- STEP 4a: CLOB Net Cashflow ---');
  const clobCashflow = await getClobNetCashflow(TARGET_WALLET, clobLastTs);
  console.log(`  Net cashflow: $${clobCashflow.netCashflow.toFixed(2)}`);
  console.log(`  Buy volume:   $${clobCashflow.buyUsdc.toFixed(2)}`);
  console.log(`  Sell volume:  $${clobCashflow.sellUsdc.toFixed(2)}`);
  console.log(`  Total fees:   $${clobCashflow.totalFees.toFixed(2)}`);
  console.log(`  Trade count:  ${clobCashflow.tradeCount}`);
  console.log('');

  console.log('--- STEP 4b: Redemption Payouts (Consistency Check) ---');
  const redemptions = await getRedemptionPayouts(TARGET_WALLET, clobLastTs);
  console.log(`  pm_redemption_payouts_agg: $${redemptions.aggTotal.toFixed(2)} (${redemptions.aggCount} items)`);
  console.log(`  vw_ctf_ledger:             $${redemptions.ctfTotal.toFixed(2)} (${redemptions.ctfCount} items)`);
  console.log(`  Sources match: ${redemptions.match ? 'YES' : 'NO - FIX REDEMPTION SOURCE FIRST'}`);
  console.log('');

  // -------------------------------------------------------------------------
  // STEP 5: Produce actionable conclusion
  // -------------------------------------------------------------------------
  console.log('='.repeat(80));
  console.log('STEP 5: ACTIONABLE CONCLUSION');
  console.log('='.repeat(80));
  console.log('');

  // Get Dome total for comparison
  const domeTotalPnl = domeResp.pnl_over_time?.length > 0
    ? Number(domeResp.pnl_over_time[domeResp.pnl_over_time.length - 1].pnl_to_date)
    : null;

  console.log('COMPARISON:');
  console.log(`  Dome total PnL:      $${domeTotalPnl?.toFixed(2) ?? 'N/A'}`);
  console.log(`  CLOB net cashflow:   $${clobCashflow.netCashflow.toFixed(2)}`);
  console.log(`  + Redemption (agg):  $${redemptions.aggTotal.toFixed(2)}`);
  console.log(`  = Our realized:      $${(clobCashflow.netCashflow + redemptions.aggTotal).toFixed(2)}`);
  console.log('');

  if (domeTotalPnl !== null) {
    const gap = domeTotalPnl - (clobCashflow.netCashflow + redemptions.aggTotal);
    console.log(`  GAP: $${gap.toFixed(2)}`);
  }
  console.log('');

  // Determine conclusion based on findings
  console.log('FINDINGS:');

  if (matchRate.rate < 0.9) {
    console.log('  [!] Dome includes non-CLOB PnL');
    console.log(`      Only ${(matchRate.rate * 100).toFixed(1)}% of Activity API trades found in CLOB.`);
    console.log('      Dome is NOT a valid ground truth for CLOB-only wallets.');
  } else {
    console.log(`  [✓] TX hash match rate is ${(matchRate.rate * 100).toFixed(1)}% - Activity API trades are mostly in CLOB`);
  }

  if (usdcMatchCount / txComparisons.length < 0.9) {
    console.log('  [!] Our trade cashflow may be wrong');
    console.log(`      Only ${(usdcMatchCount / txComparisons.length * 100).toFixed(1)}% of tx-level USDC values match.`);
    console.log('      Check fee/sign/usdc_amount meaning.');
  } else {
    console.log(`  [✓] TX-level USDC match rate is ${(usdcMatchCount / txComparisons.length * 100).toFixed(1)}% - cashflow terms align`);
  }

  if (!redemptions.match) {
    console.log('  [!] Redemption ingestion is inconsistent');
    console.log(`      pm_redemption_payouts_agg: $${redemptions.aggTotal.toFixed(0)}`);
    console.log(`      vw_ctf_ledger: $${redemptions.ctfTotal.toFixed(0)}`);
    console.log('      FIX REDEMPTION TRUTH FIRST before validating totals.');
  } else {
    console.log('  [✓] Redemption sources are consistent');
  }

  console.log('');
  console.log('='.repeat(80));
}

main().catch(console.error);
