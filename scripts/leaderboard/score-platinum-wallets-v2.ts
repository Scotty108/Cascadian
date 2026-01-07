/**
 * Score Platinum Wallets V2 - Overnight Batch Runner
 *
 * Scores wallets using the EV-based platinum formula with Risk-Adjusted ROI per day:
 *
 * Formula 1: EV = (win_rate × median_win) + ((1 - win_rate) × median_loss)
 * Formula 2: Risk-Adjusted ROI = EV / |median_loss|
 * Formula 3: Risk-Adjusted ROI per Day = daily_ev / |median_loss|
 *
 * Platinum classification: risk_adjusted_roi_per_day >= 10%
 *
 * This finds wallets optimized for daily $1 flat-bet copy trading returns.
 *
 * Usage:
 *   npx tsx scripts/leaderboard/score-platinum-wallets-v2.ts
 *
 * Progress is saved to disk, so the script can be resumed if interrupted.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import * as fs from 'fs';
import { clickhouse } from '../../lib/clickhouse/client';
import { computePlatinumScore, PlatinumScore } from '../../lib/leaderboard/platinumScore';

// -----------------------------------------------------------------------------
// Configuration
// -----------------------------------------------------------------------------

const PROGRESS_FILE = '/tmp/platinum-scoring-v2-progress.json';
const MIN_RISK_ROI_PER_DAY = 0.10;  // Minimum 10% risk-adjusted ROI per day
const WORKERS = 4;          // Parallel workers
const WALLET_TIMEOUT = 60000;  // 60s per wallet
const TABLE_NAME = 'pm_platinum_wallets_v2';

// Known market makers to exclude
const MARKET_MAKERS = new Set([
  '0x8b7b5af4c488d4e0c13a4a7a1f2c3d4e5f6a7b8c',
  '0xd91ed098f010f83ad097a0c77f6561d2e5a71cf2',
  '0x2ad4e56b9c04f1f72ec3be5d6d86bba82db6c0c3',
  // Add more as identified
]);

// -----------------------------------------------------------------------------
// Progress Tracking
// -----------------------------------------------------------------------------

interface Progress {
  scored: string[];
  failed: string[];
  platinum: PlatinumScore[];
  lastUpdated: string;
}

function loadProgress(): Progress {
  if (fs.existsSync(PROGRESS_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf-8'));
    } catch {
      console.log('⚠ Could not load progress file, starting fresh');
    }
  }
  return { scored: [], failed: [], platinum: [], lastUpdated: new Date().toISOString() };
}

function saveProgress(progress: Progress) {
  progress.lastUpdated = new Date().toISOString();
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

// -----------------------------------------------------------------------------
// Get Wallet Pool - Full trader universe
// -----------------------------------------------------------------------------

async function getWalletPool(): Promise<string[]> {
  console.log('Loading wallet pool from pm_wallet_leaderboard_universe_v2...');

  // Use pre-computed leaderboard universe (10k+ vetted wallets)
  const query = `
    SELECT wallet
    FROM pm_wallet_leaderboard_universe_v2
    ORDER BY wallet
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows: any[] = await result.json();
  let wallets = rows.map(r => r.wallet);
  console.log(`Found ${wallets.length} wallets in leaderboard universe`);

  // Filter out known market makers
  wallets = wallets.filter(w => !MARKET_MAKERS.has(w));
  console.log(`After filtering market makers: ${wallets.length} wallets`);

  return wallets;
}

// -----------------------------------------------------------------------------
// Parallel Processing
// -----------------------------------------------------------------------------

async function processWallet(wallet: string): Promise<PlatinumScore | null> {
  try {
    const scorePromise = computePlatinumScore(wallet);
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Timeout')), WALLET_TIMEOUT)
    );

    return await Promise.race([scorePromise, timeoutPromise]);
  } catch (e: any) {
    return null;
  }
}

async function processPool(wallets: string[], progress: Progress): Promise<void> {
  const done = new Set([...progress.scored, ...progress.failed]);
  const remaining = wallets.filter(w => !done.has(w));

  console.log(`\n${'═'.repeat(80)}`);
  console.log('PLATINUM WALLET SCORING V2 - OVERNIGHT RUN');
  console.log('═'.repeat(80));
  console.log(`Formula 1: EV = (win_rate × median_win) + ((1 - win_rate) × median_loss)`);
  console.log(`Formula 2: Risk ROI = EV / |median_loss|`);
  console.log(`Formula 3: Risk ROI/Day = daily_ev / |median_loss|  ← PRIMARY METRIC`);
  console.log('─'.repeat(80));
  console.log(`Pool size:         ${wallets.length}`);
  console.log(`Already done:      ${done.size} (${progress.failed.length} failed)`);
  console.log(`Remaining:         ${remaining.length}`);
  console.log(`Platinum so far:   ${progress.platinum.length}`);
  console.log(`Min Risk ROI/Day:  ${(MIN_RISK_ROI_PER_DAY * 100).toFixed(0)}%`);
  console.log(`Workers:           ${WORKERS}`);
  console.log(`Progress file:     ${PROGRESS_FILE}`);
  console.log('═'.repeat(80));

  if (remaining.length === 0) {
    console.log('\n✅ All wallets already scored!');
    return;
  }

  const startTime = Date.now();
  let completed = 0;
  let errors = 0;

  // Process in batches
  for (let i = 0; i < remaining.length; i += WORKERS) {
    const batch = remaining.slice(i, i + WORKERS);

    const results = await Promise.all(batch.map(processWallet));

    for (let j = 0; j < batch.length; j++) {
      const wallet = batch[j];
      const score = results[j];

      if (!score) {
        progress.failed.push(wallet);
        errors++;
      } else {
        progress.scored.push(wallet);

        // Platinum classification: risk_adjusted_roi_per_day >= 10%
        if (score.eligible && score.risk_adjusted_roi_per_day >= MIN_RISK_ROI_PER_DAY) {
          progress.platinum.push(score);
          console.log(
            `\n🏆 PLATINUM #${progress.platinum.length}: ${wallet.slice(0, 14)}... | ` +
            `RiskROI/Day: ${(score.risk_adjusted_roi_per_day * 100).toFixed(1)}% | ` +
            `Daily EV: ${(score.daily_ev * 100).toFixed(1)}% | ` +
            `Age: ${score.age_days}d | ` +
            `PnL: $${score.realized_pnl.toFixed(0)}`
          );
        }
      }

      completed++;
    }

    // Save progress periodically
    if (completed % 20 === 0 || i + WORKERS >= remaining.length) {
      saveProgress(progress);
    }

    // Status update
    const elapsed = (Date.now() - startTime) / 1000;
    const rate = completed / elapsed;
    const eta = (remaining.length - completed) / rate;
    const pct = ((completed / remaining.length) * 100).toFixed(1);

    process.stdout.write(
      `\r[${completed}/${remaining.length}] ${pct}% | ` +
      `${rate.toFixed(2)}/s | ETA: ${(eta / 3600).toFixed(1)}h | ` +
      `Platinum: ${progress.platinum.length} | ` +
      `Errors: ${errors}    `
    );
  }

  // Final save
  saveProgress(progress);

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`\n\n${'═'.repeat(70)}`);
  console.log(`COMPLETE in ${elapsed} minutes`);
  console.log(`Total scored:    ${progress.scored.length}`);
  console.log(`Failed:          ${progress.failed.length}`);
  console.log(`Platinum found:  ${progress.platinum.length}`);
  console.log('═'.repeat(70));
}

// -----------------------------------------------------------------------------
// Output Results
// -----------------------------------------------------------------------------

function outputResults(progress: Progress) {
  // Sort by risk_adjusted_roi_per_day (primary metric)
  const platinum = progress.platinum.sort((a, b) => b.risk_adjusted_roi_per_day - a.risk_adjusted_roi_per_day);

  if (platinum.length === 0) {
    console.log('\n❌ No platinum wallets found');
    return;
  }

  console.log('\n' + '═'.repeat(200));
  console.log('TOP PLATINUM WALLETS (sorted by Risk-Adjusted ROI per Day)');
  console.log('═'.repeat(200));
  console.log(
    '| Rank | Wallet           | RiskROI/Day | Daily EV | EV/Pos  | RiskROI | WinRate | MedWin  | MedLoss | Age  | Pos/Day | Positions | PnL       |'
  );
  console.log('─'.repeat(200));

  for (let i = 0; i < Math.min(50, platinum.length); i++) {
    const p = platinum[i];
    const walletShort = p.wallet.slice(0, 6) + '...' + p.wallet.slice(-4);
    const riskRoiDay = p.risk_adjusted_roi_per_day === Infinity ? '∞' : (p.risk_adjusted_roi_per_day * 100).toFixed(1) + '%';
    const dailyEv = (p.daily_ev * 100).toFixed(1) + '%';
    const evPos = (p.ev_per_position * 100).toFixed(1) + '%';
    const riskRoi = p.risk_adjusted_roi === Infinity ? '∞' : (p.risk_adjusted_roi * 100).toFixed(0) + '%';
    const winRate = (p.win_rate * 100).toFixed(0) + '%';
    const medWin = (p.median_win * 100).toFixed(0) + '%';
    const medLoss = (p.median_loss * 100).toFixed(0) + '%';
    const pnl = '$' + (p.realized_pnl >= 0 ? '+' : '') + p.realized_pnl.toFixed(0);

    console.log(
      `| ${(i + 1).toString().padStart(4)} | ${walletShort.padEnd(16)} | ` +
      `${riskRoiDay.padStart(11)} | ${dailyEv.padStart(8)} | ${evPos.padStart(7)} | ${riskRoi.padStart(7)} | ${winRate.padStart(7)} | ` +
      `${medWin.padStart(7)} | ${medLoss.padStart(7)} | ` +
      `${p.age_days.toString().padStart(4)}d | ${p.positions_per_day.toFixed(1).padStart(7)} | ` +
      `${p.num_positions.toString().padStart(9)} | ${pnl.padStart(9)} |`
    );
  }

  console.log('═'.repeat(200));

  // CSV output with risk_adjusted_roi_per_day
  console.log('\n\n--- CSV OUTPUT ---\n');
  console.log(
    'rank,wallet,risk_adjusted_roi_per_day,daily_ev,ev_per_position,risk_adjusted_roi,win_rate,median_win,median_loss,' +
    'age_days,positions_per_day,num_positions,num_wins,num_losses,' +
    'cumulative_ev,mu_times_M,realized_pnl,roi_per_day,is_platinum'
  );

  for (let i = 0; i < platinum.length; i++) {
    const p = platinum[i];
    console.log(
      `${i + 1},${p.wallet},${p.risk_adjusted_roi_per_day},${p.daily_ev},${p.ev_per_position},${p.risk_adjusted_roi},${p.win_rate},` +
      `${p.median_win},${p.median_loss},${p.age_days},${p.positions_per_day},` +
      `${p.num_positions},${p.num_wins},${p.num_losses},${p.cumulative_ev},${p.mu_times_M},` +
      `${p.realized_pnl},${p.roi_per_day},${p.is_platinum}`
    );
  }

  console.log('\n--- END CSV ---\n');
}

// -----------------------------------------------------------------------------
// Insert into ClickHouse - New V2 table
// -----------------------------------------------------------------------------

async function insertToClickHouse(progress: Progress) {
  const platinum = progress.platinum;
  if (platinum.length === 0) return;

  console.log(`\n📥 Inserting platinum wallets to ClickHouse (${TABLE_NAME})...`);

  // Create V2 table with risk_adjusted_roi_per_day
  const createTable = `
    CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
      wallet String,
      risk_adjusted_roi_per_day Float64,
      daily_ev Float64,
      ev_per_position Float64,
      risk_adjusted_roi Float64,
      cumulative_ev Float64,
      win_rate Float64,
      median_win Float64,
      median_loss Float64,
      age_days UInt32,
      positions_per_day Float64,
      num_positions UInt32,
      num_wins UInt32,
      num_losses UInt32,
      mu_times_M Float64,
      realized_pnl Float64,
      roi_per_day Float64,
      is_platinum UInt8,
      scored_at DateTime DEFAULT now()
    ) ENGINE = ReplacingMergeTree(scored_at)
    ORDER BY wallet
  `;

  await clickhouse.command({ query: createTable });

  // Insert data
  const rows = platinum.map(p => ({
    wallet: p.wallet,
    risk_adjusted_roi_per_day: p.risk_adjusted_roi_per_day === Infinity ? 999999 : p.risk_adjusted_roi_per_day,
    daily_ev: p.daily_ev,
    ev_per_position: p.ev_per_position,
    risk_adjusted_roi: p.risk_adjusted_roi === Infinity ? 999999 : p.risk_adjusted_roi,
    cumulative_ev: p.cumulative_ev,
    win_rate: p.win_rate,
    median_win: p.median_win,
    median_loss: p.median_loss,
    age_days: p.age_days,
    positions_per_day: p.positions_per_day,
    num_positions: p.num_positions,
    num_wins: p.num_wins,
    num_losses: p.num_losses,
    mu_times_M: p.mu_times_M,
    realized_pnl: p.realized_pnl,
    roi_per_day: p.roi_per_day,
    is_platinum: p.is_platinum ? 1 : 0,
  }));

  await clickhouse.insert({
    table: TABLE_NAME,
    values: rows,
    format: 'JSONEachRow',
  });

  console.log(`✅ Inserted ${rows.length} platinum wallets to ${TABLE_NAME}`);
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

async function main() {
  console.log('═'.repeat(80));
  console.log('PLATINUM WALLET SCORING V2');
  console.log('Primary Metric: Risk-Adjusted ROI per Day = daily_ev / |median_loss|');
  console.log('═'.repeat(80) + '\n');

  console.log('Loading wallet pool...');
  const pool = await getWalletPool();
  console.log(`Found ${pool.length} eligible wallets\n`);

  const progress = loadProgress();

  await processPool(pool, progress);
  outputResults(progress);
  await insertToClickHouse(progress);

  console.log('\n✅ Platinum scoring V2 complete!');
  console.log(`Results saved to: ${PROGRESS_FILE}`);
  console.log(`Table: ${TABLE_NAME}`);
}

main().catch(console.error);
