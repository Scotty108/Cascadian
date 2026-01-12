import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getWalletPnLV1 } from '../lib/pnl/pnlEngineV1';
import { clickhouse } from '../lib/clickhouse/client';

async function main() {
  // Find wallets with decent activity but NO bundled patterns
  const query = `
    WITH wallet_activity AS (
      SELECT
        lower(trader_wallet) as wallet,
        count() as trades,
        round(sum(usdc_amount) / 1e6, 2) as volume
      FROM pm_trader_events_v3
      GROUP BY wallet
      HAVING trades >= 20 AND volume >= 500
    ),
    bundled_wallets AS (
      SELECT DISTINCT lower(t.trader_wallet) as wallet
      FROM pm_trader_events_v3 t
      LEFT JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
      WHERE m.condition_id IS NOT NULL AND m.condition_id != ''
      GROUP BY lower(t.trader_wallet), substring(t.event_id, 1, 66), m.condition_id
      HAVING countIf(t.side='buy') > 0
         AND countIf(t.side='sell') > 0
         AND count(DISTINCT m.outcome_index) >= 2
    )
    SELECT w.wallet, w.trades, w.volume
    FROM wallet_activity w
    WHERE w.wallet NOT IN (SELECT wallet FROM bundled_wallets)
    ORDER BY cityHash64(w.wallet)
    LIMIT 5
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const wallets = (await result.json()) as any[];

  console.log('=== Spot Check: High-Confidence Wallets ===\n');

  for (const w of wallets) {
    const pnl = await getWalletPnLV1(w.wallet);
    console.log(`Wallet: ${w.wallet}`);
    console.log(`  Trades: ${w.trades} | Volume: $${w.volume}`);
    console.log(`  PnL: $${pnl.total.toFixed(2)} | Confidence: ${pnl.confidence}`);
    console.log(`  UI: https://polymarket.com/profile/${w.wallet}`);
    console.log('');
  }
}

main().catch(console.error);
