/**
 * Export Validated Wallets from UI Parity Results
 *
 * Reads UI parity test results and exports validated wallets that meet
 * eligibility criteria to CSV and JSON formats.
 *
 * Input: data/ui-parity-results.json
 * Outputs:
 *   - data/validated-wallets.csv
 *   - data/validated-wallets.json
 *
 * Terminal: Claude 1
 * Date: 2025-12-15
 */

import * as fs from 'fs';
import * as path from 'path';

interface ParityResult {
  wallet: string;
  name?: string;
  status?: 'PASS' | 'FAIL' | string;
  ui_pnl?: number;
  v20b_pnl?: number;
  ui_net?: number;
  ui_gain?: number;
  ui_loss?: number;
  ui_volume?: number;
  v20b_net?: number;
  delta_abs?: number;
  delta_pct?: number;
  error_pct?: number;
  clamp_pct?: number;
  mapping_pct?: number;
  mapped_clob_rows?: number;
  markets?: number;
  sign_match?: boolean;
  fail_reason?: string;
}

interface InputData {
  timestamp?: string;
  metadata?: any;
  summary?: any;
  results: ParityResult[];
}

interface ValidationCriteria {
  min_mapping_pct: number;
  max_clamp_pct: number;
}

const DEFAULT_CRITERIA: ValidationCriteria = {
  min_mapping_pct: 99.5,
  max_clamp_pct: 2.0,
};

function meetsEligibility(result: ParityResult, criteria: ValidationCriteria): boolean {
  // Must have PASS status
  if (result.status !== 'PASS') return false;

  // Check mapping percentage if available
  if (result.mapping_pct !== undefined && result.mapping_pct < criteria.min_mapping_pct) {
    return false;
  }

  // Check clamp percentage if available
  if (result.clamp_pct !== undefined && result.clamp_pct > criteria.max_clamp_pct) {
    return false;
  }

  return true;
}

function formatCsvRow(result: ParityResult): string {
  const fields = [
    result.wallet,
    result.status || '',
    result.ui_net?.toFixed(2) || '',
    result.ui_gain?.toFixed(2) || '',
    result.ui_loss?.toFixed(2) || '',
    result.ui_volume?.toFixed(2) || '',
    result.v20b_net?.toFixed(2) || '',
    result.delta_abs?.toFixed(2) || '',
    result.delta_pct?.toFixed(4) || '',
    result.clamp_pct?.toFixed(4) || '',
    result.mapped_clob_rows?.toString() || '',
    result.markets?.toString() || '',
  ];

  // Escape and quote fields that might contain commas
  return fields.map(f => `"${f}"`).join(',');
}

function getFailReasons(results: ParityResult[]): Record<string, number> {
  const reasons: Record<string, number> = {};

  for (const result of results) {
    if (result.status !== 'PASS') {
      const reason = result.fail_reason || result.status || 'UNKNOWN';
      reasons[reason] = (reasons[reason] || 0) + 1;
    }
  }

  return reasons;
}

