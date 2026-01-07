/**
 * Compare 15 copyable wallets from 53-pool with 10 from simulation
 */

// 15 copyable from 53-pool (from the scoring run)
const POOL_53_COPYABLE = [
  { wallet: "0x44a070fd4cb4385ede1fc78ed72b824becc573f7", score: 17.9107, mu: 7.1643, M: 2.5, winRate: 0.9, wlRatio: 2.61, pnl: 5797, wins: 9, positions: 10, medWin: 2.5556, medLoss: -0.9792 },
  { wallet: "0xbd78a780bd24ec2244c3d848c7781f315c87d376", score: 6.90614, mu: 6.9061, M: 1.0, winRate: 0.459, wlRatio: 65.38, pnl: 12, wins: 679, positions: 1479, medWin: 24.0, medLoss: -0.3671 },
  { wallet: "0xaf0e8d81903a627056a60f291fe4db6a596322d5", score: 5.46019, mu: 5.4602, M: 1.0, winRate: 0.434, wlRatio: 23.74, pnl: 36, wins: 372, positions: 858, medWin: 11.5, medLoss: -0.4845 },
  { wallet: "0x2b2866a724e73bf45af306036f12f20170b4d021", score: 5.06217, mu: 5.0622, M: 1.0, winRate: 0.278, wlRatio: 7.33, pnl: 9526, wins: 27, positions: 97, medWin: 7.325, medLoss: -1.0 },
  { wallet: "0xfbd42fd52d8ae47785356e05dfc966a341f6efec", score: 2.88751, mu: 2.8875, M: 1.0, winRate: 0.222, wlRatio: 8.54, pnl: 118, wins: 10, positions: 45, medWin: 8.5391, medLoss: -1.0 },
  { wallet: "0xd2020940c4b8a45c6e4a4a52b00fedc98585964d", score: 2.76979, mu: 2.7698, M: 1.0, winRate: 0.573, wlRatio: 3.63, pnl: 19128, wins: 173, positions: 302, medWin: 3.625, medLoss: -1.0 },
  { wallet: "0xf9442951035b143f3b5a30bb4fa1f4f6b908c249", score: 2.48689, mu: 2.4869, M: 1.0, winRate: 0.768, wlRatio: 1.0, pnl: 999, wins: 63, positions: 82, medWin: 1.0, medLoss: -1.0 },
  { wallet: "0xc30f6390d6fb95c41c1c6c20e3c37b985aa22e65", score: 2.17534, mu: 2.1753, M: 1.0, winRate: 0.476, wlRatio: 17.81, pnl: 99, wins: 1067, positions: 2241, medWin: 7.3333, medLoss: -0.4118 },
  { wallet: "0xfd4263b3ad08226034fe1b1ea678a46d80b58895", score: 2.08793, mu: 2.0879, M: 1.0, winRate: 0.396, wlRatio: 4.26, pnl: 7532, wins: 44, positions: 111, medWin: 4.2632, medLoss: -1.0 },
  { wallet: "0x9edd5c258a7cda369ac9ad932e602055b151e1bc", score: 2.03109, mu: 5.0175, M: 0.4048, winRate: 0.551, wlRatio: 0.96, pnl: 407, wins: 1831, positions: 3321, medWin: 0.3889, medLoss: -0.4048 },
  { wallet: "0xd7443a844585b4fc5ef4da7c5363fdd69094526f", score: 1.83494, mu: 1.8349, M: 1.0, winRate: 0.5, wlRatio: 0.97, pnl: 13791, wins: 5, positions: 10, medWin: 0.9746, medLoss: -1.0 },
  { wallet: "0xf9102b726f944ed407d8e12626470a65c3508b61", score: 1.75679, mu: 1.7568, M: 1.0, winRate: 0.6, wlRatio: 2.71, pnl: 1985, wins: 6, positions: 10, medWin: 2.7091, medLoss: -1.0 },
  { wallet: "0xb3e6f092d890fd935ee2e18595aaad8af7fb3218", score: 1.58704, mu: 4.4536, M: 0.3564, winRate: 0.917, wlRatio: 13.79, pnl: 3956, wins: 11, positions: 12, medWin: 0.4152, medLoss: -0.0301 },
  { wallet: "0x0f969283107e288aa5a00d913c36d8dc3389e6a2", score: 1.54253, mu: 2.1846, M: 0.7061, winRate: 0.348, wlRatio: 2.73, pnl: 9479, wins: 8, positions: 23, medWin: 1.8975, medLoss: -0.6961 },
  { wallet: "0xfbc7f789c3040e14fb07f6cb810cb333497368a3", score: 1.51271, mu: 1.6277, M: 0.9294, winRate: 0.318, wlRatio: 1.19, pnl: 2903, wins: 7, positions: 22, medWin: 1.1031, medLoss: -0.9282 },
];

