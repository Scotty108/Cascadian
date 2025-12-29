/**
 * V29 Tooltip Truth Regression Test
 *
 * This test validates V29 PnL calculations against Playwright tooltip-verified ground truth.
 *
 * Pass conditions:
 * - Wallets with openPositions <= 50 must pass at <=10% error
 * - Wallets with openPositions > 50 are allowed to fail (not in v1 scope)
 * - Overall pass rate >= 80% on strict wallets
 *
 * Data sources (in order of preference):
 * - data/regression/tooltip_truth_v2.json (expanded dataset)
 * - data/regression/tooltip_truth_v1.json (original dataset)
 *
 * Run: npx jest lib/pnl/__tests__/v29-tooltip-truth.spec.ts
 */

import { calculateV29PnL, evaluateTraderStrict } from '../inventoryEngineV29';
import * as fs from 'fs';
import * as path from 'path';

interface TooltipWallet {
  wallet: string;
  uiPnl: number;
  gain: number | null;
  loss: number | null;
  volume: number | null;
  scrapedAt: string;
  identityCheckPass: boolean;
  label?: string;
  bin?: string;
  openPositions?: number;
  notes: string;
}

interface TooltipTruthData {
  metadata: {
    generated_at: string;
    source: string;
    method: string;
    wallet_count: number;
    tolerance_pct: number;
    min_pnl_threshold: number;
  };
  wallets: TooltipWallet[];
}

interface WalletResult {
  wallet: string;
  pass: boolean;
  error: number | null;
  v29Pnl: number;
  uiPnl: number;
  openPositions: number;
  bin: string;
  isStrict: boolean;
}

const TOLERANCE = 0.10; // 10% tolerance
const MIN_PNL_FOR_TEST = 100; // Skip wallets with |PnL| < $100
const STRICT_POSITION_LIMIT = 50; // openPositions <= 50 = strict

