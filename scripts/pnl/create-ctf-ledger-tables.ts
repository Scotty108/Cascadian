/**
 * Create CTF Ledger Tables for V7 PnL Engine
 *
 * This script creates the tables needed to track CTF (Condition Token Framework) flows
 * that are not captured by direct USDC transfers (pm_erc20_usdc_flows).
 *
 * Key insight from PNL_V7_PROXY_CTF_SPEC.md:
 * - pm_ctf_events shows proxy contracts as user_address, not the end user
 * - pm_erc1155_transfers shows the actual wallet receiving minted tokens
 * - We use ERC1155 minting detection to infer CTF deposits
 *
 * Tables created:
 * 1. pm_ctf_flows_inferred - Raw/inferred CTF flows from various sources
 * 2. vw_ctf_ledger - Condition-level aggregation for V7 integration
 *
 * Usage: npx tsx scripts/pnl/create-ctf-ledger-tables.ts
 */

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: 'https://ja9egedrv0.us-central1.gcp.clickhouse.cloud:8443',
  username: 'default',
  password: 'Lbr.jYtw5ikf3',
  database: 'default',
  request_timeout: 300000
});

async function main() {
  console.log('='.repeat(80));
  console.log('CREATING CTF LEDGER TABLES FOR V7 PNL ENGINE');
  console.log('='.repeat(80));
  console.log('');

  // =========================================================================
  // TABLE 1: pm_ctf_flows_inferred
  // =========================================================================
  console.log('--- Creating pm_ctf_flows_inferred table ---');

  const createFlowsTable = `
CREATE TABLE IF NOT EXISTS pm_ctf_flows_inferred (
  -- Primary identifiers
  wallet LowCardinality(String),
  condition_id String,
  outcome_index Nullable(UInt8),  -- Nullable for condition-level flows

  -- Transaction context
  tx_hash String,
  block_number UInt64,
  block_time DateTime,

  -- Flow classification
  flow_type LowCardinality(String),  -- 'SPLIT' (deposit), 'MERGE' (withdrawal), 'REDEEM' (payout), 'MINT', 'BURN'

  -- USDC amounts (positive = inflow to wallet, negative = outflow from wallet)
  usdc_delta Float64,

  -- Token amounts (for reference)
  token_amount Float64,

  -- Inference metadata
  source LowCardinality(String),  -- 'erc1155_mint', 'erc1155_burn', 'ctf_event', 'clob_imbalance'
  confidence LowCardinality(String),  -- 'high', 'medium', 'low'

  -- Dedup/versioning
  insert_time DateTime DEFAULT now(),
  is_deleted UInt8 DEFAULT 0
) ENGINE = ReplacingMergeTree(insert_time)
ORDER BY (wallet, condition_id, tx_hash, flow_type)
SETTINGS index_granularity = 8192
`;

  try {
    await client.command({ query: createFlowsTable });
    console.log('✓ Table pm_ctf_flows_inferred created successfully');
  } catch (e) {
    console.error('Error creating pm_ctf_flows_inferred:', (e as Error).message);
    throw e;
  }

  // Verify schema
  console.log('');
  console.log('Schema:');
  const schema = await client.query({
    query: 'DESCRIBE pm_ctf_flows_inferred',
    format: 'JSONEachRow'
  });
  for (const col of await schema.json() as any[]) {
    console.log(`  ${col.name}: ${col.type}`);
  }

  // =========================================================================
  // VIEW: vw_ctf_ledger (condition-level aggregation)
  // =========================================================================
  console.log('');
  console.log('--- Creating vw_ctf_ledger view ---');

  const createLedgerView = `
CREATE OR REPLACE VIEW vw_ctf_ledger AS
SELECT
  wallet,
  condition_id,

  -- CTF deposits (negative usdc_delta = money out of wallet)
  sumIf(abs(usdc_delta), usdc_delta < 0 AND flow_type IN ('SPLIT', 'MINT')) AS ctf_deposits,

  -- CTF payouts (positive usdc_delta = money into wallet)
  sumIf(usdc_delta, usdc_delta > 0 AND flow_type IN ('MERGE', 'REDEEM', 'BURN')) AS ctf_payouts,

  -- Net CTF cash (payouts - deposits)
  ctf_payouts - ctf_deposits AS net_ctf_cash,

  -- Token tracking
  sumIf(token_amount, flow_type IN ('SPLIT', 'MINT')) AS tokens_minted,
  sumIf(token_amount, flow_type IN ('MERGE', 'REDEEM', 'BURN')) AS tokens_burned,

  -- Metadata
  count() AS flow_count,
  min(block_time) AS first_flow_time,
  max(block_time) AS last_flow_time
FROM pm_ctf_flows_inferred
WHERE is_deleted = 0
GROUP BY wallet, condition_id
`;

  try {
    await client.command({ query: createLedgerView });
    console.log('✓ View vw_ctf_ledger created successfully');
  } catch (e) {
    console.error('Error creating vw_ctf_ledger:', (e as Error).message);
    throw e;
  }

  // Verify view schema
  console.log('');
  console.log('View schema:');
  const viewSchema = await client.query({
    query: 'DESCRIBE vw_ctf_ledger',
    format: 'JSONEachRow'
  });
  for (const col of await viewSchema.json() as any[]) {
    console.log(`  ${col.name}: ${col.type}`);
  }

  // =========================================================================
  // SUMMARY
  // =========================================================================
  console.log('');
  console.log('='.repeat(80));
  console.log('CTF LEDGER TABLES CREATED SUCCESSFULLY');
  console.log('='.repeat(80));
  console.log('');
  console.log('Tables/Views created:');
  console.log('  1. pm_ctf_flows_inferred - Raw CTF flow events');
  console.log('  2. vw_ctf_ledger - Condition-level aggregation');
  console.log('');
  console.log('Next steps:');
  console.log('  1. Run backfill-ctf-flows-inferred.ts to populate from ERC1155 minting');
  console.log('  2. Update V7 view to use vw_ctf_ledger instead of pm_erc20_usdc_flows');
  console.log('  3. Validate against API for wallets with CTF activity');

  await client.close();
}

main().catch(console.error);
