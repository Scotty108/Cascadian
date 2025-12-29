/**
 * Example: Using Validated Wallets Export
 *
 * Demonstrates how to programmatically use the validated wallets JSON
 * for various production use cases.
 *
 * Terminal: Claude 1
 * Date: 2025-12-15
 */

import * as fs from 'fs';
import * as path from 'path';

interface ValidatedWallet {
  wallet: string;
  name?: string;
  status: string;
  ui_net?: number;
  ui_gain?: number;
  ui_loss?: number;
  ui_volume?: number;
  v20b_net?: number;
  delta_abs?: number;
  delta_pct?: number;
  clamp_pct?: number;
  mapping_pct?: number;
  mapped_clob_rows?: number;
  markets?: number;
  sign_match?: boolean;
}

interface ValidatedWalletsExport {
  exported_at: string;
  criteria: {
    min_mapping_pct: number;
    max_clamp_pct: number;
  };
  summary: {
    total_candidates: number;
    passed: number;
    failed: number;
    pass_rate: number;
    avg_delta_pct: number;
  };
  fail_reasons: Record<string, number>;
  validated_wallets: ValidatedWallet[];
}

/**
 * Example 1: Extract wallet addresses for copy trading whitelist
 */
function extractWhitelist(data: ValidatedWalletsExport): string[] {
  return data.validated_wallets.map(w => w.wallet);
}

/**
 * Example 2: Filter by minimum volume for leaderboard
 */
function filterByVolume(
  data: ValidatedWalletsExport,
  minVolume: number
): ValidatedWallet[] {
  return data.validated_wallets.filter(
    w => (w.ui_volume || 0) >= minVolume
  );
}

/**
 * Example 3: Rank by performance (net PnL)
 */
function rankByPerformance(
  data: ValidatedWalletsExport
): ValidatedWallet[] {
  return [...data.validated_wallets].sort(
    (a, b) => (b.ui_net || 0) - (a.ui_net || 0)
  );
}

/**
 * Example 4: Calculate quality metrics
 */
function calculateQualityMetrics(data: ValidatedWalletsExport) {
  const wallets = data.validated_wallets;

  const avgMappingPct = wallets.reduce(
    (sum, w) => sum + (w.mapping_pct || 0), 0
  ) / wallets.length;

  const avgClampPct = wallets.reduce(
    (sum, w) => sum + (w.clamp_pct || 0), 0
  ) / wallets.length;

  const avgDeltaPct = wallets.reduce(
    (sum, w) => sum + Math.abs(w.delta_pct || 0), 0
  ) / wallets.length;

  return {
    avg_mapping_pct: avgMappingPct,
    avg_clamp_pct: avgClampPct,
    avg_delta_pct: avgDeltaPct,
    total_wallets: wallets.length,
    total_volume: wallets.reduce((sum, w) => sum + (w.ui_volume || 0), 0),
    total_markets: wallets.reduce((sum, w) => sum + (w.markets || 0), 0),
  };
}

/**
 * Example 5: Generate SQL INSERT statements
 */
function generateSqlInserts(
  data: ValidatedWalletsExport,
  tableName: string = 'validated_wallets'
): string {
  const inserts = data.validated_wallets.map(w => {
    const values = [
      `'${w.wallet}'`,
      `'${w.status}'`,
      w.ui_net || 'NULL',
      w.v20b_net || 'NULL',
      w.delta_pct || 'NULL',
      w.clamp_pct || 'NULL',
      w.mapping_pct || 'NULL',
      w.markets || 'NULL',
    ].join(', ');

    return `INSERT INTO ${tableName} (wallet, status, ui_net, v20b_net, delta_pct, clamp_pct, mapping_pct, markets) VALUES (${values});`;
  });

  return inserts.join('\n');
}

/**
 * Example 6: Create ClickHouse INSERT query
 */
function generateClickHouseInsert(
  data: ValidatedWalletsExport,
  tableName: string = 'pm_validated_wallets'
): string {
  const rows = data.validated_wallets.map(w => {
    return `('${w.wallet}', '${w.status}', ${w.ui_net || 0}, ${w.v20b_net || 0}, ${w.delta_pct || 0}, ${w.clamp_pct || 0}, ${w.mapping_pct || 0}, ${w.markets || 0})`;
  });

  return `
INSERT INTO ${tableName} (
  wallet,
  status,
  ui_net,
  v20b_net,
  delta_pct,
  clamp_pct,
  mapping_pct,
  markets
)
VALUES
${rows.join(',\n')};
`.trim();
}

/**
 * Main demo
 */
