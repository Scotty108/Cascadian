import { createClient } from '@clickhouse/client';

const client = createClient({
  url: 'https://ja9egedrv0.us-central1.gcp.clickhouse.cloud:8443',
  username: 'default',
  password: 'Lbr.jYtw5ikf3',
  database: 'default',
});

async function main() {
  try {
    console.log('=== VERIFYING CTF EXPANDED TABLE ===\n');

    // Get event type exact matches
    console.log('📊 Checking event_type values:\n');
    const typesResult = await client.query({
      query: `
        SELECT DISTINCT event_type
        FROM default.pm_ctf_split_merge_expanded
        ORDER BY event_type
      `,
      format: 'JSONEachRow',
    });
    const types = await typesResult.json() as any[];
    types.forEach(t => {
      console.log(`  "${t.event_type}"`);
    });

    // Get sample split
    console.log('\n\n📋 SAMPLE PositionSplit from expanded:\n');
    const splitSample = await client.query({
      query: `SELECT * FROM default.pm_ctf_split_merge_expanded WHERE event_type = 'PositionSplit' LIMIT 1`,
      format: 'JSONEachRow',
    });
    const splitData = await splitSample.json() as any[];
    if (splitData.length > 0) {
      Object.entries(splitData[0]).forEach(([k, v]) => {
        console.log(`  ${k.padEnd(30)} ${JSON.stringify(v)}`);
      });
    } else {
      console.log('  (no results)');
    }

    // Get sample merge
    console.log('\n\n📋 SAMPLE PositionsMerge from expanded:\n');
    const mergeSample = await client.query({
      query: `SELECT * FROM default.pm_ctf_split_merge_expanded WHERE event_type = 'PositionsMerge' LIMIT 1`,
      format: 'JSONEachRow',
    });
    const mergeData = await mergeSample.json() as any[];
    if (mergeData.length > 0) {
      Object.entries(mergeData[0]).forEach(([k, v]) => {
        console.log(`  ${k.padEnd(30)} ${JSON.stringify(v)}`);
      });
    } else {
      console.log('  (no results)');
    }

    // Just grab first row
    console.log('\n\n📋 FIRST ROW (no filter):\n');
    const firstRow = await client.query({
      query: `SELECT * FROM default.pm_ctf_split_merge_expanded LIMIT 1`,
      format: 'JSONEachRow',
    });
    const firstData = await firstRow.json() as any[];
    if (firstData.length > 0) {
      Object.entries(firstData[0]).forEach(([k, v]) => {
        console.log(`  ${k.padEnd(30)} ${JSON.stringify(v)}`);
      });
    }

    await client.close();

  } catch (error) {
    console.error('Error:', error);
    await client.close();
    process.exit(1);
  }
}

main();
