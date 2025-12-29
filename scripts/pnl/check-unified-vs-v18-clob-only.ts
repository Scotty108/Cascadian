/**
 * Check Unified Ledger V6 vs V18 for CLOB-only wallets
 *
 * This regression test ensures that the fixed pm_unified_ledger_v6
 * matches V18 exactly for cash and token flows.
 *
 * For each CLOB-only wallet and condition:
 * 1. From pm_trader_events_v2 (role='maker'): compute usdc_cash and tokens
 * 2. From pm_unified_ledger_v6 (source_type='CLOB'): compute usdc_delta_sum and token_delta_sum
 * 3. Assert they match to cents and ~1e-6 for tokens
 */

import { clickhouse } from '../../lib/clickhouse/client';
import * as fs from 'fs';

const REPORT_FILE = 'data/v18-benchmark-report.json';
const CLASSIFICATION_FILE = 'data/wallet-classification-report.json';

interface BenchmarkResult {
  wallet: string;
  ui: { pnl: number; username: string };
  v18: { total_pnl: number };
  total_pnl_error_pct: number;
}

async function compareWalletFlows(wallet: string) {
  // Get V18 source data (pm_trader_events_v2 with role='maker')
  const v18Query = `
    WITH deduped AS (
      SELECT
        event_id,
        m.condition_id,
        m.outcome_index,
        any(side) AS side,
        any(usdc_amount) / 1e6 AS usdc,
        any(token_amount) / 1e6 AS tokens
      FROM pm_trader_events_v2 AS t
      LEFT JOIN pm_token_to_condition_map_v3 AS m ON t.token_id = m.token_id_dec
      WHERE lower(t.trader_wallet) = lower('${wallet}')
        AND t.is_deleted = 0
        AND t.role = 'maker'
      GROUP BY event_id, m.condition_id, m.outcome_index
    )
    SELECT
      condition_id,
      outcome_index,
      sum(if(side = 'buy', -usdc, usdc)) AS usdc_cash,
      sum(if(side = 'buy', tokens, -tokens)) AS token_flow
    FROM deduped
    WHERE condition_id IS NOT NULL
    GROUP BY condition_id, outcome_index
    ORDER BY condition_id, outcome_index
  `;

  // Get V6 unified ledger data
  const v6Query = `
    SELECT
      condition_id,
      outcome_index,
      sum(usdc_delta) AS usdc_delta_sum,
      sum(token_delta) AS token_delta_sum
    FROM pm_unified_ledger_v6
    WHERE lower(wallet_address) = lower('${wallet}')
      AND source_type = 'CLOB'
      AND condition_id IS NOT NULL
    GROUP BY condition_id, outcome_index
    ORDER BY condition_id, outcome_index
  `;

  const [v18Res, v6Res] = await Promise.all([
    clickhouse.query({ query: v18Query, format: 'JSONEachRow' }),
    clickhouse.query({ query: v6Query, format: 'JSONEachRow' }),
  ]);

  const v18Rows = (await v18Res.json()) as any[];
  const v6Rows = (await v6Res.json()) as any[];

  // Build maps keyed by condition_id + outcome_index
  const v18Map = new Map<string, { usdc: number; tokens: number }>();
  for (const r of v18Rows) {
    const key = `${r.condition_id}:${r.outcome_index}`;
    v18Map.set(key, {
      usdc: Number(r.usdc_cash),
      tokens: Number(r.token_flow),
    });
  }

  const v6Map = new Map<string, { usdc: number; tokens: number }>();
  for (const r of v6Rows) {
    const key = `${r.condition_id}:${r.outcome_index}`;
    v6Map.set(key, {
      usdc: Number(r.usdc_delta_sum),
      tokens: Number(r.token_delta_sum),
    });
  }

  // Compare
  const mismatches: {
    position: string;
    v18Usdc: number;
    v6Usdc: number;
    v18Tokens: number;
    v6Tokens: number;
    usdcDiff: number;
    tokenDiff: number;
  }[] = [];

  const allKeys = new Set([...v18Map.keys(), ...v6Map.keys()]);
  let matchCount = 0;
  let totalPositions = allKeys.size;

  for (const key of allKeys) {
    const v18 = v18Map.get(key) || { usdc: 0, tokens: 0 };
    const v6 = v6Map.get(key) || { usdc: 0, tokens: 0 };

    const usdcDiff = Math.abs(v18.usdc - v6.usdc);
    const tokenDiff = Math.abs(v18.tokens - v6.tokens);

    // Allow tolerance: $0.01 for USDC, 0.000001 for tokens
    if (usdcDiff > 0.01 || tokenDiff > 0.000001) {
      mismatches.push({
        position: key,
        v18Usdc: v18.usdc,
        v6Usdc: v6.usdc,
        v18Tokens: v18.tokens,
        v6Tokens: v6.tokens,
        usdcDiff,
        tokenDiff,
      });
    } else {
      matchCount++;
    }
  }

  return {
    totalPositions,
    matchCount,
    mismatches,
    v18PositionCount: v18Map.size,
    v6PositionCount: v6Map.size,
  };
}

