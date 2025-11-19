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
  console.log('Testing JOIN between vw_trades_canonical and vw_trades_canonical_v2');
  console.log('═'.repeat(80));
  console.log();

  // Test the join
  console.log('Checking join coverage...');
  const coverage = await client.query({
    query: `
      SELECT
        count() AS v1_total,
        countIf(v2.trade_id IS NOT NULL) AS matched,
        countIf(v2.is_resolved = 1) AS resolved,
        round(100.0 * matched / v1_total, 2) AS match_pct,
        round(100.0 * resolved / v1_total, 2) AS resolved_pct
      FROM default.vw_trades_canonical v1
      LEFT JOIN default.vw_trades_canonical_v2 v2 ON v1.trade_id = v2.trade_id
      LIMIT 1
    `,
    format: 'JSONEachRow',
  });

  const cov = (await coverage.json<Array<any>>())[0];
  console.log(`  v1 total:         ${cov.v1_total.toLocaleString()} trades`);
  console.log(`  Matched in v2:    ${cov.matched.toLocaleString()} (${cov.match_pct}%)`);
  console.log(`  Resolved:         ${cov.resolved.toLocaleString()} (${cov.resolved_pct}%)`);
  console.log();

  // Get sample joined data
  console.log('Sample joined data:');
  const sample = await client.query({
    query: `
      SELECT
        v1.trade_id,
        v1.wallet_address_norm,
        v1.condition_id_norm,
        v1.market_id_norm,
        v1.shares,
        v1.usd_value,
        v1.entry_price,
        v1.outcome_index,
        v2.is_resolved,
        v2.resolved_outcome
      FROM default.vw_trades_canonical v1
      LEFT JOIN default.vw_trades_canonical_v2 v2 ON v1.trade_id = v2.trade_id
      WHERE v2.is_resolved = 1
      LIMIT 3
    `,
    format: 'JSONEachRow',
  });

  const rows = await sample.json();
  console.log(JSON.stringify(rows, null, 2));
  console.log();

  // Check if we have condition_id normalization in v2
  console.log('Checking condition_id coverage in v2...');
  const cidCheck = await client.query({
    query: `
      SELECT
        count() AS total,
        countIf(length(condition_id_norm) > 0) AS with_cid
      FROM default.vw_trades_canonical_v2
    `,
    format: 'JSONEachRow',
  });

  const cid = (await cidCheck.json<Array<any>>())[0];
  console.log(`  v2 total:         ${cid.total.toLocaleString()}`);
  console.log(`  With condition_id: ${cid.with_cid.toLocaleString()}`);
  console.log();

  if (cov.match_pct > 0) {
    console.log('✅ Join works! We can combine both views.');
    console.log();
    console.log('Strategy:');
    console.log('  1. Use v1 for normalized IDs (wallet, condition_id, market_id)');
    console.log('  2. Use v2 for resolution data (is_resolved, resolved_outcome)');
    console.log('  3. Join vw_resolutions_all for payout vectors');
    console.log('  4. Calculate PnL per trade (no expensive aggregation!)');
  } else {
    console.log('❌ trade_id does not match between views');
  }

  await client.close();
}

main().catch(console.error);
