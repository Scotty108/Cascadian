/**
 * Metrics Capability Audit
 *
 * Shows what metrics we can calculate now vs after user_positions backfill completes
 *
 * Usage:
 *   npx tsx scripts/pnl/audit-metrics-capability.ts
 */

import { clickhouse } from '../../lib/clickhouse/client';

interface TableStatus {
  exists: boolean;
  rows: number;
  columns: string[];
}

interface MetricCapability {
  name: string;
  requirement: string;
  sources: string[];
  haveNow: boolean;
  willHaveAfterBackfill: boolean;
  notes: string;
}

async function checkTableStatus(tableName: string): Promise<TableStatus> {
  try {
    const countResult = await clickhouse.query({
      query: `SELECT count() as cnt FROM ${tableName}`,
      format: 'JSONEachRow',
    });
    const countRow = (await countResult.json())[0] as any;

    const schemaResult = await clickhouse.query({
      query: `DESCRIBE TABLE ${tableName}`,
      format: 'JSONEachRow',
    });
    const schemaRows: any[] = await schemaResult.json();
    const columns = schemaRows.map((r) => r.name);

    return {
      exists: true,
      rows: Number(countRow.cnt),
      columns,
    };
  } catch {
    return { exists: false, rows: 0, columns: [] };
  }
}

