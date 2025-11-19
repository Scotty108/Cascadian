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
  console.log('OVERNIGHT BACKFILL STATUS REPORT');
  console.log('═'.repeat(100));
  console.log();

  // Basic stats
  const stats = await client.query({
    query: `
      SELECT
        count(*) as total_rows,
        count(DISTINCT condition_id_norm) as unique_conditions,
        countIf(source = 'blockchain') as blockchain_rows,
        countIf(source = 'api') as api_rows,
        countIf(payout_denominator = 0) as invalid_payouts
      FROM default.market_resolutions_final
    `,
    format: 'JSONEachRow',
  });

  const data = (await stats.json<any[]>())[0];
  
  console.log('1. DATABASE STATUS');
  console.log('─'.repeat(100));
  console.log(`Total resolution records:      ${data.total_rows.toLocaleString()}`);
  console.log(`Unique markets resolved:       ${data.unique_conditions.toLocaleString()}`);
  console.log(`  - From blockchain:           ${data.blockchain_rows.toLocaleString()}`);
  console.log(`  - From API:                  ${data.api_rows.toLocaleString()}`);
  console.log(`  - Invalid (zero denom):      ${data.invalid_payouts}`);
  console.log();

  // Coverage analysis
  const coverage = await client.query({
    query: `
      WITH 
        all_traded AS (
          SELECT count(DISTINCT condition_id_norm) as cnt
          FROM default.vw_trades_canonical
          WHERE condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
        ),
        with_resolutions AS (
          SELECT count(DISTINCT t.condition_id_norm) as cnt
          FROM default.vw_trades_canonical t
          INNER JOIN default.market_resolutions_final r
            ON lower(t.condition_id_norm) = lower(concat('0x', r.condition_id_norm))
          WHERE t.condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
        )
      SELECT 
        all_traded.cnt as total,
        with_resolutions.cnt as resolved,
        (100.0 * with_resolutions.cnt / all_traded.cnt) as coverage_pct
      FROM all_traded, with_resolutions
    `,
    format: 'JSONEachRow',
  });

  const cov = (await coverage.json<any[]>())[0];
  
  console.log('2. RESOLUTION COVERAGE');
  console.log('─'.repeat(100));
  console.log(`Markets with trades:           ${cov.total.toLocaleString()}`);
  console.log(`Markets with resolutions:      ${cov.resolved.toLocaleString()}`);
  console.log(`Coverage:                      ${cov.coverage_pct.toFixed(2)}%`);
  console.log();

  if (cov.coverage_pct >= 90) {
    console.log('🎉🎉🎉 PRODUCTION READY! Coverage ≥ 90%');
  } else if (cov.coverage_pct >= 80) {
    console.log('✅ READY FOR TESTING! Coverage ≥ 80%');
  } else if (cov.coverage_pct >= 60) {
    console.log('⏳ IN PROGRESS... Coverage ≥ 60% - backfill continuing');
  } else {
    console.log('⚠️  STILL COLLECTING... Coverage < 60%');
  }
  console.log();

  // Data quality check
  console.log('3. DATA QUALITY');
  console.log('─'.repeat(100));
  
  const quality = await client.query({
    query: `
      SELECT
        countIf(length(condition_id_norm) != 64) as bad_condition_ids,
        countIf(payout_denominator = 0) as zero_denominators,
        countIf(length(payout_numerators) = 0) as empty_payout_arrays,
        countIf(winning_index > 100) as suspicious_winning_index
      FROM default.market_resolutions_final
    `,
    format: 'JSONEachRow',
  });

  const qData = (await quality.json<any[]>())[0];
  
  console.log(`Bad condition IDs:             ${qData.bad_condition_ids} ${qData.bad_condition_ids === 0 ? '✓' : '❌'}`);
  console.log(`Zero denominators:             ${qData.zero_denominators} ${qData.zero_denominators === 0 ? '✓' : '❌'}`);
  console.log(`Empty payout arrays:           ${qData.empty_payout_arrays} ${qData.empty_payout_arrays === 0 ? '✓' : '❌'}`);
  console.log(`Suspicious winning index:      ${qData.suspicious_winning_index} ${qData.suspicious_winning_index === 0 ? '✓' : '❌'}`);
  console.log();

  // Sample data
  console.log('4. SAMPLE DATA (3 most recent)');
  console.log('─'.repeat(100));
  
  const samples = await client.query({
    query: `
      SELECT
        condition_id_norm,
        payout_numerators,
        payout_denominator,
        winning_index,
        source
      FROM default.market_resolutions_final
      ORDER BY updated_at DESC
      LIMIT 3
    `,
    format: 'JSONEachRow',
  });

  const sampleData = await samples.json<any[]>();
  sampleData.forEach((s, idx) => {
    console.log(`${idx + 1}. ${s.condition_id_norm.substring(0, 16)}... | [${s.payout_numerators.join(',')}]/${s.payout_denominator} | winner:${s.winning_index} | source:${s.source}`);
  });
  console.log();

  console.log('═'.repeat(100));
  console.log('STATUS REPORT COMPLETE');
  console.log('═'.repeat(100));

  await client.close();
}

main().catch(console.error);
