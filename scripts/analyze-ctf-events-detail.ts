import { createClient } from '@clickhouse/client';

const client = createClient({
  url: 'https://ja9egedrv0.us-central1.gcp.clickhouse.cloud:8443',
  username: 'default',
  password: 'Lbr.jYtw5ikf3',
  database: 'default',
});

async function main() {
  try {
    console.log('=== CTF EVENTS DEEP DIVE ===\n');

    // Get event type distribution
    console.log('📊 Event Type Distribution:\n');
    const typesResult = await client.query({
      query: `
        SELECT
          event_type,
          count() as cnt,
          min(event_timestamp) as earliest,
          max(event_timestamp) as latest
        FROM default.pm_ctf_events
        GROUP BY event_type
        ORDER BY cnt DESC
      `,
      format: 'JSONEachRow',
    });
    const types = await typesResult.json() as any[];
    types.forEach(t => {
      console.log(`  ${t.event_type.padEnd(30)} ${t.cnt.toLocaleString().padStart(15)} events  (${t.earliest} to ${t.latest})`);
    });

    // Sample PositionSplit
    console.log('\n\n📋 SAMPLE PositionSplit EVENT:\n');
    const splitSample = await client.query({
      query: `SELECT * FROM default.pm_ctf_events WHERE event_type = 'PositionSplit' LIMIT 1`,
      format: 'JSONEachRow',
    });
    const splitData = await splitSample.json() as any[];
    if (splitData.length > 0) {
      Object.entries(splitData[0]).forEach(([k, v]) => {
        console.log(`  ${k.padEnd(30)} ${JSON.stringify(v)}`);
      });
    }

    // Sample PositionMerge
    console.log('\n\n📋 SAMPLE PositionMerge EVENT:\n');
    const mergeSample = await client.query({
      query: `SELECT * FROM default.pm_ctf_events WHERE event_type = 'PositionMerge' LIMIT 1`,
      format: 'JSONEachRow',
    });
    const mergeData = await mergeSample.json() as any[];
    if (mergeData.length > 0) {
      Object.entries(mergeData[0]).forEach(([k, v]) => {
        console.log(`  ${k.padEnd(30)} ${JSON.stringify(v)}`);
      });
    }

    // Sample PayoutRedemption
    console.log('\n\n📋 SAMPLE PayoutRedemption EVENT:\n');
    const redeemSample = await client.query({
      query: `SELECT * FROM default.pm_ctf_events WHERE event_type = 'PayoutRedemption' LIMIT 1`,
      format: 'JSONEachRow',
    });
    const redeemData = await redeemSample.json() as any[];
    if (redeemData.length > 0) {
      Object.entries(redeemData[0]).forEach(([k, v]) => {
        console.log(`  ${k.padEnd(30)} ${JSON.stringify(v)}`);
      });
    }

    // Check pm_ctf_split_merge_expanded
    console.log('\n\n📊 CTF SPLIT/MERGE EXPANDED TABLE:\n');
    const expandedResult = await client.query({
      query: `
        SELECT
          event_type,
          count() as cnt
        FROM default.pm_ctf_split_merge_expanded
        GROUP BY event_type
        ORDER BY cnt DESC
      `,
      format: 'JSONEachRow',
    });
    const expanded = await expandedResult.json() as any[];
    expanded.forEach(t => {
      console.log(`  ${t.event_type.padEnd(30)} ${t.cnt.toLocaleString().padStart(15)} events`);
    });

    // Sample from expanded
    console.log('\n\n📋 SAMPLE from pm_ctf_split_merge_expanded (Split):\n');
    const expSplitSample = await client.query({
      query: `SELECT * FROM default.pm_ctf_split_merge_expanded WHERE event_type = 'split' LIMIT 1`,
      format: 'JSONEachRow',
    });
    const expSplitData = await expSplitSample.json() as any[];
    if (expSplitData.length > 0) {
      Object.entries(expSplitData[0]).forEach(([k, v]) => {
        console.log(`  ${k.padEnd(30)} ${JSON.stringify(v)}`);
      });
    }

    console.log('\n\n📋 SAMPLE from pm_ctf_split_merge_expanded (Merge):\n');
    const expMergeSample = await client.query({
      query: `SELECT * FROM default.pm_ctf_split_merge_expanded WHERE event_type = 'merge' LIMIT 1`,
      format: 'JSONEachRow',
    });
    const expMergeData = await expMergeSample.json() as any[];
    if (expMergeData.length > 0) {
      Object.entries(expMergeData[0]).forEach(([k, v]) => {
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
