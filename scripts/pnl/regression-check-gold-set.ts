#!/usr/bin/env npx tsx
/**
 * CI-STYLE REGRESSION CHECK FOR GOLD SET
 * ============================================================================
 *
 * Recomputes V12 Synthetic Realized PnL for the 100 pinned gold-set wallets
 * and asserts 1-5% tolerance vs stored expected values.
 *
 * Use this as a ship-safety valve before deploying engine changes.
 *
 * Exit codes:
 *   0 = All wallets pass tolerance
 *   1 = Some wallets fail tolerance (prints failures)
 *   2 = Gold set file not found or invalid
 *
 * USAGE:
 *   npx tsx scripts/pnl/regression-check-gold-set.ts [--tolerance=5]
 *
 * Terminal: Terminal 2 (Scaling & Hardening)
 * Date: 2025-12-09
 */

import { createClient } from '@clickhouse/client';
import * as fs from 'fs';

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  request_timeout: 300000,
});

// ============================================================================
// Configuration
// ============================================================================

interface Config {
  goldSetFile: string;
  tolerancePct: number;
}

function parseArgs(): Config {
  const args = process.argv.slice(2);
  let tolerancePct = 5; // Default 5% tolerance
  let goldSetFile = 'tmp/gold_pinned_tierA_regression_v2_2025_12_09.json'; // v2 has canonical formula values

  for (const arg of args) {
    if (arg.startsWith('--tolerance=')) {
      tolerancePct = parseFloat(arg.split('=')[1]) || 5;
    } else if (arg.startsWith('--gold-set=')) {
      goldSetFile = arg.split('=')[1];
    }
  }

  return { goldSetFile, tolerancePct };
}

// ============================================================================
// V12 Synthetic Realized Calculator
// ============================================================================

async function computeV12Realized(wallet: string): Promise<{ pnl: number; events: number; unresolved: number }> {
  const query = `
    SELECT
      sum(d.usdc_delta) as total_usdc,
      sum(d.token_delta) as total_tokens,
      sumIf(
        d.usdc_delta + d.token_delta * arrayElement(res.norm_prices, toInt32(m.outcome_index + 1)),
        res.raw_numerators IS NOT NULL
        AND res.raw_numerators != ''
        AND length(res.norm_prices) > 0
        AND m.outcome_index IS NOT NULL
      ) as realized_pnl,
      countIf(res.raw_numerators IS NULL OR res.raw_numerators = '' OR length(res.norm_prices) = 0) as unresolved_events,
      count(*) as total_events
    FROM (
      SELECT
        event_id,
        argMax(token_id, trade_time) as tok_id,
        argMax(if(side = 'buy', -usdc_amount, usdc_amount), trade_time) / 1000000.0 as usdc_delta,
        argMax(if(side = 'buy', token_amount, -token_amount), trade_time) / 1000000.0 as token_delta
      FROM pm_trader_events_v2
      WHERE trader_wallet = {wallet:String} AND is_deleted = 0
      GROUP BY event_id
    ) d
    LEFT JOIN pm_token_to_condition_map_v5 m ON d.tok_id = m.token_id_dec
    LEFT JOIN pm_condition_resolutions_norm res ON m.condition_id = res.condition_id
  `;

  const result = await ch.query({
    query,
    query_params: { wallet },
    format: 'JSONEachRow'
  });
  const data = (await result.json<any[]>())[0];

  return {
    pnl: Number(data.realized_pnl) || 0,
    events: Number(data.total_events) || 0,
    unresolved: Number(data.unresolved_events) || 0
  };
}

// ============================================================================
// Main
// ============================================================================

interface GoldWallet {
  wallet_address: string;
  v12_realized_pnl: number;
  event_count: number;
  unresolved_pct: number;
}

interface GoldSet {
  metadata: any;
  stats: any;
  wallets: GoldWallet[];
}