async function main() {
  console.log('='.repeat(80));
  console.log('VALIDATED WALLETS USAGE EXAMPLES');
  console.log('='.repeat(80));
  console.log('');

  // Load data
  const projectRoot = path.join(__dirname, '../..');
  const jsonPath = path.join(projectRoot, 'data/validated-wallets.json');

  if (!fs.existsSync(jsonPath)) {
    console.error('❌ File not found:', jsonPath);
    console.error('   Run: npx tsx scripts/pnl/export-validated-wallets.ts');
    process.exit(1);
  }

  const data: ValidatedWalletsExport = JSON.parse(
    fs.readFileSync(jsonPath, 'utf-8')
  );

  console.log('📖 Loaded validated wallets export');
  console.log(`   Exported at: ${data.exported_at}`);
  console.log(`   Total wallets: ${data.validated_wallets.length}`);
  console.log('');

  // Example 1: Whitelist
  console.log('=== Example 1: Copy Trading Whitelist ===');
  const whitelist = extractWhitelist(data);
  console.log(`Extracted ${whitelist.length} wallet addresses:`);
  console.log(whitelist.slice(0, 3).join('\n'));
  console.log('...');
  console.log('');

  // Example 2: Filter by volume
  console.log('=== Example 2: High Volume Traders (>$10M) ===');
  const highVolume = filterByVolume(data, 10_000_000);
  console.log(`Found ${highVolume.length} high-volume traders:`);
  highVolume.slice(0, 3).forEach(w => {
    console.log(`  ${w.wallet.slice(0, 10)}... - Volume: $${(w.ui_volume || 0).toLocaleString()}`);
  });
  console.log('');

  // Example 3: Leaderboard
  console.log('=== Example 3: Top 5 Performers ===');
  const ranked = rankByPerformance(data);
  ranked.slice(0, 5).forEach((w, i) => {
    const pnl = w.ui_net || 0;
    const pnlStr = pnl >= 0 ? `+$${pnl.toLocaleString()}` : `-$${Math.abs(pnl).toLocaleString()}`;
    console.log(`  ${i + 1}. ${w.wallet.slice(0, 10)}... - ${pnlStr}`);
  });
  console.log('');

  // Example 4: Quality metrics
  console.log('=== Example 4: Quality Metrics ===');
  const metrics = calculateQualityMetrics(data);
  console.log('  Average Mapping %:  ', metrics.avg_mapping_pct.toFixed(4), '%');
  console.log('  Average Clamp %:    ', metrics.avg_clamp_pct.toFixed(4), '%');
  console.log('  Average Delta %:    ', metrics.avg_delta_pct.toFixed(4), '%');
  console.log('  Total Volume:       ', '$' + metrics.total_volume.toLocaleString());
  console.log('  Total Markets:      ', metrics.total_markets.toLocaleString());
  console.log('');

  // Example 5: Export stats
  console.log('=== Example 5: Export Statistics ===');
  console.log('  Criteria:');
  console.log(`    Min Mapping: ${data.criteria.min_mapping_pct}%`);
  console.log(`    Max Clamp:   ${data.criteria.max_clamp_pct}%`);
  console.log('');
  console.log('  Results:');
  console.log(`    Tested:      ${data.summary.total_candidates}`);
  console.log(`    Passed:      ${data.summary.passed} (${(data.summary.pass_rate * 100).toFixed(1)}%)`);
  console.log(`    Failed:      ${data.summary.failed}`);
  console.log('');

  if (Object.keys(data.fail_reasons).length > 0) {
    console.log('  Failure Breakdown:');
    Object.entries(data.fail_reasons)
      .sort((a, b) => b[1] - a[1])
      .forEach(([reason, count]) => {
        console.log(`    ${reason.padEnd(25)} ${count.toString().padStart(3)}`);
      });
  }
  console.log('');

  // Example 6: Generate SQL (sample)
  console.log('=== Example 6: SQL Generation (sample) ===');
  const sqlSample = generateClickHouseInsert(
    { ...data, validated_wallets: data.validated_wallets.slice(0, 2) },
    'pm_validated_wallets'
  );
  console.log(sqlSample);
  console.log('');

  console.log('='.repeat(80));
  console.log('✅ Examples complete!');
  console.log('='.repeat(80));
  console.log('');
  console.log('Use these patterns to integrate validated wallets into:');
  console.log('  - Copy trading whitelist generation');
  console.log('  - Leaderboard ranking systems');
  console.log('  - Database imports');
  console.log('  - Quality monitoring dashboards');
  console.log('  - Production deployment pipelines');
  console.log('');
}

main().catch((err) => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
