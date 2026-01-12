import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getWalletPnLV1 } from '../lib/pnl/pnlEngineV1';
import { clickhouse } from '../lib/clickhouse/client';

async function main() {
  // Get 30 random active wallets, check each for high confidence
  const query = `
    SELECT DISTINCT lower(trader_wallet) as wallet
    FROM pm_trader_events_v3
    WHERE trade_time >= now() - INTERVAL 30 DAY
    ORDER BY cityHash64(trader_wallet)
    LIMIT 30
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const wallets = (await result.json()) as any[];

  console.log('Finding truly high-confidence wallets...\n');

  const highConf: any[] = [];

  for (const w of wallets) {
    if (highConf.length >= 10) break;

    const pnl = await getWalletPnLV1(w.wallet);
    if (pnl.confidence === 'high') {
      highConf.push({
        wallet: w.wallet,
        total: pnl.total,
        realized: pnl.realized.pnl,
        unrealized: pnl.unrealized.pnl,
        bundled: pnl.bundledTxCount
      });
      console.log(`Found: ${w.wallet.slice(0,10)}... | PnL: $${pnl.total.toFixed(2)} | Bundled: ${pnl.bundledTxCount}`);
    }
  }

  console.log('\n=== High Confidence Wallets ===');
  for (const h of highConf) {
    console.log(`${h.wallet} | $${h.total.toFixed(2)}`);
    console.log(`  UI: https://polymarket.com/profile/${h.wallet}`);
  }
}

main();