async function main() {
  const config = parseArgs();

  console.log('═'.repeat(80));
  console.log('CI REGRESSION CHECK: V12 SYNTHETIC REALIZED');
  console.log('═'.repeat(80));
  console.log('');
  console.log(`Gold set: ${config.goldSetFile}`);
  console.log(`Tolerance: ${config.tolerancePct}%`);
  console.log('');

  // Load gold set
  if (!fs.existsSync(config.goldSetFile)) {
    console.error(`ERROR: Gold set file not found: ${config.goldSetFile}`);
    process.exit(2);
  }

  const goldSet: GoldSet = JSON.parse(fs.readFileSync(config.goldSetFile, 'utf-8'));

  if (!goldSet.wallets || !Array.isArray(goldSet.wallets)) {
    console.error('ERROR: Invalid gold set format');
    process.exit(2);
  }

  console.log(`Loaded ${goldSet.wallets.length} wallets from gold set`);
  console.log(`Gold set created: ${goldSet.metadata?.generated_at || 'unknown'}`);
  console.log('');

  // Test each wallet
  const results: {
    wallet: string;
    expected: number;
    actual: number;
    error_pct: number;
    pass: boolean;
  }[] = [];

  console.log('Running regression checks...');
  console.log('-'.repeat(80));

  for (let i = 0; i < goldSet.wallets.length; i++) {
    const w = goldSet.wallets[i];
    const expected = w.v12_realized_pnl;

    try {
      const computed = await computeV12Realized(w.wallet_address);
      const actual = computed.pnl;

      // Calculate error %
      let errorPct: number;
      if (expected === 0 && actual === 0) {
        errorPct = 0;
      } else if (expected === 0) {
        errorPct = Math.abs(actual) > 100 ? 100 : Math.abs(actual);
      } else {
        errorPct = Math.abs((actual - expected) / expected) * 100;
      }

      const pass = errorPct <= config.tolerancePct;

      results.push({
        wallet: w.wallet_address,
        expected,
        actual,
        error_pct: errorPct,
        pass
      });

      // Progress
      if ((i + 1) % 10 === 0 || !pass) {
        const status = pass ? '✓' : '✗';
        console.log(
          `[${(i + 1).toString().padStart(3)}/${goldSet.wallets.length}] ${status} ` +
          `${w.wallet_address.slice(0, 20)}... ` +
          `Expected: $${expected.toFixed(2)}, Actual: $${actual.toFixed(2)}, ` +
          `Error: ${errorPct.toFixed(2)}%`
        );
      }
    } catch (err: any) {
      console.log(`[${(i + 1).toString().padStart(3)}/${goldSet.wallets.length}] ERROR: ${w.wallet_address.slice(0, 20)}... - ${err.message}`);
      results.push({
        wallet: w.wallet_address,
        expected,
        actual: 0,
        error_pct: 100,
        pass: false
      });
    }
  }

  console.log('-'.repeat(80));
  console.log('');

  // Summary
  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;
  const passRate = (passed / results.length) * 100;

  console.log('═'.repeat(80));
  console.log('REGRESSION CHECK SUMMARY');
  console.log('═'.repeat(80));
  console.log(`Total wallets: ${results.length}`);
  console.log(`Passed: ${passed} (${passRate.toFixed(1)}%)`);
  console.log(`Failed: ${failed}`);
  console.log(`Tolerance: ${config.tolerancePct}%`);
  console.log('');

  if (failed > 0) {
    console.log('FAILURES:');
    console.log('-'.repeat(80));
    console.log('Wallet                          | Expected       | Actual         | Error%');
    console.log('-'.repeat(80));

    for (const r of results.filter(r => !r.pass)) {
      console.log(
        `${r.wallet.slice(0, 30).padEnd(31)} | ` +
        `$${r.expected.toFixed(2).padStart(13)} | ` +
        `$${r.actual.toFixed(2).padStart(13)} | ` +
        `${r.error_pct.toFixed(2)}%`
      );
    }
    console.log('');
  }

  // Save results
  const outputFile = `tmp/regression_check_${new Date().toISOString().split('T')[0].replace(/-/g, '_')}.json`;
  const output = {
    metadata: {
      run_at: new Date().toISOString(),
      gold_set: config.goldSetFile,
      tolerance_pct: config.tolerancePct,
      pass_rate: passRate,
      passed,
      failed
    },
    results
  };
  fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));
  console.log(`Results saved to: ${outputFile}`);

  await ch.close();

  // Exit code
  if (failed > 0) {
    console.log('\n❌ REGRESSION CHECK FAILED');
    process.exit(1);
  } else {
    console.log('\n✅ REGRESSION CHECK PASSED');
    process.exit(0);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(2);
});
