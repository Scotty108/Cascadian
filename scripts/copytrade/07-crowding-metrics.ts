/**
 * Phase 7: Crowding Metrics
 *
 * The user explicitly said NOT to use "all-time PnL < $200k" as a crowding proxy.
 * Instead, we use:
 *
 * 1. VOLUME-BASED PROXY:
 *    - Total notional volume (higher = more visible)
 *    - Volume percentile rank among all traders
 *
 * 2. CO-TRADING INDEX (future enhancement):
 *    - How many other wallets trade the same markets?
 *    - Wallets that trade popular markets are more likely crowded
 *
 * 3. POLYMARKET VIEW COUNT (if available via API/scraping):
 *    - Profile view count from Polymarket
 *    - Would require Playwright scraping
 *
 * For now, we use volume as a proxy: wallets in top 10% by volume
 * are marked as "potentially crowded" (but NOT excluded - just flagged).
 */
import * as fs from 'fs';

interface Phase6Wallet {
  wallet: string;
  shadow_pnl: number;
  shadow_omega: number;
  total_notional: number;
  n_events: number;
  n_positions: number;
  n_trades: number;
  win_pct: number;
  first_trade: string;
  last_trade: string;
  avg_position_size: number;
  days_active: number;
  passed_filters: boolean;
}

interface CrowdingMetrics extends Phase6Wallet {
  // Volume metrics
  volume_percentile: number;
  is_high_volume: boolean;  // Top 10% by volume
  // Crowding flags
  crowding_risk: 'low' | 'medium' | 'high';
  crowding_notes: string[];
}

function computeCrowdingMetrics(): CrowdingMetrics[] {
  console.log('=== Phase 7: Crowding Metrics ===\n');
  console.log('NOTE: Using volume-based proxy for crowding.');
  console.log('      NOT using "PnL < $200k" as requested by user.\n');

  // Load Phase 6 output
  const phase6Path = 'exports/copytrade/phase6_filtered.json';
  if (!fs.existsSync(phase6Path)) {
    throw new Error('Phase 6 output not found. Run 06-apply-filters.ts first.');
  }
  const phase6 = JSON.parse(fs.readFileSync(phase6Path, 'utf-8'));
  const wallets: Phase6Wallet[] = phase6.wallets;

  console.log(`Loaded ${wallets.length} wallets from Phase 6\n`);

  // Calculate volume percentiles
  const sortedByVolume = [...wallets].sort((a, b) => b.total_notional - a.total_notional);
  const volumeRanks = new Map<string, number>();
  sortedByVolume.forEach((w, i) => {
    volumeRanks.set(w.wallet, ((i + 1) / wallets.length) * 100);
  });

  // Thresholds
  const HIGH_VOLUME_PERCENTILE = 10;  // Top 10% by volume
  const MEDIUM_VOLUME_PERCENTILE = 30; // Top 30% by volume

  const results: CrowdingMetrics[] = wallets.map(w => {
    const volume_percentile = volumeRanks.get(w.wallet) || 100;
    const is_high_volume = volume_percentile <= HIGH_VOLUME_PERCENTILE;

    // Determine crowding risk
    let crowding_risk: 'low' | 'medium' | 'high' = 'low';
    const crowding_notes: string[] = [];

    if (volume_percentile <= HIGH_VOLUME_PERCENTILE) {
      crowding_risk = 'high';
      crowding_notes.push(`Top ${HIGH_VOLUME_PERCENTILE}% by volume ($${Math.round(w.total_notional).toLocaleString()})`);
    } else if (volume_percentile <= MEDIUM_VOLUME_PERCENTILE) {
      crowding_risk = 'medium';
      crowding_notes.push(`Top ${MEDIUM_VOLUME_PERCENTILE}% by volume`);
    }

    // Additional crowding signals
    if (w.n_events > 300) {
      crowding_notes.push(`High market coverage (${w.n_events} events)`);
      if (crowding_risk === 'low') crowding_risk = 'medium';
    }

    if (w.avg_position_size > 3000) {
      crowding_notes.push(`Large avg position ($${w.avg_position_size})`);
      if (crowding_risk === 'low') crowding_risk = 'medium';
    }

    return {
      ...w,
      volume_percentile: Math.round(volume_percentile * 10) / 10,
      is_high_volume,
      crowding_risk,
      crowding_notes,
    };
  });

  // Sort by shadow omega for display
  results.sort((a, b) => b.shadow_omega - a.shadow_omega);

  // Display results
  console.log('=== CROWDING ANALYSIS ===');
  console.log('Wallet                                     | Shad Ω | P&L      | Volume     | Vol%ile | Crowd Risk | Notes');
  console.log('-------------------------------------------|--------|----------|------------|---------|------------|------');
  for (const r of results) {
    const pnl = r.shadow_pnl >= 0 ? `+$${Math.round(r.shadow_pnl).toLocaleString()}` : `-$${Math.abs(Math.round(r.shadow_pnl)).toLocaleString()}`;
    const vol = `$${Math.round(r.total_notional).toLocaleString()}`;
    const notes = r.crowding_notes.length > 0 ? r.crowding_notes[0].slice(0, 30) : '-';
    const riskEmoji = r.crowding_risk === 'high' ? '🔴' : r.crowding_risk === 'medium' ? '🟡' : '🟢';
    console.log(
      `${r.wallet} | ${String(r.shadow_omega).padStart(6)}x | ${pnl.padStart(8)} | ${vol.padStart(10)} | ${String(r.volume_percentile).padStart(7)} | ${riskEmoji} ${r.crowding_risk.padEnd(6)} | ${notes}`
    );
  }

  // Summary
  const highRisk = results.filter(r => r.crowding_risk === 'high').length;
  const mediumRisk = results.filter(r => r.crowding_risk === 'medium').length;
  const lowRisk = results.filter(r => r.crowding_risk === 'low').length;

  console.log('\n=== CROWDING SUMMARY ===');
  console.log(`🔴 High crowding risk: ${highRisk} wallets`);
  console.log(`🟡 Medium crowding risk: ${mediumRisk} wallets`);
  console.log(`🟢 Low crowding risk: ${lowRisk} wallets`);

  // Recommend diversification
  console.log('\n=== PORTFOLIO RECOMMENDATION ===');
  console.log('For a diversified copy-trading portfolio:');
  console.log('- Mix high/medium/low crowding risk wallets');
  console.log('- Higher allocation to low-crowding wallets (less competition)');
  console.log('- Monitor high-crowding wallets for edge erosion');

  // Save output
  const outputPath = 'exports/copytrade/phase7_crowding.json';
  fs.writeFileSync(outputPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    phase: '7',
    description: 'Crowding metrics using volume-based proxy',
    methodology: {
      note: 'NOT using PnL < $200k as crowding proxy per user request',
      volume_percentile: 'Rank by total notional volume',
      high_volume_threshold: `Top ${HIGH_VOLUME_PERCENTILE}%`,
      medium_volume_threshold: `Top ${MEDIUM_VOLUME_PERCENTILE}%`,
    },
    summary: {
      total: results.length,
      high_crowding_risk: highRisk,
      medium_crowding_risk: mediumRisk,
      low_crowding_risk: lowRisk,
    },
    wallets: results,
  }, null, 2));
  console.log(`\nSaved to: ${outputPath}`);

  return results;
}

if (require.main === module) {
  computeCrowdingMetrics();
}
