/**
 * Check on-chain data sources for 15-minute crypto market token mappings.
 *
 * The Gamma API doesn't have these markets, so we need to find alternative sources:
 * 1. CTF events (Goldsky) - may have condition_id for splits/redemptions
 * 2. ERC1155 transfers - may have token_id patterns
 * 3. Other on-chain data
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '@/lib/clickhouse/client';

async function checkOnChainData() {
  console.log('=== INVESTIGATING ON-CHAIN DATA SOURCES FOR TOKEN MAPPING ===\n');

  // The unmapped tokens from our investigation (first 5 of 20)
  const unmappedTokens = [
    '55934850943822858986736892523894499754403127654190813073524249862686020098050',
    '26127808355481616381789117298478127797050197627499706212683093929949912728192',
    '23908614497199096093513008785003820538148988016188088195812095093787012447693',
    '50316009653697952055620166888891200091992795728606028621119265015068108847186',
    '35899018073954929169227009009971227420279948916609558295628091082052399106048',
  ];

  // Check 1: Do CTF events have these tokens?
  console.log('1. Checking pm_ctf_events schema...');
  const descQ = 'DESCRIBE TABLE pm_ctf_events';
  const descR = await clickhouse.query({ query: descQ, format: 'JSONEachRow' });
  const descRows = (await descR.json()) as { name: string; type: string }[];
  console.log('CTF columns:', descRows.map((r) => `${r.name}(${r.type})`).join(', '));

  // Check 2: Sample CTF event
  console.log('\n2. Sample CTF event...');
  const sampleQ = `SELECT * FROM pm_ctf_events LIMIT 1`;
  const sampleR = await clickhouse.query({ query: sampleQ, format: 'JSONEachRow' });
  const sampleRows = (await sampleR.json()) as Record<string, unknown>[];
  if (sampleRows.length > 0) {
    for (const [k, v] of Object.entries(sampleRows[0])) {
      console.log(`  ${k}: ${JSON.stringify(v).slice(0, 100)}`);
    }
  }

  // Check 3: Does CTF events table have our unmapped tokens?
  console.log('\n3. Checking if CTF events have our unmapped tokens...');
  const tokenCheckQ = `
    SELECT
      condition_id,
      event_type,
      count() as cnt
    FROM pm_ctf_events
    WHERE toString(token_id) IN (${unmappedTokens.map((t) => `'${t}'`).join(',')})
    GROUP BY condition_id, event_type
  `;
  try {
    const tokenCheckR = await clickhouse.query({ query: tokenCheckQ, format: 'JSONEachRow' });
    const tokenCheckRows = (await tokenCheckR.json()) as { condition_id: string; event_type: string; cnt: string }[];
    console.log('CTF events for unmapped tokens:', tokenCheckRows);
  } catch (e) {
    console.log('Query error:', (e as Error).message);
  }

  // Check 4: ERC1155 transfers schema
  console.log('\n4. Checking pm_erc1155_transfers schema...');
  const erc1155DescQ = 'DESCRIBE TABLE pm_erc1155_transfers';
  try {
    const erc1155DescR = await clickhouse.query({ query: erc1155DescQ, format: 'JSONEachRow' });
    const erc1155DescRows = (await erc1155DescR.json()) as { name: string; type: string }[];
    console.log('ERC1155 columns:', erc1155DescRows.map((r) => `${r.name}(${r.type})`).join(', '));
  } catch (e) {
    console.log('ERC1155 table not found:', (e as Error).message);
  }

  // Check 5: Sample ERC1155 transfer for our unmapped tokens
  console.log('\n5. Checking ERC1155 transfers for unmapped tokens...');
  const erc1155SampleQ = `
    SELECT *
    FROM pm_erc1155_transfers
    WHERE token_id IN (${unmappedTokens.map((t) => `'${t}'`).join(',')})
    LIMIT 5
  `;
  try {
    const erc1155SampleR = await clickhouse.query({ query: erc1155SampleQ, format: 'JSONEachRow' });
    const erc1155SampleRows = (await erc1155SampleR.json()) as Record<string, unknown>[];
    console.log(`Found ${erc1155SampleRows.length} ERC1155 transfers`);
    if (erc1155SampleRows.length > 0) {
      console.log('Sample:');
      for (const [k, v] of Object.entries(erc1155SampleRows[0])) {
        console.log(`  ${k}: ${JSON.stringify(v).slice(0, 100)}`);
      }
    }
  } catch (e) {
    console.log('ERC1155 query error:', (e as Error).message);
  }

  // Check 6: Can we derive condition_id from token_id?
  // The token_id in Polymarket is derived from condition_id and outcome_index
  // token_id = keccak256(abi.encodePacked(conditionId, outcomeIndex))
  console.log('\n6. Checking if pm_market_metadata has these as outcomes...');
  const metaCheckQ = `
    SELECT
      condition_id,
      question,
      token_ids
    FROM pm_market_metadata FINAL
    WHERE hasAny(token_ids, [${unmappedTokens.map((t) => `'${t}'`).join(',')}])
    LIMIT 5
  `;
  try {
    const metaCheckR = await clickhouse.query({ query: metaCheckQ, format: 'JSONEachRow' });
    const metaCheckRows = (await metaCheckR.json()) as { condition_id: string; question: string; token_ids: string[] }[];
    console.log(`Found ${metaCheckRows.length} markets in metadata`);
    if (metaCheckRows.length > 0) {
      for (const row of metaCheckRows) {
        console.log(`  ${row.question.slice(0, 60)}...`);
        console.log(`    condition_id: ${row.condition_id}`);
      }
    }
  } catch (e) {
    console.log('Metadata query error:', (e as Error).message);
  }

  // Check 7: What about checking Goldsky directly for condition_id extraction?
  console.log('\n7. Checking goldsky_ctf_condition_preparation for recent conditions...');
  const goldskyQ = `
    SELECT
      condition_id,
      oracle,
      question_id,
      count() as cnt
    FROM goldsky_ctf_condition_preparation
    WHERE block_timestamp >= now() - INTERVAL 1 DAY
    GROUP BY condition_id, oracle, question_id
    ORDER BY cnt DESC
    LIMIT 10
  `;
  try {
    const goldskyR = await clickhouse.query({ query: goldskyQ, format: 'JSONEachRow' });
    const goldskyRows = (await goldskyR.json()) as Record<string, unknown>[];
    console.log(`Found ${goldskyRows.length} recent conditions from Goldsky`);
    if (goldskyRows.length > 0) {
      for (const row of goldskyRows) {
        console.log(`  ${row.condition_id}`);
      }
    }
  } catch (e) {
    console.log('Goldsky query error:', (e as Error).message);
  }

  // Check 8: pm_resolutions table
  console.log('\n8. Checking pm_resolutions for recent resolved markets...');
  const resolutionsQ = `
    SELECT
      condition_id,
      payout_numerators,
      resolution_time
    FROM pm_resolutions
    WHERE resolution_time >= now() - INTERVAL 1 DAY
    ORDER BY resolution_time DESC
    LIMIT 10
  `;
  try {
    const resolutionsR = await clickhouse.query({ query: resolutionsQ, format: 'JSONEachRow' });
    const resolutionsRows = (await resolutionsR.json()) as Record<string, unknown>[];
    console.log(`Found ${resolutionsRows.length} recent resolutions`);
    if (resolutionsRows.length > 0) {
      for (const row of resolutionsRows) {
        console.log(`  ${row.condition_id} at ${row.resolution_time}`);
      }
    }
  } catch (e) {
    console.log('Resolutions query error:', (e as Error).message);
  }

  console.log('\n=== DONE ===');
  process.exit(0);
}

checkOnChainData().catch(console.error);