async function main(): Promise<void> {
  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║               METRICS CAPABILITY MATRIX - COMPLETE AUDIT                   ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝');
  console.log(`\nGenerated: ${new Date().toISOString()}\n`);

  // Check all relevant tables
  const tablesToCheck = [
    'pm_user_positions_v2',
    'pm_trader_events_v2',
    'pm_unified_ledger_v9',
    'pm_token_to_condition_map_v4',
    'pm_resolutions_v4',
    'pm_markets_metadata_v3',
    'pm_ctf_events',
    'pm_erc1155_transfers',
  ];

  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('1. TABLE STATUS CHECK');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  const tableStatus: Record<string, TableStatus> = {};

  for (const table of tablesToCheck) {
    const status = await checkTableStatus(table);
    tableStatus[table] = status;

    const statusIcon = status.exists ? (status.rows > 0 ? '✅' : '⚠️ EMPTY') : '❌ MISSING';
    console.log(`${statusIcon} ${table.padEnd(35)} ${status.rows.toLocaleString().padStart(15)} rows`);
  }

  // Check for category column in metadata
  let hasCategoryColumn = false;
  let categoryColumnName = '';
  if (tableStatus['pm_markets_metadata_v3']?.exists) {
    const catCols = tableStatus['pm_markets_metadata_v3'].columns.filter(
      (c) => c.includes('categ') || c.includes('tag') || c === 'market_type' || c === 'sport'
    );
    if (catCols.length > 0) {
      hasCategoryColumn = true;
      categoryColumnName = catCols[0];
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('2. USER POSITIONS BACKFILL STATUS');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  if (tableStatus['pm_user_positions_v2']?.exists && tableStatus['pm_user_positions_v2'].rows > 0) {
    const posResult = await clickhouse.query({
      query: `
        SELECT
          count() as total_rows,
          uniqExact(id) as unique_positions,
          uniqExact(user) as unique_wallets,
          min(avg_price) as min_avg_price,
          max(avg_price) as max_avg_price,
          sum(realized_pnl) / 1e6 as total_realized_pnl
        FROM pm_user_positions_v2
      `,
      format: 'JSONEachRow',
    });
    const posRow = (await posResult.json())[0] as any;

    console.log(`Total Rows:        ${Number(posRow.total_rows).toLocaleString()}`);
    console.log(`Unique Positions:  ${Number(posRow.unique_positions).toLocaleString()}`);
    console.log(`Unique Wallets:    ${Number(posRow.unique_wallets).toLocaleString()}`);
    console.log(`Realized PnL Sum:  $${Number(posRow.total_realized_pnl).toLocaleString()}`);

    const hasAvgPrice = Number(posRow.max_avg_price) > 0;
    console.log(`\nHas avg_price data: ${hasAvgPrice ? '✅ YES' : '❌ NO'}`);
  } else {
    console.log('⚠️  pm_user_positions_v2 is empty or missing - backfill in progress');
  }

  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('3. METRICS CAPABILITY MATRIX');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  const metrics: MetricCapability[] = [
    {
      name: 'UI PnL Match (Realized)',
      requirement: 'avg_price (cost basis) + resolutions',
      sources: ['pm_user_positions_v2 (avg_price)', 'pm_resolutions_v4'],
      haveNow: tableStatus['pm_resolutions_v4']?.rows > 0 && tableStatus['pm_user_positions_v2']?.rows > 100000,
      willHaveAfterBackfill: true,
      notes: 'PENDING - need avg_price from user_positions backfill',
    },
    {
      name: 'UI PnL Match (Unrealized)',
      requirement: 'avg_price + current_price + position',
      sources: ['pm_user_positions_v2 (avg_price, amount)', 'live prices API'],
      haveNow: false,
      willHaveAfterBackfill: true,
      notes: 'PENDING - need avg_price + live price feed integration',
    },
    {
      name: 'Time in Trade (Per Position)',
      requirement: 'trade_time for entry/exit',
      sources: ['pm_trader_events_v2 (trade_time)'],
      haveNow: tableStatus['pm_trader_events_v2']?.rows > 0,
      willHaveAfterBackfill: true,
      notes: '✅ HAVE - trade_time in CLOB events',
    },
    {
      name: 'Win Rate (Overall)',
      requirement: 'resolved positions + outcome',
      sources: ['pm_user_positions_v2', 'pm_resolutions_v4'],
      haveNow: tableStatus['pm_resolutions_v4']?.rows > 0,
      willHaveAfterBackfill: true,
      notes: '✅ Can derive from positions + resolutions',
    },
    {
      name: 'Win Rate by Category',
      requirement: 'categories/tags + win rate data',
      sources: ['pm_markets_metadata_v3 (category)', 'pm_resolutions_v4'],
      haveNow: hasCategoryColumn && tableStatus['pm_markets_metadata_v3']?.rows > 0,
      willHaveAfterBackfill: hasCategoryColumn,
      notes: hasCategoryColumn ? '✅ HAVE category column' : '❌ MISSING - need category enrichment',
    },
    {
      name: 'PnL by Category',
      requirement: 'avg_price + category mapping',
      sources: ['pm_user_positions_v2', 'pm_markets_metadata_v3'],
      haveNow: false,
      willHaveAfterBackfill: hasCategoryColumn,
      notes: hasCategoryColumn ? 'PENDING - need avg_price + have categories' : '❌ MISSING categories',
    },
    {
      name: 'Omega Ratio (Overall)',
      requirement: 'trade-level returns (gain/loss separation)',
      sources: ['pm_trader_events_v2 OR pm_unified_ledger_v9'],
      haveNow: tableStatus['pm_unified_ledger_v9']?.rows > 0,
      willHaveAfterBackfill: true,
      notes: '✅ Can calculate from payout_norm in ledger',
    },
    {
      name: 'Omega Ratio by Category',
      requirement: 'omega + category mapping',
      sources: ['pm_unified_ledger_v9', 'pm_markets_metadata_v3'],
      haveNow: hasCategoryColumn && tableStatus['pm_unified_ledger_v9']?.rows > 0,
      willHaveAfterBackfill: hasCategoryColumn,
      notes: hasCategoryColumn ? '✅ HAVE' : '❌ MISSING categories',
    },
    {
      name: 'Omega Over Time',
      requirement: 'trade_time + returns',
      sources: ['pm_trader_events_v2 (trade_time)', 'pm_unified_ledger_v9'],
      haveNow: tableStatus['pm_trader_events_v2']?.rows > 0,
      willHaveAfterBackfill: true,
      notes: '✅ HAVE - can bucket by trade_time',
    },
    {
      name: 'Position Sizing Analysis',
      requirement: 'token_amount, usdc_amount per trade',
      sources: ['pm_trader_events_v2'],
      haveNow: tableStatus['pm_trader_events_v2']?.rows > 0,
      willHaveAfterBackfill: true,
      notes: '✅ HAVE',
    },
    {
      name: 'Cost Basis (FIFO/Avg)',
      requirement: 'weighted avg acquisition price',
      sources: ['pm_user_positions_v2 (avg_price)'],
      haveNow: false,
      willHaveAfterBackfill: true,
      notes: 'PENDING - this is THE KEY data from backfill',
    },
  ];

  console.log('Metric'.padEnd(35) + ' | ' + 'Have Now'.padEnd(10) + ' | ' + 'After Backfill'.padEnd(15) + ' | Status');
  console.log('-'.repeat(90));

  for (const m of metrics) {
    const haveNow = m.haveNow ? '✅ YES' : '❌ NO';
    const afterBackfill = m.willHaveAfterBackfill ? '✅ YES' : '❌ NO';
    const status = m.haveNow ? 'READY' : m.willHaveAfterBackfill ? 'PENDING' : 'BLOCKED';
    console.log(`${m.name.padEnd(35)} | ${haveNow.padEnd(10)} | ${afterBackfill.padEnd(15)} | ${status}`);
  }

  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('4. DETAILED BREAKDOWN BY METRIC');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  for (const m of metrics) {
    const statusIcon = m.haveNow ? '✅' : m.willHaveAfterBackfill ? '⏳' : '❌';
    console.log(`${statusIcon} ${m.name}`);
    console.log(`   Requires: ${m.requirement}`);
    console.log(`   Sources:  ${m.sources.join(', ')}`);
    console.log(`   Status:   ${m.notes}`);
    console.log('');
  }

  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('5. BLOCKERS & GAPS');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  const blocked = metrics.filter((m) => !m.willHaveAfterBackfill);
  const pending = metrics.filter((m) => !m.haveNow && m.willHaveAfterBackfill);
  const ready = metrics.filter((m) => m.haveNow);

  console.log(`✅ READY NOW:         ${ready.length} metrics`);
  ready.forEach((m) => console.log(`   - ${m.name}`));

  console.log(`\n⏳ PENDING BACKFILL:  ${pending.length} metrics`);
  pending.forEach((m) => console.log(`   - ${m.name}`));

  if (blocked.length > 0) {
    console.log(`\n❌ BLOCKED:           ${blocked.length} metrics`);
    blocked.forEach((m) => console.log(`   - ${m.name}: ${m.notes}`));
  }

  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('6. CATEGORY ENRICHMENT CHECK');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  if (tableStatus['pm_markets_metadata_v3']?.exists) {
    console.log('pm_markets_metadata_v3 columns:');
    console.log(tableStatus['pm_markets_metadata_v3'].columns.join(', '));

    const catColumns = tableStatus['pm_markets_metadata_v3'].columns.filter(
      (c) => c.includes('categ') || c.includes('tag') || c.includes('type') || c.includes('sport')
    );

    if (catColumns.length > 0) {
      console.log(`\nCategory-like columns found: ${catColumns.join(', ')}`);

      try {
        const sampleResult = await clickhouse.query({
          query: `SELECT ${catColumns.join(', ')} FROM pm_markets_metadata_v3 WHERE ${catColumns[0]} != '' LIMIT 5`,
          format: 'JSONEachRow',
        });
        const sampleRows: any[] = await sampleResult.json();
        if (sampleRows.length > 0) {
          console.log('Sample values:');
          sampleRows.forEach((r, i) => console.log(`  ${i + 1}. ${JSON.stringify(r)}`));
        }
      } catch {
        console.log('Could not sample category data');
      }
    } else {
      console.log('\n⚠️  NO category columns found in metadata table!');
      console.log('This blocks: Win Rate by Category, PnL by Category, Omega by Category');
    }
  } else {
    console.log('❌ pm_markets_metadata_v3 table MISSING');
    console.log('Need to create/populate this table for category-based metrics');
  }

  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('7. SUMMARY & RECOMMENDATIONS');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  console.log('After user_positions backfill completes, you WILL have:');
  console.log('  ✅ Accurate cost basis (avg_price) for PnL calculations');
  console.log('  ✅ Pre-calculated realized_pnl from Goldsky');
  console.log('  ✅ Time in trade (from pm_trader_events_v2.trade_time)');
  console.log('  ✅ Win rate overall');
  console.log('  ✅ Omega ratio overall');
  console.log('  ✅ Omega over time');

  console.log('\nYou will still need to ADDRESS:');
  if (!hasCategoryColumn) {
    console.log('  ❌ Category enrichment - required for all category-based metrics');
    console.log('     Solution: Backfill pm_markets_metadata_v3 with Gamma API categories');
    console.log('     Affected metrics: Win Rate by Category, PnL by Category, Omega by Category');
  } else {
    console.log('  ✅ Category enrichment appears available');
  }

  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('END OF METRICS CAPABILITY AUDIT');
  console.log('═══════════════════════════════════════════════════════════════════\n');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });
