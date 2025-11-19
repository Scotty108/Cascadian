const { createClient } = require('@clickhouse/client');

const client = createClient({
  host: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
});

async function main() {
  try {
    // Get clob_fills schema
    const { data: schema } = await client.query({
      query: 'DESCRIBE TABLE clob_fills',
      format: 'JSONEachRow'
    });

    console.log('clob_fills schema:');
    console.log(JSON.stringify(schema, null, 2));

    // Get sample data
    const { data: sample } = await client.query({
      query: 'SELECT * FROM clob_fills LIMIT 1',
      format: 'JSONEachRow'
    });

    console.log('\nSample data:');
    console.log(JSON.stringify(sample, null, 2));

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.close();
  }
}

main();