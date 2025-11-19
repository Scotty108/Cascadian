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
  console.log('REAL COVERAGE CALCULATION - NO MORE BULLSHIT\n');
  console.log('═'.repeat(80));

  const coverage = await client.query({
    query: `
      SELECT
        (SELECT count(DISTINCT condition_id_norm)
         FROM default.vw_trades_canonical
         WHERE condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000') AS total_markets_traded,
        
        (SELECT count(DISTINCT cid_hex)
         FROM cascadian_clean.vw_resolutions_all) AS total_resolutions_in_db,
        
        (SELECT count(DISTINCT t.condition_id_norm)
         FROM default.vw_trades_canonical t
         INNER JOIN cascadian_clean.vw_resolutions_all r
           ON lower(t.condition_id_norm) = r.cid_hex
         WHERE t.condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000') AS markets_with_both_trades_and_resolutions
    `,
    format: 'JSONEachRow',
  });

  const c = (await coverage.json<Array<any>>())[0];

  console.log('THE TRUTH:');
  console.log();
  console.log(`Markets we have traded:                 ${c.total_markets_traded.toLocaleString()}`);
  console.log(`Resolutions in database:                ${c.total_resolutions_in_db.toLocaleString()}`);
  console.log(`Markets with BOTH trades + resolutions: ${c.markets_with_both_trades_and_resolutions.toLocaleString()}`);
  console.log();

  const coveragePct = (100 * c.markets_with_both_trades_and_resolutions / c.total_markets_traded).toFixed(1);
  const missing = c.total_markets_traded - c.markets_with_both_trades_and_resolutions;

  console.log(`COVERAGE: ${coveragePct}% of traded markets have resolutions`);
  console.log(`MISSING:  ${missing.toLocaleString()} markets (${(100 - parseFloat(coveragePct)).toFixed(1)}%)`);
  console.log();

  console.log('═'.repeat(80));
  console.log();

  if (parseFloat(coveragePct) > 60) {
    console.log('✅✅✅ ACTUALLY WE HAVE GOOD COVERAGE!');
    console.log();
    console.log(`Only ${missing.toLocaleString()} markets are missing resolutions.`);
    console.log('These are likely:');
    console.log('  - OPEN markets (still trading)');
    console.log('  - Recent markets (not yet resolved)');
    console.log();
    console.log('API backfill of these would bring us to ~95-100% coverage');
  } else {
    console.log(`Still missing ${coveragePct}% - need API backfill`);
  }

  await client.close();
}

main().catch(console.error);
