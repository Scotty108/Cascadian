/**
 * Large-Scale PnL Validation - 2000 Wallets
 *
 * Pulls a diverse set of 2000 wallets and validates our V1 PnL calculation
 * against Polymarket's API. Generates a comprehensive report.
 *
 * Diversity criteria:
 * - Different wallet sizes (small, medium, large)
 * - Different activity levels (few trades, many trades)
 * - Different NegRisk exposure
 * - Mix of resolved and open positions
 */

import { config } from 'dotenv';
import { createClient } from '@clickhouse/client';

config({ path: '.env.local' });

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 300000,
});

interface ValidationResult {
  wallet: string;
  ourPnl: number;
  apiPnl: number | null;
  difference: number | null;
  percentDiff: number | null;
  pass: boolean;
  confidence: string;
  tradeCount: number;
  positionCount: number;
  negRiskCount: number;
  error?: string;
}

// Fetch PnL from Polymarket API (using user-pnl-api like V7)
async function fetchPolymarketPnL(wallet: string): Promise<number | null> {
  try {
    const url = `https://user-pnl-api.polymarket.com/user-pnl?user_address=${wallet.toLowerCase()}`;
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as Array<{ t: number; p: number }>;
    if (!data || data.length === 0) {
      return null;
    }

    // Return the latest PnL value (last in time series)
    return Math.round(data[data.length - 1].p * 100) / 100;
  } catch (err) {
    return null;
  }
}

