/**
 * Classify Dome-like realized PnL failures into taxonomy:
 * - DATA_ABSENT: No CLOB/redemption data in our system
 * - MULTI_OUTCOME: Wallet trades both sides of same condition
 * - LOW_RESOLUTION_COVERAGE: Many conditions but few resolved
 * - CTF_OPS_REQUIRED: Split/merge activity present
 * - ALGORITHM_ELIGIBLE: Clean case for algorithm testing
 */
import fs from 'fs';
import { clickhouse } from '../../lib/clickhouse/client';

interface WalletStats {
  wallet: string;
  clob_trade_count: number;
  unique_conditions_clob: number;
  redemption_count: number;
  ctf_split_merge_count: number;
  multi_outcome_condition_count: number;
  total_conditions: number;
  resolved_conditions: number;
  resolution_coverage: number;
  failure_class: string;
}

async function getWalletStats(wallet: string): Promise<WalletStats> {
  wallet = wallet.toLowerCase();

  // Get CLOB trade count and unique conditions
  const clobQuery = `
    SELECT
      count(*) as clob_count,
      countDistinct(condition_id) as unique_conds
    FROM pm_unified_ledger_v8_tbl
    WHERE lower(wallet_address) = '${wallet}'
      AND condition_id != ''
      AND source_type = 'CLOB'
  `;

  // Get redemption count
  const redemptionQuery = `
    SELECT count(*) as redemption_count
    FROM pm_unified_ledger_v8_tbl
    WHERE lower(wallet_address) = '${wallet}'
      AND condition_id != ''
      AND source_type = 'PayoutRedemption'
  `;

  // Get CTF split/merge count (if table exists)
  const ctfQuery = `
    SELECT count(*) as ctf_count
    FROM pm_ctf_events
    WHERE lower(user_address) = '${wallet}'
      AND event_type IN ('PositionSplit', 'PositionsMerge')
  `;

  // Get multi-outcome condition count (conditions where user has net positive on BOTH outcomes)
  const multiOutcomeQuery = `
    WITH outcome_positions AS (
      SELECT
        condition_id,
        outcome_index,
        sum(token_delta) as net_shares
      FROM pm_unified_ledger_v8_tbl
      WHERE lower(wallet_address) = '${wallet}'
        AND condition_id != ''
        AND source_type = 'CLOB'
      GROUP BY condition_id, outcome_index
      HAVING net_shares > 0.01
    )
    SELECT count(*) as multi_count
    FROM (
      SELECT condition_id
      FROM outcome_positions
      GROUP BY condition_id
      HAVING count(DISTINCT outcome_index) > 1
    )
  `;

  // Get resolution coverage
  const resolutionQuery = `
    WITH
      wallet_conds AS (
        SELECT DISTINCT condition_id
        FROM pm_unified_ledger_v8_tbl
        WHERE lower(wallet_address) = '${wallet}'
          AND condition_id != ''
      ),
      resolved_conds AS (
        SELECT DISTINCT w.condition_id
        FROM wallet_conds w
        INNER JOIN pm_condition_resolutions r ON w.condition_id = r.condition_id
        WHERE r.is_deleted = 0
      )
    SELECT
      (SELECT count(*) FROM wallet_conds) as total_conds,
      (SELECT count(*) FROM resolved_conds) as resolved_conds
  `;

  // Run all queries in parallel
  const [clobResult, redemptionResult, ctfResult, multiResult, resResult] = await Promise.all([
    clickhouse.query({ query: clobQuery, format: 'JSONEachRow' }).then(r => r.json()),
    clickhouse.query({ query: redemptionQuery, format: 'JSONEachRow' }).then(r => r.json()),
    clickhouse.query({ query: ctfQuery, format: 'JSONEachRow' }).then(r => r.json()).catch(() => [{ ctf_count: 0 }]),
    clickhouse.query({ query: multiOutcomeQuery, format: 'JSONEachRow' }).then(r => r.json()),
    clickhouse.query({ query: resolutionQuery, format: 'JSONEachRow' }).then(r => r.json()),
  ]);

  const clobRow = (clobResult as any[])[0] || { clob_count: 0, unique_conds: 0 };
  const redemptionRow = (redemptionResult as any[])[0] || { redemption_count: 0 };
  const ctfRow = (ctfResult as any[])[0] || { ctf_count: 0 };
  const multiRow = (multiResult as any[])[0] || { multi_count: 0 };
  const resRow = (resResult as any[])[0] || { total_conds: 0, resolved_conds: 0 };

  const stats: WalletStats = {
    wallet,
    clob_trade_count: Number(clobRow.clob_count || 0),
    unique_conditions_clob: Number(clobRow.unique_conds || 0),
    redemption_count: Number(redemptionRow.redemption_count || 0),
    ctf_split_merge_count: Number(ctfRow.ctf_count || 0),
    multi_outcome_condition_count: Number(multiRow.multi_count || 0),
    total_conditions: Number(resRow.total_conds || 0),
    resolved_conditions: Number(resRow.resolved_conds || 0),
    resolution_coverage: 0,
    failure_class: 'UNCLASSIFIED',
  };

  // Calculate resolution coverage
  stats.resolution_coverage = stats.total_conditions > 0
    ? stats.resolved_conditions / stats.total_conditions
    : 0;

  // Classify
  if (stats.clob_trade_count === 0 && stats.redemption_count === 0) {
    stats.failure_class = 'DATA_ABSENT';
  } else if (stats.resolution_coverage < 0.5 && stats.total_conditions > 10) {
    stats.failure_class = 'LOW_RESOLUTION_COVERAGE';
  } else if (stats.multi_outcome_condition_count > 0) {
    stats.failure_class = 'MULTI_OUTCOME';
  } else if (stats.ctf_split_merge_count > 10) {
    stats.failure_class = 'CTF_OPS_REQUIRED';
  } else {
    stats.failure_class = 'ALGORITHM_ELIGIBLE';
  }

  return stats;
}

