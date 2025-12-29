#!/usr/bin/env npx tsx
/**
 * Debug wallet PnL calculation
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@clickhouse/client';

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
});

const wallet = process.argv[2] || '0x132b505596fadb6971bbb0fbded509421baf3a16';

async function main() {
  console.log(`DEBUG PNL FOR WALLET: ${wallet}`);
  console.log('='.repeat(80));

  // Check trades (deduplicated)
  const tradesQ = await clickhouse.query({
    query: `
      SELECT
        side,
        sum(usdc_amount) / 1e6 as total_usdc,
        sum(token_amount) / 1e6 as total_tokens,
        count() as n_trades
      FROM (
        SELECT event_id, any(side) as side, any(usdc_amount) as usdc_amount, any(token_amount) as token_amount
        FROM pm_trader_events_v2
        WHERE lower(trader_wallet) = lower('${wallet}')
        GROUP BY event_id
      )
      GROUP BY side
    `,
    format: 'JSONEachRow'
  });
  const trades = await tradesQ.json() as any[];
  console.log('\nTRADES BY SIDE (deduplicated):');
  let buyUsdc = 0, sellUsdc = 0;
  for (const t of trades) {
    console.log(`  ${t.side}: $${Number(t.total_usdc).toFixed(2)} (${t.n_trades} trades, ${Number(t.total_tokens).toFixed(2)} tokens)`);
    if (t.side === 'buy') buyUsdc = Number(t.total_usdc);
    if (t.side === 'sell') sellUsdc = Number(t.total_usdc);
  }

  // Check redemptions
  const redemptionsQ = await clickhouse.query({
    query: `
      SELECT
        count() as n_redemptions,
        sum(redemption_payout) as total_payout
      FROM pm_redemption_payouts_agg
      WHERE lower(wallet) = lower('${wallet}')
    `,
    format: 'JSONEachRow'
  });
  const redemptions = (await redemptionsQ.json() as any[])[0];
  const redemptionPayout = Number(redemptions.total_payout) || 0;
  console.log(`\nREDEMPTIONS: ${redemptions.n_redemptions} redemptions, $${redemptionPayout.toFixed(2)} total payout`);

  // Redemption details
  const redemptionsDetailQ = await clickhouse.query({
    query: `
      SELECT condition_id, redemption_payout, last_redemption
      FROM pm_redemption_payouts_agg
      WHERE lower(wallet) = lower('${wallet}')
      ORDER BY last_redemption DESC
    `,
    format: 'JSONEachRow'
  });
  const redemptionsDetail = await redemptionsDetailQ.json() as any[];
  if (redemptionsDetail.length > 0) {
    console.log('\nREDEMPTION DETAILS:');
    for (const r of redemptionsDetail) {
      console.log(`  ${r.condition_id.slice(0, 16)}... | $${Number(r.redemption_payout).toFixed(2)} | ${r.last_redemption}`);
    }
  }

  // Calculate PnL
  console.log('\n' + '='.repeat(80));
  console.log('PNL CALCULATION:');
  console.log('-'.repeat(80));
  console.log(`  Buy USDC:           $${buyUsdc.toFixed(2)}`);
  console.log(`  Sell USDC:          $${sellUsdc.toFixed(2)}`);
  console.log(`  Redemption Payout:  $${redemptionPayout.toFixed(2)}`);
  console.log('-'.repeat(80));
  const realizedPnl = sellUsdc - buyUsdc + redemptionPayout;
  console.log(`  REALIZED PNL = sell - buy + redemption`);
  console.log(`  REALIZED PNL = ${sellUsdc.toFixed(2)} - ${buyUsdc.toFixed(2)} + ${redemptionPayout.toFixed(2)}`);
  console.log(`  REALIZED PNL = $${realizedPnl.toFixed(2)}`);

  // Check what our cohort table has
  const cohortQ = await clickhouse.query({
    query: `
      SELECT realized_pnl, realized_buy_usdc, realized_sell_usdc, redemption_payout
      FROM pm_hc_leaderboard_cohort_all_v1
      WHERE wallet = lower('${wallet}')
    `,
    format: 'JSONEachRow'
  });
  const cohort = await cohortQ.json() as any[];
  if (cohort.length > 0) {
    console.log('\nCOHORT TABLE VALUES:');
    console.log(`  realized_pnl:       $${Number(cohort[0].realized_pnl).toFixed(2)}`);
    console.log(`  realized_buy_usdc:  $${Number(cohort[0].realized_buy_usdc).toFixed(2)}`);
    console.log(`  realized_sell_usdc: $${Number(cohort[0].realized_sell_usdc).toFixed(2)}`);
    console.log(`  redemption_payout:  $${Number(cohort[0].redemption_payout).toFixed(2)}`);
  }

  // Check positions - are there any open?
  const positionsQ = await clickhouse.query({
    query: `
      WITH positions AS (
        SELECT
          m.condition_id,
          m.outcome_index,
          sum(CASE WHEN t.side = 'buy' THEN t.token_amount ELSE -t.token_amount END) / 1e6 as net_tokens
        FROM (
          SELECT event_id, any(side) as side, any(token_amount) as token_amount, any(token_id) as token_id
          FROM pm_trader_events_v2
          WHERE lower(trader_wallet) = lower('${wallet}')
          GROUP BY event_id
        ) t
        JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
        GROUP BY m.condition_id, m.outcome_index
        HAVING abs(net_tokens) > 1
      )
      SELECT
        p.condition_id,
        p.outcome_index,
        p.net_tokens,
        r.resolved_at IS NOT NULL as is_resolved
      FROM positions p
      LEFT JOIN pm_condition_resolutions r ON lower(p.condition_id) = lower(r.condition_id)
      ORDER BY abs(p.net_tokens) DESC
    `,
    format: 'JSONEachRow'
  });
  const positions = await positionsQ.json() as any[];
  console.log(`\nPOSITIONS (net tokens > 1):`);
  if (positions.length === 0) {
    console.log('  No significant positions');
  } else {
    for (const p of positions) {
      const status = p.is_resolved ? 'RESOLVED' : 'OPEN';
      console.log(`  ${p.condition_id.slice(0, 16)}... | outcome=${p.outcome_index} | ${Number(p.net_tokens).toFixed(2)} tokens | ${status}`);
    }
  }

  await clickhouse.close();
}

main().catch(console.error);
