/**
 * Benchmark PnL Accuracy by Wallet Class - Sample Validation
 *
 * Takes a sample from each class (T, M, X) and calculates:
 * 1. Trading PnL (CLOB position-based V20)
 * 2. Cashflow PnL (CLOB + PayoutRedemption)
 *
 * Outputs sample wallets for manual UI validation
 */

import { clickhouse } from '../../lib/clickhouse/client';

const SAMPLES_PER_CLASS = {
  T: 50,  // 50 traders (per user's plan)
  M: 20,  // 20 market-makers
  X: 20,  // 20 mixed
};

interface WalletSample {
  wallet_address: string;
  wallet_class: string;
  volume_clob: number;
  merge_share: number;
  pnl_trading: number;
  pnl_cashflow: number;
  pnl_diff: number;
}

async function main() {
  console.log('='.repeat(120));
  console.log('BENCHMARK PNL ACCURACY BY WALLET CLASS');
  console.log('='.repeat(120));
  console.log('');
  console.log('Sampling wallets from each class for UI validation...');
  console.log('');

  const results: WalletSample[] = [];
  const startTime = Date.now();

  for (const [walletClass, sampleSize] of Object.entries(SAMPLES_PER_CLASS)) {
    console.log(`Processing ${sampleSize} samples from class ${walletClass}...`);

    // Get sample wallets from classification table
    // Select diverse wallets: avoid extreme outliers that blow up memory
    const sampleQuery = `
      SELECT wallet_address, volume_clob, merge_share, wallet_class
      FROM pm_wallet_volume_classification_v1
      WHERE wallet_class = '${walletClass}'
        AND volume_clob > 10000       -- At least $10K CLOB
        AND volume_clob < 100000000   -- Cap at $100M to avoid memory blowup
      ORDER BY volume_clob DESC
      LIMIT ${sampleSize}
    `;

    const sampleR = await clickhouse.query({ query: sampleQuery, format: 'JSONEachRow' });
    const samples = await sampleR.json() as any[];

    console.log(`  Found ${samples.length} wallets`);

    // Calculate PnL for each wallet
    for (let i = 0; i < samples.length; i++) {
      const wallet = samples[i];
      const w = wallet.wallet_address.toLowerCase();

      try {
        // Trading PnL (CLOB position-based)
        const tradingQuery = `
          SELECT sum(position_pnl) as pnl
          FROM (
            SELECT
              canonical_condition_id,
              outcome_index,
              sum(usdc_delta) + sum(token_delta) * coalesce(any(payout_norm), 0) as position_pnl
            FROM pm_unified_ledger_v9
            WHERE lower(wallet_address) = '${w}'
              AND source_type = 'CLOB'
              AND canonical_condition_id IS NOT NULL
              AND canonical_condition_id != ''
            GROUP BY canonical_condition_id, outcome_index
          )
        `;

        // Cashflow PnL (CLOB + PayoutRedemption)
        const cashflowQuery = `
          SELECT sum(usdc_delta) as pnl
          FROM pm_unified_ledger_v9
          WHERE lower(wallet_address) = '${w}'
            AND source_type IN ('CLOB', 'PayoutRedemption')
        `;

        const [tradingR, cashflowR] = await Promise.all([
          clickhouse.query({ query: tradingQuery, format: 'JSONEachRow' }),
          clickhouse.query({ query: cashflowQuery, format: 'JSONEachRow' })
        ]);

        const tradingRows = await tradingR.json() as any[];
        const cashflowRows = await cashflowR.json() as any[];

        const pnlTrading = Number(tradingRows[0]?.pnl || 0);
        const pnlCashflow = Number(cashflowRows[0]?.pnl || 0);

        results.push({
          wallet_address: w,
          wallet_class: wallet.wallet_class,
          volume_clob: Number(wallet.volume_clob),
          merge_share: Number(wallet.merge_share),
          pnl_trading: pnlTrading,
          pnl_cashflow: pnlCashflow,
          pnl_diff: pnlTrading - pnlCashflow,
        });

        if ((i + 1) % 10 === 0) {
          console.log(`    ${i + 1}/${samples.length} processed...`);
        }
      } catch (e: any) {
        console.log(`    Error for ${w.substring(0, 10)}...: ${e.message}`);
      }
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('');
  console.log(`Processed ${results.length} wallets in ${elapsed}s`);
  console.log('');

  // ========================================
  // Output Results by Class
  // ========================================
  console.log('='.repeat(140));
  console.log('RESULTS BY CLASS');
  console.log('='.repeat(140));

  for (const walletClass of ['T', 'M', 'X']) {
    const classResults = results.filter(r => r.wallet_class === walletClass);

    const className = walletClass === 'T' ? 'TRADERS (T)' :
                      walletClass === 'M' ? 'MARKET-MAKERS (M)' :
                      'MIXED (X)';

    console.log('');
    console.log(`${className} - ${classResults.length} samples:`);
    console.log('Wallet Address                             | CLOB Volume     | Merge%  | Trading PnL     | Cashflow PnL    | Diff');
    console.log('-'.repeat(130));

    // Sort by volume descending
    classResults.sort((a, b) => b.volume_clob - a.volume_clob);

    for (const r of classResults.slice(0, 25)) { // Show top 25
      console.log(
        r.wallet_address.padEnd(42) + ' | $' +
        r.volume_clob.toLocaleString().padStart(13) + ' | ' +
        (r.merge_share * 100).toFixed(1).padStart(6) + '% | $' +
        r.pnl_trading.toLocaleString().padStart(13) + ' | $' +
        r.pnl_cashflow.toLocaleString().padStart(13) + ' | $' +
        r.pnl_diff.toLocaleString().padStart(13)
      );
    }

    // Summary stats for this class
    const avgDiff = classResults.reduce((sum, r) => sum + Math.abs(r.pnl_diff), 0) / classResults.length;
    const medianDiff = classResults.map(r => Math.abs(r.pnl_diff)).sort((a, b) => a - b)[Math.floor(classResults.length / 2)];
    const sumTrading = classResults.reduce((sum, r) => sum + r.pnl_trading, 0);
    const sumCashflow = classResults.reduce((sum, r) => sum + r.pnl_cashflow, 0);

    console.log('-'.repeat(130));
    console.log(`  Summary: Avg |diff|=$${avgDiff.toLocaleString()}, Median |diff|=$${medianDiff.toLocaleString()}`);
    console.log(`           Sum Trading=$${sumTrading.toLocaleString()}, Sum Cashflow=$${sumCashflow.toLocaleString()}`);
  }

  // ========================================
  // Output Validation Checklist
  // ========================================
  console.log('');
  console.log('='.repeat(140));
  console.log('UI VALIDATION CHECKLIST');
  console.log('='.repeat(140));
  console.log('');
  console.log('For each class, pick 5-10 wallets and compare against Polymarket UI:');
  console.log('  https://polymarket.com/portfolio/0x{wallet_address}?tab=performance');
  console.log('');

  for (const walletClass of ['T', 'M', 'X']) {
    const classResults = results.filter(r => r.wallet_class === walletClass);
    const className = walletClass === 'T' ? 'TRADERS' :
                      walletClass === 'M' ? 'MARKET-MAKERS' :
                      'MIXED';

    console.log(`${className} (pick 5-10):`);

    // Pick diverse samples: 3 high volume, 3 mid, 3 low
    const sorted = [...classResults].sort((a, b) => b.volume_clob - a.volume_clob);
    const high = sorted.slice(0, 3);
    const mid = sorted.slice(Math.floor(sorted.length / 2) - 1, Math.floor(sorted.length / 2) + 2);
    const low = sorted.slice(-3);
    const diverse = [...high, ...mid, ...low];

    for (const r of diverse) {
      const url = `https://polymarket.com/profile/${r.wallet_address}`;
      console.log(`  ${r.wallet_address.substring(0, 12)}... | $${r.volume_clob.toLocaleString().padStart(12)} | Trading: $${r.pnl_trading.toLocaleString().padStart(12)} | Cashflow: $${r.pnl_cashflow.toLocaleString().padStart(12)}`);
    }
    console.log('');
  }

  // ========================================
  // Save results for reference
  // ========================================
  console.log('='.repeat(140));
  console.log('COMPLETE');
  console.log('='.repeat(140));
  console.log('');
  console.log('Next steps:');
  console.log('1. Pick 5-10 wallets from each class');
  console.log('2. Visit Polymarket UI and record actual PnL');
  console.log('3. Compare: Which formula (Trading vs Cashflow) is closer?');
  console.log('4. Compute pass rate per class at 5% tolerance');
}

main().catch(console.error);
