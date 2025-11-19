#!/usr/bin/env npx tsx
/**
 * POLYMARKET UI PARITY VALIDATION
 *
 * Compare our P&L calculations against Polymarket's live UI
 *
 * Test Wallets:
 * - 0x4ce73141ecd5bba0952dd1f12c9b3e3c5b1a6bb8 (high volume)
 * - Additional high-volume wallet TBD
 *
 * Metrics to validate:
 * - Settled P&L (realized gains/losses)
 * - Win count (positions that resolved in profit)
 * - Position count
 *
 * Capture gaps:
 * - Unresolved markets (expected gaps)
 * - Missing fills (data quality issues)
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from './lib/clickhouse/client';

const TEST_WALLETS = [
  '0x4ce73141ecd5bba0952dd1f12c9b3e3c5b1a6bb8', // High volume trader
  '0x9155e8cf81a3fb557639d23d43f1528675bcfcad', // Our pilot wallet
];

interface WalletStats {
  wallet: string;
  total_positions: number;
  resolved_positions: number;
  unresolved_positions: number;
  total_pnl: number;
  wins: number;
  losses: number;
  win_rate: number;
}

async function fetchPolymarketStats(wallet: string): Promise<any> {
  // Placeholder - would fetch from Polymarket API or scrape UI
  console.log(`\n📡 Fetching Polymarket UI data for ${wallet.substring(0, 12)}...`);
  console.log('   (This would call Polymarket API/scrape UI in production)\n');

  return {
    settled_pnl: null, // To be filled manually from UI
    win_count: null,
    position_count: null,
    source: 'MANUAL_ENTRY_REQUIRED'
  };
}

async function fetchOurStats(wallet: string): Promise<WalletStats> {
  const statsResult = await clickhouse.query({
    query: `
      SELECT
        wallet,
        COUNT(*) as total_positions,
        COUNT(realized_pnl_usd) as resolved_positions,
        COUNT(*) - COUNT(realized_pnl_usd) as unresolved_positions,
        SUM(realized_pnl_usd) as total_pnl,
        countIf(realized_pnl_usd > 0) as wins,
        countIf(realized_pnl_usd < 0) as losses,
        ROUND(100.0 * countIf(realized_pnl_usd > 0) / COUNT(realized_pnl_usd), 2) as win_rate
      FROM default.vw_wallet_pnl_calculated
      WHERE lower(wallet) = lower('${wallet}')
      GROUP BY wallet
    `,
    format: 'JSONEachRow'
  });

  const data = await statsResult.json();
  if (data.length === 0) {
    return {
      wallet,
      total_positions: 0,
      resolved_positions: 0,
      unresolved_positions: 0,
      total_pnl: 0,
      wins: 0,
      losses: 0,
      win_rate: 0
    };
  }

  return {
    wallet,
    total_positions: parseInt(data[0].total_positions),
    resolved_positions: parseInt(data[0].resolved_positions),
    unresolved_positions: parseInt(data[0].unresolved_positions),
    total_pnl: parseFloat(data[0].total_pnl || 0),
    wins: parseInt(data[0].wins || 0),
    losses: parseInt(data[0].losses || 0),
    win_rate: parseFloat(data[0].win_rate || 0)
  };
}

async function analyzeGaps(wallet: string) {
  // Get sample of unresolved positions
  const unresolved = await clickhouse.query({
    query: `
      SELECT
        substring(condition_id, 1, 16) as cid_short,
        outcome_index,
        net_shares,
        cost_basis,
        num_trades,
        first_trade,
        last_trade
      FROM default.vw_wallet_pnl_calculated
      WHERE lower(wallet) = lower('${wallet}')
        AND realized_pnl_usd IS NULL
      ORDER BY num_trades DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });

  const unresolvedData = await unresolved.json();

  console.log(`\n📊 Gap Analysis for ${wallet.substring(0, 12)}...\n`);
  console.log(`Sample unresolved positions (top 10 by trade count):\n`);

  unresolvedData.forEach((pos: any, i: number) => {
    console.log(`${i + 1}. Condition: ${pos.cid_short}...`);
    console.log(`   Outcome: ${pos.outcome_index}`);
    console.log(`   Net Shares: ${parseFloat(pos.net_shares).toFixed(2)}`);
    console.log(`   Cost Basis: $${parseFloat(pos.cost_basis).toFixed(2)}`);
    console.log(`   Trades: ${pos.num_trades}`);
    console.log(`   Period: ${pos.first_trade} → ${pos.last_trade}\n`);
  });

  // Check for missing fills (positions with very high trade counts but no resolution)
  const suspiciousMissing = await clickhouse.query({
    query: `
      SELECT COUNT(*) as cnt
      FROM default.vw_wallet_pnl_calculated
      WHERE lower(wallet) = lower('${wallet}')
        AND realized_pnl_usd IS NULL
        AND num_trades > 10
        AND last_trade < now() - INTERVAL 30 DAY
    `,
    format: 'JSONEachRow'
  });

  const suspiciousData = await suspiciousMissing.json();
  const suspiciousCount = parseInt(suspiciousData[0].cnt);

  console.log(`\n🔍 Potential Data Quality Issues:\n`);
  console.log(`Positions with >10 trades, unresolved, >30 days old: ${suspiciousCount}`);
  if (suspiciousCount > 0) {
    console.log(`⚠️  These might be missing fills or resolution data\n`);
  } else {
    console.log(`✅ No suspicious gaps detected\n`);
  }
}

async function main() {
  console.log('\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('POLYMARKET UI PARITY VALIDATION');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  const results: any[] = [];

  for (const wallet of TEST_WALLETS) {
    console.log(`\n${'─'.repeat(80)}`);
    console.log(`Wallet: ${wallet}`);
    console.log('─'.repeat(80));

    // Fetch our stats
    const ourStats = await fetchOurStats(wallet);

    // Fetch Polymarket stats (placeholder)
    const pmStats = await fetchPolymarketStats(wallet);

    console.log('\n📊 OUR CALCULATIONS:\n');
    console.log(`Total Positions: ${ourStats.total_positions.toLocaleString()}`);
    console.log(`Resolved: ${ourStats.resolved_positions.toLocaleString()} (${((ourStats.resolved_positions/ourStats.total_positions)*100).toFixed(2)}%)`);
    console.log(`Unresolved: ${ourStats.unresolved_positions.toLocaleString()} (${((ourStats.unresolved_positions/ourStats.total_positions)*100).toFixed(2)}%)`);
    console.log(`Total P&L: $${ourStats.total_pnl.toLocaleString()}`);
    console.log(`Wins: ${ourStats.wins.toLocaleString()}`);
    console.log(`Losses: ${ourStats.losses.toLocaleString()}`);
    console.log(`Win Rate: ${ourStats.win_rate}%\n`);

    console.log('📱 POLYMARKET UI:\n');
    console.log(`⚠️  MANUAL ENTRY REQUIRED`);
    console.log(`Please visit: https://polymarket.com/profile/${wallet}`);
    console.log(`And record:`);
    console.log(`  - Settled P&L: $_______`);
    console.log(`  - Win Count: _______`);
    console.log(`  - Position Count: _______\n`);

    // Analyze gaps
    await analyzeGaps(wallet);

    results.push({
      wallet,
      our_stats: ourStats,
      pm_stats: pmStats,
      parity_status: 'PENDING_MANUAL_VERIFICATION'
    });
  }

  console.log('\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  console.log('Next Steps:\n');
  console.log('1. Visit Polymarket UI for each wallet');
  console.log('2. Record Settled P&L, Win Count, Position Count');
  console.log('3. Compare with our calculations');
  console.log('4. Investigate discrepancies:\n');
  console.log('   - If P&L differs by >10%: Check resolution data');
  console.log('   - If position count differs: Check fill data completeness');
  console.log('   - If win rate differs: Check payout calculation logic\n');

  console.log('Files to check:\n');
  console.log('  - vw_wallet_pnl_calculated (our P&L view)');
  console.log('  - market_resolutions_final (resolution data)');
  console.log('  - vw_trades_canonical (trade fills)\n');
}

main().catch(console.error);
