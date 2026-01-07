import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { clickhouse } from '../../lib/clickhouse/client';

const wallets = [
  { addr: '0x26437896ed9dfeb2f69765edcafe8fdceaab39ae', name: 'Latina', ui: 465721 },
  { addr: '0x07c846584cbf796aea720bb41e674e6734fc2696', name: '0x07c8', ui: 143095 },
  { addr: '0xc660ae71765d0d9eaf5fa8328c1c959841d2bd28', name: 'ChangoChango', ui: 37682 },
  { addr: '0xda5fff24aa9d889d6366da205029c73093102e9b', name: 'Kangtamqf', ui: -3452 },
  { addr: '0xcc3f8218a2dc3da410ba88b2f2883af7b18a5c6f', name: 'thepunterwhopunts', ui: 39746 },
  { addr: '0x1d56cdc458f373847e1e5ee31090c76abb747486', name: 'KPSingh', ui: 37801 },
];

async function check() {
  console.log('=== V17 vs UI Comparison ===');
  console.log('Wallet           | V17 Realized | UI Total | Diff');
  console.log('-'.repeat(60));

  for (const w of wallets) {
    const q = `SELECT realized_pnl_v17 FROM pm_smart_wallets_v2_active WHERE lower(wallet_address) = lower('${w.addr}')`;
    const r = await clickhouse.query({ query: q, format: 'JSONEachRow' });
    const data = (await r.json()) as any[];

    if (data.length > 0) {
      const v17 = Number(data[0].realized_pnl_v17);
      const diff = v17 - w.ui;
      const pct = w.ui !== 0 ? ((diff / Math.abs(w.ui)) * 100).toFixed(1) : 'N/A';
      console.log(
        w.name.padEnd(16) +
          ' | ' +
          ('$' + v17.toFixed(0)).padStart(12) +
          ' | ' +
          ('$' + w.ui).padStart(8) +
          ' | ' +
          ('$' + diff.toFixed(0)).padStart(8) +
          ' (' +
          pct +
          '%)'
      );
    } else {
      console.log(w.name.padEnd(16) + ' | NOT FOUND');
    }
  }
}

check().catch(console.error);
