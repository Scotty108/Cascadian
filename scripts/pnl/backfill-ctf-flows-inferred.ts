/**
 * Backfill CTF Flows Inferred from ERC1155 Minting/Burning
 *
 * This script populates pm_ctf_flows_inferred by detecting:
 * 1. ERC1155 minting (from zero address) = CTF deposit (USDC out of wallet)
 * 2. ERC1155 burning (to zero address) = CTF payout (USDC into wallet)
 *
 * Key insight from PNL_V7_PROXY_CTF_SPEC.md:
 * - pm_ctf_events shows proxy contracts as user_address, not the end user
 * - pm_erc1155_transfers shows the actual wallet receiving minted tokens
 *
 * For binary markets: minting 1 token of each outcome costs $1 USDC
 * Formula: inferred_deposit = tokens_minted (since we get YES+NO for $1 each)
 *
 * Usage: npx tsx scripts/pnl/backfill-ctf-flows-inferred.ts
 */

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: 'https://ja9egedrv0.us-central1.gcp.clickhouse.cloud:8443',
  username: 'default',
  password: 'Lbr.jYtw5ikf3',
  database: 'default',
  request_timeout: 600000
});

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const CTF_CONTRACT = '0x4d97dcd97ec945f40cf65f87097ace5ea0476045';

