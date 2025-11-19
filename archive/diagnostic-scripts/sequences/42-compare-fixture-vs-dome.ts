/**
 * 42: COMPARE FIXTURE VS DOME API
 *
 * External validation: Compare our Track A fixture P&L against Dome API's
 * reported P&L for the same wallets.
 *
 * This tests whether our internally consistent P&L matches external ground truth.
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

const SNAPSHOT_TS = '2025-10-15 00:00:00';
const SNAPSHOT_UNIX = Math.floor(new Date(SNAPSHOT_TS).getTime() / 1000);

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

interface WalletComparison {
  wallet: string;
  fixture_pnl: number;
  dome_pnl: number | null;
  delta: number | null;
  percent_error: number | null;
  dome_status: string;
}

/**
 * Fetch Dome API P&L for a wallet
 */
async function fetchDomePnL(wallet: string): Promise<number | null> {
  try {
    console.log(`  🌐 Fetching Dome data for ${wallet.substring(0, 12)}...`);

    const response = await fetch(
      `https://api.domeapi.io/v1/polymarket/wallet/pnl/${wallet}?granularity=all`
    );

    if (!response.ok) {
      console.log(`     ⚠️  Dome API returned ${response.status}`);
      return null;
    }

    const data = await response.json() as {
      granularity: string;
      start_time: number;
      end_time: number;
      wallet_address: string;
      pnl_over_time: Array<{
        timestamp: number;
        pnl_to_date: number;
      }>;
    };

    // Find the data point closest to (but not after) our snapshot timestamp
    const relevantPoints = data.pnl_over_time
      .filter(p => p.timestamp <= SNAPSHOT_UNIX)
      .sort((a, b) => b.timestamp - a.timestamp);

    if (relevantPoints.length === 0) {
      console.log(`     ⚠️  No Dome data before snapshot timestamp`);
      return null;
    }

    const closestPoint = relevantPoints[0];
    const timeDiff = SNAPSHOT_UNIX - closestPoint.timestamp;
    const daysDiff = timeDiff / 86400;

    console.log(`     ✅ Dome P&L: $${closestPoint.pnl_to_date.toFixed(2)} (${daysDiff.toFixed(1)} days before snapshot)`);

    return closestPoint.pnl_to_date;
  } catch (error) {
    console.log(`     ❌ Error fetching Dome data: ${error}`);
    return null;
  }
}

/**
 * Calculate our total realized P&L for a wallet up to snapshot
 */
