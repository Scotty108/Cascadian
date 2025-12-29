/**
 * Phase 3: Attribution Summary
 *
 * Prints a summary table showing UI vs DB data for each benchmark wallet.
 */

import { clickhouse } from '../../lib/clickhouse/client';
import { createV17Engine } from '../../lib/pnl/uiActivityEngineV17';

// 6 wallet benchmark set with corrected addresses
const BENCHMARK_WALLETS = [
  { wallet: '0x9d36c904930a7d06c5403f9e16996e919f586486', ui_pnl: -6138.9, note: 'Theo NegRisk' },
  { wallet: '0xdfe10ac1e7de4f273bae988f2fc4d42434f72838', ui_pnl: 4404.92, note: 'Golden (0.3% err)' },
  { wallet: '0x418db17eaa8f25eaf2085657d0becd82462c6786', ui_pnl: 5.44, note: 'Trump wallet' },
  { wallet: '0x4974d5c6c551e79c8f2f48f943e18d75c6a9ea15', ui_pnl: -294.61, note: 'Sign flip case' },
  { wallet: '0xeab03de44f98ad31ecc19cd597bcdef1c9fe42c2', ui_pnl: 146.9, note: 'Fresh UI' },
  { wallet: '0x7dca4d9f31ceba9d2d5b7a723eccd5e2e7ccc48d', ui_pnl: 470.4, note: 'Fresh UI' },
];

interface DBStats {
  raw_rows: number;
  unique_trades: number;
  total_usdc: number;
  maker_trades: number;
  taker_trades: number;
  maker_usdc: number;
  taker_usdc: number;
}

async function getDBStats(wallet: string): Promise<DBStats> {
  const query = `
    SELECT
      count() as raw_rows,
      countDistinct(event_id) as unique_trades,
      sum(usdc_amount)/1e6 as total_usdc,
      countIf(role = 'maker') as maker_rows,
      countIf(role = 'taker') as taker_rows,
      sumIf(usdc_amount, role = 'maker')/1e6 as maker_usdc,
      sumIf(usdc_amount, role = 'taker')/1e6 as taker_usdc
    FROM pm_trader_events_v2
    WHERE lower(trader_wallet) = lower('${wallet}')
      AND is_deleted = 0
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];
  const r = rows[0] || {};

  // Get unique trades by role
  const uniqueQuery = `
    SELECT
      role,
      countDistinct(event_id) as unique_trades
    FROM pm_trader_events_v2
    WHERE lower(trader_wallet) = lower('${wallet}')
      AND is_deleted = 0
    GROUP BY role
  `;

  const uniqueResult = await clickhouse.query({ query: uniqueQuery, format: 'JSONEachRow' });
  const uniqueRows = (await uniqueResult.json()) as any[];

  let maker_trades = 0;
  let taker_trades = 0;
  for (const row of uniqueRows) {
    if (row.role === 'maker') maker_trades = row.unique_trades;
    if (row.role === 'taker') taker_trades = row.unique_trades;
  }

  return {
    raw_rows: r.raw_rows || 0,
    unique_trades: r.unique_trades || 0,
    total_usdc: r.total_usdc || 0,
    maker_trades,
    taker_trades,
    maker_usdc: r.maker_usdc || 0,
    taker_usdc: r.taker_usdc || 0,
  };
}

async function main() {
  console.log('='.repeat(140));
  console.log('PHASE 3: ATTRIBUTION SUMMARY');
  console.log('='.repeat(140));
  console.log('');

  const engine = createV17Engine();

  console.log(
    'Wallet           | UI PnL         | V17 Realized   | V17 Unreal | DB Trades | DB Vol      | Maker | Taker | Maker%  | Note'
  );
  console.log('-'.repeat(140));

  for (const b of BENCHMARK_WALLETS) {
    const stats = await getDBStats(b.wallet);
    const v17 = await engine.compute(b.wallet);

    const makerPct = stats.unique_trades > 0 ? ((stats.maker_trades / stats.unique_trades) * 100).toFixed(0) : '0';

    console.log(
      `${b.wallet.substring(0, 14)}... | ` +
        `$${b.ui_pnl.toLocaleString().padStart(12)} | ` +
        `$${v17.realized_pnl.toFixed(2).padStart(12)} | ` +
        `$${v17.unrealized_pnl.toFixed(2).padStart(8)} | ` +
        `${String(stats.unique_trades).padStart(9)} | ` +
        `$${stats.total_usdc.toFixed(0).padStart(9)} | ` +
        `${String(stats.maker_trades).padStart(5)} | ` +
        `${String(stats.taker_trades).padStart(5)} | ` +
        `${makerPct.padStart(5)}%  | ` +
        `${b.note}`
    );
  }

  console.log('-'.repeat(140));
  console.log('');
  console.log('KEY OBSERVATIONS:');
  console.log('- Maker% shows what fraction of unique trades are maker (liquidity provision) vs taker (market orders)');
  console.log('- High maker% wallets may have attribution differences with Polymarket UI');
  console.log('- Trump wallet (0x418db17...) has the largest discrepancy - needs deep investigation');
  console.log('');
}

main().catch(console.error);
