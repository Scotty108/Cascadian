/**
 * V19s Export Pipeline
 *
 * Uses the proven V19s engine (0.1% median accuracy) to find
 * high-confidence wallets suitable for copy-trading exports.
 *
 * Usage:
 *   npx tsx scripts/pnl/v19s-export-pipeline.ts --want 50 --concurrency 3
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import * as fs from 'fs';
import * as path from 'path';
import { parseArgs } from 'util';
import { getClickHouseClient } from '../../lib/clickhouse/client';
import { calculateV19sPnL } from '../../lib/pnl/uiActivityEngineV19s';

// Parse args
const { values } = parseArgs({
  options: {
    want: { type: 'string', default: '100' },
    concurrency: { type: 'string', default: '3' },
    candidates: { type: 'string', default: '' },  // Path to candidates JSON
    skip: { type: 'string', default: '0' },       // Skip N candidates
  },
});

const WANT_COUNT = parseInt(values.want!, 10);
const CONCURRENCY = parseInt(values.concurrency!, 10);
const CANDIDATES_FILE = values.candidates;
const SKIP_COUNT = parseInt(values.skip!, 10);

interface Candidate {
  wallet: string;
  trades: number;
  maker_count?: number;
  total_usdc?: number;
}

interface ExportResult {
  wallet: string;
  v19s_total_pnl: number;
  v19s_realized_pnl: number;
  v19s_unrealized_pnl: number;
  trades: number;
  positions: number;
  resolutions: number;
  synthetic_resolutions: number;
  open_positions: number;
  resolution_coverage: number;  // % positions with resolution
  confidence_level: 'HIGH' | 'MEDIUM' | 'LOW';
}

async function getCandidates(): Promise<Candidate[]> {
  // If candidates file provided, read from there
  if (CANDIDATES_FILE) {
    const filePath = path.resolve(CANDIDATES_FILE);
    console.log(`Reading candidates from: ${filePath}`);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return data as Candidate[];
  }

  // Otherwise, use benchmark wallets from database
  const client = getClickHouseClient();
  console.log('Loading benchmark wallets from database...');

  const query = `
    SELECT
      b.wallet,
      coalesce(c.trade_count, 0) as trades
    FROM (
      SELECT wallet, pnl_value
      FROM pm_ui_pnl_benchmarks_v1
      WHERE (wallet, captured_at) IN (
        SELECT wallet, max(captured_at)
        FROM pm_ui_pnl_benchmarks_v1
        GROUP BY wallet
      )
    ) b
    LEFT JOIN pm_wallet_engine_pnl_cache c ON lower(b.wallet) = lower(c.wallet)
    ORDER BY abs(b.pnl_value) DESC
    LIMIT 200
  `;

  const result = await client.query({ query, format: 'JSONEachRow' });
  return await result.json() as Candidate[];
}

async function processWallet(candidate: Candidate): Promise<ExportResult | null> {
  try {
    const metrics = await Promise.race([
      calculateV19sPnL(candidate.wallet),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('TIMEOUT')), 45000)
      ),
    ]);

    // Calculate confidence metrics (using correct property names from calculateV19sPnL)
    const totalPositions = metrics.positions || 0;
    const resolvedPositions = (metrics.resolved || 0) + (metrics.synthetic_resolved || 0);
    const resolutionCoverage = totalPositions > 0
      ? resolvedPositions / totalPositions
      : 0;

    // Determine confidence level based on resolution coverage and reasonable PnL
    let confidenceLevel: 'HIGH' | 'MEDIUM' | 'LOW' = 'LOW';
    const absTotal = Math.abs(metrics.total_pnl);

    // HIGH: 80%+ resolved, reasonable PnL (<$10M), has positions
    if (resolutionCoverage >= 0.8 && absTotal < 10_000_000 && totalPositions >= 10) {
      confidenceLevel = 'HIGH';
    } else if (resolutionCoverage >= 0.5 && absTotal < 10_000_000) {
      confidenceLevel = 'MEDIUM';
    }

    return {
      wallet: candidate.wallet,
      v19s_total_pnl: metrics.total_pnl,
      v19s_realized_pnl: metrics.realized_pnl,
      v19s_unrealized_pnl: metrics.unrealized_pnl,
      trades: candidate.trades || 0,
      positions: totalPositions,
      resolutions: metrics.resolved || 0,
      synthetic_resolutions: metrics.synthetic_resolved || 0,
      open_positions: metrics.open_positions || 0,
      resolution_coverage: resolutionCoverage,
      confidence_level: confidenceLevel,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown';
    if (msg.includes('TIMEOUT')) {
      console.log(`  ${candidate.wallet.slice(0, 12)}... TIMEOUT`);
    } else {
      console.log(`  ${candidate.wallet.slice(0, 12)}... ERROR: ${msg.slice(0, 30)}`);
    }
    return null;
  }
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║        V19s EXPORT PIPELINE - HIGH CONFIDENCE WALLETS          ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  console.log(`Target: ${WANT_COUNT} high-confidence wallets`);
  console.log(`Concurrency: ${CONCURRENCY}`);
  if (CANDIDATES_FILE) console.log(`Candidates: ${CANDIDATES_FILE}`);
  if (SKIP_COUNT > 0) console.log(`Skip: ${SKIP_COUNT} candidates`);
  console.log('');

  // Get candidates
  const allCandidates = await getCandidates();
  const candidates = SKIP_COUNT > 0 ? allCandidates.slice(SKIP_COUNT) : allCandidates;
  console.log(`Found ${allCandidates.length} candidates total, processing ${candidates.length}\n`);

  const results: ExportResult[] = [];
  const highConfidence: ExportResult[] = [];
  let processed = 0;
  let errors = 0;

  console.log('Processing wallets with V19s engine...\n');

  // Process in batches
  for (let i = 0; i < candidates.length && highConfidence.length < WANT_COUNT; i += CONCURRENCY) {
    const batch = candidates.slice(i, i + CONCURRENCY);

    const batchResults = await Promise.all(
      batch.map(c => processWallet(c))
    );

    for (const result of batchResults) {
      processed++;

      if (result === null) {
        errors++;
        continue;
      }

      results.push(result);

      // Check if HIGH confidence
      if (result.confidence_level === 'HIGH') {
        highConfidence.push(result);
        console.log(
          `PASS #${highConfidence.length} | ` +
          `${result.wallet.slice(0, 12)}... | ` +
          `PnL: $${result.v19s_total_pnl.toLocaleString(undefined, { maximumFractionDigits: 0 })} | ` +
          `ResCov: ${(result.resolution_coverage * 100).toFixed(0)}% | ` +
          `Trades: ${result.trades}`
        );
      } else {
        const level = result.confidence_level;
        console.log(
          `[${level}] ${result.wallet.slice(0, 12)}... | ` +
          `PnL: $${result.v19s_total_pnl.toLocaleString(undefined, { maximumFractionDigits: 0 })} | ` +
          `ResCov: ${(result.resolution_coverage * 100).toFixed(0)}%`
        );
      }
    }

    // Progress update every 30 wallets
    if (processed % 30 === 0) {
      console.log(`\n--- Progress: ${processed} processed, ${highConfidence.length} HIGH confidence ---\n`);
    }
  }

  // Save results
  const tmpDir = path.join(process.cwd(), 'tmp');
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }

  fs.writeFileSync(
    path.join(tmpDir, 'v19s_high_confidence_wallets.json'),
    JSON.stringify(highConfidence, null, 2)
  );

  fs.writeFileSync(
    path.join(tmpDir, 'v19s_all_results.json'),
    JSON.stringify(results, null, 2)
  );

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));
  console.log(`Total processed: ${processed}`);
  console.log(`Errors/Timeouts: ${errors}`);
  console.log(`HIGH confidence: ${highConfidence.length}`);
  console.log(`MEDIUM confidence: ${results.filter(r => r.confidence_level === 'MEDIUM').length}`);
  console.log(`LOW confidence: ${results.filter(r => r.confidence_level === 'LOW').length}`);

  if (highConfidence.length > 0) {
    console.log('\n--- TOP 10 HIGH CONFIDENCE WALLETS (by PnL) ---');
    console.log('Wallet'.padEnd(44) + 'PnL'.padEnd(15) + 'ResCov'.padEnd(10) + 'Trades');
    console.log('-'.repeat(70));

    const sorted = [...highConfidence].sort((a, b) => Math.abs(b.v19s_total_pnl) - Math.abs(a.v19s_total_pnl));
    for (const r of sorted.slice(0, 10)) {
      console.log(
        r.wallet.padEnd(44) +
        ('$' + r.v19s_total_pnl.toLocaleString(undefined, { maximumFractionDigits: 0 })).padEnd(15) +
        ((r.resolution_coverage * 100).toFixed(0) + '%').padEnd(10) +
        r.trades.toLocaleString()
      );
    }
  }

  console.log('\nOutput files:');
  console.log('  tmp/v19s_high_confidence_wallets.json');
  console.log('  tmp/v19s_all_results.json');

  console.log('\nNext: Validate sample with Playwright against Polymarket UI');
  process.exit(0);
}

main().catch(console.error);