async function calculateOurPnL(wallet: string): Promise<number> {
  // Query all fills for this wallet up to snapshot
  const query = await clickhouse.query({
    query: `
      SELECT
        asset_id,
        side,
        size,
        price,
        timestamp
      FROM clob_fills
      WHERE user_eoa = '${wallet}'
        AND timestamp <= '${SNAPSHOT_TS}'
      ORDER BY timestamp ASC
    `,
    format: 'JSONEachRow'
  });

  const fills: any[] = await query.json();

  // Calculate realized P&L using FIFO (same logic as script 41)
  const positions = new Map<string, {
    netSize: number;
    costBasis: number;
  }>();

  let totalRealizedPnL = 0;

  for (const fill of fills) {
    const assetId = fill.asset_id;
    const size = parseFloat(fill.size);
    const price = parseFloat(fill.price);

    if (!positions.has(assetId)) {
      positions.set(assetId, {
        netSize: 0,
        costBasis: 0
      });
    }

    const pos = positions.get(assetId)!;

    if (fill.side === 'BUY') {
      pos.netSize += size;
      pos.costBasis += size * price;
    } else {
      // SELL
      const avgCost = pos.netSize > 0 ? pos.costBasis / pos.netSize : 0;
      const saleRevenue = size * price;
      const saleCost = size * avgCost;
      const realizedPnL = saleRevenue - saleCost;

      totalRealizedPnL += realizedPnL;

      pos.netSize -= size;
      pos.costBasis = Math.max(0, pos.netSize * avgCost);
    }
  }

  // Add settled positions (positions that resolved)
  // Query resolutions for this wallet's positions
  const resolutionQuery = await clickhouse.query({
    query: `
      WITH wallet_positions AS (
        SELECT DISTINCT
          asset_id
        FROM clob_fills
        WHERE user_eoa = '${wallet}'
          AND timestamp <= '${SNAPSHOT_TS}'
      )
      SELECT
        wp.asset_id,
        ctm.condition_id_norm,
        mr.winning_index,
        mr.payout_numerators,
        mr.resolved_at
      FROM wallet_positions wp
      INNER JOIN ctf_token_map ctm ON ctm.token_id = wp.asset_id
      LEFT JOIN market_resolutions_final mr ON mr.condition_id_norm = ctm.condition_id_norm
      WHERE mr.resolved_at IS NOT NULL
        AND mr.resolved_at <= '${SNAPSHOT_TS}'
    `,
    format: 'JSONEachRow'
  });

  const resolutions: any[] = await resolutionQuery.json();

  // Add settlement P&L for resolved positions
  for (const res of resolutions) {
    const pos = positions.get(res.asset_id);
    if (!pos || pos.netSize <= 0) continue;

    // Determine payout based on winning index
    // For simplicity, assume binary markets with payout_numerators [0, 1] or [1, 0]
    const winningPayout = res.payout_numerators[res.winning_index] || 0;
    const settlementValue = pos.netSize * winningPayout;
    const settlementPnL = settlementValue - pos.costBasis;

    totalRealizedPnL += settlementPnL;
  }

  return totalRealizedPnL;
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('42: COMPARE FIXTURE VS DOME API');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log(`Snapshot timestamp: ${SNAPSHOT_TS}`);
  console.log(`Snapshot unix: ${SNAPSHOT_UNIX}\n`);

  // Load fixture
  const fixturePath = resolve(process.cwd(), 'fixture_track_a_final.json');
  const fixtureData = readFileSync(fixturePath, 'utf-8');
  const fixture: FixtureRow[] = JSON.parse(fixtureData);

  console.log(`Loaded ${fixture.length} rows from fixture\n`);

  // Get unique wallets with resolved positions
  const resolvedPositions = fixture.filter(r => r.status !== 'OPEN');
  const wallets = [...new Set(resolvedPositions.map(r => r.wallet))];

  console.log(`Found ${wallets.length} unique wallets with resolved positions\n`);

  // For each wallet, aggregate fixture P&L and compare with Dome
  console.log('📊 Comparing P&L by wallet...\n');

  const comparisons: WalletComparison[] = [];

  for (const wallet of wallets) {
    console.log(`\n💼 Wallet: ${wallet}`);

    // Calculate fixture P&L (sum of all realized_pnl for this wallet)
    const walletPositions = resolvedPositions.filter(r => r.wallet === wallet);
    const fixturePnL = walletPositions.reduce((sum, pos) => sum + (pos.realized_pnl || 0), 0);

    console.log(`   Our fixture P&L: $${fixturePnL.toFixed(2)} (from ${walletPositions.length} positions)`);

    // Fetch Dome P&L
    const domePnL = await fetchDomePnL(wallet);

    let delta: number | null = null;
    let percentError: number | null = null;
    let domeStatus = 'Success';

    if (domePnL === null) {
      domeStatus = 'API Error';
    } else {
      delta = fixturePnL - domePnL;
      percentError = domePnL !== 0 ? Math.abs(delta / domePnL) * 100 : 0;

      console.log(`   Delta: $${delta.toFixed(2)} (${percentError.toFixed(2)}%)`);
    }

    comparisons.push({
      wallet,
      fixture_pnl: fixturePnL,
      dome_pnl: domePnL,
      delta,
      percent_error: percentError,
      dome_status: domeStatus
    });

    // Add delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // Summary
  console.log('\n\n═══════════════════════════════════════════════════════════');
  console.log('COMPARISON RESULTS');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.table(comparisons.map(c => ({
    wallet: c.wallet.substring(0, 12) + '...',
    fixture_pnl: c.fixture_pnl.toFixed(2),
    dome_pnl: c.dome_pnl ? c.dome_pnl.toFixed(2) : 'N/A',
    delta: c.delta ? c.delta.toFixed(2) : 'N/A',
    pct_error: c.percent_error ? c.percent_error.toFixed(2) + '%' : 'N/A',
    status: c.dome_status
  })));

  // Statistics
  const successfulComparisons = comparisons.filter(c => c.dome_pnl !== null);

  if (successfulComparisons.length > 0) {
    const deltas = successfulComparisons.map(c => Math.abs(c.delta!));
    const percentErrors = successfulComparisons.map(c => c.percent_error!);

    const maxDelta = Math.max(...deltas);
    const maxPercentError = Math.max(...percentErrors);
    const meanDelta = deltas.reduce((a, b) => a + b, 0) / deltas.length;
    const meanPercentError = percentErrors.reduce((a, b) => a + b, 0) / percentErrors.length;

    const perfectMatches = successfulComparisons.filter(c => Math.abs(c.delta!) < 0.01).length;
    const withinTolerance = successfulComparisons.filter(c => c.percent_error! < 5.0).length;

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('SUMMARY STATISTICS');
    console.log('═══════════════════════════════════════════════════════════\n');

    console.log(`Total wallets: ${wallets.length}`);
    console.log(`Successful comparisons: ${successfulComparisons.length}`);
    console.log(`Failed (Dome API error): ${wallets.length - successfulComparisons.length}`);
    console.log('');
    console.log(`Perfect matches (delta < $0.01): ${perfectMatches}`);
    console.log(`Within 5% tolerance: ${withinTolerance}`);
    console.log('');
    console.log(`Max absolute delta: $${maxDelta.toFixed(2)}`);
    console.log(`Max percent error: ${maxPercentError.toFixed(2)}%`);
    console.log(`Mean absolute delta: $${meanDelta.toFixed(2)}`);
    console.log(`Mean percent error: ${meanPercentError.toFixed(2)}%`);
    console.log('');

    if (perfectMatches === successfulComparisons.length) {
      console.log('✅ PERFECT MATCH: All wallets match Dome exactly!');
    } else if (withinTolerance === successfulComparisons.length) {
      console.log('✅ PASS: All wallets within acceptable tolerance (<5% error)');
    } else if (meanPercentError < 10.0) {
      console.log('⚠️  WARNING: Some discrepancies but mean error is reasonable');
    } else {
      console.log('❌ FAIL: Significant discrepancies detected');
    }
    console.log('');
  } else {
    console.log('\n❌ No successful Dome API comparisons\n');
  }
}

main().catch(console.error);
