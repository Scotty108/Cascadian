/**
 * CLOB-Only Classifier Test Suite
 *
 * Validates that V29's wallet classification accurately identifies:
 * - CLOB_ONLY: Wallets with only CLOB trades (no CTF activity)
 * - MIXED: Wallets with CTF activity (splits, merges)
 * - WHALE_COMPLEX: Wallets with >100 open positions
 *
 * Uses two-source validation:
 * 1. V29 internal event counters (walletEventCounts)
 * 2. Independent query-based check (isClobOnlyWallet from realizedUiStyleV2.ts)
 *
 * Pass criteria:
 * - 100% true positive rate (CLOB-only wallets correctly identified)
 * - <1% false positive rate (MIXED wallets NOT classified as CLOB-only)
 *
 * Run: npx jest lib/pnl/__tests__/clob-only/classifier.spec.ts
 */

import { calculateV29PnL, evaluateTraderStrict, V29Result } from '../../inventoryEngineV29';
import { isClobOnlyWallet } from '../../realizedUiStyleV2';
import { clickhouse } from '../../../clickhouse/client';

// ============================================================================
// Test Configuration
// ============================================================================

const TEST_CONFIG = {
  // Minimum wallets to test for each category
  minClobOnlyWallets: 5,
  minMixedWallets: 5,

  // False positive rate threshold
  maxFalsePositiveRate: 0.01, // 1%

  // Query limits for test wallet selection
  walletQueryLimit: 20,

  // How many wallets to actually test in each category (for speed)
  testLimit: 5,
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Query wallets that are CLOB-only (using independent SQL, not V29)
 * This serves as the "oracle" for classification validation
 */
async function queryClobOnlyWallets(limit: number = 50): Promise<string[]> {
  const query = `
    SELECT wallet_address as wallet, count() as event_count
    FROM pm_unified_ledger_v8_tbl
    WHERE wallet_address != ''
      AND condition_id != ''
    GROUP BY wallet_address
    HAVING countIf(source_type NOT IN ('CLOB', 'PayoutRedemption')) = 0
      AND countIf(source_type = 'CLOB') >= 10
    ORDER BY event_count DESC
    LIMIT ${limit}
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as { wallet: string }[];
  return rows.map(r => r.wallet.toLowerCase());
}

/**
 * Query wallets that have CTF activity (splits/merges)
 */
async function queryMixedWallets(limit: number = 50): Promise<string[]> {
  const query = `
    SELECT wallet_address as wallet, count() as event_count
    FROM pm_unified_ledger_v8_tbl
    WHERE wallet_address != ''
      AND condition_id != ''
    GROUP BY wallet_address
    HAVING countIf(source_type IN ('PositionSplit', 'PositionsMerge')) > 0
      AND countIf(source_type = 'CLOB') >= 10
    ORDER BY event_count DESC
    LIMIT ${limit}
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as { wallet: string }[];
  return rows.map(r => r.wallet.toLowerCase());
}

/**
 * Query wallets with many open positions (potential whales)
 */
async function queryWhaleWallets(limit: number = 10): Promise<string[]> {
  const query = `
    SELECT
      wallet_address as wallet,
      count(DISTINCT condition_id) as condition_count
    FROM pm_unified_ledger_v8_tbl
    WHERE wallet_address != ''
      AND condition_id != ''
    GROUP BY wallet_address
    HAVING condition_count > 100
    ORDER BY condition_count DESC
    LIMIT ${limit}
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as { wallet: string }[];
  return rows.map(r => r.wallet.toLowerCase());
}

interface ClassificationResult {
  wallet: string;
  v29Badge: string;
  oracleIsClobOnly: boolean;
  match: boolean;
  eventCounts: {
    clobEvents: number;
    splitEvents: number;
    mergeEvents: number;
    redemptionEvents: number;
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('CLOB-Only Classifier', () => {
  let clobOnlyWallets: string[];
  let mixedWallets: string[];
  let whaleWallets: string[];

  beforeAll(async () => {
    // Query test wallets from ClickHouse
    console.log('\nQuerying test wallets from ClickHouse...\n');

    [clobOnlyWallets, mixedWallets, whaleWallets] = await Promise.all([
      queryClobOnlyWallets(TEST_CONFIG.walletQueryLimit),
      queryMixedWallets(TEST_CONFIG.walletQueryLimit),
      queryWhaleWallets(10),
    ]);

    console.log(`Found ${clobOnlyWallets.length} CLOB-only wallets (oracle)`);
    console.log(`Found ${mixedWallets.length} mixed wallets (with CTF activity)`);
    console.log(`Found ${whaleWallets.length} potential whale wallets\n`);
  }, 120000); // 2 minute timeout for ClickHouse queries

  describe('True Positive Rate (CLOB-only detection)', () => {
    it('should correctly classify known CLOB-only wallets', async () => {
      expect(clobOnlyWallets.length).toBeGreaterThanOrEqual(TEST_CONFIG.minClobOnlyWallets);

      const results: ClassificationResult[] = [];
      let truePositives = 0;
      let falseNegatives = 0;

      for (const wallet of clobOnlyWallets.slice(0, TEST_CONFIG.testLimit)) {
        try {
          // V29 classification
          const v29 = await calculateV29PnL(wallet, {
            inventoryGuard: true,
            valuationMode: 'ui',
          });

          const eligibility = evaluateTraderStrict(v29);

          // Oracle classification (independent query-based)
          const oracleIsClobOnly = await isClobOnlyWallet(wallet);

          // Check if V29 correctly identified as CLOB_ONLY
          const v29IsClobOnly = eligibility.walletTypeBadge === 'CLOB_ONLY';
          const match = v29IsClobOnly === oracleIsClobOnly;

          if (oracleIsClobOnly && v29IsClobOnly) {
            truePositives++;
          } else if (oracleIsClobOnly && !v29IsClobOnly) {
            falseNegatives++;
          }

          results.push({
            wallet,
            v29Badge: eligibility.walletTypeBadge,
            oracleIsClobOnly,
            match,
            eventCounts: v29.walletEventCounts,
          });
        } catch (err) {
          console.error(`Error processing ${wallet}: ${(err as Error).message}`);
        }
      }

      // Report results
      console.log('\n=== CLOB-ONLY TRUE POSITIVE TEST ===\n');
      console.log('Wallet         | V29 Badge    | Oracle | Match | CLOB | Split | Merge');
      console.log('---------------|--------------|--------|-------|------|-------|------');

      for (const r of results) {
        console.log(
          `${r.wallet.slice(0, 12)}... | ${r.v29Badge.padEnd(12)} | ${r.oracleIsClobOnly ? 'YES' : 'NO '.padEnd(6)} | ${r.match ? 'OK ' : 'FAIL'} | ${r.eventCounts.clobEvents.toString().padStart(4)} | ${r.eventCounts.splitEvents.toString().padStart(5)} | ${r.eventCounts.mergeEvents.toString().padStart(5)}`
        );
      }

      const truePositiveRate = truePositives / (truePositives + falseNegatives) || 0;
      console.log(`\nTrue Positive Rate: ${truePositives}/${truePositives + falseNegatives} (${(truePositiveRate * 100).toFixed(1)}%)`);

      // Assert 100% true positive rate
      expect(truePositiveRate).toBe(1.0);
    }, 120000);
  });

  describe('False Positive Rate (MIXED detection)', () => {
    it('should NOT classify mixed wallets as CLOB-only', async () => {
      expect(mixedWallets.length).toBeGreaterThanOrEqual(TEST_CONFIG.minMixedWallets);

      const results: ClassificationResult[] = [];
      let trueNegatives = 0;
      let falsePositives = 0;

      for (const wallet of mixedWallets.slice(0, TEST_CONFIG.testLimit)) {
        try {
          // V29 classification
          const v29 = await calculateV29PnL(wallet, {
            inventoryGuard: true,
            valuationMode: 'ui',
          });

          const eligibility = evaluateTraderStrict(v29);

          // Oracle classification (independent query-based)
          const oracleIsClobOnly = await isClobOnlyWallet(wallet);

          // Check if V29 correctly identified as NOT CLOB_ONLY
          const v29IsClobOnly = eligibility.walletTypeBadge === 'CLOB_ONLY';

          if (!oracleIsClobOnly && !v29IsClobOnly) {
            trueNegatives++;
          } else if (!oracleIsClobOnly && v29IsClobOnly) {
            falsePositives++;
            console.warn(`FALSE POSITIVE: ${wallet} classified as CLOB_ONLY but has CTF activity`);
          }

          results.push({
            wallet,
            v29Badge: eligibility.walletTypeBadge,
            oracleIsClobOnly,
            match: !v29IsClobOnly === !oracleIsClobOnly,
            eventCounts: v29.walletEventCounts,
          });
        } catch (err) {
          console.error(`Error processing ${wallet}: ${(err as Error).message}`);
        }
      }

      // Report results
      console.log('\n=== MIXED WALLET FALSE POSITIVE TEST ===\n');
      console.log('Wallet         | V29 Badge    | Oracle | Match | CLOB | Split | Merge');
      console.log('---------------|--------------|--------|-------|------|-------|------');

      for (const r of results) {
        console.log(
          `${r.wallet.slice(0, 12)}... | ${r.v29Badge.padEnd(12)} | ${r.oracleIsClobOnly ? 'YES' : 'NO '.padEnd(6)} | ${r.match ? 'OK ' : 'FAIL'} | ${r.eventCounts.clobEvents.toString().padStart(4)} | ${r.eventCounts.splitEvents.toString().padStart(5)} | ${r.eventCounts.mergeEvents.toString().padStart(5)}`
        );
      }

      const falsePositiveRate = falsePositives / (trueNegatives + falsePositives) || 0;
      console.log(`\nFalse Positive Rate: ${falsePositives}/${trueNegatives + falsePositives} (${(falsePositiveRate * 100).toFixed(1)}%)`);

      // Assert <1% false positive rate
      expect(falsePositiveRate).toBeLessThanOrEqual(TEST_CONFIG.maxFalsePositiveRate);
    }, 120000);
  });

  describe('Whale Classification', () => {
    it('should classify wallets with >100 open positions as WHALE_COMPLEX', async () => {
      if (whaleWallets.length === 0) {
        console.log('No whale wallets found for testing, skipping...');
        return;
      }

      let whaleCorrect = 0;
      let whaleTotal = 0;

      console.log('\n=== WHALE CLASSIFICATION TEST ===\n');

      for (const wallet of whaleWallets.slice(0, 5)) {
        try {
          const v29 = await calculateV29PnL(wallet, {
            inventoryGuard: true,
            valuationMode: 'ui',
          });

          const eligibility = evaluateTraderStrict(v29);

          if (v29.openPositions > 100) {
            whaleTotal++;
            if (eligibility.walletTypeBadge === 'WHALE_COMPLEX') {
              whaleCorrect++;
            }

            console.log(
              `${wallet.slice(0, 12)}... | Open: ${v29.openPositions} | Badge: ${eligibility.walletTypeBadge}`
            );
          }
        } catch (err) {
          console.error(`Error processing ${wallet}: ${(err as Error).message}`);
        }
      }

      if (whaleTotal > 0) {
        console.log(`\nWhale Classification: ${whaleCorrect}/${whaleTotal} correct`);
        expect(whaleCorrect).toBe(whaleTotal);
      }
    }, 120000);
  });

  describe('Edge Cases', () => {
    it('should handle wallet with only redemptions (no trades)', async () => {
      // Query a wallet with only redemptions
      const query = `
        SELECT wallet_address as wallet
        FROM pm_unified_ledger_v8_tbl
        WHERE wallet_address != ''
          AND condition_id != ''
        GROUP BY wallet_address
        HAVING countIf(source_type = 'CLOB') = 0
          AND countIf(source_type = 'PayoutRedemption') > 0
        LIMIT 1
      `;

      const result = await clickhouse.query({ query, format: 'JSONEachRow' });
      const rows = (await result.json()) as { wallet: string }[];

      if (rows.length === 0) {
        console.log('No redemption-only wallets found, skipping...');
        return;
      }

      const wallet = rows[0].wallet.toLowerCase();
      const v29 = await calculateV29PnL(wallet, {
        inventoryGuard: true,
        valuationMode: 'ui',
      });

      const eligibility = evaluateTraderStrict(v29);

      console.log(`\nRedemption-only wallet: ${wallet.slice(0, 12)}...`);
      console.log(`  Badge: ${eligibility.walletTypeBadge}`);
      console.log(`  Event counts:`, v29.walletEventCounts);

      // Should NOT be classified as CLOB_ONLY (no CLOB events)
      expect(eligibility.walletTypeBadge).not.toBe('CLOB_ONLY');
    }, 60000);

    it('should handle wallet with exactly 1 CLOB trade', async () => {
      // Query a wallet with exactly 1 CLOB event
      const query = `
        SELECT wallet_address as wallet
        FROM pm_unified_ledger_v8_tbl
        WHERE wallet_address != ''
          AND condition_id != ''
        GROUP BY wallet_address
        HAVING countIf(source_type = 'CLOB') = 1
          AND countIf(source_type NOT IN ('CLOB', 'PayoutRedemption')) = 0
        LIMIT 1
      `;

      const result = await clickhouse.query({ query, format: 'JSONEachRow' });
      const rows = (await result.json()) as { wallet: string }[];

      if (rows.length === 0) {
        console.log('No single-trade wallets found, skipping...');
        return;
      }

      const wallet = rows[0].wallet.toLowerCase();
      const v29 = await calculateV29PnL(wallet, {
        inventoryGuard: true,
        valuationMode: 'ui',
      });

      const eligibility = evaluateTraderStrict(v29);

      console.log(`\nSingle-trade wallet: ${wallet.slice(0, 12)}...`);
      console.log(`  Badge: ${eligibility.walletTypeBadge}`);
      console.log(`  Event counts:`, v29.walletEventCounts);

      // Should be CLOB_ONLY (has CLOB events, no CTF)
      expect(eligibility.walletTypeBadge).toBe('CLOB_ONLY');
    }, 60000);
  });

  describe('Two-Source Validation Consistency', () => {
    it('should have V29 classification match oracle classification', async () => {
      // Test a random sample of wallets for consistency
      const sampleSize = 10;
      const allWallets = [...clobOnlyWallets.slice(0, 5), ...mixedWallets.slice(0, 5)];

      let matches = 0;
      let mismatches = 0;

      console.log('\n=== TWO-SOURCE VALIDATION ===\n');

      for (const wallet of allWallets.slice(0, sampleSize)) {
        try {
          const v29 = await calculateV29PnL(wallet, {
            inventoryGuard: true,
            valuationMode: 'ui',
          });

          const eligibility = evaluateTraderStrict(v29);
          const oracleIsClobOnly = await isClobOnlyWallet(wallet);

          const v29IsClobOnly = eligibility.walletTypeBadge === 'CLOB_ONLY';

          if (v29IsClobOnly === oracleIsClobOnly) {
            matches++;
          } else {
            mismatches++;
            console.log(
              `MISMATCH: ${wallet.slice(0, 12)}... | V29: ${eligibility.walletTypeBadge} | Oracle: ${oracleIsClobOnly ? 'CLOB_ONLY' : 'NOT_CLOB_ONLY'}`
            );
            console.log(`  Event counts:`, v29.walletEventCounts);
          }
        } catch (err) {
          console.error(`Error: ${(err as Error).message}`);
        }
      }

      const matchRate = matches / (matches + mismatches);
      console.log(`\nTwo-Source Match Rate: ${matches}/${matches + mismatches} (${(matchRate * 100).toFixed(1)}%)`);

      // Expect >99% consistency between V29 and oracle
      expect(matchRate).toBeGreaterThanOrEqual(0.99);
    }, 180000);
  });
});
