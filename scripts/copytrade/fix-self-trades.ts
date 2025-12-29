/**
 * Fix the self-trade double-counting issue
 *
 * When a wallet trades with itself, we see the same trade twice:
 * - Once as maker
 * - Once as taker
 *
 * We need to count each trade only ONCE.
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '@/lib/clickhouse/client';

const WALLET = '0x925ad88d18dbc7bfeff3b71db7b96ed4bb572c2e';

async function main() {
  console.log('=== FIXING SELF-TRADE DOUBLE COUNTING ===\n');

  // Count how many trades have both maker and taker as this wallet
  const q1 = `
    SELECT
      event_id,
      count() as cnt,
      groupArray(role) as roles
    FROM pm_trader_events_v2
    WHERE trader_wallet = '${WALLET}'
      AND is_deleted = 0
    GROUP BY event_id
    HAVING cnt > 1
    LIMIT 10
  `;
  const r1 = await clickhouse.query({ query: q1, format: 'JSONEachRow' });
  const multiRole = await r1.json();
  console.log('Events with multiple roles (self-trades):');
  console.log(JSON.stringify(multiRole, null, 2));

  // Count total self-trades
  const q2 = `
    SELECT
      countIf(cnt > 1) as self_trade_events,
      countIf(cnt = 1) as normal_events,
      sum(if(cnt > 1, cnt - 1, 0)) as duplicate_rows
    FROM (
      SELECT event_id, count() as cnt
      FROM pm_trader_events_v2
      WHERE trader_wallet = '${WALLET}'
        AND is_deleted = 0
      GROUP BY event_id
    )
  `;
  const r2 = await clickhouse.query({ query: q2, format: 'JSONEachRow' });
  const counts = (await r2.json())[0] as {
    self_trade_events: number;
    normal_events: number;
    duplicate_rows: number;
  };
  console.log('\nSelf-trade summary:');
  console.log(JSON.stringify(counts, null, 2));

  // For self-trades, we should only count the TAKER side (the active initiator)
  // Correct calculation: only count role='taker' rows, OR dedupe by event_id
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

  console.log('\n=== DEDUPED BY EVENT_ID ===');
  console.log(`Buys:          $${buys.toFixed(2)}`);
  console.log(`Sells:         $${sells.toFixed(2)}`);
  console.log(`Tokens bought: ${tokensBought.toFixed(2)}`);
  console.log(`Tokens sold:   ${tokensSold.toFixed(2)}`);

  // Now try the CORRECT approach: only count TAKER trades
  // When you're the taker, you're the one initiating the trade
  const q4 = `
    SELECT
      sum(if(side = 'buy', usdc_amount, 0)) / 1e6 as buys,
      sum(if(side = 'sell', usdc_amount, 0)) / 1e6 as sells,
      sum(if(side = 'buy', token_amount, 0)) / 1e6 as tokens_bought,
      sum(if(side = 'sell', token_amount, 0)) / 1e6 as tokens_sold
    FROM pm_trader_events_v2
    WHERE trader_wallet = '${WALLET}'
      AND is_deleted = 0
      AND role = 'taker'
  `;
  const r4 = await clickhouse.query({ query: q4, format: 'JSONEachRow' });
  const takerOnly = (await r4.json())[0] as {
    buys: string;
    sells: string;
    tokens_bought: string;
    tokens_sold: string;
  };

  console.log('\n=== TAKER-ONLY TRADES ===');
  console.log(`Buys:          $${parseFloat(takerOnly.buys).toFixed(2)}`);
  console.log(`Sells:         $${parseFloat(takerOnly.sells).toFixed(2)}`);
  console.log(`Tokens bought: ${parseFloat(takerOnly.tokens_bought).toFixed(2)}`);
  console.log(`Tokens sold:   ${parseFloat(takerOnly.tokens_sold).toFixed(2)}`);

  // Now try MAKER-ONLY
  const q5 = `
    SELECT
      sum(if(side = 'buy', usdc_amount, 0)) / 1e6 as buys,
      sum(if(side = 'sell', usdc_amount, 0)) / 1e6 as sells,
      sum(if(side = 'buy', token_amount, 0)) / 1e6 as tokens_bought,
      sum(if(side = 'sell', token_amount, 0)) / 1e6 as tokens_sold
    FROM pm_trader_events_v2
    WHERE trader_wallet = '${WALLET}'
      AND is_deleted = 0
      AND role = 'maker'
  `;
  const r5 = await clickhouse.query({ query: q5, format: 'JSONEachRow' });
  const makerOnly = (await r5.json())[0] as {
    buys: string;
    sells: string;
    tokens_bought: string;
    tokens_sold: string;
  };

  console.log('\n=== MAKER-ONLY TRADES ===');
  console.log(`Buys:          $${parseFloat(makerOnly.buys).toFixed(2)}`);
  console.log(`Sells:         $${parseFloat(makerOnly.sells).toFixed(2)}`);
  console.log(`Tokens bought: ${parseFloat(makerOnly.tokens_bought).toFixed(2)}`);
  console.log(`Tokens sold:   ${parseFloat(makerOnly.tokens_sold).toFixed(2)}`);

  // Get redemptions
  const q6 = `
    SELECT sum(toFloat64(amount_or_payout)) / 1e6 as redemptions
    FROM pm_ctf_events
    WHERE user_address = '${WALLET}'
      AND event_type = 'PayoutRedemption'
  `;
  const r6 = await clickhouse.query({ query: q6, format: 'JSONEachRow' });
  const redemptions = parseFloat(
    ((await r6.json())[0] as { redemptions: string }).redemptions
  );

  // Calculate P&L using TAKER-only (the initiator)
  const takerBuys = parseFloat(takerOnly.buys);
  const takerSells = parseFloat(takerOnly.sells);
  const takerTokensBought = parseFloat(takerOnly.tokens_bought);
  const takerTokensSold = parseFloat(takerOnly.tokens_sold);
  const takerTokenDeficit = Math.max(0, takerTokensSold - takerTokensBought);
  const takerTokenSurplus = Math.max(0, takerTokensBought - takerTokensSold);

  console.log('\n=== TAKER-ONLY P&L CALCULATION ===');
  console.log(`Buys:            -$${takerBuys.toFixed(2)}`);
  console.log(`Sells:           +$${takerSells.toFixed(2)}`);
  console.log(`Redemptions:     +$${redemptions.toFixed(2)}`);
  console.log(`Token Deficit:   -$${takerTokenDeficit.toFixed(2)}`);
  console.log(`Token Surplus:    ${takerTokenSurplus.toFixed(2)} tokens`);

  const takerPnL = takerSells - takerBuys + redemptions - takerTokenDeficit;
  console.log(`\nTaker P&L:       $${takerPnL.toFixed(2)}`);

  // Ground truth comparison
  const groundTruth = -86.66;
  console.log(`Ground Truth:    $${groundTruth.toFixed(2)}`);
  console.log(`Gap:             $${(groundTruth - takerPnL).toFixed(2)}`);

  console.log('\n=== DONE ===');
  process.exit(0);
}

main().catch(console.error);
