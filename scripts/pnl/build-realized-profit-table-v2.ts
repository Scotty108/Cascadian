#!/usr/bin/env npx tsx
/**
 * Build Realized Profit Table for HC Leaderboard (V2)
 *
 * Uses temp tables to avoid CTE complexity issues.
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
  console.log('BUILD REALIZED PROFIT TABLE V2');
  console.log('='.repeat(80));
  console.log('Using temp tables approach');
  console.log('');

  // Step 1: Create temp positions table
  console.log('Step 1: Building tmp_positions...');
  await clickhouse.command({ query: `DROP TABLE IF EXISTS tmp_profit_positions` });
  await clickhouse.command({
    query: `
      CREATE TABLE tmp_profit_positions
      ENGINE = MergeTree()
      ORDER BY (wallet, condition_id, outcome_index)
      AS
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
        GROUP BY event_id
      ) t
      JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
      WHERE t.wallet IN (SELECT wallet FROM pm_wallet_classification_v1 WHERE is_hc = 1)
      GROUP BY t.wallet, m.condition_id, m.outcome_index
    `
  });
  
  const posCount = await clickhouse.query({
    query: `SELECT count() as cnt FROM tmp_profit_positions`,
    format: 'JSONEachRow'
  });
  console.log(`  Created ${Number((await posCount.json() as any[])[0].cnt).toLocaleString()} position rows`);

  // Step 2: Create temp resolutions table
  console.log('Step 2: Building tmp_resolutions...');
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

  // Step 3: Calculate profit per wallet
  console.log('Step 3: Building pm_wallet_realized_profit_hc_v1...');
  await clickhouse.command({ query: `DROP TABLE IF EXISTS pm_wallet_realized_profit_hc_v1` });
  await clickhouse.command({
    query: `
      CREATE TABLE pm_wallet_realized_profit_hc_v1
      ENGINE = MergeTree()
      ORDER BY (wallet)
      AS
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
        -- Total
        sum(CASE 
          WHEN p.buy_tokens > 0 AND p.net_tokens > 0 AND 
               ((p.outcome_index = 0 AND res.payout_0 = 1) OR (p.outcome_index = 1 AND res.payout_1 = 1))
          THEN p.net_tokens - (p.net_tokens * p.avg_buy_price)
          ELSE 0
        END) +
        sum(CASE 
          WHEN p.buy_tokens > 0 AND p.net_tokens > 0 AND res.condition_id IS NOT NULL AND
               ((p.outcome_index = 0 AND res.payout_0 = 0) OR (p.outcome_index = 1 AND res.payout_1 = 0))
          THEN -(p.net_tokens * p.avg_buy_price)
          ELSE 0
        END) +
        sum(CASE 
          WHEN p.buy_tokens > 0 AND p.sell_tokens > 0
          THEN p.sell_usdc - (p.sell_tokens * p.avg_buy_price)
          ELSE 0
        END) as realized_profit_usd,
        -- Old net-cash for comparison
        sum(p.sell_usdc) - sum(p.buy_usdc) + sum(coalesce(red.redemption_payout, 0)) as net_cash_usd,
        sum(p.buy_usdc) as total_buy_usdc,
        sum(p.sell_usdc) as total_sell_usdc,
        sum(coalesce(red.redemption_payout, 0)) as total_redemption_payout,
        count(DISTINCT p.condition_id) as n_markets,
        now() as computed_at
      FROM tmp_profit_positions p
      LEFT JOIN tmp_profit_resolutions res ON lower(p.condition_id) = res.condition_id
      LEFT JOIN pm_redemption_payouts_agg red ON p.wallet = red.wallet AND p.condition_id = red.condition_id
      GROUP BY p.wallet
    `
  });

  // Get counts
  const countQ = await clickhouse.query({
    query: `SELECT count() as cnt FROM pm_wallet_realized_profit_hc_v1`,
    format: 'JSONEachRow'
  });
  const totalCount = Number((await countQ.json() as any[])[0].cnt);
  console.log(`  Created table with ${totalCount.toLocaleString()} wallets\n`);

  // Show summary stats
  console.log('Step 4: Summary statistics...');
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
  console.log('\nStep 5: Cleaning up temp tables...');
  await clickhouse.command({ query: `DROP TABLE IF EXISTS tmp_profit_positions` });
  await clickhouse.command({ query: `DROP TABLE IF EXISTS tmp_profit_resolutions` });

  console.log('\n' + '='.repeat(80));
  console.log('TABLE CREATED: pm_wallet_realized_profit_hc_v1');
  console.log('='.repeat(80));

  await clickhouse.close();
}

main().catch(console.error);
