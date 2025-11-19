#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

async function main() {
  console.log('QUICK COVERAGE CHECK');
  console.log('═'.repeat(80));
  console.log();

  // 1. Check blockchain resolutions count
  console.log('1. Blockchain Resolutions in market_resolutions_final');
  console.log('─'.repeat(80));
  const bcCount = await client.query({
    query: `
      SELECT
        source,
        count(*) as total,
        countIf(length(condition_id_norm) = 64) as valid_ids,
        countIf(payout_denominator > 0) as valid_payouts
      FROM default.market_resolutions_final
      GROUP BY source
      ORDER BY source
    `,
    format: 'JSONEachRow',
  });

  const sources = await bcCount.json<any[]>();
  sources.forEach(s => {
    console.log(`  ${s.source}: ${s.total.toLocaleString()} records`);
    console.log(`    Valid IDs: ${s.valid_ids.toLocaleString()} (${(100*s.valid_ids/s.total).toFixed(1)}%)`);
    console.log(`    Valid payouts: ${s.valid_payouts.toLocaleString()} (${(100*s.valid_payouts/s.total).toFixed(1)}%)`);
  });
  console.log();

  // 2. Check total unique markets with resolutions
  console.log('2. Unique Markets with Resolutions');
  console.log('─'.repeat(80));
  const unique = await client.query({
    query: `
      SELECT count(DISTINCT condition_id_norm) as unique_markets
      FROM default.market_resolutions_final
      WHERE payout_denominator > 0
    `,
    format: 'JSONEachRow',
  });

  const uniq = (await unique.json<any[]>())[0];
  console.log(`  Total unique condition IDs: ${uniq.unique_markets.toLocaleString()}`);
  console.log();

  // 3. Check traded markets
  console.log('3. Total Traded Markets');
  console.log('─'.repeat(80));
  const traded = await client.query({
    query: `
      SELECT count(DISTINCT condition_id_norm) as traded_markets
      FROM default.vw_trades_canonical
      WHERE condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
        AND condition_id_norm != ''
    `,
    format: 'JSONEachRow',
  });

  const trd = (await traded.json<any[]>())[0];
  console.log(`  Total traded markets: ${trd.traded_markets.toLocaleString()}`);
  console.log();

  // 4. Calculate coverage with simple join
  console.log('4. Coverage Calculation (Direct Join)');
  console.log('─'.repeat(80));
  const coverage = await client.query({
    query: `
      SELECT
        count(DISTINCT t.condition_id_norm) as matched_markets
      FROM default.vw_trades_canonical t
      INNER JOIN default.market_resolutions_final r
        ON lower(t.condition_id_norm) = lower(concat('0x', r.condition_id_norm))
      WHERE t.condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
        AND r.payout_denominator > 0
    `,
    format: 'JSONEachRow',
  });

  const cov = (await coverage.json<any[]>())[0];
  const coveragePct = (100 * cov.matched_markets / trd.traded_markets).toFixed(1);

  console.log(`  Matched markets: ${cov.matched_markets.toLocaleString()}`);
  console.log(`  Coverage: ${coveragePct}%`);
  console.log();

  // 5. Sample P&L calculation test
  console.log('5. Sample P&L Calculation Test (5 trades)');
  console.log('─'.repeat(80));
  const pnlTest = await client.query({
    query: `
      SELECT
        t.wallet_address,
        t.condition_id_norm,
        t.side,
        t.shares,
        t.price,
        t.cost_basis_usd,
        r.winning_index,
        r.payout_numerators,
        r.payout_denominator,
        -- Calculate PnL
        CASE
          WHEN t.side = 'BUY' THEN
            (t.shares * (arrayElement(r.payout_numerators, r.winning_index + 1) / r.payout_denominator)) - t.cost_basis_usd
          WHEN t.side = 'SELL' THEN
            t.cost_basis_usd - (t.shares * (arrayElement(r.payout_numerators, r.winning_index + 1) / r.payout_denominator))
          ELSE 0
        END as pnl_usd
      FROM default.vw_trades_canonical t
      INNER JOIN default.market_resolutions_final r
        ON lower(t.condition_id_norm) = lower(concat('0x', r.condition_id_norm))
      WHERE r.payout_denominator > 0
        AND t.shares > 0
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });

  const pnlSamples = await pnlTest.json<any[]>();
  pnlSamples.forEach((row, idx) => {
    console.log(`  Trade ${idx + 1}:`);
    console.log(`    Wallet: ${row.wallet_address.substring(0, 10)}...`);
    console.log(`    Side: ${row.side}, Shares: ${row.shares}, Cost: $${row.cost_basis_usd.toFixed(2)}`);
    console.log(`    Winner index: ${row.winning_index}, Payout: ${row.payout_numerators[row.winning_index]}/${row.payout_denominator}`);
    console.log(`    P&L: $${row.pnl_usd.toFixed(2)}`);
  });
  console.log();

  console.log('═'.repeat(80));
  console.log('STATUS:');
  if (parseFloat(coveragePct) >= 60) {
    console.log(`✅ Coverage is ${coveragePct}% - Ready for P&L calculations!`);
  } else {
    console.log(`⚠️  Coverage is ${coveragePct}% - May need additional sources`);
  }
  console.log('═'.repeat(80));

  await client.close();
}

main().catch(console.error);
