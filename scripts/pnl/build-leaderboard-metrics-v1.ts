#!/usr/bin/env npx tsx
/**
 * ============================================================================
 * LEADERBOARD METRICS MVP V1 - Build Script
 * ============================================================================
 *
 * Terminal 3 Mission: Build queryable V1 metrics leaderboard on top of
 * leaderboard_v1_clob surface WITHOUT touching validation-lane work.
 *
 * Creates:
 * - pm_wallet_leaderboard_universe_v1: Golden universe of qualified wallets
 * - pm_wallet_category_pnl_v1: Category-level PnL rollups
 * - pm_wallet_pnl_timeseries_daily_v1: Daily PnL time series for risk metrics
 * - pm_wallet_risk_metrics_v1: Sortino, Omega, and other risk metrics
 * - vw_leaderboard_v1: Final ranked leaderboard view
 *
 * Non-negotiables:
 * - Use canonical routing only: getLedgerForSurface('leaderboard_v1_clob')
 * - Use V12-style realized/synthetic realized logic
 * - No new PnL theory - use existing components
 *
 * Usage:
 *   npx tsx scripts/pnl/build-leaderboard-metrics-v1.ts
 *   npx tsx scripts/pnl/build-leaderboard-metrics-v1.ts --dry-run
 *   npx tsx scripts/pnl/build-leaderboard-metrics-v1.ts --limit-wallets 1000
 *   npx tsx scripts/pnl/build-leaderboard-metrics-v1.ts --since-days 365
 *
 * Terminal: Terminal 3
 * Date: 2025-12-09
 */

import { createClient, ClickHouseClient } from '@clickhouse/client';
import {
  getLedgerForSurface,
  CANONICAL_TABLES,
} from '../../lib/pnl/canonicalTables';
import { assertLedgerMatchesSurface } from '../../lib/pnl/assertCanonicalTable';

// ============================================================================
// Configuration
// ============================================================================

interface BuildConfig {
  dryRun: boolean;
  limitWallets?: number;
  sinceDays?: number;
  minEvents: number;
  minResolvedMarkets: number;
  minActiveDays: number;
  minAbsRealizedPnl: number;
  requirePositivePnl: boolean;
  minTimeSeriesBuckets: number;
}

const DEFAULT_CONFIG: BuildConfig = {
  dryRun: false,
  minEvents: 200,
  minResolvedMarkets: 30,
  minActiveDays: 90,
  minAbsRealizedPnl: 500,
  requirePositivePnl: true,
  minTimeSeriesBuckets: 14, // Minimum 2 weeks of daily data for risk metrics
};

// Parse CLI args
function parseArgs(): BuildConfig {
  const config = { ...DEFAULT_CONFIG };
  const args = process.argv.slice(2);

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--dry-run':
        config.dryRun = true;
        break;
      case '--limit-wallets':
        config.limitWallets = parseInt(args[++i], 10);
        break;
      case '--since-days':
        config.sinceDays = parseInt(args[++i], 10);
        break;
      case '--min-events':
        config.minEvents = parseInt(args[++i], 10);
        break;
      case '--min-resolved':
        config.minResolvedMarkets = parseInt(args[++i], 10);
        break;
    }
  }

  return config;
}

// ============================================================================
// ClickHouse Client
// ============================================================================

let chClient: ClickHouseClient | null = null;

function getClient(): ClickHouseClient {
  if (!chClient) {
    chClient = createClient({
      url: process.env.CLICKHOUSE_HOST,
      username: process.env.CLICKHOUSE_USER,
      password: process.env.CLICKHOUSE_PASSWORD,
      request_timeout: 600000, // 10 min for heavy operations
    });
  }
  return chClient;
}

async function closeClient(): Promise<void> {
  if (chClient) {
    const client = chClient;
    chClient = null;
    await client.close();
  }
}

// ============================================================================
// Table Names (Output Tables)
// ============================================================================

