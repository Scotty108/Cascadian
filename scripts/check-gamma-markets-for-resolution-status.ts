#!/usr/bin/env tsx
/**
 * Check gamma_markets table for resolution status of missing markets
 */

import { createClient } from '@clickhouse/client';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const client = createClient({
  host: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: 'default'
});

async function checkGammaMarkets() {
  console.log('\n🔍 CHECKING GAMMA_MARKETS FOR RESOLUTION STATUS\n');
  console.log('=' .repeat(80));

  // 1. Check schema
  console.log('\n1️⃣ GAMMA_MARKETS SCHEMA');
  console.log('-'.repeat(80));

  const schema = await client.query({
    query: `DESCRIBE TABLE default.gamma_markets`,
    format: 'JSONEachRow'
  });

  const schemaRows = await schema.json<any>();
  console.log('\nColumns in gamma_markets:');
  schemaRows.forEach((col: any) => {
    console.log(`  ${col.name}: ${col.type}`);
  });

  // 2. Check if it has condition_id
  const hasConditionId = schemaRows.some((col: any) =>
    col.name.toLowerCase().includes('condition')
  );

  if (!hasConditionId) {
    console.log('\n❌ No condition_id field found in gamma_markets');
    await client.close();
    return;
  }

  // 3. Sample data
  console.log('\n2️⃣ SAMPLE DATA');
  console.log('-'.repeat(80));

  const samples = await client.query({
    query: `SELECT * FROM default.gamma_markets LIMIT 3`,
    format: 'JSONEachRow'
  });

  const sampleRows = await samples.json<any>();
  console.log('\nSample rows:');
  console.log(JSON.stringify(sampleRows, null, 2));

  // 4. Get field names dynamically
  const conditionField = schemaRows.find((col: any) =>
    col.name.toLowerCase().includes('condition')
  )?.name;

  const statusFields = schemaRows.filter((col: any) =>
    col.name.toLowerCase().includes('status') ||
    col.name.toLowerCase().includes('closed') ||
    col.name.toLowerCase().includes('active') ||
    col.name.toLowerCase().includes('resolved')
  ).map((col: any) => col.name);

  console.log(`\n3️⃣ CHECKING RESOLUTION STATUS (using ${conditionField})`);
  console.log('-'.repeat(80));

  if (statusFields.length > 0) {
    console.log(`\nStatus fields found: ${statusFields.join(', ')}`);

    for (const statusField of statusFields) {
      const statusDistribution = await client.query({
        query: `
          SELECT
            ${statusField} as status,
            COUNT(*) as count
          FROM default.gamma_markets
          GROUP BY ${statusField}
          ORDER BY count DESC
        `,
        format: 'JSONEachRow'
      });

      const dist = await statusDistribution.json<any>();
      console.log(`\n${statusField} distribution:`);
      dist.forEach((row: any) => {
        console.log(`  ${row.status}: ${row.count.toLocaleString()}`);
      });
    }
  }

  // 5. Check overlap with our missing markets
  console.log('\n4️⃣ OVERLAP WITH MISSING MARKETS');
  console.log('-'.repeat(80));

  const overlapQuery = `
    WITH missing_cids AS (
      SELECT DISTINCT t.cid_hex
      FROM cascadian_clean.fact_trades_clean t
      LEFT JOIN (
        SELECT DISTINCT lower('0x' || toString(condition_id_norm)) AS cid_hex
        FROM default.market_resolutions_final
        WHERE winning_index IS NOT NULL
      ) r ON t.cid_hex = r.cid_hex
      WHERE t.cid_hex != '' AND r.cid_hex IS NULL
      LIMIT 100000
    )
    SELECT
      COUNT(DISTINCT mc.cid_hex) as total_missing,
      COUNT(DISTINCT g.${conditionField}) as found_in_gamma,
      COUNT(DISTINCT CASE WHEN g.${conditionField} IS NOT NULL THEN mc.cid_hex END) as overlap_count
    FROM missing_cids mc
    LEFT JOIN default.gamma_markets g
      ON lower(concat('0x', g.${conditionField})) = mc.cid_hex
        OR lower(g.${conditionField}) = mc.cid_hex
        OR lower(concat('0x', g.${conditionField})) = lower(mc.cid_hex)
  `;

  try {
    const overlap = await client.query({
      query: overlapQuery,
      format: 'JSONEachRow'
    });

    const overlapRows = await overlap.json<any>();
    if (overlapRows.length > 0) {
      const stats = overlapRows[0];
      console.log('\nOverlap between missing markets and gamma_markets:');
      console.log(`  Total missing CIDs (sample): ${stats.total_missing.toLocaleString()}`);
      console.log(`  Found in gamma_markets: ${stats.found_in_gamma.toLocaleString()}`);
      console.log(`  Overlap: ${stats.overlap_count.toLocaleString()}`);
      console.log(`  Match rate: ${((stats.overlap_count / stats.total_missing) * 100).toFixed(2)}%`);
    }
  } catch (error: any) {
    console.log(`\n⚠️  Overlap check failed: ${error.message}`);
    console.log('Trying alternative join approach...');

    // Try simpler approach
    const simpleOverlap = await client.query({
      query: `
        SELECT COUNT(*) as gamma_with_condition
        FROM default.gamma_markets
        WHERE ${conditionField} != ''
      `,
      format: 'JSONEachRow'
    });

    const simple = await simpleOverlap.json<any>();
    console.log(`\nGamma markets with condition_id: ${simple[0].gamma_with_condition.toLocaleString()}`);
  }

  // 6. Check if gamma_markets has resolution data we can use
  console.log('\n5️⃣ CHECKING FOR RESOLUTION DATA IN GAMMA_MARKETS');
  console.log('-'.repeat(80));

  const resolutionFields = schemaRows.filter((col: any) =>
    col.name.toLowerCase().includes('winner') ||
    col.name.toLowerCase().includes('outcome') ||
    col.name.toLowerCase().includes('payout') ||
    col.name.toLowerCase().includes('result')
  );

  if (resolutionFields.length > 0) {
    console.log('\n✅ Found potential resolution fields:');
    resolutionFields.forEach((col: any) => {
      console.log(`  ${col.name}: ${col.type}`);
    });

    // Sample a few resolved markets
    const resolvedSample = await client.query({
      query: `
        SELECT ${resolutionFields.map(f => f.name).join(', ')}
        FROM default.gamma_markets
        WHERE ${resolutionFields[0].name} IS NOT NULL
        LIMIT 5
      `,
      format: 'JSONEachRow'
    });

    const resolved = await resolvedSample.json<any>();
    console.log('\nSample resolved markets:');
    console.log(JSON.stringify(resolved, null, 2));
  } else {
    console.log('\n❌ No obvious resolution fields found in gamma_markets');
  }

  console.log('\n' + '='.repeat(80));
  console.log('✅ GAMMA_MARKETS ANALYSIS COMPLETE\n');

  await client.close();
}

checkGammaMarkets().catch(console.error);
