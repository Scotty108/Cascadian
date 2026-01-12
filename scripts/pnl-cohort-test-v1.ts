/**
 * Test V1 PnL engine on the known cohort
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getWalletPnLV1 } from '../lib/pnl/pnlEngineV1';

const COHORT = {
  // PASSING wallets (should be accurate)
  passing: [
    { wallet: '0x105a54a721d475a5d2faaf7902c55475758ba63c', name: 'maker_heavy_1' },
    { wallet: '0x3dc25ab9e49fdcd463de887d9d77ad35703f22cc', name: 'taker_heavy_1' },
    { wallet: '0xee81df87bc51eebc6a050bb70638c5e56063ef68', name: 'mixed_1' },
    { wallet: '0x7412897ad6ea781b68e2ac2f8cf3fad3502f85d0', name: 'mixed_2' },
  ],
  // FAILING wallets (expected to be inaccurate)
  failing: [
    { wallet: '0x0060a1843fe53a54e9fdc403005da0b1ead44cc4', name: 'spot_3' },
    { wallet: '0xf380061e3ef5fa4d46341b269f75d57d6dc6c8b0', name: 'spot_6' },
    { wallet: '0x0015c5a76490d303e837d79dd5cf6a3825e4d5b0', name: 'overnight_test' },
  ],
};

async function getPolymarketPnL(wallet: string): Promise<number | null> {
  try {
    const res = await fetch(`https://user-pnl-api.polymarket.com/user-pnl?user_address=${wallet}`);
    const data = await res.json();
    return Array.isArray(data) && data.length > 0 ? data[data.length - 1].p : null;
  } catch {
    return null;
  }
}

async function main() {
  console.log('=== V1 PnL Cohort Test ===\n');

  const results: Array<{
    name: string;
    type: string;
    v1Pnl: number;
    pmPnl: number | null;
    error: number;
    errorPct: number;
    status: string;
  }> = [];

  // Test passing wallets
  console.log('PASSING wallets:');
  for (const { wallet, name } of COHORT.passing) {
    const v1 = await getWalletPnLV1(wallet);
    const pmPnl = await getPolymarketPnL(wallet);

    const error = pmPnl !== null ? Math.abs(v1.total - pmPnl) : 0;
    const errorPct = pmPnl !== null && Math.abs(pmPnl) > 0 ? (error / Math.abs(pmPnl)) * 100 : 0;
    const status = errorPct < 10 ? '✅' : errorPct < 50 ? '⚠️' : '❌';

    results.push({ name, type: 'passing', v1Pnl: v1.total, pmPnl, error, errorPct, status });
    console.log(`  ${status} ${name}: V1=$${v1.total.toFixed(2)}, PM=${pmPnl !== null ? '$' + pmPnl.toFixed(2) : 'N/A'}, Err=${errorPct.toFixed(1)}%`);
  }

  // Test failing wallets
  console.log('\nFAILING wallets:');
  for (const { wallet, name } of COHORT.failing) {
    const v1 = await getWalletPnLV1(wallet);
    const pmPnl = await getPolymarketPnL(wallet);

    const error = pmPnl !== null ? Math.abs(v1.total - pmPnl) : 0;
    const errorPct = pmPnl !== null && Math.abs(pmPnl) > 0 ? (error / Math.abs(pmPnl)) * 100 : 0;
    const status = errorPct < 10 ? '✅' : errorPct < 50 ? '⚠️' : '❌';

    results.push({ name, type: 'failing', v1Pnl: v1.total, pmPnl, error, errorPct, status });
    console.log(`  ${status} ${name}: V1=$${v1.total.toFixed(2)}, PM=${pmPnl !== null ? '$' + pmPnl.toFixed(2) : 'N/A'}, Err=${errorPct.toFixed(1)}%`);
  }

  // Summary
  const passingAccurate = results.filter(r => r.type === 'passing' && r.errorPct < 10).length;
  const failingAccurate = results.filter(r => r.type === 'failing' && r.errorPct < 10).length;

  console.log('\n=== Summary ===');
  console.log(`Passing wallets: ${passingAccurate}/${COHORT.passing.length} accurate (<10% error)`);
  console.log(`Failing wallets: ${failingAccurate}/${COHORT.failing.length} accurate (<10% error)`);
  console.log(`Overall: ${passingAccurate + failingAccurate}/${results.length} accurate`);
}

main().catch(console.error);
