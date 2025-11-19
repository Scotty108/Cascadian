import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  console.log("═".repeat(80));
  console.log("DEBUGGING ERC1155 CONVERSION");
  console.log("═".repeat(80));
  console.log();

  const testWallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  // Step 1: Check raw ERC1155 transfers
  console.log("Step 1: Raw ERC1155 transfers...");
  console.log("─".repeat(80));

  const rawQuery = await clickhouse.query({
    query: `
      SELECT
        substring(token_id, 1, 12) || '...' as token,
        substring(from_address, 1, 12) || '...' as from_addr,
        substring(to_address, 1, 12) || '...' as to_addr,
        value
      FROM erc1155_transfers
      WHERE lower(to_address) = lower('${testWallet}')
         OR lower(from_address) = lower('${testWallet}')
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });
  const rawData = await rawQuery.json();

  console.log("\nSample raw transfers:");
  console.table(rawData);

  // Step 2: Test hex conversion
  console.log("\nStep 2: Testing hex conversion...");
  console.log("─".repeat(80));

  const hexTestQuery = await clickhouse.query({
    query: `
      SELECT
        value as original_value,
        reinterpretAsUInt64(reverse(unhex(substring(value, 3)))) as converted_uint64,
        CAST(reinterpretAsUInt64(reverse(unhex(substring(value, 3)))) AS Float64) as converted_float64
      FROM erc1155_transfers
      WHERE lower(to_address) = lower('${testWallet}')
         OR lower(from_address) = lower('${testWallet}')
      LIMIT 3
    `,
    format: 'JSONEachRow'
  });
  const hexTestData = await hexTestQuery.json();

  console.log("\nHex conversion test:");
  console.table(hexTestData);

  // Step 3: Check join with ctf_token_map
  console.log("\nStep 3: Testing join with ctf_token_map...");
  console.log("─".repeat(80));

  const joinTestQuery = await clickhouse.query({
    query: `
      SELECT
        count(*) as total_transfers,
        countIf(ctm.condition_id_norm IS NOT NULL) as mapped_transfers,
        countIf(ctm.condition_id_norm IS NOT NULL) * 100.0 / count(*) as map_rate
      FROM erc1155_transfers t
      LEFT JOIN ctf_token_map ctm ON t.token_id = ctm.token_id
      WHERE lower(t.to_address) = lower('${testWallet}')
         OR lower(t.from_address) = lower('${testWallet}')
    `,
    format: 'JSONEachRow'
  });
  const joinTestData = (await joinTestQuery.json())[0];

  console.log(`Total transfers: ${joinTestData.total_transfers}`);
  console.log(`Mapped transfers: ${joinTestData.mapped_transfers}`);
  console.log(`Map rate: ${Number(joinTestData.map_rate).toFixed(1)}%`);

  // Step 4: Check intermediate position_changes CTE
  console.log("\nStep 4: Testing position_changes CTE...");
  console.log("─".repeat(80));

  const changesQuery = await clickhouse.query({
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
        count(*) as total_changes,
        countIf(wallet_to IS NOT NULL AND lower(wallet_to) = lower('${testWallet}')) as incoming,
        countIf(wallet_from IS NOT NULL AND lower(wallet_from) = lower('${testWallet}')) as outgoing
      FROM position_changes
    `,
    format: 'JSONEachRow'
  });
  const changesData = (await changesQuery.json())[0];

  console.log(`Total position changes: ${changesData.total_changes}`);
  console.log(`Incoming to test wallet: ${changesData.incoming}`);
  console.log(`Outgoing from test wallet: ${changesData.outgoing}`);

  // Step 5: Check position_deltas CTE
  console.log("\nStep 5: Testing position_deltas CTE...");
  console.log("─".repeat(80));

  const deltasQuery = await clickhouse.query({
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
      ),
      position_deltas AS (
        SELECT
          wallet_to AS wallet,
          condition_id_norm,
          outcome_idx,
          shares AS delta
        FROM position_changes
        WHERE wallet_to IS NOT NULL

        UNION ALL

        SELECT
          wallet_from AS wallet,
          condition_id_norm,
          outcome_idx,
          -shares AS delta
        FROM position_changes
        WHERE wallet_from IS NOT NULL
      )
      SELECT count(*) as total_deltas,
             countIf(lower(wallet) = lower('${testWallet}')) as test_wallet_deltas
      FROM position_deltas
    `,
    format: 'JSONEachRow'
  });
  const deltasData = (await deltasQuery.json())[0];

  console.log(`Total deltas: ${deltasData.total_deltas}`);
  console.log(`Test wallet deltas: ${deltasData.test_wallet_deltas}`);

  // Step 6: Check final aggregation before HAVING
  console.log("\nStep 6: Testing final aggregation BEFORE HAVING...");
  console.log("─".repeat(80));

  const preHavingQuery = await clickhouse.query({
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
      ),
      position_deltas AS (
        SELECT
          wallet_to AS wallet,
          condition_id_norm,
          outcome_idx,
          shares AS delta
        FROM position_changes
        WHERE wallet_to IS NOT NULL

        UNION ALL

        SELECT
          wallet_from AS wallet,
          condition_id_norm,
          outcome_idx,
          -shares AS delta
        FROM position_changes
        WHERE wallet_from IS NOT NULL
      )
      SELECT
        count(*) as total_positions,
        sum(delta) / 1000000.0 as net_shares_sample
      FROM position_deltas
      WHERE lower(wallet) = lower('${testWallet}')
      GROUP BY wallet, condition_id_norm, outcome_idx
      LIMIT 1
    `,
    format: 'JSONEachRow'
  });
  const preHavingData = await preHavingQuery.json();

  if (preHavingData.length > 0) {
    console.log("Sample aggregated position (before HAVING):");
    console.table(preHavingData);
  } else {
    console.log("❌ No positions found even before HAVING clause");
  }

  console.log();
  console.log("═".repeat(80));
}

main().catch(console.error);
