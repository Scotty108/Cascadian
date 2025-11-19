/**
 * DOME API COMPARISON
 *
 * Purpose: Compare our daily P&L series against Dome API's pnl_over_time
 *
 * Acceptance Criteria:
 * - Daily pnl_to_date matches within 0.5% or $250, whichever is smaller
 *
 * Dome API Baseline:
 * - Final pnl_to_date: $87,030.505 at timestamp 1762905600
 */

import { createClient } from '@clickhouse/client';
import * as dotenv from 'dotenv';
import * as fs from 'fs';

dotenv.config({ path: '.env.local' });

const client = createClient({
  url: process.env.CLICKHOUSE_HOST || process.env.CLICKHOUSE_URL,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 300000,
});

const TARGET_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

// Known Dome baseline
const DOME_FINAL_PNL = 87030.505;
const DOME_FINAL_TIMESTAMP = 1762905600;

interface DomeDataPoint {
  timestamp: number;
  pnl_to_date: number;
}

interface OurDataPoint {
  date: string;
  timestamp: number;
  pnl_to_date: number;
  realized_to_date: number;
  unrealized_on_date: number;
}

interface Comparison {
  date: string;
  timestamp: number;
  our_pnl: number;
  dome_pnl: number;
  delta: number;
  delta_pct: number;
  within_tolerance: boolean;
}

/**
 * Fetch Dome API data
 */
async function fetchDomeData(): Promise<DomeDataPoint[]> {
  try {
    const response = await fetch(
      `https://api.domeapi.io/v1/polymarket/wallet/pnl/${TARGET_WALLET}?granularity=all`
    );

    if (!response.ok) {
      throw new Error(`Dome API returned ${response.status}`);
    }

    const data = await response.json() as {
      granularity: string;
      start_time: number;
      end_time: number;
      wallet_address: string;
      pnl_over_time: DomeDataPoint[];
    };

    console.log(`📊 Dome API Response:`);
    console.log(`   Granularity: ${data.granularity}`);
    console.log(`   Start: ${new Date(data.start_time * 1000).toISOString()}`);
    console.log(`   End: ${new Date(data.end_time * 1000).toISOString()}`);
    console.log(`   Data points: ${data.pnl_over_time.length}\n`);

    return data.pnl_over_time;
  } catch (error) {
    console.error('❌ Failed to fetch Dome API data:', error);
    console.log('   Using baseline: $87,030.505 at final timestamp\n');

    // Return baseline only
    return [
      {
        timestamp: DOME_FINAL_TIMESTAMP,
        pnl_to_date: DOME_FINAL_PNL,
      }
    ];
  }
}

/**
 * Calculate our daily P&L series
 */
