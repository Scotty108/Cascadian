import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createV17Engine } from '../../lib/pnl/uiActivityEngineV17';

const wallets = [
  { addr: '0x26437896ed9dfeb2f69765edcafe8fdceaab39ae', ui: 465891, ccr1: 1189919 },
  { addr: '0x07c846584cbf796aea720bb41e674e6734fc2696', ui: 141047, ccr1: 290989 },
  { addr: '0xc660ae71765d0d9eaf5fa8328c1c959841d2bd28', ui: 37600, ccr1: 117243 },
  { addr: '0xda5fff24aa9d889d6366da205029c73093102e9b', ui: -3452, ccr1: 113150 },
  { addr: '0x4d9d8cb232e2afa89a2ecfd148ecbea6a94ee6c3', ui: 29581, ccr1: 70071 },
];

async function testAll() {
  const engine = createV17Engine();

  console.log('Wallet                | V17 Realized | UI PnL    | CCR-v1    | V17 vs UI');
  console.log('-'.repeat(85));

  for (const w of wallets) {
    const pnl = await engine.compute(w.addr);
    const v17 = pnl.realized_pnl;
    const diff = ((v17 - w.ui) / Math.abs(w.ui) * 100).toFixed(0);
    const shortAddr = w.addr.slice(0, 10) + '...' + w.addr.slice(-4);

    console.log(
      `${shortAddr} | ` +
      `$${v17.toFixed(0).padStart(10)} | ` +
      `$${w.ui.toString().padStart(7)} | ` +
      `$${w.ccr1.toString().padStart(7)} | ` +
      `${diff}% diff`
    );
  }
}

testAll().catch(console.error);
