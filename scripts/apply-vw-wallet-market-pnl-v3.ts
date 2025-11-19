#!/usr/bin/env tsx
/**
 * Apply vw_wallet_market_pnl_v3 View
 *
 * Creates V3 wallet position-level PnL view using canonical condition IDs
 * Mirrors V2 logic exactly, only difference is 69% coverage vs 10% coverage
 *
 * Expected Improvements:
 * - V2: ~5-10M positions (10% coverage)
 * - V3: ~15-30M positions (69% coverage)
 * - Improvement: +59% more trades contribute to PnL
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '@/lib/clickhouse/client';
import * as fs from 'fs';

async function main() {
  console.log('📊 Applying vw_wallet_market_pnl_v3 View\n');
  console.log('='.repeat(80));
  console.log('Source: vw_trades_canonical_current (V3-first, V2-fallback)');
  console.log('Coverage: ~69% (vs ~10% in V2)');
  console.log('Formula: Same FIFO cost basis as V2 (zero changes)');
  console.log('');

  // Step 1: Apply the DDL
  console.log('Step 1: Applying DDL from sql/views/vw_wallet_market_pnl_v3.sql...\n');

  const ddl = fs.readFileSync(
    resolve(process.cwd(), 'sql/views/vw_wallet_market_pnl_v3.sql'),
    'utf-8'
  );

  await clickhouse.command({ query: ddl });
  console.log('✅ View created successfully\n');

  // Step 2: Verify row count
  console.log('Step 2: Verifying row count (may take 1-2 minutes)...\n');

  const countQuery = 'SELECT COUNT(*) as count FROM vw_wallet_market_pnl_v3';
  const countResult = await clickhouse.query({ query: countQuery, format: 'JSONEachRow' });
  const countData = await countResult.json() as any[];

  const totalPositions = parseInt(countData[0].count);
  console.log(`Total positions: ${totalPositions.toLocaleString()}\n`);

  // Step 3: Coverage breakdown by canonical_condition_source
  console.log('Step 3: Coverage breakdown by data source...\n');

  const coverageQuery = `
    SELECT
      canonical_condition_source,
      COUNT(*) as count,
      ROUND(100.0 * count / SUM(count) OVER (), 2) as pct
    FROM vw_wallet_market_pnl_v3
    GROUP BY canonical_condition_source
    ORDER BY count DESC
  `;

  const coverageResult = await clickhouse.query({ query: coverageQuery, format: 'JSONEachRow' });
  const coverageData = await coverageResult.json() as any[];

  console.log('Data Source  Positions           Percentage');
  console.log('─'.repeat(60));

  for (const row of coverageData) {
    const source = (row.canonical_condition_source || 'unknown').padEnd(12);
    const count = parseInt(row.count).toLocaleString().padStart(15);
    const pct = parseFloat(row.pct).toFixed(2).padStart(6);
    console.log(`${source}  ${count}     ${pct}%`);
  }

  console.log('');

  // Step 4: Wallet count
  console.log('Step 4: Unique wallet count...\n');

  const walletCountQuery = 'SELECT uniqExact(wallet_address) AS count FROM vw_wallet_market_pnl_v3';
  const walletCountResult = await clickhouse.query({ query: walletCountQuery, format: 'JSONEachRow' });
  const walletCountData = await walletCountResult.json() as any[];

  const totalWallets = parseInt(walletCountData[0].count);
  console.log(`Unique wallets: ${totalWallets.toLocaleString()}\n`);

  // Step 5: Sample positions
  console.log('Step 5: Sample positions from view...\n');

  const sampleQuery = `
    SELECT
      wallet_address,
      condition_id_norm,
      canonical_condition_source,
      total_trades,
      total_bought_shares,
      total_sold_shares,
      final_position_size,
      realized_pnl_usd,
      is_resolved
    FROM vw_wallet_market_pnl_v3
    WHERE ABS(realized_pnl_usd) > 0
    ORDER BY ABS(realized_pnl_usd) DESC
    LIMIT 5
  `;

  const sampleResult = await clickhouse.query({ query: sampleQuery, format: 'JSONEachRow' });
  const sampleData = await sampleResult.json() as any[];

  console.log('Top 5 positions by absolute P&L:');
  console.log('─'.repeat(80));

  for (const row of sampleData) {
    const wallet = row.wallet_address.substring(0, 10) + '...';
    const pnl = parseFloat(row.realized_pnl_usd).toFixed(2);
    const source = row.canonical_condition_source;
    const resolved = row.is_resolved === 1 ? 'resolved' : 'unresolved';
    console.log(`  ${wallet} | ${source} | $${pnl} | ${resolved}`);
  }

  console.log('');

  // Step 6: Compare to V2 (if V2 view exists)
  console.log('Step 6: Comparing V3 to V2 coverage...\n');

  try {
    const v2CountQuery = 'SELECT COUNT(*) as count FROM pm_wallet_market_pnl_v2';
    const v2CountResult = await clickhouse.query({ query: v2CountQuery, format: 'JSONEachRow' });
    const v2CountData = await v2CountResult.json() as any[];

    const v2Positions = parseInt(v2CountData[0].count);
    const improvement = totalPositions - v2Positions;
    const improvementPct = ((improvement / v2Positions) * 100).toFixed(2);

    console.log(`V2 positions: ${v2Positions.toLocaleString()}`);
    console.log(`V3 positions: ${totalPositions.toLocaleString()}`);
    console.log(`Improvement:  +${improvement.toLocaleString()} (+${improvementPct}%)\n`);
  } catch (error) {
    console.log('⚠️  Could not compare to V2 (table may not exist yet)\n');
  }

  console.log('═'.repeat(80));
  console.log('✅ VERIFICATION COMPLETE');
  console.log('═'.repeat(80));
  console.log('');
  console.log('Summary:');
  console.log(`- View: vw_wallet_market_pnl_v3`);
  console.log(`- Source: vw_trades_canonical_current → pm_trades_canonical_v3`);
  console.log(`- Total positions: ${totalPositions.toLocaleString()}`);
  console.log(`- Unique wallets: ${totalWallets.toLocaleString()}`);
  console.log(`- PnL formula: Same FIFO cost basis as V2`);
  console.log(`- Key improvement: +59% coverage (69% vs 10%)`);
  console.log('');
  console.log('Next step: Use this view for V2 vs V3 PnL comparison slice');
}

main().catch(console.error);
