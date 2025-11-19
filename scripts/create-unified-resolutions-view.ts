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

async function createUnifiedView() {
  console.log('Creating unified resolutions view with API backfill data...\n');
  console.log('═'.repeat(80));

  // Create the unified view that combines all resolution sources
  console.log('\n1. Creating vw_resolutions_unified view...');
  await client.exec({
    query: `
      CREATE OR REPLACE VIEW cascadian_clean.vw_resolutions_unified AS

      -- Source 1: market_resolutions_final (primary source, ~56K markets)
      SELECT
        lower(concat('0x', condition_id_norm)) AS cid_hex,
        winning_index,
        payout_numerators,
        payout_denominator,
        resolved_at,
        winning_outcome,
        'market_resolutions_final' AS source
      FROM default.market_resolutions_final
      WHERE payout_denominator > 0
        AND winning_index IS NOT NULL

      UNION ALL

      -- Source 2: gamma_markets (secondary source, for markets not in market_resolutions_final)
      SELECT
        lower(condition_id) AS cid_hex,
        -- Derive winning_index from outcome and outcomes array
        arrayFirstIndex(x -> lower(x) = lower(outcome), JSONExtract(outcomes_json, 'Array(String)')) - 1 AS winning_index,
        -- One-hot payout vector: winner gets 1, others get 0
        arrayMap(i -> if(i = winning_index + 1, toDecimal64(1, 8), toDecimal64(0, 8)),
                 range(1, length(JSONExtract(outcomes_json, 'Array(String)')) + 1)) AS payout_numerators,
        toDecimal64(1, 8) AS payout_denominator,
        now() AS resolved_at, -- We don't have resolution time from gamma_markets
        outcome AS winning_outcome,
        'gamma_markets' AS source
      FROM default.gamma_markets
      WHERE closed = 1
        AND length(outcome) > 0
        AND lower(condition_id) NOT IN (
          SELECT cid_hex FROM (
            SELECT lower(concat('0x', condition_id_norm)) AS cid_hex
            FROM default.market_resolutions_final
            WHERE payout_denominator > 0
          )
        )

      UNION ALL

      -- Source 3: API backfill (tertiary source, for markets not in other sources)
      SELECT
        lower(cid_hex) AS cid_hex,
        winning_index,
        payout_numerators,
        payout_denominator,
        resolution_time AS resolved_at,
        -- Derive winning_outcome from winning_index and outcomes array
        if(winning_index >= 0 AND winning_index < length(outcomes),
           arrayElement(outcomes, winning_index + 1),
           '') AS winning_outcome,
        'api_backfill' AS source
      FROM cascadian_clean.resolutions_src_api
      WHERE resolved = 1
        AND winning_index >= 0
        AND lower(cid_hex) NOT IN (
          SELECT cid_hex FROM (
            SELECT lower(concat('0x', condition_id_norm)) AS cid_hex
            FROM default.market_resolutions_final
            WHERE payout_denominator > 0

            UNION DISTINCT

            SELECT lower(condition_id) AS cid_hex
            FROM default.gamma_markets
            WHERE closed = 1 AND length(outcome) > 0
          )
        )
    `,
  });
  console.log('   ✅ vw_resolutions_unified created');

  // Verify the view
  console.log('\n2. Verifying unified view...');

  const counts = await client.query({
    query: `
      SELECT
        source,
        count(DISTINCT cid_hex) AS market_count,
        count() AS total_rows
      FROM cascadian_clean.vw_resolutions_unified
      GROUP BY source
      ORDER BY market_count DESC
    `,
    format: 'JSONEachRow',
  });

  const sourceBreakdown = await counts.json<Array<{
    source: string;
    market_count: number;
    total_rows: number;
  }>>();

  console.log('\n   Source breakdown:');
  let totalMarkets = 0;
  sourceBreakdown.forEach(s => {
    console.log(`     ${s.source.padEnd(30)} ${s.market_count.toLocaleString().padStart(10)} markets (${s.total_rows.toLocaleString()} rows)`);
    totalMarkets += s.market_count;
  });
  console.log(`     ${'TOTAL'.padEnd(30)} ${totalMarkets.toLocaleString().padStart(10)} markets`);

  // Check coverage against trades
  console.log('\n3. Checking coverage against trades...');

  const coverage = await client.query({
    query: `
      SELECT
        (SELECT count(DISTINCT condition_id_norm)
         FROM default.vw_trades_canonical
         WHERE condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000') AS total_traded,
        (SELECT count(DISTINCT t.condition_id_norm)
         FROM default.vw_trades_canonical t
         INNER JOIN cascadian_clean.vw_resolutions_unified r
           ON lower(t.condition_id_norm) = r.cid_hex
         WHERE t.condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000') AS matched,
        (SELECT count(DISTINCT condition_id_norm)
         FROM default.vw_trades_canonical
         WHERE condition_id_norm = '0x0000000000000000000000000000000000000000000000000000000000000000') AS zero_ids
    `,
    format: 'JSONEachRow',
  });

  const cov = (await coverage.json<Array<any>>())[0];
  const coveragePct = (100 * cov.matched / cov.total_traded).toFixed(1);

  console.log(`   Total unique markets traded: ${cov.total_traded.toLocaleString()}`);
  console.log(`   Markets with resolutions:    ${cov.matched.toLocaleString()} (${coveragePct}%)`);
  console.log(`   Markets missing resolutions: ${(cov.total_traded - cov.matched).toLocaleString()} (${(100 - parseFloat(coveragePct)).toFixed(1)}%)`);
  console.log(`   Zero-ID trades (excluded):   ${cov.zero_ids.toLocaleString()}`);

  console.log('\n═'.repeat(80));
  console.log('UNIFIED VIEW CREATED!\n');

  if (parseFloat(coveragePct) >= 95) {
    console.log('🎉🎉🎉 SUCCESS! Coverage ≥ 95%!');
  } else if (parseFloat(coveragePct) >= 80) {
    console.log('✅ Good coverage (≥80%). Consider running API backfill for remaining markets.');
  } else {
    console.log('⚠️  Coverage below 80%. Run API backfill to improve coverage.');
    console.log(`\nTo backfill missing markets, run:`);
    console.log(`  npx tsx setup-backfill-schema.ts`);
    console.log(`  npx tsx backfill-market-resolutions.ts`);
  }

  await client.close();
}

createUnifiedView().catch(console.error);
