/**
 * Stratified Validation: Engine PnL vs UI PnL
 *
 * Goal: Determine if 28-32% engine-UI gaps are from:
 * - Open positions (engine marks unresolved at 0, UI marks at current price)
 * - Missing provenance (taker trades, transfers, external sells)
 *
 * Comparison approach:
 * - engine_realized vs UI implied closed (if available)
 * - engine_total vs UI total
 * - open_exposure_ratio = ui_positions_value / abs(ui_total)
 *
 * Strata:
 * - 20 top by engine_pnl (whales)
 * - 20 top by profit_factor where engine_pnl >= $5k (quality)
 * - 20 random in $500-$1k band
 * - 20 random in $1k-$5k band
 * - 20 random in $5k+ band
 *
 * Output:
 * - tmp/spotcheck_cache_vs_ui_YYYYMMDD.json (raw results)
 * - tmp/spotcheck_cache_vs_ui_YYYYMMDD.summary.md (analysis)
 *
 * Run with: npx tsx scripts/pnl/spotcheck-cache-vs-ui.ts
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import * as fs from 'fs';
import { getClickHouseClient } from '../../lib/clickhouse/client';

interface CacheRow {
  wallet: string;
  engine_pnl: number;
  realized_pnl: number;
  unrealized_pnl: number;
  trade_count: number;
  position_count: number;
  external_sells: number;
  profit_factor: number;
  win_count: number;
  loss_count: number;
}

interface ValidationResult {
  wallet: string;
  stratum: string;

  // Engine metrics (from cache)
  engineTotal: number;
  engineRealized: number;
  engineUnrealized: number;
  tradeCount: number;
  positionCount: number;
  externalSells: number;
  profitFactor: number;

  // UI metrics (from Playwright scrape)
  uiTotalPnl: number | null;
  uiPositionsValue: number | null;
  uiPredictions: number | null;
  uiBiggestWin: number | null;

  // Computed deltas
  deltaTotalPct: number | null;       // (engineTotal - uiTotal) / abs(uiTotal)
  openExposureRatio: number | null;   // uiPositionsValue / abs(uiTotal)

  // Diagnostic flags
  highOpenExposure: boolean;          // openExposureRatio > 0.3
  highExternalSells: boolean;         // externalSells > tradeCount * 0.1
  lowTradeCount: boolean;             // tradeCount < 50

  // Status
  scraped: boolean;
  notes: string;
}

async function loadStratifiedSample(client: any): Promise<ValidationResult[]> {
  const results: ValidationResult[] = [];

  // Stratum 1: Top 20 by engine_pnl
  console.log('Loading stratum: top_by_pnl...');
  const topByPnl = await client.query({
    query: `
      SELECT * FROM pm_wallet_engine_pnl_cache
      ORDER BY engine_pnl DESC
      LIMIT 20
    `,
    format: 'JSONEachRow',
  });
  for (const row of (await topByPnl.json()) as CacheRow[]) {
    results.push(createResult(row, 'top_by_pnl'));
  }

  // Stratum 2: Top 20 by profit_factor where engine_pnl >= 5000
  console.log('Loading stratum: top_by_pf...');
  const topByPf = await client.query({
    query: `
      SELECT * FROM pm_wallet_engine_pnl_cache
      WHERE engine_pnl >= 5000
      ORDER BY profit_factor DESC
      LIMIT 20
    `,
    format: 'JSONEachRow',
  });
  for (const row of (await topByPf.json()) as CacheRow[]) {
    // Skip if already in results
    if (!results.some((r) => r.wallet === row.wallet)) {
      results.push(createResult(row, 'top_by_pf'));
    }
  }

  // Stratum 3: Random in $500-$1k band
  console.log('Loading stratum: band_500_1k...');
  const band500 = await client.query({
    query: `
      SELECT * FROM pm_wallet_engine_pnl_cache
      WHERE engine_pnl > 500 AND engine_pnl <= 1000
      ORDER BY rand()
      LIMIT 20
    `,
    format: 'JSONEachRow',
  });
  for (const row of (await band500.json()) as CacheRow[]) {
    if (!results.some((r) => r.wallet === row.wallet)) {
      results.push(createResult(row, 'band_500_1k'));
    }
  }

  // Stratum 4: Random in $1k-$5k band
  console.log('Loading stratum: band_1k_5k...');
  const band1k = await client.query({
    query: `
      SELECT * FROM pm_wallet_engine_pnl_cache
      WHERE engine_pnl > 1000 AND engine_pnl <= 5000
      ORDER BY rand()
      LIMIT 20
    `,
    format: 'JSONEachRow',
  });
  for (const row of (await band1k.json()) as CacheRow[]) {
    if (!results.some((r) => r.wallet === row.wallet)) {
      results.push(createResult(row, 'band_1k_5k'));
    }
  }

  // Stratum 5: Random in $5k+ band
  console.log('Loading stratum: band_5k_plus...');
  const band5k = await client.query({
    query: `
      SELECT * FROM pm_wallet_engine_pnl_cache
      WHERE engine_pnl > 5000
      ORDER BY rand()
      LIMIT 20
    `,
    format: 'JSONEachRow',
  });
  for (const row of (await band5k.json()) as CacheRow[]) {
    if (!results.some((r) => r.wallet === row.wallet)) {
      results.push(createResult(row, 'band_5k_plus'));
    }
  }

  return results;
}

function createResult(row: CacheRow, stratum: string): ValidationResult {
  const pf = Number(row.profit_factor) || Number((row as any).omega) || 1;
  return {
    wallet: row.wallet,
    stratum,
    engineTotal: Number(row.engine_pnl),
    engineRealized: Number(row.realized_pnl),
    engineUnrealized: Number(row.unrealized_pnl),
    tradeCount: Number(row.trade_count),
    positionCount: Number(row.position_count),
    externalSells: Number(row.external_sells),
    profitFactor: pf,
    uiTotalPnl: null,
    uiPositionsValue: null,
    uiPredictions: null,
    uiBiggestWin: null,
    deltaTotalPct: null,
    openExposureRatio: null,
    highOpenExposure: false,
    highExternalSells: Number(row.external_sells) > Number(row.trade_count) * 0.1,
    lowTradeCount: Number(row.trade_count) < 50,
    scraped: false,
    notes: '',
  };
}

function computeDeltas(result: ValidationResult): void {
  if (result.uiTotalPnl === null) return;

  // Delta total: (engine - ui) / abs(ui)
  if (Math.abs(result.uiTotalPnl) > 0) {
    result.deltaTotalPct = ((result.engineTotal - result.uiTotalPnl) / Math.abs(result.uiTotalPnl)) * 100;
  }

  // Open exposure ratio: positions_value / abs(total_pnl)
  if (result.uiPositionsValue !== null && Math.abs(result.uiTotalPnl) > 0) {
    result.openExposureRatio = result.uiPositionsValue / Math.abs(result.uiTotalPnl);
    result.highOpenExposure = result.openExposureRatio > 0.3;
  }
}

function generateSummary(results: ValidationResult[]): string {
  const scraped = results.filter((r) => r.scraped);
  const total = scraped.length;

  if (total === 0) {
    return `# Validation Summary\n\n**No UI data scraped yet.**\n\nRun Playwright to scrape UI values for ${results.length} wallets.\n`;
  }

  let md = `# Stratified Validation Summary\n\n`;
  md += `**Date:** ${new Date().toISOString().slice(0, 10)}\n`;
  md += `**Wallets validated:** ${total}\n\n`;

  // Delta distribution for TOTAL
  md += `## Delta Distribution (Engine Total vs UI Total)\n\n`;
  const within10 = scraped.filter((r) => r.deltaTotalPct !== null && Math.abs(r.deltaTotalPct) <= 10);
  const within25 = scraped.filter((r) => r.deltaTotalPct !== null && Math.abs(r.deltaTotalPct) <= 25);
  const over25 = scraped.filter((r) => r.deltaTotalPct !== null && Math.abs(r.deltaTotalPct) > 25);

  md += `| Threshold | Count | % |\n`;
  md += `|-----------|-------|---|\n`;
  md += `| Within 10% | ${within10.length} | ${((within10.length / total) * 100).toFixed(0)}% |\n`;
  md += `| Within 25% | ${within25.length} | ${((within25.length / total) * 100).toFixed(0)}% |\n`;
  md += `| Over 25% | ${over25.length} | ${((over25.length / total) * 100).toFixed(0)}% |\n\n`;

  // Open exposure analysis
  md += `## Open Exposure Analysis\n\n`;
  const highOpen = scraped.filter((r) => r.highOpenExposure);
  const highOpenOver25 = highOpen.filter((r) => r.deltaTotalPct !== null && Math.abs(r.deltaTotalPct) > 25);
  const lowOpen = scraped.filter((r) => !r.highOpenExposure);
  const lowOpenOver25 = lowOpen.filter((r) => r.deltaTotalPct !== null && Math.abs(r.deltaTotalPct) > 25);

  md += `| Open Exposure | Count | Over 25% Delta | Correlation |\n`;
  md += `|---------------|-------|----------------|-------------|\n`;
  md += `| High (>30%) | ${highOpen.length} | ${highOpenOver25.length} (${highOpen.length > 0 ? ((highOpenOver25.length / highOpen.length) * 100).toFixed(0) : 0}%) | `;
  md += highOpen.length > 0 && highOpenOver25.length / highOpen.length > 0.5 ? 'Strong' : 'Weak';
  md += ` |\n`;
  md += `| Low (<=30%) | ${lowOpen.length} | ${lowOpenOver25.length} (${lowOpen.length > 0 ? ((lowOpenOver25.length / lowOpen.length) * 100).toFixed(0) : 0}%) | `;
  md += lowOpen.length > 0 && lowOpenOver25.length / lowOpen.length > 0.5 ? 'Strong' : 'Weak';
  md += ` |\n\n`;

  // External sells analysis
  md += `## External Sells Analysis\n\n`;
  const highExternal = scraped.filter((r) => r.highExternalSells);
  const highExternalOver25 = highExternal.filter((r) => r.deltaTotalPct !== null && Math.abs(r.deltaTotalPct) > 25);
  const lowExternal = scraped.filter((r) => !r.highExternalSells);
  const lowExternalOver25 = lowExternal.filter((r) => r.deltaTotalPct !== null && Math.abs(r.deltaTotalPct) > 25);

  md += `| External Sells | Count | Over 25% Delta | Correlation |\n`;
  md += `|----------------|-------|----------------|-------------|\n`;
  md += `| High (>10% of trades) | ${highExternal.length} | ${highExternalOver25.length} (${highExternal.length > 0 ? ((highExternalOver25.length / highExternal.length) * 100).toFixed(0) : 0}%) | `;
  md += highExternal.length > 0 && highExternalOver25.length / highExternal.length > 0.5 ? 'Strong' : 'Weak';
  md += ` |\n`;
  md += `| Low (<=10% of trades) | ${lowExternal.length} | ${lowExternalOver25.length} (${lowExternal.length > 0 ? ((lowExternalOver25.length / lowExternal.length) * 100).toFixed(0) : 0}%) | `;
  md += lowExternal.length > 0 && lowExternalOver25.length / lowExternal.length > 0.5 ? 'Strong' : 'Weak';
  md += ` |\n\n`;

  // Conclusion
  md += `## Conclusion\n\n`;
  const openCorrelates = highOpen.length > 0 && highOpenOver25.length / highOpen.length > lowOpenOver25.length / (lowOpen.length || 1);
  const externalCorrelates = highExternal.length > 0 && highExternalOver25.length / highExternal.length > lowExternalOver25.length / (lowExternal.length || 1);

  if (openCorrelates && !externalCorrelates) {
    md += `**Gap is primarily from OPEN POSITIONS.** Engine marks unresolved at 0, UI marks at current price.\n`;
    md += `Recommendation: Rank on engine_realized (closed performance) for copy-trading selection.\n`;
  } else if (externalCorrelates && !openCorrelates) {
    md += `**Gap is primarily from MISSING PROVENANCE.** Wallets have tokens acquired outside CLOB.\n`;
    md += `Recommendation: Add external_sells_ratio to confidence gate, penalize high values.\n`;
  } else if (openCorrelates && externalCorrelates) {
    md += `**Gap is from BOTH open positions AND missing provenance.**\n`;
    md += `Recommendation: Rank on realized, gate on low external_sells AND low open_exposure.\n`;
  } else {
    md += `**No clear pattern detected.** Need more data or different diagnostic features.\n`;
  }

  // Worst 10 deltas
  md += `\n## Worst 10 Deltas\n\n`;
  const sorted = scraped.filter((r) => r.deltaTotalPct !== null).sort((a, b) => Math.abs(b.deltaTotalPct!) - Math.abs(a.deltaTotalPct!));
  md += `| Wallet | Stratum | Engine | UI | Delta | Open Exp | Ext Sells |\n`;
  md += `|--------|---------|--------|-----|-------|----------|----------|\n`;
  for (const r of sorted.slice(0, 10)) {
    const engine = r.engineTotal >= 0 ? `$${(r.engineTotal / 1000).toFixed(0)}k` : `-$${(Math.abs(r.engineTotal) / 1000).toFixed(0)}k`;
    const ui = r.uiTotalPnl !== null ? (r.uiTotalPnl >= 0 ? `$${(r.uiTotalPnl / 1000).toFixed(0)}k` : `-$${(Math.abs(r.uiTotalPnl) / 1000).toFixed(0)}k`) : 'N/A';
    const delta = r.deltaTotalPct !== null ? `${r.deltaTotalPct > 0 ? '+' : ''}${r.deltaTotalPct.toFixed(0)}%` : 'N/A';
    const openExp = r.openExposureRatio !== null ? `${(r.openExposureRatio * 100).toFixed(0)}%` : 'N/A';
    const extSells = r.externalSells > 0 ? `${(r.externalSells / 1000).toFixed(0)}k` : '0';
    md += `| ${r.wallet.slice(0, 10)}.. | ${r.stratum.slice(0, 12)} | ${engine} | ${ui} | ${delta} | ${openExp} | ${extSells} |\n`;
  }

  // Best 10 deltas
  md += `\n## Best 10 Deltas (Most Accurate)\n\n`;
  const sortedBest = scraped.filter((r) => r.deltaTotalPct !== null).sort((a, b) => Math.abs(a.deltaTotalPct!) - Math.abs(b.deltaTotalPct!));
  md += `| Wallet | Stratum | Engine | UI | Delta | Open Exp | Ext Sells |\n`;
  md += `|--------|---------|--------|-----|-------|----------|----------|\n`;
  for (const r of sortedBest.slice(0, 10)) {
    const engine = r.engineTotal >= 0 ? `$${(r.engineTotal / 1000).toFixed(0)}k` : `-$${(Math.abs(r.engineTotal) / 1000).toFixed(0)}k`;
    const ui = r.uiTotalPnl !== null ? (r.uiTotalPnl >= 0 ? `$${(r.uiTotalPnl / 1000).toFixed(0)}k` : `-$${(Math.abs(r.uiTotalPnl) / 1000).toFixed(0)}k`) : 'N/A';
    const delta = r.deltaTotalPct !== null ? `${r.deltaTotalPct > 0 ? '+' : ''}${r.deltaTotalPct.toFixed(0)}%` : 'N/A';
    const openExp = r.openExposureRatio !== null ? `${(r.openExposureRatio * 100).toFixed(0)}%` : 'N/A';
    const extSells = r.externalSells > 0 ? `${(r.externalSells / 1000).toFixed(0)}k` : '0';
    md += `| ${r.wallet.slice(0, 10)}.. | ${r.stratum.slice(0, 12)} | ${engine} | ${ui} | ${delta} | ${openExp} | ${extSells} |\n`;
  }

  return md;
}

async function main() {
  const client = getClickHouseClient();

  console.log('=== STRATIFIED VALIDATION: ENGINE VS UI ===\n');
  console.log('Goal: Determine if 28-32% gaps are from open positions or missing provenance.\n');

  // Load stratified sample
  const results = await loadStratifiedSample(client);

  // Count by stratum
  const strataCounts = new Map<string, number>();
  for (const r of results) {
    strataCounts.set(r.stratum, (strataCounts.get(r.stratum) || 0) + 1);
  }
  console.log('\nStratified sample:');
  for (const [stratum, count] of strataCounts) {
    console.log(`  ${stratum}: ${count} wallets`);
  }
  console.log(`\nTotal: ${results.length} unique wallets to validate\n`);

  // Ensure tmp directory exists
  if (!fs.existsSync('tmp')) {
    fs.mkdirSync('tmp');
  }

  const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const jsonPath = `tmp/spotcheck_cache_vs_ui_${timestamp}.json`;
  const summaryPath = `tmp/spotcheck_cache_vs_ui_${timestamp}.summary.md`;

  // Check if we have existing data
  let existingResults: ValidationResult[] = [];
  if (fs.existsSync(jsonPath)) {
    existingResults = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    console.log(`Found existing results with ${existingResults.filter((r) => r.scraped).length} scraped wallets.\n`);

    // Merge existing UI data into new results
    for (const existing of existingResults) {
      if (existing.scraped) {
        const match = results.find((r) => r.wallet === existing.wallet);
        if (match) {
          match.uiTotalPnl = existing.uiTotalPnl;
          match.uiPositionsValue = existing.uiPositionsValue;
          match.uiPredictions = existing.uiPredictions;
          match.uiBiggestWin = existing.uiBiggestWin;
          match.scraped = true;
          computeDeltas(match);
        }
      }
    }
  }

  // Save results template
  fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2));
  console.log(`Results saved to: ${jsonPath}`);

  // Generate and save summary
  const summary = generateSummary(results);
  fs.writeFileSync(summaryPath, summary);
  console.log(`Summary saved to: ${summaryPath}\n`);

  // Print summary to console
  console.log(summary);

  // Print Playwright instructions
  const unscraped = results.filter((r) => !r.scraped);
  if (unscraped.length > 0) {
    console.log('\n\n=== PLAYWRIGHT SCRAPING INSTRUCTIONS ===\n');
    console.log(`${unscraped.length} wallets need UI scraping.\n`);
    console.log('For each wallet, capture from Polymarket profile:');
    console.log('  1. Total PnL (from Profit/Loss section)');
    console.log('  2. Positions Value (displayed near Predictions count)');
    console.log('  3. Predictions count');
    console.log('  4. Biggest Win (if shown)\n');
    console.log('First 10 URLs to check:');
    for (const r of unscraped.slice(0, 10)) {
      const engine = r.engineTotal >= 0 ? `$${(r.engineTotal / 1000).toFixed(0)}k` : `-$${(Math.abs(r.engineTotal) / 1000).toFixed(0)}k`;
      console.log(`  ${r.wallet} (${r.stratum}, engine=${engine})`);
      console.log(`    https://polymarket.com/profile/${r.wallet}`);
    }
  }
}

main().catch(console.error);
