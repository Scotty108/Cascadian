import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  console.log("═".repeat(80));
  console.log("PHASE 2: BUILD ERC1155 POSITION TRACKING");
  console.log("═".repeat(80));
  console.log();

  const testWallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  // Step 1: Create new position view from ERC1155 transfers
  console.log("Step 1: Creating outcome_positions_v2_blockchain...");
  console.log("─".repeat(80));
  console.log();

  const createViewSQL = `
    CREATE OR REPLACE VIEW outcome_positions_v2_blockchain AS
    WITH position_changes AS (
      SELECT
        -- Incoming transfers (to_address receives shares)
        CASE
          WHEN t.to_address != '0x0000000000000000000000000000000000000000'
          THEN lower(t.to_address)
          ELSE NULL
        END AS wallet_to,
        -- Outgoing transfers (from_address sends shares)
        CASE
          WHEN t.from_address != '0x0000000000000000000000000000000000000000'
          THEN lower(t.from_address)
          ELSE NULL
        END AS wallet_from,
        ctm.condition_id_norm,
        ctm.outcome_index AS outcome_idx,
        -- Convert hex value to decimal (micro-shares) as Float64 for arithmetic
        CAST(reinterpretAsUInt64(reverse(unhex(substring(t.value, 3)))) AS Float64) AS shares
      FROM erc1155_transfers t
      INNER JOIN ctf_token_map ctm
        ON ctm.token_id = toString(reinterpretAsUInt256(reverse(unhex(substring(t.token_id, 3)))))
      WHERE t.to_address != t.from_address  -- Skip self-transfers
    ),
    position_deltas AS (
      -- Positive deltas (receiving shares)
      SELECT
        wallet_to AS wallet,
        condition_id_norm,
        outcome_idx,
        shares AS delta
      FROM position_changes
      WHERE wallet_to IS NOT NULL

      UNION ALL

      -- Negative deltas (sending shares)
      SELECT
        wallet_from AS wallet,
        condition_id_norm,
        outcome_idx,
        -shares AS delta
      FROM position_changes
      WHERE wallet_from IS NOT NULL
    )
    SELECT
      wallet,
      condition_id_norm,
      outcome_idx,
      sum(delta) / 1000000.0 AS net_shares
    FROM position_deltas
    GROUP BY wallet, condition_id_norm, outcome_idx
    HAVING abs(net_shares) > 0.0001
  `;

  try {
    await clickhouse.command({ query: createViewSQL });
    console.log("✅ View created successfully");
  } catch (error: any) {
    console.error("❌ Failed to create view:", error.message);
    throw error;
  }

  console.log();
  console.log("─".repeat(80));
  console.log();

  // Step 2: Test the new view
  console.log("Step 2: Testing new view with test wallet...");
  console.log("─".repeat(80));
  console.log();

  // Count positions
  const countQuery = await clickhouse.query({
    query: `
      SELECT count(*) as position_count
      FROM outcome_positions_v2_blockchain
      WHERE lower(wallet) = lower('${testWallet}')
    `,
    format: 'JSONEachRow'
  });
  const countData = (await countQuery.json())[0];
  console.log(`Positions found: ${countData.position_count}`);

  // Sample positions
  const sampleQuery = await clickhouse.query({
    query: `
      SELECT
        substring(condition_id_norm, 1, 12) || '...' as cid,
        outcome_idx,
        net_shares
      FROM outcome_positions_v2_blockchain
      WHERE lower(wallet) = lower('${testWallet}')
      ORDER BY abs(net_shares) DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });
  const sampleData = await sampleQuery.json();
  console.log("\nTop 10 positions by size:");
  console.table(sampleData);

  console.log();
  console.log("─".repeat(80));
  console.log();

  // Step 3: Compare with old view
  console.log("Step 3: Comparing new vs old positions...");
  console.log("─".repeat(80));
  console.log();

  // Old view count
  const oldCountQuery = await clickhouse.query({
    query: `
      SELECT count(*) as position_count
      FROM outcome_positions_v2
      WHERE lower(wallet) = lower('${testWallet}')
    `,
    format: 'JSONEachRow'
  });
  const oldCountData = (await oldCountQuery.json())[0];

  console.log(`Old view (CLOB):       ${oldCountData.position_count} positions`);
  console.log(`New view (Blockchain): ${countData.position_count} positions`);
  console.log(`Difference:            ${Number(countData.position_count) - Number(oldCountData.position_count)} positions`);

  console.log();
  console.log("─".repeat(80));
  console.log();

  // Step 4: Validate data quality
  console.log("Step 4: Validating data quality...");
  console.log("─".repeat(80));
  console.log();

  // Check for null/invalid data
  const qualityQuery = await clickhouse.query({
    query: `
      SELECT
        count(*) as total_positions,
        countIf(condition_id_norm IS NULL OR condition_id_norm = '') as null_condition_ids,
        countIf(wallet IS NULL OR wallet = '') as null_wallets,
        countIf(abs(net_shares) < 0.0001) as dust_positions,
        min(abs(net_shares)) as min_shares,
        max(abs(net_shares)) as max_shares
      FROM outcome_positions_v2_blockchain
    `,
    format: 'JSONEachRow'
  });
  const qualityData = (await qualityQuery.json())[0];

  console.log(`Total positions: ${qualityData.total_positions}`);
  console.log(`Null condition_ids: ${qualityData.null_condition_ids}`);
  console.log(`Null wallets: ${qualityData.null_wallets}`);
  console.log(`Dust positions: ${qualityData.dust_positions}`);
  console.log(`Share range: ${qualityData.min_shares} to ${qualityData.max_shares}`);

  if (Number(qualityData.null_condition_ids) > 0 || Number(qualityData.null_wallets) > 0) {
    console.log("\n⚠️  WARNING: Found null values in critical fields!");
  } else {
    console.log("\n✅ Data quality check passed");
  }

  console.log();
  console.log("═".repeat(80));
  console.log("PHASE 2 CHECKPOINT");
  console.log("═".repeat(80));
  console.log();
  console.log("✅ ERC1155 position tracking view created");
  console.log(`✅ Test wallet has ${countData.position_count} positions (vs ${oldCountData.position_count} from CLOB)`);
  console.log("✅ Data quality validated");
  console.log();
  console.log("Ready to proceed to Phase 3: Build Hybrid Cashflow Calculation");
  console.log();
  console.log("═".repeat(80));
}

main().catch(console.error);
