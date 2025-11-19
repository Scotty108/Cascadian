/**
 * CHECKPOINT A: Token Decode and Joins
 *
 * Verify that:
 * 1. Token decode produces valid condition_id and outcome_index
 * 2. Joins to market_resolutions_final succeed
 * 3. Outcome_index is within bounds of payout_numerators
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';
import * as fs from 'fs';

interface CheckpointRow {
  asset_id: string;
  token_id: string;
  condition_id_hex: string;
  outcome_index: number;
  winning_index: number | null;
  payout_numerators: any;
  outcome_count: number | null;
  payout_value: number | null;
  status: string;
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('CHECKPOINT A: Token Decode and Joins');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Load fixture
  console.log('📊 Loading fills_fixture.csv...\n');

  const fillsCsv = fs.readFileSync('fills_fixture.csv', 'utf-8');
  const fillsLines = fillsCsv.split('\n').slice(1); // Skip header

  const uniqueTokens = new Set<string>();
  for (const line of fillsLines) {
    if (!line) continue;
    const parts = line.split(',');
    const token_id = parts[8]; // token_id column
    uniqueTokens.add(token_id);
  }

  console.log(`✅ Loaded ${uniqueTokens.size} unique tokens from fixture\n`);

  // For each token, verify decode and join
  const results: CheckpointRow[] = [];

  for (const token_id of uniqueTokens) {
    // Get first fill for this token (for asset_id)
    const fillLine = fillsLines.find(l => l.includes(token_id));
    if (!fillLine) continue;

    const parts = fillLine.split(',');
    const asset_id = parts[2];

    // Decode token
    const decodeQuery = await clickhouse.query({
      query: `
        SELECT
          '${token_id}' as token_id,
          lpad(lower(hex(bitShiftRight(toUInt256('${token_id}'), 8))), 64, '0') as condition_id_hex,
          toUInt8(bitAnd(toUInt256('${token_id}'), 255)) as outcome_index
      `,
      format: 'JSONEachRow'
    });

    const decoded: any = (await decodeQuery.json())[0];

    // Join to resolutions
    const resQuery = await clickhouse.query({
      query: `
        SELECT
          condition_id_norm,
          winning_index,
          payout_numerators,
          outcome_count
        FROM market_resolutions_final
        WHERE condition_id_norm = '${decoded.condition_id_hex}'
        LIMIT 1
      `,
      format: 'JSONEachRow'
    });

    const res: any[] = await resQuery.json();
    const resolution = res.length > 0 ? res[0] : null;

    // Calculate payout value
    let payout_value: number | null = null;
    let status = '⏳ OPEN';

    if (resolution) {
      // Check if outcome_index is valid
      const outcome_count = resolution.outcome_count;

      if (decoded.outcome_index >= outcome_count) {
        status = '❌ INVALID (outcome_index >= outcome_count)';
      } else {
        // ClickHouse arrays are 1-indexed
        const payouts = Array.isArray(resolution.payout_numerators)
          ? resolution.payout_numerators
          : [];

        if (payouts.length > decoded.outcome_index) {
          payout_value = payouts[decoded.outcome_index];

          if (resolution.winning_index === decoded.outcome_index) {
            status = payout_value === 1 ? '✅ WIN' : '⚠️ WIN (payout != 1)';
          } else {
            status = payout_value === 0 ? '✅ LOSE' : '⚠️ LOSE (payout != 0)';
          }
        } else {
          status = '❌ INVALID (payout array too short)';
        }
      }
    }

    results.push({
      asset_id,
      token_id,
      condition_id_hex: decoded.condition_id_hex,
      outcome_index: decoded.outcome_index,
      winning_index: resolution?.winning_index ?? null,
      payout_numerators: resolution?.payout_numerators ?? null,
      outcome_count: resolution?.outcome_count ?? null,
      payout_value,
      status,
    });
  }

  // Display results
  console.log('═══════════════════════════════════════════════════════════');
  console.log('CHECKPOINT A RESULTS');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.table(results.map(r => ({
    token_id: r.token_id.substring(0, 20) + '...',
    condition_id: r.condition_id_hex.substring(0, 16) + '...',
    outcome_idx: r.outcome_index,
    winning_idx: r.winning_index ?? 'N/A',
    outcome_cnt: r.outcome_count ?? 'N/A',
    payout: r.payout_value ?? 'N/A',
    status: r.status,
  })));

  // Analyze results
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('ANALYSIS');
  console.log('═══════════════════════════════════════════════════════════\n');

  const total = results.length;
  const resolved = results.filter(r => r.winning_index !== null).length;
  const valid = results.filter(r => r.status.includes('✅')).length;
  const invalid = results.filter(r => r.status.includes('❌')).length;
  const open = results.filter(r => r.status.includes('⏳')).length;

  console.log(`Total Tokens: ${total}`);
  console.log(`Resolved: ${resolved} (${(resolved / total * 100).toFixed(0)}%)`);
  console.log(`Valid: ${valid} (${(valid / total * 100).toFixed(0)}%)`);
  console.log(`Invalid: ${invalid} (${(invalid / total * 100).toFixed(0)}%)`);
  console.log(`Open: ${open} (${(open / total * 100).toFixed(0)}%)\n`);

  // Checkpoint pass/fail
  if (invalid > 0) {
    console.log('❌ CHECKPOINT A FAILED');
    console.log(`   ${invalid} tokens have invalid outcome_index or payout arrays\n`);

    console.log('Invalid tokens:');
    for (const r of results.filter(r => r.status.includes('❌'))) {
      console.log(`  Token: ${r.token_id.substring(0, 30)}...`);
      console.log(`    Outcome Index: ${r.outcome_index}`);
      console.log(`    Outcome Count: ${r.outcome_count}`);
      console.log(`    Payout Array: ${JSON.stringify(r.payout_numerators)}`);
      console.log(`    Status: ${r.status}\n`);
    }

    console.log('⚠️  DO NOT PROCEED - Fix token decode first\n');
  } else {
    console.log('✅ CHECKPOINT A PASSED');
    console.log('   All tokens have valid outcome_index and payout arrays\n');
    console.log('✅ Ready for Checkpoint B (Balances at Resolution)\n');
  }

  // Save checkpoint results
  const csv = [
    'asset_id,token_id,condition_id_hex,outcome_index,winning_index,outcome_count,payout_value,status',
    ...results.map(r =>
      `${r.asset_id},${r.token_id},${r.condition_id_hex},${r.outcome_index},${r.winning_index ?? ''},${r.outcome_count ?? ''},${r.payout_value ?? ''},${r.status}`
    )
  ].join('\n');

  fs.writeFileSync('checkpoint_a_results.csv', csv);
  console.log('💾 Saved: checkpoint_a_results.csv\n');
}

main().catch(console.error);
