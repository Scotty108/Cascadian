/**
 * Validate Export-Eligible Pool via Playwright
 *
 * Scrapes UI PnL values for wallets that pass all export filters,
 * compares to engine values, and produces a validation report.
 *
 * Sampling plan:
 * - 20: top by realized_pnl
 * - 20: random from filtered set
 * - 10-20: near boundary (taker_ratio 0.12-0.18, open_exposure 0.20-0.35)
 *
 * Success criteria:
 * - 80%+ within ±25% vs UI
 * - 0 cases where engine shows big positive realized PnL but UI is close to zero
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { getClickHouseClient } from '../../lib/clickhouse/client';
import * as fs from 'fs';

interface WalletSample {
  wallet: string;
  realized_pnl: number;
  engine_pnl: number;
  trade_count: number;
  external_sells_ratio: number;
  open_exposure_ratio: number;
  taker_ratio: number;
  sample_group: 'top' | 'random' | 'boundary';
}

interface ValidationResult extends WalletSample {
  ui_pnl: number | null;
  delta_pct: number | null;
  status: 'pass' | 'fail' | 'warning' | 'error';
  error_message?: string;
}

async function getExportEligibleWallets(client: any): Promise<WalletSample[]> {
  const samples: WalletSample[] = [];

  // Filter criteria
  const baseFilter = `
    external_sells_ratio <= 0.05
    AND open_exposure_ratio <= 0.25
    AND taker_ratio <= 0.15
    AND trade_count >= 50
    AND realized_pnl > 0
  `;

  // 1. Top 20 by realized_pnl
  const topResult = await client.query({
    query: `
      SELECT wallet, realized_pnl, engine_pnl, trade_count,
             external_sells_ratio, open_exposure_ratio, taker_ratio
      FROM pm_wallet_engine_pnl_cache FINAL
      WHERE ${baseFilter}
      ORDER BY realized_pnl DESC
      LIMIT 20
    `,
    format: 'JSONEachRow',
  });
  const topRows = (await topResult.json()) as any[];
  console.log(`Top 20 by realized_pnl: ${topRows.length} wallets`);
  for (const r of topRows) {
    samples.push({
      wallet: r.wallet,
      realized_pnl: Number(r.realized_pnl),
      engine_pnl: Number(r.engine_pnl),
      trade_count: Number(r.trade_count),
      external_sells_ratio: Number(r.external_sells_ratio),
      open_exposure_ratio: Number(r.open_exposure_ratio),
      taker_ratio: Number(r.taker_ratio),
      sample_group: 'top',
    });
  }

  // 2. Random 20 from filtered set (excluding top 20)
  const topWallets = topRows.map((r: any) => `'${r.wallet}'`).join(',');
  const randomResult = await client.query({
    query: `
      SELECT wallet, realized_pnl, engine_pnl, trade_count,
             external_sells_ratio, open_exposure_ratio, taker_ratio
      FROM pm_wallet_engine_pnl_cache FINAL
      WHERE ${baseFilter}
        ${topWallets.length > 0 ? `AND wallet NOT IN (${topWallets})` : ''}
      ORDER BY rand()
      LIMIT 20
    `,
    format: 'JSONEachRow',
  });
  const randomRows = (await randomResult.json()) as any[];
  console.log(`Random 20 from filtered set: ${randomRows.length} wallets`);
  for (const r of randomRows) {
    samples.push({
      wallet: r.wallet,
      realized_pnl: Number(r.realized_pnl),
      engine_pnl: Number(r.engine_pnl),
      trade_count: Number(r.trade_count),
      external_sells_ratio: Number(r.external_sells_ratio),
      open_exposure_ratio: Number(r.open_exposure_ratio),
      taker_ratio: Number(r.taker_ratio),
      sample_group: 'random',
    });
  }

  // 3. Boundary cases (taker_ratio 0.12-0.18 OR open_exposure 0.20-0.35)
  const existingWallets = samples.map((s) => `'${s.wallet}'`).join(',');
  const boundaryResult = await client.query({
    query: `
      SELECT wallet, realized_pnl, engine_pnl, trade_count,
             external_sells_ratio, open_exposure_ratio, taker_ratio
      FROM pm_wallet_engine_pnl_cache FINAL
      WHERE external_sells_ratio <= 0.10
        AND trade_count >= 50
        AND realized_pnl > 0
        AND (
          (taker_ratio BETWEEN 0.12 AND 0.18)
          OR (open_exposure_ratio BETWEEN 0.20 AND 0.35)
        )
        ${existingWallets.length > 0 ? `AND wallet NOT IN (${existingWallets})` : ''}
      ORDER BY rand()
      LIMIT 15
    `,
    format: 'JSONEachRow',
  });
  const boundaryRows = (await boundaryResult.json()) as any[];
  console.log(`Boundary cases: ${boundaryRows.length} wallets`);
  for (const r of boundaryRows) {
    samples.push({
      wallet: r.wallet,
      realized_pnl: Number(r.realized_pnl),
      engine_pnl: Number(r.engine_pnl),
      trade_count: Number(r.trade_count),
      external_sells_ratio: Number(r.external_sells_ratio),
      open_exposure_ratio: Number(r.open_exposure_ratio),
      taker_ratio: Number(r.taker_ratio),
      sample_group: 'boundary',
    });
  }

  return samples;
}

async function scrapeUiPnl(wallet: string): Promise<{ pnl: number | null; error?: string }> {
  // Use Playwright MCP to scrape the UI
  // This function will be called by the MCP browser tools
  const url = `https://polymarket.com/profile/${wallet}`;

  try {
    // We'll use the MCP browser tools to navigate and extract
    // For now, return placeholder - actual implementation uses MCP
    return { pnl: null, error: 'MCP scraping not implemented in script' };
  } catch (error) {
    return { pnl: null, error: String(error) };
  }
}

function generateReport(results: ValidationResult[]): string {
  const lines: string[] = [];
  const timestamp = new Date().toISOString();

  lines.push('# Export Pool Validation Report');
  lines.push(`**Generated:** ${timestamp}`);
  lines.push('');

  // Summary stats
  const scraped = results.filter((r) => r.ui_pnl !== null);
  const within10 = scraped.filter((r) => r.delta_pct !== null && Math.abs(r.delta_pct) <= 10);
  const within25 = scraped.filter((r) => r.delta_pct !== null && Math.abs(r.delta_pct) <= 25);
  const falsePositives = scraped.filter(
    (r) => r.realized_pnl > 5000 && r.ui_pnl !== null && r.ui_pnl < 1000
  );

  lines.push('## Summary');
  lines.push(`- **Total samples:** ${results.length}`);
  lines.push(`- **Scraped with UI data:** ${scraped.length}`);
  lines.push(`- **Within ±10%:** ${within10.length} (${((within10.length / Math.max(scraped.length, 1)) * 100).toFixed(1)}%)`);
  lines.push(`- **Within ±25%:** ${within25.length} (${((within25.length / Math.max(scraped.length, 1)) * 100).toFixed(1)}%)`);
  lines.push(`- **False positives (engine >$5k, UI <$1k):** ${falsePositives.length}`);
  lines.push('');

  // Success criteria check
  const within25Pct = scraped.length > 0 ? within25.length / scraped.length : 0;
  const passesGate = within25Pct >= 0.80 && falsePositives.length === 0;
  lines.push('## Gate Check');
  lines.push(`- **80%+ within ±25%:** ${within25Pct >= 0.80 ? '✅ PASS' : '❌ FAIL'} (${(within25Pct * 100).toFixed(1)}%)`);
  lines.push(`- **Zero false positives:** ${falsePositives.length === 0 ? '✅ PASS' : '❌ FAIL'} (${falsePositives.length} found)`);
  lines.push(`- **Overall:** ${passesGate ? '✅ READY TO SHIP' : '❌ NEEDS INVESTIGATION'}`);
  lines.push('');

  // By sample group
  lines.push('## Results by Sample Group');
  for (const group of ['top', 'random', 'boundary'] as const) {
    const groupResults = results.filter((r) => r.sample_group === group);
    const groupScraped = groupResults.filter((r) => r.ui_pnl !== null);
    const groupWithin25 = groupScraped.filter((r) => r.delta_pct !== null && Math.abs(r.delta_pct) <= 25);
    lines.push(`### ${group.charAt(0).toUpperCase() + group.slice(1)} (${groupResults.length})`);
    lines.push(`- Scraped: ${groupScraped.length}`);
    lines.push(`- Within ±25%: ${groupWithin25.length} (${groupScraped.length > 0 ? ((groupWithin25.length / groupScraped.length) * 100).toFixed(1) : 0}%)`);
    lines.push('');
  }

  // Detailed results table
  lines.push('## Detailed Results');
  lines.push('| Wallet | Group | Realized | Engine | UI | Delta | Status |');
  lines.push('|--------|-------|----------|--------|-----|-------|--------|');
  for (const r of results) {
    const wallet = r.wallet.slice(0, 10) + '...';
    const realized = `$${(r.realized_pnl / 1000).toFixed(1)}k`;
    const engine = `$${(r.engine_pnl / 1000).toFixed(1)}k`;
    const ui = r.ui_pnl !== null ? `$${(r.ui_pnl / 1000).toFixed(1)}k` : 'N/A';
    const delta = r.delta_pct !== null ? `${r.delta_pct > 0 ? '+' : ''}${r.delta_pct.toFixed(1)}%` : 'N/A';
    const status = r.status === 'pass' ? '✅' : r.status === 'warning' ? '⚠️' : r.status === 'fail' ? '❌' : '❓';
    lines.push(`| ${wallet} | ${r.sample_group} | ${realized} | ${engine} | ${ui} | ${delta} | ${status} |`);
  }
  lines.push('');

  // Worst deltas
  const sortedByDelta = scraped
    .filter((r) => r.delta_pct !== null)
    .sort((a, b) => Math.abs(b.delta_pct!) - Math.abs(a.delta_pct!));
  if (sortedByDelta.length > 0) {
    lines.push('## Worst 10 Deltas');
    lines.push('| Wallet | Realized | Engine | UI | Delta | tkr | exp | ext |');
    lines.push('|--------|----------|--------|-----|-------|-----|-----|-----|');
    for (const r of sortedByDelta.slice(0, 10)) {
      const wallet = r.wallet.slice(0, 10) + '...';
      const realized = `$${(r.realized_pnl / 1000).toFixed(1)}k`;
      const engine = `$${(r.engine_pnl / 1000).toFixed(1)}k`;
      const ui = `$${(r.ui_pnl! / 1000).toFixed(1)}k`;
      const delta = `${r.delta_pct! > 0 ? '+' : ''}${r.delta_pct!.toFixed(1)}%`;
      const tkr = `${(r.taker_ratio * 100).toFixed(1)}%`;
      const exp = `${(r.open_exposure_ratio * 100).toFixed(1)}%`;
      const ext = `${(r.external_sells_ratio * 100).toFixed(1)}%`;
      lines.push(`| ${wallet} | ${realized} | ${engine} | ${ui} | ${delta} | ${tkr} | ${exp} | ${ext} |`);
    }
  }

  return lines.join('\n');
}

async function main() {
  const client = getClickHouseClient();

  console.log('=== EXPORT POOL VALIDATION ===\n');

  // Get sample wallets
  console.log('Getting export-eligible wallet samples...');
  const samples = await getExportEligibleWallets(client);
  console.log(`\nTotal samples: ${samples.length}`);

  // Save samples for MCP scraping
  const samplesFile = `tmp/validation_samples_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.json`;
  fs.writeFileSync(samplesFile, JSON.stringify(samples, null, 2));
  console.log(`\nSamples saved to: ${samplesFile}`);

  // Generate placeholder report (actual UI scraping done via MCP)
  const results: ValidationResult[] = samples.map((s) => ({
    ...s,
    ui_pnl: null,
    delta_pct: null,
    status: 'error' as const,
    error_message: 'Awaiting MCP scraping',
  }));

  const report = generateReport(results);
  const reportFile = `tmp/validation_report_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.md`;
  fs.writeFileSync(reportFile, report);
  console.log(`Report template saved to: ${reportFile}`);

  console.log('\n=== NEXT STEPS ===');
  console.log('1. Use Playwright MCP to scrape UI PnL for each wallet in samples file');
  console.log('2. Update results with actual UI values');
  console.log('3. Re-run report generation with complete data');
}

main().catch(console.error);
