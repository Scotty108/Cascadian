#!/usr/bin/env npx tsx
import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  request_timeout: 300000,
});

const WALLETS = [
  { address: '0x4ce73141dbfce41e65db3723e31059a730f0abad', polymarket_pnl: 332563 },
  { address: '0xb48ef6deecd526c0974c35e1f7b5c3bbd12fa144', polymarket_pnl: 114087 },
  { address: '0x1f0a343513aa6060488fabe96960e6d1e177f7aa', polymarket_pnl: 101576 },
  { address: '0x06dcaa14f57d8a0573f5dc5940565e6de667af59', polymarket_pnl: 216892 },
  { address: '0xa9b44dca52ed35e59ac2a6f49d1203b8155464ed', polymarket_pnl: 211748 },
  { address: '0x8f42ae0a01c0383c7ca8bd060b86a645ee74b88f', polymarket_pnl: 163277 },
  { address: '0xe542afd3881c4c330ba0ebbb603bb470b2ba0a37', polymarket_pnl: 73231 },
  { address: '0x12d6cccfc7470a3f4bafc53599a4779cbf2cf2a8', polymarket_pnl: 150023 },
  { address: '0x7c156bb0dbb44dcb7387a78778e0da313bf3c9db', polymarket_pnl: 114134 },
  { address: '0xc02147dee42356b7a4edbb1c35ac4ffa95f61fa8', polymarket_pnl: 135153 },
  { address: '0x662244931c392df70bd064fa91f838eea0bfd7a9', polymarket_pnl: 131523 },
  { address: '0x2e0b70d482e6b389e81dea528be57d825dd48070', polymarket_pnl: 152389 },
];

async function main() {
  console.log('\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('POLYMARKET COMPARISON');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  const results: any[] = [];

  for (const wallet of WALLETS) {
    const result = await ch.query({
      query: `
        SELECT
          wallet,
          trading_realized_pnl,
          redemption_pnl,
          total_realized_pnl,
          unrealized_pnl,
          total_pnl,
          closed_positions,
          open_positions,
          redeemed_positions
        FROM cascadian_clean.vw_wallet_pnl_unified
        WHERE lower(wallet) = lower('${wallet.address}')
        LIMIT 1
      `,
      format: 'JSONEachRow',
    });

    const data = await result.json<any[]>();

    if (data.length > 0) {
      results.push({
        address: wallet.address.substring(0, 12) + '...',
        polymarket: wallet.polymarket_pnl,
        our_trading: parseFloat(data[0].trading_realized_pnl),
        our_unrealized: parseFloat(data[0].unrealized_pnl),
        our_redemption: parseFloat(data[0].redemption_pnl),
        our_total: parseFloat(data[0].total_pnl),
        closed: data[0].closed_positions,
        open: data[0].open_positions,
      });
    }
  }

  // Print table
  console.log('┌────────────────┬──────────────┬──────────────┬──────────────┬──────────────┬────────┬────────┐');
  console.log('│ Wallet         │ Polymarket   │ Our Trading  │ Our Unreal   │ Our Total    │ Closed │ Open   │');
  console.log('├────────────────┼──────────────┼──────────────┼──────────────┼──────────────┼────────┼────────┤');

  for (const r of results) {
    const poly = `$${r.polymarket.toLocaleString()}`;
    const trading = `$${r.our_trading.toFixed(0)}`;
    const unreal = `$${r.our_unrealized.toFixed(0)}`;
    const total = `$${r.our_total.toFixed(0)}`;

    console.log(
      `│ ${r.address.padEnd(14)} │ ${poly.padStart(12)} │ ${trading.padStart(12)} │ ${unreal.padStart(12)} │ ${total.padStart(12)} │ ${String(r.closed).padStart(6)} │ ${String(r.open).padStart(6)} │`
    );
  }

  console.log('└────────────────┴──────────────┴──────────────┴──────────────┴──────────────┴────────┴────────┘');
  console.log('\n');

  // Calculate differences
  console.log('ANALYSIS:');
  console.log('─'.repeat(80));

  const totalPolymarket = results.reduce((sum, r) => sum + r.polymarket, 0);
  const totalOurTrading = results.reduce((sum, r) => sum + r.our_trading, 0);
  const totalOurTotal = results.reduce((sum, r) => sum + r.our_total, 0);

  console.log(`Total Polymarket P&L:  $${totalPolymarket.toLocaleString()}`);
  console.log(`Total Our Trading P&L: $${totalOurTrading.toLocaleString()}`);
  console.log(`Total Our Total P&L:   $${totalOurTotal.toLocaleString()}`);
  console.log('');

  const avgClosed = results.reduce((sum, r) => sum + r.closed, 0) / results.length;
  const avgOpen = results.reduce((sum, r) => sum + r.open, 0) / results.length;

  console.log(`Average closed positions: ${avgClosed.toFixed(1)}`);
  console.log(`Average open positions:   ${avgOpen.toFixed(1)}`);
  console.log('');

  // Check specific issues
  const walletsWithNoTrading = results.filter(r => r.our_trading === 0);
  console.log(`Wallets with $0 trading P&L: ${walletsWithNoTrading.length} / ${results.length}`);

  const walletsWithNegativeUnreal = results.filter(r => r.our_unrealized < -1000);
  console.log(`Wallets with large negative unrealized: ${walletsWithNegativeUnreal.length} / ${results.length}`);
  console.log('');

  console.log('HYPOTHESIS:');
  console.log('─'.repeat(80));
  console.log('If most wallets have $0 trading P&L but large negative unrealized,');
  console.log('it suggests positions are marked as OPEN when they should be CLOSED.');
  console.log('');
  console.log('Polymarket may be calculating P&L on every sell trade,');
  console.log('not waiting for position to fully close to zero shares.');
  console.log('');

  await ch.close();
}

main().catch(console.error);
