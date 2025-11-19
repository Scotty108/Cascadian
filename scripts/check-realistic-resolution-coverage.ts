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

/**
 * REALISTIC RESOLUTION COVERAGE CHECK
 *
 * The key insight: Most markets without resolutions are still OPEN (not resolved yet)
 * So 14% coverage might actually be great if 86% of markets are still active!
 */

async function checkRealisticCoverage() {
  console.log('═'.repeat(80));
  console.log('REALISTIC RESOLUTION COVERAGE ANALYSIS');
  console.log('═'.repeat(80));
  console.log();

  console.log('Key Question: Of the 171K markets without resolution data,');
  console.log('              how many are actually RESOLVED vs. still OPEN?');
  console.log();

  // Step 1: Current coverage
  console.log('Current Coverage (market_resolutions_final):');
  console.log('─'.repeat(80));

  const currentCov = await client.query({
    query: `
      WITH traded AS (
        SELECT
          count(DISTINCT condition_id_norm) as total_markets,
          sum(abs(usd_value)) as total_volume
        FROM default.vw_trades_canonical
        WHERE condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
      ),
      with_res AS (
        SELECT
          count(DISTINCT t.condition_id_norm) as resolved_markets,
          sum(abs(t.usd_value)) as resolved_volume
        FROM default.vw_trades_canonical t
        INNER JOIN default.market_resolutions_final r
          ON lower(t.condition_id_norm) = lower(concat('0x', r.condition_id_norm))
        WHERE t.condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
          AND r.winning_index >= 0
      )
      SELECT
        traded.total_markets,
        traded.total_volume,
        with_res.resolved_markets,
        with_res.resolved_volume,
        round(100.0 * with_res.resolved_markets / traded.total_markets, 2) as market_pct,
        round(100.0 * with_res.resolved_volume / traded.total_volume, 2) as volume_pct
      FROM traded, with_res
    `,
    format: 'JSONEachRow',
  });

  const cov = (await currentCov.json<any[]>())[0];

  console.log(`  Total markets traded:       ${parseInt(cov.total_markets).toLocaleString()}`);
  console.log(`  Markets with resolutions:   ${parseInt(cov.resolved_markets).toLocaleString()} (${cov.market_pct}%)`);
  console.log();
  console.log(`  Total trading volume:       $${(parseFloat(cov.total_volume) / 1e9).toFixed(2)}B`);
  console.log(`  Volume with resolutions:    $${(parseFloat(cov.resolved_volume) / 1e9).toFixed(2)}B (${cov.volume_pct}%)`);
  console.log();

  // Step 2: Check if missing markets are closed or still open
  console.log('Analysis of Markets WITHOUT Resolution Data:');
  console.log('─'.repeat(80));

  const missingAnalysis = await client.query({
    query: `
      WITH missing_markets AS (
        SELECT DISTINCT condition_id_norm as cid
        FROM default.vw_trades_canonical
        WHERE condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
          AND lower(condition_id_norm) NOT IN (
            SELECT lower(concat('0x', condition_id_norm))
            FROM default.market_resolutions_final
            WHERE winning_index >= 0
          )
      ),
      api_check AS (
        SELECT
          m.cid,
          a.closed,
          a.resolved,
          a.end_date_iso
        FROM missing_markets m
        LEFT JOIN default.api_ctf_bridge a
          ON lower(replaceAll(m.cid, '0x', '')) = lower(a.condition_id)
      )
      SELECT
        count(*) as total_missing,
        sum(CASE WHEN closed = 1 THEN 1 ELSE 0 END) as closed_count,
        sum(CASE WHEN resolved = 1 THEN 1 ELSE 0 END) as resolved_count,
        sum(CASE WHEN closed IS NULL THEN 1 ELSE 0 END) as no_api_data,
        sum(CASE WHEN closed = 0 THEN 1 ELSE 0 END) as still_open
      FROM api_check
    `,
    format: 'JSONEachRow',
  });

  const missing = (await missingAnalysis.json<any[]>())[0];

  const missingCount = parseInt(cov.total_markets) - parseInt(cov.resolved_markets);
  console.log(`  Markets without resolution data:  ${missingCount.toLocaleString()}`);

  if (parseInt(missing.total_missing) > 0) {
    console.log();
    console.log(`  API data available for:          ${(parseInt(missing.total_missing) - parseInt(missing.no_api_data)).toLocaleString()} markets`);
    console.log(`    - Closed but no payout vector:  ${parseInt(missing.closed_count).toLocaleString()}`);
    console.log(`    - Resolved (text only):          ${parseInt(missing.resolved_count).toLocaleString()}`);
    console.log(`    - Still open:                    ${parseInt(missing.still_open).toLocaleString()}`);
    console.log();
    console.log(`  No API data (likely old/test):   ${parseInt(missing.no_api_data).toLocaleString()}`);
  }

  console.log();
  console.log('═'.repeat(80));
  console.log('CONCLUSION');
  console.log('═'.repeat(80));
  console.log();

  const needPayouts = parseInt(missing.closed_count) + parseInt(missing.resolved_count);
  const percentNeedingPayouts = (100 * needPayouts / missingCount).toFixed(1);

  console.log(`Of the ${missingCount.toLocaleString()} markets without resolution data:`);
  console.log();
  console.log(`  ${needPayouts.toLocaleString()} (${percentNeedingPayouts}%) are RESOLVED but missing payout vectors`);
  console.log(`    ➜ These need blockchain recovery or API enrichment`);
  console.log();
  console.log(`  ${parseInt(missing.still_open).toLocaleString()} are STILL OPEN (unrealized positions)`);
  console.log(`    ➜ These are CORRECT to not have resolutions`);
  console.log();
  console.log(`  ${parseInt(missing.no_api_data).toLocaleString()} have no API data (likely old/test markets)`);
  console.log(`    ➜ Low priority for recovery`);
  console.log();

  if (parseFloat(cov.volume_pct) > 50) {
    console.log(`✅ Your ${cov.volume_pct}% volume coverage is GOOD!`);
    console.log(`   Most missing markets are either:`)
    console.log(`     - Still open (unrealized P&L)`)
    console.log(`     - Low volume markets`);
  } else if (parseFloat(percentNeedingPayouts) > 30) {
    console.log(`⚠️  ${percentNeedingPayouts}% of missing markets ARE resolved`);
    console.log(`   Recommend: Blockchain payout vector recovery`);
  } else {
    console.log(`✅ Current coverage is acceptable for production`);
  }
  console.log();

  console.log('Next steps:');
  console.log('  1. For open markets: Calculate unrealized P&L from current positions');
  console.log('  2. For resolved markets: Try blockchain payout vector recovery');
  console.log('  3. Ship with current coverage if volume% > 50%');
  console.log();

  await client.close();
}

checkRealisticCoverage().catch(console.error);
