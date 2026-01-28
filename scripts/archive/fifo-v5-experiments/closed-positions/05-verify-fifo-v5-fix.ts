#!/usr/bin/env tsx
/**
 * Verify FIFO V5 Closed Positions Fix
 *
 * Tests that closed positions are now in FIFO table
 * and match the V1 engine results.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../../lib/clickhouse/client';

const TEST_WALLET = '0x94a4f1e3eb49a66a20372d98af9988be73bb55c4'; // FuelHydrantBoss

async function main() {
  console.log('🧪 Verifying FIFO V5 Closed Positions Fix\n');
  console.log(`Test wallet: ${TEST_WALLET}\n`);

  try {
    // 1. Check FIFO breakdown by type
    console.log('1️⃣ FIFO Breakdown by Type:');
    const breakdown = await clickhouse.query({
      query: `
        SELECT
          CASE
            WHEN is_closed = 1 THEN 'closed'
            WHEN is_short = 1 THEN 'short'
            ELSE 'long'
          END as position_type,
          count() as positions,
          round(sum(pnl_usd), 0) as total_pnl
        FROM pm_trade_fifo_roi_v3_deduped
        WHERE wallet = {wallet:String}
        GROUP BY position_type
        ORDER BY position_type
      `,
      query_params: { wallet: TEST_WALLET },
      format: 'JSONEachRow',
    });
    const types = await breakdown.json() as any[];
    types.forEach(t => {
      console.log(`   ${t.position_type}: ${t.positions} positions → $${t.total_pnl.toLocaleString()}`);
    });
    const totalPnl = types.reduce((sum, t) => sum + Number(t.total_pnl), 0);
    console.log(`   ────────────────────────────`);
    console.log(`   TOTAL: ${types.reduce((sum, t) => sum + Number(t.positions), 0)} positions → $${totalPnl.toLocaleString()}\n`);

    // 2. Compare to Polymarket
    const polymarket_pnl = 8714;
    const gap = Math.abs(totalPnl - polymarket_pnl);
    const gap_pct = (gap / polymarket_pnl * 100).toFixed(1);

    console.log('2️⃣ Comparison to Polymarket:');
    console.log(`   Our FIFO total: $${totalPnl.toLocaleString()}`);
    console.log(`   Polymarket:     $${polymarket_pnl.toLocaleString()}`);
    console.log(`   Gap:            $${gap.toLocaleString()} (${gap_pct}%)\n`);

    if (gap < 100) {
      console.log('   ✅ EXCELLENT - Within $100!');
    } else if (gap < 500) {
      console.log('   ✅ GOOD - Within $500');
    } else {
      console.log('   ⚠️  Still investigating gap');
    }
    console.log();

    // 3. Sample closed positions
    console.log('3️⃣ Sample Closed Positions:');
    const samples = await clickhouse.query({
      query: `
        SELECT
          condition_id,
          outcome_index,
          round(cost_usd, 0) as cost,
          round(exit_value, 0) as exit,
          round(pnl_usd, 0) as pnl,
          round(roi * 100, 1) as roi_pct,
          entry_time,
          resolved_at
        FROM pm_trade_fifo_roi_v3_deduped
        WHERE wallet = {wallet:String}
          AND is_closed = 1
        ORDER BY abs(pnl_usd) DESC
        LIMIT 5
      `,
      query_params: { wallet: TEST_WALLET },
      format: 'JSONEachRow',
    });
    const closedSamples = await samples.json() as any[];
    if (closedSamples.length > 0) {
      console.log(`   Found ${closedSamples.length} closed positions (showing top 5 by |PnL|):\n`);
      closedSamples.forEach((p, i) => {
        console.log(`   ${i+1}. ${p.condition_id.slice(0, 10)}... oi=${p.outcome_index}`);
        console.log(`      Cost: $${p.cost} → Exit: $${p.exit} = $${p.pnl} (${p.roi_pct}%)`);
        console.log(`      Opened: ${p.entry_time} | Closed: ${p.resolved_at}\n`);
      });
    } else {
      console.log('   ⚠️  No closed positions found - did backfill run?\n');
    }

    // 4. Verify no double-counting
    console.log('4️⃣ Duplicate Check:');
    const dupeCheck = await clickhouse.query({
      query: `
        SELECT
          wallet,
          condition_id,
          outcome_index,
          count() as dupes
        FROM pm_trade_fifo_roi_v3_deduped
        WHERE wallet = {wallet:String}
        GROUP BY wallet, condition_id, outcome_index
        HAVING dupes > 1
      `,
      query_params: { wallet: TEST_WALLET },
      format: 'JSONEachRow',
    });
    const dupes = await dupeCheck.json() as any[];
    if (dupes.length === 0) {
      console.log('   ✅ No duplicates found\n');
    } else {
      console.log(`   ⚠️  Found ${dupes.length} duplicate positions:\n`);
      dupes.forEach(d => {
        console.log(`      ${d.condition_id.slice(0, 10)}... oi=${d.outcome_index} (${d.dupes} copies)`);
      });
      console.log();
    }

    console.log('════════════════════════════════════════════════════');
    console.log('📋 SUMMARY');
    console.log('════════════════════════════════════════════════════');
    if (gap < 100 && closedSamples.length > 0 && dupes.length === 0) {
      console.log('✅ FIFO V5 fix is working correctly!');
      console.log('   - Closed positions captured');
      console.log('   - PnL matches Polymarket within $100');
      console.log('   - No duplicate positions');
    } else {
      console.log('⚠️  Issues detected:');
      if (closedSamples.length === 0) console.log('   - No closed positions found');
      if (gap >= 100) console.log(`   - PnL gap is $${gap}`);
      if (dupes.length > 0) console.log(`   - ${dupes.length} duplicates found`);
    }
    console.log();

  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    throw error;
  }
}

main().catch(console.error);
