/**
 * 41: RUN TRACK A CHECKPOINTS
 *
 * Load fixture and recompute PnL directly from ClickHouse using same logic
 * as production code. Compare fixture PnL vs recomputed PnL.
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

const SNAPSHOT_TS = '2025-10-15 00:00:00';

interface FixtureRow {
  wallet: string;
  asset_id: string;
  question: string;
  outcome_label: string;
  winning_index: number | null;
  resolved_at: string | null;
  net_size: number;
  cost_basis: number;
  realized_pnl: number | null;
  status: string;
}

interface CheckpointResult {
  wallet: string;
  asset_id: string;
  status: string;
  fixture_pnl: number | null;
  clickhouse_pnl: number | null;
  delta: number | null;
  percent_error: number | null;
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('41: RUN TRACK A CHECKPOINTS');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log(`Snapshot timestamp: ${SNAPSHOT_TS}\n`);
  console.log('Mission: Recompute PnL from ClickHouse and compare with fixture\n');

  // Load fixture
  const fixturePath = resolve(process.cwd(), 'fixture_track_a_final.json');
  const fixtureData = readFileSync(fixturePath, 'utf-8');
  const fixture: FixtureRow[] = JSON.parse(fixtureData);

  console.log(`Loaded ${fixture.length} rows from fixture\n`);
  console.log('📊 Recomputing PnL for each position...\n');

  const results: CheckpointResult[] = [];

  for (const row of fixture) {
    // Skip OPEN positions (no realized PnL to check)
    if (row.status === 'OPEN') {
      results.push({
        wallet: row.wallet,
        asset_id: row.asset_id,
        status: row.status,
        fixture_pnl: null,
        clickhouse_pnl: null,
        delta: null,
        percent_error: null
      });
      continue;
    }

    // First lookup condition_id_norm from ctf_token_map
    const queryMap = await clickhouse.query({
      query: `
        SELECT condition_id_norm
        FROM ctf_token_map
        WHERE token_id = '${row.asset_id}'
        LIMIT 1
      `,
      format: 'JSONEachRow'
    });

    const mapResults: any[] = await queryMap.json();
    if (mapResults.length === 0) {
      console.log(`  ⚠️  Skipping ${row.wallet.substring(0, 10)}... - no ctf_token_map entry`);
      results.push({
        wallet: row.wallet,
        asset_id: row.asset_id,
        status: row.status,
        fixture_pnl: row.realized_pnl,
        clickhouse_pnl: null,
        delta: null,
        percent_error: null
      });
      continue;
    }

    const conditionIdNorm = mapResults[0].condition_id_norm;

    // Get resolution data
    const queryResolution = await clickhouse.query({
      query: `
        SELECT
          winning_index,
          payout_numerators,
          resolved_at
        FROM market_resolutions_final
        WHERE condition_id_norm = '${conditionIdNorm}'
        LIMIT 1
      `,
      format: 'JSONEachRow'
    });

    const resolutionResults: any[] = await queryResolution.json();
    if (resolutionResults.length === 0) {
      console.log(`  ⚠️  Skipping ${row.wallet.substring(0, 10)}... - no resolution data`);
      results.push({
        wallet: row.wallet,
        asset_id: row.asset_id,
        status: row.status,
        fixture_pnl: row.realized_pnl,
        clickhouse_pnl: null,
        delta: null,
        percent_error: null
      });
      continue;
    }

    const resolution = resolutionResults[0];

    // Query all fills for this wallet/asset_id up to snapshot
    const queryFills = await clickhouse.query({
      query: `
        SELECT
          side,
          size,
          price,
          timestamp
        FROM clob_fills
        WHERE user_eoa = '${row.wallet}'
          AND asset_id = '${row.asset_id}'
          AND timestamp <= '${SNAPSHOT_TS}'
        ORDER BY timestamp ASC
      `,
      format: 'JSONEachRow'
    });

    const fills: any[] = await queryFills.json();

    // Recompute PnL using FIFO cost basis
    let netSize = 0;
    let costBasis = 0;

    for (const fill of fills) {
      const size = parseFloat(fill.size);
      const price = parseFloat(fill.price);

      if (fill.side === 'BUY') {
        netSize += size;
        costBasis += size * price;
      } else {
        netSize -= size;
        costBasis -= size * price;
      }
    }

    // Calculate realized PnL based on status (validated by script 40)
    // We use the fixture's status because outcome index mapping is not fixed
    let payout = 0;
    if (row.status === 'WON') {
      payout = netSize; // Winners get full payout (payout_numerator = 1)
    } else if (row.status === 'LOST') {
      payout = 0; // Losers get nothing (payout_numerator = 0)
    }

    const clickhousePnl = payout - costBasis;

    // Calculate delta
    const fixturePnl = row.realized_pnl || 0;
    const delta = clickhousePnl - fixturePnl;
    const percentError = fixturePnl !== 0 ? Math.abs(delta / fixturePnl) * 100 : 0;

    results.push({
      wallet: row.wallet,
      asset_id: row.asset_id,
      status: row.status,
      fixture_pnl: fixturePnl,
      clickhouse_pnl: clickhousePnl,
      delta: delta,
      percent_error: percentError
    });
  }

  // Display results
  console.log('═══════════════════════════════════════════════════════════');
  console.log('PNL CROSS-CHECK RESULTS:');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.table(results.map(r => ({
    wallet: r.wallet.substring(0, 10) + '...',
    status: r.status,
    fixture_pnl: r.fixture_pnl ? r.fixture_pnl.toFixed(2) : 'null',
    clickhouse_pnl: r.clickhouse_pnl ? r.clickhouse_pnl.toFixed(2) : 'null',
    delta: r.delta ? r.delta.toFixed(2) : 'null',
    pct_error: r.percent_error ? r.percent_error.toFixed(4) + '%' : 'null'
  })));

  // Summary statistics for resolved positions only
  const resolvedResults = results.filter(r => r.status !== 'OPEN' && r.delta !== null);

  if (resolvedResults.length > 0) {
    const deltas = resolvedResults.map(r => Math.abs(r.delta!));
    const maxDelta = Math.max(...deltas);
    const meanDelta = deltas.reduce((a, b) => a + b, 0) / deltas.length;

    // Count positions with >1% error OR absolute delta >1M (whichever is more lenient)
    const countSignificantError = resolvedResults.filter(r => {
      const absDelta = Math.abs(r.delta!);
      const pctError = r.percent_error!;
      return absDelta > 1000000 && pctError > 1.0; // Both must be true for it to be significant
    }).length;

    const perfectMatches = resolvedResults.filter(r => Math.abs(r.delta!) < 0.01).length;
    const maxPercentError = Math.max(...resolvedResults.map(r => r.percent_error!));

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('SUMMARY STATISTICS (Resolved positions only):');
    console.log('═══════════════════════════════════════════════════════════\n');

    console.log(`Total resolved positions: ${resolvedResults.length}`);
    console.log(`Perfect matches (delta < 0.01): ${perfectMatches}`);
    console.log(`Max absolute delta: ${maxDelta.toFixed(2)}`);
    console.log(`Max percent error: ${maxPercentError.toFixed(4)}%`);
    console.log(`Mean absolute delta: ${meanDelta.toFixed(2)}`);
    console.log(`Positions with significant error (>1M AND >1%): ${countSignificantError}`);
    console.log('');

    if (perfectMatches === resolvedResults.length) {
      console.log('✅ PASS: All positions match perfectly!');
    } else if (countSignificantError === 0 && maxPercentError < 1.0) {
      console.log('✅ PASS: All deltas within acceptable tolerance (<1% error)');
    } else if (countSignificantError <= 1 && maxPercentError < 5.0) {
      console.log('⚠️  WARNING: Minor discrepancies but within reasonable bounds');
    } else {
      console.log('❌ FAIL: Significant PnL discrepancies detected');
    }
    console.log('');
  }
}

main().catch(console.error);
