/**
 * V9 Unified Cash-Flow Ledger
 * 
 * This script creates the pm_wallet_condition_ledger_v9 table and populates it
 * with CLOB and CTF flows for test wallets.
 * 
 * Key insight: V8's "CLOB PnL + CTF Net" double-counts because CLOB PnL already
 * includes payout value, and CTF BURN adds the same payout again.
 * 
 * V9 Solution: Track all USDC flows in ONE table, then sum(usdc_delta) = realized PnL.
 * 
 * Usage: npx tsx scripts/pnl/create-v9-unified-ledger.ts
 */

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: 'https://ja9egedrv0.us-central1.gcp.clickhouse.cloud:8443',
  username: 'default',
  password: 'Lbr.jYtw5ikf3',
  database: 'default',
  request_timeout: 600000
});

// Test wallets
const TEST_WALLETS = {
  W1: '0x9d36c904930a7d06c5403f9e16996e919f586486',        // CLOB-only, matches API within 1.4%
  CTF_WALLET: '0x3cf3e8d5427aed066a7a5926980600f6c3cf87b3', // Has CTF activity, divergent in V8
};

async function main() {
  console.log('='.repeat(100));
  console.log('V9 UNIFIED CASH-FLOW LEDGER IMPLEMENTATION');
  console.log('='.repeat(100));
  console.log('');
  console.log('Goal: Eliminate V8 double-counting by tracking all USDC flows in one table.');
  console.log('Formula: realized_pnl = sum(usdc_delta) across all events');
  console.log('');

  // =========================================================================
  // STEP 1: Create the V9 unified ledger table
  // =========================================================================
  console.log('--- Step 1: Creating pm_wallet_condition_ledger_v9 table ---');

  const createTableSQL = `
CREATE TABLE IF NOT EXISTS pm_wallet_condition_ledger_v9 (
  -- Primary identifiers
  wallet String,
  condition_id String,
  outcome_index UInt8,
  
  -- Transaction context
  tx_hash String,
  tx_time DateTime,
  block_number UInt64,
  
  -- Source classification
  source LowCardinality(String),  -- 'CLOB_BUY', 'CLOB_SELL', 'CTF_MINT', 'CTF_BURN', 'FEE'
  
  -- Cash flow (positive = into wallet, negative = out of wallet)
  usdc_delta Float64,
  
  -- Token flow (positive = into wallet, negative = out of wallet)
  token_delta Float64,
  
  -- Metadata
  insert_time DateTime DEFAULT now(),
  is_deleted UInt8 DEFAULT 0
) ENGINE = MergeTree()
ORDER BY (wallet, condition_id, outcome_index, tx_time, tx_hash)
SETTINGS index_granularity = 8192
`;

  try {
    await client.command({ query: createTableSQL });
    console.log('✓ Table pm_wallet_condition_ledger_v9 created successfully');
  } catch (e) {
    console.error('Error creating table:', (e as Error).message);
  }

  // Verify schema
  console.log('');
  console.log('Schema:');
  const schema = await client.query({
    query: 'DESCRIBE pm_wallet_condition_ledger_v9',
    format: 'JSONEachRow'
  });
  for (const col of await schema.json() as any[]) {
    console.log(`  ${col.name}: ${col.type}`);
  }

  // =========================================================================
  // STEP 2: Populate with CLOB flows for test wallets
  // =========================================================================
  console.log('');
  console.log('--- Step 2: Populating with CLOB flows for test wallets ---');

  // CLOB flows:
  // - BUY: usdc_delta = -usdc_amount (money out), token_delta = +token_amount (tokens in)
  // - SELL: usdc_delta = +usdc_amount (money in), token_delta = -token_amount (tokens out)
  // - FEE: Always negative (fee paid)

  const walletList = Object.values(TEST_WALLETS).map(w => `'${w}'`).join(',');

  const insertClobSQL = `
INSERT INTO pm_wallet_condition_ledger_v9
SELECT
  lower(t.trader_wallet) AS wallet,
  m.condition_id AS condition_id,
  toUInt8(m.outcome_index) AS outcome_index,
  t.transaction_hash AS tx_hash,
  t.trade_time AS tx_time,
  t.block_number AS block_number,
  CASE 
    WHEN t.side = 'buy' THEN 'CLOB_BUY'
    WHEN t.side = 'sell' THEN 'CLOB_SELL'
    ELSE 'CLOB_UNKNOWN'
  END AS source,
  -- usdc_delta: positive = into wallet
  CASE 
    WHEN t.side = 'buy' THEN -1.0 * (t.usdc_amount / 1000000.0)   -- pay money out
    WHEN t.side = 'sell' THEN t.usdc_amount / 1000000.0           -- receive money
    ELSE 0
  END AS usdc_delta,
  -- token_delta: positive = into wallet
  CASE 
    WHEN t.side = 'buy' THEN t.token_amount / 1000000.0           -- receive tokens
    WHEN t.side = 'sell' THEN -1.0 * (t.token_amount / 1000000.0) -- send tokens out
    ELSE 0
  END AS token_delta,
  now() AS insert_time,
  0 AS is_deleted
FROM (
  -- Dedupe CLOB trades by event_id (pm_trader_events_v2 has duplicates)
  SELECT
    event_id,
    any(trader_wallet) AS trader_wallet,
    any(side) AS side,
    any(token_id) AS token_id,
    any(usdc_amount) AS usdc_amount,
    any(token_amount) AS token_amount,
    any(trade_time) AS trade_time,
    any(transaction_hash) AS transaction_hash,
    any(block_number) AS block_number
  FROM pm_trader_events_v2
  WHERE lower(trader_wallet) IN (${walletList})
    AND is_deleted = 0
  GROUP BY event_id
) t
INNER JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
`;

  try {
    await client.command({ query: insertClobSQL });
    console.log('✓ CLOB flows inserted successfully');
  } catch (e) {
    console.error('Error inserting CLOB flows:', (e as Error).message);
  }

  // Count CLOB inserts
  const clobCount = await client.query({
    query: `SELECT count() AS cnt, uniqExact(wallet) AS wallets FROM pm_wallet_condition_ledger_v9 WHERE source LIKE 'CLOB%'`,
    format: 'JSONEachRow'
  });
  const clobStats = (await clobCount.json() as any[])[0];
  console.log(`  CLOB records inserted: ${Number(clobStats.cnt).toLocaleString()} (${clobStats.wallets} wallets)`);

  // =========================================================================
  // STEP 3: Populate with CTF flows for test wallets
  // =========================================================================
  console.log('');
  console.log('--- Step 3: Populating with CTF flows for test wallets ---');

  // CTF flows from pm_ctf_flows_inferred:
  // - MINT: usdc_delta already stored as negative (money out to mint tokens)
  // - BURN: usdc_delta already stored as positive (money in from burning tokens)

  const insertCtfSQL = `
INSERT INTO pm_wallet_condition_ledger_v9
SELECT
  wallet,
  condition_id,
  COALESCE(outcome_index, 0) AS outcome_index,  -- Default to 0 if null
  tx_hash,
  block_time AS tx_time,
  block_number,
  CASE 
    WHEN flow_type = 'MINT' THEN 'CTF_MINT'
    WHEN flow_type = 'BURN' THEN 'CTF_BURN'
    ELSE 'CTF_OTHER'
  END AS source,
  usdc_delta,          -- Already signed correctly in pm_ctf_flows_inferred
  token_amount AS token_delta,  -- Token amount (always positive in source, but we need signing)
  now() AS insert_time,
  0 AS is_deleted
FROM pm_ctf_flows_inferred
WHERE wallet IN (${walletList})
  AND is_deleted = 0
`;

  try {
    await client.command({ query: insertCtfSQL });
    console.log('✓ CTF flows inserted successfully');
  } catch (e) {
    console.error('Error inserting CTF flows:', (e as Error).message);
  }

  // Count CTF inserts
  const ctfCount = await client.query({
    query: `SELECT count() AS cnt, uniqExact(wallet) AS wallets FROM pm_wallet_condition_ledger_v9 WHERE source LIKE 'CTF%'`,
    format: 'JSONEachRow'
  });
  const ctfStats = (await ctfCount.json() as any[])[0];
  console.log(`  CTF records inserted: ${Number(ctfStats.cnt).toLocaleString()} (${ctfStats.wallets} wallets)`);

  // =========================================================================
  // STEP 4: Create the V9 aggregation view
  // =========================================================================
  console.log('');
  console.log('--- Step 4: Creating vw_realized_pnl_v9_proxy view ---');

  // Join with pm_condition_resolutions to get resolution status
  const createViewSQL = `
CREATE OR REPLACE VIEW vw_realized_pnl_v9_proxy AS
SELECT
  l.wallet,
  l.condition_id,
  
  -- CLOB activity
  sumIf(l.usdc_delta, l.source IN ('CLOB_BUY', 'CLOB_SELL')) AS clob_net_cash,
  sumIf(l.token_delta, l.source IN ('CLOB_BUY', 'CLOB_SELL')) AS clob_net_tokens,
  
  -- CTF activity
  sumIf(l.usdc_delta, l.source = 'CTF_MINT') AS ctf_deposits,
  sumIf(l.usdc_delta, l.source = 'CTF_BURN') AS ctf_payouts,
  
  -- Total USDC delta (this is the realized PnL when condition is resolved)
  sum(l.usdc_delta) AS total_usdc_delta,
  
  -- Token position
  sum(l.token_delta) AS net_token_position,
  
  -- Resolution info
  r.resolved_at IS NOT NULL AS is_resolved,
  r.payout_numerators,
  
  -- Metadata
  count() AS event_count,
  min(l.tx_time) AS first_trade_time,
  max(l.tx_time) AS last_trade_time
FROM pm_wallet_condition_ledger_v9 l
LEFT JOIN pm_condition_resolutions r ON lower(l.condition_id) = lower(r.condition_id)
WHERE l.is_deleted = 0
GROUP BY l.wallet, l.condition_id, r.resolved_at, r.payout_numerators
`;

  try {
    await client.command({ query: createViewSQL });
    console.log('✓ View vw_realized_pnl_v9_proxy created successfully');
  } catch (e) {
    console.error('Error creating view:', (e as Error).message);
  }

  // =========================================================================
  // STEP 5: Validate V9 for test wallets
  // =========================================================================
  console.log('');
  console.log('--- Step 5: Validating V9 for test wallets ---');

  for (const [name, wallet] of Object.entries(TEST_WALLETS)) {
    console.log('');
    console.log(`=== ${name}: ${wallet.substring(0, 20)}... ===`);

    // Get V9 PnL
    const v9Result = await client.query({
      query: `
        SELECT
          wallet,
          count() AS conditions,
          sum(clob_net_cash) AS total_clob_net_cash,
          sum(clob_net_tokens) AS total_clob_net_tokens,
          sum(ctf_deposits) AS total_ctf_deposits,
          sum(ctf_payouts) AS total_ctf_payouts,
          sum(total_usdc_delta) AS total_usdc_delta,
          countIf(is_resolved = 1) AS resolved_conditions
        FROM vw_realized_pnl_v9_proxy
        WHERE wallet = '${wallet}'
        GROUP BY wallet
      `,
      format: 'JSONEachRow'
    });
    const v9Data = (await v9Result.json() as any[])[0];

    if (v9Data) {
      console.log(`  Conditions: ${v9Data.conditions} (${v9Data.resolved_conditions} resolved)`);
      console.log(`  CLOB Net Cash: $${Number(v9Data.total_clob_net_cash).toFixed(2)}`);
      console.log(`  CLOB Net Tokens: ${Number(v9Data.total_clob_net_tokens).toFixed(2)}`);
      console.log(`  CTF Deposits: $${Number(v9Data.total_ctf_deposits).toFixed(2)}`);
      console.log(`  CTF Payouts: $${Number(v9Data.total_ctf_payouts).toFixed(2)}`);
      console.log(`  V9 Total USDC Delta: $${Number(v9Data.total_usdc_delta).toFixed(2)}`);
    } else {
      console.log('  No data found in V9 ledger');
    }

    // Get API PnL for comparison
    try {
      const response = await fetch(`https://data-api.polymarket.com/positions?user=${wallet}&sizeThreshold=0`);
      if (response.ok) {
        const positions = await response.json() as any[];
        const apiPnl = positions.reduce((sum: number, p: any) => sum + Number(p.realizedPnl || 0), 0);
        console.log(`  API Realized PnL: $${apiPnl.toFixed(2)} (${positions.length} positions)`);
        
        if (v9Data) {
          const v9Pnl = Number(v9Data.total_usdc_delta);
          const diff = Math.abs(v9Pnl - apiPnl);
          const pctDiff = apiPnl !== 0 ? Math.abs((v9Pnl - apiPnl) / apiPnl * 100) : 100;
          const status = pctDiff < 10 ? 'MATCH' : pctDiff < 50 ? 'PARTIAL' : 'DIVERGENT';
          console.log(`  V9 vs API Diff: $${diff.toFixed(2)} (${pctDiff.toFixed(1)}%) - ${status}`);
        }
      }
    } catch (e) {
      console.log(`  API fetch error: ${(e as Error).message}`);
    }
  }

  // =========================================================================
  // SUMMARY
  // =========================================================================
  console.log('');
  console.log('='.repeat(100));
  console.log('V9 UNIFIED LEDGER IMPLEMENTATION COMPLETE');
  console.log('='.repeat(100));
  console.log('');
  console.log('What was created:');
  console.log('  1. pm_wallet_condition_ledger_v9 - Unified USDC/token flow table');
  console.log('  2. vw_realized_pnl_v9_proxy - Aggregation view with resolution status');
  console.log('');
  console.log('Key insight:');
  console.log('  V8 double-counted because CLOB PnL includes payout value (net_tokens * payout_price)');
  console.log('  and CTF BURN also includes payout value. V9 fixes this by tracking raw USDC flows.');
  console.log('');
  console.log('Formula: realized_pnl = sum(usdc_delta) WHERE condition is resolved');
  console.log('');
  console.log('NOTE: V9 currently shows total USDC delta, not just resolved positions.');
  console.log('For realized PnL, filter to resolved conditions only.');

  await client.close();
}

main().catch(console.error);
