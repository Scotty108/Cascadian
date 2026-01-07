/**
 * Test V17 canonical engine on test wallets
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createV17Engine } from '../../lib/pnl/uiActivityEngineV17';

const testWallets = [
  { addr: '0x26437896ed9dfeb2f69765edcafe8fdceaab39ae', name: 'Latina', ui: 465721 },
  { addr: '0x07c846584cbf796aea720bb41e674e6734fc2696', name: '0x07c8', ui: 143095 },
  { addr: '0xc660ae71765d0d9eaf5fa8328c1c959841d2bd28', name: 'ChangoChango', ui: 37682 },
  { addr: '0xda5fff24aa9d889d6366da205029c73093102e9b', name: 'Kangtamqf', ui: -3452 },
  { addr: '0xcc3f8218a2dc3da410ba88b2f2883af7b18a5c6f', name: 'thepunterwhopunts', ui: 39746 },
  { addr: '0x1d56cdc458f373847e1e5ee31090c76abb747486', name: 'KPSingh', ui: 37801 },
];

async function main() {
  console.log('='.repeat(90));
  console.log('V17 CANONICAL ENGINE RESULTS');
  console.log('='.repeat(90));
  console.log('');
  console.log('Wallet           | Realized     | Unrealized   | Total        | UI Total   | Error');
  console.log('-'.repeat(90));

  const engine = createV17Engine();

  for (const w of testWallets) {
    try {
      const metrics = await engine.compute(w.addr);
      const errorPct = w.ui !== 0 ? ((metrics.total_pnl - w.ui) / Math.abs(w.ui) * 100) : 0;
      const errorStr = (errorPct >= 0 ? '+' : '') + errorPct.toFixed(0) + '%';

      console.log(
        `${w.name.padEnd(16)} | $${metrics.realized_pnl.toFixed(0).padStart(10)} | $${metrics.unrealized_pnl.toFixed(0).padStart(10)} | $${metrics.total_pnl.toFixed(0).padStart(10)} | $${String(w.ui).padStart(8)} | ${errorStr.padStart(7)}`
      );
    } catch (e: any) {
      console.log(`${w.name.padEnd(16)} | ERROR: ${e.message.slice(0, 60)}`);
    }
  }

  console.log('-'.repeat(90));
}

main().catch(console.error);
