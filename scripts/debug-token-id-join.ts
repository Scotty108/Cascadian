import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  const testWallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  console.log("Debugging token_id join issue...\n");

  // Check token_id format in erc1155_transfers
  console.log("1. Sample token_id from erc1155_transfers:");
  console.log("─".repeat(60));
  const erc1155Sample = await clickhouse.query({
    query: `
      SELECT
        token_id,
        length(token_id) as len,
        lower(token_id) as token_lower,
        substring(token_id, 1, 10) || '...' as sample
      FROM erc1155_transfers
      WHERE lower(to_address) = lower('${testWallet}')
         OR lower(from_address) = lower('${testWallet}')
      LIMIT 3
    `,
    format: 'JSONEachRow'
  });
  console.table(await erc1155Sample.json());
  console.log();

  // Check token_id format in ctf_token_map
  console.log("2. Sample token_id from ctf_token_map:");
  console.log("─".repeat(60));
  const ctfSample = await clickhouse.query({
    query: `
      SELECT
        token_id,
        length(token_id) as len,
        lower(token_id) as token_lower,
        substring(token_id, 1, 10) || '...' as sample
      FROM ctf_token_map
      LIMIT 3
    `,
    format: 'JSONEachRow'
  });
  console.table(await ctfSample.json());
  console.log();

  // Try to find a matching token_id
  console.log("3. Looking for matching token_ids:");
  console.log("─".repeat(60));
  const matchTest = await clickhouse.query({
    query: `
      SELECT
        t.token_id as erc1155_token,
        ctm.token_id as ctf_token,
        t.token_id = ctm.token_id as exact_match,
        lower(t.token_id) = lower(ctm.token_id) as case_insensitive_match
      FROM erc1155_transfers t
      CROSS JOIN ctf_token_map ctm
      WHERE lower(t.to_address) = lower('${testWallet}')
         OR lower(t.from_address) = lower('${testWallet}')
      LIMIT 1
    `,
    format: 'JSONEachRow'
  });
  console.table(await matchTest.json());
  console.log();

  // Count unique token_ids in each table
  console.log("4. Unique token_ids count:");
  console.log("─".repeat(60));
  const uniqueCount = await clickhouse.query({
    query: `
      SELECT
        (SELECT count(DISTINCT token_id) FROM erc1155_transfers
         WHERE lower(to_address) = lower('${testWallet}')
            OR lower(from_address) = lower('${testWallet}')) as erc1155_unique,
        (SELECT count(DISTINCT token_id) FROM ctf_token_map) as ctf_unique
    `,
    format: 'JSONEachRow'
  });
  console.table(await uniqueCount.json());
  console.log();

  // Try different join approaches
  console.log("5. Testing different join approaches:");
  console.log("─".repeat(60));

  // Approach A: Direct join
  const approachA = await clickhouse.query({
    query: `
      SELECT count(*) as cnt
      FROM erc1155_transfers t
      INNER JOIN ctf_token_map ctm ON t.token_id = ctm.token_id
      WHERE lower(t.to_address) = lower('${testWallet}')
    `,
    format: 'JSONEachRow'
  });
  console.log(`Approach A (direct): ${(await approachA.json())[0].cnt} rows`);

  // Approach B: Lower case join
  const approachB = await clickhouse.query({
    query: `
      SELECT count(*) as cnt
      FROM erc1155_transfers t
      INNER JOIN ctf_token_map ctm ON lower(t.token_id) = lower(ctm.token_id)
      WHERE lower(t.to_address) = lower('${testWallet}')
    `,
    format: 'JSONEachRow'
  });
  console.log(`Approach B (lowercase): ${(await approachB.json())[0].cnt} rows`);

  // Approach C: Explicit equality check
  const approachC = await clickhouse.query({
    query: `
      SELECT count(*) as cnt
      FROM erc1155_transfers t
      INNER JOIN ctf_token_map ctm ON toString(t.token_id) = toString(ctm.token_id)
      WHERE lower(t.to_address) = lower('${testWallet}')
    `,
    format: 'JSONEachRow'
  });
  console.log(`Approach C (toString): ${(await approachC.json())[0].cnt} rows`);
}

main().catch(console.error);
