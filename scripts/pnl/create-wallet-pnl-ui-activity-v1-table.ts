/**
 * Create pm_wallet_pnl_ui_activity_v1 table and vw_wallet_pnl_ui_activity_v1 view
 *
 * This script creates the ClickHouse infrastructure for V10 Activity PnL:
 * 1. pm_wallet_pnl_ui_activity_v1 - ReplacingMergeTree table for materialized results
 * 2. vw_wallet_pnl_ui_activity_v1 - Wrapper view for FINAL deduplication
 *
 * Usage: npx tsx scripts/pnl/create-wallet-pnl-ui-activity-v1-table.ts
 */

import { clickhouse } from '../../lib/clickhouse/client';

async function createTable(): Promise<void> {
  console.log('Creating pm_wallet_pnl_ui_activity_v1 table...');

  const createTableSQL = `
    CREATE TABLE IF NOT EXISTS pm_wallet_pnl_ui_activity_v1
    (
      wallet              String,
      pnl_activity_total  Float64,
      gain_activity       Float64,
      loss_activity       Float64,
      volume_traded       Float64,
      fills_count         UInt32,
      redemptions_count   UInt32,
      updated_at          DateTime DEFAULT now()
    )
    ENGINE = ReplacingMergeTree(updated_at)
    ORDER BY (wallet)
    SETTINGS index_granularity = 8192
  `;

  await clickhouse.command({ query: createTableSQL });
  console.log('  Table created successfully.');
}

async function createView(): Promise<void> {
  console.log('Creating vw_wallet_pnl_ui_activity_v1 view...');

  const createViewSQL = `
    CREATE OR REPLACE VIEW vw_wallet_pnl_ui_activity_v1 AS
    SELECT
      wallet,
      pnl_activity_total,
      gain_activity,
      loss_activity,
      volume_traded,
      fills_count,
      redemptions_count,
      updated_at
    FROM pm_wallet_pnl_ui_activity_v1
    FINAL
  `;

  await clickhouse.command({ query: createViewSQL });
  console.log('  View created successfully.');
}

async function verifyStructure(): Promise<void> {
  console.log('Verifying table structure...');

  const describeResult = await clickhouse.query({
    query: 'DESCRIBE pm_wallet_pnl_ui_activity_v1',
    format: 'JSONEachRow',
  });
  const columns = (await describeResult.json()) as any[];

  console.log('  Table columns:');
  for (const col of columns) {
    console.log(`    ${col.name}: ${col.type}`);
  }

  // Verify view exists
  const viewCheckResult = await clickhouse.query({
    query: `
      SELECT name, engine
      FROM system.tables
      WHERE database = currentDatabase()
        AND name = 'vw_wallet_pnl_ui_activity_v1'
    `,
    format: 'JSONEachRow',
  });
  const viewRows = (await viewCheckResult.json()) as any[];

  if (viewRows.length > 0) {
    console.log('  View verified: vw_wallet_pnl_ui_activity_v1 exists');
  } else {
    console.log('  WARNING: View not found!');
  }
}

async function main(): Promise<void> {
  console.log('='.repeat(70));
  console.log('Setting up pm_wallet_pnl_ui_activity_v1 infrastructure');
  console.log('='.repeat(70));
  console.log('');

  try {
    await createTable();
    await createView();
    console.log('');
    await verifyStructure();
    console.log('');
    console.log('Done! Infrastructure is ready for materialization.');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();