const OUTPUT_TABLES = {
  UNIVERSE: 'pm_wallet_leaderboard_universe_v1',
  CATEGORY_PNL: 'pm_wallet_category_pnl_v1',
  TIMESERIES: 'pm_wallet_pnl_timeseries_daily_v1',
  RISK_METRICS: 'pm_wallet_risk_metrics_v1',
  LEADERBOARD_VIEW: 'vw_leaderboard_v1',
} as const;

// ============================================================================
// Step 1: Build Universe Table
// ============================================================================

async function buildUniverseTable(config: BuildConfig): Promise<number> {
  console.log('\n=== Step 1: Building Wallet Universe ===');

  const ch = getClient();
  const ledgerTable = getLedgerForSurface('leaderboard_v1_clob');

  // Safety: Assert we're using the right table
  assertLedgerMatchesSurface(ledgerTable, 'leaderboard_v1_clob');
  console.log(`Using ledger: ${ledgerTable}`);

  const limitClause = config.limitWallets
    ? `LIMIT ${config.limitWallets}`
    : '';

  const sinceDaysFilter = config.sinceDays
    ? `AND event_time >= now() - INTERVAL ${config.sinceDays} DAY`
    : '';

  // First, drop existing table if exists
  if (!config.dryRun) {
    await ch.command({
      query: `DROP TABLE IF EXISTS ${OUTPUT_TABLES.UNIVERSE}`,
    });
  }

  // V12-style realized PnL formula with universe criteria
  const createQuery = `
    CREATE TABLE ${OUTPUT_TABLES.UNIVERSE}
    ENGINE = MergeTree()
    ORDER BY (wallet)
    AS
    SELECT
      wallet_address as wallet,
      count() as total_events,
      -- Resolved events: payout_numerators exists and not empty
      countIf(payout_numerators IS NOT NULL AND payout_numerators != '') as resolved_events,
      -- Unresolved percentage
      if(count() > 0,
        countIf(payout_numerators IS NULL OR payout_numerators = '') * 100.0 / count(),
        0
      ) as unresolved_pct,
      -- Unique resolved conditions (proxy for resolved_markets)
      uniqExactIf(condition_id, payout_numerators IS NOT NULL AND payout_numerators != '') as resolved_conditions,
      -- V12-style realized PnL: usdc_delta + token_delta * payout_norm for resolved
      sum(
        if(payout_numerators IS NOT NULL AND payout_numerators != '',
          usdc_delta + token_delta * coalesce(payout_norm, 0),
          0
        )
      ) as realized_pnl,
      -- Active days calculation
      dateDiff('day', min(event_time), max(event_time)) as active_days,
      min(event_time) as first_ts,
      max(event_time) as last_ts,
      -- Total volume (absolute USDC spent)
      sum(abs(usdc_delta)) as total_volume_usdc,
      -- Role breakdown
      countIf(role = 'maker') as maker_events,
      countIf(role = 'taker') as taker_events
    FROM ${ledgerTable}
    WHERE 1=1 ${sinceDaysFilter}
    GROUP BY wallet_address
    HAVING
      total_events >= ${config.minEvents}
      AND resolved_conditions >= ${config.minResolvedMarkets}
      AND active_days >= ${config.minActiveDays}
      AND abs(realized_pnl) >= ${config.minAbsRealizedPnl}
      ${config.requirePositivePnl ? 'AND realized_pnl > 0' : ''}
    ORDER BY realized_pnl DESC
    ${limitClause}
  `;

  if (config.dryRun) {
    console.log('[DRY RUN] Would execute:');
    console.log(createQuery.slice(0, 500) + '...');
    return 0;
  }

  console.log('Creating universe table...');
  await ch.command({ query: createQuery });

  // Get count
  const countResult = await ch.query({
    query: `SELECT count() as cnt FROM ${OUTPUT_TABLES.UNIVERSE}`,
    format: 'JSONEachRow',
  });
  const rows = await countResult.json<{ cnt: number }[]>();
  const count = rows[0]?.cnt || 0;

  console.log(`Universe table created with ${count} wallets`);
  return count;
}

