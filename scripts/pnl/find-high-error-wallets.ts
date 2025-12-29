import { clickhouse } from '../../lib/clickhouse/client';

async function main() {
  // Get benchmarks with CLOB data
  const query = `
    SELECT
      b.wallet,
      b.pnl_value as ui_pnl,
      b.note,
      (SELECT count() FROM pm_trader_events_v2 WHERE lower(trader_wallet) = lower(b.wallet)) as clob_trades,
      (SELECT sum(realized_pnl) FROM pm_cascadian_pnl_v1_new WHERE lower(trader_wallet) = lower(b.wallet)) as our_pnl
    FROM pm_ui_pnl_benchmarks_v1 b
    WHERE benchmark_set = '50_wallet_v1_legacy'
  `;
  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as any[];

  // Filter to wallets with CLOB data and calculate error
  const withData = rows
    .filter((r: any) => r.clob_trades > 1000)
    .map((r: any) => {
      const ourPnl = r.our_pnl || 0;
      const errorPct = r.ui_pnl !== 0 ? Math.abs(r.ui_pnl - ourPnl) / Math.abs(r.ui_pnl) * 100 : 0;
      return { ...r, our_pnl: ourPnl, error_pct: errorPct };
    })
    .sort((a: any, b: any) => b.error_pct - a.error_pct);

  console.log('=== WALLETS WITH 1000+ CLOB TRADES ===');
  console.log('');
  for (const r of withData.slice(0, 10)) {
    console.log(r.wallet.slice(0,14) + '...');
    console.log('  CLOB trades: ' + Number(r.clob_trades).toLocaleString());
    console.log('  UI PnL: $' + Number(r.ui_pnl).toLocaleString());
    console.log('  Our PnL: $' + Number(r.our_pnl).toLocaleString());
    console.log('  Error: ' + r.error_pct.toFixed(1) + '%');
    console.log('');
  }
}

main().catch(console.error);
