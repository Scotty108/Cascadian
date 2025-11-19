#!/usr/bin/env npx tsx

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from './lib/clickhouse/client';

async function main() {
  console.log('🔍 Searching for egg markets in entire database...\n');

  // Search for "eggs below $4.50 in May"
  const searchResult = await clickhouse.query({
    query: `
      SELECT
        market_id,
        condition_id,
        lower(replaceAll(condition_id, '0x', '')) as condition_id_norm,
        groupArray(DISTINCT lower(wallet)) as wallets,
        count() as total_trades,
        sum(toFloat64(shares)) as total_volume
      FROM default.trades_raw
      WHERE (
        market_id LIKE '%egg%'
        OR market_id LIKE '%4.50%'
        OR market_id LIKE '%$4.50%'
        OR market_id LIKE '%May%'
      )
      GROUP BY market_id, condition_id
      ORDER BY total_trades DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });
  const markets = await searchResult.json<Array<any>>();

  console.log(`Found ${markets.length} egg-related markets:\n`);

  for (const market of markets) {
    console.log(`━━━ ${market.market_id} ━━━`);
    console.log(`  Condition ID: ${market.condition_id_norm.substring(0, 16)}...`);
    console.log(`  Total trades: ${market.total_trades}`);
    console.log(`  Total volume: ${parseFloat(market.total_volume).toFixed(0)} shares`);
    console.log(`  Unique wallets: ${market.wallets.length}`);
    console.log(`  Sample wallets:`);
    market.wallets.slice(0, 5).forEach((w: string) => {
      console.log(`    ${w}`);
    });
    console.log('');
  }

  // Also search for high-volume No positions at 23¢ (the profile shows 53,683 No at 23¢)
  console.log('\n━━━ Searching for large No positions around 23¢ ━━━\n');
  const largeNoResult = await clickhouse.query({
    query: `
      SELECT
        market_id,
        lower(wallet) as wallet,
        count() as trades,
        sum(if(trade_direction = 'BUY', toFloat64(shares), -toFloat64(shares))) as net_shares,
        avg(toFloat64(entry_price)) as avg_price
      FROM default.trades_raw
      WHERE side = 'NO'
        AND toFloat64(entry_price) BETWEEN 0.20 AND 0.26
      GROUP BY market_id, wallet
      HAVING net_shares > 50000 AND net_shares < 60000
      ORDER BY net_shares DESC
      LIMIT 20
    `,
    format: 'JSONEachRow'
  });
  const largeNo = await largeNoResult.json<Array<any>>();

  console.log(`Found ${largeNo.length} positions matching "53,683 No at ~23¢":\n`);
  largeNo.forEach(pos => {
    console.log(`  ${pos.market_id}`);
    console.log(`    Wallet: ${pos.wallet}`);
    console.log(`    Net shares: ${parseFloat(pos.net_shares).toFixed(1)}`);
    console.log(`    Avg price: ${parseFloat(pos.avg_price).toFixed(2)}`);
    console.log('');
  });
}

main().catch(console.error);
