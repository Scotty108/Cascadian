import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  const wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('FINAL VERIFICATION SUITE');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const results: any = { checks: [] };

  // ============================================================================
  // CHECK 1: Decode Integrity
  // ============================================================================
  console.log('CHECK 1: Decode Integrity (token = CTF||mask)');
  console.log('─'.repeat(60));

  const decodeQuery = await clickhouse.query({
    query: `
      WITH dec AS (
        SELECT
          lower(hex(toUInt256(asset_id))) AS token_hex,
          lpad(lower(hex(bitShiftRight(toUInt256(asset_id),8))),62,'0') AS ctf_hex,
          lpad(lower(hex(bitAnd(toUInt256(asset_id),255))),2,'0') AS mask_hex
        FROM clob_fills WHERE asset_id NOT IN ('asset','') LIMIT 10000
      )
      SELECT
        count() AS n,
        countIf(token_hex = concat(ctf_hex, mask_hex)) AS ok,
        ok*100.0/n AS pct_ok
      FROM dec
    `,
    format: 'JSONEachRow'
  });
  const decode = await decodeQuery.json();

  console.log(`   Sampled: ${decode[0].n} tokens`);
  console.log(`   Correct: ${decode[0].ok}`);
  console.log(`   Accuracy: ${Number(decode[0].pct_ok).toFixed(2)}%`);

  const check1Pass = decode[0].pct_ok >= 99.9;
  results.checks.push({ name: 'Decode Integrity', pass: check1Pass });
  console.log(`   ${check1Pass ? '✅ PASS' : '❌ FAIL'} (threshold: ≥99.9%)\n`);

  // ============================================================================
  // CHECK 2: Price Scale Sanity
  // ============================================================================
  console.log('CHECK 2: Price Scale Sanity');
  console.log('─'.repeat(60));

  const priceQuery = await clickhouse.query({
    query: `
      SELECT
        min(price) AS min_p,
        max(price) AS max_p,
        quantileExact(0.5)(price) AS p50,
        avg(price) AS avg_p
      FROM clob_fills WHERE asset_id NOT IN ('asset','')
    `,
    format: 'JSONEachRow'
  });
  const price = await priceQuery.json();

  console.log(`   Min price: ${Number(price[0].min_p).toFixed(6)}`);
  console.log(`   Max price: ${Number(price[0].max_p).toFixed(6)}`);
  console.log(`   Median price: ${Number(price[0].p50).toFixed(6)}`);
  console.log(`   Avg price: ${Number(price[0].avg_p).toFixed(6)}`);

  const priceIsDecimal = Number(price[0].max_p) <= 1.01; // Allow slight overflow
  results.priceIsDecimal = priceIsDecimal;
  console.log(`\n   ${priceIsDecimal ? '✅' : '❌'} Price is ${priceIsDecimal ? 'DECIMAL' : 'IN MICROS'}`);
  console.log(`   Action: ${priceIsDecimal ? 'Do NOT divide price by 1e6' : 'Must divide price by 1e6'}\n`);

  // ============================================================================
  // CHECK 3: Winner Join Correctness
  // ============================================================================
  console.log('CHECK 3: Winner Join Correctness');
  console.log('─'.repeat(60));

  const winnersQuery = await clickhouse.query({
    query: `
      SELECT
        count() AS rows,
        countIf(length(payout_numerators)=0) AS empty_vectors
      FROM winners_ctf
    `,
    format: 'JSONEachRow'
  });
  const winners = await winnersQuery.json();

  console.log(`   Winners rows: ${winners[0].rows.toLocaleString()}`);
  console.log(`   Empty vectors: ${winners[0].empty_vectors}`);

  const check3aPass = winners[0].empty_vectors === 0;
  console.log(`   ${check3aPass ? '✅' : '❌'} ${check3aPass ? 'PASS' : 'FAIL'} - No empty payout vectors`);

  const orphanQuery = await clickhouse.query({
    query: `
      SELECT count() AS orphan_count
      FROM wallet_condition_pnl_token t
      LEFT JOIN token_per_share_payout p USING(condition_id_ctf)
      WHERE p.pps IS NULL AND abs(realized_payout) > 0.01
    `,
    format: 'JSONEachRow'
  });
  const orphan = await orphanQuery.json();

  console.log(`   Orphan payouts: ${orphan[0].orphan_count}`);

  const check3bPass = orphan[0].orphan_count === 0;
  console.log(`   ${check3bPass ? '✅' : '❌'} ${check3bPass ? 'PASS' : 'FAIL'} - No orphan payouts\n`);

  results.checks.push({ name: 'Winner Join Correctness', pass: check3aPass && check3bPass });

  // ============================================================================
  // CHECK 4: Realized P&L
  // ============================================================================
  console.log('CHECK 4: Realized P&L');
  console.log('─'.repeat(60));

  const realizedQuery = await clickhouse.query({
    query: `
      SELECT round(sum(pnl_net),2) AS realized_pnl
      FROM wallet_condition_pnl
      WHERE lower(wallet)=lower('${wallet}')
    `,
    format: 'JSONEachRow'
  });
  const realized = await realizedQuery.json();

  console.log(`   Realized P&L: $${Number(realized[0].realized_pnl).toLocaleString()}`);
  results.realizedPnl = Number(realized[0].realized_pnl);

  // ============================================================================
  // CHECK 5: Unrealized P&L (Proxy Method)
  // ============================================================================
  console.log('\nCHECK 5: Unrealized P&L (Proxy Method)');
  console.log('─'.repeat(60));
  console.log('   Method: Calculating maximum possible payout for open positions\n');

  const unrealizedQuery = await clickhouse.query({
    query: `
      WITH open AS (
        SELECT
          f.condition_id_ctf,
          f.index_set_mask,
          f.net_shares,
          f.gross_cf,
          f.fees
        FROM wallet_token_flows f
        WHERE lower(f.wallet)=lower('${wallet}')
          AND abs(f.net_shares) > 1e-9
      ),
      with_payout AS (
        SELECT
          o.condition_id_ctf,
          o.index_set_mask,
          o.net_shares,
          o.gross_cf,
          o.fees,
          t.pps,
          arraySum(arrayMap(j ->
            if(bitAnd(o.index_set_mask, bitShiftLeft(1,j))>0,
               coalesce(arrayElement(t.pps, j+1),0.0), 0.0),
            range(length(coalesce(t.pps, []))))) AS per_share_payout
        FROM open o
        LEFT JOIN token_per_share_payout t USING(condition_id_ctf)
      )
      SELECT
        count() AS open_positions,
        round(sum(net_shares * per_share_payout), 2) AS max_payout,
        round(sum(gross_cf), 2) AS open_cost,
        round(sum(fees), 2) AS open_fees,
        round(sum(net_shares * per_share_payout) + sum(gross_cf) - sum(fees), 2) AS unrealized_pnl
      FROM with_payout
    `,
    format: 'JSONEachRow'
  });
  const unrealized = await unrealizedQuery.json();

  console.log(`   Open positions: ${unrealized[0].open_positions}`);
  console.log(`   Open cost: $${Number(unrealized[0].open_cost).toLocaleString()}`);
  console.log(`   Open fees: $${Number(unrealized[0].open_fees).toLocaleString()}`);
  console.log(`   Max possible payout: $${Number(unrealized[0].max_payout).toLocaleString()}`);
  console.log(`   Unrealized P&L (max): $${Number(unrealized[0].unrealized_pnl).toLocaleString()}`);

  results.unrealizedPnl = Number(unrealized[0].unrealized_pnl);

  const totalPnl = results.realizedPnl + results.unrealizedPnl;
  const domeTarget = 87030.51;
  const variance = ((totalPnl - domeTarget) / domeTarget * 100);

  console.log(`\n   Total P&L: $${results.realizedPnl.toLocaleString()} + $${results.unrealizedPnl.toLocaleString()} = $${totalPnl.toLocaleString()}`);
  console.log(`   DOME target: $${domeTarget.toLocaleString()}`);
  console.log(`   Variance: ${variance.toFixed(2)}%`);

  const check5Pass = Math.abs(variance) <= 10;
  results.checks.push({ name: 'Total P&L within 10% of DOME', pass: check5Pass });
  console.log(`   ${check5Pass ? '✅' : '⚠️ '} ${check5Pass ? 'PASS' : 'OUTSIDE 10%'}\n`);

  // ============================================================================
  // CHECK 6: Coverage
  // ============================================================================
  console.log('CHECK 6: Coverage and Data Quality');
  console.log('─'.repeat(60));

  const coverageQuery = await clickhouse.query({
    query: `
      SELECT
        count() AS traded_tokens,
        countIf(p.condition_id_ctf IS NULL) AS no_winner,
        no_winner * 100.0 / traded_tokens AS pct_missing
      FROM wallet_token_flows f
      LEFT JOIN token_per_share_payout p USING(condition_id_ctf)
      WHERE lower(f.wallet)=lower('${wallet}')
    `,
    format: 'JSONEachRow'
  });
  const coverage = await coverageQuery.json();

  console.log(`   Traded tokens: ${coverage[0].traded_tokens}`);
  console.log(`   Without winner: ${coverage[0].no_winner}`);
  console.log(`   Coverage: ${(100 - Number(coverage[0].pct_missing)).toFixed(2)}%`);

  const check6aPass = coverage[0].pct_missing <= 1;
  console.log(`   ${check6aPass ? '✅' : '⚠️ '} ${check6aPass ? 'PASS' : 'REVIEW'} - Coverage ${check6aPass ? '≥99%' : '<99%'}`);

  const nanQuery = await clickhouse.query({
    query: `
      SELECT
        countIf(isNaN(pnl_net) OR isInfinite(pnl_net)) AS bad
      FROM wallet_condition_pnl
    `,
    format: 'JSONEachRow'
  });
  const nan = await nanQuery.json();

  console.log(`   NaN/Inf values: ${nan[0].bad}`);

  const check6bPass = nan[0].bad === 0;
  console.log(`   ${check6bPass ? '✅' : '❌'} ${check6bPass ? 'PASS' : 'FAIL'} - No invalid values\n`);

  results.checks.push({ name: 'Coverage and Data Quality', pass: check6aPass && check6bPass });

  // ============================================================================
  // SUMMARY
  // ============================================================================
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('FINAL VERDICT');
  console.log('═══════════════════════════════════════════════════════════════\n');

  results.checks.forEach(check => {
    console.log(`   ${check.pass ? '✅' : '❌'} ${check.name}`);
  });

  console.log();
  console.log('Key Findings:');
  console.log(`   • Realized P&L: $${results.realizedPnl.toLocaleString()} (settled positions)`);
  console.log(`   • Unrealized P&L: $${results.unrealizedPnl.toLocaleString()} (open positions at max payout)`);
  console.log(`   • Total: $${totalPnl.toLocaleString()}`);
  console.log(`   • DOME shows: $87,030.51`);
  console.log(`   • Variance: ${variance.toFixed(2)}%\n`);

  if (Math.abs(variance) <= 2) {
    console.log('✅ SUCCESS: Within 2% of DOME target!\n');
    console.log('The "$72K gap" is confirmed to be unrealized P&L from open positions.');
    console.log('The system is calculating correctly.\n');
  } else if (Math.abs(variance) <= 10) {
    console.log('✅ CLOSE: Within 10% of DOME target.\n');
    console.log('The gap is primarily unrealized P&L, but may also include:');
    console.log('   • Current market prices vs max payout (we use max)');
    console.log('   • Time window differences');
    console.log('   • Different fee accounting\n');
  } else {
    console.log('⚠️  REVIEW NEEDED: More than 10% variance from DOME.\n');
    console.log('Potential issues to investigate:');
    console.log('   • Price scaling still incorrect');
    console.log('   • Missing positions');
    console.log('   • Bridge mapping issues\n');
  }

  const allPassed = results.checks.every((c: any) => c.pass);
  console.log(`Overall Status: ${allPassed ? '✅ ALL CHECKS PASSED' : '⚠️  SOME CHECKS NEED REVIEW'}\n`);
}

main().catch(console.error);
