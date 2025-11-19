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
  console.log('QUICK OVERNIGHT STATUS CHECK');
  console.log('═'.repeat(80));
  console.log();

  // Get actual schema
  const schema = await client.query({
    query: "DESCRIBE TABLE default.market_resolutions_final",
    format: 'JSONEachRow',
  });
  
  const cols = await schema.json<Array<{name: string, type: string}>>();
  console.log('Table schema:');
  cols.forEach(c => console.log(`  ${c.name}: ${c.type}`));
  console.log();

  // Check what we have
  const data = await client.query({
    query: `
      SELECT
        count(*) as total_rows,
        count(DISTINCT condition_id_norm) as unique_conditions,
        countIf(source = 'blockchain') as blockchain_rows,
        countIf(source = 'api') as api_rows,
        countIf(payout_denominator = 0) as zero_denominators,
        min(block_number) as min_block,
        max(block_number) as max_block
      FROM default.market_resolutions_final
    `,
    format: 'JSONEachRow',
  });

  const stats = (await data.json<any[]>())[0];
  
  console.log('BLOCKCHAIN BACKFILL STATUS:');
  console.log(`  Total resolutions:       ${stats.total_rows.toLocaleString()}`);
  console.log(`  Unique markets:          ${stats.unique_conditions.toLocaleString()}`);
  console.log(`  From blockchain:         ${stats.blockchain_rows.toLocaleString()}`);
  console.log(`  From API:                ${stats.api_rows.toLocaleString()}`);
  console.log(`  Block range:             ${stats.min_block?.toLocaleString() || 'N/A'} → ${stats.max_block?.toLocaleString() || 'N/A'}`);
  console.log(`  Zero denominators:       ${stats.zero_denominators} (should be 0)`);
  console.log();

  // Coverage check
  const coverage = await client.query({
    query: `
      WITH 
        traded AS (
          SELECT count(DISTINCT condition_id_norm) as total
          FROM default.vw_trades_canonical
          WHERE condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
        ),
        resolved AS (
          SELECT count(DISTINCT lower(concat('0x', condition_id_norm))) as matched
          FROM default.market_resolutions_final r
          WHERE exists(
            SELECT 1 FROM default.vw_trades_canonical t
            WHERE lower(t.condition_id_norm) = lower(concat('0x', r.condition_id_norm))
          )
        )
      SELECT 
        traded.total as total_markets,
        resolved.matched as resolved_markets,
        (100.0 * resolved.matched / traded.total) as coverage_pct
      FROM traded, resolved
    `,
    format: 'JSONEachRow',
  });

  const cov = (await coverage.json<any[]>())[0];
  
  console.log('RESOLUTION COVERAGE:');
  console.log(`  Total markets traded:    ${cov.total_markets.toLocaleString()}`);
  console.log(`  Markets with resolution: ${cov.resolved_markets.toLocaleString()}`);
  console.log(`  Coverage:                ${cov.coverage_pct.toFixed(2)}%`);
  console.log();

  if (cov.coverage_pct >= 90) {
    console.log('🎉 PRODUCTION READY! Coverage ≥ 90%');
  } else if (cov.coverage_pct >= 80) {
    console.log('✅ READY FOR TESTING! Coverage ≥ 80%');
  } else if (cov.coverage_pct >= 60) {
    console.log('⏳ IN PROGRESS... Coverage ≥ 60%');
  } else {
    console.log('⚠️  STILL COLLECTING DATA... Coverage < 60%');
  }
  console.log();

  // Sample data
  console.log('SAMPLE RESOLUTIONS (3 most recent):');
  const samples = await client.query({
    query: `
      SELECT
        condition_id_norm,
        payout_numerators,
        payout_denominator,
        winning_index,
        source,
        block_number
      FROM default.market_resolutions_final
      ORDER BY updated_at DESC
      LIMIT 3
    `,
    format: 'JSONEachRow',
  });

  const sampleData = await samples.json<any[]>();
  sampleData.forEach((s, idx) => {
    console.log(`  ${idx + 1}. ${s.condition_id_norm.substring(0, 12)}... | payout:[${s.payout_numerators.join(',')}]/${s.payout_denominator} | winner:${s.winning_index} | source:${s.source} | block:${s.block_number?.toLocaleString() || 'N/A'}`);
  });
  console.log();

  console.log('═'.repeat(80));

  await client.close();
}

main().catch(console.error);
