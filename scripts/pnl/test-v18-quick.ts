/**
 * Quick V18 test on a few wallets
 */
import { createV18Engine } from '../../lib/pnl/uiActivityEngineV18';

const wallets = [
  '0xaabf2ad631cd0ada5d1fce9bb7bef5f13ee57c0f',
  '0xdce52e5d0061f2dc09ded33a67f780a2af76744d',
  '0xb4b7d33779c66747b0a6c7863c789ede577584c6',
];

async function test() {
  const engine = createV18Engine();

  console.log('Testing V18 Engine on 3 wallets\n');

  for (const wallet of wallets) {
    const result = await engine.compute(wallet);
    console.log('Wallet: ' + wallet.substring(0, 14) + '...');
    console.log('  V18 PnL:    $' + result.realized_pnl.toFixed(2));
    console.log('  Positions:  ' + result.positions_count);
    console.log('  URL: https://polymarket.com/profile/' + wallet);
    console.log('');
  }

  console.log('Go check these URLs and tell me the UI PnL for each!');
}

test().catch(console.error);
