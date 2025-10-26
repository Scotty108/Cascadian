/**
 * Analyze Top 50 Omega Ratio Wallets
 *
 * Queries the wallet_scores table to find the top 50 wallets by omega_ratio
 * and calculates the average omega ratio among them.
 */

import { config } from 'dotenv';
import { resolve } from 'path';

// Load environment variables from .env.local
config({ path: resolve(process.cwd(), '.env.local') });

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function analyzeTop50OmegaWallets() {
  console.log('📊 Analyzing Top 50 Omega Ratio Wallets...\n');

  try {
    // Query top 50 wallets by omega_ratio
    // Filter for wallets that meet minimum trade threshold
    const { data: topWallets, error } = await supabase
      .from('wallet_scores')
      .select('wallet_address, omega_ratio, grade, total_pnl, closed_positions, omega_momentum, momentum_direction')
      .eq('meets_minimum_trades', true)
      .not('omega_ratio', 'is', null)
      .order('omega_ratio', { ascending: false })
      .limit(50);

    if (error) {
      throw error;
    }

    if (!topWallets || topWallets.length === 0) {
      console.log('❌ No wallet scores found in database.');
      console.log('💡 Run `npx tsx scripts/sync-omega-scores.ts` to populate the database first.');
      return;
    }

    console.log(`✅ Found ${topWallets.length} wallets\n`);

    // Calculate average omega ratio
    const omegaRatios = topWallets.map(w => parseFloat(w.omega_ratio?.toString() || '0'));
    const averageOmega = omegaRatios.reduce((sum, ratio) => sum + ratio, 0) / omegaRatios.length;

    // Calculate other statistics
    const maxOmega = Math.max(...omegaRatios);
    const minOmega = Math.min(...omegaRatios);
    const medianOmega = omegaRatios.sort((a, b) => a - b)[Math.floor(omegaRatios.length / 2)];

    // Grade distribution
    const gradeDistribution = topWallets.reduce((acc, w) => {
      const grade = w.grade || 'Unknown';
      acc[grade] = (acc[grade] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    // Momentum distribution
    const momentumDistribution = topWallets.reduce((acc, w) => {
      const direction = w.momentum_direction || 'unknown';
      acc[direction] = (acc[direction] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    // Total PnL
    const totalPnL = topWallets.reduce((sum, w) => sum + parseFloat(w.total_pnl?.toString() || '0'), 0);

    // Print results
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('                 TOP 50 OMEGA RATIO WALLETS                    ');
    console.log('═══════════════════════════════════════════════════════════════\n');

    console.log('📈 OMEGA RATIO STATISTICS:');
    console.log(`   Average Omega Ratio: ${averageOmega.toFixed(4)}`);
    console.log(`   Median Omega Ratio:  ${medianOmega.toFixed(4)}`);
    console.log(`   Max Omega Ratio:     ${maxOmega.toFixed(4)}`);
    console.log(`   Min Omega Ratio:     ${minOmega.toFixed(4)}`);
    console.log();

    console.log('🎓 GRADE DISTRIBUTION:');
    Object.entries(gradeDistribution)
      .sort(([a], [b]) => a.localeCompare(b))
      .forEach(([grade, count]) => {
        const percentage = ((count / topWallets.length) * 100).toFixed(1);
        console.log(`   ${grade} Grade: ${count} wallets (${percentage}%)`);
      });
    console.log();

    console.log('📊 MOMENTUM DISTRIBUTION:');
    Object.entries(momentumDistribution)
      .forEach(([direction, count]) => {
        const percentage = ((count / topWallets.length) * 100).toFixed(1);
        const emoji = direction === 'improving' ? '📈' : direction === 'declining' ? '📉' : '➡️';
        console.log(`   ${emoji} ${direction}: ${count} wallets (${percentage}%)`);
      });
    console.log();

    console.log('💰 FINANCIAL METRICS:');
    console.log(`   Combined Total PnL: $${totalPnL.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    console.log(`   Average PnL per Wallet: $${(totalPnL / topWallets.length).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    console.log();

    console.log('═══════════════════════════════════════════════════════════════\n');

    // Show top 10 wallets
    console.log('🏆 TOP 10 WALLETS BY OMEGA RATIO:\n');
    console.log('Rank | Address                                    | Omega  | Grade | PnL        | Trades | Momentum');
    console.log('─────┼────────────────────────────────────────────┼────────┼───────┼────────────┼────────┼─────────');

    topWallets.slice(0, 10).forEach((wallet, index) => {
      const rank = (index + 1).toString().padStart(4, ' ');
      const address = wallet.wallet_address.slice(0, 42).padEnd(42, ' ');
      const omega = parseFloat(wallet.omega_ratio?.toString() || '0').toFixed(2).padStart(6, ' ');
      const grade = (wallet.grade || '?').padStart(5, ' ');
      const pnl = `$${parseFloat(wallet.total_pnl?.toString() || '0').toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`.padStart(10, ' ');
      const trades = (wallet.closed_positions || 0).toString().padStart(6, ' ');
      const momentum = wallet.momentum_direction === 'improving' ? '📈' : wallet.momentum_direction === 'declining' ? '📉' : '➡️';

      console.log(`${rank} | ${address} | ${omega} | ${grade} | ${pnl} | ${trades} | ${momentum}`);
    });

    console.log('\n✅ Analysis complete!\n');

    // Return the key metric
    return {
      averageOmegaRatio: averageOmega,
      count: topWallets.length,
      maxOmega,
      minOmega,
      medianOmega,
      gradeDistribution,
      momentumDistribution,
      totalPnL,
      topWallets: topWallets.slice(0, 10)
    };

  } catch (error) {
    console.error('❌ Error analyzing top wallets:', error);
    throw error;
  }
}

// Run the analysis
analyzeTop50OmegaWallets()
  .then((result) => {
    if (result) {
      console.log(`\n🎯 Answer: The average omega ratio among the top 50 wallets is ${result.averageOmegaRatio.toFixed(4)}\n`);
    }
    process.exit(0);
  })
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