// ============================================================================
// Step 2: Build Category PnL Table
// ============================================================================

async function buildCategoryPnlTable(config: BuildConfig): Promise<void> {
  console.log('\n=== Step 2: Building Category PnL Rollups ===');

  const ch = getClient();
  const ledgerTable = getLedgerForSurface('leaderboard_v1_clob');

  if (!config.dryRun) {
    await ch.command({
      query: `DROP TABLE IF EXISTS ${OUTPUT_TABLES.CATEGORY_PNL}`,
    });
  }

  // Category mapping - normalize to 6 buckets
  // Categories in metadata: Crypto, Other, Sports, Politics, Tech, Finance, World, Culture, Economy
  const categoryMapping = `
    multiIf(
      m.category = 'Politics', 'politics',
      m.category = 'Sports', 'sports',
      m.category = 'Crypto', 'crypto',
      m.category IN ('Finance', 'Economy'), 'macro',
      m.category IN ('Tech', 'World', 'Culture'), 'other',
      'other'
    )
  `;

  const createQuery = `
    CREATE TABLE ${OUTPUT_TABLES.CATEGORY_PNL}
    ENGINE = MergeTree()
    ORDER BY (wallet, category)
    AS
    SELECT
      l.wallet_address as wallet,
      ${categoryMapping} as category,
      -- V12-style realized PnL per category
      sum(
        if(l.payout_numerators IS NOT NULL AND l.payout_numerators != '',
          l.usdc_delta + l.token_delta * coalesce(l.payout_norm, 0),
          0
        )
      ) as realized_pnl_category,
      count() as events_category,
      countIf(l.payout_numerators IS NOT NULL AND l.payout_numerators != '') as resolved_events_category,
      if(count() > 0,
        countIf(l.payout_numerators IS NULL OR l.payout_numerators = '') * 100.0 / count(),
        0
      ) as unresolved_pct_category
    FROM ${ledgerTable} l
    INNER JOIN ${OUTPUT_TABLES.UNIVERSE} u ON l.wallet_address = u.wallet
    LEFT JOIN ${CANONICAL_TABLES.MARKET_METADATA} m ON l.condition_id = m.condition_id
    GROUP BY l.wallet_address, category
    HAVING events_category > 0
  `;

  if (config.dryRun) {
    console.log('[DRY RUN] Would execute category PnL creation');
    return;
  }

  console.log('Creating category PnL table...');
  await ch.command({ query: createQuery });

  const countResult = await ch.query({
    query: `SELECT uniqExact(wallet) as wallets, uniqExact(category) as categories FROM ${OUTPUT_TABLES.CATEGORY_PNL}`,
    format: 'JSONEachRow',
  });
  const rows = await countResult.json<{ wallets: number; categories: number }[]>();
  console.log(`Category PnL table created: ${rows[0]?.wallets} wallets, ${rows[0]?.categories} categories`);
}

// ============================================================================
// Step 3: Build Time Series Table (Daily)
// ============================================================================

