import { clickhouse } from '@/lib/clickhouse/client';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

interface ConditionCandidate {
  condition_id: string;
  question: string;
  unique_wallets: string;
  total_trades: string;
  total_volume: string;
}

interface ZeroSumResult {
  wallet_count: string;
  total_pnl_all_wallets: string;
  total_fees_all_wallets: string;
  should_be_zero: string;
  error_ratio: string;
}

async function main() {
  try {
    // Step 1: Find a good test condition
    console.log('=== STEP 1: Finding a good test condition ===\n');

    const findConditionQuery = `
      SELECT
          m.condition_id as condition_id,
          m.question as question,
          count(DISTINCT t.trader_wallet) as unique_wallets,
          count(*) as total_trades,
          sum(t.usdc_amount) / 1000000 as total_volume
      FROM pm_trader_events_v2 t
      JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
      JOIN pm_condition_resolutions r ON m.condition_id = r.condition_id
      GROUP BY m.condition_id, m.question
      HAVING unique_wallets BETWEEN 50 AND 500
      ORDER BY total_volume DESC
      LIMIT 5
    `;

    const conditionsResult = await clickhouse.query({
      query: findConditionQuery,
      format: 'JSONEachRow'
    });

    const conditions = await conditionsResult.json<ConditionCandidate[]>();

    if (conditions.length === 0) {
      console.log('❌ No suitable conditions found with 50-500 wallets');
      process.exit(1);
    }

    console.log('Top 5 candidate conditions:');
    console.log('─'.repeat(120));
    conditions.forEach((c, i) => {
      console.log(`${i + 1}. Condition ID: ${c.condition_id}`);
      console.log(`   Question: ${c.question}`);
      console.log(`   Wallets: ${c.unique_wallets} | Trades: ${c.total_trades} | Volume: $${parseFloat(c.total_volume).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
      console.log();
    });

    const selectedCondition = conditions[0];
    console.log(`\n✅ Selected condition: ${selectedCondition.condition_id}`);
    console.log(`   Question: "${selectedCondition.question}"`);
    console.log(`   ${selectedCondition.unique_wallets} wallets, $${parseFloat(selectedCondition.total_volume).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})} volume\n`);

    // Step 2: Run the zero-sum validation
    console.log('=== STEP 2: Running zero-sum validation ===\n');

    const zeroSumQuery = `
      WITH condition_pnl AS (
          SELECT
              t.trader_wallet,
              m.condition_id,
              m.outcome_index,
              sum(CASE WHEN t.side = 'buy'
                       THEN -(t.usdc_amount + t.fee_amount) / 1000000
                       ELSE +(t.usdc_amount - t.fee_amount) / 1000000 END) as cash_delta,
              sum(CASE WHEN t.side = 'buy'
                       THEN +t.token_amount / 1000000
                       ELSE -t.token_amount / 1000000 END) as final_shares,
              sum(t.fee_amount) / 1000000 as fees_paid
          FROM pm_trader_events_v2 t
          JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
          WHERE m.condition_id = '${selectedCondition.condition_id}'
          GROUP BY t.trader_wallet, m.condition_id, m.outcome_index
      ),
      with_resolution AS (
          SELECT
              c.*,
              toFloat64(splitByChar(',', replaceAll(replaceAll(r.payout_numerators, '[', ''), ']', ''))[c.outcome_index + 1])
                  / toFloat64(r.payout_denominator) as resolved_price
          FROM condition_pnl c
          JOIN pm_condition_resolutions r ON c.condition_id = r.condition_id
      ),
      wallet_pnl AS (
          SELECT
              trader_wallet,
              sum(cash_delta) + sum(final_shares * resolved_price) as realized_pnl,
              sum(fees_paid) as total_fees
          FROM with_resolution
          GROUP BY trader_wallet
      )
      SELECT
          count(DISTINCT trader_wallet) as wallet_count,
          sum(realized_pnl) as total_pnl_all_wallets,
          sum(total_fees) as total_fees_all_wallets,
          sum(realized_pnl) + sum(total_fees) as should_be_zero,
          abs(sum(realized_pnl) + sum(total_fees)) / nullIf(sum(total_fees), 0) as error_ratio
      FROM wallet_pnl
    `;

    const zeroSumResult = await clickhouse.query({
      query: zeroSumQuery,
      format: 'JSONEachRow'
    });

    const results = await zeroSumResult.json<ZeroSumResult[]>();
    const result = results[0];

    // Step 3: Validate the result
    console.log('Zero-Sum Test Results:');
    console.log('─'.repeat(80));
    console.log(`Wallet Count:            ${result.wallet_count}`);
    console.log(`Total PnL (all wallets):  $${parseFloat(result.total_pnl_all_wallets).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
    console.log(`Total Fees (all wallets): $${parseFloat(result.total_fees_all_wallets).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
    console.log(`Should Be Zero:           $${parseFloat(result.should_be_zero).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
    console.log(`Error Ratio:              ${parseFloat(result.error_ratio).toFixed(6)} (${(parseFloat(result.error_ratio) * 100).toFixed(4)}%)`);
    console.log();

    const absError = Math.abs(parseFloat(result.should_be_zero));
    const errorRatio = parseFloat(result.error_ratio);
    const totalFees = parseFloat(result.total_fees_all_wallets);

    // Validation criteria
    const passAbsolute = absError < 1.00;
    const passRatio = errorRatio < 0.001;
    const passes = passAbsolute || passRatio;

    console.log('=== STEP 3: Validation ===\n');
    console.log(`Absolute error test (< $1.00): ${passAbsolute ? '✅ PASS' : '❌ FAIL'} ($${absError.toFixed(2)})`);
    console.log(`Ratio test (< 0.1%):           ${passRatio ? '✅ PASS' : '❌ FAIL'} (${(errorRatio * 100).toFixed(4)}%)`);
    console.log();
    console.log(`Overall: ${passes ? '✅ ZERO-SUM PROPERTY HOLDS' : '❌ ZERO-SUM VIOLATION DETECTED'}`);

    if (passes) {
      console.log(`\nThe condition is perfectly balanced within ${passAbsolute ? 'absolute' : 'ratio'} tolerance.`);
      if (totalFees === 0) {
        console.log(`\n⚠️  WARNING: Total fees are $0.00`);
        console.log(`   This is a known data quality issue in pm_trader_events_v2.`);
        console.log(`   The zero-sum test passes because PnL alone sums to ~$0, which is correct.`);
        console.log(`   In reality, there ARE fees paid, but they're not captured in this table.`);
      } else {
        console.log(`Error magnitude: $${absError.toFixed(2)} out of $${totalFees.toFixed(2)} total fees (${(absError / totalFees * 100).toFixed(4)}%)`);
      }
    } else {
      console.log(`\n⚠️  Zero-sum violation detected. Possible causes:`);
      console.log(`   - Missing trades in pm_trader_events_v2`);
      console.log(`   - Incorrect resolution data in pm_condition_resolutions`);
      console.log(`   - Fee calculation errors`);
      console.log(`   - Floating point precision issues (unlikely at this scale)`);
    }

    process.exit(passes ? 0 : 1);

  } catch (error: any) {
    console.error('Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
