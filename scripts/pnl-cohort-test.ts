/**
 * PnL Engine Stratified Cohort Test
 *
 * Tests top 5 candidate engines (V17, V20, V22, V25, V1) against:
 * - CLOB-only wallets (no NegRisk)
 * - NegRisk-heavy wallets
 * - Split-heavy wallets
 * - Redemption-heavy wallets
 * - Maker-heavy wallets
 *
 * Outputs three metrics per wallet:
 * 1. realized_cash_pnl - Pure cash in/out
 * 2. realized_assumed_redeemed_pnl - Cash + assumed redemptions at resolution
 * 3. total_pnl_mtm - Total including unrealized at mark
 *
 * @author Claude Code
 * @created 2026-01-10
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

// Stratified cohort - 30 wallets across 5 categories
const COHORT = {
  // CLOB-only (no NegRisk conversions, no CTF splits)
  CLOB_ONLY: [
    '0x204f72f35326db932158cba6adff0b9a1da95e14',  // High volume CLOB
    '0x16b29c50f2439faf627209b2ac0c7bbddaa8a881',  // Mid volume
    '0xb744f56635b537e859152d14b022af5afe485210',  // Regular trader
    '0x53757615de1c42b83f893b79d4241a009dc2aeea',  // High trade count
    '0xed107a85a4585a381e48c7f7ca4144909e7dd2e5',  // Consistent trader
    '0x751a2b86cab503496efd325c8344e10159349ea1',  // Active market maker
  ],

  // NegRisk-heavy (high conversion count)
  NEGRISK_HEAVY: [
    '0xe8dd7741ccb12350957ec71e9ee332e0d1e6ec86',  // 205K conversions
    '0x63d43bbb87f85af03b8f2f9e2fad7b54334fa2f1',  // 202K conversions
    '0xd218e474776403a330142299f7796e8ba32eb5c9',  // 127K conversions
    '0xb7d54bf1d0a362beb916d9cb58a04c41d67e0789',  // 44K conversions
    '0x5f390e4b7d6f06d6756a6c92afdbf7b3176aa78c',  // 36K conversions
    '0x4ce73141dbfce41e65db3723e31059a730f0abad',  // 32K conversions
  ],

  // Split-heavy (user wallets with many splits, excluding contracts)
  SPLIT_HEAVY: [
    '0x57ea53b3cf624d1030b2d5f62ca93f249adc95ba',  // 131K splits
    '0x4c0170c18fd89b2a05eb5e0c2761930583b2ebf4',  // 78K splits
    '0xef1294d01dfaa8a5b10d42e8b7b707f7fc986d04',  // 38K splits
    '0x8c2fa256c8690a6651d4db04ee7c1d08031564fa',  // 38K splits
    '0x5b228b7e4642d3a745fd380b5f043b838e38c8bf',  // 36K splits
    '0x45373c80906b6d1d3c66de6e2dde4d30709c239b',  // 24K splits
  ],

  // Redemption-heavy (many resolved conditions)
  REDEMPTION_HEAVY: [
    '0x35c0732e069faea97c11aa9cab045562eaab81d6',  // 58K resolved conditions
    '0xf8b720c031833a879ffe538c7e040fad542114de',  // 47K resolved
    '0x50b977391c4b3dd88b0a0bef03c3434fe4284298',  // 46K resolved
    '0x1ff49fdcb6685c94059b65620f43a683be0ce7a5',  // 44K resolved
    '0x4ffe49ba2a4cae123536a8af4fda48faeb609f71',  // 41K resolved
    '0xa9650fe4301f45e7f090ada7252f9c1268183565',  // 38K resolved
  ],

  // Maker-heavy (high maker ratio)
  MAKER_HEAVY: [
    '0x6031b6eed1c97e853c6e0f03ad3ce3529351f96d',  // 84% maker
    '0x51373c6b56e4a38bf97c301efbff840fc8451556',  // 84% maker
    '0xf0b0ef1d6320c6be896b4c9c54dd74407e7f8cab',  // 88% maker
    '0x5f4d4927ea3ca72c9735f56778cfbb046c186be0',  // 91% maker
    '0x23cb796cf58bfa12352f0164f479deedbd50658e',  // 96% maker
    '0x2d27e4d20f3b8a2ee3bc861d9b83752f338676d8',  // 99% maker
  ],
};

// Get all wallets as flat array
const ALL_WALLETS = Object.values(COHORT).flat();

interface PnLResult {
  wallet: string;
  realized_cash_pnl: number;
  realized_assumed_redeemed_pnl: number;
  total_pnl_mtm: number;
  source: string;
  error?: string;
}

interface EngineResult {
  engine: string;
  results: PnLResult[];
  duration_ms: number;
}

// Fetch Polymarket API as ground truth
async function fetchPolymarketPnL(wallet: string): Promise<PnLResult> {
  try {
    const res = await fetch(`https://data-api.polymarket.com/value?user=${wallet}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return {
      wallet,
      realized_cash_pnl: data.realizedPnL || 0,
      realized_assumed_redeemed_pnl: data.realizedPnL || 0,  // API doesn't separate these
      total_pnl_mtm: data.totalPnL || data.realizedPnL || 0,
      source: 'polymarket-api',
    };
  } catch (err) {
    return {
      wallet,
      realized_cash_pnl: 0,
      realized_assumed_redeemed_pnl: 0,
      total_pnl_mtm: 0,
      source: 'polymarket-api',
      error: String(err),
    };
  }
}

async function runPolymarketBaseline(): Promise<EngineResult> {
  console.log('\n📊 Running Polymarket API baseline...');
  const start = Date.now();
  const results: PnLResult[] = [];

  for (let i = 0; i < ALL_WALLETS.length; i++) {
    const wallet = ALL_WALLETS[i];
    const result = await fetchPolymarketPnL(wallet);
    results.push(result);

    if ((i + 1) % 5 === 0) {
      console.log(`  Progress: ${i + 1}/${ALL_WALLETS.length}`);
    }

    // Rate limit
    await new Promise(r => setTimeout(r, 200));
  }

  return {
    engine: 'polymarket-api',
    results,
    duration_ms: Date.now() - start,
  };
}

// Import local engines dynamically
async function runLocalEngine(engineName: string, getWalletPnL: (w: string) => Promise<any>): Promise<EngineResult> {
  console.log(`\n🔧 Running ${engineName}...`);
  const start = Date.now();
  const results: PnLResult[] = [];

  for (let i = 0; i < ALL_WALLETS.length; i++) {
    const wallet = ALL_WALLETS[i];
    try {
      const raw = await getWalletPnL(wallet);
      results.push({
        wallet,
        realized_cash_pnl: raw.realizedPnl || raw.realized_pnl || 0,
        realized_assumed_redeemed_pnl: raw.syntheticPnl || raw.realizedPnl || 0,
        total_pnl_mtm: raw.totalPnl || raw.total_pnl || 0,
        source: engineName,
      });
    } catch (err) {
      results.push({
        wallet,
        realized_cash_pnl: 0,
        realized_assumed_redeemed_pnl: 0,
        total_pnl_mtm: 0,
        source: engineName,
        error: String(err),
      });
    }

    if ((i + 1) % 5 === 0) {
      console.log(`  Progress: ${i + 1}/${ALL_WALLETS.length}`);
    }
  }

  return {
    engine: engineName,
    results,
    duration_ms: Date.now() - start,
  };
}

function compareResults(baseline: EngineResult, engines: EngineResult[]): void {
  console.log('\n' + '='.repeat(100));
  console.log('📈 COHORT COMPARISON RESULTS');
  console.log('='.repeat(100));

  // Per-cohort accuracy
  for (const [cohortName, wallets] of Object.entries(COHORT)) {
    console.log(`\n## ${cohortName} (${wallets.length} wallets)`);
    console.log('-'.repeat(80));

    for (const engine of engines) {
      let matchCount = 0;
      let totalError = 0;

      for (const wallet of wallets) {
        const baselineResult = baseline.results.find(r => r.wallet === wallet);
        const engineResult = engine.results.find(r => r.wallet === wallet);

        if (!baselineResult || !engineResult || baselineResult.error || engineResult.error) continue;

        const diff = Math.abs(baselineResult.total_pnl_mtm - engineResult.total_pnl_mtm);
        const threshold = Math.max(1, Math.abs(baselineResult.total_pnl_mtm) * 0.05); // 5% tolerance

        if (diff < threshold) matchCount++;
        totalError += diff;
      }

      const accuracy = (matchCount / wallets.length * 100).toFixed(1);
      const avgError = (totalError / wallets.length).toFixed(2);
      console.log(`  ${engine.engine.padEnd(20)} | Accuracy: ${accuracy.padStart(5)}% | Avg Error: $${avgError}`);
    }
  }

  // Overall accuracy
  console.log('\n' + '='.repeat(100));
  console.log('📊 OVERALL ACCURACY');
  console.log('='.repeat(100));

  for (const engine of engines) {
    let matchCount = 0;
    let errorSum = 0;
    let validCount = 0;

    for (const wallet of ALL_WALLETS) {
      const baselineResult = baseline.results.find(r => r.wallet === wallet);
      const engineResult = engine.results.find(r => r.wallet === wallet);

      if (!baselineResult || !engineResult || baselineResult.error || engineResult.error) continue;

      validCount++;
      const diff = Math.abs(baselineResult.total_pnl_mtm - engineResult.total_pnl_mtm);
      const threshold = Math.max(1, Math.abs(baselineResult.total_pnl_mtm) * 0.05);

      if (diff < threshold) matchCount++;
      errorSum += diff;
    }

    const accuracy = (matchCount / validCount * 100).toFixed(1);
    const avgError = (errorSum / validCount).toFixed(2);
    console.log(`${engine.engine.padEnd(20)} | ${matchCount}/${validCount} (${accuracy}%) | Avg Error: $${avgError} | Time: ${engine.duration_ms}ms`);
  }
}

async function main() {
  console.log('🚀 PnL Engine Stratified Cohort Test');
  console.log(`Testing ${ALL_WALLETS.length} wallets across 5 cohorts\n`);

  // Run Polymarket baseline first
  const baseline = await runPolymarketBaseline();

  // Import and test local engines
  const engines: EngineResult[] = [];

  try {
    const { getWalletPnLV1 } = await import('../lib/pnl/pnlEngineV1');
    engines.push(await runLocalEngine('V1', getWalletPnLV1));
  } catch (e) {
    console.log('V1 import failed:', e);
  }

  try {
    const { getWalletPnLV17 } = await import('../lib/pnl/pnlEngineV17');
    engines.push(await runLocalEngine('V17', getWalletPnLV17));
  } catch (e) {
    console.log('V17 import failed:', e);
  }

  try {
    const { getWalletPnLV20 } = await import('../lib/pnl/pnlEngineV20');
    engines.push(await runLocalEngine('V20', getWalletPnLV20));
  } catch (e) {
    console.log('V20 import failed:', e);
  }

  try {
    const { getWalletPnLV22 } = await import('../lib/pnl/pnlEngineV22');
    engines.push(await runLocalEngine('V22', getWalletPnLV22));
  } catch (e) {
    console.log('V22 import failed:', e);
  }

  try {
    const { getWalletPnLV25 } = await import('../lib/pnl/pnlEngineV25');
    engines.push(await runLocalEngine('V25', getWalletPnLV25));
  } catch (e) {
    console.log('V25 import failed:', e);
  }

  // Compare results
  compareResults(baseline, engines);

  // Output detailed results for each wallet
  console.log('\n' + '='.repeat(100));
  console.log('📋 DETAILED WALLET RESULTS');
  console.log('='.repeat(100));

  for (const [cohortName, wallets] of Object.entries(COHORT)) {
    console.log(`\n### ${cohortName}`);
    for (const wallet of wallets.slice(0, 3)) {  // First 3 per cohort
      const shortWallet = wallet.slice(0, 10) + '...' + wallet.slice(-6);
      console.log(`\n${shortWallet}:`);

      const baselineResult = baseline.results.find(r => r.wallet === wallet);
      if (baselineResult && !baselineResult.error) {
        console.log(`  Polymarket API:  $${baselineResult.total_pnl_mtm.toFixed(2)}`);
      }

      for (const engine of engines) {
        const result = engine.results.find(r => r.wallet === wallet);
        if (result && !result.error) {
          const diff = baselineResult ? (result.total_pnl_mtm - baselineResult.total_pnl_mtm).toFixed(2) : 'N/A';
          console.log(`  ${engine.engine.padEnd(18)}: $${result.total_pnl_mtm.toFixed(2)} (diff: $${diff})`);
        }
      }
    }
  }
}

main().catch(console.error);
