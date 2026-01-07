/**
 * Find TRUE SUPERFORECASTERS
 * - 90%+ win rate
 * - NOT arbers (entry < 90%)
 * - Positive PnL
 * - Don't care about frequency
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

async function main() {
  console.log('=== SUPERFORECASTER SEARCH ===');
  console.log('90%+ win rate, NOT arbers, positive PnL\n');

  const candidates = await clickhouse.query({
    query: `
      SELECT
        wallet_address as wallet,
        win_rate,
        avg_win_pct,
        avg_loss_pct,
        resolved_positions as positions,
        realized_pnl,
        is_phantom
      FROM pm_copy_trading_metrics_v1 FINAL
      WHERE
        win_rate >= 0.90
        AND resolved_positions >= 8
        AND realized_pnl > 0
      ORDER BY win_rate DESC, realized_pnl DESC
    `,
    format: 'JSONEachRow'
  });
  const data = await candidates.json() as any[];
  console.log(`Found ${data.length} wallets with 90%+ WR and positive PnL\n`);

  const snipers: any[] = [];

  for (const c of data) {
    const priceResult = await clickhouse.query({
      query: `
        SELECT avg(usdc / nullIf(tokens, 0)) as avg_entry
        FROM (
          SELECT event_id, any(usdc_amount)/1e6 as usdc, any(token_amount)/1e6 as tokens
          FROM pm_trader_events_v2
          WHERE trader_wallet = '${c.wallet}' AND lower(side) = 'buy' AND is_deleted = 0
          GROUP BY event_id
        )
        WHERE tokens > 0 AND usdc > 0
      `,
      format: 'JSONEachRow'
    });
    const avgEntry = (await priceResult.json() as any[])[0]?.avg_entry || 0;

    // Check last trade date
    const lastResult = await clickhouse.query({
      query: `
        SELECT max(trade_time) as last_trade
        FROM pm_trader_events_v2
        WHERE trader_wallet = '${c.wallet}' AND is_deleted = 0
      `,
      format: 'JSONEachRow'
    });
    const lastTrade = (await lastResult.json() as any[])[0]?.last_trade;
    const daysSince = lastTrade ? Math.floor((Date.now() - new Date(lastTrade).getTime()) / (1000*60*60*24)) : 999;

    const status = avgEntry >= 0.90 ? 'ARBER' : avgEntry < 0.10 ? 'LONGSHOT' : 'SNIPER';

    console.log(`${c.wallet.substring(0,12)}... WR:${(c.win_rate*100).toFixed(0)}% Entry:${(avgEntry*100).toFixed(0)}% PnL:$${c.realized_pnl.toFixed(0)} Pos:${c.positions} Phantom:${c.is_phantom} Last:${daysSince}d -> ${status}`);

    if (avgEntry >= 0.10 && avgEntry < 0.90 && c.is_phantom === 0) {
      snipers.push({ ...c, avg_entry: avgEntry, days_since: daysSince });
    }
  }

  console.log(`\n${'='.repeat(80)}`);
  console.log(`\n🎯 TRUE SUPERFORECASTERS: ${snipers.length} wallets\n`);

  if (snipers.length === 0) {
    console.log('None found in the 2,422 pre-computed wallets.');
    console.log('The database has 800k+ wallets but only 2,422 are in the metrics table.');
    return;
  }

  snipers.sort((a, b) => b.win_rate - a.win_rate || b.realized_pnl - a.realized_pnl);

  for (const s of snipers) {
    console.log(`${s.wallet}`);
    console.log(`  Win Rate: ${(s.win_rate*100).toFixed(1)}% (${s.positions} positions)`);
    console.log(`  Avg Entry: ${(s.avg_entry*100).toFixed(1)}%`);
    console.log(`  Avg Win: ${s.avg_win_pct.toFixed(1)}% | Avg Loss: ${(s.avg_loss_pct||0).toFixed(1)}%`);
    console.log(`  PnL: $${s.realized_pnl.toFixed(2)}`);
    console.log(`  Last trade: ${s.days_since} days ago`);
    console.log(`  https://polymarket.com/profile/${s.wallet}\n`);
  }

  console.log('=== SUPERFORECASTER ADDRESSES ===\n');
  for (const s of snipers) {
    console.log(s.wallet);
  }
}

main().catch(console.error);
