/**
 * Verify known token mappings to reverse-engineer the CTF formula
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '@/lib/clickhouse/client';
import { keccak256, encodePacked } from 'viem';

async function main() {
  // Get some known token -> condition mappings
  const q = `
    SELECT token_id_dec, condition_id, outcome_index
    FROM pm_token_to_condition_map_v5
    WHERE condition_id != ''
    LIMIT 5
  `;
  const r = await clickhouse.query({ query: q, format: 'JSONEachRow' });
  const rows = (await r.json()) as any[];
  console.log('=== KNOWN TOKEN MAPPINGS ===\n');

  for (const row of rows) {
    console.log('Token:', row.token_id_dec.slice(0, 40) + '...');
    console.log('Condition:', row.condition_id);
    console.log('Outcome:', row.outcome_index);

    // Try to verify with CTF formula
    const condId = (row.condition_id.startsWith('0x')
      ? row.condition_id
      : '0x' + row.condition_id) as `0x${string}`;
    const parentId =
      '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`;
    const collateral = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174' as `0x${string}`; // USDC.e
    const indexSet = row.outcome_index === 0 ? 1n : 2n;

    const collectionPacked = encodePacked(
      ['bytes32', 'bytes32', 'uint256'],
      [parentId, condId, indexSet]
    );
    const collectionId = keccak256(collectionPacked);
    const positionPacked = encodePacked(['address', 'bytes32'], [collateral, collectionId]);
    const positionId = keccak256(positionPacked);
    const computed = BigInt(positionId).toString();
    console.log('Computed:', computed.slice(0, 40) + '...');
    console.log('Match:', computed === row.token_id_dec);
    console.log('');
  }

  // Also try getting condition from Gamma API for comparison
  console.log('=== CHECKING GAMMA API MAPPING SOURCE ===');
  const sampleQ = `
    SELECT token_id_dec, condition_id, outcome_index, question
    FROM pm_token_to_condition_map_v5
    WHERE question != ''
    LIMIT 3
  `;
  const sampleR = await clickhouse.query({ query: sampleQ, format: 'JSONEachRow' });
  const samples = (await sampleR.json()) as any[];
  for (const s of samples) {
    console.log('Question:', s.question?.slice(0, 60) + '...');
    console.log('Token:', s.token_id_dec.slice(0, 30) + '...');
    console.log('Condition:', s.condition_id?.slice(0, 30) + '...');
    console.log('');
  }

  // Check if there's a direct relationship between token and condition in data
  console.log('=== CHECKING CTF EVENTS FOR TOKEN IDS ===');
  const ctfQ = `
    SELECT event_type, count() as cnt
    FROM pm_ctf_events
    GROUP BY event_type
    ORDER BY cnt DESC
  `;
  const ctfR = await clickhouse.query({ query: ctfQ, format: 'JSONEachRow' });
  const ctfTypes = (await ctfR.json()) as any[];
  console.log('CTF event types:');
  for (const t of ctfTypes) {
    console.log(`  ${t.event_type}: ${t.cnt}`);
  }

  // Check if TransferSingle events have token_id
  console.log('\n=== CHECKING pm_erc1155_transfers FOR TOKEN CONTEXT ===');
  const descQ = `DESCRIBE TABLE pm_erc1155_transfers`;
  const descR = await clickhouse.query({ query: descQ, format: 'JSONEachRow' });
  const cols = (await descR.json()) as any[];
  console.log('Columns:');
  for (const c of cols) {
    console.log(`  ${c.name}: ${c.type}`);
  }
}

main().catch(console.error);