function getBin(openPositions: number): string {
  if (openPositions <= 10) return '0-10';
  if (openPositions <= 25) return '11-25';
  if (openPositions <= 50) return '26-50';
  if (openPositions <= 100) return '51-100';
  return '100+';
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

describe('V29 Tooltip Truth Regression', () => {
  let truthData: TooltipTruthData;
  let datasetVersion: string;

  beforeAll(() => {
    // Try v2 first, fall back to v1
    const v2Path = path.join(__dirname, '../../../data/regression/tooltip_truth_v2.json');
    const v1Path = path.join(__dirname, '../../../data/regression/tooltip_truth_v1.json');

    if (fs.existsSync(v2Path)) {
      truthData = JSON.parse(fs.readFileSync(v2Path, 'utf-8'));
      datasetVersion = 'v2';
    } else if (fs.existsSync(v1Path)) {
      truthData = JSON.parse(fs.readFileSync(v1Path, 'utf-8'));
      datasetVersion = 'v1';
    } else {
      throw new Error('No ground truth dataset found. Run tooltip scraper first.');
    }

    console.log(`\nLoaded dataset: ${datasetVersion} (${truthData.wallets.length} wallets)\n`);
  });

  describe('Identity check validation', () => {
    it('all wallets should have passed identity check (Gain - Loss = Net Total)', () => {
      const failed = truthData.wallets.filter(w => !w.identityCheckPass);
      if (failed.length > 0) {
        console.log(`Identity check failures: ${failed.map(w => w.wallet.slice(0, 12)).join(', ')}`);
      }
      expect(failed.length).toBe(0);
    });
  });

  describe('Bin-level validation', () => {
    it('should pass at <=10% error for openPositions <= 50', async () => {
      const results: WalletResult[] = [];
      const binResults: Record<string, WalletResult[]> = {
        '0-10': [],
        '11-25': [],
        '26-50': [],
        '51-100': [],
        '100+': [],
      };

      // Process all wallets
      for (const truthWallet of truthData.wallets) {
        if (Math.abs(truthWallet.uiPnl) < MIN_PNL_FOR_TEST) {
          continue; // Skip small PnL
        }

        try {
          const v29 = await calculateV29PnL(truthWallet.wallet, {
            inventoryGuard: true,
            valuationMode: 'ui',
          });

          const eligibility = evaluateTraderStrict(v29);
          const error = (v29.uiParityPnl - truthWallet.uiPnl) / Math.abs(truthWallet.uiPnl);
          const pass = Math.abs(error) <= TOLERANCE;
          const bin = getBin(v29.openPositions);
          const isStrict = v29.openPositions <= STRICT_POSITION_LIMIT;

          const result: WalletResult = {
            wallet: truthWallet.wallet,
            pass,
            error,
            v29Pnl: v29.uiParityPnl,
            uiPnl: truthWallet.uiPnl,
            openPositions: v29.openPositions,
            bin,
            isStrict,
          };

          results.push(result);
          binResults[bin].push(result);
        } catch (err) {
          // Record error as failure
          const bin = truthWallet.bin || 'unknown';
          const result: WalletResult = {
            wallet: truthWallet.wallet,
            pass: false,
            error: null,
            v29Pnl: 0,
            uiPnl: truthWallet.uiPnl,
            openPositions: truthWallet.openPositions || 0,
            bin: bin in binResults ? bin : '100+',
            isStrict: false,
          };
          results.push(result);
          if (bin in binResults) {
            binResults[bin].push(result);
          }
        }
      }

      // Print bin-level statistics
      console.log('\n=== BIN-LEVEL STATISTICS ===\n');
      console.log('Bin       | Count | Pass | Rate   | Median Error | Worst 3');
      console.log('----------|-------|------|--------|--------------|--------');

      for (const [bin, wallets] of Object.entries(binResults)) {
        if (wallets.length === 0) continue;

        const passes = wallets.filter(w => w.pass);
        const passRate = passes.length / wallets.length;
        const errors = wallets.filter(w => w.error !== null).map(w => Math.abs(w.error!));
        const medianErr = median(errors);

        // Worst 3 wallets in this bin
        const worst3 = [...wallets]
          .filter(w => w.error !== null)
          .sort((a, b) => Math.abs(b.error!) - Math.abs(a.error!))
          .slice(0, 3)
          .map(w => `${w.wallet.slice(0, 8)}(${(w.error! * 100).toFixed(0)}%)`)
          .join(', ');

        console.log(
          `${bin.padEnd(9)} | ${wallets.length.toString().padStart(5)} | ${passes.length.toString().padStart(4)} | ${(passRate * 100).toFixed(1).padStart(5)}% | ${(medianErr * 100).toFixed(1).padStart(11)}% | ${worst3}`
        );
      }

      // Overall stats for strict wallets (openPositions <= 50)
      const strictResults = results.filter(r => r.isStrict);
      const strictPasses = strictResults.filter(r => r.pass);
      const strictPassRate = strictResults.length > 0
        ? strictPasses.length / strictResults.length
        : 0;

      console.log('\n=== STRICT WALLETS (openPositions <= 50) ===\n');
      console.log(`Pass rate: ${strictPasses.length}/${strictResults.length} (${(strictPassRate * 100).toFixed(1)}%)`);

      // List failures
      const failures = strictResults.filter(r => !r.pass);
      if (failures.length > 0) {
        console.log('\nFailures:');
        for (const f of failures) {
          console.log(
            `  ${f.wallet.slice(0, 12)}... | Pos: ${f.openPositions} | Error: ${f.error !== null ? (f.error * 100).toFixed(1) + '%' : 'N/A'} | V29: $${Math.round(f.v29Pnl).toLocaleString()} | UI: $${Math.round(f.uiPnl).toLocaleString()}`
          );
        }
      }

      // Non-strict stats (control group)
      const nonStrictResults = results.filter(r => !r.isStrict);
      if (nonStrictResults.length > 0) {
        const nonStrictPasses = nonStrictResults.filter(r => r.pass);
        console.log(
          `\nControl group (openPositions > 50): ${nonStrictPasses.length}/${nonStrictResults.length} (${((nonStrictPasses.length / nonStrictResults.length) * 100).toFixed(1)}%)`
        );
      }

      // Assert >= 80% pass rate on strict wallets
      expect(strictPassRate).toBeGreaterThanOrEqual(0.80);
    }, 600000); // 10 minute timeout for full suite
  });

  describe('Overall pass rate', () => {
    it('should have >= 80% pass rate on TRADER_STRICT wallets', async () => {
      const results: WalletResult[] = [];

      for (const truthWallet of truthData.wallets) {
        if (Math.abs(truthWallet.uiPnl) < MIN_PNL_FOR_TEST) {
          continue; // Skip small PnL
        }

        try {
          const v29 = await calculateV29PnL(truthWallet.wallet, {
            inventoryGuard: true,
            valuationMode: 'ui',
          });

          const eligibility = evaluateTraderStrict(v29);
          const error = (v29.uiParityPnl - truthWallet.uiPnl) / Math.abs(truthWallet.uiPnl);
          const pass = Math.abs(error) <= TOLERANCE;

          results.push({
            wallet: truthWallet.wallet,
            pass,
            error,
            v29Pnl: v29.uiParityPnl,
            uiPnl: truthWallet.uiPnl,
            openPositions: v29.openPositions,
            bin: getBin(v29.openPositions),
            isStrict: eligibility.isTraderStrict,
          });
        } catch {
          results.push({
            wallet: truthWallet.wallet,
            pass: false,
            error: null,
            v29Pnl: 0,
            uiPnl: truthWallet.uiPnl,
            openPositions: 0,
            bin: 'unknown',
            isStrict: false,
          });
        }
      }

      // Calculate pass rate for TRADER_STRICT wallets only
      const strictResults = results.filter(r => r.isStrict);
      const strictPasses = strictResults.filter(r => r.pass);
      const passRate = strictResults.length > 0
        ? strictPasses.length / strictResults.length
        : 0;

      console.log(`\nTRADER_STRICT pass rate: ${strictPasses.length}/${strictResults.length} (${(passRate * 100).toFixed(1)}%)`);

      // Assert >= 80% pass rate
      expect(passRate).toBeGreaterThanOrEqual(0.80);
    }, 600000); // 10 minute timeout
  });
});
