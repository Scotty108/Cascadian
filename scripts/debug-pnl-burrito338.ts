#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

const wallet = '0x1489046ca0f9980fc2d9a950d103d3bec02c1307'; // burrito338

async function debugPnL() {
  console.log('DEBUGGING P&L CALCULATION FOR burrito338');
  console.log('═'.repeat(80));
  console.log();

  // Look at a few sample resolved positions
  const sample = await client.query({
    query: `
      WITH position_pnl AS (
        SELECT
          t.condition_id_norm,
          t.market_id_norm,
          sum(CASE WHEN t.trade_direction = 'BUY' THEN t.shares ELSE -t.shares END) as net_shares,
          sum(CASE WHEN t.trade_direction = 'BUY' THEN t.usd_value ELSE -t.usd_value END) as cost_basis,
          any(t.outcome_index) as outcome_index,
          count() as num_trades
        FROM default.vw_trades_canonical t
        WHERE lower(t.wallet_address_norm) = lower('${wallet}')
          AND t.condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
        GROUP BY t.condition_id_norm, t.market_id_norm
      ),
      resolved_pnl AS (
        SELECT
          p.condition_id_norm,
          p.market_id_norm,
          toFloat64(p.net_shares) as net_shares,
          toFloat64(p.cost_basis) as cost_basis,
          p.outcome_index,
          p.num_trades,
          r.winning_index,
          r.payout_numerators,
          r.payout_denominator,
          arrayElement(r.payout_numerators, p.outcome_index + 1) as my_payout_numerator,
          toFloat64(p.net_shares) * toFloat64(arrayElement(r.payout_numerators, p.outcome_index + 1)) / toFloat64(r.payout_denominator) as payout_value,
          (toFloat64(p.net_shares) * toFloat64(arrayElement(r.payout_numerators, p.outcome_index + 1)) / toFloat64(r.payout_denominator)) - toFloat64(p.cost_basis) as pnl_usd
        FROM position_pnl p
        LEFT JOIN cascadian_clean.vw_resolutions_unified r
          ON lower(p.condition_id_norm) = r.cid_hex
        WHERE r.cid_hex IS NOT NULL
          AND r.payout_denominator > 0
      )
      SELECT *
      FROM resolved_pnl
      ORDER BY abs(pnl_usd) DESC
      LIMIT 10
    `,
    format: 'JSONEachRow',
  });

  const positions = await sample.json<any[]>();

  console.log('Top 10 positions by absolute P&L:');
  console.log();
  for (const pos of positions) {
    console.log('Market:', pos.market_id_norm);
    console.log('  Condition ID:', pos.condition_id_norm.slice(0, 20) + '...');
    console.log('  Trades:', pos.num_trades);
    console.log('  Net shares:', parseFloat(pos.net_shares).toFixed(4));
    console.log('  Cost basis: $' + parseFloat(pos.cost_basis).toFixed(2));
    console.log('  Outcome index:', pos.outcome_index, '(user held this outcome)');
    console.log('  Winning index:', pos.winning_index);
    console.log('  Payout vector (raw):', pos.payout_numerators);
    console.log('  Payout denom:', pos.payout_denominator);
    console.log('  My payout numerator:', pos.my_payout_numerator);
    console.log('  Payout value: $' + parseFloat(pos.payout_value).toFixed(2));
    console.log('  P&L: $' + parseFloat(pos.pnl_usd).toFixed(2));
    console.log();
  }

  await client.close();
}

debugPnL().catch(console.error);
