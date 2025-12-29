#!/usr/bin/env npx tsx
/**
 * V29 Realized PnL Forensic Debugger
 *
 * Produces detailed breakdown of V29 realized components to diagnose
 * massive underestimation vs Dome ground truth
 *
 * Usage:
 *   npx tsx scripts/pnl/debug-wallet-v29-realized.ts --wallet=0x...
 */

import { clickhouse } from '../../lib/clickhouse/client';
import { calculateV29PnL } from '../../lib/pnl/inventoryEngineV29';
import { preloadV29Data } from '../../lib/pnl/v29BatchLoaders';

interface Args {
  wallet: string;
  inventoryGuard: boolean;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  let wallet = '';
  let inventoryGuard = true; // Default to ON

  for (const arg of args) {
    if (arg.startsWith('--wallet=')) {
      wallet = arg.split('=')[1].toLowerCase();
    } else if (arg.startsWith('--inventory-guard=')) {
      inventoryGuard = arg.split('=')[1].toLowerCase() === 'true';
    }
  }

  if (!wallet) {
    console.error('ERROR: --wallet required');
    process.exit(1);
  }

  return { wallet, inventoryGuard };
}

async function main() {
  const { wallet, inventoryGuard } = parseArgs();

  console.log('═'.repeat(100));
  console.log(`V29 REALIZED PNL FORENSICS: ${wallet}`);
  console.log(`Inventory Guard: ${inventoryGuard ? 'ON' : 'OFF'}`);
  console.log('═'.repeat(100));
  console.log('');

  // Step 1: Count events (simple query)
  console.log('STEP 1: Event Count');
  console.log('-'.repeat(100));

  const countQuery = `
    SELECT COUNT(*) as total_events
    FROM pm_unified_ledger_v8_tbl
    WHERE lower(wallet_address) = lower('${wallet}')
  `;

  const countResult = await clickhouse.query({ query: countQuery });
  const countData = await countResult.json<{ total_events: string }>();

  const totalEvents = parseInt(countData.data[0]?.total_events || '0');

  console.log(`Total Ledger Events: ${totalEvents.toLocaleString()}`);
  console.log('');

  // Step 3: Resolution coverage
  console.log('STEP 3: Resolution Price Coverage');
  console.log('-'.repeat(100));

  const resolutionQuery = `
    SELECT
      COUNT(DISTINCT l.condition_id) as total_conditions,
      COUNT(DISTINCT CASE WHEN r.resolved_price IS NOT NULL THEN l.condition_id END) as resolved_conditions
    FROM (
      SELECT DISTINCT condition_id
      FROM pm_unified_ledger_v8_tbl
      WHERE lower(wallet_address) = lower('${wallet}')
        AND condition_id != ''
    ) l
    LEFT JOIN vw_pm_resolution_prices r ON l.condition_id = r.condition_id
  `;

  const resolutionResult = await clickhouse.query({ query: resolutionQuery });
  const resolutionData = await resolutionResult.json<{ total_conditions: string; resolved_conditions: string }>();

  const totalCond = parseInt(resolutionData.data[0]?.total_conditions || '0');
  const resolvedCond = parseInt(resolutionData.data[0]?.resolved_conditions || '0');
  const pct = totalCond > 0 ? ((resolvedCond / totalCond) * 100).toFixed(1) : '0.0';

  console.log(`Total Conditions:    ${totalCond}`);
  console.log(`Resolved Conditions: ${resolvedCond} (${pct}%)`);
  console.log(`Missing Prices:      ${totalCond - resolvedCond}`);
  console.log('');

  // Step 4: Calculate V29 PnL
  console.log('STEP 4: V29 PnL Calculation');
  console.log('-'.repeat(100));

  const preloadData = await preloadV29Data([wallet]);
  const events = preloadData.eventsByWallet.get(wallet) || [];

  console.log(`Loaded ${events.length} events for V29 calculation`);
  console.log('');

  const v29Result = await calculateV29PnL(wallet, {
    inventoryGuard,
    preload: {
      events,
      resolutionPrices: preloadData.resolutionPrices,
    },
  });

  console.log('V29 Results:');
  console.log(`  Realized PnL:              $${v29Result.realizedPnl?.toLocaleString() || 0}`);
  console.log(`  Unrealized PnL:            $${v29Result.unrealizedPnl?.toLocaleString() || 0}`);
  console.log(`  Resolved Unredeemed:       $${v29Result.resolvedUnredeemedValue?.toLocaleString() || 0}`);
  console.log(`  Total PnL:                 $${v29Result.totalPnl?.toLocaleString() || 0}`);
  console.log(`  Positions Count:           ${v29Result.positionsCount || 0}`);
  console.log('');

  // Step 5: Identify potential issues
  console.log('STEP 5: Diagnostic Flags');
  console.log('-'.repeat(100));

  const diagnostics: string[] = [];

  if (resolvedCond < totalCond * 0.5) {
    diagnostics.push(`❌ LOW RESOLUTION COVERAGE: Only ${pct}% of conditions have prices`);
  }

  if ((v29Result.realizedPnl || 0) === 0 && totalCond > 100) {
    diagnostics.push('❌ ZERO REALIZED despite significant trading activity');
  }

  if (events.length < totalEvents * 0.5) {
    diagnostics.push('❌ PRELOAD MISMATCH: Fewer events loaded than in ledger');
  }

  // CRITICAL: Check if resolved unredeemed is large
  if ((v29Result.resolvedUnredeemedValue || 0) > (v29Result.realizedPnl || 0) * 10) {
    diagnostics.push(`🚨 CRITICAL: Resolved Unredeemed ($${v29Result.resolvedUnredeemedValue?.toLocaleString()}) >> Realized ($${v29Result.realizedPnl?.toLocaleString()})`);
    diagnostics.push(`   → V29 is NOT counting redemptions as realized!`);
  }

  if (diagnostics.length === 0) {
    console.log('✅ No obvious data pipeline issues detected');
  } else {
    diagnostics.forEach(d => console.log(d));
  }

  console.log('');
  console.log('═'.repeat(100));
  console.log('END FORENSICS');
  console.log('═'.repeat(100));
}

main().catch(console.error);
