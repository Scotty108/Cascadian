/**
 * Score Copytrade Wallets
 *
 * Scores a list of wallets using the new copytrade formula:
 * Score = μ × M
 *
 * Where:
 * - μ = mean(R_i) = average per-position return
 * - M = median(|R_i|) = typical move size
 *
 * Outputs CSV with all metrics including secondary filters.
 *
 * Usage:
 *   npx tsx scripts/leaderboard/score-copytrade-wallets.ts
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { rankCopytradeWallets, CopytradeScore } from '../../lib/leaderboard/copytradeScore';

// The 53 wallets to score
const WALLETS = [
  '0x829598d4df411c94195094d66e309d56b1c03c7c',
  '0xf9442951035b143f3b5a30bb4fa1f4f6b908c249',
  '0x0bfb8009df6c46c1fdd79b65896cf224dc4526a7',
  '0x3b345c29419b69917d36af2c2be487a0f492cca8',
  '0x82767c3976671a4a73e7752189f4494ec4e61204',
  '0x125eff052d1a4cc9c539f564c92d20697ebf992c',
  '0x92d8a88f0a9fef812bdf5628770d6a0ecee39762',
  '0x4d49acb0ae1c463eb5b1947d174141b812ba7450',
  '0x4f9882a017fac7e1143e9fe7a619268a1a489e1a',
  '0x41fee59d7e6d75f2cf4c47fa5d0d1a50e4b055ec',
  '0x2b2866a724e73bf45af306036f12f20170b4d021',
  '0x1e5642bb6e37c5f395c75c0cb332086c9f350833',
  '0xc30f6390d6fb95c41c1c6c20e3c37b985aa22e65',
  '0x4f490a54aa5b5e9f4bd8bcf6b7103645fc0b231d',
  '0x524bc0719932851b9fe7755d527fd4af197249ac',
  '0x4044798f1d60d92369c86cf5b6f1e497e2818de5',
  '0xd2020940c4b8a45c6e4a4a52b00fedc98585964d',
  '0xaf0e8d81903a627056a60f291fe4db6a596322d5',
  '0x333fa090c317d93168feb7dd81d78d05908943be',
  '0x343fdd2bf9272bd12cffbfe510f3969f57e36df2',
  '0x6e95019d16cd1592c88b7c3892c7419e28cf1218',
  '0x01542a212c9696da5b409cae879143b8966115a8',
  '0xa40d0f1a3937e1f43f0a00e3b95f5dcbb57ee4ea',
  '0xea9acde5f73d185bb5044b7256942f3400d2ab9e',
  '0x39fd7f7e5d025a0c442cb89a773f314f81807d31',
  '0x94df964127f1deddf1aa0f9624848f3ea4682dce',
  '0x0f8a7eb19e45234bb81134d1f2af474b69fbfd8d',
  '0xa69b9933a2b7cdeeffaf29a119543f743c397b0c',
  '0x528a616cc686eb4197e2ae686b65758cb980f94a',
  '0x3841de6eeb1d1fd555a9696025e77d10c92fcd5c',
  '0x44a070fd4cb4385ede1fc78ed72b824becc573f7',
  '0xbd78a780bd24ec2244c3d848c7781f315c87d376',
  '0x63e3e2bd72ce83336104c25d91757a1280c27d85',
  '0xcfe6f0d5f3d688cc4fdd269856c5c893c3af3017',
  '0x4b5ca6cabd1252c97ebc9da92544054a96ac4568',
  '0x245079dd880be43fe7a1268979d8cc4856f74747',
  '0x9edd5c258a7cda369ac9ad932e602055b151e1bc',
  '0x5725252861064b61b7c6642765edc65212a3672c',
  '0xd535ff2c64fd208127063ea093b42feb11e52336',
  '0xfbd42fd52d8ae47785356e05dfc966a341f6efec',
  '0xa4d22827e71b2c16e39c234ce3e65244b4196e12',
  '0x9e1f86ef27beb047edc91d97e260c4da210df3c4',
  '0x15578cb238af1a3f514948ef8119ce9997a5f943',
  '0xf9102b726f944ed407d8e12626470a65c3508b61',
  '0x0f969283107e288aa5a00d913c36d8dc3389e6a2',
  '0xd7443a844585b4fc5ef4da7c5363fdd69094526f',
  '0x2938916bc4009581677a9451fe3ac30d811bf251',
  '0xfd4263b3ad08226034fe1b1ea678a46d80b58895',
  '0xb3e6f092d890fd935ee2e18595aaad8af7fb3218',
  '0x20a2134e291e3a10103f7c1992a7d346f14bc81d',
  '0x552000e88ae1283034d56b5966f51055783332ff',
  '0xb0a19650cefa651d8dd022da4d8710eecc6b695d',
  '0xfbc7f789c3040e14fb07f6cb810cb333497368a3',
];

async function main() {
  console.log('═'.repeat(80));
  console.log('COPYTRADE WALLET SCORING');
  console.log('Formula: Score = μ × M');
  console.log(`Wallets: ${WALLETS.length}`);
  console.log('═'.repeat(80));
  console.log('');

  const startTime = Date.now();

  const results = await rankCopytradeWallets(WALLETS, {
    onProgress: (completed, total, wallet) => {
      const pct = ((completed / total) * 100).toFixed(1);
      process.stdout.write(`\r[${completed}/${total}] ${pct}% - ${wallet.slice(0, 14)}...    `);
    },
    timeoutMs: 90000,
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n\nCompleted in ${elapsed}s\n`);

  // Print summary table
  console.log('═'.repeat(140));
  console.log('RESULTS (sorted by Score, copyable first)');
  console.log('═'.repeat(140));
  console.log('| Rank | Wallet           | Score   | μ       | M      | MedWin | MedLoss | W/L Ratio | WinRate | Wins | Pos  | Copyable | PnL       |');
  console.log('─'.repeat(140));

  let rank = 1;
  for (const r of results) {
    if (!r.eligible) continue;

    const walletShort = r.wallet.slice(0, 6) + '...' + r.wallet.slice(-4);
    const scoreStr = r.score.toFixed(5).padStart(7);
    const muStr = (r.mu >= 0 ? '+' : '') + r.mu.toFixed(4);
    const mStr = r.M.toFixed(4);
    const medWinStr = (r.medianWinPct * 100).toFixed(1) + '%';
    const medLossStr = (r.medianLossPct * 100).toFixed(1) + '%';
    const wlRatioStr = r.winLossRatio === Infinity ? '∞' : r.winLossRatio.toFixed(2);
    const winRateStr = (r.winRate * 100).toFixed(1) + '%';
    const copyableStr = r.isCopyable ? '✓ YES' : '✗ no';
    const pnlStr = '$' + (r.realizedPnl >= 0 ? '+' : '') + r.realizedPnl.toFixed(0);

    console.log(
      `| ${rank.toString().padStart(4)} | ${walletShort.padEnd(16)} | ${scoreStr} | ${muStr.padStart(7)} | ${mStr.padStart(6)} | ${medWinStr.padStart(6)} | ${medLossStr.padStart(7)} | ${wlRatioStr.padStart(9)} | ${winRateStr.padStart(7)} | ${r.numWins.toString().padStart(4)} | ${r.numPositions.toString().padStart(4)} | ${copyableStr.padStart(8)} | ${pnlStr.padStart(9)} |`
    );
    rank++;
  }

  // Print errors
  const errors = results.filter(r => !r.eligible);
  if (errors.length > 0) {
    console.log('─'.repeat(140));
    console.log(`\n⚠ ${errors.length} wallets ineligible or errored:`);
    for (const e of errors) {
      console.log(`  ${e.wallet.slice(0, 14)}... - ${e.reason}`);
    }
  }

  console.log('═'.repeat(140));

  // Summary stats
  const eligible = results.filter(r => r.eligible);
  const copyable = results.filter(r => r.isCopyable);
  const positiveScore = eligible.filter(r => r.score > 0);

  console.log('\nSUMMARY:');
  console.log(`  Total wallets:      ${WALLETS.length}`);
  console.log(`  Eligible:           ${eligible.length}`);
  console.log(`  Positive Score:     ${positiveScore.length}`);
  console.log(`  Copyable:           ${copyable.length}`);

  // Top 10 copyable
  console.log('\n🏆 TOP 10 COPYABLE WALLETS:');
  const topCopyable = copyable.slice(0, 10);
  for (let i = 0; i < topCopyable.length; i++) {
    const r = topCopyable[i];
    console.log(
      `  ${i + 1}. ${r.wallet.slice(0, 14)}... | Score: ${r.score.toFixed(5)} | μ: ${r.mu >= 0 ? '+' : ''}${r.mu.toFixed(4)} | M: ${r.M.toFixed(4)} | WinRate: ${(r.winRate * 100).toFixed(1)}% | W/L: ${r.winLossRatio.toFixed(2)}`
    );
  }

  // Output CSV
  console.log('\n\n--- CSV OUTPUT ---\n');
  console.log('rank,wallet,score,mu,M,median_win,median_loss,win_loss_ratio,win_rate,wins,losses,positions,copyable,pnl');

  rank = 1;
  for (const r of results) {
    if (!r.eligible) continue;
    console.log(
      `${rank},${r.wallet},${r.score},${r.mu},${r.M},${r.medianWinPct},${r.medianLossPct},${r.winLossRatio},${r.winRate},${r.numWins},${r.numLosses},${r.numPositions},${r.isCopyable},${r.realizedPnl}`
    );
    rank++;
  }

  console.log('\n--- END CSV ---\n');
}

main().catch(console.error);
