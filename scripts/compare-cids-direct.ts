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
  console.log('DIRECT CID COMPARISON');
  console.log('═'.repeat(80));
  console.log();

  // Get 10 sample CIDs from fact_trades_clean
  console.log('Sample CIDs from fact_trades_clean:');
  const factResult = await client.query({
    query: 'SELECT DISTINCT cid_hex FROM cascadian_clean.fact_trades_clean LIMIT 10',
    format: 'JSONEachRow',
  });
  const factCids = (await factResult.json<Array<{ cid_hex: string }>>()).map(r => r.cid_hex);
  factCids.forEach((cid, i) => console.log(`  ${i + 1}. ${cid}`));
  console.log();

  // Get 10 sample CIDs from market_resolutions_final (normalized)
  console.log('Sample CIDs from market_resolutions_final (normalized):');
  const resResult = await client.query({
    query: `
      SELECT DISTINCT lower(concat('0x', condition_id_norm)) AS cid_hex
      FROM default.market_resolutions_final
      LIMIT 10
    `,
    format: 'JSONEachRow',
  });
  const resCids = (await resResult.json<Array<{ cid_hex: string }>>()).map(r => r.cid_hex);
  resCids.forEach((cid, i) => console.log(`  ${i + 1}. ${cid}`));
  console.log();

  // Check if ANY of the fact CIDs match ANY of the resolution CIDs
  console.log('Direct overlap check on these 20 CIDs:');
  const factSet = new Set(factCids);
  const resSet = new Set(resCids);
  const overlap = factCids.filter(cid => resSet.has(cid));
  console.log(`Matches in sample: ${overlap.length}/10`);
  console.log();

  // Now check if the FIRST fact CID exists in resolutions
  console.log('Checking if first fact CID exists in market_resolutions_final...');
  const checkResult = await client.query({
    query: `
      SELECT
        condition_id_norm,
        lower(concat('0x', condition_id_norm)) AS normalized_cid
      FROM default.market_resolutions_final
      WHERE lower(concat('0x', condition_id_norm)) = '${factCids[0]}'
      LIMIT 1
    `,
    format: 'JSONEachRow',
  });
  const matches = await checkResult.json();
  if (matches.length > 0) {
    console.log('✅ FOUND!');
    console.log(JSON.stringify(matches[0], null, 2));
  } else {
    console.log('❌ NOT FOUND');
  }
  console.log();

  // Reverse check - does the first resolution CID exist in fact_trades?
  console.log('Checking if first resolution CID exists in fact_trades_clean...');
  const reverseCheckResult = await client.query({
    query: `
      SELECT cid_hex
      FROM cascadian_clean.fact_trades_clean
      WHERE cid_hex = '${resCids[0]}'
      LIMIT 1
    `,
    format: 'JSONEachRow',
  });
  const reverseMatches = await reverseCheckResult.json();
  if (reverseMatches.length > 0) {
    console.log('✅ FOUND!');
  } else {
    console.log('❌ NOT FOUND');
  }
  console.log();

  await client.close();
}

main().catch(console.error);
