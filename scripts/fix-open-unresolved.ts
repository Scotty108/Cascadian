#!/usr/bin/env npx tsx
/**
 * Fix Open Unresolved Positions - Zero Out PnL
 * 
 * Sets PnL/ROI/exit_value to ZERO for open positions in unresolved markets.
 * Keeps closed positions in unresolved markets (they have real trading PnL).
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

async function fixOpenUnresolved() {
  console.log('🔧 Fixing Open Unresolved Positions\n');
  console.log('Setting PnL = 0 for positions that are:');
  console.log('  - In unresolved markets (resolved_at IS NULL)');
  console.log('  - Still open (is_closed = 0)');
  console.log('  - Keeping PnL for closed positions in unresolved!\n');
  
  // Check how many will be affected
  const checkResult = await clickhouse.query({
    query: `
      SELECT 
        count() as positions,
        sum(pnl_usd) as current_pnl
      FROM pm_trade_fifo_roi_v3_mat_unified
      WHERE resolved_at IS NULL 
        AND is_closed = 0
        AND pnl_usd != 0
    `,
    format: 'JSONEachRow'
  });
  const before = (await checkResult.json())[0];
  
  console.log(`Positions to update: ${before.positions.toLocaleString()}`);
  console.log(`Current PnL (will be zeroed): $${(before.current_pnl / 1000000).toFixed(2)}M\n`);
  
  if (before.positions === 0) {
    console.log('✅ No positions need updating - already correct!\n');
    return;
  }
  
  // Apply the fix
  console.log('Applying fix...');
  const startTime = Date.now();
  
  await clickhouse.command({
    query: `
      ALTER TABLE pm_trade_fifo_roi_v3_mat_unified
      UPDATE 
        pnl_usd = 0,
        exit_value = 0,
        roi = 0
      WHERE resolved_at IS NULL 
        AND is_closed = 0
    `,
    clickhouse_settings: {
      max_execution_time: 1800 as any,  // 30 minutes
    }
  });
  
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`✅ Fix submitted (${elapsed}s)\n`);
  
  console.log('Mutation is running in background (~20-30 min)');
  console.log('Monitor: SELECT * FROM system.mutations WHERE table = \'pm_trade_fifo_roi_v3_mat_unified\'\n');
  
  // Verify (will show current state, mutation runs async)
  const verifyResult = await clickhouse.query({
    query: `
      SELECT
        countIf(resolved_at IS NULL AND is_closed = 1) as closed_unres,
        sumIf(pnl_usd, resolved_at IS NULL AND is_closed = 1) as closed_pnl,
        countIf(resolved_at IS NULL AND is_closed = 0) as open_unres,
        sumIf(pnl_usd, resolved_at IS NULL AND is_closed = 0) as open_pnl
      FROM pm_trade_fifo_roi_v3_mat_unified
    `,
    format: 'JSONEachRow'
  });
  const after = (await verifyResult.json())[0];
  
  console.log('After mutation completes:');
  console.log(`  Closed in unresolved: ${after.closed_unres.toLocaleString()} positions`);
  console.log(`    PnL: $${(after.closed_pnl / 1000000).toFixed(2)}M (KEPT)`);
  console.log(`  Open in unresolved: ${after.open_unres.toLocaleString()} positions`);
  console.log(`    PnL: $${(after.open_pnl / 1000000).toFixed(2)}M (will be $0.00M)`);
  console.log('');
}

fixOpenUnresolved().catch(console.error);
