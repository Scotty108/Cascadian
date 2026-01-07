/**
 * Debug insider wallet analysis
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

async function main() {
  const wallet = '0x2663daca3cecf3767ca1c3b126002a8578a8ed1f';

  console.log('=== CHECKING WALLET: ' + wallet + ' ===\n');

  // Check trades
  const trades = await clickhouse.query({
    query: `
      SELECT count() as cnt, min(trade_time) as first, max(trade_time) as last
      FROM pm_trader_events_v2
      WHERE trader_wallet = '${wallet}' AND is_deleted = 0
    `,
    format: 'JSONEachRow'
  });
  const tradeData = (await trades.json() as any[])[0];
  console.log('Trades: ' + tradeData.cnt + ' | First: ' + tradeData.first + ' | Last: ' + tradeData.last);

  // Check positions from precomputed
  const positions = await clickhouse.query({
    query: `
      SELECT count() as cnt, sum(realized_pnl) as pnl, sum(is_win) as wins
      FROM pm_wallet_condition_realized_v1
      WHERE wallet = '${wallet}'
    `,
    format: 'JSONEachRow'
  });
  const posData = (await positions.json() as any[])[0];
  console.log('Precomputed positions: ' + posData.cnt + ' | PnL: $' + posData.pnl?.toFixed(0) + ' | Wins: ' + posData.wins);

  // Sample some positions from precomputed
  const samplePos = await clickhouse.query({
    query: `
      SELECT
        condition_id,
        realized_pnl,
        cost_basis,
        avg_entry_price,
        is_win
      FROM pm_wallet_condition_realized_v1
      WHERE wallet = '${wallet}'
      ORDER BY realized_pnl DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });
  const samplePosData = await samplePos.json() as any[];
  console.log('\nTop 10 positions:');
  for (const p of samplePosData) {
    console.log('  ' + (p.is_win ? 'WIN' : 'LOSS') + ' | Entry: ' + (p.avg_entry_price * 100).toFixed(1) + '% | Cost: $' + p.cost_basis.toFixed(0) + ' | PnL: $' + p.realized_pnl.toFixed(0));
  }

  // Try to find wallets with actual entry price data
  console.log('\n\n=== FINDING WALLETS WITH GOOD ENTRY PRICE DATA ===\n');

  const goodData = await clickhouse.query({
    query: `
      SELECT
        wallet,
        count() as positions,
        sum(is_win) as wins,
        sum(is_win) / count() as win_rate,
        avg(avg_entry_price) as avg_entry,
        countIf(avg_entry_price > 0.05 AND avg_entry_price < 0.95) as good_entries,
        sum(realized_pnl) as total_pnl
      FROM pm_wallet_condition_realized_v1
      WHERE avg_entry_price > 0
      GROUP BY wallet
      HAVING
        count() >= 8
        AND sum(is_win) / count() >= 0.85
        AND sum(realized_pnl) > 0
        AND countIf(avg_entry_price > 0.05 AND avg_entry_price < 0.95) >= 5
      ORDER BY win_rate DESC, total_pnl DESC
      LIMIT 20
    `,
    format: 'JSONEachRow'
  });
  const goodDataResults = await goodData.json() as any[];
  console.log('Found ' + goodDataResults.length + ' wallets with good entry data:');
  for (const r of goodDataResults) {
    console.log('  ' + r.wallet.substring(0, 20) + '... WR:' + (r.win_rate * 100).toFixed(0) + '% AvgEntry:' + (r.avg_entry * 100).toFixed(0) + '% Good:' + r.good_entries + ' PnL:$' + r.total_pnl.toFixed(0));
  }
}

main().catch(console.error);
