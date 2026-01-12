/**
 * Test V42 PnL engine against V1 and Polymarket API
 * Ensure maker-heavy wallets don't regress
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getWalletPnLV1 } from '../lib/pnl/pnlEngineV1';
import { getWalletPnLV42 } from '../lib/pnl/pnlEngineV42';

const COHORT = {
  // PASSING wallets (should NOT regress)
  passing: [
    { wallet: '0x105a54a721d475a5d2faaf7902c55475758ba63c', name: 'maker_heavy_1' },
    { wallet: '0x3dc25ab9e49fdcd463de887d9d77ad35703f22cc', name: 'taker_heavy_1' },
    { wallet: '0xee81df87bc51eebc6a050bb70638c5e56063ef68', name: 'mixed_1' },
    { wallet: '0x7412897ad6ea781b68e2ac2f8cf3fad3502f85d0', name: 'mixed_2' },
  ],
  // FAILING wallets (hoping to improve)
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

function errorPct(calc: number, actual: number): number {
  if (Math.abs(actual) < 0.01) return 0;
  return (Math.abs(calc - actual) / Math.abs(actual)) * 100;
}

function status(errPct: number): string {
  if (errPct < 10) return '✅';
  if (errPct < 50) return '⚠️';
  return '❌';
}

async function main() {
  console.log('=== V42 vs V1 Benchmark ===\n');
  console.log('Testing that V42 does not regress V1 passing wallets\n');

  // Test passing wallets
  console.log('PASSING wallets (must not regress):');
  let passingRegressed = false;

  for (const { wallet, name } of COHORT.passing) {
    const [v1, v42, pmPnl] = await Promise.all([
      getWalletPnLV1(wallet),
      getWalletPnLV42(wallet),
      getPolymarketPnL(wallet),
    ]);

    const v1Err = pmPnl !== null ? errorPct(v1.total, pmPnl) : 0;
    const v42Err = pmPnl !== null ? errorPct(v42.total, pmPnl) : 0;
    const regressed = v42Err > v1Err + 1; // Allow 1% margin

    if (regressed) passingRegressed = true;

    console.log(
      `  ${regressed ? '🔴' : '✅'} ${name}: ` +
        `V1=$${v1.total.toFixed(2)} (${v1Err.toFixed(1)}%), ` +
        `V42=$${v42.total.toFixed(2)} (${v42Err.toFixed(1)}%), ` +
        `PM=$${pmPnl?.toFixed(2) ?? 'N/A'}`
    );
  }

  // Test failing wallets
  console.log('\nFAILING wallets (hoping to improve):');
  let failingImproved = 0;

  for (const { wallet, name } of COHORT.failing) {
    const [v1, v42, pmPnl] = await Promise.all([
      getWalletPnLV1(wallet),
      getWalletPnLV42(wallet),
      getPolymarketPnL(wallet),
    ]);

    const v1Err = pmPnl !== null ? errorPct(v1.total, pmPnl) : 0;
    const v42Err = pmPnl !== null ? errorPct(v42.total, pmPnl) : 0;
    const improved = v42Err < v1Err - 5; // Must improve by at least 5%

    if (improved) failingImproved++;

    console.log(
      `  ${improved ? '🟢' : v42Err <= v1Err ? '⚪' : '🔴'} ${name}: ` +
        `V1=$${v1.total.toFixed(2)} (${v1Err.toFixed(1)}%), ` +
        `V42=$${v42.total.toFixed(2)} (${v42Err.toFixed(1)}%), ` +
        `PM=$${pmPnl?.toFixed(2) ?? 'N/A'}`
    );
  }

  // Summary
  console.log('\n=== Summary ===');
  console.log(`Passing wallets regressed: ${passingRegressed ? '❌ YES' : '✅ NO'}`);
  console.log(`Failing wallets improved: ${failingImproved}/${COHORT.failing.length}`);

  if (passingRegressed) {
    console.log('\n⛔ V42 FAILED: Maker-heavy wallets regressed. Do not use.');
  } else if (failingImproved > 0) {
    console.log('\n✅ V42 PASSED: No regression, some improvements.');
  } else {
    console.log('\n⚪ V42 NEUTRAL: No regression, no improvements either.');
  }
}

main().catch(console.error);
