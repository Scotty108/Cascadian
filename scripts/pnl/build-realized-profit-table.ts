#!/usr/bin/env npx tsx
/**
 * Build Realized Profit Table for HC Leaderboard
 *
 * Correct formula that excludes synthetic sells:
 * - Synthetic sell = selling tokens you never bought (buy_tokens = 0)
 * - Real sell profit = sell_usdc - (sell_tokens * avg_buy_price)
 * - Redemption profit = payout - cost_basis
 * - Loss = -cost_basis for losing outcomes
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
  console.log('BUILD REALIZED PROFIT TABLE');
  console.log('='.repeat(80));
  console.log('Formula: Exclude synthetic sells (buy_tokens = 0)');
  console.log('');

  // Step 1: Create the realized profit table
  console.log('Step 1: Building pm_wallet_realized_profit_hc_v1...');
  
  await clickhouse.command({ query: `DROP TABLE IF EXISTS pm_wallet_realized_profit_hc_v1` });

  // This is a complex calculation that needs to be done per-wallet
  // We'll compute it using a multi-step approach in SQL
  
  await clickhouse.command({
    query: `
      CREATE TABLE pm_wallet_realized_profit_hc_v1
      ENGINE = MergeTree()
      ORDER BY (wallet)
      AS
      WITH
      -- Get HC wallets
      hc_wallets AS (
        SELECT wallet FROM pm_wallet_classification_v1 WHERE is_hc = 1
      ),
      -- Get positions per wallet/condition/outcome (deduplicated)
      -- First deduplicate events, then filter by HC wallets
      deduped_events AS (
        SELECT event_id, any(side) as side, any(usdc_amount) as usdc_amount,
               any(token_amount) as token_amount, any(token_id) as token_id,
               lower(any(trader_wallet)) as wallet
        FROM pm_trader_events_v2
        GROUP BY event_id
      ),
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
        FROM deduped_events t
        JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
        WHERE t.wallet IN (SELECT wallet FROM hc_wallets)
        GROUP BY t.wallet, m.condition_id, m.outcome_index
      ),
      -- Get redemptions
      redemptions AS (
        SELECT
          wallet,
          condition_id,
          sum(redemption_payout) as redemption_payout
        FROM pm_redemption_payouts_agg
        WHERE wallet IN (SELECT wallet FROM hc_wallets)
        GROUP BY wallet, condition_id
      ),
      -- Get resolutions with parsed payouts
      resolutions AS (
        SELECT
          lower(condition_id) as condition_id,
          -- Parse [x,y] format: outcome 0 wins if first element > 0, outcome 1 wins if second > 0
          toUInt8(JSONExtractInt(payout_numerators, 1) > 0) as payout_0,
          toUInt8(JSONExtractInt(payout_numerators, 2) > 0) as payout_1
        FROM pm_condition_resolutions
      ),
      -- Calculate profit per position
      position_profit AS (
        SELECT
          p.wallet,
          p.condition_id,
          p.outcome_index,
          p.buy_usdc,
          p.sell_usdc,
          p.buy_tokens,
          p.sell_tokens,
          p.net_tokens,
          p.avg_buy_price,
          -- Is this a synthetic position? (sold without buying)
          p.buy_tokens = 0 AND p.sell_tokens > 0 as is_synthetic,
          -- Cost basis of remaining tokens
          p.net_tokens * p.avg_buy_price as cost_basis,
          -- Resolution payout for this outcome
          CASE 
            WHEN p.outcome_index = 0 THEN res.payout_0
            WHEN p.outcome_index = 1 THEN res.payout_1
            ELSE 0
          END as payout_price,
          -- Redemption for this condition
          coalesce(red.redemption_payout, 0) as redemption_payout,
          -- Was this market resolved?
          res.condition_id IS NOT NULL as is_resolved
        FROM positions p
        LEFT JOIN resolutions res ON lower(p.condition_id) = res.condition_id
        LEFT JOIN redemptions red ON p.wallet = red.wallet AND p.condition_id = red.condition_id
      ),
      -- Aggregate profit per wallet
      wallet_profit AS (
        SELECT
          wallet,
          -- Redemption profit: for winning outcomes with tokens held
          sum(CASE 
            WHEN NOT is_synthetic AND net_tokens > 0 AND payout_price > 0 AND is_resolved
            THEN net_tokens * payout_price - cost_basis
            ELSE 0
          END) as redemption_profit,
          -- Loss: for losing outcomes with tokens held
          sum(CASE 
            WHEN NOT is_synthetic AND net_tokens > 0 AND payout_price = 0 AND is_resolved
            THEN -cost_basis
            ELSE 0
          END) as loss_from_resolution,
          -- Sell profit: for real sells (where we bought and then sold)
          sum(CASE 
            WHEN NOT is_synthetic AND sell_tokens > 0 AND buy_tokens > 0
            THEN sell_usdc - (sell_tokens * avg_buy_price)
            ELSE 0
          END) as sell_profit,
          -- Total buy/sell/redemption (for reference)
          sum(buy_usdc) as total_buy_usdc,
          sum(sell_usdc) as total_sell_usdc,
          sum(redemption_payout) as total_redemption_payout,
          -- Old net-cash formula
          sum(sell_usdc) - sum(buy_usdc) + sum(redemption_payout) as net_cash_usd,
          -- Trade counts
          count(DISTINCT condition_id) as n_markets,
          sum(CASE WHEN buy_tokens > 0 THEN 1 ELSE 0 END) as n_positions_bought
        FROM position_profit
        GROUP BY wallet
      )
      SELECT
        wallet,
        redemption_profit + loss_from_resolution + sell_profit as realized_profit_usd,
        redemption_profit as realized_profit_from_redemptions,
        sell_profit as realized_profit_from_sells,
        loss_from_resolution as realized_loss_from_resolutions,
        net_cash_usd,
        total_buy_usdc,
        total_sell_usdc,
        total_redemption_payout,
        n_markets,
        n_positions_bought,
        now() as computed_at
      FROM wallet_profit
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
  console.log('Step 2: Summary statistics...');
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

  console.log('\n' + '='.repeat(80));
  console.log('TABLE CREATED: pm_wallet_realized_profit_hc_v1');
  console.log('='.repeat(80));

  await clickhouse.close();
}

main().catch(console.error);
