/**
 * Validate that pm_wallets_perfect_tier wallets are actually 100% win rate
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

async function getPM(wallet: string): Promise<number | null> {
  try {
    const res = await fetch(`https://user-pnl-api.polymarket.com/user-pnl?user_address=${wallet}`);
    const data = await res.json();
    return Array.isArray(data) && data.length > 0 ? data[data.length - 1].p : null;
  } catch {
    return null;
  }
}

async function validateWallet(wallet: string) {
  console.log('\n' + '='.repeat(70));
  console.log('Wallet:', wallet);

  // Get trade summary
  const q1 = `
    SELECT
      side,
      count() as trades,
      round(sum(usdc_amount) / 1e6, 2) as usdc
    FROM pm_trader_events_v3
    WHERE lower(trader_wallet) = '${wallet}'
    GROUP BY side
  `;
  const r1 = await clickhouse.query({ query: q1, format: 'JSONEachRow' });
  const summary = await r1.json() as any[];
  console.log('Trade summary:', summary);

  // Get unique markets traded
  const q2 = `
    SELECT count(DISTINCT m.condition_id) as markets
    FROM pm_trader_events_v3 t
    JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
    WHERE lower(t.trader_wallet) = '${wallet}'
      AND m.condition_id != ''
  `;
  const r2 = await clickhouse.query({ query: q2, format: 'JSONEachRow' });
  const markets = (await r2.json() as any[])[0];
  console.log('Unique markets:', markets.markets);

  // Get Polymarket PnL
  const pnl = await getPM(wallet);
  console.log('Polymarket PnL:', pnl !== null ? `$${pnl.toFixed(2)}` : 'N/A');

  // Check if PnL is positive (which would support "100% win rate")
  if (pnl !== null) {
    console.log('Is profitable?', pnl > 0 ? 'YES ✅' : 'NO ❌');
  }
}

async function main() {
  // Get 2 random wallets from perfect_tier
  const q = `
    SELECT wallet, trade_count, total_volume_usdc
    FROM pm_wallets_perfect_tier
    WHERE trade_count >= 20
    ORDER BY rand()
    LIMIT 2
  `;
  const r = await clickhouse.query({ query: q, format: 'JSONEachRow' });
  const wallets = await r.json() as any[];

  console.log('Validating 2 random pm_wallets_perfect_tier wallets...');

  for (const w of wallets) {
    console.log('\nFrom table:', w);
    await validateWallet(w.wallet);
  }
}

main().catch(console.error);
