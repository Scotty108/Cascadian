/**
 * Build detailed dossiers on top copy trading candidates
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../../lib/clickhouse/client';
import * as fs from 'fs';

interface WalletDossier {
  wallet: string;
  win_rate: number;
  realized_pnl: number;
  resolved_positions: number;
  first_trade: string;
  last_trade: string;
  days_active: number;
  total_trades: number;
  trades_per_day: number;
  volume_usd: number;
  avg_win_pct: number;
  avg_loss_pct: number;
  win_count: number;
  loss_count: number;
  expected_return_per_bet: number;
  return_per_day: number;
  annual_return: number;
}

const TOP_WALLETS = [
  '0x39fd7f7e5d025a0c442cb89a773f314f81807d31',
  '0x0bfb8009df6c46c1fdd79b65896cf224dc4526a7',
  '0x3b345c29419b69917d36af2c2be487a0f492cca8',
  '0x94df964127f1deddf1aa0f9624848f3ea4682dce',
  '0x82767c3976671a4a73e7752189f4494ec4e61204',
  '0x0f8a7eb19e45234bb81134d1f2af474b69fbfd8d',
  '0xa69b9933a2b7cdeeffaf29a119543f743c397b0c',
  '0x125eff052d1a4cc9c539f564c92d20697ebf992c',
  '0x528a616cc686eb4197e2ae686b65758cb980f94a',
  '0x524bc0719932851b9fe7755d527fd4af197249ac',
];

async function getAllMetrics(): Promise<Map<string, any>> {
  const walletList = TOP_WALLETS.map(w => `'${w.toLowerCase()}'`).join(',');

  const query = `
    SELECT
      lower(wallet_address) as wallet,
      win_rate,
      realized_pnl,
      volume_usd,
      total_trades,
      resolved_positions,
      win_count,
      loss_count,
      avg_win_pct,
      avg_loss_pct,
      first_trade,
      last_trade,
      days_active
    FROM pm_copy_trading_metrics_v1
    WHERE lower(wallet_address) IN (${walletList})
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as any[];

  const map = new Map<string, any>();
  for (const row of rows) {
    map.set(row.wallet.toLowerCase(), row);
  }
  return map;
}

async function main() {
  console.log('=== Building Wallet Dossiers ===\n');

  const metricsMap = await getAllMetrics();

  const dossiers: WalletDossier[] = [];

  for (const wallet of TOP_WALLETS) {
    const m = metricsMap.get(wallet.toLowerCase());
    if (!m) {
      console.log(`No data for ${wallet.slice(0, 10)}...`);
      continue;
    }

    // Calculate expected returns
    // Assume avg entry price of 55% based on verified Playwright data
    const avgEntryPrice = 0.55;
    const expectedReturnPerBet = m.win_rate / avgEntryPrice - 1;
    const avgResolutionDays = 7; // Markets resolve in ~7 days on average
    const returnPerDay = expectedReturnPerBet / avgResolutionDays;
    const annualReturn = returnPerDay * 365;

    dossiers.push({
      wallet,
      win_rate: m.win_rate,
      realized_pnl: m.realized_pnl,
      resolved_positions: m.resolved_positions,
      first_trade: m.first_trade,
      last_trade: m.last_trade,
      days_active: m.days_active,
      total_trades: m.total_trades,
      trades_per_day: m.total_trades / Math.max(m.days_active, 1),
      volume_usd: m.volume_usd,
      avg_win_pct: m.avg_win_pct,
      avg_loss_pct: m.avg_loss_pct,
      win_count: m.win_count,
      loss_count: m.loss_count,
      expected_return_per_bet: expectedReturnPerBet,
      return_per_day: returnPerDay,
      annual_return: annualReturn,
    });
  }

  // Print detailed dossiers
  console.log('\n' + '='.repeat(90));
  console.log('  COPY TRADING CANDIDATE DOSSIERS');
  console.log('='.repeat(90));

  for (let i = 0; i < dossiers.length; i++) {
    const d = dossiers[i];
    console.log(`\n${'─'.repeat(90)}`);
    console.log(`  #${i + 1} | ${d.wallet}`);
    console.log(`${'─'.repeat(90)}`);
    console.log(`  TRACK RECORD`);
    console.log(`    Win Rate:        ${(d.win_rate * 100).toFixed(1)}% (${d.win_count}W / ${d.loss_count}L)`);
    console.log(`    Realized PnL:    $${d.realized_pnl.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
    console.log(`    Positions:       ${d.resolved_positions} resolved`);
    console.log(`    Total Volume:    $${d.volume_usd.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
    console.log(`  `);
    console.log(`  ACTIVITY`);
    console.log(`    First Trade:     ${d.first_trade}`);
    console.log(`    Last Trade:      ${d.last_trade}`);
    console.log(`    Days Active:     ${d.days_active}`);
    console.log(`    Trades/Day:      ${d.trades_per_day.toFixed(1)}`);
    console.log(`  `);
    console.log(`  RISK PROFILE`);
    console.log(`    Avg Win:         +${(d.avg_win_pct * 100).toFixed(1)}%`);
    console.log(`    Avg Loss:        -${(d.avg_loss_pct * 100).toFixed(1)}%`);
    console.log(`    Win/Loss Ratio:  ${(d.avg_win_pct / Math.max(d.avg_loss_pct, 0.01)).toFixed(2)}x`);
    console.log(`  `);
    console.log(`  EXPECTED RETURNS (if copied with $1 bets, 55% avg entry)`);
    console.log(`    Per Bet:         +${(d.expected_return_per_bet * 100).toFixed(1)}%`);
    console.log(`    Per Day:         +${(d.return_per_day * 100).toFixed(2)}%`);
    console.log(`    Per Month:       +${(d.return_per_day * 30 * 100).toFixed(1)}%`);
    console.log(`    Per Year:        +${(d.annual_return * 100).toFixed(0)}% (${d.annual_return.toFixed(1)}x)`);
  }

  // Save to file
  const outputPath = '/Users/scotty/Projects/Cascadian-app/scripts/experimental/results/dossiers.json';
  fs.writeFileSync(outputPath, JSON.stringify({
    generated: new Date().toISOString(),
    assumptions: {
      avg_entry_price: 0.55,
      avg_resolution_days: 7,
    },
    count: dossiers.length,
    dossiers,
  }, null, 2));

  console.log(`\n\nDossiers saved to: ${outputPath}`);

  // Summary table
  console.log('\n\n' + '='.repeat(110));
  console.log('  QUICK COMPARISON TABLE');
  console.log('='.repeat(110));
  console.log('  Rank │ Wallet                                       │ WinRate │    PnL    │ Pos │ Ret/Bet │ Annual');
  console.log('─'.repeat(110));

  for (let i = 0; i < dossiers.length; i++) {
    const d = dossiers[i];
    const rank = String(i + 1).padStart(4);
    const wr = (d.win_rate * 100).toFixed(1) + '%';
    const pnl = '$' + d.realized_pnl.toLocaleString(undefined, { maximumFractionDigits: 0 });
    const pos = String(d.resolved_positions);
    const retBet = '+' + (d.expected_return_per_bet * 100).toFixed(1) + '%';
    const annual = '+' + (d.annual_return * 100).toFixed(0) + '%';

    console.log(`  ${rank} │ ${d.wallet} │ ${wr.padStart(7)} │ ${pnl.padStart(9)} │ ${pos.padStart(3)} │ ${retBet.padStart(7)} │ ${annual.padStart(6)}`);
  }
  console.log('='.repeat(110));

  // Recommendation
  console.log('\n\n' + '='.repeat(90));
  console.log('  RECOMMENDATION');
  console.log('='.repeat(90));
  console.log(`
  TOP PICK: #1 0x39fd7f7e5d025a0c442cb89a773f314f81807d31

  WHY:
  - Highest win rate (79.7%) among candidates
  - 290 resolved positions = strong statistical significance
  - Verified entry prices range from 7-90 cents (copyable with 12s delay)
  - Strategy: "Will X say Y" prediction markets
  - Expected +45% return per bet, +6% per day

  RUNNER-UPS:
  - #4 and #10 have highest absolute PnL ($12K and $31K)
  - #2 and #3 have high win rates but smaller sample sizes

  COPY STRATEGY:
  - Start with $1 per bet to validate returns
  - Mirror all positions from top 3-5 wallets for diversification
  - Monitor for 30 days before increasing bet size
  `);
}

main().catch(console.error);
