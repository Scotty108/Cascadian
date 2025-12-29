/**
 * Check for PositionSplit events that explain the token surplus
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '@/lib/clickhouse/client';

const WALLET = '0x925ad88d18dbc7bfeff3b71db7b96ed4bb572c2e';

async function main() {
  console.log('=== CHECKING POSITION SPLITS ===\n');

  // Get all CTF event types for this wallet
  const q1 = `
    SELECT event_type, count() as cnt, sum(toFloat64(amount_or_payout)) / 1e6 as total_value
    FROM pm_ctf_events
    WHERE user_address = '${WALLET}'
    GROUP BY event_type
  `;
  const r1 = await clickhouse.query({ query: q1, format: 'JSONEachRow' });
  const events = await r1.json();
  console.log('CTF Event Summary:');
  console.log(JSON.stringify(events, null, 2));

  // Get PositionSplit total
  const q2 = `
    SELECT sum(toFloat64(amount_or_payout)) / 1e6 as split_amount
    FROM pm_ctf_events
    WHERE user_address = '${WALLET}'
      AND event_type = 'PositionSplit'
  `;
  const r2 = await clickhouse.query({ query: q2, format: 'JSONEachRow' });
  const splits = (await r2.json())[0] as { split_amount: string };
  const splitAmount = parseFloat(splits.split_amount || '0');
  console.log(`\nPositionSplit Total: $${splitAmount.toFixed(2)}`);

  // The CORRECTED P&L formula:
  // When you split $X, you spend $X USDC to get X YES + X NO tokens
  // Token deficit = tokens_sold - tokens_bought (from CLOB only)
  // This deficit was filled by splits

  // CLOB data
  const q3 = `
    SELECT
      sum(if(side = 'buy', usdc_amount, 0)) / 1e6 as buys,
      sum(if(side = 'sell', usdc_amount, 0)) / 1e6 as sells,
      sum(if(side = 'buy', token_amount, 0)) / 1e6 as tokens_bought,
      sum(if(side = 'sell', token_amount, 0)) / 1e6 as tokens_sold
    FROM pm_trader_events_v2
    WHERE trader_wallet = '${WALLET}'
      AND is_deleted = 0
  `;
  const r3 = await clickhouse.query({ query: q3, format: 'JSONEachRow' });
  const clob = (await r3.json())[0] as {
    buys: string;
    sells: string;
    tokens_bought: string;
    tokens_sold: string;
  };

  const buys = parseFloat(clob.buys);
  const sells = parseFloat(clob.sells);
  const tokensBought = parseFloat(clob.tokens_bought);
  const tokensSold = parseFloat(clob.tokens_sold);
  const tokenDeficit = tokensSold - tokensBought;

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

  console.log('\n=== COMPLETE CASH FLOW ANALYSIS ===');
  console.log('Cash OUT (spent):');
  console.log(`  CLOB Buys:       $${buys.toFixed(2)}`);
  console.log(`  Split Costs:     $${splitAmount.toFixed(2)}`);
  console.log(`  Total OUT:       $${(buys + splitAmount).toFixed(2)}`);

  console.log('\nCash IN (received):');
  console.log(`  CLOB Sells:      $${sells.toFixed(2)}`);
  console.log(`  Redemptions:     $${redemptions.toFixed(2)}`);
  console.log(`  Total IN:        $${(sells + redemptions).toFixed(2)}`);

  const netPnL = (sells + redemptions) - (buys + splitAmount);
  console.log('\n=== CORRECTED P&L ===');
  console.log(`Formula: (Sells + Redemptions) - (Buys + Splits)`);
  console.log(`         (${sells.toFixed(2)} + ${redemptions.toFixed(2)}) - (${buys.toFixed(2)} + ${splitAmount.toFixed(2)})`);
  console.log(`Net P&L: $${netPnL.toFixed(2)}`);

  // Ground truth comparison
  const groundTruth = -86.66;
  console.log(`\nGround Truth: $${groundTruth.toFixed(2)}`);
  console.log(`Gap: $${(groundTruth - netPnL).toFixed(2)}`);

  // Token balance check
  console.log('\n=== TOKEN BALANCE CHECK ===');
  console.log(`Tokens from CLOB buys: ${tokensBought.toFixed(2)}`);
  console.log(`Tokens from splits:    ${(splitAmount * 2).toFixed(2)} (${splitAmount.toFixed(2)} YES + ${splitAmount.toFixed(2)} NO)`);
  console.log(`Total tokens received: ${(tokensBought + splitAmount * 2).toFixed(2)}`);
  console.log(`Tokens sold on CLOB:   ${tokensSold.toFixed(2)}`);
  console.log(`Tokens remaining:      ${(tokensBought + splitAmount * 2 - tokensSold).toFixed(2)}`);

  console.log('\n=== DONE ===');
  process.exit(0);
}

main().catch(console.error);
