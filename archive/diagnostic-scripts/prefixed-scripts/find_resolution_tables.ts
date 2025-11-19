import { createClient } from '@clickhouse/client';

const client = createClient({
  host: 'https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443',
  username: 'default',
  password: '8miOkWI~OhsDb',
});

async function main() {
  console.log('Searching for resolution-related tables...\n');
  
  const result = await client.query({
    query: `
      SELECT
        database,
        name,
        engine,
        total_rows
      FROM system.tables
      WHERE database = 'default'
        AND (name LIKE '%resolution%' OR name LIKE '%resolved%' OR name LIKE '%gamma%')
      ORDER BY name
    `,
    format: 'JSONEachRow',
  });
  
  const tables = await result.json();
  console.log('Resolution-related tables:');
  console.log(JSON.stringify(tables, null, 2));
  
  // Check pm_gamma_markets specifically
  console.log('\nChecking pm_gamma_markets...');
  try {
    const gammaCheck = await client.query({
      query: `
        SELECT count(*) as total_markets
        FROM default.pm_gamma_markets
      `,
      format: 'JSONEachRow',
    });
    const gamma = (await gammaCheck.json())[0];
    console.log('pm_gamma_markets total:', gamma.total_markets);
    
    // Check if it has resolution data
    const gammaSchema = await client.query({
      query: `DESCRIBE TABLE default.pm_gamma_markets`,
      format: 'JSONEachRow',
    });
    const schema = await gammaSchema.json();
    console.log('\npm_gamma_markets columns with "resol" or "outc":', 
      schema.filter((s: any) => s.name.toLowerCase().includes('resol') || s.name.toLowerCase().includes('outc'))
        .map((s: any) => s.name).join(', '));
  } catch (e: any) {
    console.log('Error:', e.message);
  }
  
  await client.close();
}

main().catch(console.error);
