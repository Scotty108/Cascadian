#!/usr/bin/env npx tsx
/**
 * Compare V23C vs V29 on TRADER_STRICT sample v2 (FAST)
 *
 * Uses:
 * - tmp/trader_strict_sample_v2_fast.json for wallets
 * - Batch cash-flow sanity check
 * - V29 preload path via preloadV29Data()
 * - V23c with UI oracle mode
 *
 * Outputs:
 * - tmp/v23c_vs_v29_trader_strict_v2_results.json
 *
 * Usage:
 *   npx tsx scripts/pnl/compare-v23c-v29-trader-strict-v2.ts --limit 20
 */

import fs from 'fs/promises';
import path from 'path';
import { clickhouse } from '../../lib/clickhouse/client';
import { calculateV29PnL, V29Preload } from '../../lib/pnl/inventoryEngineV29';
import { preloadV29Data } from '../../lib/pnl/v29BatchLoaders';
import { calculateV23cPnL } from '../../lib/pnl/shadowLedgerV23c';

type WalletCandidate = {
  wallet_address: string;
  ledger_rows?: number;
  distinct_conditions?: number;
};

type Row = {
  wallet: string;
  cashFlow: number | null;
  v23c_uiParity?: number | null;
  v29_uiParity?: number | null;
  v23c_realized?: number | null;
  v29_realized?: number | null;
  v23c_err_pct_vs_cash?: number | null;
  v29_err_pct_vs_cash?: number | null;
  delta_v29_minus_v23c?: number | null;
  notes?: string[];
  ms_v23c?: number;
  ms_v29?: number;
};

function parseArgs() {
  const args = new Map<string, string>();
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    const [k, v] = a.split('=');
    if (k.startsWith('--')) args.set(k.replace(/^--/, ''), v ?? 'true');
  }
  return {
    limit: Number(args.get('limit') ?? 20),
  };
}

async function loadCandidates(): Promise<WalletCandidate[]> {
  const p = path.join(process.cwd(), 'tmp', 'trader_strict_sample_v2_fast.json');
  const raw = await fs.readFile(p, 'utf8');
  const data = JSON.parse(raw);
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.wallets)) return data.wallets;
  throw new Error('Unknown fast sample format');
}

async function batchLoadCashFlow(wallets: string[]): Promise<Map<string, number>> {
  if (wallets.length === 0) return new Map();
  // Uses unified ledger deltas
  const q = `
    SELECT
      lower(wallet_address) AS wallet,
      sumIf(usdc_delta, usdc_delta != 0) AS cash_flow
    FROM pm_unified_ledger_v8_tbl
    WHERE lower(wallet_address) IN ({wallets:Array(String)})
      AND source_type IN ('CLOB', 'PayoutRedemption')
    GROUP BY wallet
  `;
  const rows = await clickhouse.query({
    query: q,
    query_params: { wallets: wallets.map(w => w.toLowerCase()) },
    format: 'JSONEachRow'
  }).then(r => r.json<any>());

  const m = new Map<string, number>();
  for (const r of rows) m.set(String(r.wallet), Number(r.cash_flow));
  return m;
}

function pctErr(value: number | null | undefined, baseline: number | null | undefined) {
  if (value == null || baseline == null) return null;
  if (baseline === 0) return value === 0 ? 0 : 100;
  return Math.abs((value - baseline) / baseline) * 100;
}

async function main() {
  const { limit } = parseArgs();
  const all = await loadCandidates();
  const slice = all.slice(0, limit);

  const wallets = slice.map(c => c.wallet_address.toLowerCase());

  console.log(`\n═══════════════════════════════════════════════════════════════════`);
  console.log(`   V23C vs V29 - TRADER_STRICT v2 FAST HEAD-TO-HEAD`);
  console.log(`═══════════════════════════════════════════════════════════════════`);
  console.log(`\n⚙️  Configuration:`);
  console.log(`   Wallets: ${wallets.length}`);
  console.log(`   Start time: ${new Date().toISOString()}`);
  console.log();

  // Batch load cash flow
  console.log(`🔄 Batch loading cash flow for ${wallets.length} wallets...`);
  const t0 = Date.now();
  const cashFlowMap = await batchLoadCashFlow(wallets);
  console.log(`✅ Batch cash flow loaded in ${Date.now() - t0}ms\n`);

  // Batch preload V29 data once
  console.log(`🚀 Preloading V29 data for ${wallets.length} wallets...`);
  const t1 = Date.now();
  const preloadData = await preloadV29Data(wallets);
  console.log(`✅ V29 preload complete in ${Date.now() - t1}ms\n`);

  const out: Row[] = [];

  console.log(`🚀 Running head-to-head comparison...\n`);

  for (let i = 0; i < wallets.length; i++) {
    const w = wallets[i];
    const notes: string[] = [];
    const cash = cashFlowMap.get(w) ?? null;

    // V29 with preload
    const t2 = Date.now();
    let v29: any = null;
    try {
      const events = preloadData.eventsByWallet.get(w) || [];
      const preload: V29Preload = {
        events,
        resolutionPrices: preloadData.resolutionPrices
      };
      v29 = await calculateV29PnL(w, { inventoryGuard: true, preload });
    } catch (e: any) {
      notes.push(`V29 error: ${e?.message ?? String(e)}`);
    }
    const msV29 = Date.now() - t2;

    // V23C with UI oracle
    const t3 = Date.now();
    let v23: any = null;
    try {
      v23 = await calculateV23cPnL(w, { useUIOracle: true });
    } catch (e: any) {
      notes.push(`V23C error: ${e?.message ?? String(e)}`);
    }
    const msV23 = Date.now() - t3;

    // Normalize expected fields
    const v29_realized = v29?.realizedPnl ?? null;
    const v29_ui = v29?.uiParityPnl ?? v29?.uiParity ?? null;

    const v23_realized = v23?.realizedPnl ?? v23?.realized ?? null;
    const v23_ui = v23?.uiParityPnl ?? v23?.uiParity ?? null;

    const v23_err = pctErr(v23_realized, cash);
    const v29_err = pctErr(v29_realized, cash);

    out.push({
      wallet: w,
      cashFlow: cash,
      v23c_realized: v23_realized,
      v29_realized: v29_realized,
      v23c_uiParity: v23_ui,
      v29_uiParity: v29_ui,
      v23c_err_pct_vs_cash: v23_err,
      v29_err_pct_vs_cash: v29_err,
      delta_v29_minus_v23c: (v29_ui != null && v23_ui != null) ? (Number(v29_ui) - Number(v23_ui)) : null,
      notes,
      ms_v23c: msV23,
      ms_v29: msV29
    });

    const v23Status = (v23_err ?? 999) <= 3 ? '✅' : '❌';
    const v29Status = (v29_err ?? 999) <= 3 ? '✅' : '❌';
    process.stdout.write(`  Progress: ${i + 1}/${wallets.length} | ${w.slice(0, 12)}... | V23C: ${v23Status} (${v23_err?.toFixed(2) ?? 'ERR'}%) | V29: ${v29Status} (${v29_err?.toFixed(2) ?? 'ERR'}%)\r`);
  }
  console.log(); // newline after progress

  const outPath = path.join(process.cwd(), 'tmp', 'v23c_vs_v29_trader_strict_v2_results.json');
  await fs.writeFile(outPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    limit,
    wallets: out
  }, null, 2));

  // Print a quick summary
  const ok23_3pct = out.filter(r => (r.v23c_err_pct_vs_cash ?? 999) <= 3).length;
  const ok29_3pct = out.filter(r => (r.v29_err_pct_vs_cash ?? 999) <= 3).length;
  const ok23_5pct = out.filter(r => (r.v23c_err_pct_vs_cash ?? 999) <= 5).length;
  const ok29_5pct = out.filter(r => (r.v29_err_pct_vs_cash ?? 999) <= 5).length;

  // Calculate median/mean errors for both engines
  const v23Errors = out.map(r => r.v23c_err_pct_vs_cash).filter((e): e is number => e != null);
  const v29Errors = out.map(r => r.v29_err_pct_vs_cash).filter((e): e is number => e != null);

  const median = (arr: number[]) => {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  };
  const mean = (arr: number[]) => arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length;

  console.log(`\n═══════════════════════════════════════════════════════════════════`);
  console.log(`                    HEAD-TO-HEAD SUMMARY`);
  console.log(`═══════════════════════════════════════════════════════════════════\n`);
  console.log(`  Total wallets:        ${out.length}\n`);
  console.log(`  V23C <=3% error:      ${ok23_3pct}/${out.length} (${(ok23_3pct / out.length * 100).toFixed(1)}%)`);
  console.log(`  V29  <=3% error:      ${ok29_3pct}/${out.length} (${(ok29_3pct / out.length * 100).toFixed(1)}%)\n`);
  console.log(`  V23C <=5% error:      ${ok23_5pct}/${out.length} (${(ok23_5pct / out.length * 100).toFixed(1)}%)`);
  console.log(`  V29  <=5% error:      ${ok29_5pct}/${out.length} (${(ok29_5pct / out.length * 100).toFixed(1)}%)\n`);

  console.log(`--- ERROR STATISTICS (realized vs cash) ---\n`);
  console.log(`  V23C Median error:    ${median(v23Errors).toFixed(2)}%`);
  console.log(`  V29  Median error:    ${median(v29Errors).toFixed(2)}%\n`);
  console.log(`  V23C Mean error:      ${mean(v23Errors).toFixed(2)}%`);
  console.log(`  V29  Mean error:      ${mean(v29Errors).toFixed(2)}%\n`);

  // Identify wallets where they differ significantly
  const divergent = out.filter(r => {
    const diff = Math.abs((r.v23c_err_pct_vs_cash ?? 0) - (r.v29_err_pct_vs_cash ?? 0));
    return diff > 10; // More than 10pp difference
  });

  if (divergent.length > 0) {
    console.log(`--- DIVERGENT WALLETS (>10pp difference in error) ---\n`);
    divergent.slice(0, 5).forEach(r => {
      console.log(`  ${r.wallet}`);
      console.log(`    Cash flow:    $${r.cashFlow?.toFixed(2)}`);
      console.log(`    V23C:         $${r.v23c_realized?.toFixed(2)} (${r.v23c_err_pct_vs_cash?.toFixed(2)}% error)`);
      console.log(`    V29:          $${r.v29_realized?.toFixed(2)} (${r.v29_err_pct_vs_cash?.toFixed(2)}% error)`);
      console.log();
    });
  }

  console.log(`\n📄 Results saved to: ${outPath}\n`);

  console.log(`═══════════════════════════════════════════════════════════════════`);
  if (ok29_3pct > ok23_3pct) {
    console.log(`  ✅ V29 WINS: Better accuracy than V23C on this cohort`);
  } else if (ok23_3pct > ok29_3pct) {
    console.log(`  ✅ V23C WINS: Better accuracy than V29 on this cohort`);
  } else {
    console.log(`  ⚖️  TIE: Both engines show same accuracy on this cohort`);
  }
  console.log(`═══════════════════════════════════════════════════════════════════\n`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