async function buildTimeSeriesTable(config: BuildConfig): Promise<void> {
  console.log('\n=== Step 3: Building Daily PnL Time Series ===');

  const ch = getClient();
  const ledgerTable = getLedgerForSurface('leaderboard_v1_clob');

  if (!config.dryRun) {
    await ch.command({
      query: `DROP TABLE IF EXISTS ${OUTPUT_TABLES.TIMESERIES}`,
    });
  }

  // Daily buckets with realized PnL delta per day
  const createQuery = `
    CREATE TABLE ${OUTPUT_TABLES.TIMESERIES}
    ENGINE = MergeTree()
    ORDER BY (wallet, bucket_ts)
    AS
    SELECT
      wallet,
      bucket_ts,
      realized_pnl_delta,
      sum(realized_pnl_delta) OVER (PARTITION BY wallet ORDER BY bucket_ts) as cumulative_realized_pnl
    FROM (
      SELECT
        l.wallet_address as wallet,
        toStartOfDay(l.event_time) as bucket_ts,
        -- V12-style realized PnL delta per day
        sum(
          if(l.payout_numerators IS NOT NULL AND l.payout_numerators != '',
            l.usdc_delta + l.token_delta * coalesce(l.payout_norm, 0),
            0
          )
        ) as realized_pnl_delta
      FROM ${ledgerTable} l
      INNER JOIN ${OUTPUT_TABLES.UNIVERSE} u ON l.wallet_address = u.wallet
      GROUP BY l.wallet_address, toStartOfDay(l.event_time)
    )
    ORDER BY wallet, bucket_ts
  `;

  if (config.dryRun) {
    console.log('[DRY RUN] Would execute time series creation');
    return;
  }

  console.log('Creating time series table...');
  await ch.command({ query: createQuery });

  const countResult = await ch.query({
    query: `SELECT uniqExact(wallet) as wallets, count() as rows FROM ${OUTPUT_TABLES.TIMESERIES}`,
    format: 'JSONEachRow',
  });
  const rows = await countResult.json<{ wallets: number; rows: number }[]>();
  console.log(`Time series table created: ${rows[0]?.wallets} wallets, ${rows[0]?.rows} daily buckets`);
}

// ============================================================================
// Step 4: Build Risk Metrics Table
// ============================================================================

async function buildRiskMetricsTable(config: BuildConfig): Promise<void> {
  console.log('\n=== Step 4: Building Risk Metrics ===');

  const ch = getClient();

  if (!config.dryRun) {
    await ch.command({
      query: `DROP TABLE IF EXISTS ${OUTPUT_TABLES.RISK_METRICS}`,
    });
  }

  // Risk metrics:
  // - mu_bucket: Mean daily PnL delta
  // - downside_dev: Standard deviation of negative deltas only
  // - sortino_proxy: mu / downside_dev (if downside_dev > 0)
  // - omega_proxy: sum(positive deltas) / abs(sum(negative deltas))
  const createQuery = `
    CREATE TABLE ${OUTPUT_TABLES.RISK_METRICS}
    ENGINE = MergeTree()
    ORDER BY (wallet)
    AS
    SELECT
      wallet,
      bucket_count,
      mu_bucket,
      downside_dev,
      -- Sortino: mean / downside deviation (risk-adjusted return)
      if(downside_dev > 0 AND bucket_count >= ${config.minTimeSeriesBuckets},
        mu_bucket / downside_dev,
        0
      ) as sortino_proxy,
      -- Omega: gains / losses ratio
      if(abs(sum_negative) > 0.001 AND bucket_count >= ${config.minTimeSeriesBuckets},
        sum_positive / abs(sum_negative),
        if(sum_positive > 0, 999, 0)
      ) as omega_proxy,
      sum_positive,
      sum_negative,
      max_drawdown_pct
    FROM (
      SELECT
        wallet,
        count() as bucket_count,
        avg(realized_pnl_delta) as mu_bucket,
        -- Downside deviation: stddev of negative returns only
        stddevPopIf(realized_pnl_delta, realized_pnl_delta < 0) as downside_dev,
        -- Sum of positive and negative deltas for Omega
        sumIf(realized_pnl_delta, realized_pnl_delta > 0) as sum_positive,
        sumIf(realized_pnl_delta, realized_pnl_delta < 0) as sum_negative,
        -- Max drawdown approximation (peak to trough on cumulative)
        if(max(cumulative_realized_pnl) > 0,
          (max(cumulative_realized_pnl) - min(cumulative_realized_pnl)) * 100.0 / max(cumulative_realized_pnl),
          0
        ) as max_drawdown_pct
      FROM ${OUTPUT_TABLES.TIMESERIES}
      GROUP BY wallet
    )
    WHERE bucket_count >= ${config.minTimeSeriesBuckets}
  `;

  if (config.dryRun) {
    console.log('[DRY RUN] Would execute risk metrics creation');
    return;
  }

  console.log('Creating risk metrics table...');
  await ch.command({ query: createQuery });

  const countResult = await ch.query({
    query: `SELECT count() as cnt FROM ${OUTPUT_TABLES.RISK_METRICS}`,
    format: 'JSONEachRow',
  });
  const rows = await countResult.json<{ cnt: number }[]>();
  console.log(`Risk metrics table created: ${rows[0]?.cnt} wallets with sufficient data`);
}

