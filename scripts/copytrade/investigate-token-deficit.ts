/**
 * Investigate a specific token with high deficit to understand the data
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '@/lib/clickhouse/client';

const WALLET = '0x925ad88d18dbc7bfeff3b71db7b96ed4bb572c2e';
// Token with highest deficit: 82174417277688036255...
const TOKEN = '82174417277688036255408028782849574505820015823645896594040832800252330422417';

async function main() {
  console.log('=== INVESTIGATING HIGH-DEFICIT TOKEN ===\n');
  console.log(`Token: ${TOKEN.slice(0, 30)}...`);

  // Get all trades for this token
  const q1 = `
    SELECT
      event_id,
      role,
      side,
      usdc_amount / 1e6 as usdc,
      token_amount / 1e6 as tokens,
      trade_time
    FROM pm_trader_events_v2
    WHERE trader_wallet = '${WALLET}'
      AND token_id = '${TOKEN}'
      AND is_deleted = 0
    ORDER BY trade_time
  `;
  const r1 = await clickhouse.query({ query: q1, format: 'JSONEachRow' });
  const trades = await r1.json();

  console.log(`\nAll ${(trades as any[]).length} trades for this token:`);
  for (const t of trades as any[]) {
    console.log(`  ${t.trade_time} | ${t.side.toUpperCase().padEnd(4)} | ${t.role.padEnd(5)} | $${parseFloat(t.usdc).toFixed(2).padStart(7)} | ${parseFloat(t.tokens).toFixed(2).padStart(8)} tokens`);
  }

  // Summary
  const q2 = `
    SELECT
      sum(if(side = 'buy', usdc_amount, 0)) / 1e6 as total_buy_usdc,
      sum(if(side = 'sell', usdc_amount, 0)) / 1e6 as total_sell_usdc,
      sum(if(side = 'buy', token_amount, 0)) / 1e6 as total_buy_tokens,
      sum(if(side = 'sell', token_amount, 0)) / 1e6 as total_sell_tokens
    FROM pm_trader_events_v2
    WHERE trader_wallet = '${WALLET}'
      AND token_id = '${TOKEN}'
      AND is_deleted = 0
  `;
  const r2 = await clickhouse.query({ query: q2, format: 'JSONEachRow' });
  const summary = (await r2.json())[0] as any;

  console.log('\n=== TOKEN SUMMARY ===');
  console.log(`Buy USDC:     $${parseFloat(summary.total_buy_usdc).toFixed(2)}`);
  console.log(`Sell USDC:    $${parseFloat(summary.total_sell_usdc).toFixed(2)}`);
  console.log(`Buy Tokens:   ${parseFloat(summary.total_buy_tokens).toFixed(2)}`);
  console.log(`Sell Tokens:  ${parseFloat(summary.total_sell_tokens).toFixed(2)}`);
  console.log(`Token Deficit: ${(parseFloat(summary.total_sell_tokens) - parseFloat(summary.total_buy_tokens)).toFixed(2)}`);

  // Check if this token has any CTF events
  const q3 = `
    SELECT event_type, sum(toFloat64(amount_or_payout)) / 1e6 as total
    FROM pm_ctf_events
    WHERE user_address = '${WALLET}'
    GROUP BY event_type
  `;
  const r3 = await clickhouse.query({ query: q3, format: 'JSONEachRow' });
  const ctf = await r3.json();
  console.log('\n=== ALL CTF EVENTS ===');
  console.log(JSON.stringify(ctf, null, 2));

  // Check a sample CTF event to understand the data structure
  const q4 = `
    SELECT *
    FROM pm_ctf_events
    WHERE user_address = '${WALLET}'
    LIMIT 3
  `;
  const r4 = await clickhouse.query({ query: q4, format: 'JSONEachRow' });
  const ctfSample = await r4.json();
  console.log('\n=== SAMPLE CTF EVENTS ===');
  for (const e of ctfSample as any[]) {
    console.log(JSON.stringify(e, null, 2));
  }

  console.log('\n=== DONE ===');
  process.exit(0);
}

main().catch(console.error);
