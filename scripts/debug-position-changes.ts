import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  const testWallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  console.log("Testing position_changes CTE step by step...\n");

  // Test 1: Simple join without WHERE clause
  console.log("Test 1: Simple INNER JOIN (no WHERE)");
  console.log("─".repeat(60));
  const test1 = await clickhouse.query({
    query: `
      SELECT count(*) as cnt
      FROM erc1155_transfers t
      INNER JOIN ctf_token_map ctm ON t.token_id = ctm.token_id
    `,
    format: 'JSONEachRow'
  });
  console.log(`Result: ${(await test1.json())[0].cnt} rows\n`);

  // Test 2: Add wallet filter
  console.log("Test 2: Add wallet filter");
  console.log("─".repeat(60));
  const test2 = await clickhouse.query({
    query: `
      SELECT count(*) as cnt
      FROM erc1155_transfers t
      INNER JOIN ctf_token_map ctm ON t.token_id = ctm.token_id
      WHERE lower(t.to_address) = lower('${testWallet}')
         OR lower(t.from_address) = lower('${testWallet}')
    `,
    format: 'JSONEachRow'
  });
  console.log(`Result: ${(await test2.json())[0].cnt} rows\n`);

  // Test 3: Add self-transfer filter
  console.log("Test 3: Add self-transfer filter");
  console.log("─".repeat(60));
  const test3 = await clickhouse.query({
    query: `
      SELECT count(*) as cnt
      FROM erc1155_transfers t
      INNER JOIN ctf_token_map ctm ON t.token_id = ctm.token_id
      WHERE (lower(t.to_address) = lower('${testWallet}')
         OR lower(t.from_address) = lower('${testWallet}'))
        AND t.to_address != t.from_address
    `,
    format: 'JSONEachRow'
  });
  console.log(`Result: ${(await test3.json())[0].cnt} rows\n`);

  // Test 4: Full position_changes with CASE statements
  console.log("Test 4: Full position_changes CTE");
  console.log("─".repeat(60));
  const test4 = await clickhouse.query({
    query: `
      WITH position_changes AS (
        SELECT
          CASE
            WHEN t.to_address != '0x0000000000000000000000000000000000000000'
            THEN lower(t.to_address)
            ELSE NULL
          END AS wallet_to,
          CASE
            WHEN t.from_address != '0x0000000000000000000000000000000000000000'
            THEN lower(t.from_address)
            ELSE NULL
          END AS wallet_from,
          ctm.condition_id_norm,
          ctm.outcome_index AS outcome_idx,
          CAST(reinterpretAsUInt64(reverse(unhex(substring(t.value, 3)))) AS Float64) AS shares
        FROM erc1155_transfers t
        INNER JOIN ctf_token_map ctm ON t.token_id = ctm.token_id
        WHERE t.to_address != t.from_address
      )
      SELECT count(*) as total_rows,
             countIf(wallet_to IS NOT NULL) as has_wallet_to,
             countIf(wallet_from IS NOT NULL) as has_wallet_from
      FROM position_changes
    `,
    format: 'JSONEachRow'
  });
  const test4Data = (await test4.json())[0];
  console.log(`Total rows: ${test4Data.total_rows}`);
  console.log(`Has wallet_to: ${test4Data.has_wallet_to}`);
  console.log(`Has wallet_from: ${test4Data.has_wallet_from}\n`);

  // Test 5: Check if case-sensitivity is an issue
  console.log("Test 5: Sample data from position_changes");
  console.log("─".repeat(60));
  const test5 = await clickhouse.query({
    query: `
      WITH position_changes AS (
        SELECT
          CASE
            WHEN t.to_address != '0x0000000000000000000000000000000000000000'
            THEN lower(t.to_address)
            ELSE NULL
          END AS wallet_to,
          CASE
            WHEN t.from_address != '0x0000000000000000000000000000000000000000'
            THEN lower(t.from_address)
            ELSE NULL
          END AS wallet_from,
          ctm.condition_id_norm,
          ctm.outcome_index AS outcome_idx,
          CAST(reinterpretAsUInt64(reverse(unhex(substring(t.value, 3)))) AS Float64) AS shares
        FROM erc1155_transfers t
        INNER JOIN ctf_token_map ctm ON t.token_id = ctm.token_id
        WHERE t.to_address != t.from_address
      )
      SELECT
        substring(wallet_to, 1, 10) || '...' as to_addr,
        substring(wallet_from, 1, 10) || '...' as from_addr,
        substring(condition_id_norm, 1, 10) || '...' as cid,
        outcome_idx,
        shares
      FROM position_changes
      WHERE lower(wallet_to) = lower('${testWallet}')
         OR lower(wallet_from) = lower('${testWallet}')
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });
  const test5Data = await test5.json();
  console.table(test5Data);
}

main().catch(console.error);