// 10 copyable from simulation wallets
const SIMULATION_COPYABLE = [
  { wallet: "0xc178402031235263f78c1a43bba8cd49d2be35b3", name: "asdalkjfa", score: 22.3503, mu: 22.35, M: 1.0, winRate: 0.74, wlRatio: 1.06 },
  { wallet: "0x1e109e389fb9cc1fc37360ab796b42c12d4bbeee", name: "ConfusedUngaBunga", score: 13.5177, mu: 13.52, M: 1.0, winRate: 0.66, wlRatio: 5.0 },
  { wallet: "0xfb81f27f1c8758d477332f8e751322c424da1cf3", name: "CiderApple", score: 12.8325, mu: 12.83, M: 1.0, winRate: 0.34, wlRatio: 6.14 },
  { wallet: "0x4d7fad0c5944fc24d4a67110f8e31abd5f559485", name: "KidNR", score: 10.5699, mu: 10.57, M: 1.0, winRate: 0.50, wlRatio: 13.87 },
  { wallet: "0x5ad5c4608c4661361b91c92e1091d2c5b43c37b9", name: "roberto73", score: 6.3512, mu: 6.35, M: 1.0, winRate: 0.43, wlRatio: 7.16 },
  { wallet: "0x5bbefc673462f1955e31b4a2347450724946c65d", name: "playboyisinthehouse", score: 6.1828, mu: 6.18, M: 1.0, winRate: 0.55, wlRatio: 1.66 },
  { wallet: "0x71cd52a9bf9121cf8376ba13999468f5d659912d", name: "Marcus177", score: 4.6866, mu: 4.69, M: 1.0, winRate: 0.55, wlRatio: 1.14 },
  { wallet: "0x74cbe13dba27a6a16805e9e7142ee68aa09cae6d", name: "C2H5O", score: 4.4744, mu: 5.62, M: 0.80, winRate: 0.64, wlRatio: 1.19 },
  { wallet: "0x99984e22205053950eb25453779267bcc1aee858", name: "skybuyer24", score: 1.8343, mu: 3.36, M: 0.55, winRate: 0.75, wlRatio: 3.99 },
  { wallet: "0x373551ed197d65a504390c365835cadb9ead7ad5", name: "1416CTaKolloKN", score: 0.0077, mu: 0.11, M: 0.07, winRate: 1.0, wlRatio: Infinity },
];

interface CombinedWallet {
  wallet: string;
  name: string;
  score: number;
  mu: number;
  M: number;
  winRate: number;
  wlRatio: number;
  pnl?: number;
  wins?: number;
  positions?: number;
  source: string;
}

// Combine and sort
const combined: CombinedWallet[] = [
  ...POOL_53_COPYABLE.map(w => ({
    ...w,
    source: "53-pool",
    name: w.wallet.slice(0,6) + "..." + w.wallet.slice(-4)
  })),
  ...SIMULATION_COPYABLE.map(w => ({
    ...w,
    source: "SIM-12",
  })),
].sort((a, b) => b.score - a.score);

console.log("═".repeat(115));
console.log("COMBINED RANKING: 15 from 53-Pool + 10 from Simulation (25 Total Copyable)");
console.log("═".repeat(115));
console.log("");
console.log("| Rank | Source  | Name/Wallet         | Score    | μ (Mean)  | M    | WinRate | W/L Ratio | PnL       |");
console.log("─".repeat(115));

