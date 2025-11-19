#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

const wallets = [
  { address: '0x1489046ca0f9980fc2d9a950d103d3bec02c1307', pm_pnl: 137663, name: 'burrito338' },
  { address: '0x8e9eedf20dfa70956d49f608a205e402d9df38e4', pm_pnl: 360492, name: 'wallet2' },
  { address: '0x4ce73141dbfce41e65db3723e31059a730f0abad', pm_pnl: 332563, name: 'wallet3' },
  { address: '0xb48ef6deecd526c0974c35e1f7b5c3bbd12fa144', pm_pnl: 114087, name: 'wallet4' },
];

async function investigateWalletData() {
  console.log('INVESTIGATING WALLET DATA AVAILABILITY');
  console.log('═'.repeat(100));
  console.log();

  for (const wallet of wallets) {
    console.log(`\n${wallet.name}: ${wallet.address}`);
    console.log('─'.repeat(100));

    // Check trades exist
    const tradeCount = await client.query({
      query: `
        SELECT count() as cnt
        FROM default.vw_trades_canonical
        WHERE lower(wallet_address_norm) = lower('${wallet.address}')
      `,
      format: 'JSONEachRow',
    });
    const trades = (await tradeCount.json<any[]>())[0];
    console.log(`  Total trades: ${trades.cnt}`);

    // Check trades with non-zero condition_id
    const validTradeCount = await client.query({
      query: `
        SELECT count() as cnt
        FROM default.vw_trades_canonical
        WHERE lower(wallet_address_norm) = lower('${wallet.address}')
          AND condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
      `,
      format: 'JSONEachRow',
    });
    const validTrades = (await validTradeCount.json<any[]>())[0];
    console.log(`  Valid trades (non-zero condition_id): ${validTrades.cnt}`);

    // Check unique markets traded
    const marketCount = await client.query({
      query: `
        SELECT count(DISTINCT condition_id_norm) as cnt
        FROM default.vw_trades_canonical
        WHERE lower(wallet_address_norm) = lower('${wallet.address}')
          AND condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
      `,
      format: 'JSONEachRow',
    });
    const markets = (await marketCount.json<any[]>())[0];
    console.log(`  Unique markets: ${markets.cnt}`);

    // Check markets with resolutions
    const resolvedCount = await client.query({
      query: `
        SELECT count(DISTINCT t.condition_id_norm) as cnt
        FROM default.vw_trades_canonical t
        INNER JOIN cascadian_clean.vw_resolutions_unified r
          ON lower(t.condition_id_norm) = r.cid_hex
        WHERE lower(t.wallet_address_norm) = lower('${wallet.address}')
          AND t.condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
      `,
      format: 'JSONEachRow',
    });
    const resolved = (await resolvedCount.json<any[]>())[0];
    console.log(`  Markets with resolutions: ${resolved.cnt}`);

    // Sample a few trades to see data quality
    const sample = await client.query({
      query: `
        SELECT
          condition_id_norm,
          market_id_norm,
          trade_direction,
          shares,
          usd_value,
          outcome_index
        FROM default.vw_trades_canonical
        WHERE lower(wallet_address_norm) = lower('${wallet.address}')
          AND condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
        LIMIT 5
      `,
      format: 'JSONEachRow',
    });
    const sampleTrades = await sample.json<any[]>();
    
    if (sampleTrades.length > 0) {
      console.log(`  Sample trades:`);
      sampleTrades.forEach((t, i) => {
        console.log(`    ${i+1}. ${t.trade_direction} ${t.shares} shares @ $${t.usd_value} | condition: ${t.condition_id_norm.slice(0, 10)}...`);
      });
    } else {
      console.log(`  ⚠️ NO TRADES FOUND`);
    }

    console.log();
  }

  await client.close();
}

investigateWalletData().catch(console.error);
