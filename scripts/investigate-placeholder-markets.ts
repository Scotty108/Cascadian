#!/usr/bin/env tsx
/**
 * Investigate Placeholder Markets
 *
 * The 148K markets with empty source and zero payouts are placeholders.
 * Why do they exist? Are these markets:
 * - Still open (not yet resolved)?
 * - Cancelled/voided?
 * - Missing from api_markets_staging?
 * - Too old for our data sources?
 */

import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
});

async function main() {
  console.log('\n' + '═'.repeat(80));
  console.log('🔍 INVESTIGATING PLACEHOLDER MARKETS');
  console.log('   Why do 148K traded markets have empty resolution entries?');
  console.log('═'.repeat(80));

  // Step 1: Get sample of placeholder condition_ids (from fact_trades_clean)
  console.log('\n📊 Step 1: Getting sample placeholder condition_ids...\n');

  const placeholderSample = await ch.query({
    query: `
      WITH traded_markets AS (
        SELECT DISTINCT lower(replaceAll(cid, '0x', '')) as condition_id
        FROM default.fact_trades_clean
      ),
      all_resolutions AS (
        SELECT condition_id_norm, payout_denominator, source
        FROM default.market_resolutions_final
        UNION ALL
        SELECT condition_id, payout_denominator, source
        FROM default.resolutions_external_ingest
      ),
      placeholder_markets AS (
        SELECT tm.condition_id
        FROM traded_markets tm
        LEFT JOIN all_resolutions r ON tm.condition_id = r.condition_id_norm
        WHERE (r.source IS NULL OR r.source = '')
          AND (r.payout_denominator IS NULL OR r.payout_denominator = 0)
      )
      SELECT DISTINCT condition_id
      FROM placeholder_markets
      LIMIT 100
    `,
    format: 'JSONEachRow',
  });

  const placeholders = await placeholderSample.json();
  console.log(`  Found ${placeholders.length} sample placeholder condition_ids`);

  if (placeholders.length === 0) {
    console.log('\n  ⚠️  No placeholders found - investigation complete');
    await ch.close();
    return;
  }

  // Step 2: Check if these exist in api_markets_staging
  console.log('\n📊 Step 2: Checking api_markets_staging for placeholders...\n');

  const sampleCids = placeholders.slice(0, 20).map(p => `'${p.condition_id}'`).join(',');

  const stagingCheck = await ch.query({
    query: `
      SELECT
        lower(replaceAll(condition_id, '0x', '')) as cid_norm,
        question,
        outcomes,
        closed,
        active,
        end_date,
        market_slug
      FROM default.api_markets_staging
      WHERE lower(replaceAll(condition_id, '0x', '')) IN (${sampleCids})
    `,
    format: 'JSONEachRow',
  });

  const staging = await stagingCheck.json();
  console.log(`  Found ${staging.length} / 20 in api_markets_staging\n`);

  for (let i = 0; i < Math.min(5, staging.length); i++) {
    const s = staging[i];
    const cid = s.cid_norm.substring(0, 16) + '...';
    const question = s.question ? s.question.substring(0, 50) + '...' : 'N/A';
    const outcomes = s.outcomes ? `[${s.outcomes.join(', ')}]` : 'EMPTY';
    const closed = s.closed ? 'CLOSED' : 'OPEN';
    const active = s.active ? 'ACTIVE' : 'INACTIVE';

    console.log(`  ${i+1}. ${cid}`);
    console.log(`     Q: ${question}`);
    console.log(`     Outcomes: ${outcomes}`);
    console.log(`     Status: ${closed}, ${active}`);
    console.log();
  }

  // Step 3: Overall stats for placeholders in staging
  console.log('\n📊 Step 3: Overall placeholder coverage in api_markets_staging...\n');

  const overallCheck = await ch.query({
    query: `
      WITH traded_markets AS (
        SELECT DISTINCT lower(replaceAll(cid, '0x', '')) as condition_id
        FROM default.fact_trades_clean
      ),
      all_resolutions AS (
        SELECT condition_id_norm, payout_denominator, source
        FROM default.market_resolutions_final
        UNION ALL
        SELECT condition_id, payout_denominator, source
        FROM default.resolutions_external_ingest
      ),
      placeholder_markets AS (
        SELECT tm.condition_id
        FROM traded_markets tm
        LEFT JOIN all_resolutions r ON tm.condition_id = r.condition_id_norm
        WHERE (r.source IS NULL OR r.source = '')
          AND (r.payout_denominator IS NULL OR r.payout_denominator = 0)
      )
      SELECT
        COUNT(DISTINCT pm.condition_id) as total_placeholders,
        SUM(CASE WHEN ams.condition_id IS NOT NULL THEN 1 ELSE 0 END) as in_staging,
        SUM(CASE WHEN length(ams.outcomes) > 0 THEN 1 ELSE 0 END) as has_outcomes,
        SUM(CASE WHEN ams.closed = 1 THEN 1 ELSE 0 END) as is_closed,
        SUM(CASE WHEN ams.active = 1 THEN 1 ELSE 0 END) as is_active
      FROM placeholder_markets pm
      LEFT JOIN default.api_markets_staging ams
        ON pm.condition_id = lower(replaceAll(ams.condition_id, '0x', ''))
    `,
    format: 'JSONEachRow',
  });

  const overall = await overallCheck.json();
  const total = parseInt(overall[0].total_placeholders);
  const inStaging = parseInt(overall[0].in_staging);
  const hasOutcomes = parseInt(overall[0].has_outcomes);
  const closed = parseInt(overall[0].is_closed);
  const active = parseInt(overall[0].is_active);

  console.log(`  Total placeholder markets: ${total.toLocaleString()}`);
  console.log(`  In api_markets_staging: ${inStaging.toLocaleString()} (${(inStaging/total*100).toFixed(1)}%)`);
  console.log(`  Has outcome arrays: ${hasOutcomes.toLocaleString()} (${(hasOutcomes/total*100).toFixed(1)}%)`);
  console.log(`  Marked as closed: ${closed.toLocaleString()} (${(closed/total*100).toFixed(1)}%)`);
  console.log(`  Marked as active: ${active.toLocaleString()} (${(active/total*100).toFixed(1)}%)`);

  // Step 4: Check resolution_candidates for placeholders
  console.log('\n📊 Step 4: Checking resolution_candidates for placeholders...\n');

  const candidateStats = await ch.query({
    query: `
      WITH traded_markets AS (
        SELECT DISTINCT lower(replaceAll(cid, '0x', '')) as condition_id
        FROM default.fact_trades_clean
      ),
      all_resolutions AS (
        SELECT condition_id_norm, payout_denominator, source
        FROM default.market_resolutions_final
        UNION ALL
        SELECT condition_id, payout_denominator, source
        FROM default.resolutions_external_ingest
      ),
      placeholder_markets AS (
        SELECT tm.condition_id
        FROM traded_markets tm
        LEFT JOIN all_resolutions r ON tm.condition_id = r.condition_id_norm
        WHERE (r.source IS NULL OR r.source = '')
          AND (r.payout_denominator IS NULL OR r.payout_denominator = 0)
      )
      SELECT
        rc.outcome,
        rc.confidence,
        COUNT(*) as market_count
      FROM placeholder_markets pm
      LEFT JOIN default.resolution_candidates rc
        ON pm.condition_id = rc.condition_id_norm
      GROUP BY rc.outcome, rc.confidence
      ORDER BY market_count DESC
      LIMIT 20
    `,
    format: 'JSONEachRow',
  });

  const candidates = await candidateStats.json();
  console.log(`  Placeholder markets by resolution_candidates:\n`);
  for (const c of candidates) {
    const outcome = c.outcome || 'NULL';
    const conf = c.confidence !== null ? parseFloat(c.confidence).toFixed(2) : 'NULL';
    const count = parseInt(c.market_count).toLocaleString();
    console.log(`    ${outcome} (conf: ${conf}): ${count} markets`);
  }

  // Step 5: Check trade timing for placeholders
  console.log('\n📊 Step 5: Trade timing for placeholder markets...\n');

  const timingCheck = await ch.query({
    query: `
      WITH traded_markets AS (
        SELECT
          lower(replaceAll(cid, '0x', '')) as condition_id,
          MIN(block_time) as first_trade,
          MAX(block_time) as last_trade,
          COUNT(*) as trade_count
        FROM default.fact_trades_clean
        GROUP BY condition_id
      ),
      all_resolutions AS (
        SELECT condition_id_norm, payout_denominator, source
        FROM default.market_resolutions_final
        UNION ALL
        SELECT condition_id, payout_denominator, source
        FROM default.resolutions_external_ingest
      ),
      placeholder_markets AS (
        SELECT tm.condition_id, tm.first_trade, tm.last_trade, tm.trade_count
        FROM traded_markets tm
        LEFT JOIN all_resolutions r ON tm.condition_id = r.condition_id_norm
        WHERE (r.source IS NULL OR r.source = '')
          AND (r.payout_denominator IS NULL OR r.payout_denominator = 0)
      )
      SELECT
        toStartOfMonth(first_trade) as month,
        COUNT(*) as market_count,
        AVG(trade_count) as avg_trades
      FROM placeholder_markets
      GROUP BY month
      ORDER BY month DESC
      LIMIT 24
    `,
    format: 'JSONEachRow',
  });

  const timing = await timingCheck.json();
  console.log(`  Placeholder markets by first trade month:\n`);
  for (const t of timing) {
    const month = t.month;
    const count = parseInt(t.market_count).toLocaleString();
    const avgTrades = parseFloat(t.avg_trades).toFixed(1);
    const bar = '█'.repeat(Math.min(50, Math.floor(parseInt(t.market_count) / 1000)));
    console.log(`  ${month}: ${count.padStart(8)} markets (avg ${avgTrades} trades) ${bar}`);
  }

  console.log('\n' + '═'.repeat(80));
  console.log('🔍 INVESTIGATION COMPLETE');
  console.log('═'.repeat(80));

  await ch.close();
}

main().catch(err => {
  console.error('\n❌ Error:', err);
  process.exit(1);
});
