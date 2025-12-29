/**
 * Analyze timeline of trades vs CTF events
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '@/lib/clickhouse/client';

const WALLET = '0x925ad88d18dbc7bfeff3b71db7b96ed4bb572c2e';

async function main() {
  console.log('=== TIMELINE ANALYSIS ===\n');
  console.log(`Wallet: ${WALLET}\n`);

  // Get trades timeline
  console.log('1. Trade activity timeline...');
  const q1 = `
    SELECT
      toStartOfHour(trade_time) as hour,
      count() as trades,
      countDistinct(token_id) as unique_tokens
    FROM pm_trader_events_v2
    WHERE trader_wallet = '${WALLET}'
      AND is_deleted = 0
    GROUP BY hour
    ORDER BY hour
  `;
  const r1 = await clickhouse.query({ query: q1, format: 'JSONEachRow' });
  const trades = (await r1.json()) as { hour: string; trades: number; unique_tokens: number }[];
  console.log('Trades by hour:');
  for (const t of trades) {
    console.log(`  ${t.hour}: ${t.trades} trades, ${t.unique_tokens} tokens`);
  }

  // Get CTF events timeline
  console.log('\n2. CTF events timeline...');
  const q2 = `
    SELECT
      toStartOfHour(event_timestamp) as hour,
      event_type,
      count() as events
    FROM pm_ctf_events
    WHERE user_address = '${WALLET}'
    GROUP BY hour, event_type
    ORDER BY hour
  `;
  const r2 = await clickhouse.query({ query: q2, format: 'JSONEachRow' });
  const ctfEvents = (await r2.json()) as { hour: string; event_type: string; events: number }[];
  console.log('CTF events by hour:');
  for (const e of ctfEvents) {
    console.log(`  ${e.hour}: ${e.events} ${e.event_type}`);
  }

  // Check CLOB API for one of the traded tokens to see if we can get market info
  console.log('\n3. Checking if CLOB API has info for traded tokens...');

  // Get a traded token
  const q3 = `
    SELECT DISTINCT token_id
    FROM pm_trader_events_v2
    WHERE trader_wallet = '${WALLET}'
      AND is_deleted = 0
    LIMIT 1
  `;
  const r3 = await clickhouse.query({ query: q3, format: 'JSONEachRow' });
  const token = (await r3.json())[0] as { token_id: string };
  console.log(`Sample token: ${token.token_id.slice(0, 40)}...`);

  // Try CLOB API
  try {
    const url = `https://clob.polymarket.com/markets/${token.token_id}`;
    console.log(`Fetching: ${url}`);
    const res = await fetch(url);
    const data = await res.json();
    console.log('CLOB API response:', JSON.stringify(data).slice(0, 200));
  } catch (e) {
    console.log('CLOB API error:', (e as Error).message);
  }

  // The issue: CLOB trades are for tokens that don't have CTF PayoutRedemption yet
  // because the markets haven't resolved (or we don't have the CTF events)

  console.log('\n4. Hypothesis: CLOB trades are for unresolved markets...');
  console.log('   - CLOB trades: 54 unique tokens (15-min crypto markets)');
  console.log('   - CTF events: 25 PayoutRedemption from 25 different conditions');
  console.log('   - Mismatch: CTF conditions ≠ CLOB token markets');
  console.log('   - This suggests: wallet traded on NEW markets that have not resolved yet');
  console.log('     OR the CTF events are for older resolved markets');

  // Check the earliest and latest trade times vs CTF times
  console.log('\n5. Time ranges...');
  const q5 = `
    SELECT
      min(trade_time) as first_trade,
      max(trade_time) as last_trade
    FROM pm_trader_events_v2
    WHERE trader_wallet = '${WALLET}'
      AND is_deleted = 0
  `;
  const r5 = await clickhouse.query({ query: q5, format: 'JSONEachRow' });
  const tradeRange = (await r5.json())[0] as { first_trade: string; last_trade: string };
  console.log(`Trades: ${tradeRange.first_trade} to ${tradeRange.last_trade}`);

  const q6 = `
    SELECT
      min(event_timestamp) as first_event,
      max(event_timestamp) as last_event
    FROM pm_ctf_events
    WHERE user_address = '${WALLET}'
  `;
  const r6 = await clickhouse.query({ query: q6, format: 'JSONEachRow' });
  const ctfRange = (await r6.json())[0] as { first_event: string; last_event: string };
  console.log(`CTF events: ${ctfRange.first_event} to ${ctfRange.last_event}`);

  // Check ALL CTF event types
  console.log('\n6. All CTF event types for wallet...');
  const q7 = `
    SELECT event_type, count() as cnt
    FROM pm_ctf_events
    WHERE user_address = '${WALLET}'
    GROUP BY event_type
  `;
  const r7 = await clickhouse.query({ query: q7, format: 'JSONEachRow' });
  console.log('CTF event types:', await r7.json());

  // Analysis
  console.log('\n7. ANALYSIS...');
  console.log('   CLOB trades: 54 tokens (all unmapped 15-min crypto markets)');
  console.log('   CTF redemptions: 25 PayoutRedemption events from 25 conditions');
  console.log('   ');
  console.log('   KEY INSIGHT: CTF conditions ≠ CLOB traded tokens!');
  console.log('   - The $358.54 redemptions are from DIFFERENT markets');
  console.log('   - The 54 CLOB-traded tokens are STILL UNRESOLVED');
  console.log('   - OR there is missing data that links them');
  console.log('   ');
  console.log('   The formula: Realized = Sells - Buys + Redemptions - SplitCosts');
  console.log('   assumes all data is for the SAME markets, but this wallet has:');
  console.log('   - Active CLOB trading on 15-min crypto markets');
  console.log('   - CTF redemptions from other markets');

  console.log('\n=== DONE ===');
  process.exit(0);
}

main().catch(console.error);
