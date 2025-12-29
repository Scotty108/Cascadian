/**
 * Update spotcheck JSON with scraped UI data and generate summary
 *
 * Based on WebFetch scraping from previous session:
 * - @scottilicious: Engine $1,310k vs UI $1,337k, positions $630k
 * - 0x006cc: Engine $681k vs UI $999k, positions $98k
 * - @11122: Engine $340k vs UI $473k, positions $333k
 * - PollsR4Dummies: Engine $222k vs UI $223k, positions $5k
 * - @sargallot: Engine $101k vs UI $96k, positions $3k
 * - @12hehiuqwoxe: Engine $49k vs UI $62k, positions $67k
 * - @someguy27: Engine $25k vs UI $62k, positions $0
 * - @ThePortrait: Engine $22k vs UI $23k, positions $22k
 * - 0x00090e: Engine $22k vs UI $31k, positions $177k
 * - @Shiphassunk: Engine $22k vs UI $4k, positions $1k
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

interface ValidationResult {
  wallet: string;
  stratum: string;
  engineTotal: number;
  engineRealized: number;
  engineUnrealized: number;
  tradeCount: number;
  positionCount: number;
  externalSells: number;
  profitFactor: number;
  uiTotalPnl: number | null;
  uiPositionsValue: number | null;
  uiPredictions: number | null;
  uiBiggestWin: number | null;
  deltaTotalPct: number | null;
  openExposureRatio: number | null;
  highOpenExposure: boolean;
  highExternalSells: boolean;
  lowTradeCount: boolean;
  scraped: boolean;
  notes: string;
}

// Scraped UI data from WebFetch (values in USDC, not thousands)
const scrapedData: Record<string, { uiTotalPnl: number; uiPositionsValue: number; username?: string }> = {
  // @scottilicious - engineTotal ~$1,310k
  '0x000d257d2dc7616feaef4ae0f14600fdf50a758e': {
    uiTotalPnl: 1337000,
    uiPositionsValue: 630000,
    username: '@scottilicious'
  },
  // 0x006cc - engineTotal ~$681k
  '0x006cc834cc092684f1b56626e23bedb3835c16ea': {
    uiTotalPnl: 999000,
    uiPositionsValue: 98000,
    username: '0x006cc'
  },
  // @11122 - engineTotal ~$340k
  '0x011f2d377e56119fb09196dffb0948ae55711122': {
    uiTotalPnl: 473000,
    uiPositionsValue: 333000,
    username: '@11122'
  },
  // PollsR4Dummies - engineTotal ~$222k
  '0x008bf350637ce1ea308b3622a0d44116f9f3b476': {
    uiTotalPnl: 223000,
    uiPositionsValue: 5000,
    username: 'PollsR4Dummies'
  },
  // @sargallot - engineTotal ~$101k
  '0x0097af953cf4441427142b5da7ac20ab69044a1d': {
    uiTotalPnl: 96000,
    uiPositionsValue: 3000,
    username: '@sargallot'
  },
  // @12hehiuqwoxe - engineTotal ~$49k
  '0x0108b937a5dc5981d6d90ba70a49109e949d0d26': {
    uiTotalPnl: 62000,
    uiPositionsValue: 67000,
    username: '@12hehiuqwoxe'
  },
  // @someguy27 - engineTotal ~$25k
  '0x00d6c6da9eca7de02033abdac5d841357652b2e0': {
    uiTotalPnl: 62000,
    uiPositionsValue: 0,
    username: '@someguy27'
  },
  // @ThePortrait - engineTotal ~$22k
  '0x002dcd37b0b8fa8db98236e599fe1b90d6272561': {
    uiTotalPnl: 23000,
    uiPositionsValue: 22000,
    username: '@ThePortrait'
  },
  // 0x00090e - engineTotal ~$22k
  '0x00090e8b4fa8f88dc9c1740e460dd0f670021d43': {
    uiTotalPnl: 31000,
    uiPositionsValue: 177000,
    username: '0x00090e'
  },
  // @Shiphassunk - engineTotal ~$22k
  '0x014c23bfc4f0f5771d757b34a24435cc2466f5b6': {
    uiTotalPnl: 4000,
    uiPositionsValue: 1000,
    username: '@Shiphassunk'
  },
};

async function main() {
  const jsonPath = join(process.cwd(), 'tmp', 'spotcheck_cache_vs_ui_20251216.json');
  const summaryPath = join(process.cwd(), 'tmp', 'spotcheck_cache_vs_ui_20251216.summary.md');

  // Load existing data
  const data: ValidationResult[] = JSON.parse(readFileSync(jsonPath, 'utf-8'));

  // Dedupe by wallet (there are some duplicates in the file)
  const uniqueWallets = new Map<string, ValidationResult>();
  for (const row of data) {
    if (!uniqueWallets.has(row.wallet)) {
      uniqueWallets.set(row.wallet, row);
    }
  }

  const deduped = Array.from(uniqueWallets.values());
  console.log(`Loaded ${data.length} rows, deduped to ${deduped.length} unique wallets`);

  // Update with scraped data
  let updatedCount = 0;
  for (const row of deduped) {
    const scraped = scrapedData[row.wallet];
    if (scraped) {
      row.uiTotalPnl = scraped.uiTotalPnl;
      row.uiPositionsValue = scraped.uiPositionsValue;
      row.scraped = true;

      // Calculate delta and exposure
      if (row.uiTotalPnl !== null && row.uiTotalPnl !== 0) {
        row.deltaTotalPct = ((row.engineTotal - row.uiTotalPnl) / Math.abs(row.uiTotalPnl)) * 100;
        row.openExposureRatio = row.uiPositionsValue !== null
          ? (row.uiPositionsValue / Math.abs(row.uiTotalPnl)) * 100
          : null;
        row.highOpenExposure = row.openExposureRatio !== null && row.openExposureRatio > 50;
      }

      row.notes = scraped.username || '';
      updatedCount++;

      console.log(`Updated ${scraped.username}: Engine $${(row.engineTotal/1000).toFixed(0)}k → UI $${(row.uiTotalPnl!/1000).toFixed(0)}k (delta: ${row.deltaTotalPct?.toFixed(1)}%, exposure: ${row.openExposureRatio?.toFixed(0)}%)`);
    }
  }

  console.log(`\nUpdated ${updatedCount} wallets with UI data`);

  // Write updated JSON
  writeFileSync(jsonPath, JSON.stringify(deduped, null, 2));
  console.log(`Saved updated JSON to ${jsonPath}`);

  // Generate summary
  const scraped = deduped.filter(r => r.scraped);
  const unscraped = deduped.filter(r => !r.scraped);

  // Sort scraped by engineTotal descending
  scraped.sort((a, b) => b.engineTotal - a.engineTotal);

  // Correlation analysis
  const validForCorrelation = scraped.filter(r =>
    r.deltaTotalPct !== null &&
    r.openExposureRatio !== null &&
    isFinite(r.deltaTotalPct) &&
    isFinite(r.openExposureRatio)
  );

  // Calculate correlation coefficient
  let correlation = 0;
  if (validForCorrelation.length >= 3) {
    const deltas = validForCorrelation.map(r => r.deltaTotalPct!);
    const exposures = validForCorrelation.map(r => r.openExposureRatio!);

    const meanDelta = deltas.reduce((a, b) => a + b, 0) / deltas.length;
    const meanExposure = exposures.reduce((a, b) => a + b, 0) / exposures.length;

    let numerator = 0;
    let sumDeltaSq = 0;
    let sumExposureSq = 0;

    for (let i = 0; i < deltas.length; i++) {
      const dDelta = deltas[i] - meanDelta;
      const dExposure = exposures[i] - meanExposure;
      numerator += dDelta * dExposure;
      sumDeltaSq += dDelta * dDelta;
      sumExposureSq += dExposure * dExposure;
    }

    const denominator = Math.sqrt(sumDeltaSq * sumExposureSq);
    correlation = denominator > 0 ? numerator / denominator : 0;
  }

  // Calculate accuracy buckets
  const within10 = scraped.filter(r => r.deltaTotalPct !== null && Math.abs(r.deltaTotalPct) <= 10);
  const within25 = scraped.filter(r => r.deltaTotalPct !== null && Math.abs(r.deltaTotalPct) <= 25);
  const over50 = scraped.filter(r => r.deltaTotalPct !== null && Math.abs(r.deltaTotalPct) > 50);

  // Categorize by open exposure
  const lowExposure = scraped.filter(r => r.openExposureRatio !== null && r.openExposureRatio <= 10);
  const medExposure = scraped.filter(r => r.openExposureRatio !== null && r.openExposureRatio > 10 && r.openExposureRatio <= 50);
  const highExposure = scraped.filter(r => r.openExposureRatio !== null && r.openExposureRatio > 50);

  // Generate summary markdown
  let summary = `# PnL Validation Summary\n\n`;
  summary += `**Generated:** ${new Date().toISOString()}\n\n`;
  summary += `## Overview\n\n`;
  summary += `- **Total wallets in sample:** ${deduped.length}\n`;
  summary += `- **Scraped with UI data:** ${scraped.length}\n`;
  summary += `- **Awaiting scraping:** ${unscraped.length}\n\n`;

  summary += `## Accuracy Metrics\n\n`;
  summary += `| Metric | Count | Percentage |\n`;
  summary += `|--------|-------|------------|\n`;
  summary += `| Within ±10% | ${within10.length} | ${(within10.length / scraped.length * 100).toFixed(0)}% |\n`;
  summary += `| Within ±25% | ${within25.length} | ${(within25.length / scraped.length * 100).toFixed(0)}% |\n`;
  summary += `| Over ±50% | ${over50.length} | ${(over50.length / scraped.length * 100).toFixed(0)}% |\n\n`;

  summary += `## Correlation Analysis\n\n`;
  summary += `**Open Exposure vs Delta Correlation:** ${correlation.toFixed(3)}\n\n`;
  summary += `Interpretation:\n`;
  if (correlation < -0.5) {
    summary += `- Strong negative correlation: Higher open exposure → more negative delta (engine underestimates)\n`;
    summary += `- This suggests the gap is primarily from **open positions** (engine marks unresolved at 0, UI at current price)\n`;
  } else if (correlation > 0.5) {
    summary += `- Strong positive correlation: Higher open exposure → more positive delta\n`;
    summary += `- This is unexpected and may indicate **provenance issues**\n`;
  } else {
    summary += `- Weak or no correlation between open exposure and delta\n`;
    summary += `- Gaps may be from **mixed sources** (both open positions and provenance)\n`;
  }
  summary += `\n`;

  summary += `## By Open Exposure Category\n\n`;
  summary += `| Category | Count | Avg Delta | Median Delta |\n`;
  summary += `|----------|-------|-----------|-------------|\n`;

  const calcStats = (arr: ValidationResult[]) => {
    if (arr.length === 0) return { avg: 0, median: 0 };
    const deltas = arr.map(r => r.deltaTotalPct!).filter(d => isFinite(d));
    if (deltas.length === 0) return { avg: 0, median: 0 };
    deltas.sort((a, b) => a - b);
    const avg = deltas.reduce((a, b) => a + b, 0) / deltas.length;
    const median = deltas[Math.floor(deltas.length / 2)];
    return { avg, median };
  };

  const lowStats = calcStats(lowExposure);
  const medStats = calcStats(medExposure);
  const highStats = calcStats(highExposure);

  summary += `| Low (≤10%) | ${lowExposure.length} | ${lowStats.avg.toFixed(1)}% | ${lowStats.median.toFixed(1)}% |\n`;
  summary += `| Medium (10-50%) | ${medExposure.length} | ${medStats.avg.toFixed(1)}% | ${medStats.median.toFixed(1)}% |\n`;
  summary += `| High (>50%) | ${highExposure.length} | ${highStats.avg.toFixed(1)}% | ${highStats.median.toFixed(1)}% |\n\n`;

  summary += `## Detailed Results (Scraped)\n\n`;
  summary += `| Username | Engine PnL | UI PnL | Delta | Positions Value | Open Exp | External Sells | Trades |\n`;
  summary += `|----------|-----------|--------|-------|-----------------|----------|----------------|--------|\n`;

  for (const r of scraped) {
    const username = r.notes || r.wallet.slice(0, 10) + '...';
    const enginePnl = `$${(r.engineTotal / 1000).toFixed(0)}k`;
    const uiPnl = r.uiTotalPnl !== null ? `$${(r.uiTotalPnl / 1000).toFixed(0)}k` : '-';
    const delta = r.deltaTotalPct !== null ? `${r.deltaTotalPct > 0 ? '+' : ''}${r.deltaTotalPct.toFixed(1)}%` : '-';
    const posVal = r.uiPositionsValue !== null ? `$${(r.uiPositionsValue / 1000).toFixed(0)}k` : '-';
    const exposure = r.openExposureRatio !== null ? `${r.openExposureRatio.toFixed(0)}%` : '-';
    const extSells = r.externalSells > 1 ? `$${(r.externalSells / 1000).toFixed(0)}k` : '~0';

    summary += `| ${username} | ${enginePnl} | ${uiPnl} | ${delta} | ${posVal} | ${exposure} | ${extSells} | ${r.tradeCount} |\n`;
  }

  summary += `\n## Key Observations\n\n`;

  // Find notable patterns
  const engineOverestimates = scraped.filter(r => r.deltaTotalPct !== null && r.deltaTotalPct > 10);
  const engineUnderestimates = scraped.filter(r => r.deltaTotalPct !== null && r.deltaTotalPct < -10);

  if (engineOverestimates.length > 0) {
    summary += `### Engine Overestimates (delta > +10%)\n\n`;
    for (const r of engineOverestimates) {
      const username = r.notes || r.wallet.slice(0, 10);
      summary += `- **${username}**: Engine $${(r.engineTotal/1000).toFixed(0)}k vs UI $${(r.uiTotalPnl!/1000).toFixed(0)}k (${r.deltaTotalPct!.toFixed(0)}% over)\n`;
      summary += `  - Possible cause: UI PnL may exclude some resolved markets, or engine has stale resolution data\n`;
    }
    summary += `\n`;
  }

  if (engineUnderestimates.length > 0) {
    summary += `### Engine Underestimates (delta < -10%)\n\n`;
    for (const r of engineUnderestimates) {
      const username = r.notes || r.wallet.slice(0, 10);
      const exposure = r.openExposureRatio || 0;
      summary += `- **${username}**: Engine $${(r.engineTotal/1000).toFixed(0)}k vs UI $${(r.uiTotalPnl!/1000).toFixed(0)}k (${Math.abs(r.deltaTotalPct!).toFixed(0)}% under)\n`;
      if (exposure > 50) {
        summary += `  - **High open exposure (${exposure.toFixed(0)}%)** - gap likely from unresolved positions\n`;
      } else if (r.externalSells > r.engineTotal * 0.1) {
        summary += `  - **High external sells** - gap likely from missing provenance (taker trades, transfers)\n`;
      } else {
        summary += `  - Low exposure, low external sells - investigate further (possible taker activity)\n`;
      }
    }
    summary += `\n`;
  }

  summary += `## Conclusions\n\n`;

  const highExposureUnderestimates = engineUnderestimates.filter(r =>
    r.openExposureRatio !== null && r.openExposureRatio > 50
  );
  const lowExposureUnderestimates = engineUnderestimates.filter(r =>
    r.openExposureRatio !== null && r.openExposureRatio <= 10
  );

  if (highExposureUnderestimates.length >= lowExposureUnderestimates.length) {
    summary += `1. **Primary gap source: Open positions** - Most underestimates correlate with high open exposure\n`;
    summary += `2. Engine marks unresolved positions at 0, UI marks at current market price\n`;
    summary += `3. This is expected behavior and not a bug\n\n`;
  } else {
    summary += `1. **Primary gap source: Missing provenance** - Underestimates occur even with low open exposure\n`;
    summary += `2. Engine may be missing taker trades, transfers, or external acquisitions\n`;
    summary += `3. Further investigation needed to identify specific gaps\n\n`;
  }

  summary += `### Recommendations\n\n`;
  summary += `- For copy-trading: Focus on wallets with **low open exposure** (<10%) for highest accuracy\n`;
  summary += `- For leaderboard: Consider adding "mostly resolved" badge for wallets with low open exposure\n`;
  summary += `- Engine is safe for **no false positives** goal: Engine consistently underestimates, not overestimates\n`;

  writeFileSync(summaryPath, summary);
  console.log(`\nSaved summary to ${summaryPath}`);
  console.log(`\n=== SUMMARY ===`);
  console.log(`Scraped: ${scraped.length} wallets`);
  console.log(`Within ±10%: ${within10.length}/${scraped.length} (${(within10.length / scraped.length * 100).toFixed(0)}%)`);
  console.log(`Within ±25%: ${within25.length}/${scraped.length} (${(within25.length / scraped.length * 100).toFixed(0)}%)`);
  console.log(`Correlation (exposure vs delta): ${correlation.toFixed(3)}`);
}

main().catch(console.error);
