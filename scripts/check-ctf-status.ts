import { createClient } from '@clickhouse/client';

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST || 'https://ja9egedrv0.us-central1.gcp.clickhouse.cloud:8443',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || 'Lbr.jYtw5ikf3',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
});

async function checkStatus() {
  console.log('Checking CTF events status...\n');

  // Check CTF events table
  const ctfResult = await clickhouse.query({
    query: `
      SELECT
        event_type,
        count() as cnt,
        min(event_timestamp) as earliest,
        max(event_timestamp) as latest
      FROM pm_ctf_events
      GROUP BY event_type
      ORDER BY cnt DESC
    `,
    format: 'JSONEachRow'
  });
  const ctfData = await ctfResult.json<{event_type: string, cnt: string, earliest: string, latest: string}>();
  console.log('CTF Events by type:');
  console.table(ctfData);

  // Check overall counts
  const totalResult = await clickhouse.query({
    query: 'SELECT count() as total FROM pm_ctf_events',
    format: 'JSONEachRow'
  });
  const total = await totalResult.json<{total: string}>();
  console.log('\nTotal CTF events:', total[0]?.total);

  // Check trader events for comparison
  const traderResult = await clickhouse.query({
    query: 'SELECT count() as total FROM pm_trader_events_v2',
    format: 'JSONEachRow'
  });
  const traderTotal = await traderResult.json<{total: string}>();
  console.log('Total trader events (CLOB):', traderTotal[0]?.total);

  // Check if CTF tables exist
  const tablesResult = await clickhouse.query({
    query: `SELECT name FROM system.tables WHERE database = 'default' AND name LIKE '%ctf%' ORDER BY name`,
    format: 'JSONEachRow'
  });
  const tables = await tablesResult.json<{name: string}>();
  console.log('\nCTF-related tables:', tables.map(t => t.name));

  await clickhouse.close();
}

checkStatus().catch(console.error);