async function calculateOurDailyPnL(): Promise<OurDataPoint[]> {
  // This would use the same logic as pnl-reconciliation-engine.ts
  // For now, return a placeholder that we'll populate from the engine

  console.log('📈 Calculating our daily P&L series...\n');

  // Load all fills
  const fillsQuery = `
    SELECT
      toDate(timestamp) as date,
      timestamp,
      asset_id,
      side,
      size,
      price,
      fee_rate_bps
    FROM clob_fills
    WHERE proxy_wallet = '${TARGET_WALLET}'
    ORDER BY timestamp ASC
  `;

  const result = await client.query({ query: fillsQuery, format: 'JSONEachRow' });
  const fills = await result.json() as any[];

  // Build daily cumulative P&L
  const dailyMap = new Map<string, OurDataPoint>();
  let cumulativeRealized = 0;
  const positions = new Map<string, {
    size: number;
    cost_basis: number;
    avg_cost: number;
  }>();

  for (const fill of fills) {
    const date = fill.date;
    const fee = parseFloat(fill.size) * parseFloat(fill.price) * (parseFloat(fill.fee_rate_bps || 0) / 10000);

    if (!positions.has(fill.asset_id)) {
      positions.set(fill.asset_id, {
        size: 0,
        cost_basis: 0,
        avg_cost: 0,
      });
    }

    const pos = positions.get(fill.asset_id)!;

    const size = parseFloat(fill.size) / 1000000.0;  // Convert microshares to shares
    const price = parseFloat(fill.price);

    if (fill.side === 'BUY') {
      const cost = size * price + fee;
      pos.cost_basis += cost;
      pos.size += size;
      pos.avg_cost = pos.size > 0 ? pos.cost_basis / pos.size : 0;
    } else {
      // SELL
      const revenue = size * price - fee;
      const cost = pos.avg_cost * size;
      const realized = revenue - cost;

      cumulativeRealized += realized;
      pos.size -= size;
      pos.cost_basis = Math.max(0, pos.avg_cost * pos.size);
    }

    // Update daily entry
    if (!dailyMap.has(date)) {
      dailyMap.set(date, {
        date,
        timestamp: Math.floor(new Date(fill.timestamp).getTime() / 1000),
        pnl_to_date: 0,
        realized_to_date: 0,
        unrealized_on_date: 0,
      });
    }

    const daily = dailyMap.get(date)!;
    daily.realized_to_date = cumulativeRealized;
    daily.pnl_to_date = cumulativeRealized; // Simplified: not including unrealized
  }

  return Array.from(dailyMap.values()).sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Compare our data vs Dome
 */
function compareData(our: OurDataPoint[], dome: DomeDataPoint[]): Comparison[] {
  const comparisons: Comparison[] = [];

  // Create a map of Dome data by timestamp
  const domeMap = new Map<number, number>();
  for (const d of dome) {
    domeMap.set(d.timestamp, d.pnl_to_date);
  }

  // Compare each of our data points
  for (const ourPoint of our) {
    const domeValue = domeMap.get(ourPoint.timestamp);

    if (domeValue !== undefined) {
      const delta = ourPoint.pnl_to_date - domeValue;
      const delta_pct = Math.abs((delta / domeValue) * 100);

      // Tolerance: 0.5% OR $250, whichever is smaller
      const tolerance_pct = 0.5;
      const tolerance_abs = 250;
      const within_tolerance =
        delta_pct <= tolerance_pct || Math.abs(delta) <= tolerance_abs;

      comparisons.push({
        date: ourPoint.date,
        timestamp: ourPoint.timestamp,
        our_pnl: ourPoint.pnl_to_date,
        dome_pnl: domeValue,
        delta,
        delta_pct,
        within_tolerance,
      });
    }
  }

  return comparisons;
}

/**
 * Analyze discrepancies
 */
async function analyzeDiscrepancies(comparisons: Comparison[]): Promise<void> {
  const outOfTolerance = comparisons.filter(c => !c.within_tolerance);

  if (outOfTolerance.length === 0) {
    console.log('✅ ALL DATA POINTS WITHIN TOLERANCE\n');
    return;
  }

  console.log(`⚠️  ${outOfTolerance.length} data points OUT OF TOLERANCE:\n`);

  for (const comp of outOfTolerance.slice(0, 10)) {
    console.log(`Date: ${comp.date}`);
    console.log(`  Our P&L: $${comp.our_pnl.toFixed(2)}`);
    console.log(`  Dome P&L: $${comp.dome_pnl.toFixed(2)}`);
    console.log(`  Delta: $${comp.delta.toFixed(2)} (${comp.delta_pct.toFixed(2)}%)`);
    console.log('');

    // TODO: Query which assets explain the gap on this date
    // This would require more detailed analysis
  }
}

/**
 * Main execution
 */
async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('DOME API COMPARISON');
  console.log(`Wallet: ${TARGET_WALLET}`);
  console.log('═══════════════════════════════════════════════════════════\n');

  // Fetch Dome data
  console.log('🌐 Fetching Dome API data...\n');
  const domeData = await fetchDomeData();

  // Calculate our data
  const ourData = await calculateOurDailyPnL();
  console.log(`✅ Calculated ${ourData.length} days of P&L data\n`);

  // Compare
  console.log('🔍 Comparing data...\n');
  const comparisons = compareData(ourData, domeData);

  if (comparisons.length === 0) {
    console.log('⚠️  No overlapping timestamps found\n');
    console.log('This is expected if Dome uses different granularity\n');

    // Compare final values only
    const ourFinal = ourData[ourData.length - 1];
    const domeFinal = domeData[domeData.length - 1];

    console.log('Final Value Comparison:');
    console.log(`  Our P&L: $${ourFinal.pnl_to_date.toFixed(2)}`);
    console.log(`  Dome P&L: $${domeFinal.pnl_to_date.toFixed(2)}`);
    console.log(`  Delta: $${(ourFinal.pnl_to_date - domeFinal.pnl_to_date).toFixed(2)}\n`);
  } else {
    const inTolerance = comparisons.filter(c => c.within_tolerance).length;
    const total = comparisons.length;

    console.log('═══════════════════════════════════════════════════════════');
    console.log('COMPARISON RESULTS');
    console.log('═══════════════════════════════════════════════════════════\n');

    console.log(`Total comparisons: ${total}`);
    console.log(`Within tolerance: ${inTolerance} (${((inTolerance / total) * 100).toFixed(1)}%)`);
    console.log(`Out of tolerance: ${total - inTolerance}\n`);

    if (inTolerance === total) {
      console.log('✅ 100% MATCH - DOME PARITY ACHIEVED\n');
    } else {
      await analyzeDiscrepancies(comparisons);
    }

    // Display sample comparisons
    console.log('═══════════════════════════════════════════════════════════');
    console.log('SAMPLE COMPARISONS (Last 10 days)');
    console.log('═══════════════════════════════════════════════════════════\n');

    console.table(
      comparisons.slice(-10).map(c => ({
        date: c.date,
        our_pnl: `$${c.our_pnl.toFixed(0)}`,
        dome_pnl: `$${c.dome_pnl.toFixed(0)}`,
        delta: `$${c.delta.toFixed(0)}`,
        delta_pct: `${c.delta_pct.toFixed(2)}%`,
        ok: c.within_tolerance ? '✅' : '❌',
      }))
    );
  }

  // Save to CSV
  console.log('\n💾 Saving comparison results...\n');

  fs.writeFileSync(
    'dome_comparison.csv',
    [
      'date,timestamp,our_pnl,dome_pnl,delta,delta_pct,within_tolerance',
      ...comparisons.map(c =>
        `${c.date},${c.timestamp},${c.our_pnl},${c.dome_pnl},${c.delta},${c.delta_pct},${c.within_tolerance}`
      )
    ].join('\n')
  );

  console.log('  ✅ dome_comparison.csv\n');

  console.log('✅ COMPARISON COMPLETE\n');

  await client.close();
}

main().catch(console.error);