async function exportValidatedWallets() {
  console.log('='.repeat(80));
  console.log('EXPORT VALIDATED WALLETS FROM UI PARITY RESULTS');
  console.log('='.repeat(80));
  console.log('');

  // Paths
  const projectRoot = path.join(__dirname, '../..');
  const inputPath = path.join(projectRoot, 'data/ui-parity-results.json');
  const csvOutputPath = path.join(projectRoot, 'data/validated-wallets.csv');
  const jsonOutputPath = path.join(projectRoot, 'data/validated-wallets.json');

  // Check if input file exists
  if (!fs.existsSync(inputPath)) {
    console.error(`❌ Input file not found: ${inputPath}`);
    console.error('');
    console.error('Please run a UI parity validation script first to generate results.');
    console.error('Expected format: { results: [...] }');
    process.exit(1);
  }

  // Read input data
  console.log(`📖 Reading input from: ${inputPath}`);
  const rawData = fs.readFileSync(inputPath, 'utf-8');
  const inputData: InputData = JSON.parse(rawData);

  if (!inputData.results || !Array.isArray(inputData.results)) {
    console.error('❌ Invalid input format: missing "results" array');
    process.exit(1);
  }

  console.log(`   Total candidates: ${inputData.results.length}`);
  console.log('');

  // Apply eligibility criteria
  console.log('🔍 Applying eligibility criteria:');
  console.log(`   - Mapping >= ${DEFAULT_CRITERIA.min_mapping_pct}%`);
  console.log(`   - Clamp <= ${DEFAULT_CRITERIA.max_clamp_pct}%`);
  console.log('');

  const validatedWallets = inputData.results.filter(r =>
    meetsEligibility(r, DEFAULT_CRITERIA)
  );

  const failedWallets = inputData.results.filter(r =>
    !meetsEligibility(r, DEFAULT_CRITERIA)
  );

  // Calculate summary stats
  const passedCount = validatedWallets.length;
  const failedCount = failedWallets.length;
  const totalCount = inputData.results.length;

  const passedDeltas = validatedWallets
    .filter(r => r.delta_pct !== undefined)
    .map(r => r.delta_pct!);

  const avgDelta = passedDeltas.length > 0
    ? passedDeltas.reduce((sum, d) => sum + Math.abs(d), 0) / passedDeltas.length
    : 0;

  // Get failure reasons
  const failReasons = getFailReasons(inputData.results);

  // Print summary
  console.log('='.repeat(80));
  console.log('SUMMARY STATISTICS');
  console.log('='.repeat(80));
  console.log('');
  console.log(`Total candidates tested:     ${totalCount}`);
  console.log(`Passed (eligible):           ${passedCount} (${(passedCount/totalCount*100).toFixed(1)}%)`);
  console.log(`Failed (ineligible):         ${failedCount} (${(failedCount/totalCount*100).toFixed(1)}%)`);
  console.log('');

  if (passedCount > 0) {
    console.log(`Average delta % (passed):    ${avgDelta.toFixed(4)}%`);
    console.log('');
  }

  if (Object.keys(failReasons).length > 0) {
    console.log('Failed count by reason:');
    const sortedReasons = Object.entries(failReasons).sort((a, b) => b[1] - a[1]);
    for (const [reason, count] of sortedReasons) {
      console.log(`  ${reason.padEnd(30)} ${count.toString().padStart(5)} (${(count/totalCount*100).toFixed(1)}%)`);
    }
    console.log('');
  }

  if (passedCount === 0) {
    console.warn('⚠️  No wallets passed validation criteria!');
    console.warn('    Adjust criteria in the script if needed.');
    console.log('');
    process.exit(0);
  }

  // Export to CSV
  console.log('📝 Exporting to CSV...');
  const csvHeader = [
    'wallet_address',
    'v20b_ui_parity_status',
    'ui_net',
    'ui_gain',
    'ui_loss',
    'ui_volume',
    'v20b_net',
    'delta_abs',
    'delta_pct',
    'clamp_pct',
    'mapped_clob_rows',
    'markets',
  ].join(',');

  const csvRows = validatedWallets.map(formatCsvRow);
  const csvContent = [csvHeader, ...csvRows].join('\n');

  fs.writeFileSync(csvOutputPath, csvContent, 'utf-8');
  console.log(`   ✅ Written: ${csvOutputPath}`);
  console.log(`   Rows: ${csvRows.length}`);
  console.log('');

  // Export to JSON
  console.log('📝 Exporting to JSON...');
  const jsonOutput = {
    exported_at: new Date().toISOString(),
    criteria: DEFAULT_CRITERIA,
    summary: {
      total_candidates: totalCount,
      passed: passedCount,
      failed: failedCount,
      pass_rate: passedCount / totalCount,
      avg_delta_pct: avgDelta,
    },
    fail_reasons: failReasons,
    validated_wallets: validatedWallets,
  };

  fs.writeFileSync(jsonOutputPath, JSON.stringify(jsonOutput, null, 2), 'utf-8');
  console.log(`   ✅ Written: ${jsonOutputPath}`);
  console.log(`   Wallets: ${validatedWallets.length}`);
  console.log('');

  // Sample output
  if (validatedWallets.length > 0) {
    console.log('='.repeat(80));
    console.log('SAMPLE VALIDATED WALLETS (first 5)');
    console.log('='.repeat(80));
    console.log('');
    console.log('Wallet                                     | Status | UI Net        | V20b Net      | Delta %');
    console.log('-------------------------------------------|--------|---------------|---------------|----------');

    for (let i = 0; i < Math.min(5, validatedWallets.length); i++) {
      const w = validatedWallets[i];
      const uiNet = w.ui_net !== undefined ? `$${w.ui_net.toFixed(2)}` : 'N/A';
      const v20bNet = w.v20b_net !== undefined ? `$${w.v20b_net.toFixed(2)}` : 'N/A';
      const deltaPct = w.delta_pct !== undefined ? `${w.delta_pct.toFixed(4)}%` : 'N/A';

      console.log(
        `${w.wallet} | ${(w.status || 'PASS').padEnd(6)} | ${uiNet.padStart(13)} | ${v20bNet.padStart(13)} | ${deltaPct.padStart(8)}`
      );
    }
    console.log('');
  }

  console.log('='.repeat(80));
  console.log('✅ EXPORT COMPLETE');
  console.log('='.repeat(80));
  console.log('');
  console.log('Outputs:');
  console.log(`  CSV:  ${csvOutputPath}`);
  console.log(`  JSON: ${jsonOutputPath}`);
  console.log('');
  console.log('These files can be shared as the defensible export of validated wallets.');
  console.log('');
}

exportValidatedWallets().catch((err) => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
