#!/usr/bin/env npx tsx
/**
 * Build Realized Profit Table - Batch Processor
 *
 * Uses the same validated logic from compute-realized-profit-v1.ts
 * to process all HC wallets and write to ClickHouse.
 *
 * This approach is more reliable than complex SQL CTEs because:
 * 1. Same logic that was validated against UI
 * 2. Easier to debug and maintain
 * 3. Handles edge cases correctly
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@clickhouse/client';

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 300000,
});

interface MarketPosition {
  condition_id: string;
  outcome_index: number;
  buy_usdc: number;
  sell_usdc: number;
  buy_tokens: number;
  sell_tokens: number;
  net_tokens: number;
  avg_buy_price: number;
}

interface Redemption {
  condition_id: string;
  redemption_payout: number;
}

interface WalletProfit {
  wallet: string;
  realized_profit: number;
  redemption_profit: number;
  sell_profit: number;
  unredeemed_loss: number;
  total_buy_usdc: number;
  total_sell_usdc: number;
  total_redemption_payout: number;
  n_markets: number;
}

async function computeWalletProfit(wallet: string): Promise<WalletProfit> {
  const walletLower = wallet.toLowerCase();

  // Get positions per condition/outcome
  const positionsQ = await clickhouse.query({
    query: `
      SELECT
        m.condition_id,
        m.outcome_index,
        sumIf(usdc_amount, side = 'buy') / 1e6 as buy_usdc,
        sumIf(usdc_amount, side = 'sell') / 1e6 as sell_usdc,
        sumIf(token_amount, side = 'buy') / 1e6 as buy_tokens,
        sumIf(token_amount, side = 'sell') / 1e6 as sell_tokens,
        (sumIf(token_amount, side = 'buy') - sumIf(token_amount, side = 'sell')) / 1e6 as net_tokens,
        CASE WHEN sumIf(token_amount, side = 'buy') > 0
             THEN sumIf(usdc_amount, side = 'buy') / sumIf(token_amount, side = 'buy')
             ELSE 0 END as avg_buy_price
      FROM (
        SELECT event_id, any(side) as side, any(usdc_amount) as usdc_amount,
               any(token_amount) as token_amount, any(token_id) as token_id
        FROM pm_trader_events_v2
        WHERE lower(trader_wallet) = '${walletLower}'
        GROUP BY event_id
      ) t
      JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
      GROUP BY m.condition_id, m.outcome_index
    `,
    format: 'JSONEachRow'
  });
  const positions = await positionsQ.json() as MarketPosition[];

  // Get redemptions
  const redemptionsQ = await clickhouse.query({
    query: `
      SELECT condition_id, redemption_payout
      FROM pm_redemption_payouts_agg
      WHERE lower(wallet) = '${walletLower}'
    `,
    format: 'JSONEachRow'
  });
  const redemptions = await redemptionsQ.json() as Redemption[];

  // Build redemption map
  const redemptionMap = new Map<string, number>();
  let totalRedemptionPayout = 0;
  for (const r of redemptions) {
    const payout = Number(r.redemption_payout);
    redemptionMap.set(r.condition_id.toLowerCase(), payout);
    totalRedemptionPayout += payout;
  }

  // Get resolution prices for markets this wallet traded
  const conditionIds = [...new Set(positions.map(p => p.condition_id.toLowerCase()))];
  const resolutionMap = new Map<string, { payout_0: number; payout_1: number }>();

  if (conditionIds.length > 0) {
    const resolutionQ = await clickhouse.query({
      query: `
        SELECT
          lower(condition_id) as condition_id,
          payout_numerators
        FROM pm_condition_resolutions
        WHERE lower(condition_id) IN (${conditionIds.map(c => `'${c}'`).join(',')})
      `,
      format: 'JSONEachRow'
    });
    const resolutions = await resolutionQ.json() as any[];

    for (const r of resolutions) {
      // Parse the JSON string: [0,1] means outcome 0 lost, outcome 1 won
      const numerators = JSON.parse(r.payout_numerators || '[0,0]');
      resolutionMap.set(r.condition_id, {
        payout_0: numerators[0] > 0 ? 1 : 0,  // 1 if winning, 0 if losing
        payout_1: numerators[1] > 0 ? 1 : 0
      });
    }
  }

  // Calculate realized profit
  let redemptionProfit = 0;
  let sellProfit = 0;
  let unredeemedLoss = 0;
  let totalBuyUsdc = 0;
  let totalSellUsdc = 0;

  // Group positions by condition
  const conditionPositions = new Map<string, MarketPosition[]>();
  const uniqueConditions = new Set<string>();

  for (const pos of positions) {
    const condId = pos.condition_id.toLowerCase();
    uniqueConditions.add(condId);
    if (!conditionPositions.has(condId)) {
      conditionPositions.set(condId, []);
    }
    conditionPositions.get(condId)!.push(pos);

    totalBuyUsdc += Number(pos.buy_usdc);
    totalSellUsdc += Number(pos.sell_usdc);
  }

  for (const [conditionId, condPositions] of conditionPositions) {
    const resolution = resolutionMap.get(conditionId);

    for (const pos of condPositions) {
      const buyTokens = Number(pos.buy_tokens);
      const sellTokens = Number(pos.sell_tokens);
      const netTokens = Number(pos.net_tokens);
      const avgBuyPrice = Number(pos.avg_buy_price);
      const sellUsdc = Number(pos.sell_usdc);

      // Synthetic position = sold without buying
      const isSynthetic = buyTokens === 0 && sellTokens > 0;

      if (isSynthetic) {
        // Don't count synthetic sells as profit/loss
        continue;
      }

      // Calculate cost basis of remaining tokens
      const costBasis = netTokens * avgBuyPrice;

      // Real sells (where we bought and then sold some)
      if (sellTokens > 0 && buyTokens > 0) {
        const sellCost = sellTokens * avgBuyPrice;
        sellProfit += sellUsdc - sellCost;
      }

      // Redemption/resolution profit or loss
      if (netTokens > 0 && resolution) {
        const payoutKey = `payout_${pos.outcome_index}` as 'payout_0' | 'payout_1';
        const payout = resolution[payoutKey] || 0;

        if (payout > 0) {
          // This outcome won - profit = payout (net_tokens) - cost basis
          redemptionProfit += netTokens * payout - costBasis;
        } else {
          // This outcome lost - loss = cost basis
          unredeemedLoss -= costBasis;
        }
      }
      // Unresolved positions don't count towards realized PnL
    }
  }

  return {
    wallet: walletLower,
    realized_profit: redemptionProfit + sellProfit + unredeemedLoss,
    redemption_profit: redemptionProfit,
    sell_profit: sellProfit,
    unredeemed_loss: unredeemedLoss,
    total_buy_usdc: totalBuyUsdc,
    total_sell_usdc: totalSellUsdc,
    total_redemption_payout: totalRedemptionPayout,
    n_markets: uniqueConditions.size,
  };
}

async function main() {
  console.log('BUILD REALIZED PROFIT TABLE - BATCH PROCESSOR');
  console.log('='.repeat(80));
  console.log('Using validated TS logic (same as compute-realized-profit-v1.ts)');
  console.log('');

  // Step 1: Get wallets from existing cohort table (not ALL HC wallets)
  console.log('Step 1: Getting wallet list from pm_hc_leaderboard_cohort_all_v1...');
  const walletsQ = await clickhouse.query({
    query: `SELECT DISTINCT wallet FROM pm_hc_leaderboard_cohort_all_v1`,
    format: 'JSONEachRow'
  });
  const wallets = (await walletsQ.json() as any[]).map(w => w.wallet.toLowerCase());
  console.log(`  Found ${wallets.length} wallets in cohort`);

  // Step 2: Create table
  console.log('Step 2: Creating pm_wallet_realized_profit_hc_v1...');
  await clickhouse.command({ query: `DROP TABLE IF EXISTS pm_wallet_realized_profit_hc_v1` });
  await clickhouse.command({
    query: `
      CREATE TABLE pm_wallet_realized_profit_hc_v1
      (
        wallet String,
        realized_profit_usd Float64,
        realized_profit_from_redemptions Float64,
        realized_profit_from_sells Float64,
        realized_loss_from_resolutions Float64,
        net_cash_usd Float64,
        total_buy_usdc Float64,
        total_sell_usdc Float64,
        total_redemption_payout Float64,
        n_markets UInt32,
        computed_at DateTime DEFAULT now()
      )
      ENGINE = MergeTree()
      ORDER BY (wallet)
    `
  });

  // Step 3: Process wallets and insert in batches
  console.log('Step 3: Processing wallets...');
  const BATCH_SIZE = 50;
  const results: WalletProfit[] = [];
  let processed = 0;
  let errors = 0;

  for (const wallet of wallets) {
    try {
      const profit = await computeWalletProfit(wallet);
      results.push(profit);
      processed++;

      // Insert batch
      if (results.length >= BATCH_SIZE) {
        await insertBatch(results);
        results.length = 0;
      }

      if (processed % 100 === 0) {
        console.log(`  Processed ${processed}/${wallets.length} wallets...`);
      }
    } catch (e: any) {
      errors++;
      if (errors <= 3) {
        console.error(`  Error processing ${wallet}: ${e.message}`);
      }
    }
  }

  // Insert remaining
  if (results.length > 0) {
    await insertBatch(results);
  }

  console.log(`  Completed: ${processed} processed, ${errors} errors`);

  // Step 4: Summary stats
  console.log('\nStep 4: Summary statistics...');
  const summaryQ = await clickhouse.query({
    query: `
      SELECT
        count() as total_wallets,
        round(avg(realized_profit_usd), 2) as avg_profit,
        round(median(realized_profit_usd), 2) as median_profit,
        round(min(realized_profit_usd), 2) as min_profit,
        round(max(realized_profit_usd), 2) as max_profit,
        round(avg(net_cash_usd), 2) as avg_net_cash,
        round(avg(net_cash_usd - realized_profit_usd), 2) as avg_difference
      FROM pm_wallet_realized_profit_hc_v1
    `,
    format: 'JSONEachRow'
  });
  const summary = (await summaryQ.json() as any[])[0];

  console.log(`  Total Wallets:   ${summary.total_wallets}`);
  console.log(`  Avg Profit:      $${summary.avg_profit}`);
  console.log(`  Median Profit:   $${summary.median_profit}`);
  console.log(`  Min Profit:      $${summary.min_profit}`);
  console.log(`  Max Profit:      $${summary.max_profit}`);
  console.log(`  Avg Net-Cash:    $${summary.avg_net_cash}`);
  console.log(`  Avg Difference:  $${summary.avg_difference} (net-cash - profit)`);

  // Step 5: Verify against known wallets
  console.log('\n' + '='.repeat(80));
  console.log('VERIFICATION AGAINST UI:');
  console.log('-'.repeat(80));

  const verifyWallets = [
    { wallet: '0x132b505596fadb6971bbb0fbded509421baf3a16', ui_pnl: 2068.50 },
    { wallet: '0x0030490676215689d0764b54c135d47f2c310513', ui_pnl: 4335.50 },
    { wallet: '0x3d6d9dcc4f40d6447bb650614acc385ff3820dd1', ui_pnl: 4494.50 },
  ];

  let allMatch = true;
  for (const v of verifyWallets) {
    const q = await clickhouse.query({
      query: `
        SELECT realized_profit_usd, net_cash_usd
        FROM pm_wallet_realized_profit_hc_v1
        WHERE wallet = lower('${v.wallet}')
      `,
      format: 'JSONEachRow'
    });
    const result = (await q.json() as any[])[0];
    if (result) {
      const profit = Number(result.realized_profit_usd);
      const match = Math.abs(profit - v.ui_pnl) < 1;
      const status = match ? '✅' : '❌';
      if (!match) allMatch = false;
      console.log(`  ${v.wallet.slice(0, 10)}... | UI: $${v.ui_pnl.toFixed(2)} | Ours: $${profit.toFixed(2)} | ${status}`);
    } else {
      allMatch = false;
      console.log(`  ${v.wallet.slice(0, 10)}... | NOT FOUND ❌`);
    }
  }

  console.log('\n' + '='.repeat(80));
  if (allMatch) {
    console.log('✅ TABLE CREATED: pm_wallet_realized_profit_hc_v1');
    console.log('✅ All validation wallets match UI');
  } else {
    console.log('⚠️  TABLE CREATED but validation failed - check results');
  }
  console.log('='.repeat(80));

  await clickhouse.close();
}

async function insertBatch(results: WalletProfit[]) {
  const values = results.map(r => ({
    wallet: r.wallet,
    realized_profit_usd: r.realized_profit,
    realized_profit_from_redemptions: r.redemption_profit,
    realized_profit_from_sells: r.sell_profit,
    realized_loss_from_resolutions: r.unredeemed_loss,
    net_cash_usd: r.total_sell_usdc - r.total_buy_usdc + r.total_redemption_payout,
    total_buy_usdc: r.total_buy_usdc,
    total_sell_usdc: r.total_sell_usdc,
    total_redemption_payout: r.total_redemption_payout,
    n_markets: r.n_markets,
  }));

  await clickhouse.insert({
    table: 'pm_wallet_realized_profit_hc_v1',
    values,
    format: 'JSONEachRow',
  });
}

main().catch(console.error);
