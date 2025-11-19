#!/usr/bin/env npx tsx
/**
 * Investigate P&L Discrepancy - Schema Analysis
 *
 * Examining table structures and formulas to understand why:
 * - wallet_pnl_correct shows: -$11.5M
 * - wallet_pnl_summary_final shows: -$1.9M
 * - trades_raw sum shows: +$117.24
 * - Direct calculations show: +$1.9M
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from './lib/clickhouse/client';

const clickhouse = getClickHouseClient();

const WALLET = '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0';

async function investigateDiscrepancy() {
  console.log('='.repeat(80));
  console.log('P&L DISCREPANCY INVESTIGATION - SCHEMA ANALYSIS');
  console.log('='.repeat(80));
  console.log(`\nWallet: ${WALLET}`);
  console.log(`\nObjective: Identify why aggregate tables show NEGATIVE P&L when raw data shows POSITIVE\n`);

  try {
    // 1. Get wallet_pnl_correct schema and sample data
    console.log('\n' + '─'.repeat(80));
    console.log('1. WALLET_PNL_CORRECT TABLE ANALYSIS');
    console.log('─'.repeat(80));

    const pnlCorrectSchema = await clickhouse.query({
      query: `DESCRIBE TABLE wallet_pnl_correct`,
      format: 'JSONEachRow',
    });
    const pnlCorrectCols = await pnlCorrectSchema.json() as any[];

    console.log('\nColumns:');
    pnlCorrectCols.forEach((col: any) => {
      console.log(`  ${col.name.padEnd(30)} ${col.type.padEnd(20)} ${col.comment || ''}`);
    });

    const pnlCorrectData = await clickhouse.query({
      query: `
        SELECT *
        FROM wallet_pnl_correct
        WHERE wallet_address = '${WALLET}'
        LIMIT 1
      `,
      format: 'JSONEachRow',
    });
    const pnlCorrectRows = await pnlCorrectData.json() as any[];

    if (pnlCorrectRows.length > 0) {
      console.log('\nSample Data:');
      const row = pnlCorrectRows[0];
      for (const [key, value] of Object.entries(row)) {
        console.log(`  ${key.padEnd(30)} = ${value}`);
      }
    }

    // 2. Get wallet_pnl_summary_final schema and sample data
    console.log('\n' + '─'.repeat(80));
    console.log('2. WALLET_PNL_SUMMARY_FINAL TABLE ANALYSIS');
    console.log('─'.repeat(80));

    const pnlSummarySchema = await clickhouse.query({
      query: `DESCRIBE TABLE wallet_pnl_summary_final`,
      format: 'JSONEachRow',
    });
    const pnlSummaryCols = await pnlSummarySchema.json() as any[];

    console.log('\nColumns:');
    pnlSummaryCols.forEach((col: any) => {
      console.log(`  ${col.name.padEnd(30)} ${col.type.padEnd(20)} ${col.comment || ''}`);
    });

    const pnlSummaryData = await clickhouse.query({
      query: `
        SELECT *
        FROM wallet_pnl_summary_final
        WHERE wallet = '${WALLET}'
        LIMIT 1
      `,
      format: 'JSONEachRow',
    });
    const pnlSummaryRows = await pnlSummaryData.json() as any[];

    if (pnlSummaryRows.length > 0) {
      console.log('\nSample Data:');
      const row = pnlSummaryRows[0];
      for (const [key, value] of Object.entries(row)) {
        console.log(`  ${key.padEnd(30)} = ${value}`);
      }
    }

    // 3. Get trades_raw schema and analyze realized_pnl_usd
    console.log('\n' + '─'.repeat(80));
    console.log('3. TRADES_RAW TABLE ANALYSIS');
    console.log('─'.repeat(80));

    const tradesRawSchema = await clickhouse.query({
      query: `DESCRIBE TABLE trades_raw`,
      format: 'JSONEachRow',
    });
    const tradesRawCols = await tradesRawSchema.json() as any[];

    console.log('\nKey Columns:');
    const keyColumns = ['wallet_address', 'market_id', 'side', 'shares',
                       'resolved', 'realized_pnl_usd', 'outcome_index'];
    tradesRawCols
      .filter((col: any) => keyColumns.includes(col.name))
      .forEach((col: any) => {
        console.log(`  ${col.name.padEnd(30)} ${col.type.padEnd(20)} ${col.comment || ''}`);
      });

    // Sample resolved trades
    const resolvedTrades = await clickhouse.query({
      query: `
        SELECT
          market_id,
          side,
          shares,
          realized_pnl_usd,
          outcome_index
        FROM trades_raw
        WHERE wallet_address = '${WALLET}'
          AND realized_pnl_usd != 0
        ORDER BY realized_pnl_usd DESC
        LIMIT 10
      `,
      format: 'JSONEachRow',
    });
    const resolvedRows = await resolvedTrades.json() as any[];

    console.log('\nTop 10 Resolved Trades by P&L:');
    console.log('  Market ID'.padEnd(25) + 'Side'.padEnd(8) + 'Shares'.padEnd(15) + 'P&L'.padEnd(15) + 'Outcome');
    resolvedRows.forEach((row: any) => {
      console.log(
        `  ${String(row.market_id).substring(0, 23).padEnd(25)}` +
        `${String(row.side).padEnd(8)}` +
        `${Number(row.shares).toFixed(2).padStart(13)}  ` +
        `${Number(row.realized_pnl_usd).toFixed(2).padStart(13)}  ` +
        `${String(row.outcome_index).padStart(7)}`
      );
    });

    // 4. Check if tables are views or materialized tables
    console.log('\n' + '─'.repeat(80));
    console.log('4. TABLE TYPE ANALYSIS');
    console.log('─'.repeat(80));

    const tableInfo = await clickhouse.query({
      query: `
        SELECT
          name,
          engine,
          create_table_query
        FROM system.tables
        WHERE database = currentDatabase()
          AND name IN ('wallet_pnl_correct', 'wallet_pnl_summary_final', 'trades_raw')
      `,
      format: 'JSONEachRow',
    });
    const tables = await tableInfo.json() as any[];

    for (const table of tables) {
      console.log(`\nTable: ${table.name}`);
      console.log(`Engine: ${table.engine}`);
      console.log(`\nCREATE Statement:`);
      console.log(table.create_table_query);
      console.log('\n' + '-'.repeat(80));
    }

    // 5. Compare aggregation formulas
    console.log('\n' + '─'.repeat(80));
    console.log('5. AGGREGATION COMPARISON');
    console.log('─'.repeat(80));

    // Direct sum from trades_raw
    const directSum = await clickhouse.query({
      query: `
        SELECT
          count() as total_trades,
          countIf(realized_pnl_usd != 0) as resolved_trades,
          countIf(realized_pnl_usd > 0) as winning_trades,
          countIf(realized_pnl_usd < 0) as losing_trades,
          sum(realized_pnl_usd) as total_realized_pnl,
          sum(shares) as total_shares
        FROM trades_raw
        WHERE wallet_address = '${WALLET}'
      `,
      format: 'JSONEachRow',
    });
    const directSumData = await directSum.json() as any[];

    console.log('\nDirect Sum from trades_raw (resolved trades):');
    if (directSumData.length > 0) {
      const data = directSumData[0];
      console.log(`  Total Trades:        ${data.total_trades}`);
      console.log(`  Resolved Trades:     ${data.resolved_trades}`);
      console.log(`  Winning Trades:      ${data.winning_trades}`);
      console.log(`  Losing Trades:       ${data.losing_trades}`);
      console.log(`  Total Realized P&L:  $${Number(data.total_realized_pnl).toFixed(2)}`);
      console.log(`  Total Shares:        ${Number(data.total_shares).toFixed(2)}`);
    }

    // 6. Check for negative multipliers or sign inversions
    console.log('\n' + '─'.repeat(80));
    console.log('6. SIGN INVERSION ANALYSIS');
    console.log('─'.repeat(80));

    console.log('\nChecking for potential sign inversion patterns...');

    // Check if there's a pattern in the aggregate tables
    if (pnlCorrectRows.length > 0 && directSumData.length > 0) {
      const aggregateValue = Number(pnlCorrectRows[0].realized_pnl_usd || 0);
      const directValue = Number(directSumData[0].total_realized_pnl);

      console.log(`\nwallet_pnl_correct.realized_pnl_usd: $${aggregateValue.toFixed(2)}`);
      console.log(`trades_raw sum(realized_pnl_usd):     $${directValue.toFixed(2)}`);
      console.log(`Difference:                           $${(aggregateValue - directValue).toFixed(2)}`);
      console.log(`Ratio:                                ${(aggregateValue / directValue).toFixed(4)}x`);

      if (Math.abs(aggregateValue + directValue) < 1) {
        console.log('\n⚠️  SIGN INVERSION DETECTED: Aggregate value is the NEGATIVE of direct sum!');
      }

      if (Math.abs(aggregateValue) > Math.abs(directValue) * 10) {
        console.log('\n⚠️  MAGNITUDE INFLATION: Aggregate value is 10x+ larger than expected!');
      }
    }

    // 7. Check source tables for aggregate views
    console.log('\n' + '─'.repeat(80));
    console.log('7. DATA LINEAGE ANALYSIS');
    console.log('─'.repeat(80));

    console.log('\nChecking what source tables the aggregate views use...');

    for (const table of tables) {
      if (table.engine.includes('View') || table.create_table_query.includes('SELECT')) {
        console.log(`\n${table.name} appears to be a view/materialized view.`);
        console.log('Source tables referenced in query:');

        // Extract table names from CREATE statement
        const sourceTableMatches = table.create_table_query.matchAll(/FROM\s+(\w+)/gi);
        const joinMatches = table.create_table_query.matchAll(/JOIN\s+(\w+)/gi);

        const sourceTables = new Set<string>();
        for (const match of sourceTableMatches) {
          sourceTables.add(match[1]);
        }
        for (const match of joinMatches) {
          sourceTables.add(match[1]);
        }

        sourceTables.forEach(t => console.log(`  - ${t}`));
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log('INVESTIGATION COMPLETE');
    console.log('='.repeat(80));

  } catch (error) {
    console.error('\n❌ Error during investigation:', error);
    if (error instanceof Error) {
      console.error('   Message:', error.message);
      console.error('   Stack:', error.stack);
    }
    process.exit(1);
  }
}

// Run investigation
investigateDiscrepancy()
  .then(() => {
    console.log('\n✅ Investigation completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Investigation failed:', error);
    process.exit(1);
  });
