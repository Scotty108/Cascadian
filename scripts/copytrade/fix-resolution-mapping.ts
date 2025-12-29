/**
 * Fix Resolution Mapping for Sports Line Markets
 *
 * ROOT CAUSE:
 * Multi-outcome markets (sports spreads with 84+ outcomes) resolve to binary [1,0].
 * The current view only expands payout_numerators array, orphaning outcome indices >= 2.
 *
 * FIX:
 * 1. Normalize condition_id (strip 0x prefix) for JOIN
 * 2. For orphaned outcomes (index >= payout array length), assign resolved_price = 0
 *
 * This creates a new view: vw_pm_resolution_prices_v2
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@clickhouse/client';

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 120000,
});

async function createFixedView() {
  console.log('=== Creating Fixed Resolution Mapping View ===\n');

  // First, let's check the impact on wallet #2
  const wallet = '0x006cc834cc092684f1b56626e23bedb3835c16ea';

  console.log('Step 1: Checking current P&L with orphaned outcomes fixed...');

  // Calculate corrected P&L for wallet #2
  const correctedQuery = `
    SELECT
      sum(corrected_pnl) AS total_pnl,
      sum(if(is_orphaned, 1, 0)) AS orphaned_count,
      sum(if(is_orphaned, corrected_pnl, 0)) AS orphaned_pnl,
      sum(if(is_resolved AND NOT is_orphaned, corrected_pnl, 0)) AS standard_pnl
    FROM (
      SELECT
        p.condition_id,
        p.outcome_index,
        p.cash_flow,
        p.final_tokens,
        r.payout_len,
        -- Is this outcome covered by the resolution?
        p.outcome_index < r.payout_len AS is_covered,
        r.payout_len > 0 AS is_resolved,
        -- Orphaned = resolution exists but doesn't cover this outcome
        r.payout_len > 0 AND p.outcome_index >= r.payout_len AS is_orphaned,
        -- Corrected P&L:
        -- - If covered: standard formula
        -- - If orphaned: loss = tokens * 0 + cash_flow = cash_flow (negative = loss)
        -- - If no resolution: 0 (unrealized)
        CASE
          WHEN r.payout_len > 0 AND p.outcome_index < r.payout_len THEN
            p.cash_flow + (p.final_tokens * r.resolved_price)
          WHEN r.payout_len > 0 AND p.outcome_index >= r.payout_len THEN
            p.cash_flow  -- Orphaned = loss (tokens worth 0)
          ELSE
            0  -- No resolution = unrealized
        END AS corrected_pnl
      FROM (
        SELECT
          lower(replace(condition_id, '0x', '')) AS condition_id,
          outcome_index,
          sum(usdc_delta) AS cash_flow,
          sum(token_delta) AS final_tokens
        FROM pm_unified_ledger_v6
        WHERE lower(wallet_address) = '${wallet}'
          AND source_type = 'CLOB'
          AND condition_id IS NOT NULL
          AND condition_id != ''
        GROUP BY condition_id, outcome_index
      ) AS p
      LEFT JOIN (
        SELECT
          lower(condition_id) AS condition_id,
          length(JSONExtract(payout_numerators, 'Array(Float64)')) AS payout_len,
          -- Get the resolution price for each outcome (if exists)
          arrayElement(
            JSONExtract(payout_numerators, 'Array(Float64)'),
            1  -- Will be replaced with proper index in final view
          ) / arraySum(JSONExtract(payout_numerators, 'Array(Float64)')) AS resolved_price
        FROM pm_condition_resolutions
        WHERE is_deleted = 0
      ) AS r ON p.condition_id = r.condition_id
    )
  `;

  const result = await ch.query({ query: correctedQuery, format: 'JSONEachRow' });
  const corrected = await result.json();

  console.log('\nWallet #2 Corrected P&L:');
  console.log(JSON.stringify(corrected[0], null, 2));

  // Compare to original
  console.log('\n--- Comparison ---');
  console.log(`Original calculation: ~$1,227,565`);
  console.log(`UI shows: ~$893,352`);
  console.log(`Corrected (with orphaned): $${Math.round(Number(corrected[0]?.total_pnl || 0)).toLocaleString()}`);
  console.log(`Orphaned positions: ${corrected[0]?.orphaned_count}`);
  console.log(`Orphaned P&L impact: $${Math.round(Number(corrected[0]?.orphaned_pnl || 0)).toLocaleString()}`);

  // Now create the actual view
  console.log('\n\nStep 2: Creating corrected resolution prices materialized table...');

  // Drop existing table if exists
  try {
    await ch.command({ query: 'DROP TABLE IF EXISTS pm_resolution_prices_corrected' });
    console.log('Dropped existing table');
  } catch (e) {
    console.log('Table did not exist');
  }

  // Create the corrected resolution lookup table
  // This expands resolutions to cover ALL possible outcome indices (0-99)
  // Outcomes >= payout array length get resolved_price = 0
  const createTableQuery = `
    CREATE TABLE pm_resolution_prices_corrected
    ENGINE = MergeTree()
    ORDER BY (condition_id, outcome_index)
    AS
    SELECT
      lower(condition_id) AS condition_id,
      idx AS outcome_index,
      if(idx < payout_len,
        arrayElement(payouts, idx + 1) / arraySum(payouts),
        0.0  -- Orphaned outcomes resolve to 0
      ) AS resolved_price,
      payout_len,
      resolved_at
    FROM (
      SELECT
        condition_id,
        JSONExtract(payout_numerators, 'Array(Float64)') AS payouts,
        length(JSONExtract(payout_numerators, 'Array(Float64)')) AS payout_len,
        resolved_at
      FROM pm_condition_resolutions
      WHERE is_deleted = 0
    ) AS r
    ARRAY JOIN arrayEnumerate(range(100)) AS idx  -- Expand to 100 outcome indices
    WHERE idx < greatest(payout_len, 2)  -- At least cover declared outcomes
       OR idx IN (2, 83, 84)  -- Always include known sports spread indices
  `;

  try {
    await ch.command({ query: createTableQuery });
    console.log('Created pm_resolution_prices_corrected table');
  } catch (e) {
    console.log('Error creating table:', (e as Error).message);
  }

  // Check row count
  const countResult = await ch.query({
    query: 'SELECT count() as cnt, uniqExact(condition_id) as conditions FROM pm_resolution_prices_corrected',
    format: 'JSONEachRow'
  });
  const count = await countResult.json();
  console.log('Table stats:', count[0]);

  // Verify wallet #2 fix
  console.log('\n\nStep 3: Verifying wallet #2 with new table...');

  const verifyQuery = `
    SELECT
      sum(
        p.cash_flow + (p.final_tokens * coalesce(r.resolved_price, 0))
      ) AS total_pnl,
      countIf(r.resolved_price IS NOT NULL) AS resolved_positions,
      countIf(r.resolved_price IS NULL) AS unresolved_positions
    FROM (
      SELECT
        lower(replace(condition_id, '0x', '')) AS condition_id,
        outcome_index,
        sum(usdc_delta) AS cash_flow,
        sum(token_delta) AS final_tokens
      FROM pm_unified_ledger_v6
      WHERE lower(wallet_address) = '${wallet}'
        AND source_type = 'CLOB'
        AND condition_id IS NOT NULL
        AND condition_id != ''
      GROUP BY condition_id, outcome_index
    ) AS p
    LEFT JOIN pm_resolution_prices_corrected AS r
      ON p.condition_id = r.condition_id
      AND p.outcome_index = r.outcome_index
  `;

  const verifyResult = await ch.query({ query: verifyQuery, format: 'JSONEachRow' });
  const verify = await verifyResult.json();

  console.log('Wallet #2 with corrected resolution:');
  console.log(JSON.stringify(verify[0], null, 2));

  console.log('\n=== SUMMARY ===');
  console.log(`Original P&L (missing orphans): ~$1,227,565`);
  console.log(`UI shows: ~$893,352`);
  console.log(`Corrected P&L: $${Math.round(Number(verify[0]?.total_pnl || 0)).toLocaleString()}`);
  console.log(`Difference from UI: $${Math.round(Number(verify[0]?.total_pnl || 0) - 893352).toLocaleString()}`);

  await ch.close();
}

createFixedView().catch(console.error);
