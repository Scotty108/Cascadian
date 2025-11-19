import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  console.log("Checking gamma_resolved for duplicates...\n");

  // Check for duplicate condition_ids
  const dupCheck = await clickhouse.query({
    query: `
      SELECT
        cid,
        count(*) as dup_count,
        groupArray(winning_outcome) as outcomes,
        groupArray(toString(fetched_at)) as fetch_times
      FROM gamma_resolved
      GROUP BY cid
      HAVING count(*) > 1
      ORDER BY dup_count DESC
      LIMIT 20
    `,
    format: 'JSONEachRow'
  });
  const dups = await dupCheck.json();

  if (dups.length > 0) {
    console.log(`❌ Found ${dups.length} duplicate condition_ids in gamma_resolved:\n`);
    console.table(dups.slice(0, 10).map((d: any) => ({
      cid: d.cid.substring(0, 12) + '...',
      count: d.dup_count,
      outcomes: JSON.stringify(d.outcomes),
      times: JSON.stringify(d.fetch_times)
    })));

    // Check if our problematic markets are in this list
    const problemCids = [
      '642926331d6587d24ce01ba64be65870ff073029a11c16df67933d55e8e72b28',
      '265366ede72d05f47ea2d9992b8bcdf5bff97b5f1e1e2e0c165871c87ad3bec0',
      'a0811c97f5299ad5c5e2aa81d7fdf24129e61ac4ef43c13b1c3bbb4ba74e3e76',
      'c7599c7b33b64f891750b57439384d163f547600fed4a6007918751f8f37740d',
      'c6485bb7ea46fd7c9baa0a8bb7cc11aa1baa64b050e1eacc7f15d77bb09e0e35'
    ];

    console.log("\nChecking our 5 problematic markets:");
    for (const cid of problemCids) {
      const checkQuery = await clickhouse.query({
        query: `
          SELECT count(*) as cnt
          FROM gamma_resolved
          WHERE cid = '${cid}'
        `,
        format: 'JSONEachRow'
      });
      const result = (await checkQuery.json())[0];
      console.log(`  ${cid.substring(0, 12)}...: ${result.cnt} rows`);
    }
  } else {
    console.log("✅ No duplicates found in gamma_resolved");
  }

  // Check total unique vs total rows
  const statsQuery = await clickhouse.query({
    query: `
      SELECT
        count(*) as total_rows,
        count(DISTINCT cid) as unique_cids
      FROM gamma_resolved
    `,
    format: 'JSONEachRow'
  });
  const stats = (await statsQuery.json())[0];

  console.log(`\nTotal stats:`);
  console.log(`  Total rows: ${stats.total_rows}`);
  console.log(`  Unique cids: ${stats.unique_cids}`);
  console.log(`  Duplicate rows: ${Number(stats.total_rows) - Number(stats.unique_cids)}`);
}

main().catch(console.error);
