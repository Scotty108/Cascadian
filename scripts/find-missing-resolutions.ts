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
console.log('═'.repeat(80));
console.log('FIND MISSING RESOLUTIONS');
console.log('═'.repeat(80));
console.log();

// Get sample CIDs from fact_trades_clean
console.log('Getting sample CIDs from fact_trades_clean...');
const sampleFact = await client.query({
  query: `
    SELECT DISTINCT cid_hex
    FROM cascadian_clean.fact_trades_clean
    LIMIT 100
  `,
  format: 'JSONEachRow',
});

const factCids = (await sampleFact.json<Array<{ cid_hex: string }>>()).map(r => r.cid_hex);
console.log(`Got ${factCids.length} sample CIDs`);
console.log();

// Check each against market_resolutions_final
console.log('Checking against market_resolutions_final:');
console.log('─'.repeat(80));

let found = 0;
let missing = 0;

for (const cid of factCids.slice(0, 20)) {
  const cid_no_0x = cid.replace('0x', '');

  const check = await client.query({
    query: `
      SELECT
        condition_id_norm,
        winning_index,
        payout_numerators,
        payout_denominator
      FROM default.market_resolutions_final
      WHERE lower(condition_id_norm) = lower('${cid_no_0x}')
    `,
    format: 'JSONEachRow',
  });

  const results = await check.json<Array<{
    condition_id_norm: string;
    winning_index: number;
    payout_numerators: number[];
    payout_denominator: number;
  }>>();

  if (results.length > 0) {
    const r = results[0];
    console.log(`✅ ${cid.substring(0, 20)}...`);
    console.log(`   Winner: ${r.winning_index} | Payouts: ${r.payout_numerators} | Denom: ${r.payout_denominator}`);
    found++;
  } else {
    console.log(`❌ ${cid.substring(0, 20)}... → NOT FOUND`);
    missing++;
  }
}

console.log();
console.log(`Sample Match Rate: ${found}/${found + missing} (${(100 * found / (found + missing)).toFixed(1)}%)`);
console.log();

// Now check if gamma_markets or other tables have the missing ones
console.log('Checking other resolution sources for missing CIDs:');
console.log('─'.repeat(80));

const missingCids = [];
for (const cid of factCids.slice(0, 20)) {
  const cid_no_0x = cid.replace('0x', '');
  const check = await client.query({
    query: `SELECT count() AS c FROM default.market_resolutions_final WHERE lower(condition_id_norm) = lower('${cid_no_0x}')`,
    format: 'JSONEachRow',
  });
  if ((await check.json())[0].c === 0) {
    missingCids.push(cid);
  }
}

if (missingCids.length > 0) {
  console.log(`\nChecking ${missingCids.length} missing CIDs in gamma_markets:`);

  for (const cid of missingCids.slice(0, 5)) {
    const cid_no_0x = cid.replace('0x', '');

    const gammaCheck = await client.query({
      query: `
        SELECT
          condition_id,
          question,
          outcomes_json
        FROM default.gamma_markets
        WHERE lower(replaceAll(condition_id, '0x', '')) = lower('${cid_no_0x}')
        LIMIT 1
      `,
      format: 'JSONEachRow',
    });

    const gamma = await gammaCheck.json();
    if (gamma.length > 0) {
      console.log(`  ✅ ${cid.substring(0, 20)}... → FOUND in gamma_markets`);
      console.log(`     Question: ${gamma[0].question?.substring(0, 60)}...`);
    } else {
      console.log(`  ❌ ${cid.substring(0, 20)}... → NOT in gamma_markets either`);
    }
  }
}

console.log();
console.log('═'.repeat(80));
console.log('CONCLUSION');
console.log('═'.repeat(80));
console.log();

if (missing === 0) {
  console.log('✅ All sample CIDs have resolutions!');
  console.log('   The 75% missing rate must be from different issue');
  console.log('   Possible: CIDs in fact_trades are malformed or from unresolved markets');
} else {
  const missingPct = (100 * missing / (found + missing)).toFixed(1);
  console.log(`❌ ${missingPct}% of sample CIDs have NO resolution data`);
  console.log('   These markets either:');
  console.log('   - Are still OPEN (unresolved)');
  console.log('   - Were never backfilled from Polymarket API');
  console.log('   - Have incorrect condition_id format');
}

await client.close();
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
