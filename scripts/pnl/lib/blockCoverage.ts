/**
 * Block Coverage Helper Module
 *
 * Provides utilities for analyzing block coverage in ClickHouse tables.
 * Used to identify gaps that would require Goldsky backfills.
 */

import { clickhouse } from '../../../lib/clickhouse/client';

export interface BlockStats {
  tableName: string;
  minBlock: number;
  maxBlock: number;
  totalRows: number;
  distinctBlocks: number;
  coverage: number; // distinctBlocks / (maxBlock - minBlock + 1)
}

export interface BlockBucket {
  bucketStart: number;
  bucketEnd: number;
  rowCount: number;
  distinctBlocks: number;
  isEmpty: boolean;
}

export interface ContractBlockStats extends BlockStats {
  contractAddress: string;
}

export interface CoverageGap {
  gapStart: number;
  gapEnd: number;
  gapSize: number;
}

export interface TableCoverageReport {
  stats: BlockStats;
  buckets: BlockBucket[];
  gaps: CoverageGap[];
  recommendation: string;
}

/**
 * Get block statistics for a table
 * Note: Uses uniq() instead of uniqExact() to avoid memory issues on large tables
 */
export async function getBlockStats(
  tableName: string,
  blockColumn: string = 'block_number',
  whereClause: string = ''
): Promise<BlockStats> {
  const where = whereClause ? `WHERE ${whereClause}` : '';

  const result = await clickhouse.query({
    query: `
      SELECT
        '${tableName}' as table_name,
        min(${blockColumn}) as min_block,
        max(${blockColumn}) as max_block,
        count() as total_rows
      FROM ${tableName}
      ${where}
    `,
    format: 'JSONEachRow',
  });

  const row = (await result.json())[0] as any;
  const minBlock = Number(row.min_block || 0);
  const maxBlock = Number(row.max_block || 0);
  const totalBlocks = maxBlock - minBlock + 1;
  // Estimate distinct blocks from rows (most blocks have multiple rows)
  const estimatedDistinct = Math.min(Number(row.total_rows || 0), totalBlocks);

  return {
    tableName,
    minBlock,
    maxBlock,
    totalRows: Number(row.total_rows || 0),
    distinctBlocks: estimatedDistinct,
    coverage: totalBlocks > 0 ? estimatedDistinct / totalBlocks : 0,
  };
}

/**
 * Get block buckets for gap analysis
 * Returns counts per bucket to identify sparse regions
 */
export async function getBlockBuckets(
  tableName: string,
  bucketSize: number = 1000000, // 1M blocks per bucket
  blockColumn: string = 'block_number',
  whereClause: string = ''
): Promise<BlockBucket[]> {
  const where = whereClause ? `WHERE ${whereClause}` : '';

  const result = await clickhouse.query({
    query: `
      SELECT
        intDiv(${blockColumn}, ${bucketSize}) * ${bucketSize} as bucket_start,
        count() as row_count,
        uniqExact(${blockColumn}) as distinct_blocks
      FROM ${tableName}
      ${where}
      GROUP BY bucket_start
      ORDER BY bucket_start
    `,
    format: 'JSONEachRow',
  });

  const rows: any[] = await result.json();
  return rows.map((r) => ({
    bucketStart: Number(r.bucket_start),
    bucketEnd: Number(r.bucket_start) + bucketSize - 1,
    rowCount: Number(r.row_count),
    distinctBlocks: Number(r.distinct_blocks),
    isEmpty: false,
  }));
}

/**
 * Get block statistics grouped by contract address
 */
export async function getContractBlockStats(
  tableName: string,
  contractColumn: string = 'contract_address',
  blockColumn: string = 'block_number',
  whereClause: string = '',
  limit: number = 50
): Promise<ContractBlockStats[]> {
  const where = whereClause ? `WHERE ${whereClause}` : '';

  const result = await clickhouse.query({
    query: `
      SELECT
        lower(${contractColumn}) as contract_address,
        min(${blockColumn}) as min_block,
        max(${blockColumn}) as max_block,
        count() as total_rows,
        uniqExact(${blockColumn}) as distinct_blocks
      FROM ${tableName}
      ${where}
      GROUP BY contract_address
      ORDER BY total_rows DESC
      LIMIT ${limit}
    `,
    format: 'JSONEachRow',
  });

  const rows: any[] = await result.json();
  return rows.map((r) => {
    const minBlock = Number(r.min_block || 0);
    const maxBlock = Number(r.max_block || 0);
    const distinctBlocks = Number(r.distinct_blocks || 0);
    const totalBlocks = maxBlock - minBlock + 1;

    return {
      tableName,
      contractAddress: r.contract_address,
      minBlock,
      maxBlock,
      totalRows: Number(r.total_rows || 0),
      distinctBlocks,
      coverage: totalBlocks > 0 ? distinctBlocks / totalBlocks : 0,
    };
  });
}

/**
 * Find gaps in block coverage by analyzing buckets
 */
