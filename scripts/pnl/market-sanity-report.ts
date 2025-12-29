/**
 * ============================================================================
 * Market-Level Sanity Report
 * ============================================================================
 *
 * Creates pm_market_sanity_v1 view and generates a report of market health.
 *
 * CONCEPT:
 *   For a perfectly closed market (all positions settled), we expect:
 *   - sum(token_delta) ≈ 0 (all tokens created were burned)
 *   - sum(usdc_delta) ≈ 0 (all USDC in equals USDC out, minus fees)
 *
 *   Markets where these are wildly off indicate data quality issues
 *   that will poison wallet PnL calculations.
 *
 * Usage:
 *   npx tsx scripts/pnl/market-sanity-report.ts
 *   npx tsx scripts/pnl/market-sanity-report.ts --create-view
 *
 * Terminal: Claude 1
 * Date: 2025-12-04
 */

import { clickhouse } from '../../lib/clickhouse/client';
import * as fs from 'fs';

const ZERO_SUM_EPSILON = 1.0; // $1 tolerance for "zero sum" classification

interface MarketSanity {
  condition_id: string;
  total_usdc_delta: number;
  total_token_delta: number;
  event_count: number;
  clob_events: number;
  redemption_events: number;
  transfer_events: number;
  wallet_count: number;
  is_resolved: boolean;
  is_zero_sum: boolean;
}

interface SanityReport {
  generated_at: string;
  summary: {
    total_markets: number;
    zero_sum_markets: number;
    non_zero_sum_markets: number;
    resolved_markets: number;
    unresolved_markets: number;
    zero_sum_rate: number;
  };
  worst_markets: MarketSanity[];
  source_type_breakdown: any[];
}

async function createMarketSanityTable(): Promise<void> {
  console.log('Creating pm_market_sanity_v1 view...');

  // Drop existing table/view if it exists (try both in case one exists)
  try {
    await clickhouse.command({ query: `DROP TABLE IF EXISTS pm_market_sanity_v1` });
  } catch { /* ignore */ }
  try {
    await clickhouse.command({ query: `DROP VIEW IF EXISTS pm_market_sanity_v1` });
  } catch { /* ignore */ }

  // Create view instead of materialized table - simpler and doesn't need memory
  // We'll query it with limits when needed
  const createViewQuery = `
    CREATE VIEW pm_market_sanity_v1 AS
    SELECT
      condition_id,
      sum(usdc_delta) AS total_usdc_delta,
      sum(token_delta) AS total_token_delta,
      count() AS event_count,
      countIf(source_type = 'CLOB') AS clob_events,
      countIf(source_type = 'PayoutRedemption') AS redemption_events,
      countIf(source_type IN ('ERC1155_Transfer', 'CTF_Transfer')) AS transfer_events,
      uniqExact(wallet_address) AS wallet_count,
      max(if(payout_norm IS NOT NULL, 1, 0)) AS is_resolved,
      if(
        abs(sum(usdc_delta)) < ${ZERO_SUM_EPSILON} AND abs(sum(token_delta)) < ${ZERO_SUM_EPSILON},
        1,
        0
      ) AS is_zero_sum
    FROM pm_unified_ledger_v7
    WHERE condition_id IS NOT NULL
      AND condition_id != ''
    GROUP BY condition_id
  `;

  await clickhouse.command({ query: createViewQuery });
  console.log('View pm_market_sanity_v1 created successfully.');
}

