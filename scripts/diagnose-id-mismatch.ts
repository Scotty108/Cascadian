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
  console.log('DIAGNOSING CONDITION ID MISMATCH');
  console.log('═'.repeat(80));
  console.log();

  // Check sample IDs from blockchain resolutions
  console.log('1. Sample Blockchain Resolution IDs');
  console.log('─'.repeat(80));
  const bcSample = await client.query({
    query: `
      SELECT
        condition_id_norm,
        length(condition_id_norm) as id_len,
        substring(condition_id_norm, 1, 10) as id_prefix
      FROM default.market_resolutions_final
      WHERE source = 'blockchain'
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });

  const bcIds = await bcSample.json<any[]>();
  bcIds.forEach((row, idx) => {
    console.log(`  ${idx + 1}. ${row.condition_id_norm} (length: ${row.id_len})`);
  });
  console.log();

  // Check sample IDs from trades
  console.log('2. Sample Trade IDs');
  console.log('─'.repeat(80));
  const tradeSample = await client.query({
    query: `
      SELECT DISTINCT
        condition_id_norm,
        length(condition_id_norm) as id_len,
        substring(condition_id_norm, 1, 10) as id_prefix
      FROM default.vw_trades_canonical
      WHERE condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });

  const tradeIds = await tradeSample.json<any[]>();
  tradeIds.forEach((row, idx) => {
    console.log(`  ${idx + 1}. ${row.condition_id_norm} (length: ${row.id_len})`);
  });
  console.log();

  // Try different join approaches
  console.log('3. Testing Join Approaches');
  console.log('─'.repeat(80));

  // Approach 1: Direct match
  const approach1 = await client.query({
    query: `
      SELECT count(DISTINCT t.condition_id_norm) as matched
      FROM default.vw_trades_canonical t
      INNER JOIN default.market_resolutions_final r
        ON t.condition_id_norm = r.condition_id_norm
      WHERE r.source = 'blockchain'
    `,
    format: 'JSONEachRow',
  });
  const a1 = (await approach1.json<any[]>())[0];
  console.log(`  Direct match (t.cid = r.cid): ${a1.matched.toLocaleString()}`);

  // Approach 2: Add 0x to resolutions
  const approach2 = await client.query({
    query: `
      SELECT count(DISTINCT t.condition_id_norm) as matched
      FROM default.vw_trades_canonical t
      INNER JOIN default.market_resolutions_final r
        ON t.condition_id_norm = concat('0x', r.condition_id_norm)
      WHERE r.source = 'blockchain'
    `,
    format: 'JSONEachRow',
  });
  const a2 = (await approach2.json<any[]>())[0];
  console.log(`  With 0x prefix (t.cid = '0x' + r.cid): ${a2.matched.toLocaleString()}`);

  // Approach 3: Remove 0x from trades
  const approach3 = await client.query({
    query: `
      SELECT count(DISTINCT t.condition_id_norm) as matched
      FROM default.vw_trades_canonical t
      INNER JOIN default.market_resolutions_final r
        ON replaceAll(t.condition_id_norm, '0x', '') = r.condition_id_norm
      WHERE r.source = 'blockchain'
    `,
    format: 'JSONEachRow',
  });
  const a3 = (await approach3.json<any[]>())[0];
  console.log(`  Strip 0x from trades (t.cid - '0x' = r.cid): ${a3.matched.toLocaleString()}`);

  // Approach 4: Lowercase both
  const approach4 = await client.query({
    query: `
      SELECT count(DISTINCT t.condition_id_norm) as matched
      FROM default.vw_trades_canonical t
      INNER JOIN default.market_resolutions_final r
        ON lower(t.condition_id_norm) = lower(concat('0x', r.condition_id_norm))
      WHERE r.source = 'blockchain'
    `,
    format: 'JSONEachRow',
  });
  const a4 = (await approach4.json<any[]>())[0];
  console.log(`  Lowercase + 0x (lower(t.cid) = lower('0x' + r.cid)): ${a4.matched.toLocaleString()}`);

  console.log();
  console.log('═'.repeat(80));
  console.log('CONCLUSION:');
  const winner = Math.max(a1.matched, a2.matched, a3.matched, a4.matched);
  if (winner === a1.matched) console.log(`✅ Use: Direct match`);
  if (winner === a2.matched) console.log(`✅ Use: Add '0x' prefix to resolutions`);
  if (winner === a3.matched) console.log(`✅ Use: Strip '0x' from trades`);
  if (winner === a4.matched) console.log(`✅ Use: Lowercase + '0x' prefix`);
  console.log(`Best match: ${winner.toLocaleString()} markets`);
  console.log('═'.repeat(80));

  await client.close();
}

main().catch(console.error);
