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
  console.log('VERIFYING ACTUAL BLOCKCHAIN COVERAGE');
  console.log('═'.repeat(80));
  console.log();

  // 1. Total unique blockchain condition IDs
  const bcTotal = await client.query({
    query: `
      SELECT count(DISTINCT condition_id_norm) as total
      FROM default.market_resolutions_final
      WHERE source = 'blockchain'
    `,
    format: 'JSONEachRow',
  });
  const bcCount = (await bcTotal.json<any[]>())[0].total;
  console.log(`1. Total unique blockchain resolutions: ${bcCount.toLocaleString()}`);

  // 2. Total unique traded markets
  const tradedTotal = await client.query({
    query: `
      SELECT count(DISTINCT condition_id_norm) as total
      FROM default.vw_trades_canonical
      WHERE condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
    `,
    format: 'JSONEachRow',
  });
  const tradedCount = (await tradedTotal.json<any[]>())[0].total;
  console.log(`2. Total unique traded markets: ${tradedCount.toLocaleString()}`);
  console.log();

  // 3. Blockchain resolutions that MATCH traded markets
  const matched = await client.query({
    query: `
      SELECT count(DISTINCT r.condition_id_norm) as matched
      FROM default.market_resolutions_final r
      WHERE r.source = 'blockchain'
        AND concat('0x', r.condition_id_norm) IN (
          SELECT DISTINCT condition_id_norm
          FROM default.vw_trades_canonical
          WHERE condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
        )
    `,
    format: 'JSONEachRow',
  });
  const matchedCount = (await matched.json<any[]>())[0].matched;
  console.log(`3. Blockchain resolutions matching traded markets: ${matchedCount.toLocaleString()}`);

  // 4. Blockchain resolutions that DON'T match any trades
  const unmatched = await client.query({
    query: `
      SELECT count(DISTINCT r.condition_id_norm) as unmatched
      FROM default.market_resolutions_final r
      WHERE r.source = 'blockchain'
        AND concat('0x', r.condition_id_norm) NOT IN (
          SELECT DISTINCT condition_id_norm
          FROM default.vw_trades_canonical
          WHERE condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
        )
    `,
    format: 'JSONEachRow',
  });
  const unmatchedCount = (await unmatched.json<any[]>())[0].unmatched;
  console.log(`4. Blockchain resolutions WITHOUT any trades: ${unmatchedCount.toLocaleString()}`);
  console.log();

  // 5. Calculate percentages
  const matchPct = (100 * matchedCount / bcCount).toFixed(1);
  const unmatchPct = (100 * unmatchedCount / bcCount).toFixed(1);
  const coveragePct = (100 * matchedCount / tradedCount).toFixed(1);

  console.log('BREAKDOWN:');
  console.log('─'.repeat(80));
  console.log(`Blockchain resolutions:    ${bcCount.toLocaleString()}`);
  console.log(`  Matched to trades:       ${matchedCount.toLocaleString()} (${matchPct}%)`);
  console.log(`  Unmatched (no trades):   ${unmatchedCount.toLocaleString()} (${unmatchPct}%)`);
  console.log();
  console.log(`Traded markets:            ${tradedCount.toLocaleString()}`);
  console.log(`Coverage from blockchain:  ${matchedCount.toLocaleString()} (${coveragePct}%)`);
  console.log();

  // 6. Sample unmatched blockchain condition IDs
  if (unmatchedCount > 0) {
    console.log('SAMPLE UNMATCHED BLOCKCHAIN RESOLUTIONS:');
    console.log('─'.repeat(80));

    const samples = await client.query({
      query: `
        SELECT
          r.condition_id_norm,
          r.resolved_at,
          r.payout_numerators,
          r.payout_denominator
        FROM default.market_resolutions_final r
        WHERE r.source = 'blockchain'
          AND concat('0x', r.condition_id_norm) NOT IN (
            SELECT DISTINCT condition_id_norm
            FROM default.vw_trades_canonical
            WHERE condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
          )
        LIMIT 5
      `,
      format: 'JSONEachRow',
    });

    const sampleRows = await samples.json<any[]>();
    sampleRows.forEach((row, idx) => {
      console.log(`${idx + 1}. ${row.condition_id_norm}`);
      console.log(`   Resolved: ${row.resolved_at}`);
      console.log(`   Payout: ${row.payout_numerators}/${row.payout_denominator}`);
    });
  }
  console.log();

  // 7. Overall market resolution coverage (ALL sources)
  console.log('═'.repeat(80));
  console.log('OVERALL COVERAGE (ALL SOURCES):');
  console.log('═'.repeat(80));

  const overall = await client.query({
    query: `
      SELECT count(DISTINCT t.condition_id_norm) as covered
      FROM default.vw_trades_canonical t
      INNER JOIN default.market_resolutions_final r
        ON t.condition_id_norm = concat('0x', r.condition_id_norm)
      WHERE t.condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
        AND r.payout_denominator > 0
    `,
    format: 'JSONEachRow',
  });

  const overallCovered = (await overall.json<any[]>())[0].covered;
  const overallPct = (100 * overallCovered / tradedCount).toFixed(1);

  console.log(`Total traded markets:      ${tradedCount.toLocaleString()}`);
  console.log(`Markets with resolutions:  ${overallCovered.toLocaleString()} (${overallPct}%)`);
  console.log(`Markets still missing:     ${(tradedCount - overallCovered).toLocaleString()}`);
  console.log();

  await client.close();
}

main().catch(console.error);
