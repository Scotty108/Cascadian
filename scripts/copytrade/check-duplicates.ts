/**
 * Check for duplicate trades in CLOB data
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '@/lib/clickhouse/client';

const WALLET = '0x925ad88d18dbc7bfeff3b71db7b96ed4bb572c2e';

async function main() {
  console.log('=== CHECKING FOR DUPLICATES ===\n');

  // Check if event_id has duplicates
  const q1 = `
    SELECT
      event_id,
      count() as cnt
    FROM pm_trader_events_v2
    WHERE trader_wallet = '${WALLET}'
      AND is_deleted = 0
    GROUP BY event_id
    HAVING cnt > 1
    LIMIT 10
  `;
  const r1 = await clickhouse.query({ query: q1, format: 'JSONEachRow' });
  const dups = await r1.json();
  console.log('Duplicate event_ids:', dups.length > 0 ? dups : 'None found');

  // Check total vs distinct event counts
  const q2 = `
    SELECT
      count() as total_rows,
      countDistinct(event_id) as unique_events
    FROM pm_trader_events_v2
    WHERE trader_wallet = '${WALLET}'
      AND is_deleted = 0
  `;
  const r2 = await clickhouse.query({ query: q2, format: 'JSONEachRow' });
  const counts = (await r2.json())[0] as { total_rows: number; unique_events: number };
  console.log('\nRow counts:');
  console.log(`  Total rows: ${counts.total_rows}`);
  console.log(`  Unique events: ${counts.unique_events}`);
  console.log(`  Duplicate ratio: ${(counts.total_rows / counts.unique_events).toFixed(2)}x`);

  // Get DEDUPED stats using GROUP BY event_id
  const q3 = `
    SELECT
      sum(buys) as total_buys,
      sum(sells) as total_sells,
      sum(tokens_bought) as tokens_bought,
      sum(tokens_sold) as tokens_sold
    FROM (
      SELECT
        event_id,
        any(if(side = 'buy', usdc_amount, 0)) / 1e6 as buys,
        any(if(side = 'sell', usdc_amount, 0)) / 1e6 as sells,
        any(if(side = 'buy', token_amount, 0)) / 1e6 as tokens_bought,
        any(if(side = 'sell', token_amount, 0)) / 1e6 as tokens_sold
      FROM pm_trader_events_v2
      WHERE trader_wallet = '${WALLET}'
        AND is_deleted = 0
      GROUP BY event_id
    )
  `;
  const r3 = await clickhouse.query({ query: q3, format: 'JSONEachRow' });
  const deduped = (await r3.json())[0] as {
    total_buys: string;
    total_sells: string;
    tokens_bought: string;
    tokens_sold: string;
  };

  const buys = parseFloat(deduped.total_buys);
  const sells = parseFloat(deduped.total_sells);
  const tokensBought = parseFloat(deduped.tokens_bought);
  const tokensSold = parseFloat(deduped.tokens_sold);

  console.log('\n=== DEDUPED P&L COMPONENTS ===');
  console.log(`CLOB Buys:        -$${buys.toFixed(2)}`);
  console.log(`CLOB Sells:       +$${sells.toFixed(2)}`);
  console.log(`Tokens bought:     ${tokensBought.toFixed(2)}`);
  console.log(`Tokens sold:       ${tokensSold.toFixed(2)}`);
  console.log(`Token Deficit:     ${Math.max(0, tokensSold - tokensBought).toFixed(2)}`);
  console.log(`Token Surplus:     ${Math.max(0, tokensBought - tokensSold).toFixed(2)}`);

  // Get redemptions
  const q4 = `
    SELECT sum(toFloat64(amount_or_payout)) / 1e6 as redemptions
    FROM pm_ctf_events
    WHERE user_address = '${WALLET}'
      AND event_type = 'PayoutRedemption'
  `;
  const r4 = await clickhouse.query({ query: q4, format: 'JSONEachRow' });
  const redemptions = parseFloat(
    ((await r4.json())[0] as { redemptions: string }).redemptions
  );

  const tokenDeficit = Math.max(0, tokensSold - tokensBought);
  const tokenSurplus = Math.max(0, tokensBought - tokensSold);
  const realizedPnL = sells - buys + redemptions - tokenDeficit;

  console.log(`\nCTF Redemptions:  +$${redemptions.toFixed(2)}`);
  console.log(`\n=== DEDUPED REALIZED P&L ===`);
  console.log(`Formula: Sells - Buys + Redemptions - TokenDeficit`);
  console.log(`         ${sells.toFixed(2)} - ${buys.toFixed(2)} + ${redemptions.toFixed(2)} - ${tokenDeficit.toFixed(2)}`);
  console.log(`Realized P&L: $${realizedPnL.toFixed(2)}`);

  // Ground truth comparison
  const groundTruth = -86.66;
  console.log(`\nGround Truth: $${groundTruth.toFixed(2)}`);
  console.log(`Gap: $${(groundTruth - realizedPnL).toFixed(2)}`);

  console.log('\n=== DONE ===');
  process.exit(0);
}

main().catch(console.error);
