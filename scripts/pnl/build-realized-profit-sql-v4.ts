#!/usr/bin/env npx tsx
/**
 * Build Realized Profit Table V4 - Efficient SQL approach
 *
 * Uses temp tables but processes cohort wallets only.
 * Avoids memory issues by limiting to known cohort.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@clickhouse/client';

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 1200000, // 20 minutes
});

async function main() {
  console.log('BUILD REALIZED PROFIT TABLE V4');
  console.log('='.repeat(80));
  console.log('Efficient SQL with temp tables, cohort-only filtering');
  console.log('');

  const startTime = Date.now();

  // Step 1: Create temp table with cohort wallets
  console.log('Step 1: Getting cohort wallet count...');
  const countQ = await clickhouse.query({
    query: `SELECT count() as cnt FROM pm_hc_leaderboard_cohort_all_v1`,
    format: 'JSONEachRow'
  });
  const walletCount = Number((await countQ.json() as any[])[0].cnt);
  console.log(`  Found ${walletCount.toLocaleString()} wallets in cohort`);

  // Step 2: Create resolutions lookup (small table)
  console.log('\nStep 2: Building tmp_resolutions...');
  await clickhouse.command({ query: `DROP TABLE IF EXISTS tmp_profit_resolutions_v4` });
  await clickhouse.command({
    query: `
      CREATE TABLE tmp_profit_resolutions_v4
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
    query: `SELECT count() as cnt FROM tmp_profit_resolutions_v4`,
    format: 'JSONEachRow'
  });
  console.log(`  Created ${Number((await resCount.json() as any[])[0].cnt).toLocaleString()} resolution rows`);

  // Step 3a: Create deduped events table first
  console.log('\nStep 3a: Deduplicating events for cohort wallets...');
  await clickhouse.command({ query: `DROP TABLE IF EXISTS tmp_deduped_events_v4` });
  await clickhouse.command({
    query: `
      CREATE TABLE tmp_deduped_events_v4
      ENGINE = MergeTree()
      ORDER BY (wallet, event_id)
      AS
      SELECT
        event_id,
        lower(any(trader_wallet)) as wallet,
        any(side) as side,
        any(usdc_amount) as usdc_amount,
        any(token_amount) as token_amount,
        any(token_id) as token_id
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) GLOBAL IN (SELECT wallet FROM pm_hc_leaderboard_cohort_all_v1)
      GROUP BY event_id
    `
  });

  const dedupCount = await clickhouse.query({
    query: `SELECT count() as cnt, count(DISTINCT wallet) as wallets FROM tmp_deduped_events_v4`,
    format: 'JSONEachRow'
  });
  const dedupResult = (await dedupCount.json() as any[])[0];
  console.log(`  Created ${Number(dedupResult.cnt).toLocaleString()} deduped events for ${Number(dedupResult.wallets).toLocaleString()} wallets`);

  // Step 3b: Now build positions from deduped events
  console.log('\nStep 3b: Building tmp_positions from deduped events...');
  await clickhouse.command({ query: `DROP TABLE IF EXISTS tmp_profit_positions_v4` });
  await clickhouse.command({
    query: `
      CREATE TABLE tmp_profit_positions_v4
      ENGINE = MergeTree()
      ORDER BY (wallet, condition_id, outcome_index)
      AS
      SELECT
        d.wallet,
        m.condition_id,
        m.outcome_index,
        sumIf(d.usdc_amount, d.side = 'buy') / 1e6 as buy_usdc,
        sumIf(d.usdc_amount, d.side = 'sell') / 1e6 as sell_usdc,
        sumIf(d.token_amount, d.side = 'buy') / 1e6 as buy_tokens,
        sumIf(d.token_amount, d.side = 'sell') / 1e6 as sell_tokens,
        (sumIf(d.token_amount, d.side = 'buy') - sumIf(d.token_amount, d.side = 'sell')) / 1e6 as net_tokens,
        CASE WHEN sumIf(d.token_amount, d.side = 'buy') > 0
             THEN sumIf(d.usdc_amount, d.side = 'buy') / sumIf(d.token_amount, d.side = 'buy')
             ELSE 0 END as avg_buy_price
      FROM tmp_deduped_events_v4 d
      JOIN pm_token_to_condition_map_v3 m ON d.token_id = m.token_id_dec
      GROUP BY d.wallet, m.condition_id, m.outcome_index
    `
  });

  const posCount = await clickhouse.query({
    query: `SELECT count() as cnt, count(DISTINCT wallet) as wallets FROM tmp_profit_positions_v4`,
    format: 'JSONEachRow'
  });
  const posResult = (await posCount.json() as any[])[0];
  console.log(`  Created ${Number(posResult.cnt).toLocaleString()} position rows for ${Number(posResult.wallets).toLocaleString()} wallets`);

  // Step 4: Create final profit table
  console.log('\nStep 4: Building pm_wallet_realized_profit_hc_v1...');
  await clickhouse.command({ query: `DROP TABLE IF EXISTS pm_wallet_realized_profit_hc_v1` });
  await clickhouse.command({
    query: `
      CREATE TABLE pm_wallet_realized_profit_hc_v1
      ENGINE = MergeTree()
      ORDER BY (wallet)
      AS
      SELECT
        p.wallet,
        -- Redemption profit: for winning outcomes with held tokens
        -- profit = net_tokens * payout (1) - cost_basis
        sum(CASE
          WHEN p.buy_tokens > 0 AND p.net_tokens > 0 AND
               ((p.outcome_index = 0 AND res.payout_0 = 1) OR (p.outcome_index = 1 AND res.payout_1 = 1))
          THEN p.net_tokens - (p.net_tokens * p.avg_buy_price)
          ELSE 0
        END) as realized_profit_from_redemptions,
        -- Loss from losing outcomes: -cost_basis
        sum(CASE
          WHEN p.buy_tokens > 0 AND p.net_tokens > 0 AND res.condition_id IS NOT NULL AND
               ((p.outcome_index = 0 AND res.payout_0 = 0) OR (p.outcome_index = 1 AND res.payout_1 = 0))
          THEN -(p.net_tokens * p.avg_buy_price)
          ELSE 0
        END) as realized_loss_from_resolutions,
        -- Sell profit: for REAL sells (where buy_tokens > 0)
        -- profit = sell_usdc - (sell_tokens * avg_buy_price)
        sum(CASE
          WHEN p.buy_tokens > 0 AND p.sell_tokens > 0
          THEN p.sell_usdc - (p.sell_tokens * p.avg_buy_price)
          ELSE 0
        END) as realized_profit_from_sells,
        -- Total realized profit
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
        -- Net-cash for comparison
        sum(p.sell_usdc) - sum(p.buy_usdc) + coalesce(red.total_redemption, 0) as net_cash_usd,
        sum(p.buy_usdc) as total_buy_usdc,
        sum(p.sell_usdc) as total_sell_usdc,
        coalesce(red.total_redemption, 0) as total_redemption_payout,
        count(DISTINCT p.condition_id) as n_markets,
        now() as computed_at
      FROM tmp_profit_positions_v4 p
      LEFT JOIN tmp_profit_resolutions_v4 res ON lower(p.condition_id) = res.condition_id
      LEFT JOIN (
        SELECT wallet, sum(redemption_payout) as total_redemption
        FROM pm_redemption_payouts_agg
        WHERE wallet IN (SELECT wallet FROM pm_hc_leaderboard_cohort_all_v1)
        GROUP BY wallet
      ) red ON p.wallet = red.wallet
      GROUP BY p.wallet, red.total_redemption
    `
  });

  // Get counts
  const finalCount = await clickhouse.query({
    query: `SELECT count() as cnt FROM pm_wallet_realized_profit_hc_v1`,
    format: 'JSONEachRow'
  });
  const totalCount = Number((await finalCount.json() as any[])[0].cnt);
  console.log(`  Created table with ${totalCount.toLocaleString()} wallets`);

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

  // Cleanup temp tables
  console.log('\nStep 6: Cleaning up temp tables...');
  await clickhouse.command({ query: `DROP TABLE IF EXISTS tmp_deduped_events_v4` });
  await clickhouse.command({ query: `DROP TABLE IF EXISTS tmp_profit_positions_v4` });
  await clickhouse.command({ query: `DROP TABLE IF EXISTS tmp_profit_resolutions_v4` });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n' + '='.repeat(80));
  if (allMatch) {
    console.log(`✅ TABLE CREATED: pm_wallet_realized_profit_hc_v1 (${elapsed}s)`);
    console.log('✅ All validation wallets match UI');
  } else {
    console.log(`⚠️  TABLE CREATED but validation failed (${elapsed}s) - check results`);
  }
  console.log('='.repeat(80));

  await clickhouse.close();
}

main().catch(console.error);