// ============================================================================
// Step 5: Build Final Leaderboard View
// ============================================================================

async function buildLeaderboardView(config: BuildConfig): Promise<void> {
  console.log('\n=== Step 5: Building Final Leaderboard View ===');

  const ch = getClient();

  if (!config.dryRun) {
    await ch.command({
      query: `DROP VIEW IF EXISTS ${OUTPUT_TABLES.LEADERBOARD_VIEW}`,
    });
  }

  // Final view joins universe, risk metrics, and top category
  const createQuery = `
    CREATE VIEW ${OUTPUT_TABLES.LEADERBOARD_VIEW} AS
    SELECT
      u.wallet AS wallet,
      u.realized_pnl AS realized_pnl,
      coalesce(r.sortino_proxy, 0) as sortino_proxy,
      coalesce(r.omega_proxy, 0) as omega_proxy,
      coalesce(r.mu_bucket, 0) as mu_bucket,
      u.active_days,
      u.resolved_events,
      u.unresolved_pct,
      u.total_events,
      u.total_volume_usdc,
      u.resolved_conditions as resolved_markets,
      -- Top category by PnL
      top_cat.category as top_category,
      top_cat.realized_pnl_category as realized_pnl_top_category,
      -- Consistency proxy: days with positive PnL / total days
      coalesce(ts_stats.positive_days_pct, 0) as consistency_proxy,
      -- Risk metrics available flag
      r.wallet IS NOT NULL as has_risk_metrics,
      r.max_drawdown_pct,
      u.first_ts,
      u.last_ts
    FROM ${OUTPUT_TABLES.UNIVERSE} u
    LEFT JOIN ${OUTPUT_TABLES.RISK_METRICS} r ON u.wallet = r.wallet
    LEFT JOIN (
      -- Get top category for each wallet (use subquery to avoid nested aggregation)
      SELECT
        wallet,
        category,
        realized_pnl_category
      FROM (
        SELECT
          wallet,
          category,
          realized_pnl_category,
          row_number() OVER (PARTITION BY wallet ORDER BY realized_pnl_category DESC) as rn
        FROM ${OUTPUT_TABLES.CATEGORY_PNL}
      )
      WHERE rn = 1
    ) top_cat ON u.wallet = top_cat.wallet
    LEFT JOIN (
      -- Get consistency stats from timeseries
      SELECT
        wallet,
        countIf(realized_pnl_delta > 0) * 100.0 / count() as positive_days_pct
      FROM ${OUTPUT_TABLES.TIMESERIES}
      GROUP BY wallet
    ) ts_stats ON u.wallet = ts_stats.wallet
    ORDER BY
      sortino_proxy DESC,
      mu_bucket DESC,
      omega_proxy DESC,
      realized_pnl DESC
  `;

  if (config.dryRun) {
    console.log('[DRY RUN] Would execute leaderboard view creation');
    return;
  }

  console.log('Creating leaderboard view...');
  await ch.command({ query: createQuery });
  console.log('Leaderboard view created successfully');
}

// ============================================================================
// Safety Checks
// ============================================================================

