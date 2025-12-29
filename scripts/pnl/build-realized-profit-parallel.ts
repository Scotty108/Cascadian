#!/usr/bin/env npx tsx
/**
 * Build Realized Profit Table - Parallel Processor
 *
 * Processes wallets in parallel to speed up computation.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@clickhouse/client';

const CONCURRENCY = 3;  // Process 3 wallets at a time (DB limited)
const BATCH_INSERT_SIZE = 100;

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 60000,
});

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

async function computeWalletProfit(wallet: string): Promise<WalletProfit | null> {
  try {
    // Single combined query for all data we need
    const q = await clickhouse.query({
      query: `
        WITH
        positions AS (
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
            WHERE lower(trader_wallet) = '${wallet}'
            GROUP BY event_id
          ) t
          JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
          GROUP BY m.condition_id, m.outcome_index
        ),
        resolutions AS (
          SELECT
            lower(condition_id) as condition_id,
            toUInt8(JSONExtractInt(payout_numerators, 1) > 0) as payout_0,
            toUInt8(JSONExtractInt(payout_numerators, 2) > 0) as payout_1
          FROM pm_condition_resolutions
          WHERE lower(condition_id) IN (SELECT DISTINCT lower(condition_id) FROM positions)
        ),
        redemptions AS (
          SELECT sum(redemption_payout) as total
          FROM pm_redemption_payouts_agg
          WHERE lower(wallet) = '${wallet}'
        )
        SELECT
          sum(p.buy_usdc) as total_buy_usdc,
          sum(p.sell_usdc) as total_sell_usdc,
          (SELECT total FROM redemptions) as total_redemption_payout,
          count(DISTINCT p.condition_id) as n_markets,
          -- Redemption profit
          sum(CASE
            WHEN p.buy_tokens > 0 AND p.net_tokens > 0 AND
                 ((p.outcome_index = 0 AND r.payout_0 = 1) OR (p.outcome_index = 1 AND r.payout_1 = 1))
            THEN p.net_tokens - (p.net_tokens * p.avg_buy_price)
            ELSE 0
          END) as redemption_profit,
          -- Loss
          sum(CASE
            WHEN p.buy_tokens > 0 AND p.net_tokens > 0 AND r.condition_id IS NOT NULL AND
                 ((p.outcome_index = 0 AND r.payout_0 = 0) OR (p.outcome_index = 1 AND r.payout_1 = 0))
            THEN -(p.net_tokens * p.avg_buy_price)
            ELSE 0
          END) as loss,
          -- Sell profit
          sum(CASE
            WHEN p.buy_tokens > 0 AND p.sell_tokens > 0
            THEN p.sell_usdc - (p.sell_tokens * p.avg_buy_price)
            ELSE 0
          END) as sell_profit
        FROM positions p
        LEFT JOIN resolutions r ON lower(p.condition_id) = r.condition_id
      `,
      format: 'JSONEachRow'
    });

    const results = await q.json() as any[];
    if (results.length === 0) return null;

    const r = results[0];
    const redemptionProfit = Number(r.redemption_profit) || 0;
    const loss = Number(r.loss) || 0;
    const sellProfit = Number(r.sell_profit) || 0;

    return {
      wallet,
      realized_profit: redemptionProfit + loss + sellProfit,
      redemption_profit: redemptionProfit,
      sell_profit: sellProfit,
      unredeemed_loss: loss,
      total_buy_usdc: Number(r.total_buy_usdc) || 0,
      total_sell_usdc: Number(r.total_sell_usdc) || 0,
      total_redemption_payout: Number(r.total_redemption_payout) || 0,
      n_markets: Number(r.n_markets) || 0,
    };
  } catch (e) {
    return null;
  }
}

async function main() {
  console.log('BUILD REALIZED PROFIT TABLE - PARALLEL PROCESSOR');
  console.log('='.repeat(80));
  console.log(`Concurrency: ${CONCURRENCY} wallets in parallel`);
  console.log('');

  const startTime = Date.now();

  // Get wallets - limit to top N by volume to make this faster
  const WALLET_LIMIT = process.env.WALLET_LIMIT ? parseInt(process.env.WALLET_LIMIT) : 24514;
  console.log(`Step 1: Getting wallet list (limit: ${WALLET_LIMIT})...`);
  const walletsQ = await clickhouse.query({
    query: `
      SELECT wallet, realized_pnl FROM pm_hc_leaderboard_cohort_all_v1
      ORDER BY abs(realized_pnl) DESC
      LIMIT ${WALLET_LIMIT}
    `,
    format: 'JSONEachRow'
  });
  const wallets = (await walletsQ.json() as any[]).map(w => w.wallet.toLowerCase());
  console.log(`  Found ${wallets.length} wallets`);

  // Create table
  console.log('\nStep 2: Creating table...');
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

  // Process wallets in parallel
  console.log('\nStep 3: Processing wallets...');
  const results: WalletProfit[] = [];
  let processed = 0;
  let errors = 0;

  // Process in chunks with concurrency limit
  for (let i = 0; i < wallets.length; i += CONCURRENCY) {
    const chunk = wallets.slice(i, Math.min(i + CONCURRENCY, wallets.length));
    const promises = chunk.map(w => computeWalletProfit(w));
    const chunkResults = await Promise.all(promises);

    for (const r of chunkResults) {
      if (r) {
        results.push(r);
        processed++;
      } else {
        errors++;
      }
    }

    // Insert batch
    if (results.length >= BATCH_INSERT_SIZE) {
      await insertBatch(results);
      results.length = 0;
    }

    if ((i + CONCURRENCY) % 50 === 0 || i + CONCURRENCY >= wallets.length) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      const rate = (processed / Number(elapsed)).toFixed(1);
      console.log(`  ${processed}/${wallets.length} wallets (${rate}/s, ${errors} errors)...`);
    }
  }

  // Insert remaining
  if (results.length > 0) {
    await insertBatch(results);
  }

  // Summary
  console.log('\nStep 4: Summary statistics...');
  const summaryQ = await clickhouse.query({
    query: `
      SELECT
        count() as total,
        round(avg(realized_profit_usd), 2) as avg_profit,
        round(median(realized_profit_usd), 2) as median_profit,
        round(min(realized_profit_usd), 2) as min_profit,
        round(max(realized_profit_usd), 2) as max_profit
      FROM pm_wallet_realized_profit_hc_v1
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
      query: `SELECT realized_profit_usd FROM pm_wallet_realized_profit_hc_v1 WHERE wallet = '${v.wallet.toLowerCase()}'`,
      format: 'JSONEachRow'
    });
    const result = (await q.json() as any[])[0];
    if (result) {
      const profit = Number(result.realized_profit_usd);
      const match = Math.abs(profit - v.ui_pnl) < 1 ? '✅' : '❌';
      console.log(`  ${v.wallet.slice(0, 10)}... | UI: $${v.ui_pnl.toFixed(2)} | Ours: $${profit.toFixed(2)} | ${match}`);
    } else {
      console.log(`  ${v.wallet.slice(0, 10)}... | NOT FOUND`);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nCompleted in ${elapsed}s`);

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
