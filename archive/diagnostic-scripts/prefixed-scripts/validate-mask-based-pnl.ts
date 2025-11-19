import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from './lib/clickhouse/client.js';

/**
 * Validate Mask-Based P&L System
 * Target: wallet 0xcce2b7c71f21e358b8e5e797e586cbc03160d58b
 * Expected: ~$87,030.51 (Dome baseline)
 */

async function main() {
  const targetWallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('MASK-BASED P&L VALIDATION');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log(`Target wallet: ${targetWallet}`);
  console.log(`Dome baseline: $87,030.51`);
  console.log(`Acceptable range: $85,250 - $88,811 (±2%)\n`);

  // Check 1: Coverage
  console.log('Check 1: Coverage Analysis');
  console.log('─'.repeat(60));

  const coverageQuery = await clickhouse.query({
    query: `
      SELECT
        count() AS traded_tokens,
        countIf(t.condition_id_ctf IS NULL) AS tokens_without_resolution
      FROM wallet_token_flows f
      LEFT JOIN token_per_share_payout t USING (condition_id_ctf)
      WHERE lower(f.wallet) = lower('${targetWallet}')
    `,
    format: 'JSONEachRow'
  });

  const coverage = await coverageQuery.json();
  const coveragePct = coverage[0].traded_tokens > 0
    ? ((coverage[0].traded_tokens - coverage[0].tokens_without_resolution) / coverage[0].traded_tokens * 100).toFixed(2)
    : '0';

  console.log(`   Traded tokens: ${coverage[0].traded_tokens}`);
  console.log(`   Without resolution: ${coverage[0].tokens_without_resolution}`);
  console.log(`   Coverage: ${coveragePct}%`);

  const coveragePass = Number(coverage[0].tokens_without_resolution) / Number(coverage[0].traded_tokens) <= 0.01;
  console.log(`   ${coveragePass ? '✅' : '❌'} ${coveragePass ? 'PASS' : 'FAIL'} (target: ≤1% missing)\n`);

  // Check 2: P&L Calculation
  console.log('Check 2: P&L Calculation');
  console.log('─'.repeat(60));

  const pnlQuery = await clickhouse.query({
    query: `
      SELECT
        pnl_gross,
        pnl_net
      FROM wallet_realized_pnl
      WHERE lower(wallet) = lower('${targetWallet}')
    `,
    format: 'JSONEachRow'
  });

  const pnl = await pnlQuery.json();

  if (pnl.length === 0) {
    console.log('   ❌ FAIL: Wallet not found in wallet_realized_pnl\n');
    process.exit(1);
  }

  const pnlGross = Number(pnl[0].pnl_gross);
  const pnlNet = Number(pnl[0].pnl_net);
  const domeTarget = 87030.51;
  const lowerBound = domeTarget * 0.98;
  const upperBound = domeTarget * 1.02;

  console.log(`   P&L Gross: $${pnlGross.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`   P&L Net:   $${pnlNet.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`   Dome target: $${domeTarget.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`   Delta: $${(pnlNet - domeTarget).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`   Variance: ${((pnlNet - domeTarget) / domeTarget * 100).toFixed(2)}%`);

  const pnlPass = pnlNet >= lowerBound && pnlNet <= upperBound;
  console.log(`   ${pnlPass ? '✅' : '⚠️'} ${pnlPass ? 'PASS' : 'REVIEW'} (target: ±2%)\n`);

  // Check 3: Top contributing markets
  console.log('Check 3: Top Contributing Markets (by absolute P&L)');
  console.log('─'.repeat(60));

  const topMarketsQuery = await clickhouse.query({
    query: `
      SELECT
        condition_id_ctf,
        gross_cf,
        fees,
        net_shares,
        realized_payout,
        pnl_net
      FROM wallet_condition_pnl
      WHERE lower(wallet) = lower('${targetWallet}')
      ORDER BY abs(pnl_net) DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });

  const topMarkets = await topMarketsQuery.json();

  console.log('   Top 10 markets:');
  topMarkets.forEach((m: any, i: number) => {
    const conditionShort = m.condition_id_ctf.substring(0, 12);
    console.log(`   ${(i + 1).toString().padStart(2)}. ${conditionShort}... : $${Number(m.pnl_net).toFixed(2).padStart(12)} ` +
      `(cf: $${Number(m.gross_cf).toFixed(2).padStart(10)}, payout: $${Number(m.realized_payout).toFixed(2).padStart(10)})`);
  });
  console.log();

  // Check 4: Mask analysis (sample binary market)
  console.log('Check 4: Binary Market Mask Analysis');
  console.log('─'.repeat(60));

  const binaryQuery = await clickhouse.query({
    query: `
      SELECT
        f.condition_id_ctf,
        f.index_set_mask,
        t.winning_index,
        length(t.pps) AS outcome_count,
        f.net_shares,
        bitAnd(f.index_set_mask, bitShiftLeft(1, t.winning_index)) > 0 AS mask_matches_winner
      FROM wallet_token_flows f
      JOIN token_per_share_payout t USING (condition_id_ctf)
      WHERE lower(f.wallet) = lower('${targetWallet}')
        AND length(t.pps) = 2
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });

  const binaryMarkets = await binaryQuery.json();

  console.log('   Sample binary markets:');
  binaryMarkets.forEach((m: any, i: number) => {
    const conditionShort = m.condition_id_ctf.substring(0, 12);
    const maskBinary = m.index_set_mask.toString(2).padStart(8, '0');
    const winnerBit = 1 << m.winning_index;
    console.log(`   ${i + 1}. ${conditionShort}... : mask=${m.index_set_mask} (${maskBinary}), winner bit ${m.winning_index} (${winnerBit}) → ${m.mask_matches_winner ? '✅ match' : '✗ no match'}`);
  });
  console.log();

  // Final verdict
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('FINAL VERDICT');
  console.log('═══════════════════════════════════════════════════════════════\n');

  if (pnlPass && coveragePass) {
    console.log('✅ SUCCESS - All validation checks passed!');
    console.log(`   P&L: $${pnlNet.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (within 2% of Dome: $${domeTarget.toLocaleString()})`);
    console.log(`   Coverage: ${coveragePct}% (≤1% missing resolutions)`);
    console.log('\n   The mask-based P&L system is working correctly!');
    console.log('   You can now use wallet_realized_pnl for production.\n');
  } else {
    console.log('⚠️  REVIEW NEEDED - Some checks did not pass optimal thresholds');
    if (!pnlPass) {
      console.log(`   - P&L variance is ${((pnlNet - domeTarget) / domeTarget * 100).toFixed(2)}% (outside ±2%)`);
      console.log('   - This could be due to:');
      console.log('     • Different fee handling');
      console.log('     • Missing resolutions for some markets');
      console.log('     • Time window differences (Dome vs our data)');
    }
    if (!coveragePass) {
      console.log(`   - Coverage is ${coveragePct}% (target: ≥99%)`);
      console.log('   - Missing resolutions may affect P&L accuracy');
    }
    console.log('\n   Review top markets and mask analysis above for insights.\n');
  }
}

main().catch(console.error);
