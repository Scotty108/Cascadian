#!/usr/bin/env npx tsx
/**
 * Build Realized Profit Table - Streaming Approach
 *
 * Avoids ClickHouse memory issues by:
 * 1. Streaming raw events (no GROUP BY aggregation in CH)
 * 2. Deduping by event_id in TypeScript
 * 3. Computing profit in TypeScript
 * 4. Batch inserts
 *
 * FROZEN LOGIC - DO NOT MODIFY PROFIT CALCULATION
 * Last validated: 2025-12-13
 * Validation wallets match UI within $1:
 *   - 0x132b: $2068.50
 *   - 0x0030: $4335.50
 *   - 0x3d6d: $4494.50
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@clickhouse/client';
import { execSync } from 'child_process';

// ============================================================================
// CANONICAL TABLE CONSTANTS - DO NOT CHANGE WITHOUT UPDATING POLICY DOC
// ============================================================================
const TOKEN_MAP_TABLE = 'pm_token_to_condition_map_v5';  // Cron-rebuilt, no duplicates
const COHORT_TABLE = 'pm_hc_leaderboard_cohort_all_v1';
const OUTPUT_TABLE = 'pm_wallet_realized_profit_hc_v1';
const RESOLUTIONS_TABLE = 'pm_condition_resolutions';
const TRADER_EVENTS_TABLE = 'pm_trader_events_v2';

const WALLET_BATCH_SIZE = 200;
const INSERT_BATCH_SIZE = 10;
const WALLET_LIMIT = parseInt(process.env.WALLET_LIMIT || '24514');

function getGitCommit(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
  } catch {
    return 'unknown';
  }
}

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 600000, // 10 minutes
  compression: { request: true, response: true },
});

interface RawEvent {
  event_id: string;
  wallet: string;
  condition_id: string;
  outcome_index: number;
  side: string;
  usdc_amount: string;
  token_amount: string;
}

interface Redemption {
  wallet: string;
  condition_id: string;
  redemption_payout: number;
}

interface Resolution {
  condition_id: string;
  payout_0: number;
  payout_1: number;
}

interface WalletProfit {
  wallet: string;
  polymarket_url: string;
  realized_profit_usd: number;
  realized_profit_from_redemptions: number;
  realized_profit_from_sells: number;
  realized_loss_from_resolutions: number;
  total_buy_usdc: number;
  total_sell_usdc: number;
  total_redemption_payout: number;
  n_markets: number;
  // New metrics
  win_count: number;
  loss_count: number;
  resolved_markets: number;
  win_rate: number;
  roi_pct: number;
}

function computeWalletProfit(
  wallet: string,
  events: RawEvent[],
  redemptions: Redemption[],
  resolutions: Map<string, Resolution>
): WalletProfit {
  // Build position aggregates from deduped events
  const positions = new Map<string, {
    condition_id: string;
    outcome_index: number;
    buy_usdc: number;
    sell_usdc: number;
    buy_tokens: number;
    sell_tokens: number;
  }>();

  for (const e of events) {
    const key = `${e.condition_id}_${e.outcome_index}`;
    if (!positions.has(key)) {
      positions.set(key, {
        condition_id: e.condition_id,
        outcome_index: e.outcome_index,
        buy_usdc: 0,
        sell_usdc: 0,
        buy_tokens: 0,
        sell_tokens: 0,
      });
    }
    const pos = positions.get(key)!;
    const usdc = Number(e.usdc_amount) / 1e6;
    const tokens = Number(e.token_amount) / 1e6;

    if (e.side === 'buy') {
      pos.buy_usdc += usdc;
      pos.buy_tokens += tokens;
    } else {
      pos.sell_usdc += usdc;
      pos.sell_tokens += tokens;
    }
  }

  // Build redemption map
  const redemptionMap = new Map<string, number>();
  let totalRedemptionPayout = 0;
  for (const r of redemptions) {
    if (r.wallet.toLowerCase() === wallet) {
      redemptionMap.set(r.condition_id.toLowerCase(), r.redemption_payout);
      totalRedemptionPayout += r.redemption_payout;
    }
  }

  // Calculate profit and track per-market outcomes for win_rate
  let redemptionProfit = 0;
  let sellProfit = 0;
  let unredeemedLoss = 0;
  let totalBuyUsdc = 0;
  let totalSellUsdc = 0;
  const uniqueConditions = new Set<string>();

  // Track per-market PnL for win_rate calculation
  const marketPnL = new Map<string, number>(); // condition_id -> total PnL

  for (const [, pos] of positions) {
    uniqueConditions.add(pos.condition_id);
    totalBuyUsdc += pos.buy_usdc;
    totalSellUsdc += pos.sell_usdc;

    const netTokens = pos.buy_tokens - pos.sell_tokens;
    const avgBuyPrice = pos.buy_tokens > 0 ? pos.buy_usdc / pos.buy_tokens : 0;
    let positionPnL = 0;

    // Skip synthetic positions (sold without buying)
    if (pos.buy_tokens === 0 && pos.sell_tokens > 0) {
      continue;
    }

    // Real sells profit - only on tokens we actually owned (not synthetic sells)
    // BUG FIX 2025-12-13: When sell_tokens > buy_tokens, only calculate profit
    // on the portion we actually owned, not the synthetic portion
    if (pos.sell_tokens > 0 && pos.buy_tokens > 0) {
      const ownedTokensSold = Math.min(pos.buy_tokens, pos.sell_tokens);
      const proportionOwned = ownedTokensSold / pos.sell_tokens;
      const ownedProceeds = pos.sell_usdc * proportionOwned;
      const ownedCostBasis = ownedTokensSold * avgBuyPrice;
      const thisSellProfit = ownedProceeds - ownedCostBasis;
      sellProfit += thisSellProfit;
      positionPnL += thisSellProfit;
    }

    // Resolution profit/loss for held tokens
    if (netTokens > 0) {
      const resolution = resolutions.get(pos.condition_id.toLowerCase());
      if (resolution) {
        const payoutKey = pos.outcome_index === 0 ? 'payout_0' : 'payout_1';
        const payout = resolution[payoutKey];
        const costBasis = netTokens * avgBuyPrice;

        if (payout > 0) {
          // Win: profit = payout - cost_basis
          const thisRedemptionProfit = netTokens * payout - costBasis;
          redemptionProfit += thisRedemptionProfit;
          positionPnL += thisRedemptionProfit;
        } else {
          // Loss: -cost_basis
          unredeemedLoss -= costBasis;
          positionPnL -= costBasis;
        }
      }
    }

    // Accumulate PnL per market (condition_id)
    const conditionId = pos.condition_id.toLowerCase();
    marketPnL.set(conditionId, (marketPnL.get(conditionId) || 0) + positionPnL);
  }

  // Calculate win/loss counts from per-market PnL
  let winCount = 0;
  let lossCount = 0;
  for (const [conditionId, pnl] of marketPnL) {
    // Only count resolved markets
    if (resolutions.has(conditionId)) {
      if (pnl > 0) winCount++;
      else if (pnl < 0) lossCount++;
      // pnl === 0 is break-even, don't count as win or loss
    }
  }
  const resolvedMarkets = winCount + lossCount;

  const realizedProfitUsd = redemptionProfit + sellProfit + unredeemedLoss;
  const winRate = resolvedMarkets > 0 ? winCount / resolvedMarkets : 0;
  const roiPct = totalBuyUsdc > 0 ? (realizedProfitUsd / totalBuyUsdc) * 100 : 0;

  return {
    wallet,
    polymarket_url: `https://polymarket.com/profile/${wallet}`,
    realized_profit_usd: realizedProfitUsd,
    realized_profit_from_redemptions: redemptionProfit,
    realized_profit_from_sells: sellProfit,
    realized_loss_from_resolutions: unredeemedLoss,
    total_buy_usdc: totalBuyUsdc,
    total_sell_usdc: totalSellUsdc,
    total_redemption_payout: totalRedemptionPayout,
    n_markets: uniqueConditions.size,
    // New metrics
    win_count: winCount,
    loss_count: lossCount,
    resolved_markets: resolvedMarkets,
    win_rate: winRate,
    roi_pct: roiPct,
  };
}

async function processWalletBatch(
  wallets: string[],
  resolutions: Map<string, Resolution>
): Promise<WalletProfit[]> {
  const walletSet = new Set(wallets.map(w => w.toLowerCase()));
  const walletsIn = wallets.map(w => `'${w.toLowerCase()}'`).join(',');

  // Stream events - DEDUPED at SQL level by event_id using any()
  // BUG FIX 2025-12-13: pm_trader_events_v2 has 2x duplicates per event_id
  // IMPORTANT: Use regular JOIN, not ANY INNER JOIN (ANY drops rows silently)
  const eventsQ = await clickhouse.query({
    query: `
      SELECT
        d.event_id,
        d.wallet,
        m.condition_id,
        m.outcome_index,
        d.side,
        d.usdc_amount,
        d.token_amount
      FROM (
        SELECT
          event_id,
          lower(any(trader_wallet)) as wallet,
          any(trade_time) as trade_time,
          any(token_id) as token_id,
          any(side) as side,
          any(usdc_amount) as usdc_amount,
          any(token_amount) as token_amount
        FROM ${TRADER_EVENTS_TABLE}
        WHERE lower(trader_wallet) IN (${walletsIn})
        GROUP BY event_id
      ) d
      JOIN ${TOKEN_MAP_TABLE} m ON d.token_id = m.token_id_dec
      ORDER BY d.wallet, d.trade_time
    `,
    format: 'JSONEachRow'
  });
  const allEvents = await eventsQ.json() as RawEvent[];

  // Get redemptions for this batch
  const redemptionsQ = await clickhouse.query({
    query: `
      SELECT lower(wallet) as wallet, condition_id, redemption_payout
      FROM pm_redemption_payouts_agg
      WHERE lower(wallet) IN (${walletsIn})
    `,
    format: 'JSONEachRow'
  });
  const redemptions = await redemptionsQ.json() as Redemption[];

  // Dedupe events by event_id in TypeScript
  const walletEvents = new Map<string, RawEvent[]>();
  const seenEvents = new Set<string>();

  for (const e of allEvents) {
    if (seenEvents.has(e.event_id)) continue;
    seenEvents.add(e.event_id);

    const w = e.wallet.toLowerCase();
    if (!walletSet.has(w)) continue;

    if (!walletEvents.has(w)) {
      walletEvents.set(w, []);
    }
    walletEvents.get(w)!.push(e);
  }

  // Compute profit for each wallet
  const results: WalletProfit[] = [];
  for (const wallet of wallets) {
    const events = walletEvents.get(wallet.toLowerCase()) || [];
    const profit = computeWalletProfit(wallet.toLowerCase(), events, redemptions, resolutions);
    results.push(profit);
  }

  return results;
}

async function main() {
  console.log('BUILD REALIZED PROFIT TABLE - STREAMING');
  console.log('='.repeat(80));

  // Startup logging - table names and git commit
  const gitCommit = getGitCommit();
  console.log('CONFIG:');
  console.log(`  Token Map:     ${TOKEN_MAP_TABLE}`);
  console.log(`  Cohort Table:  ${COHORT_TABLE}`);
  console.log(`  Output Table:  ${OUTPUT_TABLE}`);
  console.log(`  Git Commit:    ${gitCommit}`);
  console.log(`  Wallet Batch:  ${WALLET_BATCH_SIZE}`);
  console.log(`  Wallet Limit:  ${WALLET_LIMIT}`);
  console.log('');

  const startTime = Date.now();

  // Guard query: Fail fast if token map has duplicates
  console.log('Step 0: Checking token map for duplicates...');
  const dupCheckQ = await clickhouse.query({
    query: `
      SELECT token_id_dec, count() c
      FROM ${TOKEN_MAP_TABLE}
      GROUP BY token_id_dec
      HAVING c > 1
      LIMIT 1
    `,
    format: 'JSONEachRow'
  });
  const duplicates = await dupCheckQ.json() as any[];
  if (duplicates.length > 0) {
    console.error(`FATAL: Token map ${TOKEN_MAP_TABLE} has duplicates!`);
    console.error(`  Example: token_id_dec=${duplicates[0].token_id_dec} appears ${duplicates[0].c} times`);
    console.error('  This will cause JOIN multiplication. Aborting.');
    process.exit(1);
  }
  console.log('  No duplicates found in token map');

  // Step 1: Get wallets - include validation wallets, then random sample
  console.log('\nStep 1: Getting wallets...');
  const validationWallets = [
    '0x132b505596fadb6971bbb0fbded509421baf3a16',
    '0x0030490676215689d0764b54c135d47f2c310513',
    '0x3d6d9dcc4f40d6447bb650614acc385ff3820dd1',
  ];

  const walletsQ = await clickhouse.query({
    query: `
      SELECT wallet FROM ${COHORT_TABLE}
      WHERE wallet NOT IN (${validationWallets.map(w => `'${w}'`).join(',')})
      ORDER BY rand()
      LIMIT ${Math.max(0, WALLET_LIMIT - validationWallets.length)}
    `,
    format: 'JSONEachRow'
  });
  const randomWallets = (await walletsQ.json() as any[]).map(w => w.wallet.toLowerCase());
  const wallets = [...validationWallets.map(w => w.toLowerCase()), ...randomWallets];
  console.log(`  Found ${wallets.length} wallets (${validationWallets.length} validation + ${randomWallets.length} random)`);

  // Step 2: Load all resolutions once
  console.log('\nStep 2: Loading resolutions...');
  const resolutionsQ = await clickhouse.query({
    query: `
      SELECT
        lower(condition_id) as condition_id,
        toUInt8(JSONExtractInt(payout_numerators, 1) > 0) as payout_0,
        toUInt8(JSONExtractInt(payout_numerators, 2) > 0) as payout_1
      FROM ${RESOLUTIONS_TABLE}
    `,
    format: 'JSONEachRow'
  });
  const resolutions = new Map<string, Resolution>();
  for (const r of await resolutionsQ.json() as Resolution[]) {
    resolutions.set(r.condition_id, r);
  }
  console.log(`  Loaded ${resolutions.size} resolutions`);

  // Step 3: Create table
  console.log('\nStep 3: Creating table...');
  await clickhouse.command({ query: `DROP TABLE IF EXISTS ${OUTPUT_TABLE}` });
  await clickhouse.command({
    query: `
      CREATE TABLE ${OUTPUT_TABLE} (
        wallet String,
        polymarket_url String,
        realized_profit_usd Float64,
        realized_profit_from_redemptions Float64,
        realized_profit_from_sells Float64,
        realized_loss_from_resolutions Float64,
        net_cash_usd Float64,
        total_buy_usdc Float64,
        total_sell_usdc Float64,
        total_redemption_payout Float64,
        n_markets UInt32,
        win_count UInt32,
        loss_count UInt32,
        resolved_markets UInt32,
        win_rate Float64,
        roi_pct Float64,
        computed_at DateTime DEFAULT now()
      ) ENGINE = MergeTree() ORDER BY (wallet)
    `
  });

  // Step 4: Process wallet batches
  console.log('\nStep 4: Processing wallets...');
  let processed = 0;
  let inserted = 0;
  let errors = 0;
  const pendingInserts: WalletProfit[] = [];

  for (let i = 0; i < wallets.length; i += WALLET_BATCH_SIZE) {
    const batch = wallets.slice(i, Math.min(i + WALLET_BATCH_SIZE, wallets.length));

    try {
      const batchResults = await processWalletBatch(batch, resolutions);
      pendingInserts.push(...batchResults);
      processed += batch.length;

      // Flush inserts
      if (pendingInserts.length >= INSERT_BATCH_SIZE) {
        await insertBatch(pendingInserts);
        inserted += pendingInserts.length;
        console.log(`  Inserted ${inserted} rows (processed ${processed}/${wallets.length})`);
        pendingInserts.length = 0;
      }
    } catch (e: any) {
      errors++;
      console.error(`  Batch error: ${e.message.slice(0, 100)}`);
    }
  }

  // Final flush
  if (pendingInserts.length > 0) {
    await insertBatch(pendingInserts);
    inserted += pendingInserts.length;
    console.log(`  Final insert: ${inserted} total rows`);
  }

  // Summary
  console.log('\nStep 5: Summary...');
  const summaryQ = await clickhouse.query({
    query: `
      SELECT
        count() as total,
        round(avg(realized_profit_usd), 2) as avg_profit,
        round(median(realized_profit_usd), 2) as median_profit,
        round(min(realized_profit_usd), 2) as min_profit,
        round(max(realized_profit_usd), 2) as max_profit
      FROM ${OUTPUT_TABLE}
    `,
    format: 'JSONEachRow'
  });
  const summary = (await summaryQ.json() as any[])[0];
  console.log(`  Total: ${summary.total} wallets`);
  console.log(`  Avg:   $${summary.avg_profit}`);
  console.log(`  Min:   $${summary.min_profit}`);
  console.log(`  Max:   $${summary.max_profit}`);

  // Verify
  console.log('\n' + '='.repeat(80));
  console.log('VERIFICATION:');
  const verifyWallets = [
    { wallet: '0x132b505596fadb6971bbb0fbded509421baf3a16', ui_pnl: 2068.50 },
    { wallet: '0x0030490676215689d0764b54c135d47f2c310513', ui_pnl: 4335.50 },
    { wallet: '0x3d6d9dcc4f40d6447bb650614acc385ff3820dd1', ui_pnl: 4494.50 },
  ];

  for (const v of verifyWallets) {
    const q = await clickhouse.query({
      query: `SELECT realized_profit_usd FROM ${OUTPUT_TABLE} WHERE wallet = '${v.wallet.toLowerCase()}'`,
      format: 'JSONEachRow'
    });
    const result = (await q.json() as any[])[0];
    if (result) {
      const profit = Number(result.realized_profit_usd);
      const match = Math.abs(profit - v.ui_pnl) < 1 ? '✅' : '❌';
      console.log(`  ${v.wallet.slice(0, 10)}... | UI: $${v.ui_pnl.toFixed(2)} | Ours: $${profit.toFixed(2)} | ${match}`);
    } else {
      console.log(`  ${v.wallet.slice(0, 10)}... | NOT IN SAMPLE (random)`);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nCompleted in ${elapsed}s (${errors} errors)`);

  await clickhouse.close();
}

async function insertBatch(results: WalletProfit[]) {
  const values = results.map(r => ({
    wallet: r.wallet,
    polymarket_url: r.polymarket_url,
    realized_profit_usd: r.realized_profit_usd,
    realized_profit_from_redemptions: r.realized_profit_from_redemptions,
    realized_profit_from_sells: r.realized_profit_from_sells,
    realized_loss_from_resolutions: r.realized_loss_from_resolutions,
    net_cash_usd: r.total_sell_usdc - r.total_buy_usdc + r.total_redemption_payout,
    total_buy_usdc: r.total_buy_usdc,
    total_sell_usdc: r.total_sell_usdc,
    total_redemption_payout: r.total_redemption_payout,
    n_markets: r.n_markets,
    win_count: r.win_count,
    loss_count: r.loss_count,
    resolved_markets: r.resolved_markets,
    win_rate: r.win_rate,
    roi_pct: r.roi_pct,
  }));

  await clickhouse.insert({
    table: OUTPUT_TABLE,
    values,
    format: 'JSONEachRow',
  });
}

main().catch(console.error);
