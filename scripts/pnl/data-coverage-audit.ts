/**
 * Data Coverage Audit - Phase 2 of PnL Accuracy Improvement
 *
 * Analyzes data completeness across all layers for benchmark wallets:
 * 1. CLOB data (pm_trader_events_v2)
 * 2. Token mapping (pm_token_to_condition_map_v3)
 * 3. Resolution data (pm_condition_resolutions)
 * 4. CTF events (pm_ctf_events - redemptions)
 * 5. FPMM data (pm_fpmm_trades)
 *
 * Identifies gaps that could cause PnL discrepancies.
 *
 * Reference: docs/systems/pnl/PNL_ACCURACY_IMPROVEMENT_PLAN.md
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

import { clickhouse } from '../../lib/clickhouse/client';
import { UI_BENCHMARK_WALLETS, UIBenchmarkWallet } from './ui-benchmark-constants';
import { computeWalletActivityPnlV3Debug } from '../../lib/pnl/uiActivityEngineV3';

interface DataCoverageMetrics {
  wallet: string;
  label: string;
  // CLOB Data
  clob_events_raw: number;
  clob_events_deduped: number;
  clob_unique_tokens: number;
  clob_volume_usdc: number;
  clob_buy_count: number;
  clob_sell_count: number;
  // Token Mapping
  mapped_tokens: number;
  unmapped_tokens: number;
  mapping_coverage_pct: number;
  // Conditions
  unique_conditions: number;
  resolved_conditions: number;
  unresolved_conditions: number;
  resolution_coverage_pct: number;
  // CTF Events (Redemptions)
  ctf_redemption_events: number;
  ctf_redemption_usdc: number;
  // FPMM
  fpmm_events: number;
  fpmm_volume_usdc: number;
  // Computed PnL
  v3_pnl: number;
  ui_pnl: number;
  error_pct: number;
  sign_match: boolean;
}

async function auditWalletDataCoverage(wallet: string): Promise<Partial<DataCoverageMetrics>> {
  const lowerWallet = wallet.toLowerCase();

  // 1. CLOB Data - raw count
  const clobRaw = await clickhouse.query({
    query: `
      SELECT count() as cnt
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = '${lowerWallet}' AND is_deleted = 0
    `,
    format: 'JSONEachRow',
  });
  const clobRawData = (await clobRaw.json()) as any[];
  const clob_events_raw = Number(clobRawData[0]?.cnt || 0);

  // 2. CLOB Data - deduplicated with stats
  const clobDeduped = await clickhouse.query({
    query: `
      SELECT
        count() as cnt,
        uniq(token_id) as unique_tokens,
        sum(usdc) as volume_usdc,
        countIf(side = 'buy') as buy_count,
        countIf(side = 'sell') as sell_count
      FROM (
        SELECT
          event_id,
          any(token_id) as token_id,
          any(side) as side,
          any(usdc_amount) / 1000000.0 as usdc
        FROM pm_trader_events_v2
        WHERE lower(trader_wallet) = '${lowerWallet}' AND is_deleted = 0
        GROUP BY event_id
      )
    `,
    format: 'JSONEachRow',
  });
  const clobDedupedData = (await clobDeduped.json()) as any[];
  const clobStats = clobDedupedData[0] || {};

  // 3. Token Mapping Coverage
  const mappingCoverage = await clickhouse.query({
    query: `
      SELECT
        countIf(m.condition_id IS NOT NULL AND m.condition_id != '') as mapped,
        countIf(m.condition_id IS NULL OR m.condition_id = '') as unmapped
      FROM (
        SELECT DISTINCT token_id
        FROM (
          SELECT any(token_id) as token_id
          FROM pm_trader_events_v2
          WHERE lower(trader_wallet) = '${lowerWallet}' AND is_deleted = 0
          GROUP BY event_id
        )
      ) t
      LEFT JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
    `,
    format: 'JSONEachRow',
  });
  const mappingData = (await mappingCoverage.json()) as any[];
  const mappingStats = mappingData[0] || {};

  // 4. Resolution Coverage
  const resolutionCoverage = await clickhouse.query({
    query: `
      SELECT
        count() as total_conditions,
        countIf(r.condition_id IS NOT NULL) as resolved,
        countIf(r.condition_id IS NULL) as unresolved
      FROM (
        SELECT DISTINCT m.condition_id
        FROM (
          SELECT any(token_id) as token_id
          FROM pm_trader_events_v2
          WHERE lower(trader_wallet) = '${lowerWallet}' AND is_deleted = 0
          GROUP BY event_id
        ) fills
        INNER JOIN pm_token_to_condition_map_v3 m ON fills.token_id = m.token_id_dec
        WHERE m.condition_id IS NOT NULL AND m.condition_id != ''
      ) c
      LEFT JOIN pm_condition_resolutions r ON lower(c.condition_id) = lower(r.condition_id)
    `,
    format: 'JSONEachRow',
  });
  const resolutionData = (await resolutionCoverage.json()) as any[];
  const resolutionStats = resolutionData[0] || {};

  // 5. CTF Events (Redemptions)
  // Note: amount_or_payout is in USDC microunits (1e6) for PayoutRedemption events
  const ctfRedemptions = await clickhouse.query({
    query: `
      SELECT
        count() as redemption_events,
        sum(toFloat64OrZero(amount_or_payout)) / 1000000.0 as redemption_usdc
      FROM pm_ctf_events
      WHERE lower(user_address) = '${lowerWallet}'
        AND event_type = 'PayoutRedemption'
        AND is_deleted = 0
    `,
    format: 'JSONEachRow',
  });
  const ctfData = (await ctfRedemptions.json()) as any[];
  const ctfStats = ctfData[0] || {};

  // 6. FPMM Events
  const fpmmStats = await clickhouse.query({
    query: `
      SELECT
        count() as fpmm_events,
        sum(usdc_amount) as fpmm_volume
      FROM pm_fpmm_trades t
      INNER JOIN pm_fpmm_pool_map p ON lower(t.fpmm_pool_address) = lower(p.fpmm_pool_address)
      WHERE lower(t.trader_wallet) = '${lowerWallet}'
        AND t.is_deleted = 0
        AND p.condition_id IS NOT NULL
        AND p.condition_id != ''
    `,
    format: 'JSONEachRow',
  });
  const fpmmData = (await fpmmStats.json()) as any[];
  const fpmm = fpmmData[0] || {};

  const mapped = Number(mappingStats.mapped || 0);
  const unmapped = Number(mappingStats.unmapped || 0);
  const totalTokens = mapped + unmapped;

  const resolved = Number(resolutionStats.resolved || 0);
  const unresolved = Number(resolutionStats.unresolved || 0);
  const totalConditions = resolved + unresolved;

  return {
    clob_events_raw,
    clob_events_deduped: Number(clobStats.cnt || 0),
    clob_unique_tokens: Number(clobStats.unique_tokens || 0),
    clob_volume_usdc: Number(clobStats.volume_usdc || 0),
    clob_buy_count: Number(clobStats.buy_count || 0),
    clob_sell_count: Number(clobStats.sell_count || 0),
    mapped_tokens: mapped,
    unmapped_tokens: unmapped,
    mapping_coverage_pct: totalTokens > 0 ? (mapped / totalTokens) * 100 : 0,
    unique_conditions: totalConditions,
    resolved_conditions: resolved,
    unresolved_conditions: unresolved,
    resolution_coverage_pct: totalConditions > 0 ? (resolved / totalConditions) * 100 : 0,
    ctf_redemption_events: Number(ctfStats.redemption_events || 0),
    ctf_redemption_usdc: Number(ctfStats.redemption_usdc || 0),
    fpmm_events: Number(fpmm.fpmm_events || 0),
    fpmm_volume_usdc: Number(fpmm.fpmm_volume || 0),
  };
}

async function runFullAudit() {
  console.log('=== DATA COVERAGE AUDIT - Phase 2 ===\n');
  console.log('Analyzing data completeness for W1-W6 benchmark wallets...\n');

  const results: DataCoverageMetrics[] = [];

  for (const benchmark of UI_BENCHMARK_WALLETS) {
    console.log(`\n--- ${benchmark.label}: ${benchmark.wallet.substring(0, 14)}... ---`);

    // Get data coverage metrics
    const coverage = await auditWalletDataCoverage(benchmark.wallet);

    // Get V3 PnL
    let v3_pnl = 0;
    try {
      const v3Result = await computeWalletActivityPnlV3Debug(benchmark.wallet);
      v3_pnl = v3Result.pnl_activity_total;
    } catch (e) {
      console.log('  V3 engine error:', (e as Error).message);
    }

    const ui_pnl = benchmark.profitLoss_all;
    const error_pct = ui_pnl !== 0 ? Math.abs((v3_pnl - ui_pnl) / Math.abs(ui_pnl)) * 100 : v3_pnl === 0 ? 0 : Infinity;
    const sign_match = (v3_pnl >= 0 && ui_pnl >= 0) || (v3_pnl < 0 && ui_pnl < 0);

    const fullMetrics: DataCoverageMetrics = {
      wallet: benchmark.wallet,
      label: benchmark.label,
      ...coverage,
      v3_pnl,
      ui_pnl,
      error_pct,
      sign_match,
    } as DataCoverageMetrics;

    results.push(fullMetrics);

    // Print summary
    console.log(`  CLOB: ${coverage.clob_events_deduped} events (${coverage.clob_events_raw} raw) | $${(coverage.clob_volume_usdc || 0).toLocaleString()} vol`);
    console.log(`  Token Mapping: ${coverage.mapped_tokens}/${(coverage.mapped_tokens || 0) + (coverage.unmapped_tokens || 0)} (${(coverage.mapping_coverage_pct || 0).toFixed(1)}%)`);
    console.log(`  Resolutions: ${coverage.resolved_conditions}/${coverage.unique_conditions} (${(coverage.resolution_coverage_pct || 0).toFixed(1)}%)`);
    console.log(`  CTF Redemptions: ${coverage.ctf_redemption_events} events`);
    console.log(`  FPMM: ${coverage.fpmm_events} events | $${(coverage.fpmm_volume_usdc || 0).toLocaleString()} vol`);
    console.log(`  V3 PnL: $${v3_pnl.toFixed(2)} | UI PnL: $${ui_pnl.toFixed(2)} | Error: ${error_pct.toFixed(1)}% | Sign: ${sign_match ? '✓' : '✗'}`);
  }

  // Summary table
  console.log('\n\n=== SUMMARY TABLE ===\n');
  console.log('| Wallet | CLOB Events | Mapping | Resolution | Redemptions | FPMM | V3 PnL | UI PnL | Error | Sign |');
  console.log('|--------|-------------|---------|------------|-------------|------|--------|--------|-------|------|');

  for (const r of results) {
    const mapPct = r.mapping_coverage_pct?.toFixed(0) || '0';
    const resPct = r.resolution_coverage_pct?.toFixed(0) || '0';
    const v3Fmt = r.v3_pnl >= 0 ? '+$' + r.v3_pnl.toFixed(0) : '-$' + Math.abs(r.v3_pnl).toFixed(0);
    const uiFmt = r.ui_pnl >= 0 ? '+$' + r.ui_pnl.toFixed(0) : '-$' + Math.abs(r.ui_pnl).toFixed(0);
    const errFmt = r.error_pct < 1000 ? r.error_pct.toFixed(0) + '%' : '>1000%';
    const signFmt = r.sign_match ? '✓' : '✗';

    console.log(
      `| ${r.label.padEnd(6)} | ${String(r.clob_events_deduped).padStart(11)} | ${(mapPct + '%').padStart(7)} | ${(resPct + '%').padStart(10)} | ${String(r.ctf_redemption_events).padStart(11)} | ${String(r.fpmm_events).padStart(4)} | ${v3Fmt.padStart(6)} | ${uiFmt.padStart(6)} | ${errFmt.padStart(5)} | ${signFmt.padStart(4)} |`
    );
  }

  // Identify issues
  console.log('\n\n=== IDENTIFIED ISSUES ===\n');

  const mappingIssues = results.filter((r) => (r.mapping_coverage_pct || 0) < 100);
  if (mappingIssues.length > 0) {
    console.log('⚠️  TOKEN MAPPING GAPS:');
    for (const r of mappingIssues) {
      console.log(`   ${r.label}: ${r.unmapped_tokens} unmapped tokens (${(100 - (r.mapping_coverage_pct || 0)).toFixed(1)}% missing)`);
    }
  } else {
    console.log('✓ Token mapping: 100% coverage for all wallets');
  }

  console.log('');

  const resolutionIssues = results.filter((r) => (r.resolution_coverage_pct || 0) < 100);
  if (resolutionIssues.length > 0) {
    console.log('⚠️  RESOLUTION GAPS:');
    for (const r of resolutionIssues) {
      console.log(`   ${r.label}: ${r.unresolved_conditions} unresolved conditions (${(100 - (r.resolution_coverage_pct || 0)).toFixed(1)}% missing)`);
    }
  } else {
    console.log('✓ Resolutions: 100% coverage for all wallets');
  }

  console.log('');

  const signMismatches = results.filter((r) => !r.sign_match);
  if (signMismatches.length > 0) {
    console.log('⚠️  SIGN MISMATCHES (wrong direction):');
    for (const r of signMismatches) {
      console.log(`   ${r.label}: V3=${r.v3_pnl >= 0 ? '+' : ''}$${r.v3_pnl.toFixed(0)} vs UI=${r.ui_pnl >= 0 ? '+' : ''}$${r.ui_pnl.toFixed(0)}`);
    }
  } else {
    console.log('✓ Sign match: All wallets have correct PnL direction');
  }

  console.log('');

  const highError = results.filter((r) => r.error_pct > 50 && r.sign_match);
  if (highError.length > 0) {
    console.log('⚠️  HIGH ERROR (>50% but sign matches):');
    for (const r of highError) {
      console.log(`   ${r.label}: ${r.error_pct.toFixed(0)}% error - may have data gaps or algorithm issues`);
    }
  }

  // Deep dive on unmapped tokens for wallets with mapping issues
  if (mappingIssues.length > 0) {
    console.log('\n\n=== UNMAPPED TOKEN DETAILS ===\n');
    for (const r of mappingIssues) {
      if ((r.unmapped_tokens || 0) > 0) {
        console.log(`${r.label} - Unmapped tokens:`);
        const unmappedDetails = await clickhouse.query({
          query: `
            SELECT
              t.token_id,
              count() as trade_count,
              sum(usdc) as volume
            FROM (
              SELECT
                event_id,
                any(token_id) as token_id,
                any(usdc_amount) / 1000000.0 as usdc
              FROM pm_trader_events_v2
              WHERE lower(trader_wallet) = lower('${r.wallet}') AND is_deleted = 0
              GROUP BY event_id
            ) t
            LEFT JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
            WHERE m.condition_id IS NULL OR m.condition_id = ''
            GROUP BY t.token_id
            ORDER BY volume DESC
            LIMIT 5
          `,
          format: 'JSONEachRow',
        });
        const unmapped = (await unmappedDetails.json()) as any[];
        for (const u of unmapped) {
          console.log(`   token_id: ${u.token_id} | trades: ${u.trade_count} | vol: $${Number(u.volume).toFixed(2)}`);
        }
      }
    }
  }

  // Deep dive on unresolved conditions
  if (resolutionIssues.length > 0) {
    console.log('\n\n=== UNRESOLVED CONDITION DETAILS ===\n');
    for (const r of resolutionIssues) {
      if ((r.unresolved_conditions || 0) > 0) {
        console.log(`${r.label} - Unresolved conditions:`);
        const unresolvedDetails = await clickhouse.query({
          query: `
            SELECT
              c.condition_id,
              count() as trade_count,
              sum(vol) as volume
            FROM (
              SELECT
                m.condition_id,
                usdc as vol
              FROM (
                SELECT
                  event_id,
                  any(token_id) as token_id,
                  any(usdc_amount) / 1000000.0 as usdc
                FROM pm_trader_events_v2
                WHERE lower(trader_wallet) = lower('${r.wallet}') AND is_deleted = 0
                GROUP BY event_id
              ) fills
              INNER JOIN pm_token_to_condition_map_v3 m ON fills.token_id = m.token_id_dec
              WHERE m.condition_id IS NOT NULL AND m.condition_id != ''
            ) c
            LEFT JOIN pm_condition_resolutions res ON lower(c.condition_id) = lower(res.condition_id)
            WHERE res.condition_id IS NULL
            GROUP BY c.condition_id
            ORDER BY volume DESC
            LIMIT 5
          `,
          format: 'JSONEachRow',
        });
        const unresolved = (await unresolvedDetails.json()) as any[];
        for (const u of unresolved) {
          console.log(`   condition_id: ${u.condition_id.substring(0, 20)}... | trades: ${u.trade_count} | vol: $${Number(u.volume).toFixed(2)}`);
        }
      }
    }
  }

  console.log('\n\n--- Audit Complete ---');
  console.log('Report by: Claude 1');
}

runFullAudit().catch(console.error);
