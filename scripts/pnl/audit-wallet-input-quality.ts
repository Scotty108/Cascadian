/**
 * Audit Wallet Input Quality (BATCHED VERSION)
 *
 * Runs 5 total ClickHouse queries instead of 150+ per-wallet queries.
 * Produces two CSV files:
 *   - /tmp/wallet_quality_audit.csv (all wallets)
 *   - /tmp/wallet_quality_exportable_realized.csv (only passing wallets)
 *
 * Gates for is_exportable_realized:
 *   1. raw_fresh_lag_hours <= 24
 *   2. dedup_lag_vs_raw_hours <= 6
 *   3. token_map_null_frac <= 0.01
 *   4. count_open_positions == 0 (for realized validation only)
 *   5. count_resolved_positions >= 3
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { getClickHouseClient } from '../../lib/clickhouse/client';
import * as fs from 'fs';

interface WalletQualityAudit {
  wallet: string;
  ui_pnl: number | null;
  raw_max_ts: string | null;
  dedup_max_ts: string | null;
  ledger_max_ts: string | null;
  total_raw_trades: number;
  total_dedup_trades: number;
  token_map_null_count: number;
  token_map_total: number;
  token_map_null_frac: number;
  count_open_positions: number;
  count_resolved_positions: number;
  raw_fresh_lag_hours: number | null;
  dedup_lag_vs_raw_hours: number | null;
  is_exportable_realized: boolean;
  fail_reasons: string[];
}

// Gate thresholds
// NOTE: raw_fresh_lag is DISABLED for realized-only export.
// Old wallets that stopped trading are fine as long as all positions are resolved.
const GATE_RAW_FRESH_LAG_HOURS = Infinity; // Disabled - old wallets are OK for realized
const GATE_DEDUP_LAG_VS_RAW_HOURS = 6;
const GATE_TOKEN_MAP_NULL_FRAC = 0.01;
const GATE_COUNT_OPEN_POSITIONS = 0;
const GATE_MIN_RESOLVED_POSITIONS = 3;

async function main() {
  const client = getClickHouseClient();
  const now = new Date();

  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║   WALLET INPUT QUALITY AUDIT (BATCHED)                                     ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝\n');
  console.log(`Current time: ${now.toISOString()}`);
  console.log(`Gates: raw_fresh_lag<=${GATE_RAW_FRESH_LAG_HOURS}h, dedup_lag<=${GATE_DEDUP_LAG_VS_RAW_HOURS}h, token_null<=${GATE_TOKEN_MAP_NULL_FRAC*100}%, open==${GATE_COUNT_OPEN_POSITIONS}, resolved>=${GATE_MIN_RESOLVED_POSITIONS}\n`);

  // Get top 50 wallets from benchmark table
  const walletQuery = `
    SELECT wallet, pnl_value as ui_pnl
    FROM pm_ui_pnl_benchmarks_v1
    ORDER BY abs(pnl_value) DESC
    LIMIT 50
  `;

  const walletResult = await client.query({ query: walletQuery, format: 'JSONEachRow' });
  const wallets = (await walletResult.json()) as Array<{ wallet: string; ui_pnl: number }>;

  console.log(`Found ${wallets.length} wallets in benchmark table\n`);

  // Build wallet list for IN clause
  const wl = wallets.map(w => w.wallet.toLowerCase());
  const walletIn = wl.map(w => `'${w.replace(/'/g, "''")}'`).join(',');

  // Initialize audit map
  const auditMap: Map<string, WalletQualityAudit> = new Map();
  for (const { wallet, ui_pnl } of wallets) {
    auditMap.set(wallet.toLowerCase(), {
      wallet,
      ui_pnl,
      raw_max_ts: null,
      dedup_max_ts: null,
      ledger_max_ts: null,
      total_raw_trades: 0,
      total_dedup_trades: 0,
      token_map_null_count: 0,
      token_map_total: 0,
      token_map_null_frac: 0,
      count_open_positions: 0,
      count_resolved_positions: 0,
      raw_fresh_lag_hours: null,
      dedup_lag_vs_raw_hours: null,
      is_exportable_realized: false,
      fail_reasons: [],
    });
  }

  // Query A: Raw timestamps and counts
  console.log('[1/5] Fetching raw timestamps...');
  const rawQuery = `
    SELECT
      lower(trader_wallet) AS wallet,
      max(trade_time) AS raw_max_ts,
      count() AS raw_trade_count
    FROM pm_trader_events_v2
    WHERE is_deleted = 0 AND lower(trader_wallet) IN (${walletIn})
    GROUP BY wallet
  `;
  const rawResult = await client.query({ query: rawQuery, format: 'JSONEachRow' });
  const rawRows = (await rawResult.json()) as Array<{ wallet: string; raw_max_ts: string; raw_trade_count: string }>;
  for (const row of rawRows) {
    const audit = auditMap.get(row.wallet);
    if (audit) {
      audit.raw_max_ts = row.raw_max_ts || null;
      audit.total_raw_trades = Number(row.raw_trade_count);
    }
  }
  console.log(`   Found data for ${rawRows.length} wallets`);

  // Query B: Dedup timestamps and counts
  console.log('[2/5] Fetching dedup timestamps...');
  const dedupQuery = `
    SELECT
      lower(trader_wallet) AS wallet,
      max(trade_time) AS dedup_max_ts,
      count() AS dedup_trade_count
    FROM pm_trader_events_dedup_v2_tbl
    WHERE lower(trader_wallet) IN (${walletIn})
    GROUP BY wallet
  `;
  const dedupResult = await client.query({ query: dedupQuery, format: 'JSONEachRow' });
  const dedupRows = (await dedupResult.json()) as Array<{ wallet: string; dedup_max_ts: string; dedup_trade_count: string }>;
  for (const row of dedupRows) {
    const audit = auditMap.get(row.wallet);
    if (audit) {
      audit.dedup_max_ts = row.dedup_max_ts || null;
      audit.total_dedup_trades = Number(row.dedup_trade_count);
    }
  }
  console.log(`   Found data for ${dedupRows.length} wallets`);

  // Query C: Ledger timestamps
  console.log('[3/5] Fetching ledger timestamps...');
  const ledgerQuery = `
    SELECT
      lower(wallet_address) AS wallet,
      max(event_time) AS ledger_max_ts
    FROM pm_unified_ledger_v6
    WHERE lower(wallet_address) IN (${walletIn})
    GROUP BY wallet
  `;
  const ledgerResult = await client.query({ query: ledgerQuery, format: 'JSONEachRow' });
  const ledgerRows = (await ledgerResult.json()) as Array<{ wallet: string; ledger_max_ts: string }>;
  for (const row of ledgerRows) {
    const audit = auditMap.get(row.wallet);
    if (audit) {
      audit.ledger_max_ts = row.ledger_max_ts || null;
    }
  }
  console.log(`   Found data for ${ledgerRows.length} wallets`);

  // Query D: Token map null fraction
  console.log('[4/5] Checking token map coverage...');
  const tokenMapQuery = `
    SELECT
      lower(t.trader_wallet) AS wallet,
      count() AS total,
      countIf(m.condition_id IS NULL OR m.condition_id = '') AS null_count
    FROM pm_trader_events_dedup_v2_tbl t
    LEFT JOIN pm_token_to_condition_map_v4 m
      ON toString(t.token_id) = toString(m.token_id_dec)
    WHERE lower(t.trader_wallet) IN (${walletIn})
    GROUP BY wallet
  `;
  const tokenMapResult = await client.query({ query: tokenMapQuery, format: 'JSONEachRow' });
  const tokenMapRows = (await tokenMapResult.json()) as Array<{ wallet: string; total: string; null_count: string }>;
  for (const row of tokenMapRows) {
    const audit = auditMap.get(row.wallet);
    if (audit) {
      audit.token_map_total = Number(row.total);
      audit.token_map_null_count = Number(row.null_count);
      audit.token_map_null_frac = audit.token_map_total > 0
        ? audit.token_map_null_count / audit.token_map_total
        : 0;
    }
  }
  console.log(`   Found data for ${tokenMapRows.length} wallets`);

  // Query E: Open vs resolved position counts
  console.log('[5/5] Counting open vs resolved positions...');
  const positionQuery = `
    WITH positions AS (
      SELECT
        lower(t.trader_wallet) AS wallet,
        m.condition_id
      FROM pm_trader_events_dedup_v2_tbl t
      INNER JOIN pm_token_to_condition_map_v4 m
        ON toString(t.token_id) = toString(m.token_id_dec)
      WHERE lower(t.trader_wallet) IN (${walletIn})
        AND m.condition_id IS NOT NULL
        AND m.condition_id != ''
      GROUP BY wallet, m.condition_id
    )
    SELECT
      p.wallet,
      countIf(r.condition_id IS NULL) AS open_count,
      countIf(r.condition_id IS NOT NULL) AS resolved_count
    FROM positions p
    LEFT JOIN pm_condition_resolutions r
      ON lower(p.condition_id) = lower(r.condition_id)
      AND r.is_deleted = 0
    GROUP BY p.wallet
  `;
  const posResult = await client.query({ query: positionQuery, format: 'JSONEachRow' });
  const posRows = (await posResult.json()) as Array<{ wallet: string; open_count: string; resolved_count: string }>;
  for (const row of posRows) {
    const audit = auditMap.get(row.wallet);
    if (audit) {
      audit.count_open_positions = Number(row.open_count);
      audit.count_resolved_positions = Number(row.resolved_count);
    }
  }
  console.log(`   Found data for ${posRows.length} wallets`);

  // Calculate derived metrics and apply gates
  console.log('\nApplying gates...');
  for (const audit of auditMap.values()) {
    // Calculate lag metrics
    if (audit.raw_max_ts) {
      const rawDate = new Date(audit.raw_max_ts);
      audit.raw_fresh_lag_hours = (now.getTime() - rawDate.getTime()) / (1000 * 60 * 60);
    }
    if (audit.raw_max_ts && audit.dedup_max_ts) {
      const rawDate = new Date(audit.raw_max_ts);
      const dedupDate = new Date(audit.dedup_max_ts);
      audit.dedup_lag_vs_raw_hours = (rawDate.getTime() - dedupDate.getTime()) / (1000 * 60 * 60);
    }

    // Apply gates
    if (audit.raw_fresh_lag_hours === null || audit.raw_fresh_lag_hours > GATE_RAW_FRESH_LAG_HOURS) {
      audit.fail_reasons.push(`raw_fresh_lag=${audit.raw_fresh_lag_hours?.toFixed(1) ?? 'NULL'}h`);
    }
    if (audit.dedup_lag_vs_raw_hours === null || audit.dedup_lag_vs_raw_hours > GATE_DEDUP_LAG_VS_RAW_HOURS) {
      audit.fail_reasons.push(`dedup_lag=${audit.dedup_lag_vs_raw_hours?.toFixed(1) ?? 'NULL'}h`);
    }
    if (audit.token_map_null_frac > GATE_TOKEN_MAP_NULL_FRAC) {
      audit.fail_reasons.push(`token_null=${(audit.token_map_null_frac * 100).toFixed(1)}%`);
    }
    if (audit.count_open_positions !== GATE_COUNT_OPEN_POSITIONS) {
      audit.fail_reasons.push(`open_pos=${audit.count_open_positions}`);
    }
    if (audit.count_resolved_positions < GATE_MIN_RESOLVED_POSITIONS) {
      audit.fail_reasons.push(`resolved=${audit.count_resolved_positions}`);
    }
    if (audit.total_dedup_trades === 0) {
      audit.fail_reasons.push('no_trades');
    }

    audit.is_exportable_realized = audit.fail_reasons.length === 0;
  }

  const audits = Array.from(auditMap.values());

  console.log('\n' + '═'.repeat(100));
  console.log('QUALITY AUDIT RESULTS');
  console.log('═'.repeat(100));

  const exportable = audits.filter(a => a.is_exportable_realized);
  const notExportable = audits.filter(a => !a.is_exportable_realized);

  console.log(`\nExportable (realized PnL): ${exportable.length}/${audits.length} wallets`);
  console.log(`Not exportable: ${notExportable.length}/${audits.length} wallets`);

  // Failure reason breakdown
  const failureReasons: Record<string, number> = {};
  for (const audit of notExportable) {
    for (const reason of audit.fail_reasons) {
      const key = reason.split('=')[0];
      failureReasons[key] = (failureReasons[key] || 0) + 1;
    }
  }

  console.log('\nFailure reasons breakdown:');
  for (const [reason, count] of Object.entries(failureReasons).sort((a, b) => b[1] - a[1])) {
    const pct = ((count / notExportable.length) * 100).toFixed(0);
    console.log(`  ${reason.padEnd(20)}: ${String(count).padStart(3)} (${pct}%)`);
  }

  // Write CSV files
  const csvHeader = 'wallet,ui_pnl,raw_max_ts,dedup_max_ts,raw_fresh_lag_hours,dedup_lag_vs_raw_hours,token_map_null_frac,count_open_positions,count_resolved_positions,is_exportable_realized,fail_reasons';

  const toCsvRow = (a: WalletQualityAudit) => [
    a.wallet,
    a.ui_pnl ?? '',
    a.raw_max_ts ?? '',
    a.dedup_max_ts ?? '',
    a.raw_fresh_lag_hours?.toFixed(1) ?? '',
    a.dedup_lag_vs_raw_hours?.toFixed(1) ?? '',
    (a.token_map_null_frac * 100).toFixed(2),
    a.count_open_positions,
    a.count_resolved_positions,
    a.is_exportable_realized ? 'YES' : 'NO',
    `"${a.fail_reasons.join('; ')}"`,
  ].join(',');

  // All wallets
  const allCsv = [csvHeader, ...audits.map(toCsvRow)].join('\n');
  fs.writeFileSync('/tmp/wallet_quality_audit.csv', allCsv);
  console.log(`\nWrote /tmp/wallet_quality_audit.csv (${audits.length} rows)`);

  // Exportable only
  const exportableCsv = [csvHeader, ...exportable.map(toCsvRow)].join('\n');
  fs.writeFileSync('/tmp/wallet_quality_exportable_realized.csv', exportableCsv);
  console.log(`Wrote /tmp/wallet_quality_exportable_realized.csv (${exportable.length} rows)`);

  // Show exportable wallets
  if (exportable.length > 0) {
    console.log('\n' + '─'.repeat(100));
    console.log('EXPORTABLE WALLETS:');
    console.log('─'.repeat(100));
    console.log('Wallet                                      | UI PnL       | Resolved | Token OK');
    console.log('─'.repeat(100));
    for (const a of exportable) {
      const ui = a.ui_pnl !== null ? `$${a.ui_pnl.toLocaleString().padStart(12)}` : '      N/A';
      const tokenOk = ((1 - a.token_map_null_frac) * 100).toFixed(1) + '%';
      console.log(`${a.wallet} | ${ui} | ${String(a.count_resolved_positions).padStart(8)} | ${tokenOk}`);
    }
  }

  // Show first 30 failures with reasons
  console.log('\n' + '─'.repeat(100));
  console.log('NOT EXPORTABLE (first 30):');
  console.log('─'.repeat(100));
  for (const a of notExportable.slice(0, 30)) {
    console.log(`${a.wallet.slice(0, 20)}... | ${a.fail_reasons.join(', ')}`);
  }

  console.log('\n' + '═'.repeat(100));
  console.log('NEXT STEPS:');
  console.log('═'.repeat(100));
  if (exportable.length > 0) {
    console.log(`1. Run engine comparison on ${exportable.length} exportable wallets:`);
    console.log(`   npx tsx scripts/pnl/compare-engines-on-exportable.ts`);
  } else {
    console.log('0 exportable wallets. Fix the biggest blocker:');
    const topBlocker = Object.entries(failureReasons).sort((a, b) => b[1] - a[1])[0];
    if (topBlocker) {
      console.log(`   TOP BLOCKER: ${topBlocker[0]} (${topBlocker[1]} wallets)`);
      if (topBlocker[0] === 'token_null') {
        console.log('   FIX: Inspect token_id types - run scripts/pnl/debug-token-map-join.ts');
      } else if (topBlocker[0] === 'dedup_lag') {
        console.log('   FIX: Dedup cron/backfill not keeping up - check pm_trader_events_dedup_v2_tbl freshness');
      } else if (topBlocker[0] === 'raw_fresh_lag') {
        console.log('   FIX: Raw ingestion is stale - nothing downstream matters until this is fixed');
      } else if (topBlocker[0] === 'open_pos') {
        console.log('   INFO: Many wallets have open positions - expected for active traders. For realized-only export, this is OK to filter out.');
      }
    }
  }
}

main().catch(console.error);
