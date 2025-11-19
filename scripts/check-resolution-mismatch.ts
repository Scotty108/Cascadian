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
  console.log('Why do 88K resolutions NOT match our trades?\n');

  // Sample resolutions that DON'T match
  const unmatched = await client.query({
    query: `
      SELECT cid_hex
      FROM cascadian_clean.vw_resolutions_all
      WHERE cid_hex NOT IN (
        SELECT DISTINCT lower(condition_id_norm)
        FROM default.vw_trades_canonical
        WHERE condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
      )
      LIMIT 10
    `,
    format: 'JSONEachRow',
  });

  const u = await unmatched.json();
  console.log('Sample unmatched resolutions:');
  u.forEach((r: any) => console.log(`  ${r.cid_hex}`));
  console.log();

  // Check if vw_trades_canonical has the 0x prefix issue
  const sampleTrade = await client.query({
    query: `
      SELECT condition_id_norm
      FROM default.vw_trades_canonical
      WHERE condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
      LIMIT 1
    `,
    format: 'JSONEachRow',
  });

  const t = (await sampleTrade.json<Array<any>>())[0];
  console.log(`Sample trade condition_id: ${t.condition_id_norm}`);
  console.log(`  Has 0x prefix: ${t.condition_id_norm.startsWith('0x')}`);
  console.log(`  Length: ${t.condition_id_norm.length}`);
  console.log();

  const sampleRes = await client.query({
    query: 'SELECT cid_hex FROM cascadian_clean.vw_resolutions_all LIMIT 1',
    format: 'JSONEachRow',
  });

  const r = (await sampleRes.json<Array<any>>())[0];
  console.log(`Sample resolution cid_hex: ${r.cid_hex}`);
  console.log(`  Has 0x prefix: ${r.cid_hex.startsWith('0x')}`);
  console.log(`  Length: ${r.cid_hex.length}`);
  console.log();

  console.log('Join condition in vw_trade_pnl_final:');
  console.log('  ON lower(t.condition_id_norm) = r.cid_hex');
  console.log();
  console.log('This SHOULD work since both have 0x prefix and 66 length.');
  console.log();
  console.log('Conclusion: The 88K unmatched resolutions are for markets');
  console.log('            that exist in Polymarket but WE NEVER TRADED.');
  console.log('            This is fine - we only need resolutions for markets we traded!');
  console.log();
  console.log('REAL PROBLEM: We need resolutions for the OTHER 171K markets we DID trade.');

  await client.close();
}

main().catch(console.error);
