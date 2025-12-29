#!/usr/bin/env npx tsx
/**
 * BUILD 100 WALLET COHORT
 *
 * Queries ClickHouse for TRADER_STRICT wallets and builds a 100-wallet cohort
 * for UI truth expansion.
 */

import fs from 'fs/promises';
import { getClickHouseClient } from '../../lib/clickhouse/client';

async function main() {
  const client = getClickHouseClient();

  console.log('\n=== Building 100-wallet TRADER_STRICT cohort ===\n');

  // Query for wallets with sufficient activity that are TRADER_STRICT
  const result = await client.query({
    query: `
      SELECT DISTINCT
        lower(trader_wallet) as wallet
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
      GROUP BY trader_wallet
      HAVING count() >= 10  -- At least 10 trades
      ORDER BY rand()
      LIMIT 150  -- Get extra to filter down
    `,
    format: 'JSONEachRow',
  });

  const rows = await result.json<Array<{ wallet: string }>>();
  console.log(`Found ${rows.length} candidate wallets\n`);

  // Take first 100
  const wallets = rows.slice(0, 100).map(r => r.wallet);

  // Save in format compatible with fetch script
  const output = {
    cohort: 'trader_strict_100',
    description: '100 TRADER_STRICT wallets for expanded UI truth',
    generated_at: new Date().toISOString(),
    wallets,
  };

  await fs.writeFile(
    'tmp/trader_strict_100_cohort.json',
    JSON.stringify(output, null, 2)
  );

  console.log(`✅ Saved 100-wallet cohort to tmp/trader_strict_100_cohort.json`);
  console.log(`\nSample wallets:`);
  wallets.slice(0, 5).forEach(w => console.log(`  ${w}`));
}

main().catch(console.error);
