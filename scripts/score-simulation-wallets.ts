/**
 * Score the 12 simulation wallets with copytrade formula
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { rankCopytradeWallets } from '../lib/leaderboard/copytradeScore';

const SIMULATION_WALLETS = [
  "0x1e109e389fb9cc1fc37360ab796b42c12d4bbeee", // ConfusedUngaBunga
  "0x5ad5c4608c4661361b91c92e1091d2c5b43c37b9", // roberto73
  "0x71cd52a9bf9121cf8376ba13999468f5d659912d", // Marcus177
  "0x01b4f80f5f77d5b9c9f6bb163ad0f64b1001372e", // ghost01
  "0x74cbe13dba27a6a16805e9e7142ee68aa09cae6d", // C2H5O
  "0xfb81f27f1c8758d477332f8e751322c424da1cf3", // CiderApple
  "0x99984e22205053950eb25453779267bcc1aee858", // skybuyer24
  "0x4d7fad0c5944fc24d4a67110f8e31abd5f559485", // KidNR
  "0x5bbefc673462f1955e31b4a2347450724946c65d", // playboyisinthehouse
  "0x3b4484b6c8cbfdaa383ba337ab3f0d71055e264e", // Bruegel
  "0xc178402031235263f78c1a43bba8cd49d2be35b3", // asdalkjfa
  "0x373551ed197d65a504390c365835cadb9ead7ad5", // 1416CTaKolloKN
];

const NAMES: Record<string, string> = {
  "0x1e109e389fb9cc1fc37360ab796b42c12d4bbeee": "ConfusedUngaBunga",
  "0x5ad5c4608c4661361b91c92e1091d2c5b43c37b9": "roberto73",
  "0x71cd52a9bf9121cf8376ba13999468f5d659912d": "Marcus177",
  "0x01b4f80f5f77d5b9c9f6bb163ad0f64b1001372e": "ghost01",
  "0x74cbe13dba27a6a16805e9e7142ee68aa09cae6d": "C2H5O",
  "0xfb81f27f1c8758d477332f8e751322c424da1cf3": "CiderApple",
  "0x99984e22205053950eb25453779267bcc1aee858": "skybuyer24",
  "0x4d7fad0c5944fc24d4a67110f8e31abd5f559485": "KidNR",
  "0x5bbefc673462f1955e31b4a2347450724946c65d": "playboyisinthehouse",
  "0x3b4484b6c8cbfdaa383ba337ab3f0d71055e264e": "Bruegel",
  "0xc178402031235263f78c1a43bba8cd49d2be35b3": "asdalkjfa",
  "0x373551ed197d65a504390c365835cadb9ead7ad5": "1416CTaKolloKN",
};

async function main() {
  console.log("═".repeat(90));
  console.log("SIMULATION WALLETS - COPYTRADE SCORE (μ × M)");
  console.log("═".repeat(90));

  const results = await rankCopytradeWallets(SIMULATION_WALLETS, {
    onProgress: (c, t) => process.stdout.write(`\r[${c}/${t}]`),
  });

  console.log("\n");
  console.log("| Name                | Score   | μ (mean) | M (med) | MedWin% | MedLoss% | W/L Ratio | WinRate | Copy? |");
  console.log("─".repeat(100));

  for (const r of results) {
    const name = NAMES[r.wallet] || r.wallet.slice(0,10);
    if (r.eligible) {
      const muStr = (r.mu >= 0 ? "+" : "") + (r.mu * 100).toFixed(0) + "%";
      const mStr = (r.M * 100).toFixed(0) + "%";
      const medWinStr = (r.medianWinPct * 100).toFixed(0) + "%";
      const medLossStr = (r.medianLossPct * 100).toFixed(0) + "%";
      console.log(
        `| ${name.padEnd(19)} | ${r.score.toFixed(4).padStart(7)} | ${muStr.padStart(8)} | ${mStr.padStart(7)} | ${medWinStr.padStart(7)} | ${medLossStr.padStart(8)} | ${r.winLossRatio.toFixed(2).padStart(9)} | ${((r.winRate * 100).toFixed(0) + "%").padStart(7)} | ${r.isCopyable ? "✓ YES" : "✗ NO "} |`
      );
    } else {
      console.log(`| ${name.padEnd(19)} | INELIGIBLE - ${r.reason?.slice(0,50)}`);
    }
  }

  console.log("═".repeat(100));

  const copyable = results.filter(r => r.isCopyable);
  const eligible = results.filter(r => r.eligible);
  console.log(`\nSummary: ${copyable.length}/${results.length} copyable, ${eligible.length}/${results.length} eligible`);

  // Show why non-copyable failed
  const notCopyable = results.filter(r => r.eligible && !r.isCopyable);
  if (notCopyable.length > 0) {
    console.log("\nWhy not copyable:");
    for (const r of notCopyable) {
      const name = NAMES[r.wallet] || r.wallet.slice(0,10);
      const reasons = [];
      if (r.score <= 0) reasons.push("negative score");
      if (r.winLossRatio < 0.8) reasons.push(`W/L ratio ${r.winLossRatio.toFixed(2)} < 0.8`);
      if (r.winRate < 0.2) reasons.push(`win rate ${(r.winRate*100).toFixed(0)}% < 20%`);
      if (r.numWins < 5) reasons.push(`only ${r.numWins} wins < 5`);
      if (r.M < 0.01) reasons.push(`M ${(r.M*100).toFixed(1)}% < 1%`);
      console.log(`  ${name}: ${reasons.join(", ")}`);
    }
  }
}

main().catch(console.error);