async function runSafetyChecks(): Promise<{ passed: boolean; issues: string[] }> {
  console.log('\n=== Running Safety Checks ===');

  const ch = getClient();
  const issues: string[] = [];

  // Check 1: No NaN or Inf values in risk metrics
  const nanCheck = await ch.query({
    query: `
      SELECT
        countIf(isNaN(sortino_proxy) OR isInfinite(sortino_proxy)) as bad_sortino,
        countIf(isNaN(omega_proxy) OR isInfinite(omega_proxy)) as bad_omega,
        countIf(isNaN(mu_bucket) OR isInfinite(mu_bucket)) as bad_mu
      FROM ${OUTPUT_TABLES.RISK_METRICS}
    `,
    format: 'JSONEachRow',
  });
  const nanRows = await nanCheck.json<any[]>();
  if (nanRows[0]?.bad_sortino > 0 || nanRows[0]?.bad_omega > 0 || nanRows[0]?.bad_mu > 0) {
    issues.push(`Found NaN/Inf values: sortino=${nanRows[0].bad_sortino}, omega=${nanRows[0].bad_omega}, mu=${nanRows[0].bad_mu}`);
  } else {
    console.log('  [PASS] No NaN/Inf values in risk metrics');
  }

  // Check 2: Reasonable PnL range (sanity check for absurd spikes)
  const rangeCheck = await ch.query({
    query: `
      SELECT
        min(realized_pnl) as min_pnl,
        max(realized_pnl) as max_pnl,
        avg(realized_pnl) as avg_pnl
      FROM ${OUTPUT_TABLES.UNIVERSE}
    `,
    format: 'JSONEachRow',
  });
  const rangeRows = await rangeCheck.json<any[]>();
  const maxPnl = rangeRows[0]?.max_pnl || 0;
  if (maxPnl > 100_000_000) {
    issues.push(`Suspicious max PnL: $${maxPnl.toLocaleString()} (>$100M)`);
  } else {
    console.log(`  [PASS] PnL range reasonable: $${rangeRows[0]?.min_pnl?.toFixed(2)} to $${maxPnl.toFixed(2)}`);
  }

  // Check 3: Time series has minimum buckets for wallets with risk metrics
  const bucketCheck = await ch.query({
    query: `
      SELECT
        countIf(bucket_count < 14) as wallets_with_few_buckets,
        count() as total_wallets
      FROM ${OUTPUT_TABLES.RISK_METRICS}
    `,
    format: 'JSONEachRow',
  });
  const bucketRows = await bucketCheck.json<any[]>();
  if (bucketRows[0]?.wallets_with_few_buckets > 0) {
    issues.push(`${bucketRows[0].wallets_with_few_buckets} wallets have <14 time buckets in risk metrics`);
  } else {
    console.log('  [PASS] All wallets in risk metrics have >= 14 time buckets');
  }

  // Check 4: Zero-sum sanity - check a sample wallet
  const sampleWallet = await ch.query({
    query: `SELECT wallet FROM ${OUTPUT_TABLES.UNIVERSE} LIMIT 1`,
    format: 'JSONEachRow',
  });
  const sampleRows = await sampleWallet.json<{ wallet: string }[]>();
  if (sampleRows[0]) {
    const wallet = sampleRows[0].wallet;
    const ledgerTable = getLedgerForSurface('leaderboard_v1_clob');

    // Check that category PnL sums to total PnL
    const catSum = await ch.query({
      query: `SELECT sum(realized_pnl_category) as cat_total FROM ${OUTPUT_TABLES.CATEGORY_PNL} WHERE wallet = {wallet:String}`,
      query_params: { wallet },
      format: 'JSONEachRow',
    });
    const uniPnl = await ch.query({
      query: `SELECT realized_pnl FROM ${OUTPUT_TABLES.UNIVERSE} WHERE wallet = {wallet:String}`,
      query_params: { wallet },
      format: 'JSONEachRow',
    });

    const catTotal = (await catSum.json<any[]>())[0]?.cat_total || 0;
    const uniTotal = (await uniPnl.json<any[]>())[0]?.realized_pnl || 0;
    const diff = Math.abs(catTotal - uniTotal);

    if (diff > 1) {
      issues.push(`Category PnL sum ($${catTotal.toFixed(2)}) differs from universe PnL ($${uniTotal.toFixed(2)}) by $${diff.toFixed(2)}`);
    } else {
      console.log(`  [PASS] Category PnL sums match universe (diff: $${diff.toFixed(2)})`);
    }
  }

  console.log(`\nSafety checks: ${issues.length === 0 ? 'ALL PASSED' : `${issues.length} ISSUES FOUND`}`);
  return { passed: issues.length === 0, issues };
}