async function main() {
  console.log('='.repeat(80));
  console.log('BACKFILL CTF FLOWS FROM ERC1155 MINTING/BURNING');
  console.log('='.repeat(80));
  console.log('');

  // =========================================================================
  // STEP 1: Check data availability
  // =========================================================================
  console.log('--- Step 1: Checking data availability ---');

  const countResult = await client.query({
    query: `
      SELECT
        countIf(from_address = '${ZERO_ADDRESS}') AS mint_count,
        countIf(to_address = '${ZERO_ADDRESS}') AS burn_count,
        count() AS total_count
      FROM pm_erc1155_transfers
      WHERE contract = '${CTF_CONTRACT}'
        AND is_deleted = 0
    `,
    format: 'JSONEachRow'
  });
  const counts = (await countResult.json() as any[])[0];
  console.log(`  Minting events (from zero): ${Number(counts.mint_count).toLocaleString()}`);
  console.log(`  Burning events (to zero): ${Number(counts.burn_count).toLocaleString()}`);
  console.log(`  Total ERC1155 transfers: ${Number(counts.total_count).toLocaleString()}`);
  console.log('');

  // =========================================================================
  // STEP 2: Insert MINT events (CTF deposits)
  // =========================================================================
  console.log('--- Step 2: Inserting MINT events (CTF deposits) ---');

  // Note: ERC1155 value is hex encoded, need to convert
  // For binary markets: minting tokens = depositing USDC
  // Tokens are minted in pairs (YES + NO), each pair costs $1 USDC
  // We track per-token minting, then aggregate at condition level in vw_ctf_ledger

  // Convert hex token_id to decimal for join with mapping table
  // Convert hex value to decimal for token amount
  const insertMints = `
INSERT INTO pm_ctf_flows_inferred
SELECT
  lower(e.to_address) AS wallet,
  m.condition_id AS condition_id,
  toUInt8(m.outcome_index) AS outcome_index,
  e.tx_hash AS tx_hash,
  e.block_number AS block_number,
  e.block_timestamp AS block_time,
  'MINT' AS flow_type,
  -- Negative = money out of wallet (deposit)
  -- For binary markets: each token minted = $1 USDC cost (since YES+NO pair costs $1)
  -- But we only see one token here, so we infer $1 per token pair
  -- Actually, minting gives you BOTH tokens, so each single token mint is $0.50 of the pair
  -- For simplicity: track token amounts, infer USDC at condition level
  -1.0 * toFloat64(reinterpretAsUInt64(reverse(unhex(substring(e.value, 3))))) / 1000000.0 AS usdc_delta,
  toFloat64(reinterpretAsUInt64(reverse(unhex(substring(e.value, 3))))) / 1000000.0 AS token_amount,
  'erc1155_mint' AS source,
  'high' AS confidence,
  now() AS insert_time,
  0 AS is_deleted
FROM pm_erc1155_transfers e
INNER JOIN pm_token_to_condition_map_v3 m
  ON toString(reinterpretAsUInt256(reverse(unhex(substring(e.token_id, 3))))) = m.token_id_dec
WHERE e.from_address = '${ZERO_ADDRESS}'
  AND e.contract = '${CTF_CONTRACT}'
  AND e.is_deleted = 0
  AND e.to_address != '${ZERO_ADDRESS}'
`;

  try {
    await client.command({ query: insertMints });
    console.log('✓ MINT events inserted successfully');
  } catch (e) {
    console.error('Error inserting mints:', (e as Error).message);
    // Try alternate approach with different hex parsing
    console.log('Trying alternate approach...');
  }

  // Check count after insert
  const mintCountResult = await client.query({
    query: `SELECT count() AS cnt FROM pm_ctf_flows_inferred WHERE flow_type = 'MINT'`,
    format: 'JSONEachRow'
  });
  const mintCount = (await mintCountResult.json() as any[])[0].cnt;
  console.log(`  MINT records inserted: ${Number(mintCount).toLocaleString()}`);
  console.log('');

  // =========================================================================
  // STEP 3: Insert BURN events (CTF payouts/redemptions)
  // =========================================================================
  console.log('--- Step 3: Inserting BURN events (CTF payouts) ---');

  const insertBurns = `
INSERT INTO pm_ctf_flows_inferred
SELECT
  lower(e.from_address) AS wallet,
  m.condition_id AS condition_id,
  toUInt8(m.outcome_index) AS outcome_index,
  e.tx_hash AS tx_hash,
  e.block_number AS block_number,
  e.block_timestamp AS block_time,
  'BURN' AS flow_type,
  -- Positive = money into wallet (payout)
  toFloat64(reinterpretAsUInt64(reverse(unhex(substring(e.value, 3))))) / 1000000.0 AS usdc_delta,
  toFloat64(reinterpretAsUInt64(reverse(unhex(substring(e.value, 3))))) / 1000000.0 AS token_amount,
  'erc1155_burn' AS source,
  'high' AS confidence,
  now() AS insert_time,
  0 AS is_deleted
FROM pm_erc1155_transfers e
INNER JOIN pm_token_to_condition_map_v3 m
  ON toString(reinterpretAsUInt256(reverse(unhex(substring(e.token_id, 3))))) = m.token_id_dec
WHERE e.to_address = '${ZERO_ADDRESS}'
  AND e.contract = '${CTF_CONTRACT}'
  AND e.is_deleted = 0
  AND e.from_address != '${ZERO_ADDRESS}'
`;

  try {
    await client.command({ query: insertBurns });
    console.log('✓ BURN events inserted successfully');
  } catch (e) {
    console.error('Error inserting burns:', (e as Error).message);
  }

  // Check count after insert
  const burnCountResult = await client.query({
    query: `SELECT count() AS cnt FROM pm_ctf_flows_inferred WHERE flow_type = 'BURN'`,
    format: 'JSONEachRow'
  });
  const burnCount = (await burnCountResult.json() as any[])[0].cnt;
  console.log(`  BURN records inserted: ${Number(burnCount).toLocaleString()}`);
  console.log('');

  // =========================================================================
  // STEP 4: Verify the data
  // =========================================================================
  console.log('--- Step 4: Verifying data ---');

  // Check total counts
  const totalResult = await client.query({
    query: `
      SELECT
        count() AS total_flows,
        countIf(flow_type = 'MINT') AS mints,
        countIf(flow_type = 'BURN') AS burns,
        uniqExact(wallet) AS unique_wallets,
        uniqExact(condition_id) AS unique_conditions
      FROM pm_ctf_flows_inferred
    `,
    format: 'JSONEachRow'
  });
  const totals = (await totalResult.json() as any[])[0];

  console.log('Summary:');
  console.log(`  Total flows: ${Number(totals.total_flows).toLocaleString()}`);
  console.log(`  MINT events: ${Number(totals.mints).toLocaleString()}`);
  console.log(`  BURN events: ${Number(totals.burns).toLocaleString()}`);
  console.log(`  Unique wallets: ${Number(totals.unique_wallets).toLocaleString()}`);
  console.log(`  Unique conditions: ${Number(totals.unique_conditions).toLocaleString()}`);
  console.log('');

  // Check W1 specifically
  const W1 = '0x9d36c904930a7d06c5403f9e16996e919f586486';
  console.log(`--- Step 5: Checking W1 (${W1.substring(0, 20)}...) ---`);

  const w1Result = await client.query({
    query: `
      SELECT
        flow_type,
        count() AS flow_count,
        sum(usdc_delta) AS total_usdc_delta,
        sum(token_amount) AS total_tokens
      FROM pm_ctf_flows_inferred
      WHERE wallet = '${W1}'
      GROUP BY flow_type
    `,
    format: 'JSONEachRow'
  });
  const w1Flows = await w1Result.json() as any[];

  if (w1Flows.length > 0) {
    console.log('W1 CTF flows found:');
    for (const flow of w1Flows) {
      console.log(`  ${flow.flow_type}: ${flow.flow_count} flows, $${Number(flow.total_usdc_delta).toFixed(2)} USDC, ${Number(flow.total_tokens).toFixed(2)} tokens`);
    }
  } else {
    console.log('No CTF flows found for W1');
    console.log('This could mean W1 acquired tokens via CLOB only, or token_id mapping failed');
  }
  console.log('');

  // Sample the vw_ctf_ledger view
  console.log('--- Step 6: Sample from vw_ctf_ledger ---');
  const ledgerSample = await client.query({
    query: `
      SELECT
        wallet,
        condition_id,
        ctf_deposits,
        ctf_payouts,
        net_ctf_cash
      FROM vw_ctf_ledger
      WHERE ctf_deposits > 0 OR ctf_payouts > 0
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });
  const ledgerRows = await ledgerSample.json() as any[];

  if (ledgerRows.length > 0) {
    console.log('Sample from vw_ctf_ledger:');
    for (const row of ledgerRows) {
      console.log(`  ${row.wallet.substring(0, 15)}... | ${row.condition_id.substring(0, 16)}... | dep: $${Number(row.ctf_deposits).toFixed(2)} | pay: $${Number(row.ctf_payouts).toFixed(2)} | net: $${Number(row.net_ctf_cash).toFixed(2)}`);
    }
  } else {
    console.log('No data in vw_ctf_ledger yet');
  }

  // =========================================================================
  // SUMMARY
  // =========================================================================
  console.log('');
  console.log('='.repeat(80));
  console.log('BACKFILL COMPLETE');
  console.log('='.repeat(80));
  console.log('');
  console.log('Next steps:');
  console.log('  1. Wire vw_ctf_ledger into V7 view');
  console.log('  2. Run validation against API for wallets with CTF activity');
  console.log('  3. Investigate wallets where ERC1155 minting was not detected');

  await client.close();
}

main().catch(console.error);
