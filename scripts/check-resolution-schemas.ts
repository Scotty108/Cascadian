import { createClient } from '@clickhouse/client';

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST || 'https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '8miOkWI~OhsDb',
  database: 'default'
});

async function main() {
  console.log('CHECKING RESOLUTION TABLE SCHEMAS\n');

  // Check staging_resolutions_union schema
  console.log('1. staging_resolutions_union schema:');
  console.log('-'.repeat(80));
  const stagingSchema = await clickhouse.query({
    query: `DESCRIBE TABLE default.staging_resolutions_union`,
    format: 'JSONEachRow'
  });
  const stagingSchemaData = await stagingSchema.json();
  stagingSchemaData.forEach((col: any) => {
    console.log(`  ${col.name.padEnd(25)} ${col.type}`);
  });

  // Check api_ctf_bridge schema
  console.log('\n2. api_ctf_bridge schema:');
  console.log('-'.repeat(80));
  const bridgeSchema = await clickhouse.query({
    query: `DESCRIBE TABLE default.api_ctf_bridge`,
    format: 'JSONEachRow'
  });
  const bridgeSchemaData = await bridgeSchema.json();
  bridgeSchemaData.forEach((col: any) => {
    console.log(`  ${col.name.padEnd(25)} ${col.type}`);
  });

  // Check resolution_candidates schema
  console.log('\n3. resolution_candidates schema:');
  console.log('-'.repeat(80));
  const candidatesSchema = await clickhouse.query({
    query: `DESCRIBE TABLE default.resolution_candidates`,
    format: 'JSONEachRow'
  });
  const candidatesSchemaData = await candidatesSchema.json();
  candidatesSchemaData.forEach((col: any) => {
    console.log(`  ${col.name.padEnd(25)} ${col.type}`);
  });

  // Check market_resolutions_final for comparison
  console.log('\n4. market_resolutions_final schema (for comparison):');
  console.log('-'.repeat(80));
  const finalSchema = await clickhouse.query({
    query: `DESCRIBE TABLE default.market_resolutions_final`,
    format: 'JSONEachRow'
  });
  const finalSchemaData = await finalSchema.json();
  finalSchemaData.forEach((col: any) => {
    console.log(`  ${col.name.padEnd(25)} ${col.type}`);
  });
}

main().catch(console.error);
