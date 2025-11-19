#!/usr/bin/env npx tsx
/**
 * VERIFY AGAINST POLYMARKET UI
 *
 * Compare our PnL calculations against ground truth from Polymarket UI
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

// Polymarket UI ground truth for verification
const groundTruth = [
  { wallet: '0x1489046ca0f9980fc2d9a950d103d3bec02c1307', ui_pnl: 137663, ui_gains: 145976, ui_losses: 8313 },
  { wallet: '0x8e9eedf20dfa70956d49f608a205e402d9df38e4', ui_pnl: 360492, ui_gains: 366546, ui_losses: 6054 },
  { wallet: '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b', ui_pnl: 94730, ui_gains: 205410, ui_losses: 110680 },
  { wallet: '0x6770bf688b8121331b1c5cfd7723ebd4152545fb', ui_pnl: 12171, ui_gains: 16715, ui_losses: 4544 },
  { wallet: '0x5656c2f3c326ba19c3691f91229e0edfbf1591eb', ui_pnl: -70.98, ui_positions: 109, ui_biggest_win: 7.33 },
];

async function main() {
console.log('═'.repeat(80));
console.log('POLYMARKET UI VERIFICATION - GROUND TRUTH COMPARISON');
console.log('═'.repeat(80));
console.log();

for (const gt of groundTruth) {
  console.log(`Wallet: ${gt.wallet}`);
  console.log('─'.repeat(80));

  try {
    // Check our database
    const result = await client.query({
      query: `
        SELECT
          wallet_address,
          count() AS total_positions,
          countIf(is_resolved) AS resolved_positions,
          sum(realized_pnl_usd) AS total_pnl,
          sumIf(realized_pnl_usd, realized_pnl_usd > 0) AS total_gains,
          abs(sumIf(realized_pnl_usd, realized_pnl_usd < 0)) AS total_losses,
          max(realized_pnl_usd) AS biggest_win,
          countIf(realized_pnl_usd > 0) AS wins,
          countIf(realized_pnl_usd <= 0) AS losses
        FROM cascadian_clean.vw_wallet_positions
        WHERE wallet_address = '${gt.wallet}'
          AND is_resolved = true
        GROUP BY wallet_address
      `,
      format: 'JSONEachRow',
    });

    const rows = await result.json<Array<{
      wallet_address: string;
      total_positions: number;
      resolved_positions: number;
      total_pnl: number | null;
      total_gains: number | null;
      total_losses: number | null;
      biggest_win: number | null;
      wins: number;
      losses: number;
    }>>();

    if (rows.length > 0) {
      const db = rows[0];
      console.log(`  Polymarket UI:`);
      if (gt.ui_pnl !== undefined) console.log(`    PnL:              $${gt.ui_pnl.toLocaleString()}`);
      if (gt.ui_gains !== undefined) console.log(`    Gains:            $${gt.ui_gains.toLocaleString()}`);
      if (gt.ui_losses !== undefined) console.log(`    Losses:           $${gt.ui_losses.toLocaleString()}`);
      if (gt.ui_positions !== undefined) console.log(`    Positions:        ${gt.ui_positions}`);
      if (gt.ui_biggest_win !== undefined) console.log(`    Biggest Win:      $${gt.ui_biggest_win}`);

      console.log(`\n  Our Database:`);
      console.log(`    Total Positions:  ${db.total_positions}`);
      console.log(`    Resolved:         ${db.resolved_positions}`);
      console.log(`    PnL:              $${db.total_pnl !== null ? db.total_pnl.toFixed(2) : 'N/A'}`);
      console.log(`    Gains:            $${db.total_gains !== null ? db.total_gains.toFixed(2) : 'N/A'}`);
      console.log(`    Losses:           $${db.total_losses !== null ? db.total_losses.toFixed(2) : 'N/A'}`);
      console.log(`    Biggest Win:      $${db.biggest_win !== null ? db.biggest_win.toFixed(2) : 'N/A'}`);
      console.log(`    Wins/Losses:      ${db.wins} / ${db.losses}`);

      console.log(`\n  Discrepancies:`);
      if (gt.ui_pnl !== undefined && db.total_pnl !== null) {
        const pnlDiff = Math.abs(db.total_pnl - gt.ui_pnl);
        const pnlPct = Math.abs(gt.ui_pnl) > 0 ? (pnlDiff / Math.abs(gt.ui_pnl)) * 100 : 0;
        const status = pnlPct < 5 ? '✅ GOOD' : pnlPct < 20 ? '⚠️  MODERATE' : '❌ BAD';
        console.log(`    PnL Diff:         $${pnlDiff.toFixed(2)} (${pnlPct.toFixed(1)}%) ${status}`);
      }
      if (gt.ui_positions !== undefined) {
        const posDiff = Math.abs(db.resolved_positions - gt.ui_positions);
        const posPct = (posDiff / gt.ui_positions) * 100;
        const status = posPct < 5 ? '✅ GOOD' : posPct < 20 ? '⚠️  MODERATE' : '❌ BAD';
        console.log(`    Position Diff:    ${posDiff} positions (${posPct.toFixed(1)}%) ${status}`);
      }
      if (gt.ui_gains !== undefined && db.total_gains !== null) {
        const gainsDiff = Math.abs(db.total_gains - gt.ui_gains);
        const gainsPct = (gainsDiff / gt.ui_gains) * 100;
        const status = gainsPct < 5 ? '✅ GOOD' : gainsPct < 20 ? '⚠️  MODERATE' : '❌ BAD';
        console.log(`    Gains Diff:       $${gainsDiff.toFixed(2)} (${gainsPct.toFixed(1)}%) ${status}`);
      }
      if (gt.ui_losses !== undefined && db.total_losses !== null) {
        const lossesDiff = Math.abs(db.total_losses - gt.ui_losses);
        const lossesPct = (lossesDiff / gt.ui_losses) * 100;
        const status = lossesPct < 5 ? '✅ GOOD' : lossesPct < 20 ? '⚠️  MODERATE' : '❌ BAD';
        console.log(`    Losses Diff:      $${lossesDiff.toFixed(2)} (${lossesPct.toFixed(1)}%) ${status}`);
      }
    } else {
      console.log(`  ❌ NOT FOUND in our database`);
    }
  } catch (error: any) {
    console.error(`  ❌ Query failed: ${error?.message || error}`);
  }

  console.log();
}

// Check total wallet count
console.log('═'.repeat(80));
console.log('WALLET COUNT ANALYSIS');
console.log('─'.repeat(80));
console.log();

try {
  const walletCount = await client.query({
    query: `
      SELECT
        (SELECT uniqExact(wallet_address) FROM cascadian_clean.fact_trades_clean) AS total_wallets_in_fact,
        (SELECT uniqExact(wallet_address) FROM cascadian_clean.vw_wallet_positions) AS total_wallets_in_view,
        (SELECT uniqExact(user_wallet) FROM cascadian_clean.system_wallet_map) AS unique_remapped_users,
        (SELECT count(DISTINCT wallet_address) FROM cascadian_clean.fact_trades_clean
         WHERE wallet_address NOT IN (SELECT DISTINCT system_wallet FROM cascadian_clean.system_wallet_map)) AS non_system_wallets
    `,
    format: 'JSONEachRow',
  });

  const wc = (await walletCount.json<Array<{
    total_wallets_in_fact: number;
    total_wallets_in_view: number;
    unique_remapped_users: number;
    non_system_wallets: number;
  }>>())[0];

  console.log(`  Total wallets in fact_trades_clean:        ${wc.total_wallets_in_fact.toLocaleString()}`);
  console.log(`  Total wallets in vw_wallet_positions:      ${wc.total_wallets_in_view.toLocaleString()}`);
  console.log(`  Unique remapped users (from system map):   ${wc.unique_remapped_users.toLocaleString()}`);
  console.log(`  Non-system wallets in fact:                ${wc.non_system_wallets.toLocaleString()}`);
  console.log();
  console.log(`  Expected: ~996,000 wallets`);
  console.log(`  Discrepancy: ${(996000 - wc.total_wallets_in_fact).toLocaleString()} wallets`);
  console.log();
} catch (error: any) {
  console.error(`❌ Wallet count failed: ${error?.message || error}`);
}

console.log('═'.repeat(80));
console.log('ANALYSIS COMPLETE');
console.log('═'.repeat(80));
console.log();
console.log('Next Steps Based on Results:');
console.log('  1. If PnL/Gains/Losses <5% diff → System is accurate ✅');
console.log('  2. If Position counts differ → Missing trades or duplicate positions');
console.log('  3. If PnL formula wrong → Debug payout vector calculation');
console.log('  4. If wallet count low → Check fact_trades_clean vs raw sources');
console.log();

await client.close();
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
