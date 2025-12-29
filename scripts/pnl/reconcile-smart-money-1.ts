/**
 * Reconciliation Report - Smart Money 1
 *
 * Build a condition-level breakdown to find where the $615K gap comes from.
 * For each position, compare V13 realized PnL against alternative calculations.
 *
 * Goal: Find the specific markets that explain the gap, not just top winners/losers.
 */

import { createV13Engine } from '../../lib/pnl/uiActivityEngineV13';
import { clickhouse } from '../../lib/clickhouse/client';

const WALLET = '0x4ce73141dbfce41e65db3723e31059a730f0abad';
const UI_PNL = 332567; // Re-verified 2025-12-03

interface PositionComparison {
  condition_id: string;
  outcome_index: number;
  category: string;
  v13_pnl: number;
  clob_only_static_pnl: number;
  difference: number;
  is_resolved: boolean;
  resolution_payout: number | null;
  clob_buys: number;
  clob_sells: number;
  ctf_events: number;
}

async function main() {
  console.log('='.repeat(80));
  console.log('RECONCILIATION REPORT - SMART MONEY 1');
  console.log('='.repeat(80));
  console.log(`Wallet: ${WALLET}`);
  console.log(`Target UI PnL: $${UI_PNL.toLocaleString()}`);
  console.log('='.repeat(80));

  // Step 1: Get V13 positions
  console.log('\nStep 1: Computing V13 positions...');
  const engine = createV13Engine();
  const v13Result = await engine.compute(WALLET);

  console.log(`  V13 Total Realized PnL: $${v13Result.realized_pnl.toLocaleString()}`);
  console.log(`  V13 Positions: ${v13Result.positions.length}`);
  console.log(`  Gap from UI: $${(v13Result.realized_pnl - UI_PNL).toLocaleString()}`);

  // Step 2: Compute static CLOB-only aggregates per condition (no state machine)
  // This is a cross-check against the V13 state machine
  console.log('\nStep 2: Computing static CLOB-only aggregates...');

  const staticQuery = `
    WITH deduped AS (
      SELECT
        event_id,
        any(token_id) as token_id,
        any(side) as side,
        any(token_amount) / 1000000.0 as qty,
        any(usdc_amount) / 1000000.0 as usdc
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${WALLET}') AND is_deleted = 0
      GROUP BY event_id
    )
    SELECT
      m.condition_id,
      m.outcome_index,
      d.side,
      sum(d.qty) as total_qty,
      sum(d.usdc) as total_usdc,
      count() as trade_count
    FROM deduped d
    INNER JOIN pm_token_to_condition_map_v3 m ON d.token_id = m.token_id_dec
    GROUP BY m.condition_id, m.outcome_index, d.side
    ORDER BY m.condition_id, m.outcome_index, d.side
  `;

  const staticResult = await clickhouse.query({ query: staticQuery, format: 'JSONEachRow' });
  const staticRows = (await staticResult.json()) as any[];

  // Aggregate into positions
  const staticPositions = new Map<string, { buys: { qty: number; usdc: number; count: number }; sells: { qty: number; usdc: number; count: number } }>();
  for (const row of staticRows) {
    const key = `${row.condition_id}_${row.outcome_index}`;
    if (!staticPositions.has(key)) {
      staticPositions.set(key, {
        buys: { qty: 0, usdc: 0, count: 0 },
        sells: { qty: 0, usdc: 0, count: 0 },
      });
    }
    const pos = staticPositions.get(key)!;
    if (row.side === 'buy') {
      pos.buys.qty += Number(row.total_qty);
      pos.buys.usdc += Number(row.total_usdc);
      pos.buys.count += Number(row.trade_count);
    } else {
      pos.sells.qty += Number(row.total_qty);
      pos.sells.usdc += Number(row.total_usdc);
      pos.sells.count += Number(row.trade_count);
    }
  }

  // Step 3: Get resolutions
  console.log('\nStep 3: Loading resolutions...');
  const resQuery = `SELECT condition_id, payout_numerators FROM pm_condition_resolutions`;
  const resResult = await clickhouse.query({ query: resQuery, format: 'JSONEachRow' });
  const resRows = (await resResult.json()) as any[];
  const resolutions = new Map<string, number[]>();
  for (const r of resRows) {
    const payouts = r.payout_numerators ? JSON.parse(r.payout_numerators) : [];
    resolutions.set(r.condition_id.toLowerCase(), payouts);
  }

  // Step 4: Compute static PnL per position using simple formula
  // PnL = sells + resolution_proceeds - buys
  console.log('\nStep 4: Computing static PnL per position...');
  const comparisons: PositionComparison[] = [];

  for (const v13Pos of v13Result.positions) {
    const key = `${v13Pos.condition_id}_${v13Pos.outcome_index}`;
    const staticPos = staticPositions.get(key);

    // Compute static PnL
    let staticPnl = 0;
    let clobBuys = 0;
    let clobSells = 0;

    if (staticPos) {
      clobBuys = staticPos.buys.usdc;
      clobSells = staticPos.sells.usdc;

      // Trading PnL: sells - (sells_qty / buys_qty) * buys_cost
      if (staticPos.buys.qty > 0 && staticPos.sells.qty > 0) {
        const sellCostBasis = (staticPos.sells.qty / staticPos.buys.qty) * staticPos.buys.usdc;
        staticPnl += staticPos.sells.usdc - sellCostBasis;
      }

      // Resolution PnL for remaining position
      const remainingQty = staticPos.buys.qty - staticPos.sells.qty;
      if (remainingQty > 0.001) {
        const payouts = resolutions.get(v13Pos.condition_id.toLowerCase());
        if (payouts && payouts.length > v13Pos.outcome_index) {
          const payout = payouts[v13Pos.outcome_index];
          const avgCost = staticPos.buys.qty > 0 ? staticPos.buys.usdc / staticPos.buys.qty : 0;
          const resProceeds = remainingQty * payout;
          const resCost = remainingQty * avgCost;
          staticPnl += resProceeds - resCost;
        }
      }
    }

    const difference = v13Pos.realized_pnl - staticPnl;

    comparisons.push({
      condition_id: v13Pos.condition_id,
      outcome_index: v13Pos.outcome_index,
      category: v13Pos.category,
      v13_pnl: v13Pos.realized_pnl,
      clob_only_static_pnl: staticPnl,
      difference,
      is_resolved: v13Pos.is_resolved,
      resolution_payout: v13Pos.resolution_payout,
      clob_buys: clobBuys,
      clob_sells: clobSells,
      ctf_events: 0, // TODO: count CTF events
    });
  }

  // Step 5: Analysis
  console.log('\n' + '='.repeat(80));
  console.log('ANALYSIS');
  console.log('='.repeat(80));

  const totalV13 = comparisons.reduce((s, c) => s + c.v13_pnl, 0);
  const totalStatic = comparisons.reduce((s, c) => s + c.clob_only_static_pnl, 0);

  console.log(`\nTotals:`);
  console.log(`  V13 Sum:    $${totalV13.toLocaleString()}`);
  console.log(`  Static Sum: $${totalStatic.toLocaleString()}`);
  console.log(`  Diff:       $${(totalV13 - totalStatic).toLocaleString()}`);
  console.log(`  Gap to UI:  $${(totalV13 - UI_PNL).toLocaleString()}`);

  // Check for internal consistency: V13 sum should match V13 result
  console.log(`\n  V13 reported: $${v13Result.realized_pnl.toLocaleString()}`);
  console.log(`  V13 sum:      $${totalV13.toLocaleString()}`);
  console.log(`  Internal diff: $${(v13Result.realized_pnl - totalV13).toLocaleString()}`);

  // Sort by absolute difference to find discrepancy sources
  console.log('\n' + '='.repeat(80));
  console.log('TOP 20 POSITIONS BY ABSOLUTE DIFFERENCE (V13 vs Static)');
  console.log('='.repeat(80));

  const sortedByDiff = [...comparisons].sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference));

  console.log('| Condition                        | Idx | Category | V13 PnL       | Static PnL    | Diff          |');
  console.log('|' + '-'.repeat(34) + '|' + '-'.repeat(5) + '|' + '-'.repeat(10) + '|' + '-'.repeat(15) + '|' + '-'.repeat(15) + '|' + '-'.repeat(15) + '|');

  for (const c of sortedByDiff.slice(0, 20)) {
    const cid = c.condition_id.substring(0, 32);
    const idx = c.outcome_index.toString().padStart(3);
    const cat = c.category.substring(0, 8).padEnd(8);
    const v13 = ('$' + c.v13_pnl.toFixed(0)).padStart(13);
    const stat = ('$' + c.clob_only_static_pnl.toFixed(0)).padStart(13);
    const diff = ('$' + c.difference.toFixed(0)).padStart(13);
    console.log(`| ${cid} | ${idx} | ${cat} | ${v13} | ${stat} | ${diff} |`);
  }

  // Categorize the gap
  console.log('\n' + '='.repeat(80));
  console.log('GAP BREAKDOWN');
  console.log('='.repeat(80));

  // Where is the $615K gap?
  // UI = +$332K, V13 = -$283K, gap = $615K
  // V13 needs to be $615K higher to match UI

  // Check: positions where V13 < Static (V13 is underreporting profit or overreporting loss)
  const underreporting = comparisons.filter(c => c.difference < -100);
  const overreporting = comparisons.filter(c => c.difference > 100);
  const neutral = comparisons.filter(c => Math.abs(c.difference) <= 100);

  console.log(`\nPositions where V13 < Static (underreporting): ${underreporting.length}`);
  console.log(`  Total underreport: $${underreporting.reduce((s, c) => s + c.difference, 0).toLocaleString()}`);

  console.log(`\nPositions where V13 > Static (overreporting): ${overreporting.length}`);
  console.log(`  Total overreport: $${overreporting.reduce((s, c) => s + c.difference, 0).toLocaleString()}`);

  console.log(`\nNeutral positions (|diff| <= $100): ${neutral.length}`);

  // Check resolved vs unresolved
  const resolved = comparisons.filter(c => c.is_resolved);
  const unresolved = comparisons.filter(c => !c.is_resolved);

  console.log(`\nResolved positions: ${resolved.length}`);
  console.log(`  V13 PnL:    $${resolved.reduce((s, c) => s + c.v13_pnl, 0).toLocaleString()}`);
  console.log(`  Static PnL: $${resolved.reduce((s, c) => s + c.clob_only_static_pnl, 0).toLocaleString()}`);

  console.log(`\nUnresolved positions: ${unresolved.length}`);
  console.log(`  V13 PnL:    $${unresolved.reduce((s, c) => s + c.v13_pnl, 0).toLocaleString()}`);
  console.log(`  Static PnL: $${unresolved.reduce((s, c) => s + c.clob_only_static_pnl, 0).toLocaleString()}`);

  // Check if the static formula matches V13 well overall
  // Large diffs would indicate V13 state machine is doing something different

  console.log('\n' + '='.repeat(80));
  console.log('HYPOTHESIS TESTS');
  console.log('='.repeat(80));

  // Test 1: If UI uses unrealized for open positions, how much unrealized do we have?
  console.log('\n1. UNREALIZED TEST:');
  console.log(`   V13 unrealized_pnl: $${v13Result.unrealized_pnl.toLocaleString()}`);
  console.log(`   If we add unrealized: $${(v13Result.realized_pnl + v13Result.unrealized_pnl).toLocaleString()}`);
  console.log(`   Gap to UI with unrealized: $${(v13Result.realized_pnl + v13Result.unrealized_pnl - UI_PNL).toLocaleString()}`);

  // Test 2: Check volume
  console.log('\n2. VOLUME CHECK:');
  console.log(`   V13 volume: $${v13Result.volume_traded.toLocaleString()}`);
  console.log(`   V13 buys:   $${v13Result.volume_buys.toLocaleString()}`);
  console.log(`   V13 sells:  $${v13Result.volume_sells.toLocaleString()}`);

  // Test 3: Simple PnL = sells + resolutions - buys (ignoring cost basis timing)
  console.log('\n3. SIMPLE PNL TEST (sells + resolutions - buys):');
  const totalBuys = comparisons.reduce((s, c) => s + c.clob_buys, 0);
  const totalSells = comparisons.reduce((s, c) => s + c.clob_sells, 0);

  // Calculate total resolution proceeds
  let totalResProceeds = 0;
  for (const c of comparisons) {
    if (c.is_resolved && c.resolution_payout !== null) {
      const staticPos = staticPositions.get(`${c.condition_id}_${c.outcome_index}`);
      if (staticPos) {
        const remainingQty = staticPos.buys.qty - staticPos.sells.qty;
        if (remainingQty > 0) {
          totalResProceeds += remainingQty * c.resolution_payout;
        }
      }
    }
  }

  console.log(`   Total CLOB buys:       $${totalBuys.toLocaleString()}`);
  console.log(`   Total CLOB sells:      $${totalSells.toLocaleString()}`);
  console.log(`   Total res proceeds:    $${totalResProceeds.toLocaleString()}`);
  console.log(`   Simple PnL:            $${(totalSells + totalResProceeds - totalBuys).toLocaleString()}`);

  console.log('\n' + '='.repeat(80));
  console.log('NEXT STEPS');
  console.log('='.repeat(80));
  console.log('1. For top diff positions, run debugV13ConditionLedger to inspect event flow');
  console.log('2. Check if there are CTF events (splits/merges/redemptions) we are missing');
  console.log('3. Compare CLOB trade count against Polymarket API if available');
  console.log('4. Check for fee adjustments in the UI that we do not account for');
  console.log('='.repeat(80));
}

main().catch(console.error);