async function main() {
  // Load validation results
  const validationFile = process.argv[2] || 'tmp/dome_realized_omega_top50_2025_12_07_validation.json';

  if (!fs.existsSync(validationFile)) {
    console.error(`File not found: ${validationFile}`);
    process.exit(1);
  }

  const validation = JSON.parse(fs.readFileSync(validationFile, 'utf8'));
  const results = validation.results || [];

  console.log(`\nClassifying ${results.length} wallets...`);
  console.log(`Source: ${validationFile}\n`);

  const classified: any[] = [];

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const wallet = r.wallet.toLowerCase();

    try {
      const stats = await getWalletStats(wallet);

      classified.push({
        ...r,
        ...stats,
      });

      if ((i + 1) % 10 === 0) {
        console.log(`  [${i + 1}/${results.length}] processed`);
      }
    } catch (err: any) {
      console.error(`  Error on ${wallet}: ${err.message}`);
      classified.push({
        ...r,
        failure_class: 'ERROR',
        error: err.message,
      });
    }
  }

  // Summary by class
  const byClass: Record<string, any[]> = {};
  for (const c of classified) {
    const cls = c.failure_class || 'UNKNOWN';
    if (!byClass[cls]) byClass[cls] = [];
    byClass[cls].push(c);
  }

  // Calculate pass rates by class
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`FAILURE CLASSIFICATION SUMMARY`);
  console.log(`${'═'.repeat(70)}\n`);

  const passing = classified.filter(c => c.status === 'PASS');
  const failing = classified.filter(c => c.status === 'FAIL');

  console.log(`Overall: ${passing.length}/${classified.length} pass (${(passing.length / classified.length * 100).toFixed(1)}%)\n`);

  console.log(`Failures by Class:`);
  console.log(`${'─'.repeat(70)}`);

  for (const [cls, items] of Object.entries(byClass)) {
    const passInClass = items.filter(i => i.status === 'PASS').length;
    const failInClass = items.filter(i => i.status === 'FAIL').length;
    console.log(`  ${cls.padEnd(25)} Total: ${items.length.toString().padStart(3)}  Pass: ${passInClass.toString().padStart(3)}  Fail: ${failInClass.toString().padStart(3)}`);
  }

  // Algorithm-eligible pass rate
  const eligible = byClass['ALGORITHM_ELIGIBLE'] || [];
  const eligiblePass = eligible.filter(e => e.status === 'PASS').length;

  console.log(`\n${'─'.repeat(70)}`);
  console.log(`ALGORITHM-ELIGIBLE PASS RATE: ${eligiblePass}/${eligible.length} (${eligible.length > 0 ? (eligiblePass / eligible.length * 100).toFixed(1) : 0}%)`);
  console.log(`${'─'.repeat(70)}`);

  // Show failing wallets by class
  console.log(`\nFailing Wallets by Class:`);
  for (const [cls, items] of Object.entries(byClass)) {
    const fails = items.filter(i => i.status === 'FAIL');
    if (fails.length === 0) continue;

    console.log(`\n  ${cls}:`);
    for (const f of fails.slice(0, 5)) {
      console.log(`    ${f.wallet.slice(0, 10)}... err=${f.error_pct?.toFixed(1) || 'N/A'}% dome=$${f.dome_realized?.toLocaleString()} ours=$${f.our_realized?.toLocaleString()}`);
      console.log(`      clob=${f.clob_trade_count} redemp=${f.redemption_count} multi=${f.multi_outcome_condition_count} res_cov=${(f.resolution_coverage * 100).toFixed(0)}%`);
    }
    if (fails.length > 5) {
      console.log(`    ... and ${fails.length - 5} more`);
    }
  }

  // Save enriched results
  const outFile = validationFile.replace('.json', '_classified.json');
  fs.writeFileSync(outFile, JSON.stringify({
    generated_at: new Date().toISOString(),
    source: validationFile,
    summary: {
      total: classified.length,
      pass: passing.length,
      fail: failing.length,
      pass_rate: `${(passing.length / classified.length * 100).toFixed(1)}%`,
      algorithm_eligible: eligible.length,
      algorithm_eligible_pass: eligiblePass,
      algorithm_eligible_pass_rate: eligible.length > 0 ? `${(eligiblePass / eligible.length * 100).toFixed(1)}%` : 'N/A',
      by_class: Object.fromEntries(
        Object.entries(byClass).map(([cls, items]) => [
          cls,
          {
            total: items.length,
            pass: items.filter(i => i.status === 'PASS').length,
            fail: items.filter(i => i.status === 'FAIL').length,
          }
        ])
      ),
    },
    results: classified,
  }, null, 2));

  console.log(`\nWrote: ${outFile}`);
}

main().catch(console.error);
