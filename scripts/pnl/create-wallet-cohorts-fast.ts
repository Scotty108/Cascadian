#!/usr/bin/env npx tsx
/**
 * Create small_20 and big_20 wallet cohorts based on unified ledger activity
 * Uses pm_unified_ledger_v8_tbl (physical table) for speed
 */

import { clickhouse } from '../../lib/clickhouse/client';
import fs from 'fs/promises';

async function main() {
  console.log('Creating wallet cohorts from pm_unified_ledger_v8_tbl...\n');

  // Query for small wallets (moderate event count: 500-2000 events)
  const smallQuery = `
    SELECT
      wallet_address,
      COUNT(*) as event_count
    FROM pm_unified_ledger_v8_tbl
    WHERE wallet_address != ''
    GROUP BY wallet_address
    HAVING event_count BETWEEN 500 AND 2000
    ORDER BY event_count DESC
    LIMIT 20
  `;

  // Query for big wallets (high event count: 10000+ events)
  const bigQuery = `
    SELECT
      wallet_address,
      COUNT(*) as event_count
    FROM pm_unified_ledger_v8_tbl
    WHERE wallet_address != ''
    GROUP BY wallet_address
    HAVING event_count >= 10000
    ORDER BY event_count DESC
    LIMIT 20
  `;

  console.log('Fetching small wallet cohort (500-2000 ledger events)...');
  const smallResult = await clickhouse.query({ query: smallQuery });
  const smallWallets = await smallResult.json<{ wallet_address: string; event_count: string }>();

  console.log(`  Found ${smallWallets.data.length} small wallets`);
  if (smallWallets.data.length > 0) {
    console.log(`  Event count range: ${smallWallets.data[smallWallets.data.length - 1]?.event_count} - ${smallWallets.data[0]?.event_count}`);
  }
  console.log();

  console.log('Fetching big wallet cohort (10000+ ledger events)...');
  const bigResult = await clickhouse.query({ query: bigQuery });
  const bigWallets = await bigResult.json<{ wallet_address: string; event_count: string }>();

  console.log(`  Found ${bigWallets.data.length} big wallets`);
  if (bigWallets.data.length > 0) {
    console.log(`  Event count range: ${bigWallets.data[bigWallets.data.length - 1]?.event_count} - ${bigWallets.data[0]?.event_count}`);
  }
  console.log();

  // Write small wallets
  const smallOutput = {
    cohort: 'small_20',
    description: 'Moderate activity wallets (500-2000 ledger events)',
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
    description: 'High activity wallets (10000+ ledger events)',
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
    console.log(`  ${i + 1}. ${w.wallet_address} (${w.event_count} events)`);
  });

  console.log('\nBig cohort sample (first 3):');
  bigWallets.data.slice(0, 3).forEach((w, i) => {
    console.log(`  ${i + 1}. ${w.wallet_address} (${w.event_count} events)`);
  });
  console.log();
}

main().catch(console.error);
