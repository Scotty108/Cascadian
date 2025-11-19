import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  const wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('VERIFICATION SUITE - PROVING ALL CLAIMS');
  console.log('═══════════════════════════════════════════════════════════════\n');

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
  console.log(`   ${decode[0].pct_ok === 100 ? '✅ PASS' : '❌ FAIL'}\n`);

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

  const priceIsDecimal = Number(price[0].max_p) <= 1;
  console.log(`\n   Interpretation: Price is ${priceIsDecimal ? 'DECIMAL' : 'IN MICROS'}`);
  console.log(`   ${priceIsDecimal ? '✅ Do NOT divide price by 1e6' : '⚠️  Need to divide price by 1e6'}\n`);

  // ============================================================================
  // CHECK 3: Winner Join Correctness
  // ============================================================================
  console.log('CHECK 3: Winner Join Correctness');
  console.log('─'.repeat(60));

  // 3a: Check winners_ctf for empty vectors
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

  console.log(`   Winners rows: ${winners[0].rows}`);
  console.log(`   Empty vectors: ${winners[0].empty_vectors}`);
  console.log(`   ${winners[0].empty_vectors === 0 ? '✅ PASS' : '❌ FAIL'} - No empty payout vectors\n`);

  // 3b: Check for realized_payout where pps is NULL
  const orphanQuery = await clickhouse.query({
    query: `
      SELECT count() AS orphan_count
      FROM wallet_condition_pnl_token t
      LEFT JOIN token_per_share_payout p USING(condition_id_ctf)
      WHERE p.pps IS NULL AND realized_payout != 0
    `,
    format: 'JSONEachRow'
  });
  const orphan = await orphanQuery.json();

  console.log(`   Orphan payouts (pps NULL but payout!=0): ${orphan[0].orphan_count}`);
  console.log(`   ${orphan[0].orphan_count === 0 ? '✅ PASS' : '❌ FAIL'} - No orphan payouts\n`);

  // ============================================================================
  // CHECK 4: Realized vs Unrealized Split
  // ============================================================================
  console.log('CHECK 4: Realized vs Unrealized Split');
  console.log('─'.repeat(60));

  // 4a: Get realized P&L
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

  // 4b: Check if we have outcome_prices table
  const hasPricesQuery = await clickhouse.query({
    query: `
      SELECT count() AS cnt
      FROM system.tables
      WHERE database = 'default' AND name = 'outcome_prices'
    `,
    format: 'JSONEachRow'
  });
  const hasPrices = await hasPricesQuery.json();

  if (hasPrices[0].cnt === 0) {
    console.log(`\n   ⚠️  outcome_prices table does not exist!`);
    console.log(`   Cannot calculate unrealized P&L without current market prices.`);
    console.log(`   Need to backfill current prices from Polymarket API.\n`);

    // Alternative: Use average of winning outcome as proxy
    console.log(`   ALTERNATIVE: Calculating unrealized using simplified method...`);
    console.log(`   Assuming open positions are worth their average winning payout...\n`);

    const unrealizedProxyQuery = await clickhouse.query({
      query: `
        WITH open AS (
          SELECT
            f.condition_id_ctf,
            f.index_set_mask,
            f.net_shares,
            f.gross_cf
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
            arraySum(arrayMap(j ->
              if(bitAnd(o.index_set_mask, bitShiftLeft(1,j))>0,
                 coalesce(arrayElement(t.pps, j+1),0.0), 0.0),
              range(length(t.pps)))) AS per_share_payout
          FROM open o
          LEFT JOIN token_per_share_payout t USING(condition_id_ctf)
        )
        SELECT
          round(sum(net_shares * per_share_payout), 2) AS potential_payout,
          round(sum(gross_cf), 2) AS open_cost,
          round(sum(net_shares * per_share_payout) + sum(gross_cf), 2) AS unrealized_pnl
        FROM with_payout
      `,
      format: 'JSONEachRow'
    });
    const unrealizedProxy = await unrealizedProxyQuery.json();

    console.log(`   Open position cost: $${Number(unrealizedProxy[0].open_cost).toLocaleString()}`);
    console.log(`   Potential payout (if all win): $${Number(unrealizedProxy[0].potential_payout).toLocaleString()}`);
    console.log(`   Unrealized P&L (proxy): $${Number(unrealizedProxy[0].unrealized_pnl).toLocaleString()}`);

    const totalPnl = Number(realized[0].realized_pnl) + Number(unrealizedProxy[0].unrealized_pnl);
    const domeTarget = 87030.51;
    const variance = ((totalPnl - domeTarget) / domeTarget * 100).toFixed(2);

    console.log(`\n   Total P&L: $${realized[0].realized_pnl} + $${unrealizedProxy[0].unrealized_pnl} = $${totalPnl.toLocaleString()}`);
    console.log(`   DOME target: $${domeTarget.toLocaleString()}`);
    console.log(`   Variance: ${variance}%`);
    console.log(`   ${Math.abs(Number(variance)) <= 10 ? '✅ Within 10%' : '❌ Outside 10%'}\n`);
  }

  // ============================================================================
  // CHECK 5: Coverage and Guards
  // ============================================================================
  console.log('CHECK 5: Coverage and Double-Count Guards');
  console.log('─'.repeat(60));

  // 5a: Tokens without winners
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
  console.log(`   ${coverage[0].pct_missing <= 1 ? '✅ PASS' : '⚠️  REVIEW'} - Coverage ${coverage[0].pct_missing <= 1 ? '≥99%' : '<99%'}\n`);

  // 5b: No NaN or Inf
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
  console.log(`   ${nan[0].bad === 0 ? '✅ PASS' : '❌ FAIL'} - No invalid values\n`);

  // ============================================================================
  // SUMMARY
  // ============================================================================
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const allChecks = [
    { name: 'Decode integrity', pass: decode[0].pct_ok === 100 },
    { name: 'Winner join correctness', pass: winners[0].empty_vectors === 0 && orphan[0].orphan_count === 0 },
    { name: 'Coverage', pass: coverage[0].pct_missing <= 1 },
    { name: 'No NaN/Inf', pass: nan[0].bad === 0 }
  ];

  allChecks.forEach(check => {
    console.log(`   ${check.pass ? '✅' : '❌'} ${check.name}`);
  });

  console.log();

  if (priceIsDecimal) {
    console.log('   ℹ️  Price is already decimal - current scaling is correct');
  } else {
    console.log('   ⚠️  Price appears to be in micros - scaling needs review');
  }

  console.log();

  if (hasPrices[0].cnt === 0) {
    console.log('   ⚠️  Cannot fully validate unrealized P&L without outcome_prices table');
    console.log('   📋 Next step: Backfill current prices from Polymarket API');
  }

  console.log();
}

main().catch(console.error);
