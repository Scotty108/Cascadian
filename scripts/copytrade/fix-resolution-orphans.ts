/**
 * Fix Resolution Orphans - Create Extended Resolution Table
 *
 * ROOT CAUSE:
 * Sports spread markets have 84+ possible outcomes but resolve to binary [1,0].
 * The view vw_pm_resolution_prices only expands the payout array, orphaning
 * outcome indices that wallets actually traded on.
 *
 * FIX:
 * Create pm_resolution_prices_extended that:
 * 1. Includes all outcome indices from the payout array (existing behavior)
 * 2. Adds rows for any outcome_index that appears in pm_unified_ledger_v6
 *    but NOT in the payout array, with resolved_price = 0 (loss)
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@clickhouse/client';

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 300000,
});

async function createExtendedResolutionTable() {
  console.log('=== Creating Extended Resolution Table ===\n');

  // Step 1: Drop existing table if exists
  console.log('Step 1: Cleaning up...');
  try {
    await ch.command({ query: 'DROP TABLE IF EXISTS pm_resolution_prices_extended' });
    console.log('  Dropped existing table\n');
  } catch (e) {
    console.log('  Table did not exist\n');
  }

  // Step 2: Create the extended resolution table in two steps
  // Step 2A: Create base table from standard resolutions
  // Step 2B: Insert orphaned outcomes
  console.log('Step 2: Creating extended resolution table (two-pass approach)...');
  console.log('  This will include:');
  console.log('    A) Standard resolutions from payout array');
  console.log('    B) Orphaned outcomes (traded but not in payout) → resolved_price = 0');
  console.log('  Processing...\n');

  // Step 2A: Create table with standard resolutions
  console.log('  2A: Creating base table from standard resolutions...');
  const createTableQuery = `
    CREATE TABLE pm_resolution_prices_extended
    ENGINE = MergeTree()
    ORDER BY (condition_id, outcome_index)
    AS
    SELECT
      condition_id,
      outcome_index,
      resolved_price,
      resolution_time,
      0 AS is_orphaned
    FROM vw_pm_resolution_prices
  `;

  try {
    await ch.command({ query: createTableQuery });
    console.log('  ✓ Created base table from standard resolutions');
  } catch (e) {
    console.log('  ✗ Error creating table:', (e as Error).message);
    throw e;
  }

  // Step 2B: Insert orphaned outcomes (traded but not in payout array)
  // Only for resolved conditions, and only outcome indices not already in table
  console.log('  2B: Inserting orphaned outcomes...');

  // First get the list of resolved conditions (to filter the ledger efficiently)
  const resolvedConditionsQ = await ch.query({
    query: `SELECT DISTINCT condition_id FROM pm_resolution_prices_extended`,
    format: 'JSONEachRow'
  });
  const resolvedConditions = (await resolvedConditionsQ.json() as any[]).map(r => r.condition_id);
  console.log(`    Found ${resolvedConditions.length.toLocaleString()} resolved conditions`);

  // Process in batches of 1000 conditions to avoid memory issues
  const batchSize = 1000;
  let totalOrphans = 0;

  for (let i = 0; i < resolvedConditions.length; i += batchSize) {
    const batchConditions = resolvedConditions.slice(i, i + batchSize);
    const conditionList = batchConditions.map(c => `'${c}'`).join(',');
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(resolvedConditions.length / batchSize);

    // Insert orphaned outcomes for this batch
    const insertQuery = `
      INSERT INTO pm_resolution_prices_extended
      SELECT
        tp.condition_id AS condition_id,
        tp.outcome_index AS outcome_index,
        0.0 AS resolved_price,
        NULL AS resolution_time,
        1 AS is_orphaned
      FROM (
        SELECT DISTINCT
          lower(replace(condition_id, '0x', '')) AS condition_id,
          outcome_index
        FROM pm_unified_ledger_v6
        WHERE source_type = 'CLOB'
          AND condition_id IS NOT NULL
          AND condition_id != ''
          AND lower(replace(condition_id, '0x', '')) IN (${conditionList})
      ) AS tp
      LEFT JOIN pm_resolution_prices_extended AS existing
        ON tp.condition_id = existing.condition_id
        AND tp.outcome_index = existing.outcome_index
      WHERE existing.condition_id IS NULL  -- Only insert if not already exists
    `;

    try {
      await ch.command({ query: insertQuery });
      if (batchNum % 10 === 0 || batchNum === totalBatches) {
        console.log(`    Processed batch ${batchNum}/${totalBatches}`);
      }
    } catch (e) {
      console.log(`    Batch ${batchNum} error: ${(e as Error).message.slice(0, 80)}`);
    }
  }

  // Count orphans inserted
  const orphanCountQ = await ch.query({
    query: `SELECT count() as cnt FROM pm_resolution_prices_extended WHERE is_orphaned = 1`,
    format: 'JSONEachRow'
  });
  const orphanCount = (await orphanCountQ.json())[0] as any;
  console.log(`  ✓ Inserted ${orphanCount.cnt.toLocaleString()} orphaned outcome rows\n`);

  // Step 3: Verify table stats
  console.log('Step 3: Verifying table...');
  const statsQ = await ch.query({
    query: `
      SELECT
        count() AS total_rows,
        uniqExact(condition_id) AS unique_conditions,
        countIf(is_orphaned) AS orphaned_rows,
        countIf(NOT is_orphaned) AS standard_rows
      FROM pm_resolution_prices_extended
    `,
    format: 'JSONEachRow'
  });
  const stats = (await statsQ.json())[0] as any;
  console.log('  Total rows:', stats.total_rows.toLocaleString());
  console.log('  Unique conditions:', stats.unique_conditions.toLocaleString());
  console.log('  Standard rows:', stats.standard_rows.toLocaleString());
  console.log('  Orphaned rows:', stats.orphaned_rows.toLocaleString());

  // Step 4: Verify wallet #2 specifically
  console.log('\n\nStep 4: Testing wallet #2...');
  const wallet = '0x006cc834cc092684f1b56626e23bedb3835c16ea';

  // Old calculation (using vw_pm_resolution_prices)
  const oldQ = await ch.query({
    query: `
      SELECT
        sum(rpnl) AS realized_pnl,
        countIf(is_resolved) AS n_resolved,
        countIf(NOT is_resolved) AS n_unresolved
      FROM (
        SELECT
          if(r.resolved_price IS NOT NULL,
            p.cash_flow + (p.final_tokens * r.resolved_price),
            NULL
          ) AS rpnl,
          r.resolved_price IS NOT NULL AS is_resolved
        FROM (
          SELECT
            lower(replace(condition_id, '0x', '')) AS condition_id,
            outcome_index,
            sum(usdc_delta) AS cash_flow,
            sum(token_delta) AS final_tokens
          FROM pm_unified_ledger_v6
          WHERE lower(wallet_address) = '${wallet}'
            AND source_type = 'CLOB'
            AND condition_id != ''
          GROUP BY condition_id, outcome_index
        ) AS p
        LEFT JOIN (
          SELECT condition_id, outcome_index, any(resolved_price) AS resolved_price
          FROM vw_pm_resolution_prices
          GROUP BY condition_id, outcome_index
        ) AS r ON p.condition_id = r.condition_id AND p.outcome_index = r.outcome_index
      )
    `,
    format: 'JSONEachRow'
  });
  const oldRes = (await oldQ.json())[0] as any;

  // New calculation (using pm_resolution_prices_extended)
  const newQ = await ch.query({
    query: `
      SELECT
        sum(rpnl) AS realized_pnl,
        countIf(is_resolved) AS n_resolved,
        countIf(NOT is_resolved) AS n_unresolved,
        countIf(is_orphan_loss) AS n_orphan_losses,
        sum(if(is_orphan_loss, rpnl, 0)) AS orphan_loss_amount
      FROM (
        SELECT
          p.cash_flow + (p.final_tokens * coalesce(r.resolved_price, 0)) AS rpnl,
          r.resolved_price IS NOT NULL AS is_resolved,
          r.is_orphaned = 1 AS is_orphan_loss
        FROM (
          SELECT
            lower(replace(condition_id, '0x', '')) AS condition_id,
            outcome_index,
            sum(usdc_delta) AS cash_flow,
            sum(token_delta) AS final_tokens
          FROM pm_unified_ledger_v6
          WHERE lower(wallet_address) = '${wallet}'
            AND source_type = 'CLOB'
            AND condition_id != ''
          GROUP BY condition_id, outcome_index
        ) AS p
        LEFT JOIN pm_resolution_prices_extended AS r
          ON p.condition_id = r.condition_id AND p.outcome_index = r.outcome_index
      )
    `,
    format: 'JSONEachRow'
  });
  const newRes = (await newQ.json())[0] as any;

  console.log('\n=== WALLET #2 COMPARISON ===');
  console.log('OLD (vw_pm_resolution_prices):');
  console.log('  Realized P&L: $' + Math.round(oldRes.realized_pnl).toLocaleString());
  console.log('  Resolved: ' + oldRes.n_resolved + ' | Unresolved: ' + oldRes.n_unresolved);

  console.log('\nNEW (pm_resolution_prices_extended):');
  console.log('  Realized P&L: $' + Math.round(newRes.realized_pnl).toLocaleString());
  console.log('  Resolved: ' + newRes.n_resolved + ' | Unresolved: ' + newRes.n_unresolved);
  console.log('  Orphan losses: ' + newRes.n_orphan_losses + ' ($' + Math.round(newRes.orphan_loss_amount).toLocaleString() + ')');

  console.log('\n=== COMPARISON TO UI ===');
  console.log('UI shows: $893,352');
  console.log('OLD calculation: $' + Math.round(oldRes.realized_pnl).toLocaleString() + ' (diff: $' + Math.round(oldRes.realized_pnl - 893352).toLocaleString() + ')');
  console.log('NEW calculation: $' + Math.round(newRes.realized_pnl).toLocaleString() + ' (diff: $' + Math.round(newRes.realized_pnl - 893352).toLocaleString() + ')');

  // Step 5: Show the orphaned positions details
  console.log('\n\nStep 5: Orphaned positions detail...');
  const orphanQ = await ch.query({
    query: `
      SELECT
        p.condition_id,
        p.outcome_index,
        round(p.cash_flow, 2) AS cash_spent,
        round(p.final_tokens * r.resolved_price, 2) AS payout_value,
        round(p.cash_flow + (p.final_tokens * r.resolved_price), 2) AS pnl,
        r.is_orphaned,
        m.question
      FROM (
        SELECT
          lower(replace(condition_id, '0x', '')) AS condition_id,
          outcome_index,
          sum(usdc_delta) AS cash_flow,
          sum(token_delta) AS final_tokens
        FROM pm_unified_ledger_v6
        WHERE lower(wallet_address) = '${wallet}'
          AND source_type = 'CLOB'
          AND condition_id != ''
        GROUP BY condition_id, outcome_index
      ) AS p
      LEFT JOIN pm_resolution_prices_extended AS r
        ON p.condition_id = r.condition_id AND p.outcome_index = r.outcome_index
      LEFT JOIN (
        SELECT lower(condition_id) AS condition_id, question
        FROM pm_market_metadata
      ) AS m ON p.condition_id = m.condition_id
      WHERE r.is_orphaned = 1
      ORDER BY pnl ASC
      LIMIT 15
    `,
    format: 'JSONEachRow'
  });
  const orphans = await orphanQ.json() as any[];

  console.log('Top 15 orphan losses:');
  for (const o of orphans) {
    console.log(`  ${o.question || 'Unknown'}`);
    console.log(`    outcome ${o.outcome_index} | cash: $${Math.round(o.cash_spent).toLocaleString()} | payout: $${Math.round(o.payout_value).toLocaleString()} | P&L: $${Math.round(o.pnl).toLocaleString()}`);
  }

  await ch.close();
  console.log('\n✓ Done');
}

createExtendedResolutionTable().catch(console.error);
