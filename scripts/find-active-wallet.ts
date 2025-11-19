#!/usr/bin/env tsx
import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
});

(async () => {
  console.log('\n🔍 Finding wallets with highest trade counts...\n');

  const topWallets = await ch.query({
    query: `
      SELECT
        wallet_address,
        COUNT(*) as trade_count,
        COUNT(DISTINCT cid) as markets_traded,
        SUM(ABS(usdc_amount)) as total_volume
      FROM default.fact_trades_clean
      GROUP BY wallet_address
      ORDER BY trade_count DESC
      LIMIT 10
    `,
    format: 'JSONEachRow',
  });

  const wallets = await topWallets.json();

  console.log('Top 10 wallets by trade count:\n');
  for (let i = 0; i < wallets.length; i++) {
    const w = wallets[i];
    console.log(`${i+1}. ${w.wallet_address}`);
    console.log(`   Trades: ${parseInt(w.trade_count).toLocaleString()}`);
    console.log(`   Markets: ${parseInt(w.markets_traded).toLocaleString()}`);
    console.log(`   Volume: $${parseFloat(w.total_volume).toLocaleString(undefined, {maximumFractionDigits: 2})}`);
    console.log();
  }

  await ch.close();
})();
