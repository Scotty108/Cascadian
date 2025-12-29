/**
 * Log Block Coverage - Global Coverage Analysis
 *
 * Analyzes block coverage across all PnL-relevant tables.
 * Produces copy-pasteable output for Goldsky backfill planning.
 *
 * Usage:
 *   npx tsx scripts/pnl/log-block-coverage.ts
 *   npx tsx scripts/pnl/log-block-coverage.ts --bucket-size 500000
 */

import {
  getBlockStats,
  getBlockBuckets,
  findGaps,
  formatBlock,
  formatCoverage,
  TABLE_DEFINITIONS,
  POLYMARKET_CONTRACTS,
  BlockStats,
  BlockBucket,
  CoverageGap,
} from './lib/blockCoverage';
import { clickhouse } from '../../lib/clickhouse/client';

interface TableReport {
  tableName: string;
  stats: BlockStats;
  buckets: BlockBucket[];
  gaps: CoverageGap[];
  hasData: boolean;
  errorMessage?: string;
}

async function getTableSchema(tableName: string): Promise<string[]> {
  try {
    const result = await clickhouse.query({
      query: `DESCRIBE TABLE ${tableName}`,
      format: 'JSONEachRow',
    });
    const rows: any[] = await result.json();
    return rows.map((r) => r.name);
  } catch {
    return [];
  }
}

async function analyzeTable(
  tableName: string,
  blockColumn: string,
  bucketSize: number,
  skipBuckets: boolean = true // Skip bucket analysis by default (memory-intensive)
): Promise<TableReport> {
  try {
    // Check if table exists and has the block column
    const schema = await getTableSchema(tableName);
    if (schema.length === 0) {
      return {
        tableName,
        stats: { tableName, minBlock: 0, maxBlock: 0, totalRows: 0, distinctBlocks: 0, coverage: 0 },
        buckets: [],
        gaps: [],
        hasData: false,
        errorMessage: 'Table does not exist',
      };
    }

    if (!schema.includes(blockColumn)) {
      return {
        tableName,
        stats: { tableName, minBlock: 0, maxBlock: 0, totalRows: 0, distinctBlocks: 0, coverage: 0 },
        buckets: [],
        gaps: [],
        hasData: false,
        errorMessage: `Column '${blockColumn}' not found`,
      };
    }

    const stats = await getBlockStats(tableName, blockColumn);

    if (stats.totalRows === 0) {
      return {
        tableName,
        stats,
        buckets: [],
        gaps: [],
        hasData: false,
        errorMessage: 'Table is empty',
      };
    }

    // Skip bucket analysis to avoid memory issues on large tables
    // The key info we need is min/max block which we already have
    const buckets: BlockBucket[] = [];
    const gaps: CoverageGap[] = [];

    // Infer gaps from min block (if starts late, there's a gap)
    if (stats.minBlock > 1000000) {
      gaps.push({
        gapStart: 0,
        gapEnd: stats.minBlock - 1,
        gapSize: stats.minBlock,
      });
    }

    return { tableName, stats, buckets, gaps, hasData: true };
  } catch (err: any) {
    return {
      tableName,
      stats: { tableName, minBlock: 0, maxBlock: 0, totalRows: 0, distinctBlocks: 0, coverage: 0 },
      buckets: [],
      gaps: [],
      hasData: false,
      errorMessage: err.message,
    };
  }
}

async function getPolygonLatestBlock(): Promise<number> {
  // Approximate latest Polygon block (as of late 2024, ~65M blocks)
  // This is updated based on pm_trader_events_v2 max block
  try {
    const result = await clickhouse.query({
      query: `SELECT max(block_number) as max_block FROM pm_trader_events_v2`,
      format: 'JSONEachRow',
    });
    const row = (await result.json())[0] as any;
    return Number(row.max_block) || 65000000;
  } catch {
    return 65000000;
  }
}

function printSeparator(char: string = '─', length: number = 80): void {
  console.log(char.repeat(length));
}