// ============================================================================
// Sample Output
// ============================================================================

async function generateSampleOutput(): Promise<void> {
  console.log('\n=== Sample Output ===');

  const ch = getClient();

  // Top 20 overall
  console.log('\n--- Top 20 Wallets by Composite Ranking ---');
  const top20 = await ch.query({
    query: `
      SELECT
        wallet,
        round(realized_pnl, 2) as realized_pnl,
        round(sortino_proxy, 3) as sortino,
        round(omega_proxy, 3) as omega,
        round(consistency_proxy, 1) as consistency_pct,
        active_days,
        resolved_markets,
        top_category
      FROM ${OUTPUT_TABLES.LEADERBOARD_VIEW}
      ORDER BY sortino_proxy DESC, mu_bucket DESC, omega_proxy DESC, realized_pnl DESC
      LIMIT 20
    `,
    format: 'JSONEachRow',
  });
  const top20Rows = await top20.json<any[]>();
  console.log('Rank | Wallet | Realized PnL | Sortino | Omega | Consistency | Days | Markets | Top Cat');
  console.log('-'.repeat(120));
  top20Rows.forEach((r, i) => {
    const shortWallet = r.wallet.slice(0, 10) + '...' + r.wallet.slice(-6);
    console.log(
      `${(i + 1).toString().padStart(2)} | ${shortWallet} | $${r.realized_pnl.toLocaleString().padStart(12)} | ${r.sortino.toFixed(3).padStart(7)} | ${r.omega.toFixed(3).padStart(7)} | ${r.consistency_pct.toFixed(1).padStart(5)}% | ${r.active_days.toString().padStart(4)} | ${r.resolved_markets.toString().padStart(5)} | ${r.top_category}`
    );
  });

  // Top 10 per category
  console.log('\n--- Top 10 by Category ---');
  const categories = ['politics', 'sports', 'crypto', 'macro', 'other'];

  for (const cat of categories) {
    const catTop = await ch.query({
      query: `
        SELECT
          c.wallet,
          round(c.realized_pnl_category, 2) as cat_pnl,
          c.resolved_events_category as resolved,
          round(c.unresolved_pct_category, 1) as unresolved_pct,
          round(u.realized_pnl, 2) as total_pnl
        FROM ${OUTPUT_TABLES.CATEGORY_PNL} c
        JOIN ${OUTPUT_TABLES.UNIVERSE} u ON c.wallet = u.wallet
        WHERE c.category = {cat:String}
        ORDER BY c.realized_pnl_category DESC
        LIMIT 10
      `,
      query_params: { cat },
      format: 'JSONEachRow',
    });
    const catRows = await catTop.json<any[]>();

    if (catRows.length > 0) {
      console.log(`\n[${cat.toUpperCase()}]`);
      catRows.forEach((r, i) => {
        const shortWallet = r.wallet.slice(0, 10) + '...' + r.wallet.slice(-6);
        console.log(
          `  ${(i + 1).toString().padStart(2)}. ${shortWallet}: $${r.cat_pnl.toLocaleString()} (${r.resolved} resolved, ${r.unresolved_pct}% unres)`
        );
      });
    }
  }

  // Summary stats
  console.log('\n--- Summary Statistics ---');
  const stats = await ch.query({
    query: `
      SELECT
        count() as total_wallets,
        round(avg(realized_pnl), 2) as avg_pnl,
        round(median(realized_pnl), 2) as median_pnl,
        round(avg(sortino_proxy), 3) as avg_sortino,
        round(avg(omega_proxy), 3) as avg_omega,
        round(avg(active_days), 0) as avg_active_days,
        round(avg(resolved_markets), 0) as avg_resolved_markets
      FROM ${OUTPUT_TABLES.LEADERBOARD_VIEW}
    `,
    format: 'JSONEachRow',
  });
  const statsRows = await stats.json<any[]>();
  const s = statsRows[0];
  console.log(`Total wallets in leaderboard: ${s.total_wallets}`);
  console.log(`Average realized PnL: $${s.avg_pnl.toLocaleString()}`);
  console.log(`Median realized PnL: $${s.median_pnl.toLocaleString()}`);
  console.log(`Average Sortino: ${s.avg_sortino}`);
  console.log(`Average Omega: ${s.avg_omega}`);
  console.log(`Average active days: ${s.avg_active_days}`);
  console.log(`Average resolved markets: ${s.avg_resolved_markets}`);
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  console.log('========================================');
  console.log('LEADERBOARD METRICS MVP V1 - Build Script');
  console.log('========================================');
  console.log(`Timestamp: ${new Date().toISOString()}`);

  const config = parseArgs();
  console.log('\nConfiguration:');
  console.log(`  Dry run: ${config.dryRun}`);
  console.log(`  Limit wallets: ${config.limitWallets || 'none'}`);
  console.log(`  Since days: ${config.sinceDays || 'all time'}`);
  console.log(`  Min events: ${config.minEvents}`);
  console.log(`  Min resolved markets: ${config.minResolvedMarkets}`);
  console.log(`  Min active days: ${config.minActiveDays}`);
  console.log(`  Min abs realized PnL: $${config.minAbsRealizedPnl}`);
  console.log(`  Require positive PnL: ${config.requirePositivePnl}`);

  // Validate surface routing
  const ledgerTable = getLedgerForSurface('leaderboard_v1_clob');
  console.log(`\nCanonical ledger: ${ledgerTable}`);

  try {
    // Step 1: Universe
    const universeCount = await buildUniverseTable(config);
    if (config.dryRun) {
      console.log('\n[DRY RUN COMPLETE] No tables were created.');
      return;
    }

    if (universeCount === 0) {
      console.log('\nWARNING: No wallets qualified for universe. Check criteria.');
      return;
    }

    // Step 2: Category PnL
    await buildCategoryPnlTable(config);

    // Step 3: Time Series
    await buildTimeSeriesTable(config);

    // Step 4: Risk Metrics
    await buildRiskMetricsTable(config);

    // Step 5: Leaderboard View
    await buildLeaderboardView(config);

    // Safety Checks
    const { passed, issues } = await runSafetyChecks();
    if (!passed) {
      console.log('\nSAFETY CHECK ISSUES:');
      issues.forEach((issue) => console.log(`  - ${issue}`));
    }

    // Sample Output
    await generateSampleOutput();

    console.log('\n========================================');
    console.log('BUILD COMPLETE');
    console.log('========================================');
    console.log('\nCreated tables:');
    console.log(`  - ${OUTPUT_TABLES.UNIVERSE}`);
    console.log(`  - ${OUTPUT_TABLES.CATEGORY_PNL}`);
    console.log(`  - ${OUTPUT_TABLES.TIMESERIES}`);
    console.log(`  - ${OUTPUT_TABLES.RISK_METRICS}`);
    console.log(`  - ${OUTPUT_TABLES.LEADERBOARD_VIEW} (view)`);

  } catch (error) {
    console.error('\nBUILD FAILED:', error);
    throw error;
  } finally {
    await closeClient();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
