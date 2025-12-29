#!/usr/bin/env npx tsx
/**
 * Build Realized Profit Table for HC Leaderboard (V3)
 *
 * Memory-efficient version that processes in batches.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@clickhouse/client';

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 600000,
});

async function main() {
  console.log('BUILD REALIZED PROFIT TABLE V3');
  console.log('='.repeat(80));
  console.log('Memory-efficient batch processing');
  console.log('');

  // Step 1: Get HC wallets
  console.log('Step 1: Getting HC wallet list...');
  const walletsQ = await clickhouse.query({
    query: `SELECT wallet FROM pm_wallet_classification_v1 WHERE is_hc = 1`,
    format: 'JSONEachRow'
  });
  const wallets = (await walletsQ.json() as any[]).map(w => w.wallet.toLowerCase());
  console.log(`  Found ${wallets.length} HC wallets`);

  // Step 2: Create resolutions lookup
  console.log('Step 2: Building resolutions table...');
  await clickhouse.command({ query: `DROP TABLE IF EXISTS tmp_profit_resolutions` });
  await clickhouse.command({
    query: `
      CREATE TABLE tmp_profit_resolutions
      ENGINE = MergeTree()
      ORDER BY (condition_id)
      AS
      SELECT
        lower(condition_id) as condition_id,
        toUInt8(JSONExtractInt(payout_numerators, 1) > 0) as payout_0,
        toUInt8(JSONExtractInt(payout_numerators, 2) > 0) as payout_1
      FROM pm_condition_resolutions
    `
  });
  const resCount = await clickhouse.query({
    query: `SELECT count() as cnt FROM tmp_profit_resolutions`,
    format: 'JSONEachRow'
  });
  console.log(`  Created ${Number((await resCount.json() as any[])[0].cnt).toLocaleString()} resolution rows`);

  // Step 3: Create final table structure
  console.log('Step 3: Creating final table structure...');
  await clickhouse.command({ query: `DROP TABLE IF EXISTS pm_wallet_realized_profit_hc_v1` });
  await clickhouse.command({
    query: `
      CREATE TABLE pm_wallet_realized_profit_hc_v1
      (
        wallet String,
        realized_profit_from_redemptions Float64,
        realized_loss_from_resolutions Float64,
        realized_profit_from_sells Float64,
        realized_profit_usd Float64,
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

  // Step 4: Process wallets in batches
  console.log('Step 4: Processing wallets in batches...');
  const BATCH_SIZE = 100;
  let processed = 0;

  for (let i = 0; i < wallets.length; i += BATCH_SIZE) {
    const batch = wallets.slice(i, i + BATCH_SIZE);
    const walletsIn = batch.map(w => `'${w}'`).join(',');

    // Insert computed profit for this batch
    await clickhouse.command({
      query: `
        INSERT INTO pm_wallet_realized_profit_hc_v1
        WITH
        positions AS (
          SELECT
            t.wallet,
            m.condition_id,
            m.outcome_index,
            sumIf(t.usdc_amount, t.side = 'buy') / 1e6 as buy_usdc,
            sumIf(t.usdc_amount, t.side = 'sell') / 1e6 as sell_usdc,
            sumIf(t.token_amount, t.side = 'buy') / 1e6 as buy_tokens,
            sumIf(t.token_amount, t.side = 'sell') / 1e6 as sell_tokens,
            (sumIf(t.token_amount, t.side = 'buy') - sumIf(t.token_amount, t.side = 'sell')) / 1e6 as net_tokens,
            CASE WHEN sumIf(t.token_amount, t.side = 'buy') > 0
                 THEN sumIf(t.usdc_amount, t.side = 'buy') / sumIf(t.token_amount, t.side = 'buy')
                 ELSE 0 END as avg_buy_price
          FROM (
            SELECT event_id,
                   any(side) as side,
                   any(usdc_amount) as usdc_amount,
                   any(token_amount) as token_amount,
                   any(token_id) as token_id,
                   lower(any(trader_wallet)) as wallet
            FROM pm_trader_events_v2
            WHERE lower(trader_wallet) IN (${walletsIn})
            GROUP BY event_id
          ) t
          JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
          GROUP BY t.wallet, m.condition_id, m.outcome_index
        ),
        wallet_profit AS (
          SELECT
            p.wallet,
            -- Redemption profit: winning outcomes - cost basis
            sum(CASE
              WHEN p.buy_tokens > 0 AND p.net_tokens > 0 AND
                   ((p.outcome_index = 0 AND res.payout_0 = 1) OR (p.outcome_index = 1 AND res.payout_1 = 1))
              THEN p.net_tokens - (p.net_tokens * p.avg_buy_price)
              ELSE 0
            END) as realized_profit_from_redemptions,
            -- Loss from losing outcomes: -cost basis
            sum(CASE
              WHEN p.buy_tokens > 0 AND p.net_tokens > 0 AND res.condition_id IS NOT NULL AND
                   ((p.outcome_index = 0 AND res.payout_0 = 0) OR (p.outcome_index = 1 AND res.payout_1 = 0))
              THEN -(p.net_tokens * p.avg_buy_price)
              ELSE 0
            END) as realized_loss_from_resolutions,
            -- Sell profit: sell_usdc - cost basis of sold tokens (only for real sells)
            sum(CASE
              WHEN p.buy_tokens > 0 AND p.sell_tokens > 0
              THEN p.sell_usdc - (p.sell_tokens * p.avg_buy_price)
              ELSE 0
            END) as realized_profit_from_sells,
            -- Net cash for comparison
            sum(p.sell_usdc) - sum(p.buy_usdc) as net_trade_cash,
            sum(p.buy_usdc) as total_buy_usdc,
            sum(p.sell_usdc) as total_sell_usdc,
            count(DISTINCT p.condition_id) as n_markets
          FROM positions p
          LEFT JOIN tmp_profit_resolutions res ON lower(p.condition_id) = res.condition_id
          GROUP BY p.wallet
        )
        SELECT
          wp.wallet,
          wp.realized_profit_from_redemptions,
          wp.realized_loss_from_resolutions,
          wp.realized_profit_from_sells,
          wp.realized_profit_from_redemptions + wp.realized_loss_from_resolutions + wp.realized_profit_from_sells as realized_profit_usd,
          wp.net_trade_cash + coalesce(red.total_redemption, 0) as net_cash_usd,
          wp.total_buy_usdc,
          wp.total_sell_usdc,
          coalesce(red.total_redemption, 0) as total_redemption_payout,
          wp.n_markets,
          now() as computed_at
        FROM wallet_profit wp
        LEFT JOIN (
          SELECT wallet, sum(redemption_payout) as total_redemption
          FROM pm_redemption_payouts_agg
          WHERE wallet IN (${walletsIn})
          GROUP BY wallet
        ) red ON wp.wallet = red.wallet
      `
    });

    processed += batch.length;
    if (processed % 500 === 0 || processed === wallets.length) {
      console.log(`  Processed ${processed}/${wallets.length} wallets...`);
    }
  }

  // Get counts
  const countQ = await clickhouse.query({
    query: `SELECT count() as cnt FROM pm_wallet_realized_profit_hc_v1`,
    format: 'JSONEachRow'
  });
  const totalCount = Number((await countQ.json() as any[])[0].cnt);
  console.log(`\n  Created table with ${totalCount.toLocaleString()} wallets`);

  // Show summary stats
  console.log('\nStep 5: Summary statistics...');
  const summaryQ = await clickhouse.query({
    query: `
      SELECT
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

  console.log(`  Avg Profit:      $${summary.avg_profit}`);
  console.log(`  Median Profit:   $${summary.median_profit}`);
  console.log(`  Min Profit:      $${summary.min_profit}`);
  console.log(`  Max Profit:      $${summary.max_profit}`);
  console.log(`  Avg Net-Cash:    $${summary.avg_net_cash}`);
  console.log(`  Avg Difference:  $${summary.avg_difference} (net-cash - profit)`);

  // Verify against known wallets
  console.log('\n' + '='.repeat(80));
  console.log('VERIFICATION AGAINST UI:');
  console.log('-'.repeat(80));

  const verifyWallets = [
    { wallet: '0x132b505596fadb6971bbb0fbded509421baf3a16', ui_pnl: 2068.50 },
    { wallet: '0x0030490676215689d0764b54c135d47f2c310513', ui_pnl: 4335.50 },
    { wallet: '0x3d6d9dcc4f40d6447bb650614acc385ff3820dd1', ui_pnl: 4494.50 },
  ];

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
      const match = Math.abs(profit - v.ui_pnl) < 1 ? '✅' : '❌';
      console.log(`  ${v.wallet.slice(0, 10)}... | UI: $${v.ui_pnl.toFixed(2)} | Ours: $${profit.toFixed(2)} | ${match}`);
    } else {
      console.log(`  ${v.wallet.slice(0, 10)}... | NOT FOUND`);
    }
  }

  // Cleanup temp tables
  console.log('\nStep 6: Cleaning up temp tables...');
  await clickhouse.command({ query: `DROP TABLE IF EXISTS tmp_profit_resolutions` });

  console.log('\n' + '='.repeat(80));
  console.log('TABLE CREATED: pm_wallet_realized_profit_hc_v1');
  console.log('='.repeat(80));

  await clickhouse.close();
}

main().catch(console.error);