export function findGaps(
  buckets: BlockBucket[],
  minBlock: number,
  maxBlock: number,
  bucketSize: number = 1000000
): CoverageGap[] {
  const gaps: CoverageGap[] = [];

  if (buckets.length === 0) {
    return [{ gapStart: minBlock, gapEnd: maxBlock, gapSize: maxBlock - minBlock + 1 }];
  }

  // Sort buckets
  const sorted = [...buckets].sort((a, b) => a.bucketStart - b.bucketStart);

  // Check for gap at the beginning (before first bucket)
  const firstBucket = sorted[0].bucketStart;
  if (firstBucket > minBlock) {
    gaps.push({
      gapStart: minBlock,
      gapEnd: firstBucket - 1,
      gapSize: firstBucket - minBlock,
    });
  }

  // Check for gaps between buckets
  for (let i = 0; i < sorted.length - 1; i++) {
    const currentEnd = sorted[i].bucketEnd;
    const nextStart = sorted[i + 1].bucketStart;

    if (nextStart > currentEnd + 1) {
      gaps.push({
        gapStart: currentEnd + 1,
        gapEnd: nextStart - 1,
        gapSize: nextStart - currentEnd - 1,
      });
    }
  }

  return gaps;
}

/**
 * Get wallet-specific block coverage
 */
export async function getWalletBlockStats(
  wallet: string,
  tables: { name: string; walletColumn: string; blockColumn: string }[]
): Promise<Map<string, BlockStats>> {
  const walletLower = wallet.toLowerCase();
  const results = new Map<string, BlockStats>();

  for (const table of tables) {
    try {
      const stats = await getBlockStats(
        table.name,
        table.blockColumn,
        `lower(${table.walletColumn}) = '${walletLower}'`
      );
      results.set(table.name, stats);
    } catch (err: any) {
      // Table might not have data for this wallet
      results.set(table.name, {
        tableName: table.name,
        minBlock: 0,
        maxBlock: 0,
        totalRows: 0,
        distinctBlocks: 0,
        coverage: 0,
      });
    }
  }

  return results;
}

/**
 * Format block number for display (with commas)
 */
export function formatBlock(block: number): string {
  return block.toLocaleString();
}

/**
 * Format coverage as percentage
 */
export function formatCoverage(coverage: number): string {
  return (coverage * 100).toFixed(2) + '%';
}

/**
 * Generate a summary report for a table
 */
export async function generateTableReport(
  tableName: string,
  blockColumn: string = 'block_number',
  bucketSize: number = 1000000
): Promise<TableCoverageReport> {
  const stats = await getBlockStats(tableName, blockColumn);
  const buckets = await getBlockBuckets(tableName, bucketSize, blockColumn);
  const gaps = findGaps(buckets, stats.minBlock, stats.maxBlock, bucketSize);

  // Generate recommendation
  let recommendation = '';
  if (stats.minBlock > 1000000) {
    recommendation = `BACKFILL NEEDED: Data starts at block ${formatBlock(stats.minBlock)}. Missing blocks 0 - ${formatBlock(stats.minBlock - 1)}.`;
  } else if (gaps.length > 0) {
    const totalGapBlocks = gaps.reduce((sum, g) => sum + g.gapSize, 0);
    recommendation = `${gaps.length} gap(s) found totaling ${formatBlock(totalGapBlocks)} blocks. Review bucket analysis.`;
  } else if (stats.coverage < 0.5) {
    recommendation = `Low coverage (${formatCoverage(stats.coverage)}). Data may be sparse.`;
  } else {
    recommendation = 'Coverage looks good. No backfill needed.';
  }

  return { stats, buckets, gaps, recommendation };
}

/**
 * Known Polymarket contracts for reference
 */
export const POLYMARKET_CONTRACTS = {
  CTF_EXCHANGE: '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e',
  NEG_RISK_CTF_EXCHANGE: '0xc5d563a36ae78145c45a50134d48a1215220f80a',
  NEG_RISK_ADAPTER: '0xd91e80cf2e7be2e162c6513ced06f1dd0da35296',
  CONDITIONAL_TOKENS: '0x4d97dcd97ec945f40cf65f87097ace5ea0476045',
  USDC: '0x2791bca1f2de4661ed88a30c99a7a9449aa84174',
};

/**
 * Table definitions with their block and wallet columns
 * Note: pm_unified_ledger_v9 doesn't have block_number - use event_time instead
 */
export const TABLE_DEFINITIONS = [
  { name: 'pm_trader_events_v2', blockColumn: 'block_number', walletColumn: 'trader_wallet', hasBlockNumber: true },
  { name: 'pm_erc1155_transfers', blockColumn: 'block_number', walletColumn: 'from_address', hasBlockNumber: true },
  { name: 'pm_ctf_events', blockColumn: 'block_number', walletColumn: 'stakeholder', hasBlockNumber: true },
  { name: 'pm_erc20_usdc_flows', blockColumn: 'block_number', walletColumn: 'wallet_address', hasBlockNumber: true },
  // Note: ledger doesn't have block_number, derive coverage from CLOB/ERC1155
];
