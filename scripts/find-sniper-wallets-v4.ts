/**
 * Find "Sniper" Wallets - V4
 * Filters OUT arbers who bet at 95%+ odds
 *
 * Criteria:
 * - 85%+ win rate
 * - 30%+ avg return on wins
 * - 8+ resolved trades
 * - Average entry price < 0.90 (filters out 99% arbers)
 * - Active recently
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

async function main() {
  console.log('=== SNIPER WALLET FINDER V4 ===');
  console.log('Filtering OUT arbers (avg entry price < 90%)\n');

  // First get candidates from metrics, then verify entry prices from raw data
  const candidates = await getCandidatesFromMetrics();

  if (candidates.length === 0) {
    console.log('No candidates found in metrics table.');
    return;
  }

  console.log(`Found ${candidates.length} high win-rate candidates. Checking entry prices...\n`);

  const snipers: any[] = [];

  for (const c of candidates) {
    const entryStats = await getAverageEntryPrice(c.wallet);

    if (!entryStats) continue;

    // Filter: avg entry price must be < 0.90 (not arbing 99% outcomes)
    if (entryStats.avg_entry_price >= 0.90) {
      console.log(`❌ ${c.wallet.substring(0, 10)}... - ARBER (avg entry: ${(entryStats.avg_entry_price * 100).toFixed(1)}%)`);
      continue;
    }

    // Filter: must have reasonable entry prices (not all near 0 either)
    if (entryStats.avg_entry_price < 0.10) {
      console.log(`❌ ${c.wallet.substring(0, 10)}... - Longshot gambler (avg entry: ${(entryStats.avg_entry_price * 100).toFixed(1)}%)`);
      continue;
    }

    console.log(`✅ ${c.wallet.substring(0, 10)}... - SNIPER (avg entry: ${(entryStats.avg_entry_price * 100).toFixed(1)}%)`);

    snipers.push({
      ...c,
      avg_entry_price: entryStats.avg_entry_price,
      total_buys: entryStats.total_buys
    });
  }

  console.log('\n' + '='.repeat(100));
  console.log(`\n🎯 CONFIRMED SNIPERS: ${snipers.length} wallets\n`);

  if (snipers.length === 0) {
    console.log('No snipers found after filtering arbers.');
    return;
  }

  // Sort by win rate, then avg win
  snipers.sort((a, b) => {
    if (b.win_rate !== a.win_rate) return b.win_rate - a.win_rate;
    return b.avg_win_pct - a.avg_win_pct;
  });

  console.log('Wallet'.padEnd(44) + 'WinRate'.padStart(8) + 'AvgWin%'.padStart(10) + 'AvgEntry'.padStart(10) + 'Positions'.padStart(10) + 'PnL'.padStart(12));
  console.log('-'.repeat(94));

  for (const s of snipers) {
    console.log(
      s.wallet.padEnd(44) +
      `${(s.win_rate * 100).toFixed(1)}%`.padStart(8) +
      `${s.avg_win_pct.toFixed(1)}%`.padStart(10) +
      `${(s.avg_entry_price * 100).toFixed(1)}%`.padStart(10) +
      String(s.positions).padStart(10) +
      `$${s.realized_pnl.toFixed(0)}`.padStart(12)
    );
  }

  console.log('\n=== SNIPER DETAILS ===\n');

  for (let i = 0; i < snipers.length; i++) {
    const s = snipers[i];
    const ev = (s.win_rate * s.avg_win_pct / 100) - ((1 - s.win_rate) * (s.avg_loss_pct || 0) / 100);

    console.log(`${i + 1}. ${s.wallet}`);
    console.log(`   Win Rate:     ${(s.win_rate * 100).toFixed(1)}% (${s.positions} positions)`);
    console.log(`   Avg Entry:    ${(s.avg_entry_price * 100).toFixed(1)}% (not an arber ✓)`);
    console.log(`   Avg Win:      ${s.avg_win_pct.toFixed(1)}%`);
    console.log(`   Avg Loss:     ${(s.avg_loss_pct || 0).toFixed(1)}%`);
    console.log(`   Realized PnL: $${s.realized_pnl.toFixed(2)}`);
    console.log(`   EV per $1:    $${ev.toFixed(3)}`);
    console.log(`   At $10 bet:   $${(ev * 10).toFixed(2)} expected per trade`);
    console.log(`   At $20 bet:   $${(ev * 20).toFixed(2)} expected per trade`);
    console.log(`   Polymarket:   https://polymarket.com/profile/${s.wallet}`);
    console.log('');
  }

  // Output just the addresses
  console.log('=== SNIPER WALLET ADDRESSES ===\n');
  for (const s of snipers) {
    console.log(s.wallet);
  }
}

async function getCandidatesFromMetrics(): Promise<any[]> {
  const query = `
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
      win_rate >= 0.85
      AND avg_win_pct >= 30
      AND resolved_positions >= 8
      AND is_phantom = 0
    ORDER BY win_rate DESC, avg_win_pct DESC
    LIMIT 100
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  return await result.json() as any[];
}

async function getAverageEntryPrice(wallet: string): Promise<{ avg_entry_price: number; total_buys: number } | null> {
  // Calculate average entry price from BUY trades
  // Price = usdc_amount / token_amount (normalized)
  const query = `
    SELECT
      avg(usdc / nullIf(tokens, 0)) as avg_entry_price,
      count() as total_buys
    FROM (
      SELECT
        event_id,
        any(usdc_amount) / 1000000.0 as usdc,
        any(token_amount) / 1000000.0 as tokens
      FROM pm_trader_events_v2
      WHERE trader_wallet = '${wallet}'
        AND lower(side) = 'buy'
        AND is_deleted = 0
      GROUP BY event_id
    )
    WHERE tokens > 0 AND usdc > 0
  `;

  try {
    const result = await clickhouse.query({ query, format: 'JSONEachRow' });
    const data = await result.json() as any[];

    if (!data[0] || data[0].avg_entry_price === null) return null;

    return {
      avg_entry_price: parseFloat(data[0].avg_entry_price),
      total_buys: parseInt(data[0].total_buys)
    };
  } catch (err) {
    return null;
  }
}

main().catch(console.error);