// Calculate PnL using our V1 formula
async function calculateOurPnL(wallet: string): Promise<{
  pnl: number;
  confidence: string;
  tradeCount: number;
  positionCount: number;
  negRiskCount: number;
}> {
  const normalizedWallet = wallet.toLowerCase();

  // V1 formula query
  const query = `
    WITH
      positions AS (
        SELECT
          condition_id,
          outcome_index,
          sum(tokens_delta) as net_tokens,
          sum(usdc_delta) as cash_flow
        FROM pm_canonical_fills_v4
        WHERE wallet = '${normalizedWallet}'
          AND condition_id != ''
          AND NOT (is_self_fill = 1 AND is_maker = 1)
        GROUP BY condition_id, outcome_index
      ),
      with_prices AS (
        SELECT
          p.condition_id,
          p.outcome_index,
          p.net_tokens,
          p.cash_flow,
          r.payout_numerators IS NOT NULL AND r.payout_numerators != '' as is_resolved,
          toInt64OrNull(JSONExtractString(r.payout_numerators, p.outcome_index + 1)) = 1 as won,
          mp.mark_price as current_mark_price
        FROM positions p
        LEFT JOIN pm_condition_resolutions r ON p.condition_id = r.condition_id AND r.is_deleted = 0
        LEFT JOIN pm_latest_mark_price_v1 mp ON lower(p.condition_id) = lower(mp.condition_id)
          AND p.outcome_index = mp.outcome_index
      )
    SELECT
      round(sum(
        CASE
          WHEN is_resolved AND won THEN cash_flow + net_tokens
          WHEN is_resolved THEN cash_flow
          ELSE cash_flow + net_tokens * ifNull(current_mark_price, 0)
        END
      ), 2) as total_pnl,
      count() as position_count
    FROM with_prices
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];
  const pnl = Number(rows[0]?.total_pnl || 0);
  const positionCount = Number(rows[0]?.position_count || 0);

  // Get trade count
  const tradeResult = await clickhouse.query({
    query: `SELECT count() as cnt FROM pm_canonical_fills_v4 WHERE wallet = '${normalizedWallet}'`,
    format: 'JSONEachRow',
  });
  const tradeRows = (await tradeResult.json()) as any[];
  const tradeCount = Number(tradeRows[0]?.cnt || 0);

  // Get NegRisk count
  const nrResult = await clickhouse.query({
    query: `SELECT count() as cnt FROM pm_canonical_fills_v4 WHERE wallet = '${normalizedWallet}' AND source = 'negrisk'`,
    format: 'JSONEachRow',
  });
  const nrRows = (await nrResult.json()) as any[];
  const negRiskCount = Number(nrRows[0]?.cnt || 0);

  // Determine confidence
  let confidence = 'HIGH';
  if (negRiskCount > 100) confidence = 'MEDIUM';
  if (negRiskCount > 500) confidence = 'LOW';

  return { pnl, confidence, tradeCount, positionCount, negRiskCount };
}

// Pull diverse wallet sample
async function pullDiverseWallets(count: number): Promise<string[]> {
  console.log(`Pulling ${count} diverse wallets...`);

  // Strategy: Pull from different segments
  const segments = [
    // Small wallets (< 10 trades)
    { name: 'small', query: `
      SELECT wallet, count() as cnt
      FROM pm_canonical_fills_v4
      WHERE wallet != ''
      GROUP BY wallet
      HAVING cnt BETWEEN 5 AND 10
      ORDER BY rand()
      LIMIT ${Math.floor(count * 0.15)}
    `},
    // Medium wallets (10-100 trades)
    { name: 'medium', query: `
      SELECT wallet, count() as cnt
      FROM pm_canonical_fills_v4
      WHERE wallet != ''
      GROUP BY wallet
      HAVING cnt BETWEEN 10 AND 100
      ORDER BY rand()
      LIMIT ${Math.floor(count * 0.25)}
    `},
    // Large wallets (100-1000 trades)
    { name: 'large', query: `
      SELECT wallet, count() as cnt
      FROM pm_canonical_fills_v4
      WHERE wallet != ''
      GROUP BY wallet
      HAVING cnt BETWEEN 100 AND 1000
      ORDER BY rand()
      LIMIT ${Math.floor(count * 0.25)}
    `},
    // Very active wallets (1000+ trades)
    { name: 'very_active', query: `
      SELECT wallet, count() as cnt
      FROM pm_canonical_fills_v4
      WHERE wallet != ''
      GROUP BY wallet
      HAVING cnt > 1000
      ORDER BY rand()
      LIMIT ${Math.floor(count * 0.15)}
    `},
    // NegRisk wallets
    { name: 'negrisk', query: `
      SELECT wallet, count() as cnt
      FROM pm_canonical_fills_v4
      WHERE wallet != '' AND source = 'negrisk'
      GROUP BY wallet
      HAVING cnt > 10
      ORDER BY rand()
      LIMIT ${Math.floor(count * 0.20)}
    `},
  ];

  const wallets: Set<string> = new Set();

  for (const segment of segments) {
    console.log(`  Pulling ${segment.name} wallets...`);
    const result = await clickhouse.query({ query: segment.query, format: 'JSONEachRow' });
    const rows = (await result.json()) as any[];
    for (const row of rows) {
      wallets.add(row.wallet);
    }
    console.log(`    Got ${rows.length} wallets (total: ${wallets.size})`);
  }

  return Array.from(wallets).slice(0, count);
}

async function main() {
  const TARGET_WALLETS = 2000;
  const PASS_THRESHOLD = 0.10; // 10% tolerance

  console.log('======================================================================');
  console.log('PnL Validation - 2000 Wallets');
  console.log('======================================================================');
  console.log(`Target: ${TARGET_WALLETS} wallets`);
  console.log(`Pass threshold: ${PASS_THRESHOLD * 100}%`);
  console.log('======================================================================\n');

  // Pull diverse wallet sample
  const wallets = await pullDiverseWallets(TARGET_WALLETS);
  console.log(`\nValidating ${wallets.length} wallets...\n`);

  const results: ValidationResult[] = [];
  const startTime = Date.now();

  for (let i = 0; i < wallets.length; i++) {
    const wallet = wallets[i];
    const pct = ((i + 1) / wallets.length * 100).toFixed(1);

    try {
      // Calculate our PnL
      const our = await calculateOurPnL(wallet);

      // Fetch API PnL for comparison
      const apiPnl = await fetchPolymarketPnL(wallet);
      // Small delay to avoid rate limiting
      await new Promise(r => setTimeout(r, 100));

      let difference: number | null = null;
      let percentDiff: number | null = null;
      let pass = true;

      if (apiPnl !== null) {
        difference = our.pnl - apiPnl;
        if (Math.abs(apiPnl) > 10) {
          percentDiff = Math.abs(difference / apiPnl);
          pass = percentDiff <= PASS_THRESHOLD;
        } else {
          // For small PnL, use absolute difference
          pass = Math.abs(difference) <= 10;
        }
      }

      results.push({
        wallet,
        ourPnl: our.pnl,
        apiPnl,
        difference,
        percentDiff,
        pass,
        confidence: our.confidence,
        tradeCount: our.tradeCount,
        positionCount: our.positionCount,
        negRiskCount: our.negRiskCount,
      });

      // Progress update
      if ((i + 1) % 50 === 0) {
        const withApi = results.filter(r => r.apiPnl !== null);
        const passed = withApi.filter(r => r.pass).length;
        const passRate = withApi.length > 0 ? (passed / withApi.length * 100).toFixed(1) : 'N/A';
        console.log(`[${i + 1}/${wallets.length} ${pct}%] Pass rate: ${passRate}% (${passed}/${withApi.length} with API data)`);
      }
    } catch (err: any) {
      results.push({
        wallet,
        ourPnl: 0,
        apiPnl: null,
        difference: null,
        percentDiff: null,
        pass: false,
        confidence: 'ERROR',
        tradeCount: 0,
        positionCount: 0,
        negRiskCount: 0,
        error: err.message?.substring(0, 100),
      });
    }
  }

  // Generate summary
  const totalTime = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  const withApiData = results.filter(r => r.apiPnl !== null);
  const passed = withApiData.filter(r => r.pass);
  const failed = withApiData.filter(r => !r.pass);

  const byConfidence = {
    HIGH: results.filter(r => r.confidence === 'HIGH'),
    MEDIUM: results.filter(r => r.confidence === 'MEDIUM'),
    LOW: results.filter(r => r.confidence === 'LOW'),
    ERROR: results.filter(r => r.confidence === 'ERROR'),
  };

  console.log('\n======================================================================');
  console.log('VALIDATION SUMMARY');
  console.log('======================================================================');
  console.log(`Total wallets: ${results.length}`);
  console.log(`With API data: ${withApiData.length}`);
  console.log(`Passed: ${passed.length} (${(passed.length / withApiData.length * 100).toFixed(1)}%)`);
  console.log(`Failed: ${failed.length} (${(failed.length / withApiData.length * 100).toFixed(1)}%)`);
  console.log(`Total time: ${totalTime} minutes`);
  console.log('');
  console.log('By Confidence Level:');
  console.log(`  HIGH: ${byConfidence.HIGH.length} wallets`);
  console.log(`  MEDIUM: ${byConfidence.MEDIUM.length} wallets`);
  console.log(`  LOW: ${byConfidence.LOW.length} wallets`);
  console.log(`  ERROR: ${byConfidence.ERROR.length} wallets`);
  console.log('======================================================================\n');

  // Top failures (worst mismatches)
  if (failed.length > 0) {
    console.log('TOP 20 FAILURES (Worst Mismatches):');
    console.log('----------------------------------------------------------------------');
    const sortedFails = failed
      .filter(r => r.percentDiff !== null)
      .sort((a, b) => Math.abs(b.percentDiff!) - Math.abs(a.percentDiff!))
      .slice(0, 20);

    for (const f of sortedFails) {
      console.log(`${f.wallet}`);
      console.log(`  Our: $${f.ourPnl.toFixed(2)} | API: $${f.apiPnl?.toFixed(2)} | Diff: ${(f.percentDiff! * 100).toFixed(1)}%`);
      console.log(`  Trades: ${f.tradeCount} | Positions: ${f.positionCount} | NegRisk: ${f.negRiskCount}`);
    }
    console.log('');
  }

  // Sample of passes
  console.log('SAMPLE PASSES (10 random):');
  console.log('----------------------------------------------------------------------');
  const samplePasses = passed
    .filter(r => r.apiPnl !== null && Math.abs(r.apiPnl) > 100)
    .sort(() => Math.random() - 0.5)
    .slice(0, 10);

  for (const p of samplePasses) {
    console.log(`${p.wallet}`);
    console.log(`  Our: $${p.ourPnl.toFixed(2)} | API: $${p.apiPnl?.toFixed(2)} | Diff: ${((p.percentDiff ?? 0) * 100).toFixed(1)}%`);
  }

  // Save detailed results to file
  const reportPath = `/tmp/pnl-validation-${Date.now()}.json`;
  const fs = await import('fs');
  fs.writeFileSync(reportPath, JSON.stringify({
    summary: {
      totalWallets: results.length,
      withApiData: withApiData.length,
      passed: passed.length,
      failed: failed.length,
      passRate: (passed.length / withApiData.length * 100).toFixed(1) + '%',
      totalTimeMinutes: totalTime,
    },
    byConfidence: {
      HIGH: byConfidence.HIGH.length,
      MEDIUM: byConfidence.MEDIUM.length,
      LOW: byConfidence.LOW.length,
      ERROR: byConfidence.ERROR.length,
    },
    failures: failed.slice(0, 100),
    allResults: results,
  }, null, 2));

  console.log(`\nDetailed results saved to: ${reportPath}`);

  await clickhouse.close();
  console.log('\nDone!');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
