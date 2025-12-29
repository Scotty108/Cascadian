/**
 * Check if there are tokens from splits that never appeared in CLOB
 *
 * Theory: When you split, you get BOTH tokens. If you keep one and only sell the other,
 * the kept token might not show in CLOB at all (no trade, just held).
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '@/lib/clickhouse/client';
import { ClobClient } from '@polymarket/clob-client';

const WALLET = '0x925ad88d18dbc7bfeff3b71db7b96ed4bb572c2e';

async function main() {
  console.log('=== CHECKING FOR SPLIT-ONLY TOKENS ===\n');

  const client = new ClobClient('https://clob.polymarket.com', 137);

  // Get all conditions the wallet has split on
  const condQ = `
    WITH wallet_txs AS (
      SELECT DISTINCT lower(concat('0x', hex(transaction_hash))) as tx_hash
      FROM pm_trader_events_v2 WHERE trader_wallet = '${WALLET}' AND is_deleted = 0
    )
    SELECT
      condition_id,
      sum(toFloat64OrZero(amount_or_payout)) / 1e6 as split_amount
    FROM pm_ctf_events
    WHERE tx_hash IN (SELECT tx_hash FROM wallet_txs)
      AND event_type = 'PositionSplit' AND is_deleted = 0
    GROUP BY condition_id
  `;
  const conditions = (await (await clickhouse.query({ query: condQ, format: 'JSONEachRow' })).json()) as any[];

  console.log(`Found ${conditions.length} conditions with splits\n`);

  // Get all tokens traded by this wallet
  const tradedTokensQ = `
    SELECT DISTINCT token_id
    FROM pm_trader_events_v2
    WHERE trader_wallet = '${WALLET}' AND is_deleted = 0
  `;
  const tradedTokens = new Set(
    ((await (await clickhouse.query({ query: tradedTokensQ, format: 'JSONEachRow' })).json()) as any[]).map(
      (t) => t.token_id
    )
  );

  console.log(`Wallet has traded ${tradedTokens.size} unique tokens\n`);

  // For each condition, check if both tokens appear in trades
  let bothTraded = 0;
  let onlyOneTraded = 0;
  let neitherTraded = 0;
  let missingTokenValue = 0;

  for (const { condition_id, split_amount } of conditions) {
    try {
      const m = await client.getMarket('0x' + condition_id);
      if (!m || !m.tokens) continue;

      const token0 = m.tokens[0]?.token_id;
      const token1 = m.tokens[1]?.token_id;

      const t0Traded = tradedTokens.has(token0);
      const t1Traded = tradedTokens.has(token1);

      if (t0Traded && t1Traded) {
        bothTraded++;
      } else if (t0Traded || t1Traded) {
        onlyOneTraded++;
        // Which token was NOT traded?
        const untradedToken = t0Traded ? m.tokens[1] : m.tokens[0];
        console.log(`ONLY ONE TRADED: ${condition_id.slice(0, 20)}...`);
        console.log(`  Split amount: $${parseFloat(split_amount).toFixed(2)}`);
        console.log(
          `  Untraded token: ${untradedToken.outcome} winner=${untradedToken.winner}`
        );

        // If the untraded token is a winner, we're missing held value!
        if (untradedToken.winner === true) {
          const value = parseFloat(split_amount);
          missingTokenValue += value;
          console.log(`  ⚠️ MISSING WINNER VALUE: $${value.toFixed(2)}`);
        }
        console.log('');
      } else {
        neitherTraded++;
        console.log(`NEITHER TRADED: ${condition_id.slice(0, 20)}...`);
      }
    } catch {
      // Skip
    }
  }

  console.log('\n=== SUMMARY ===');
  console.log('Both tokens traded:', bothTraded);
  console.log('Only one traded:', onlyOneTraded);
  console.log('Neither traded:', neitherTraded);
  console.log('\nMissing winner value from untraded tokens: $', missingTokenValue.toFixed(2));

  // Total expected value
  const clobWinners = 139.82;
  const expectedHeld = 413.82;
  console.log('\nCLOB-visible winners:', clobWinners);
  console.log('Expected total held:', expectedHeld);
  console.log('Difference to explain:', (expectedHeld - clobWinners).toFixed(2));
  console.log('Missing from untraded:', missingTokenValue.toFixed(2));

  if (Math.abs(expectedHeld - clobWinners - missingTokenValue) < 10) {
    console.log('\n✅ Missing value is mostly explained by untraded split tokens!');
  }
}

main().catch(console.error);