function printHeader(title: string): void {
  console.log('\n' + '═'.repeat(80));
  console.log(title);
  console.log('═'.repeat(80));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const bucketSizeIdx = args.indexOf('--bucket-size');
  const bucketSize = bucketSizeIdx !== -1 && args[bucketSizeIdx + 1] ? parseInt(args[bucketSizeIdx + 1]) : 1000000;

  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    BLOCK COVERAGE ANALYSIS REPORT                          ║');
  console.log('║              Goldsky Backfill Planning - Copy-Pasteable Output             ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝');
  console.log(`\nGenerated: ${new Date().toISOString()}`);
  console.log(`Bucket size: ${formatBlock(bucketSize)} blocks\n`);

  const latestBlock = await getPolygonLatestBlock();
  console.log(`Latest known Polygon block: ${formatBlock(latestBlock)}`);

  // Tables to analyze (only those with block_number column)
  const tables = [
    { name: 'pm_trader_events_v2', blockColumn: 'block_number' },
    { name: 'pm_erc1155_transfers', blockColumn: 'block_number' },
    { name: 'pm_ctf_events', blockColumn: 'block_number' },
    { name: 'pm_erc20_usdc_flows', blockColumn: 'block_number' },
    // Note: pm_unified_ledger_v9 doesn't have block_number - derived from CLOB/ERC1155
  ];

  const reports: TableReport[] = [];

  printHeader('1. TABLE COVERAGE SUMMARY');

  console.log(
    '\n' +
      'Table'.padEnd(30) +
      ' | ' +
      'Min Block'.padStart(12) +
      ' | ' +
      'Max Block'.padStart(12) +
      ' | ' +
      'Rows'.padStart(15) +
      ' | ' +
      'Coverage'.padStart(10)
  );
  printSeparator();

  for (const table of tables) {
    process.stdout.write(`Analyzing ${table.name}...`);
    const report = await analyzeTable(table.name, table.blockColumn, bucketSize);
    reports.push(report);
    process.stdout.write('\r' + ' '.repeat(50) + '\r');

    if (report.hasData) {
      console.log(
        report.tableName.padEnd(30) +
          ' | ' +
          formatBlock(report.stats.minBlock).padStart(12) +
          ' | ' +
          formatBlock(report.stats.maxBlock).padStart(12) +
          ' | ' +
          formatBlock(report.stats.totalRows).padStart(15) +
          ' | ' +
          formatCoverage(report.stats.coverage).padStart(10)
      );
    } else {
      console.log(report.tableName.padEnd(30) + ' | ' + `ERROR: ${report.errorMessage}`.padStart(55));
    }
  }

  printHeader('2. BLOCK RANGE GAPS (Missing Early Data)');

  let hasBackfillNeeded = false;

  for (const report of reports) {
    if (!report.hasData) continue;

    // Check if data starts late (missing early blocks)
    if (report.stats.minBlock > 1000000) {
      hasBackfillNeeded = true;
      console.log(`\n${report.tableName}:`);
      console.log(`  ⚠️  MISSING EARLY BLOCKS`);
      console.log(`  First block in table:  ${formatBlock(report.stats.minBlock)}`);
      console.log(`  Expected start:        Block 0 (or Polymarket genesis)`);
      console.log(`  Missing range:         0 → ${formatBlock(report.stats.minBlock - 1)}`);
      console.log(`  Estimated missing:     ~${formatBlock(report.stats.minBlock)} blocks`);
    }
  }

  if (!hasBackfillNeeded) {
    console.log('\n✅ All tables appear to have data from early blocks.');
  }

  printHeader('3. BUCKET ANALYSIS (Sparse Regions)');

  for (const report of reports) {
    if (!report.hasData || report.buckets.length === 0) continue;

    console.log(`\n${report.tableName}:`);
    console.log(
      '  ' +
        'Bucket Range'.padEnd(30) +
        ' | ' +
        'Rows'.padStart(12) +
        ' | ' +
        'Blocks'.padStart(10) +
        ' | ' +
        'Density'.padStart(10)
    );
    console.log('  ' + '-'.repeat(70));

    // Show first 5 and last 5 buckets
    const bucketsToShow = report.buckets.length <= 10 ? report.buckets : [...report.buckets.slice(0, 5), ...report.buckets.slice(-5)];

    let shownEllipsis = false;
    for (let i = 0; i < report.buckets.length; i++) {
      const b = report.buckets[i];
      const isInShowRange = i < 5 || i >= report.buckets.length - 5;

      if (isInShowRange) {
        const density = b.rowCount / bucketSize;
        const range = `${formatBlock(b.bucketStart)} - ${formatBlock(b.bucketEnd)}`;
        console.log(
          '  ' +
            range.padEnd(30) +
            ' | ' +
            formatBlock(b.rowCount).padStart(12) +
            ' | ' +
            formatBlock(b.distinctBlocks).padStart(10) +
            ' | ' +
            density.toFixed(4).padStart(10)
        );
      } else if (!shownEllipsis) {
        console.log('  ' + '...'.padEnd(30) + ' | ' + '...'.padStart(12) + ' | ' + '...'.padStart(10) + ' | ' + '...'.padStart(10));
        shownEllipsis = true;
      }
    }
  }

  printHeader('4. GOLDSKY BACKFILL RECOMMENDATIONS');

  console.log('\n```');
  console.log('# Goldsky Backfill Plan');
  console.log('# Generated: ' + new Date().toISOString());
  console.log('');

  // ERC1155 transfers
  const erc1155Report = reports.find((r) => r.tableName === 'pm_erc1155_transfers');
  if (erc1155Report?.hasData && erc1155Report.stats.minBlock > 1000000) {
    console.log('## ERC1155 Transfers (Conditional Tokens)');
    console.log(`Contract: ${POLYMARKET_CONTRACTS.CONDITIONAL_TOKENS}`);
    console.log(`Current coverage: Block ${formatBlock(erc1155Report.stats.minBlock)} → ${formatBlock(erc1155Report.stats.maxBlock)}`);
    console.log(`BACKFILL NEEDED: Block 0 → ${formatBlock(erc1155Report.stats.minBlock - 1)}`);
    console.log(`Estimated blocks: ${formatBlock(erc1155Report.stats.minBlock)}`);
    console.log('');
  }

  // ERC20 USDC flows
  const erc20Report = reports.find((r) => r.tableName === 'pm_erc20_usdc_flows');
  if (erc20Report?.hasData) {
    console.log('## ERC20 USDC Flows');
    console.log(`Contract: ${POLYMARKET_CONTRACTS.USDC}`);
    console.log(`Current coverage: Block ${formatBlock(erc20Report.stats.minBlock)} → ${formatBlock(erc20Report.stats.maxBlock)}`);
    if (erc20Report.stats.minBlock > 1000000) {
      console.log(`BACKFILL NEEDED: Block 0 → ${formatBlock(erc20Report.stats.minBlock - 1)}`);
    }
    console.log('NOTE: Current table only captures ctf_deposit/payout events.');
    console.log('      May need full Transfer events for complete USDC flows.');
    console.log('');
  } else {
    console.log('## ERC20 USDC Flows');
    console.log(`Contract: ${POLYMARKET_CONTRACTS.USDC}`);
    console.log('STATUS: Table missing or empty - needs full backfill');
    console.log('');
  }

  // CLOB events
  const clobReport = reports.find((r) => r.tableName === 'pm_trader_events_v2');
  if (clobReport?.hasData) {
    console.log('## CLOB Trader Events');
    console.log(`Contracts: ${POLYMARKET_CONTRACTS.CTF_EXCHANGE}, ${POLYMARKET_CONTRACTS.NEG_RISK_CTF_EXCHANGE}`);
    console.log(`Current coverage: Block ${formatBlock(clobReport.stats.minBlock)} → ${formatBlock(clobReport.stats.maxBlock)}`);
    if (clobReport.stats.minBlock > 1000000) {
      console.log(`BACKFILL NEEDED: Block 0 → ${formatBlock(clobReport.stats.minBlock - 1)}`);
    } else {
      console.log('Coverage appears complete from early blocks.');
    }
    console.log('');
  }

  // CTF events
  const ctfReport = reports.find((r) => r.tableName === 'pm_ctf_events');
  if (ctfReport?.hasData) {
    console.log('## CTF Events (Split/Merge/Redemption)');
    console.log(`Contract: ${POLYMARKET_CONTRACTS.CONDITIONAL_TOKENS}`);
    console.log(`Current coverage: Block ${formatBlock(ctfReport.stats.minBlock)} → ${formatBlock(ctfReport.stats.maxBlock)}`);
    if (ctfReport.stats.minBlock > 1000000) {
      console.log(`BACKFILL NEEDED: Block 0 → ${formatBlock(ctfReport.stats.minBlock - 1)}`);
    } else {
      console.log('Coverage appears complete from early blocks.');
    }
    console.log('');
  }

  console.log('```');

  printHeader('5. SUMMARY');

  const tablesWithGaps = reports.filter((r) => r.hasData && r.stats.minBlock > 1000000);
  const tablesOk = reports.filter((r) => r.hasData && r.stats.minBlock <= 1000000);
  const tablesMissing = reports.filter((r) => !r.hasData);

  console.log(`\n✅ Tables with good coverage (start before block 1M): ${tablesOk.length}`);
  tablesOk.forEach((r) => console.log(`   - ${r.tableName}: starts at block ${formatBlock(r.stats.minBlock)}`));

  if (tablesWithGaps.length > 0) {
    console.log(`\n⚠️  Tables needing backfill (start after block 1M): ${tablesWithGaps.length}`);
    tablesWithGaps.forEach((r) =>
      console.log(`   - ${r.tableName}: starts at block ${formatBlock(r.stats.minBlock)} (missing ~${formatBlock(r.stats.minBlock)} blocks)`)
    );
  }

  if (tablesMissing.length > 0) {
    console.log(`\n❌ Tables with errors: ${tablesMissing.length}`);
    tablesMissing.forEach((r) => console.log(`   - ${r.tableName}: ${r.errorMessage}`));
  }

  console.log('\n' + '═'.repeat(80));
  console.log('END OF REPORT');
  console.log('═'.repeat(80) + '\n');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });
