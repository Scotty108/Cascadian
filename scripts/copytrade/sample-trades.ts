/**
 * Sample actual trades to understand the data structure
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '@/lib/clickhouse/client';

const WALLET = '0x925ad88d18dbc7bfeff3b71db7b96ed4bb572c2e';

async function main() {
  console.log('=== SAMPLING TRADES ===\n');

  // Get sample trades
  const q1 = `
    SELECT
      event_id,
      side,
      role,
      token_id,
      usdc_amount / 1e6 as usdc,
      token_amount / 1e6 as tokens,
      trade_time
    FROM pm_trader_events_v2
    WHERE trader_wallet = '${WALLET}'
      AND is_deleted = 0
    ORDER BY trade_time
    LIMIT 20
  `;
  const r1 = await clickhouse.query({ query: q1, format: 'JSONEachRow' });
  const trades = await r1.json();

  console.log('First 20 trades:');
  for (const t of trades as any[]) {
    console.log(`  ${t.trade_time} | ${t.side.toUpperCase().padEnd(4)} | ${t.role.padEnd(5)} | $${parseFloat(t.usdc).toFixed(2).padStart(6)} | ${parseFloat(t.tokens).toFixed(2).padStart(8)} tokens`);
  }

  // Check role distribution
  const q2 = `
    SELECT
      role,
      side,
      count() as cnt,
      sum(usdc_amount) / 1e6 as total_usdc,
      sum(token_amount) / 1e6 as total_tokens
    FROM pm_trader_events_v2
    WHERE trader_wallet = '${WALLET}'
      AND is_deleted = 0
    GROUP BY role, side
  `;
  const r2 = await clickhouse.query({ query: q2, format: 'JSONEachRow' });
  const roles = await r2.json();
  console.log('\nRole/Side breakdown:');
  console.log(JSON.stringify(roles, null, 2));

  // Check for potential duplicate counting - same event with different sides
  const q3 = `
    SELECT
      token_id,
      sum(if(side = 'buy', 1, 0)) as buy_count,
      sum(if(side = 'sell', 1, 0)) as sell_count,
      sum(if(side = 'buy', token_amount, 0)) / 1e6 as tokens_bought,
      sum(if(side = 'sell', token_amount, 0)) / 1e6 as tokens_sold
    FROM pm_trader_events_v2
    WHERE trader_wallet = '${WALLET}'
      AND is_deleted = 0
    GROUP BY token_id
    ORDER BY tokens_sold DESC
    LIMIT 10
  `;
  const r3 = await clickhouse.query({ query: q3, format: 'JSONEachRow' });
  const byToken = await r3.json();
  console.log('\nTop 10 tokens by tokens sold:');
  for (const t of byToken as any[]) {
    const deficit = parseFloat(t.tokens_sold) - parseFloat(t.tokens_bought);
    console.log(`  ${t.token_id.slice(0, 20)}... | buys=${t.buy_count} sells=${t.sell_count} | bought=${parseFloat(t.tokens_bought).toFixed(2)} sold=${parseFloat(t.tokens_sold).toFixed(2)} | deficit=${deficit.toFixed(2)}`);
  }

  // Check if there are any ERC1155 transfers - skip for now as table may not exist

  console.log('\n=== DONE ===');
  process.exit(0);
}

main().catch(console.error);
