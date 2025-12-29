#!/usr/bin/env npx tsx
/**
 * Test if maker-only filtering would fix the 2x bug
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { createClient } from '@clickhouse/client';

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
});

const WALLET = '0x586744c62f4b87872d4e616e1273b88b5eb324b3';

async function calculatePnl(roleFilter: string | null) {
  const roleClause = roleFilter ? `AND f.role = '${roleFilter}'` : '';

  const query = `
    SELECT
      condition_id,
      outcome_index,
      sum(if(side = 'buy', tokens, 0)) as buy_tokens,
      sum(if(side = 'sell', tokens, 0)) as sell_tokens,
      sum(if(side = 'buy', tokens, 0)) - sum(if(side = 'sell', tokens, 0)) as net_tokens,
      sum(if(side = 'sell', usdc, 0)) - sum(if(side = 'buy', usdc, 0)) as cash_flow,
      count() as fill_count
    FROM (
      SELECT
        any(lower(f.side)) as side,
        any(f.token_amount) / 1e6 as tokens,
        any(f.usdc_amount) / 1e6 as usdc,
        any(m.condition_id) as condition_id,
        any(m.outcome_index) as outcome_index
      FROM pm_trader_events_dedup_v2_tbl f
      INNER JOIN pm_token_to_condition_map_v5 m ON f.token_id = m.token_id_dec
      WHERE lower(f.trader_wallet) = lower('${WALLET}')
      ${roleClause}
      GROUP BY f.event_id
    )
    GROUP BY condition_id, outcome_index
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  // Get resolutions
  const conditionIds = [...new Set(rows.map((r: any) => r.condition_id))];
  const resQuery = `
    SELECT condition_id, payout_numerators
    FROM pm_condition_resolutions
    WHERE lower(condition_id) IN ('${conditionIds.join("','").toLowerCase()}')
  `;
  const resResult = await clickhouse.query({ query: resQuery, format: 'JSONEachRow' });
  const resolutions = (await resResult.json()) as any[];

  const resMap = new Map<string, number[]>();
  for (const r of resolutions) {
    const payouts = r.payout_numerators ? JSON.parse(r.payout_numerators) : [];
    resMap.set(r.condition_id.toLowerCase(), payouts);
  }

  let totalPnl = 0;
  let totalFills = 0;

  for (const r of rows) {
    const payouts = resMap.get(r.condition_id.toLowerCase()) || [];
    const resPrice = payouts[r.outcome_index] ?? 0;
    const pnl = Number(r.cash_flow) + Number(r.net_tokens) * resPrice;
    totalPnl += pnl;
    totalFills += Number(r.fill_count);
  }

  return { totalPnl, totalFills, positions: rows };
}

async function main() {
  console.log('='.repeat(80));
  console.log('TESTING MAKER-ONLY vs ALL FILLS');
  console.log('='.repeat(80));
  console.log('UI reported: -$341.38');
  console.log('V17 reported: -$683.06');
  console.log();

  const allFills = await calculatePnl(null);
  console.log(`ALL FILLS (V17 approach):`);
  console.log(`  Fills: ${allFills.totalFills}`);
  console.log(`  PnL: $${allFills.totalPnl.toFixed(2)}`);
  console.log(`  Ratio to UI: ${(allFills.totalPnl / -341.38).toFixed(2)}x`);

  const makerOnly = await calculatePnl('maker');
  console.log(`\nMAKER ONLY (V18 approach):`);
  console.log(`  Fills: ${makerOnly.totalFills}`);
  console.log(`  PnL: $${makerOnly.totalPnl.toFixed(2)}`);
  console.log(`  Ratio to UI: ${(makerOnly.totalPnl / -341.38).toFixed(2)}x`);

  const takerOnly = await calculatePnl('taker');
  console.log(`\nTAKER ONLY:`);
  console.log(`  Fills: ${takerOnly.totalFills}`);
  console.log(`  PnL: $${takerOnly.totalPnl.toFixed(2)}`);
  console.log(`  Ratio to UI: ${(takerOnly.totalPnl / -341.38).toFixed(2)}x`);

  // Check if maker + taker = all (should NOT equal if there's double counting)
  console.log('\n' + '-'.repeat(80));
  console.log('DOUBLE-COUNTING CHECK:');
  console.log(`  Maker PnL + Taker PnL = $${(makerOnly.totalPnl + takerOnly.totalPnl).toFixed(2)}`);
  console.log(`  All Fills PnL = $${allFills.totalPnl.toFixed(2)}`);

  if (Math.abs(makerOnly.totalPnl + takerOnly.totalPnl - allFills.totalPnl) < 0.01) {
    console.log('  ✓ No double counting - maker + taker = all');
  } else {
    console.log('  ⚠️ Possible double counting!');
  }

  // Show position details for each approach
  console.log('\n' + '='.repeat(80));
  console.log('POSITION DETAILS:');
  console.log('='.repeat(80));

  console.log('\nALL FILLS positions:');
  for (const p of allFills.positions) {
    console.log(
      `  O${p.outcome_index}: net=${Number(p.net_tokens).toFixed(2)}, cf=$${Number(p.cash_flow).toFixed(2)}, fills=${p.fill_count}`
    );
  }

  console.log('\nMAKER ONLY positions:');
  for (const p of makerOnly.positions) {
    console.log(
      `  O${p.outcome_index}: net=${Number(p.net_tokens).toFixed(2)}, cf=$${Number(p.cash_flow).toFixed(2)}, fills=${p.fill_count}`
    );
  }

  console.log('\nTAKER ONLY positions:');
  for (const p of takerOnly.positions) {
    console.log(
      `  O${p.outcome_index}: net=${Number(p.net_tokens).toFixed(2)}, cf=$${Number(p.cash_flow).toFixed(2)}, fills=${p.fill_count}`
    );
  }

  await clickhouse.close();
}

main().catch(console.error);