async function main() {
  console.log('='.repeat(100));
  console.log('UNIFIED LEDGER V6 vs V18 REGRESSION TEST');
  console.log('='.repeat(100));
  console.log('');
  console.log('Verifying that pm_unified_ledger_v6 CLOB flows match V18 exactly');
  console.log('for CLOB-only wallets (cash and token flows per position).');
  console.log('');

  // Load benchmark data
  if (!fs.existsSync(REPORT_FILE)) {
    console.log('No benchmark report found at ' + REPORT_FILE);
    return;
  }

  const report = JSON.parse(fs.readFileSync(REPORT_FILE, 'utf-8'));
  const benchmarks: Map<string, BenchmarkResult> = new Map();
  for (const r of report.results) {
    benchmarks.set(r.wallet.toLowerCase(), r);
  }

  // Load classification (if available)
  let clobOnlyWallets = new Set<string>();
  if (fs.existsSync(CLASSIFICATION_FILE)) {
    const classification = JSON.parse(fs.readFileSync(CLASSIFICATION_FILE, 'utf-8'));
    for (const w of classification.classifications || []) {
      if (w.class === 'clob_only') {
        clobOnlyWallets.add(w.wallet.toLowerCase());
      }
    }
    console.log(`Found ${clobOnlyWallets.size} CLOB-only wallets from classification.`);
  } else {
    console.log('No classification file found - testing all benchmark wallets.');
    clobOnlyWallets = new Set(benchmarks.keys());
  }

  console.log('');
  console.log('-'.repeat(100));
  console.log('RESULTS');
  console.log('-'.repeat(100));
  console.log('');

  let totalWallets = 0;
  let passedWallets = 0;
  let totalMismatches = 0;

  for (const wallet of clobOnlyWallets) {
    const benchmark = benchmarks.get(wallet);
    if (!benchmark) continue;

    totalWallets++;
    const username = benchmark.ui?.username || 'Unknown';

    const result = await compareWalletFlows(wallet);

    if (result.mismatches.length === 0) {
      passedWallets++;
      console.log(
        `✅ ${username.substring(0, 20).padEnd(20)}: ${result.matchCount}/${result.totalPositions} positions match`
      );
    } else {
      totalMismatches += result.mismatches.length;
      console.log(
        `❌ ${username.substring(0, 20).padEnd(20)}: ${result.mismatches.length} mismatches`
      );

      // Show first few mismatches
      for (const m of result.mismatches.slice(0, 3)) {
        console.log(
          `   ${m.position.substring(0, 40)}: ` +
            `V18=$${m.v18Usdc.toFixed(2)}/${m.v18Tokens.toFixed(4)}t ` +
            `V6=$${m.v6Usdc.toFixed(2)}/${m.v6Tokens.toFixed(4)}t ` +
            `Δ=$${m.usdcDiff.toFixed(2)}/${m.tokenDiff.toFixed(6)}t`
        );
      }
      if (result.mismatches.length > 3) {
        console.log(`   ... and ${result.mismatches.length - 3} more mismatches`);
      }
    }
  }

  console.log('');
  console.log('='.repeat(100));
  console.log('SUMMARY');
  console.log('='.repeat(100));
  console.log(`Total CLOB-only wallets tested: ${totalWallets}`);
  console.log(`Wallets passed (all positions match): ${passedWallets}`);
  console.log(`Wallets with mismatches: ${totalWallets - passedWallets}`);
  console.log(`Total position mismatches: ${totalMismatches}`);
  console.log('');

  if (passedWallets === totalWallets) {
    console.log('🎉 ALL CLOB-ONLY WALLETS PASS - V6 CLOB matches V18 exactly!');
  } else {
    console.log('⚠️ Some wallets have mismatches - investigate before proceeding.');
  }
}

main().catch(console.error);
