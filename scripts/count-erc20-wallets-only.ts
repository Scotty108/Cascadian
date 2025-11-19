#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { getClickHouseClient } from './lib/clickhouse/client';

async function main() {
  const ch = getClickHouseClient();

  console.log('\nCounting unique ERC20 USDC wallets (this may take 1-2 min)...\n');

  const startTime = Date.now();

  const result = await ch.query({
    query: `
      SELECT COUNT(DISTINCT wallet) as count
      FROM (
        SELECT DISTINCT lower(replaceAll(replaceAll(topics[2], '0x000000000000000000000000', ''), '0x', '')) as wallet
        FROM default.erc20_transfers_staging
        WHERE length(topics) >= 2 AND topics[2] != ''

        UNION ALL

        SELECT DISTINCT lower(replaceAll(replaceAll(topics[3], '0x000000000000000000000000', ''), '0x', '')) as wallet
        FROM default.erc20_transfers_staging
        WHERE length(topics) >= 3 AND topics[3] != ''
      )
    `,
    format: 'JSONEachRow'
  });

  const data = (await result.json())[0];
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`ERC20 USDC unique wallets: ${parseInt(data.count).toLocaleString()}`);
  console.log(`Query time: ${elapsed} seconds\n`);

  console.log(`Combined totals (estimated):`);
  console.log(`  CLOB + ERC-1155: 1,134,885`);
  console.log(`  ERC20 USDC:      ${parseInt(data.count).toLocaleString()}`);
  console.log(`  Overlap:         ~??? (some wallets in both)`);
  console.log(`  Total unique:    ${(1134885 + parseInt(data.count)).toLocaleString()} (upper bound)`);
  console.log(`\n  vs Dune: 1,507,377 wallets`);

  await ch.close();
}

main().catch(console.error);
