/**
 * Run Copy Trading Score on Multiple Wallets
 *
 * Score = μ × M
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { computeCCRv1 } from '../../lib/pnl/ccrEngineV1';
import { ccrToWalletScore, passesFilters } from '../../lib/leaderboard/scoring';

// Wallets from copy trading portfolio + known traders
const WALLETS = [
  // Validated wallets
  { addr: '0x26437896ed9dfeb2f69765edcafe8fdceaab39ae', name: '@Latina' },
  { addr: '0x92d8a88f0a9fef812bdf5628770d6a0ecee39762', name: '@biznis33' },

  // From copy trading portfolio (top performers)
  { addr: '0x000d257d2dc7616feaef4ae0f14600fdf50a758e', name: '@scottilicious' },
  { addr: '0x006cc834cc092684f1b56626e23bedb3835c16ea', name: 'Top2' },
  { addr: '0x1521b47bf0c41f6b7fd3ad41cdec566812c8f23e', name: 'Top3' },
  { addr: '0x8247f6d658b0afe22414a12e9f6c57058a9dd8cc', name: 'Top4' },
  { addr: '0x133ba4d001ae339bfb08631eead95c5dabe92f22', name: 'Top5' },

  // From batch backtest
  { addr: '0x03a9f592e5eb9a34f0df6c41c3a37c1f063237ba', name: '@Btlenc9' },

  // Sports traders
  { addr: '0xe90bec87d9ef430f27f9dcfe72c34b76967d5da2', name: '@gmanas' },
  { addr: '0xd38b71f3e8ed1af71983e5c309eac3dfa9b35029', name: '@primm' },
];

interface ScoredWallet {
  name: string;
  wallet: string;
  score: number;
  mu: number;
  M: number;
  trades: number;
  winRate: number;
  pnl: number;
  passes: boolean;
  error?: string;
}

async function main() {
  console.log('═'.repeat(100));
  console.log('COPY TRADING LEADERBOARD - Score = μ × M');
  console.log('═'.repeat(100));
  console.log(`\nScoring ${WALLETS.length} wallets...\n`);

  const results: ScoredWallet[] = [];

  for (const w of WALLETS) {
    process.stdout.write(`Processing ${w.name.padEnd(15)}... `);

    try {
      const metrics = await computeCCRv1(w.addr);
      const score = ccrToWalletScore(metrics);
      const passes = passesFilters(score);

      results.push({
        name: w.name,
        wallet: w.addr,
        score: score.score,
        mu: score.mu,
        M: score.M,
        trades: score.num_trades,
        winRate: score.win_rate,
        pnl: score.realized_pnl,
        passes,
      });

      console.log(`✅ Score: ${score.score.toFixed(4)} (μ: ${(score.mu * 100).toFixed(0)}%, M: ${(score.M * 100).toFixed(0)}%)`);
    } catch (e: any) {
      results.push({
        name: w.name,
        wallet: w.addr,
        score: 0,
        mu: 0,
        M: 0,
        trades: 0,
        winRate: 0,
        pnl: 0,
        passes: false,
        error: e.message,
      });
      console.log(`❌ Error: ${e.message?.slice(0, 50)}`);
    }
  }

  // Sort by score
  const ranked = results
    .filter(r => !r.error)
    .sort((a, b) => b.score - a.score);

  console.log('\n' + '═'.repeat(100));
  console.log('FINAL RANKING (sorted by Score = μ × M)');
  console.log('═'.repeat(100));
  console.log('');
  console.log('Rank │ Pass │ Wallet          │ Score    │ μ (avg)  │ M (move) │ Trades │ Win%  │ PnL');
  console.log('─'.repeat(100));

  ranked.forEach((r, i) => {
    const pass = r.passes ? '✅' : '⚠️';
    console.log(
      `${(i + 1).toString().padStart(3)}  │ ${pass}   │ ${r.name.padEnd(15)} │ ${r.score.toFixed(4).padStart(8)} │ ${(r.mu * 100).toFixed(1).padStart(6)}% │ ${(r.M * 100).toFixed(1).padStart(6)}% │ ${r.trades.toString().padStart(6)} │ ${(r.winRate * 100).toFixed(0).padStart(4)}% │ $${r.pnl.toLocaleString()}`
    );
  });

  // Summary stats
  const eligible = ranked.filter(r => r.passes);
  console.log('\n' + '─'.repeat(100));
  console.log(`Total wallets scored: ${ranked.length}`);
  console.log(`Eligible (>15 trades, >10 markets, μ>0): ${eligible.length}`);
  console.log(`Top Score: ${ranked[0]?.name} (${ranked[0]?.score.toFixed(4)})`);

  // Top 5 for copy trading
  console.log('\n' + '═'.repeat(100));
  console.log('TOP 5 FOR COPY TRADING ($1/trade equal weight)');
  console.log('═'.repeat(100));
  eligible.slice(0, 5).forEach((r, i) => {
    console.log(`${i + 1}. ${r.name} - Score: ${r.score.toFixed(4)} | μ: ${(r.mu * 100).toFixed(1)}% | Win Rate: ${(r.winRate * 100).toFixed(0)}%`);
  });
}

main().catch(console.error);
