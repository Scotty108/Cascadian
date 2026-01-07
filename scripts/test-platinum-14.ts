/**
 * Test platinum scoring on 14 wallets to compare EV vs μ×M formulas
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { computePlatinumScore } from '../lib/leaderboard/platinumScore';

const WALLETS = [
  '0xbd78a780bd24ec2244c3d848c7781f315c87d376',
  '0x63e3e2bd72ce83336104c25d91757a1280c27d85',
  '0xaf0e8d81903a627056a60f291fe4db6a596322d5',
  '0xc30f6390d6fb95c41c1c6c20e3c37b985aa22e65',
  '0xd2020940c4b8a45c6e4a4a52b00fedc98585964d',
  '0x2938916bc4009581677a9451fe3ac30d811bf251',
  '0x552000e88ae1283034d56b5966f51055783332ff',
  '0x2b2866a724e73bf45af306036f12f20170b4d021',
  '0xfd4263b3ad08226034fe1b1ea678a46d80b58895',
  '0xfbd42fd52d8ae47785356e05dfc966a341f6efec',
  '0xf9442951035b143f3b5a30bb4fa1f4f6b908c249',
  '0x9e1f86ef27beb047edc91d97e260c4da210df3c4',
  '0xb3e6f092d890fd935ee2e18595aaad8af7fb3218',
  '0x0f969283107e288aa5a00d913c36d8dc3389e6a2',
];

async function main() {
  console.log('═'.repeat(200));
  console.log('PLATINUM SCORING TEST - Comparing EV vs μ×M formulas');
  console.log('═'.repeat(200));
  console.log('');
  console.log('Formulas:');
  console.log('  EV = (win_rate × median_win) + ((1 - win_rate) × median_loss)  →  Expected $ per $1 bet');
  console.log('  Risk-Adjusted ROI = EV / |median_loss|  →  Return per unit of risk');
  console.log('  Daily EV = EV × positions_per_day  →  Expected $ per day');
  console.log('  μ×M = mean(returns) × median(|returns|)  →  Old copytrade score');
  console.log('');

  const results = [];

  for (let i = 0; i < WALLETS.length; i++) {
    const wallet = WALLETS[i];
    process.stdout.write(`\r[${i + 1}/${WALLETS.length}] Scoring ${wallet.slice(0, 14)}...`);

    try {
      const score = await computePlatinumScore(wallet);
      results.push(score);
    } catch (e: any) {
      console.log(`\nError: ${wallet} - ${e.message}`);
    }
  }

  console.log('\n');

  // Sort by Daily EV
  const byDailyEv = [...results].filter(r => r.eligible).sort((a, b) => b.daily_ev - a.daily_ev);
  const byRiskRoi = [...results].filter(r => r.eligible).sort((a, b) => b.risk_adjusted_roi - a.risk_adjusted_roi);
  const byMuM = [...results].filter(r => r.eligible).sort((a, b) => b.mu_times_M - a.mu_times_M);

  console.log('═'.repeat(200));
  console.log('RESULTS (sorted by Daily EV)');
  console.log('═'.repeat(200));
  console.log(
    '| Rank | Wallet           | Daily EV   | EV/Pos    | RiskROI   | WinRate | MedWin   | MedLoss  | Age  | Pos/Day | Pos  | μ×M      | Cumul EV   | PnL        |'
  );
  console.log('─'.repeat(200));

  for (let i = 0; i < byDailyEv.length; i++) {
    const p = byDailyEv[i];
    const walletShort = p.wallet.slice(0, 6) + '...' + p.wallet.slice(-4);
    const dailyEv = '$' + (p.daily_ev >= 0 ? '+' : '') + p.daily_ev.toFixed(2);
    const evPos = (p.ev_per_position * 100).toFixed(1) + '%';
    const riskRoi = p.risk_adjusted_roi === Infinity ? '∞' : (p.risk_adjusted_roi * 100).toFixed(0) + '%';
    const winRate = (p.win_rate * 100).toFixed(0) + '%';
    const medWin = '+' + (p.median_win * 100).toFixed(0) + '%';
    const medLoss = (p.median_loss * 100).toFixed(0) + '%';
    const muM = p.mu_times_M.toFixed(4);
    const cumulEv = '$' + (p.cumulative_ev >= 0 ? '+' : '') + p.cumulative_ev.toFixed(0);
    const pnl = '$' + (p.realized_pnl >= 0 ? '+' : '') + p.realized_pnl.toFixed(0);

    console.log(
      `| ${(i + 1).toString().padStart(4)} | ${walletShort.padEnd(16)} | ` +
      `${dailyEv.padStart(10)} | ${evPos.padStart(9)} | ${riskRoi.padStart(9)} | ${winRate.padStart(7)} | ` +
      `${medWin.padStart(8)} | ${medLoss.padStart(8)} | ` +
      `${p.age_days.toString().padStart(4)}d | ${p.positions_per_day.toFixed(1).padStart(7)} | ` +
      `${p.num_positions.toString().padStart(4)} | ${muM.padStart(8)} | ${cumulEv.padStart(10)} | ${pnl.padStart(10)} |`
    );
  }

  console.log('═'.repeat(200));

  // Ranking comparison
  console.log('\n📊 RANKING COMPARISON:');
  console.log('─'.repeat(100));
  console.log('| Wallet           | Daily EV Rank | Risk ROI Rank | μ×M Rank | Best For        |');
  console.log('─'.repeat(100));

  for (const p of byDailyEv) {
    const walletShort = p.wallet.slice(0, 6) + '...' + p.wallet.slice(-4);
    const evRank = byDailyEv.findIndex(x => x.wallet === p.wallet) + 1;
    const riskRank = byRiskRoi.findIndex(x => x.wallet === p.wallet) + 1;
    const muMRank = byMuM.findIndex(x => x.wallet === p.wallet) + 1;

    let bestFor = '';
    if (evRank <= 3) bestFor = 'Daily profits';
    else if (riskRank <= 3) bestFor = 'Low risk';
    else if (muMRank <= 3) bestFor = 'Consistency';

    console.log(
      `| ${walletShort.padEnd(16)} | ${evRank.toString().padStart(13)} | ${riskRank.toString().padStart(13)} | ` +
      `${muMRank.toString().padStart(8)} | ${bestFor.padEnd(15)} |`
    );
  }

  console.log('─'.repeat(100));

  // Key insights
  console.log('\n🔑 KEY INSIGHTS:');
  console.log('');

  const topByEv = byDailyEv[0];
  const topByRisk = byRiskRoi[0];
  const topByMuM = byMuM[0];

  console.log(`  📈 Best for Daily Profits: ${topByEv.wallet.slice(0, 14)}...`);
  console.log(`     Daily EV: $${topByEv.daily_ev.toFixed(2)} | EV/pos: ${(topByEv.ev_per_position * 100).toFixed(1)}% | ${topByEv.positions_per_day.toFixed(1)} pos/day`);
  console.log('');
  console.log(`  🛡️  Best Risk-Adjusted: ${topByRisk.wallet.slice(0, 14)}...`);
  console.log(`     Risk ROI: ${(topByRisk.risk_adjusted_roi * 100).toFixed(0)}% | Med Loss: ${(topByRisk.median_loss * 100).toFixed(0)}%`);
  console.log('');
  console.log(`  📊 Best by Old μ×M: ${topByMuM.wallet.slice(0, 14)}...`);
  console.log(`     μ×M: ${topByMuM.mu_times_M.toFixed(4)}`);
  console.log('');

  // Ineligible wallets
  const ineligible = results.filter(r => !r.eligible);
  if (ineligible.length > 0) {
    console.log(`\n⚠️  ${ineligible.length} wallets ineligible:`);
    for (const p of ineligible) {
      console.log(`   ${p.wallet.slice(0, 14)}... - ${p.reason}`);
    }
  }
}

main().catch(console.error);
