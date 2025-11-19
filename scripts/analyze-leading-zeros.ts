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
  console.log('ANALYZING LEADING ZEROS PATTERN');
  console.log('═'.repeat(80));
  console.log();

  // Count how many resolutions have leading zeros (00, 000, etc.)
  console.log('Checking resolution CIDs with leading zeros...');
  const resLeadingZeros = await client.query({
    query: `
      SELECT
        (SELECT count() FROM default.market_resolutions_final) AS total,
        (SELECT count() FROM default.market_resolutions_final WHERE condition_id_norm LIKE '00%') AS with_leading_zeros,
        round(100.0 * with_leading_zeros / total, 2) AS pct
    `,
    format: 'JSONEachRow',
  });
  const resStats = (await resLeadingZeros.json<Array<{ total: number; with_leading_zeros: number; pct: number }>>())[0];

  console.log(`  Total resolutions:     ${resStats.total.toLocaleString()}`);
  console.log(`  With leading zeros:    ${resStats.with_leading_zeros.toLocaleString()} (${resStats.pct}%)`);
  console.log();

  // Count how many fact_trades have leading zeros
  console.log('Checking fact_trades CIDs with leading zeros...');
  const factLeadingZeros = await client.query({
    query: `
      SELECT
        (SELECT count(DISTINCT cid_hex) FROM cascadian_clean.fact_trades_clean) AS total,
        (SELECT count(DISTINCT cid_hex) FROM cascadian_clean.fact_trades_clean WHERE cid_hex LIKE '0x00%') AS with_leading_zeros,
        round(100.0 * with_leading_zeros / total, 2) AS pct
    `,
    format: 'JSONEachRow',
  });
  const factStats = (await factLeadingZeros.json<Array<{ total: number; with_leading_zeros: number; pct: number }>>())[0];

  console.log(`  Total fact CIDs:       ${factStats.total.toLocaleString()}`);
  console.log(`  With leading zeros:    ${factStats.with_leading_zeros.toLocaleString()} (${factStats.pct}%)`);
  console.log();

  console.log('═'.repeat(80));
  console.log('HYPOTHESIS');
  console.log('═'.repeat(80));
  console.log();

  if (resStats.pct > 90 && factStats.pct < 50) {
    console.log('❌ MAJOR DISCREPANCY:');
    console.log('   - Resolutions: mostly have leading zeros');
    console.log('   - Fact trades: mostly NO leading zeros');
    console.log();
    console.log('This suggests the CIDs are from completely different sources!');
    console.log('We need to find the REAL source of market resolution data.');
  } else {
    console.log('Patterns look similar - issue is elsewhere');
  }

  await client.close();
}

main().catch(console.error);
