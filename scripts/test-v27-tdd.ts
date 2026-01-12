/**
 * V27 TDD Test Suite
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getWalletPnLV27 } from '../lib/pnl/pnlEngineV27';

const TEST_WALLETS = [
  { name: 'original', wallet: '0xf918977ef9d3f101385eda508621d5f835fa9052' },
  { name: 'maker_heavy_1', wallet: '0x105a54a721d475a5d2faaf7902c55475758ba63c' },
  { name: 'taker_heavy_1', wallet: '0x3dc25ab9e49fdcd463de887d9d77ad35703f22cc' },
  { name: 'taker_heavy_2', wallet: '0x94fabfc86594fffbf76996e2f66e5e19675a8164' },
  { name: 'mixed_1', wallet: '0x583537b26372c4527ff0eb9766da22fb6ab038cd' },
  { name: 'spot_1', wallet: '0x969fdceba722e381776044c3b14ef1729511ad37' },
  { name: 'spot_2', wallet: '0xee81df87bc51eebc6a050bb70638c5e56063ef68' },
  { name: 'spot_3', wallet: '0x0060a1843fe53a54e9fdc403005da0b1ead44cc4' },
  { name: 'spot_4', wallet: '0x7412897ad6ea781b68e2ac2f8cf3fad3502f85d0' },
  { name: 'spot_5', wallet: '0x8d5bebb6dcf733f12200155c547cb9fa8d159069' },
  { name: 'spot_6', wallet: '0xf380061e3ef5fa4d46341b269f75d57d6dc6c8b0' },
  { name: 'spot_7', wallet: '0x045b5748b78efe2988e4574fe362cf91a3ea1d11' },
  { name: 'spot_8', wallet: '0xfd9497fe764af214076458e9651db9f39febb3bf' },
  { name: 'spot_9', wallet: '0x61341f266a614cc511d2f606542b0774688998b0' },
  { name: 'spot_10', wallet: '0x8302a1109f398b6003990a325228315993242815' },
];

async function fetchApiPnl(wallet: string): Promise<number | null> {
  try {
    const url = 'https://user-pnl-api.polymarket.com/user-pnl?user_address=' + wallet.toLowerCase();
    const response = await fetch(url);
    if (response.ok) {
      const data = (await response.json()) as Array<{ t: number; p: number }>;
      if (data && data.length > 0) return data[data.length - 1].p;
    }
  } catch {}
  return null;
}

async function runTests() {
  console.log('=== V27 CASHFLOW ENGINE TEST SUITE ===\n');
  console.log('Name           | V27 Local    | API (truth)  | Diff      | Open | CashIn   | CashOut  | Status');
  console.log('---------------|--------------|--------------|-----------|------|----------|----------|-------');

  let passed = 0;
  let failed = 0;
  const failing: string[] = [];

  for (const w of TEST_WALLETS) {
    try {
      const [v27Result, apiPnl] = await Promise.all([
        getWalletPnLV27(w.wallet),
        fetchApiPnl(w.wallet)
      ]);

      const v27Total = v27Result.totalPnl;
      const apiTotal = apiPnl || 0;
      const absDiff = Math.abs(v27Total - apiTotal);
      const pctDiff = apiTotal !== 0 ? (absDiff / Math.abs(apiTotal)) * 100 : (v27Total === 0 ? 0 : 999);
      const match = pctDiff < 10 || absDiff < 5;

      if (match) {
        passed++;
      } else {
        failed++;
        failing.push(w.name + ': V27=' + v27Total.toFixed(0) + ' API=' + apiTotal.toFixed(0));
      }

      const status = match ? 'PASS' : 'FAIL';
      const diffStr = pctDiff < 999 ? pctDiff.toFixed(1) + '%' : 'N/A';
      console.log(
        w.name.padEnd(14) + ' | $' +
        v27Total.toFixed(0).padStart(11) + ' | $' +
        apiTotal.toFixed(0).padStart(11) + ' | ' +
        diffStr.padStart(9) + ' | ' +
        v27Result.openPositionCount.toString().padStart(4) + ' | $' +
        v27Result.cashIn.toFixed(0).padStart(7) + ' | $' +
        v27Result.cashOut.toFixed(0).padStart(7) + ' | ' +
        status
      );
    } catch (error) {
      failed++;
      console.log(w.name.padEnd(14) + ' | ERROR: ' + (error as Error).message);
    }
  }

  console.log('\n=== SUMMARY ===');
  console.log('Passed: ' + passed + '/15');
  console.log('Failed: ' + failed + '/15');
  if (failing.length > 0) {
    console.log('\nFailing:');
    failing.forEach(f => console.log('  - ' + f));
  }
}

runTests().catch(console.error);
