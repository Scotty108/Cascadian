/**
 * Debug query to check why resolution join returns 0 matches
 */

import dotenv from 'dotenv';
import { clickhouse } from '../../lib/clickhouse/client';

dotenv.config({ path: '.env.local' });

async function main() {
  const wallet = '0x222adc4302f58fe679f5212cf11344d29c0d103c';

  // First, get the condition_ids this wallet traded
  console.log('Step 1: Get condition_ids from wallet trades...');
  const conditionQuery = `
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
    SELECT DISTINCT m.condition_id
    FROM deduped d
    INNER JOIN pm_token_to_condition_map_v3 m ON d.token_id = m.token_id_dec
    LIMIT 10
  `;

  const condResult = await clickhouse.query({ query: conditionQuery, format: 'JSONEachRow' });
  const conditions = (await condResult.json()) as any[];

  console.log(`Found ${conditions.length} condition_ids (showing first 10):`);
  conditions.forEach((c) => console.log(`  ${c.condition_id}`));

  if (conditions.length === 0) {
    console.log('No conditions found - cannot proceed');
    return;
  }

  // Check if these exist in pm_condition_resolutions
  console.log('\nStep 2: Check if these exist in pm_condition_resolutions...');
  const sampleCid = conditions[0].condition_id;
  const resolutionQuery = `
    SELECT *
    FROM pm_condition_resolutions
    WHERE condition_id = '${sampleCid}'
  `;

  const resResult = await clickhouse.query({ query: resolutionQuery, format: 'JSONEachRow' });
  const resRows = (await resResult.json()) as any[];

  if (resRows.length > 0) {
    console.log(`✓ Found resolution for ${sampleCid}:`);
    console.log(resRows[0]);
  } else {
    console.log(`✗ No resolution found for ${sampleCid}`);
  }

  // Check the total count of resolutions
  console.log('\nStep 3: Check total resolution table size...');
  const countQuery = `SELECT count() as total FROM pm_condition_resolutions`;
  const countResult = await clickhouse.query({ query: countQuery, format: 'JSONEachRow' });
  const countRow = ((await countResult.json()) as any[])[0];
  console.log(`Total resolutions in table: ${countRow.total}`);

  // Now test the LEFT JOIN more carefully
  console.log('\nStep 4: Test the LEFT JOIN with explicit matching...');
  const joinTestQuery = `
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
    SELECT
      m.condition_id,
      CASE
        WHEN r.condition_id IS NOT NULL THEN 'HAS_RESOLUTION'
        ELSE 'NO_RESOLUTION'
      END as resolution_status,
      count() as fill_count
    FROM deduped d
    INNER JOIN pm_token_to_condition_map_v3 m ON d.token_id = m.token_id_dec
    LEFT JOIN pm_condition_resolutions r ON lower(m.condition_id) = lower(r.condition_id)
    GROUP BY m.condition_id, resolution_status
    ORDER BY fill_count DESC
    LIMIT 20
  `;

  const joinTestResult = await clickhouse.query({ query: joinTestQuery, format: 'JSONEachRow' });
  const joinRows = (await joinTestResult.json()) as any[];

  console.log('\nJoin results (top 20 by fill count):');
  console.log('Condition ID                                                     | Status         | Fills');
  console.log('-'.repeat(100));
  joinRows.forEach((row) => {
    console.log(`${row.condition_id.padEnd(64)} | ${row.resolution_status.padEnd(14)} | ${row.fill_count}`);
  });

  // Summary
  const hasResolution = joinRows.filter((r) => r.resolution_status === 'HAS_RESOLUTION');
  const noResolution = joinRows.filter((r) => r.resolution_status === 'NO_RESOLUTION');
  console.log(`\nSummary:`);
  console.log(`  Conditions with resolutions: ${hasResolution.length}`);
  console.log(`  Conditions without resolutions: ${noResolution.length}`);
}

main()
  .then(() => {
    console.log('\nDone.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });
