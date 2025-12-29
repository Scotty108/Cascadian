import { clickhouse } from '../../lib/clickhouse/client';
import { calculateV23cPnL } from '../../lib/pnl/shadowLedgerV23c';
import { calculateV29PnL } from '../../lib/pnl/inventoryEngineV29';

const bench = process.env.BENCH || 'trader_strict_v2_2025_12_07';

async function main() {
  const uiRows = await clickhouse.query({
    query: `
      SELECT
        lower(wallet_address) as wallet,
        ui_pnl_value
      FROM pm_ui_pnl_benchmarks_v2
      WHERE benchmark_set = '${bench}'
        AND status = 'success'
      ORDER BY ui_pnl_value DESC
    `,
    format: 'JSONEachRow'
  }).then(r => r.json()) as { wallet: string; ui_pnl_value: string }[];

  // Compute engines sequentially for clarity
  const results: {
    wallet: string;
    ui: number;
    v23Total: number;
    v29Total: number;
    d23: number;
    d29: number;
    p23: number | null;
    p29: number | null;
  }[] = [];

  for (const r of uiRows) {
    const wallet = r.wallet;
    const ui = Number(r.ui_pnl_value);

    const v23 = await calculateV23cPnL(wallet);
    const v29 = await calculateV29PnL(wallet);

    const v23Total = Number((v23 as any)?.totalPnl ?? (v23 as any)?.total ?? 0);
    const v29Total = Number((v29 as any)?.totalPnl ?? (v29 as any)?.total ?? 0);

    const d23 = v23Total - ui;
    const d29 = v29Total - ui;

    const p23 = ui !== 0 ? (Math.abs(d23) / Math.abs(ui)) * 100 : null;
    const p29 = ui !== 0 ? (Math.abs(d29) / Math.abs(ui)) * 100 : null;

    results.push({
      wallet,
      ui,
      v23Total,
      v29Total,
      d23,
      d29,
      p23,
      p29
    });
  }

  // Print compact markdown-like table
  const fmt = (n: number) => (Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: 0 }) : '0');
  const fmtPct = (p: number | null) => (p == null ? '-' : p.toFixed(1) + '%');

  console.log('');
  console.log('| Wallet | UI Total | V23C Total | V29 Total | V23 Δ | V29 Δ | V23 %Err | V29 %Err |');
  console.log('|---|---:|---:|---:|---:|---:|---:|---:|');

  for (const x of results) {
    console.log(
      `| ${x.wallet.slice(0,6)}...${x.wallet.slice(-4)} | ${fmt(x.ui)} | ${fmt(x.v23Total)} | ${fmt(x.v29Total)} | ${fmt(x.d23)} | ${fmt(x.d29)} | ${fmtPct(x.p23)} | ${fmtPct(x.p29)} |`
    );
  }

  // Summary stats for V29 vs UI with 6% tolerance
  const testable = results.filter(r => Math.abs(r.ui) > 100);
  const pass6 = testable.filter(r => (r.p29 ?? 999) < 6).length;

  console.log('');
  console.log(`Bench set: ${bench}`);
  console.log(`Wallets: ${results.length}`);
  console.log(`Testable (|UI| > $100): ${testable.length}`);
  console.log(`V29 pass rate (<6% vs UI total): ${pass6}/${testable.length} = ${(testable.length ? (pass6/testable.length*100).toFixed(1) : '0.0')}%`);
}

main().catch(console.error);