async function generateReport(): Promise<SanityReport> {
  console.log('\nGenerating market sanity report...\n');

  // Get summary stats - use direct aggregation with time limit
  const summaryQuery = `
    WITH market_data AS (
      SELECT
        condition_id,
        sum(usdc_delta) AS total_usdc_delta,
        sum(token_delta) AS total_token_delta,
        max(if(payout_norm IS NOT NULL, 1, 0)) AS is_resolved,
        if(
          abs(sum(usdc_delta)) < ${ZERO_SUM_EPSILON} AND abs(sum(token_delta)) < ${ZERO_SUM_EPSILON},
          1,
          0
        ) AS is_zero_sum
      FROM pm_unified_ledger_v7
      WHERE condition_id IS NOT NULL
        AND condition_id != ''
        AND source_type = 'CLOB'
      GROUP BY condition_id
    )
    SELECT
      count() AS total_markets,
      sumIf(1, is_zero_sum = 1) AS zero_sum_markets,
      sumIf(1, is_zero_sum = 0) AS non_zero_sum_markets,
      sumIf(1, is_resolved = 1) AS resolved_markets,
      sumIf(1, is_resolved = 0) AS unresolved_markets,
      round(sumIf(1, is_zero_sum = 1) / count() * 100, 2) AS zero_sum_rate
    FROM market_data
    SETTINGS max_execution_time = 300
  `;

  const summaryResult = await clickhouse.query({
    query: summaryQuery,
    format: 'JSONEachRow',
    clickhouse_settings: { max_execution_time: 300 }
  });
  const summaryRows = (await summaryResult.json()) as any[];
  const summary = summaryRows[0];

  console.log('='.repeat(80));
  console.log('MARKET SANITY SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total markets:        ${Number(summary.total_markets).toLocaleString()}`);
  console.log(`Zero-sum markets:     ${Number(summary.zero_sum_markets).toLocaleString()} (${summary.zero_sum_rate}%)`);
  console.log(`Non-zero-sum markets: ${Number(summary.non_zero_sum_markets).toLocaleString()}`);
  console.log(`Resolved markets:     ${Number(summary.resolved_markets).toLocaleString()}`);
  console.log(`Unresolved markets:   ${Number(summary.unresolved_markets).toLocaleString()}`);
  console.log('');

  // Get worst markets (highest absolute usdc/token imbalance) - CLOB only for V20
  const worstQuery = `
    WITH market_data AS (
      SELECT
        condition_id,
        sum(usdc_delta) AS total_usdc_delta,
        sum(token_delta) AS total_token_delta,
        count() AS event_count,
        count() AS clob_events,
        0 AS redemption_events,
        0 AS transfer_events,
        uniqExact(wallet_address) AS wallet_count,
        max(if(payout_norm IS NOT NULL, 1, 0)) AS is_resolved,
        if(
          abs(sum(usdc_delta)) < ${ZERO_SUM_EPSILON} AND abs(sum(token_delta)) < ${ZERO_SUM_EPSILON},
          1,
          0
        ) AS is_zero_sum
      FROM pm_unified_ledger_v7
      WHERE condition_id IS NOT NULL
        AND condition_id != ''
        AND source_type = 'CLOB'
      GROUP BY condition_id
    )
    SELECT *
    FROM market_data
    WHERE is_zero_sum = 0
    ORDER BY abs(total_usdc_delta) + abs(total_token_delta) DESC
    LIMIT 50
    SETTINGS max_execution_time = 300
  `;

  const worstResult = await clickhouse.query({
    query: worstQuery,
    format: 'JSONEachRow',
    clickhouse_settings: { max_execution_time: 300 }
  });
  const worstMarkets = (await worstResult.json()) as MarketSanity[];

  console.log('='.repeat(80));
  console.log('TOP 50 WORST MARKETS (highest imbalance)');
  console.log('='.repeat(80));
  console.log(
    'condition_id'.padEnd(20),
    'usdc_delta'.padStart(15),
    'token_delta'.padStart(15),
    'events'.padStart(8),
    'wallets'.padStart(8),
    'resolved'.padStart(10)
  );
  console.log('-'.repeat(80));

  for (const m of worstMarkets.slice(0, 20)) {
    const condShort = m.condition_id.slice(0, 18) + '...';
    const usdcStr =
      Math.abs(Number(m.total_usdc_delta)) >= 1000
        ? `$${(Number(m.total_usdc_delta) / 1000).toFixed(1)}K`
        : `$${Number(m.total_usdc_delta).toFixed(2)}`;
    const tokenStr =
      Math.abs(Number(m.total_token_delta)) >= 1000
        ? `${(Number(m.total_token_delta) / 1000).toFixed(1)}K`
        : Number(m.total_token_delta).toFixed(2);
    console.log(
      condShort.padEnd(20),
      usdcStr.padStart(15),
      tokenStr.padStart(15),
      String(m.event_count).padStart(8),
      String(m.wallet_count).padStart(8),
      (Number(m.is_resolved) ? 'YES' : 'NO').padStart(10)
    );
  }
  console.log('');

  // Get source type breakdown - simplified for CLOB-only analysis
  const sourceQuery = `
    SELECT
      source_type,
      count() AS events,
      sum(usdc_delta) AS total_usdc,
      sum(token_delta) AS total_tokens,
      uniqExact(condition_id) AS markets,
      uniqExact(wallet_address) AS wallets
    FROM pm_unified_ledger_v7
    WHERE condition_id IS NOT NULL AND condition_id != ''
    GROUP BY source_type
    ORDER BY events DESC
    SETTINGS max_execution_time = 300
  `;

  const sourceResult = await clickhouse.query({
    query: sourceQuery,
    format: 'JSONEachRow',
    clickhouse_settings: { max_execution_time: 300 }
  });
  const sourceBreakdown = (await sourceResult.json()) as any[];

  console.log('='.repeat(80));
  console.log('SOURCE TYPE BREAKDOWN (ALL MARKETS)');
  console.log('='.repeat(80));
  console.log(
    'source_type'.padEnd(25),
    'events'.padStart(12),
    'total_usdc'.padStart(15),
    'total_tokens'.padStart(15),
    'markets'.padStart(10)
  );
  console.log('-'.repeat(80));

  for (const s of sourceBreakdown) {
    const usdcStr =
      Math.abs(Number(s.total_usdc)) >= 1_000_000
        ? `$${(Number(s.total_usdc) / 1_000_000).toFixed(2)}M`
        : `$${(Number(s.total_usdc) / 1000).toFixed(1)}K`;
    const tokenStr =
      Math.abs(Number(s.total_tokens)) >= 1_000_000
        ? `${(Number(s.total_tokens) / 1_000_000).toFixed(2)}M`
        : `${(Number(s.total_tokens) / 1000).toFixed(1)}K`;
    console.log(
      s.source_type.padEnd(25),
      Number(s.events).toLocaleString().padStart(12),
      usdcStr.padStart(15),
      tokenStr.padStart(15),
      Number(s.markets).toLocaleString().padStart(10)
    );
  }
  console.log('');

  // Check resolution status for non-zero-sum markets - CLOB only
  const resolutionQuery = `
    WITH market_data AS (
      SELECT
        condition_id,
        max(if(payout_norm IS NOT NULL, 1, 0)) AS is_resolved,
        if(
          abs(sum(usdc_delta)) < ${ZERO_SUM_EPSILON} AND abs(sum(token_delta)) < ${ZERO_SUM_EPSILON},
          1,
          0
        ) AS is_zero_sum
      FROM pm_unified_ledger_v7
      WHERE condition_id IS NOT NULL
        AND condition_id != ''
        AND source_type = 'CLOB'
      GROUP BY condition_id
    )
    SELECT
      is_resolved,
      count() AS market_count,
      sumIf(1, is_zero_sum = 0) AS bad_markets,
      round(sumIf(1, is_zero_sum = 0) / count() * 100, 2) AS bad_rate
    FROM market_data
    GROUP BY is_resolved
    ORDER BY is_resolved
    SETTINGS max_execution_time = 300
  `;

  const resolutionResult = await clickhouse.query({
    query: resolutionQuery,
    format: 'JSONEachRow',
    clickhouse_settings: { max_execution_time: 300 }
  });
  const resolutionStats = (await resolutionResult.json()) as any[];

  console.log('='.repeat(80));
  console.log('RESOLUTION vs ZERO-SUM STATUS');
  console.log('='.repeat(80));
  console.log('resolved'.padEnd(12), 'total'.padStart(10), 'non_zero_sum'.padStart(15), 'bad_rate'.padStart(12));
  console.log('-'.repeat(50));
  for (const r of resolutionStats) {
    console.log(
      (Number(r.is_resolved) ? 'YES' : 'NO').padEnd(12),
      Number(r.market_count).toLocaleString().padStart(10),
      Number(r.bad_markets).toLocaleString().padStart(15),
      `${r.bad_rate}%`.padStart(12)
    );
  }
  console.log('');

  return {
    generated_at: new Date().toISOString(),
    summary: {
      total_markets: Number(summary.total_markets),
      zero_sum_markets: Number(summary.zero_sum_markets),
      non_zero_sum_markets: Number(summary.non_zero_sum_markets),
      resolved_markets: Number(summary.resolved_markets),
      unresolved_markets: Number(summary.unresolved_markets),
      zero_sum_rate: Number(summary.zero_sum_rate),
    },
    worst_markets: worstMarkets.map((m) => ({
      ...m,
      total_usdc_delta: Number(m.total_usdc_delta),
      total_token_delta: Number(m.total_token_delta),
      event_count: Number(m.event_count),
      clob_events: Number(m.clob_events),
      redemption_events: Number(m.redemption_events),
      transfer_events: Number(m.transfer_events),
      wallet_count: Number(m.wallet_count),
      is_resolved: Boolean(Number(m.is_resolved)),
      is_zero_sum: Boolean(Number(m.is_zero_sum)),
    })),
    source_type_breakdown: sourceBreakdown,
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const createView = args.includes('--create-view');

  if (createView) {
    await createMarketSanityTable();
  }

  // Check if table exists
  try {
    await clickhouse.query({
      query: `SELECT count() FROM pm_market_sanity_v1 LIMIT 1`,
      format: 'JSONEachRow',
    });
  } catch {
    console.log('Table pm_market_sanity_v1 does not exist. Creating...');
    await createMarketSanityTable();
  }

  const report = await generateReport();

  // Save report to file
  const timestamp = new Date().toISOString().slice(0, 10);
  const outputPath = `/tmp/market-sanity-${timestamp}.json`;
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
  console.log(`\nReport saved to: ${outputPath}`);

  // Key insights
  console.log('='.repeat(80));
  console.log('KEY INSIGHTS');
  console.log('='.repeat(80));
  console.log(`
1. Zero-sum rate: ${report.summary.zero_sum_rate}% of markets pass zero-sum check
   - These are markets where the ledger is internally consistent
   - V20 should be accurate for wallets trading only in these markets

2. Non-zero-sum markets: ${report.summary.non_zero_sum_markets.toLocaleString()}
   - These markets have data inconsistencies
   - Likely causes: missing events, duplicate events, ERC1155 transfers

3. RECOMMENDATION:
   - Flag wallets with high exposure to non-zero-sum markets
   - V20 accuracy claims should be conditional on market quality
`);
}

main().catch(console.error);
