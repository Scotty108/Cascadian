#!/usr/bin/env tsx
/**
 * Verify Closed Positions Fix
 *
 * Tests FuelHydrantBoss wallet to confirm we're now capturing
 * the missing $7k in realized PnL from closed positions.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../../lib/clickhouse/client';

const TEST_WALLET = '0x94a4f1e3eb49a66a20372d98af9988be73bb55c4'; // FuelHydrantBoss

async function main() {
  console.log('🧪 Verifying Closed Positions Fix\n');
  console.log(`Test wallet: ${TEST_WALLET}\n`);

  try {
    // 1. Check FIFO (resolved markets only)
    console.log('1️⃣ FIFO (resolved markets only):');
    const fifoResult = await clickhouse.query({
      query: `
        SELECT
          count() as positions,
          round(sum(pnl_usd), 0) as total_pnl
        FROM pm_trade_fifo_roi_v3_deduped
        WHERE wallet = {wallet:String}
      `,
      query_params: { wallet: TEST_WALLET },
      format: 'JSONEachRow',
    });
    const fifo = (await fifoResult.json())[0];
    console.log(`   Positions: ${fifo.positions}`);
    console.log(`   PnL: $${fifo.total_pnl.toLocaleString()}\n`);

    // 2. Check closed positions (unresolved markets, fully exited)
    console.log('2️⃣ Closed positions (unresolved, fully exited):');
    const closedResult = await clickhouse.query({
      query: `
        SELECT
          count() as positions,
          round(sum(net_cash_flow), 0) as total_pnl,
          groupArray((condition_id, outcome_index, round(net_cash_flow, 0))) as top_positions
        FROM pm_closed_positions_current
        WHERE wallet = {wallet:String}
      `,
      query_params: { wallet: TEST_WALLET },
      format: 'JSONEachRow',
    });
    const closed = (await closedResult.json())[0];
    console.log(`   Positions: ${closed.positions}`);
    console.log(`   PnL: $${closed.total_pnl.toLocaleString()}`);
    console.log(`   Top 5 positions:`);
    closed.top_positions.slice(0, 5).forEach((p: any, i: number) => {
      console.log(`     ${i+1}. ${p[0].slice(0, 10)}... oi=${p[1]} → $${p[2]}`);
    });
    console.log();

    // 3. Combined total
    console.log('3️⃣ COMBINED TOTAL (FIFO + Closed):');
    const combined = Number(fifo.total_pnl) + Number(closed.total_pnl);
    console.log(`   Total PnL: $${combined.toLocaleString()}\n`);

    // 4. Compare to Polymarket
    const polymarket_pnl = 8714; // From their UI
    const gap = Math.abs(combined - polymarket_pnl);
    const gap_pct = (gap / polymarket_pnl * 100).toFixed(1);

    console.log('════════════════════════════════════════════════════');
    console.log('📊 COMPARISON');
    console.log('════════════════════════════════════════════════════');
    console.log(`Our calculation:  $${combined.toLocaleString()}`);
    console.log(`Polymarket:       $${polymarket_pnl.toLocaleString()}`);
    console.log(`Gap:              $${gap.toLocaleString()} (${gap_pct}%)`);
    console.log();

    if (gap < 100) {
      console.log('✅ EXCELLENT - Within $100!');
    } else if (gap < 500) {
      console.log('✅ GOOD - Within $500 (likely methodology difference)');
    } else if (gap < 1000) {
      console.log('⚠️  ACCEPTABLE - Within $1k (check calculation logic)');
    } else {
      console.log('❌ STILL TOO FAR - Need more investigation');
    }
    console.log();

    // 5. Breakdown by position status
    console.log('════════════════════════════════════════════════════');
    console.log('📋 POSITION STATUS BREAKDOWN');
    console.log('════════════════════════════════════════════════════');
    console.log(`Resolved positions:     ${fifo.positions} → $${fifo.total_pnl}`);
    console.log(`Closed (unresolved):    ${closed.positions} → $${closed.total_pnl}`);
    console.log(`─────────────────────────────────────────────────`);
    console.log(`Total:                  ${Number(fifo.positions) + Number(closed.positions)} → $${combined.toLocaleString()}\n`);

  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    throw error;
  }
}

main().catch(console.error);
