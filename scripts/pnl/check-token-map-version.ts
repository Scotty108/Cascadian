import dotenv from 'dotenv';
import { clickhouse } from '../../lib/clickhouse/client';

dotenv.config({ path: '.env.local' });

async function main() {
  // Check which token map tables exist and their sizes
  console.log('Checking token map table versions...\n');

  const tables = ['pm_token_to_condition_map_v3', 'pm_token_to_condition_map_v5'];

  for (const table of tables) {
    try {
      const query = `SELECT count() as cnt FROM ${table}`;
      const result = await clickhouse.query({ query, format: 'JSONEachRow' });
      const rows = (await result.json()) as any[];
      console.log(`${table}: ${rows[0].cnt} rows`);
    } catch (err: any) {
      console.log(`${table}: NOT FOUND (${err.message})`);
    }
  }

  // Check the V18 engine to see which table it uses
  console.log('\nV18 engine uses: pm_token_to_condition_map_v3');

  // Now check a sample wallet's token_ids
  const wallet = '0x222adc4302f58fe679f5212cf11344d29c0d103c';
  console.log(`\nChecking token_ids for wallet ${wallet}...\n`);

  const tokenQuery = `
    WITH deduped AS (
      SELECT
        event_id,
        any(token_id) as token_id
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${wallet}')
        AND is_deleted = 0
        AND role = 'maker'
      GROUP BY event_id
    )
    SELECT token_id, count() as fills
    FROM deduped
    GROUP BY token_id
    ORDER BY fills DESC
    LIMIT 10
  `;

  const tokenResult = await clickhouse.query({ query: tokenQuery, format: 'JSONEachRow' });
  const tokenRows = (await tokenResult.json()) as any[];

  console.log('Top 10 token_ids by fill count:');
  tokenRows.forEach((r) => console.log(`  ${r.token_id}: ${r.fills} fills`));

  if (tokenRows.length > 0) {
    const sampleTokenId = tokenRows[0].token_id;
    console.log(`\nChecking if ${sampleTokenId} exists in token maps...\n`);

    for (const table of tables) {
      try {
        const checkQuery = `
          SELECT condition_id, outcome_index
          FROM ${table}
          WHERE token_id_dec = '${sampleTokenId}'
          LIMIT 1
        `;
        const checkResult = await clickhouse.query({ query: checkQuery, format: 'JSONEachRow' });
        const checkRows = (await checkResult.json()) as any[];

        if (checkRows.length > 0) {
          console.log(`  ✓ ${table}: Found (condition_id: ${checkRows[0].condition_id})`);
        } else {
          console.log(`  ✗ ${table}: Not found`);
        }
      } catch (err: any) {
        console.log(`  ✗ ${table}: Error (${err.message})`);
      }
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });
