/**
 * Coverage Scorecard - Diagnose why wallets are missing from V6
 *
 * For each INPUT_DATA_GAP wallet, determines root cause:
 * - FILTER_OR_MAPPING_LOSS: Has V6 rows but condition_id empty or source_type mismatch
 * - PROXY_ADDRESS: May be trading under different address
 * - NON_CLOB_HISTORY_REQUIRED: Traded via AMM/FPMM not in CLOB pipeline
 * - INVALID_BENCHMARK: Address doesn't exist in any data source
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { getClickHouseClient } from '../../lib/clickhouse/client';

interface CoverageScore {
  wallet: string;
  ui_pnl: number;
  v6_rows_total: number;
  v6_rows_clob: number;
  v6_rows_clob_with_condition: number;
  v6_source_types: string[];
  v6_empty_condition_count: number;
  raw_events_count: number;
  erc1155_count: number;
  max_event_time: string | null;
  staleness_hours: number | null;
  root_cause: string;
  recommendation: string;
}

async function main() {
  const client = getClickHouseClient();

  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║   COVERAGE SCORECARD - INPUT_DATA_GAP ANALYSIS                             ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝\n');

  // Get INPUT_DATA_GAP wallets from benchmarks
  // These are wallets with PnL in benchmark but no/low V6 coverage
  const benchmarkQuery = `
    SELECT DISTINCT
      lower(wallet) as wallet,
      pnl_value as ui_pnl
    FROM pm_ui_pnl_benchmarks_v1
    WHERE pnl_value IS NOT NULL
    ORDER BY abs(pnl_value) DESC
  `;

  const benchResult = await client.query({ query: benchmarkQuery, format: 'JSONEachRow' });
  const benchmarks = (await benchResult.json()) as Array<{ wallet: string; ui_pnl: number }>;

  console.log(`Analyzing ${benchmarks.length} benchmark wallets...\n`);

  const results: CoverageScore[] = [];

  for (let i = 0; i < benchmarks.length; i++) {
    const b = benchmarks[i];
    process.stdout.write(`\r[${i + 1}/${benchmarks.length}] Scoring...`);

    // V6 total rows
    const v6TotalResult = await client.query({
      query: `SELECT count() as cnt FROM pm_unified_ledger_v6 WHERE lower(wallet_address) = lower('${b.wallet}')`,
      format: 'JSONEachRow',
    });
    const v6Total = Number((await v6TotalResult.json())[0]?.cnt || 0);

    // V6 CLOB rows
    const v6ClobResult = await client.query({
      query: `SELECT count() as cnt FROM pm_unified_ledger_v6 WHERE lower(wallet_address) = lower('${b.wallet}') AND source_type = 'CLOB'`,
      format: 'JSONEachRow',
    });
    const v6Clob = Number((await v6ClobResult.json())[0]?.cnt || 0);

    // V6 CLOB with condition_id
    const v6ClobCondResult = await client.query({
      query: `SELECT count() as cnt FROM pm_unified_ledger_v6 WHERE lower(wallet_address) = lower('${b.wallet}') AND source_type = 'CLOB' AND condition_id IS NOT NULL AND condition_id != ''`,
      format: 'JSONEachRow',
    });
    const v6ClobCond = Number((await v6ClobCondResult.json())[0]?.cnt || 0);

    // V6 source types
    const v6SourcesResult = await client.query({
      query: `SELECT DISTINCT source_type FROM pm_unified_ledger_v6 WHERE lower(wallet_address) = lower('${b.wallet}')`,
      format: 'JSONEachRow',
    });
    const v6Sources = ((await v6SourcesResult.json()) as Array<{ source_type: string }>).map((r) => r.source_type);

    // V6 empty condition count
    const v6EmptyCondResult = await client.query({
      query: `SELECT count() as cnt FROM pm_unified_ledger_v6 WHERE lower(wallet_address) = lower('${b.wallet}') AND (condition_id IS NULL OR condition_id = '')`,
      format: 'JSONEachRow',
    });
    const v6EmptyCond = Number((await v6EmptyCondResult.json())[0]?.cnt || 0);

    // Raw events count
    const rawResult = await client.query({
      query: `SELECT count() as cnt FROM pm_trader_events_v2 WHERE lower(trader_wallet) = lower('${b.wallet}')`,
      format: 'JSONEachRow',
    });
    const rawCount = Number((await rawResult.json())[0]?.cnt || 0);

    // ERC1155 count
    const erc1155Result = await client.query({
      query: `SELECT count() as cnt FROM pm_erc1155_transfers WHERE lower(from_address) = lower('${b.wallet}') OR lower(to_address) = lower('${b.wallet}')`,
      format: 'JSONEachRow',
    });
    const erc1155Count = Number((await erc1155Result.json())[0]?.cnt || 0);

    // Max event time and staleness
    let maxEventTime: string | null = null;
    let stalenessHours: number | null = null;
    if (v6Total > 0) {
      const maxTimeResult = await client.query({
        query: `SELECT max(event_time) as max_time FROM pm_unified_ledger_v6 WHERE lower(wallet_address) = lower('${b.wallet}')`,
        format: 'JSONEachRow',
      });
      const maxTimeRow = (await maxTimeResult.json())[0] as { max_time: string } | undefined;
      if (maxTimeRow?.max_time) {
        maxEventTime = maxTimeRow.max_time;
        const maxDate = new Date(maxEventTime);
        stalenessHours = Math.round((Date.now() - maxDate.getTime()) / (1000 * 60 * 60));
      }
    }

    // Determine root cause
    let rootCause: string;
    let recommendation: string;

    if (v6Total === 0 && rawCount === 0 && erc1155Count === 0) {
      rootCause = 'INVALID_BENCHMARK';
      recommendation = 'Address not found in any data source - verify benchmark validity';
    } else if (v6Total === 0 && (rawCount > 0 || erc1155Count > 0)) {
      rootCause = 'NON_CLOB_HISTORY_REQUIRED';
      recommendation = `Has ${rawCount} raw events, ${erc1155Count} ERC1155 - needs non-CLOB pipeline`;
    } else if (v6Clob === 0 && v6Total > 0) {
      rootCause = 'FILTER_OR_MAPPING_LOSS';
      recommendation = `Has ${v6Total} V6 rows but 0 CLOB - check source_types: ${v6Sources.join(', ')}`;
    } else if (v6ClobCond === 0 && v6Clob > 0) {
      rootCause = 'FILTER_OR_MAPPING_LOSS';
      recommendation = `Has ${v6Clob} CLOB rows but 0 with condition_id - needs token mapping`;
    } else if (v6EmptyCond > v6ClobCond * 0.2) {
      rootCause = 'FILTER_OR_MAPPING_LOSS';
      recommendation = `${v6EmptyCond} rows missing condition_id (${Math.round((v6EmptyCond / v6Total) * 100)}%) - improve token mapping`;
    } else {
      rootCause = 'OK';
      recommendation = 'Coverage looks good';
    }

    results.push({
      wallet: b.wallet,
      ui_pnl: b.ui_pnl,
      v6_rows_total: v6Total,
      v6_rows_clob: v6Clob,
      v6_rows_clob_with_condition: v6ClobCond,
      v6_source_types: v6Sources,
      v6_empty_condition_count: v6EmptyCond,
      raw_events_count: rawCount,
      erc1155_count: erc1155Count,
      max_event_time: maxEventTime,
      staleness_hours: stalenessHours,
      root_cause: rootCause,
      recommendation,
    });
  }

  console.log('\n\n');

  // Summary by root cause
  const byCause = {
    OK: results.filter((r) => r.root_cause === 'OK'),
    FILTER_OR_MAPPING_LOSS: results.filter((r) => r.root_cause === 'FILTER_OR_MAPPING_LOSS'),
    NON_CLOB_HISTORY_REQUIRED: results.filter((r) => r.root_cause === 'NON_CLOB_HISTORY_REQUIRED'),
    INVALID_BENCHMARK: results.filter((r) => r.root_cause === 'INVALID_BENCHMARK'),
  };

  console.log('════════════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('COVERAGE SUMMARY');
  console.log('════════════════════════════════════════════════════════════════════════════════════════════════════\n');

  console.log(`Total wallets: ${results.length}\n`);

  console.log('Coverage Breakdown:');
  console.log('────────────────────────────────────────');
  console.log(`  ✅ OK:                       ${byCause.OK.length} (${Math.round((byCause.OK.length / results.length) * 100)}%)`);
  console.log(`  🔧 FILTER_OR_MAPPING_LOSS:   ${byCause.FILTER_OR_MAPPING_LOSS.length} (${Math.round((byCause.FILTER_OR_MAPPING_LOSS.length / results.length) * 100)}%)`);
  console.log(`  📦 NON_CLOB_HISTORY_REQUIRED: ${byCause.NON_CLOB_HISTORY_REQUIRED.length} (${Math.round((byCause.NON_CLOB_HISTORY_REQUIRED.length / results.length) * 100)}%)`);
  console.log(`  ❌ INVALID_BENCHMARK:         ${byCause.INVALID_BENCHMARK.length} (${Math.round((byCause.INVALID_BENCHMARK.length / results.length) * 100)}%)`);

  // Show problematic wallets
  const problematic = results.filter((r) => r.root_cause !== 'OK');

  if (problematic.length > 0) {
    console.log('\n════════════════════════════════════════════════════════════════════════════════════════════════════');
    console.log('WALLETS NEEDING ATTENTION');
    console.log('════════════════════════════════════════════════════════════════════════════════════════════════════\n');

    for (const r of problematic.slice(0, 30)) {
      const pnlStr = '$' + r.ui_pnl.toLocaleString(undefined, { maximumFractionDigits: 0 });
      console.log(`${r.wallet}`);
      console.log(`  UI PnL: ${pnlStr.padEnd(15)} | V6: ${r.v6_rows_total} (CLOB: ${r.v6_rows_clob}, w/cond: ${r.v6_rows_clob_with_condition})`);
      console.log(`  Raw: ${r.raw_events_count} | ERC1155: ${r.erc1155_count} | Sources: ${r.v6_source_types.join(', ') || 'none'}`);
      console.log(`  ROOT CAUSE: ${r.root_cause}`);
      console.log(`  → ${r.recommendation}\n`);
    }
  }

  // Actionable summary
  console.log('════════════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('ACTIONABLE ROADMAP');
  console.log('════════════════════════════════════════════════════════════════════════════════════════════════════\n');

  if (byCause.FILTER_OR_MAPPING_LOSS.length > 0) {
    console.log(`🔧 FILTER_OR_MAPPING_LOSS (${byCause.FILTER_OR_MAPPING_LOSS.length} wallets):`);
    console.log('   - Check if non-CLOB source_types should contribute to PnL');
    console.log('   - Improve token → condition_id mapping for empty condition_id rows');
    console.log('   - This is the highest-leverage fix\n');
  }

  if (byCause.NON_CLOB_HISTORY_REQUIRED.length > 0) {
    console.log(`📦 NON_CLOB_HISTORY_REQUIRED (${byCause.NON_CLOB_HISTORY_REQUIRED.length} wallets):`);
    console.log('   - These wallets have raw/ERC1155 data but not in V6');
    console.log('   - May need AMM/FPMM trade ingestion or ERC1155 redemption handling\n');
  }

  if (byCause.INVALID_BENCHMARK.length > 0) {
    console.log(`❌ INVALID_BENCHMARK (${byCause.INVALID_BENCHMARK.length} wallets):`);
    console.log('   - No data in any source - likely bad benchmark data');
    console.log('   - Exclude from validation scoring\n');
  }
}

main().catch(console.error);
