#!/usr/bin/env npx tsx
/**
 * Create small_20 and big_20 wallet cohorts based on trade volume
 *
 * Strategy:
 * - Small: wallets with moderate activity (100-500 trades, likely < $500K realized)
 * - Big: wallets with high activity (5000+ trades, likely > $1M realized)
 */

import { clickhouse } from '../../lib/clickhouse/client';
import fs from 'fs/promises';

async function main() {
  console.log('Creating wallet cohorts based on trade volume...\n');

  // Query for small wallets (moderate traders)
  const smallQuery = `
    SELECT
      wallet_address,
      COUNT(*) as trade_count
    FROM (
      SELECT
        event_id,
        any(trader_wallet) as wallet_address
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
      GROUP BY event_id
    )
    GROUP BY wallet_address
    HAVING trade_count BETWEEN 100 AND 500
    ORDER BY trade_count DESC
    LIMIT 20
  `;

  // Query for big wallets (high-volume traders)
  const bigQuery = `
    SELECT
      wallet_address,
      COUNT(*) as trade_count
    FROM (
      SELECT
        event_id,
        any(trader_wallet) as wallet_address
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
      GROUP BY event_id
    )
    GROUP BY wallet_address
    HAVING trade_count >= 5000
    ORDER BY trade_count DESC
    LIMIT 20
  `;

  console.log('Fetching small wallet cohort (100-500 trades)...');
  const smallResult = await clickhouse.query({ query: smallQuery });
  const smallWallets = await smallResult.json<{ wallet_address: string; trade_count: string }>();

  console.log(`  Found ${smallWallets.data.length} small wallets`);
  console.log(`  Trade count range: ${smallWallets.data[smallWallets.data.length - 1]?.trade_count} - ${smallWallets.data[0]?.trade_count}\n`);

  console.log('Fetching big wallet cohort (5000+ trades)...');
  const bigResult = await clickhouse.query({ query: bigQuery });
  const bigWallets = await bigResult.json<{ wallet_address: string; trade_count: string }>();

  console.log(`  Found ${bigWallets.data.length} big wallets`);
  console.log(`  Trade count range: ${bigWallets.data[bigWallets.data.length - 1]?.trade_count} - ${bigWallets.data[0]?.trade_count}\n`);

  // Write small wallets
  const smallOutput = {
    cohort: 'small_20',
    description: 'Moderate activity wallets (100-500 trades)',
    generated_at: new Date().toISOString(),
    wallets: smallWallets.data.map(w => w.wallet_address.toLowerCase()),
  };

  await fs.writeFile(
    'tmp/small_20_wallets.json',
    JSON.stringify(smallOutput, null, 2)
  );
  console.log('✅ Written: tmp/small_20_wallets.json');

  // Write big wallets
  const bigOutput = {
    cohort: 'big_20',
    description: 'High activity wallets (5000+ trades)',
    generated_at: new Date().toISOString(),
    wallets: bigWallets.data.map(w => w.wallet_address.toLowerCase()),
  };

  await fs.writeFile(
    'tmp/big_20_wallets.json',
    JSON.stringify(bigOutput, null, 2)
  );
  console.log('✅ Written: tmp/big_20_wallets.json\n');

  // Display samples
  console.log('Small cohort sample (first 3):');
  smallWallets.data.slice(0, 3).forEach((w, i) => {
    console.log(`  ${i + 1}. ${w.wallet_address} (${w.trade_count} trades)`);
  });

  console.log('\nBig cohort sample (first 3):');
  bigWallets.data.slice(0, 3).forEach((w, i) => {
    console.log(`  ${i + 1}. ${w.wallet_address} (${w.trade_count} trades)`);
  });
}

main().catch(console.error);
