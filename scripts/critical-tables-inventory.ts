import { createClient } from '@clickhouse/client';

const client = createClient({
  url: 'https://ja9egedrv0.us-central1.gcp.clickhouse.cloud:8443',
  username: 'default',
  password: 'Lbr.jYtw5ikf3',
  database: 'default',
});

async function main() {
  try {
    console.log('=== CRITICAL TABLES FOR PNL CALCULATION ===\n');

    // Key tables to investigate
    const criticalTables = [
      'default.pm_ctf_events',
      'default.pm_ctf_split_merge_expanded',
      'default.pm_condition_resolutions',
      'default.pm_trader_events_v2',
      'default.pm_fpmm_trades',
      'default.pm_token_to_condition_map_v3',
      'default.pm_cascadian_pnl_v1_new',
      'pm_archive.pm_user_positions',
      'pm_archive.pm_wallet_market_pnl_v4',
    ];

    for (const fullName of criticalTables) {
      console.log('\n' + '='.repeat(120));
      console.log(`\n### ${fullName}\n`);
      console.log('─'.repeat(120));

      try {
        // Get schema
        const columnsResult = await client.query({
          query: `DESCRIBE TABLE ${fullName}`,
          format: 'JSONEachRow',
        });
        const columns = await columnsResult.json() as any[];

        console.log(`\n📐 SCHEMA (${columns.length} columns):\n`);
        columns.forEach(col => {
          console.log(`  ${col.name.padEnd(30)} ${col.type}`);
        });

        // Get row count
        const countResult = await client.query({
          query: `SELECT count() as cnt FROM ${fullName}`,
          format: 'JSONEachRow',
        });
        const countData = await countResult.json() as any[];
        const rowCount = countData[0]?.cnt || 0;

        console.log(`\n📊 ROW COUNT: ${rowCount.toLocaleString()}\n`);

        // Table-specific analysis
        if (fullName.includes('pm_ctf_events')) {
          console.log('🔍 CTF Event Types:\n');
          const typesResult = await client.query({
            query: `
              SELECT event_type, count() as cnt, min(block_time) as earliest, max(block_time) as latest
              FROM ${fullName}
              GROUP BY event_type
              ORDER BY cnt DESC
            `,
            format: 'JSONEachRow',
          });
          const types = await typesResult.json() as any[];
          types.forEach(t => {
            console.log(`  ${t.event_type.padEnd(30)} ${t.cnt.toLocaleString().padStart(15)} events  (${t.earliest} to ${t.latest})`);
          });

          console.log('\n📋 Sample Split event:');
          const splitSample = await client.query({
            query: `SELECT * FROM ${fullName} WHERE event_type = 'PositionSplit' LIMIT 1`,
            format: 'JSONEachRow',
          });
          const splitData = await splitSample.json() as any[];
          if (splitData.length > 0) {
            Object.entries(splitData[0]).forEach(([k, v]) => {
              console.log(`  ${k.padEnd(30)} ${JSON.stringify(v)}`);
            });
          }

          console.log('\n📋 Sample Merge event:');
          const mergeSample = await client.query({
            query: `SELECT * FROM ${fullName} WHERE event_type = 'PositionMerge' LIMIT 1`,
            format: 'JSONEachRow',
          });
          const mergeData = await mergeSample.json() as any[];
          if (mergeData.length > 0) {
            Object.entries(mergeData[0]).forEach(([k, v]) => {
              console.log(`  ${k.padEnd(30)} ${JSON.stringify(v)}`);
            });
          }

          console.log('\n📋 Sample Redeem event:');
          const redeemSample = await client.query({
            query: `SELECT * FROM ${fullName} WHERE event_type = 'PayoutRedemption' LIMIT 1`,
            format: 'JSONEachRow',
          });
          const redeemData = await redeemSample.json() as any[];
          if (redeemData.length > 0) {
            Object.entries(redeemData[0]).forEach(([k, v]) => {
              console.log(`  ${k.padEnd(30)} ${JSON.stringify(v)}`);
            });
          }
        }

        if (fullName.includes('pm_condition_resolutions')) {
          console.log('🔍 Resolution Data Sample:\n');
          const resSample = await client.query({
            query: `SELECT * FROM ${fullName} LIMIT 3`,
            format: 'JSONEachRow',
          });
          const resData = await resSample.json() as any[];
          resData.forEach((row, idx) => {
            console.log(`\nResolution ${idx + 1}:`);
            Object.entries(row).forEach(([k, v]) => {
              console.log(`  ${k.padEnd(30)} ${JSON.stringify(v)}`);
            });
          });
        }

        if (fullName.includes('trader_events')) {
          console.log('🔍 Trade Event Sample:\n');
          const tradeSample = await client.query({
            query: `SELECT * FROM ${fullName} LIMIT 2`,
            format: 'JSONEachRow',
          });
          const tradeData = await tradeSample.json() as any[];
          tradeData.forEach((row, idx) => {
            console.log(`\nTrade ${idx + 1}:`);
            Object.entries(row).forEach(([k, v]) => {
              let display = v;
              if (typeof v === 'string' && v.length > 60) {
                display = v.substring(0, 57) + '...';
              }
              console.log(`  ${k.padEnd(30)} ${JSON.stringify(display)}`);
            });
          });
        }

        if (fullName.includes('token_to_condition')) {
          console.log('🔍 Token Mapping Sample:\n');
          const mapSample = await client.query({
            query: `SELECT * FROM ${fullName} LIMIT 3`,
            format: 'JSONEachRow',
          });
          const mapData = await mapSample.json() as any[];
          mapData.forEach((row, idx) => {
            console.log(`\nMapping ${idx + 1}:`);
            Object.entries(row).forEach(([k, v]) => {
              console.log(`  ${k.padEnd(30)} ${JSON.stringify(v)}`);
            });
          });
        }

        if (fullName.includes('user_positions')) {
          console.log('🔍 User Position Sample:\n');
          const posSample = await client.query({
            query: `SELECT * FROM ${fullName} LIMIT 2`,
            format: 'JSONEachRow',
          });
          const posData = await posSample.json() as any[];
          posData.forEach((row, idx) => {
            console.log(`\nPosition ${idx + 1}:`);
            Object.entries(row).forEach(([k, v]) => {
              console.log(`  ${k.padEnd(30)} ${JSON.stringify(v)}`);
            });
          });
        }

      } catch (err: any) {
        console.log(`⚠️  Error: ${err.message}`);
      }
    }

    await client.close();

  } catch (error) {
    console.error('Fatal error:', error);
    await client.close();
    process.exit(1);
  }
}

main();
