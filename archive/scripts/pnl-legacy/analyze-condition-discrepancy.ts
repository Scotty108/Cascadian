/**
 * Analyze PnL discrepancy between DB and API for specific condition
 *
 * Purpose: Deep dive into why DB CLOB formula differs from API
 */

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: 'https://ja9egedrv0.us-central1.gcp.clickhouse.cloud:8443',
  username: 'default',
  password: 'Lbr.jYtw5ikf3',
  database: 'default',
  request_timeout: 30000
});

async function main() {
  const W1 = '0x9d36c904930a7d06c5403f9e16996e919f586486';

  // Pick the first API condition - dd22472e (API says $3,540 realized PnL)
  const condId = 'dd22472e552920b8438158ea7238bfadfa4f736aa4cee91a6b86c39ead110917';

  console.log('=== CONDITION dd22472e... DEEP DIVE ===');
  console.log('API says: $3,540.06 realized PnL on outcome Yes');
  console.log('');

  // Check resolution
  const res = await client.query({
    query: `
      SELECT payout_numerators, resolved_at
      FROM pm_condition_resolutions
      WHERE lower(condition_id) = '${condId}' AND is_deleted = 0
    `,
    format: 'JSONEachRow'
  });

  const resRow = (await res.json() as any[])[0];
  console.log('Resolution:', resRow?.payout_numerators || 'NOT RESOLVED');

  // Group by outcome with full calculation
  const byOutcome = await client.query({
    query: `
      WITH deduped AS (
        SELECT event_id,
               any(token_id) as token_id,
               any(usdc_amount)/1e6 as usdc,
               any(token_amount)/1e6 as tokens,
               any(side) as side
        FROM pm_trader_events_v2
        WHERE trader_wallet = '${W1}' AND is_deleted = 0
        GROUP BY event_id
      )
      SELECT
        m.outcome_index,
        COUNT(*) as trades,
        SUM(CASE WHEN d.side = 'buy' THEN d.usdc ELSE 0 END) as bought,
        SUM(CASE WHEN d.side = 'sell' THEN d.usdc ELSE 0 END) as sold,
        SUM(CASE WHEN d.side = 'buy' THEN -d.usdc ELSE d.usdc END) as cash_flow,
        SUM(CASE WHEN d.side = 'buy' THEN d.tokens ELSE -d.tokens END) as final_shares
      FROM deduped d
      JOIN pm_token_to_condition_map_v3 m ON toString(d.token_id) = toString(m.token_id_dec)
      WHERE lower(m.condition_id) = '${condId}'
      GROUP BY m.outcome_index
    `,
    format: 'JSONEachRow'
  });

  const outcomes = await byOutcome.json() as any[];
  console.log('');
  console.log('By outcome:');

  // Parse resolution - [1,0] means outcome 0 wins, [0,1] means outcome 1 wins
  const payoutStr = resRow?.payout_numerators || '';
  const yesWon = payoutStr.includes('[1,');
  console.log('Yes won:', yesWon);
  console.log('');

  let totalPnl = 0;
  for (const o of outcomes) {
    // outcome 0 = Yes, outcome 1 = No in Polymarket convention
    let resPrice: number;
    if (o.outcome_index === 0) {
      resPrice = yesWon ? 1.0 : 0.0;
    } else {
      resPrice = yesWon ? 0.0 : 1.0;
    }
    const pnl = o.cash_flow + o.final_shares * resPrice;
    totalPnl += pnl;
    console.log(`Outcome ${o.outcome_index} (${o.outcome_index === 0 ? 'Yes' : 'No'}):`);
    console.log(`  Trades: ${o.trades}`);
    console.log(`  Bought: $${o.bought.toFixed(2)}`);
    console.log(`  Sold: $${o.sold.toFixed(2)}`);
    console.log(`  Cash flow: $${o.cash_flow.toFixed(2)}`);
    console.log(`  Final shares: ${o.final_shares.toFixed(2)}`);
    console.log(`  Resolution price: ${resPrice}`);
    console.log(`  PnL: $${pnl.toFixed(2)}`);
    console.log('');
  }

  console.log(`DB Total PnL: $${totalPnl.toFixed(2)}`);
  console.log('API PnL: $3,540.06');
  console.log(`Difference: $${(totalPnl - 3540.06).toFixed(2)}`);

  await client.close();
}

main().catch(console.error);