for (let i = 0; i < combined.length; i++) {
  const w = combined[i];
  const sourceTag = w.source === "SIM-12" ? "🎯 SIM" : "   53P";
  const nameStr = (w.name || "").padEnd(19);
  const scoreStr = w.score.toFixed(4).padStart(8);
  const muStr = ((w.mu >= 0 ? "+" : "") + (w.mu * 100).toFixed(0) + "%").padStart(9);
  const mStr = ((w.M * 100).toFixed(0) + "%").padStart(4);
  const wrStr = ((w.winRate * 100).toFixed(0) + "%").padStart(7);
  const wlStr = w.wlRatio === Infinity ? "∞".padStart(9) : w.wlRatio.toFixed(2).padStart(9);
  const pnlStr = w.pnl ? ("$" + (w.pnl >= 0 ? "+" : "") + w.pnl.toFixed(0)).padStart(9) : "    -    ";

  console.log(`| ${(i+1).toString().padStart(4)} | ${sourceTag} | ${nameStr} | ${scoreStr} | ${muStr} | ${mStr} | ${wrStr} | ${wlStr} | ${pnlStr} |`);
}

console.log("─".repeat(115));

// Count by source in different tiers
console.log("");
console.log("TIER ANALYSIS:");
console.log("");

const top5 = combined.slice(0, 5);
const top10 = combined.slice(0, 10);
const top15 = combined.slice(0, 15);

const simInTop5 = top5.filter(w => w.source === "SIM-12").length;
const simInTop10 = top10.filter(w => w.source === "SIM-12").length;
const simInTop15 = top15.filter(w => w.source === "SIM-12").length;

console.log(`  Top 5:  🎯 SIM: ${simInTop5}/5  |  53P: ${5 - simInTop5}/5`);
console.log(`  Top 10: 🎯 SIM: ${simInTop10}/10 |  53P: ${10 - simInTop10}/10`);
console.log(`  Top 15: 🎯 SIM: ${simInTop15}/15 |  53P: ${15 - simInTop15}/15`);

// Show 53-pool wallets worth adding
console.log("");
console.log("═".repeat(115));
console.log("🆕 53-POOL WALLETS TO CONSIDER ADDING TO YOUR PORTFOLIO:");
console.log("═".repeat(115));
console.log("");

const poolWallets = combined.filter(w => w.source === "53-pool");
for (let i = 0; i < Math.min(5, poolWallets.length); i++) {
  const w = poolWallets[i];
  const rank = combined.findIndex(c => c.wallet === w.wallet) + 1;
  console.log(`  #${rank} overall. ${w.wallet}`);
  console.log(`         Score: ${w.score.toFixed(4)} | μ: +${(w.mu * 100).toFixed(0)}% | M: ${(w.M * 100).toFixed(0)}%`);
  console.log(`         Win Rate: ${(w.winRate * 100).toFixed(0)}% | W/L Ratio: ${w.wlRatio.toFixed(2)} | PnL: $${w.pnl?.toLocaleString()}`);
  console.log(`         Positions: ${w.positions} | Wins: ${w.wins}`);
  console.log("");
}

// Summary comparison
console.log("═".repeat(115));
console.log("SUMMARY COMPARISON:");
console.log("═".repeat(115));
console.log("");

const simWallets = combined.filter(w => w.source === "SIM-12");
const avgSimScore = simWallets.reduce((s, w) => s + w.score, 0) / simWallets.length;
const avgPoolScore = poolWallets.reduce((s, w) => s + w.score, 0) / poolWallets.length;

console.log("  Your 10 SIM wallets:");
console.log(`    - Avg Score: ${avgSimScore.toFixed(2)}`);
console.log(`    - Score Range: ${Math.min(...simWallets.map(w => w.score)).toFixed(2)} - ${Math.max(...simWallets.map(w => w.score)).toFixed(2)}`);
console.log("");
console.log("  15 from 53-Pool:");
console.log(`    - Avg Score: ${avgPoolScore.toFixed(2)}`);
console.log(`    - Score Range: ${Math.min(...poolWallets.map(w => w.score)).toFixed(2)} - ${Math.max(...poolWallets.map(w => w.score)).toFixed(2)}`);
console.log("");
console.log(`  🎯 Your simulation wallets have ${(avgSimScore / avgPoolScore).toFixed(1)}x higher average score!`);
