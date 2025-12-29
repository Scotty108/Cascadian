/**
 * Analyze event_id repeats to determine if they are true duplicates or partial fills
 *
 * If countDistinct(usdc_delta) == 1, repeats are true duplicates → rn=1 is fine
 * If countDistinct > 1, repeats contain different values → sum/max needed
 *
 * Run with: npx tsx scripts/pnl/analyze-event-id-repeats.ts
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { getClickHouseClient } from '../../lib/clickhouse/client';

const TEST_WALLETS = [
  { addr: '0x56687bf447db6ffa42ffe2204a05edaa20f55839', name: 'Theo4' },
  { addr: '0xd38b71f3e8ed1af71983e5c309eac3dfa9b35029', name: 'primm' },
];

async function main() {
  const client = getClickHouseClient();

  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║   ANALYZE EVENT_ID REPEATS - True Duplicates vs Partial Fills             ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝\n');

  for (const w of TEST_WALLETS) {
    console.log(`\n=== ${w.name} (${w.addr.slice(0, 10)}...) ===\n`);

    // Overall repeat stats
    const statsQ = `
      SELECT
        count() as total_rows,
        count(distinct event_id) as unique_event_ids,
        count() - count(distinct event_id) as duplicate_rows
      FROM pm_trader_events_v2
      WHERE trader_wallet = '${w.addr}' AND is_deleted = 0
    `;
    const statsR = await client.query({ query: statsQ, format: 'JSONEachRow' });
    const stats = (await statsR.json())[0] as any;

    console.log('Overall Stats:');
    console.log(`  Total rows: ${stats.total_rows}`);
    console.log(`  Unique event_ids: ${stats.unique_event_ids}`);
    console.log(`  Duplicate rows: ${stats.duplicate_rows} (${((stats.duplicate_rows / stats.total_rows) * 100).toFixed(1)}%)`);

    // Analyze repeat patterns
    const repeatQ = `
      SELECT
        event_id,
        count() as cnt,
        count(distinct usdc_amount) as distinct_usdc,
        count(distinct token_amount) as distinct_token,
        count(distinct side) as distinct_side,
        count(distinct role) as distinct_role,
        min(usdc_amount) as min_usdc,
        max(usdc_amount) as max_usdc,
        min(token_amount) as min_token,
        max(token_amount) as max_token,
        groupArray(usdc_amount) as usdc_values,
        groupArray(token_amount) as token_values
      FROM pm_trader_events_v2
      WHERE trader_wallet = '${w.addr}' AND is_deleted = 0
      GROUP BY event_id
      HAVING count() > 1
      ORDER BY count() DESC
      LIMIT 20
    `;

    const repeatR = await client.query({ query: repeatQ, format: 'JSONEachRow' });
    const repeats = await repeatR.json();

    console.log(`\nTop Repeated Event IDs (${repeats.length} shown):`);

    // Categorize repeats
    let trueDupes = 0;
    let partialFills = 0;

    for (let i = 0; i < Math.min(10, repeats.length); i++) {
      const r = repeats[i];
      const isTrueDupe = r.distinct_usdc === 1 && r.distinct_token === 1;

      if (isTrueDupe) trueDupes++;
      else partialFills++;

      console.log(`\n  ${i + 1}. event_id: ${r.event_id.slice(0, 50)}...`);
      console.log(`     count: ${r.cnt}, distinct_usdc: ${r.distinct_usdc}, distinct_token: ${r.distinct_token}`);
      console.log(`     distinct_side: ${r.distinct_side}, distinct_role: ${r.distinct_role}`);
      console.log(`     usdc range: [${(r.min_usdc / 1000000).toFixed(2)}, ${(r.max_usdc / 1000000).toFixed(2)}]`);
      console.log(`     token range: [${(r.min_token / 1000000).toFixed(2)}, ${(r.max_token / 1000000).toFixed(2)}]`);
      console.log(`     Type: ${isTrueDupe ? '✓ TRUE DUPLICATE (rn=1 OK)' : '⚠️ PARTIAL FILL (need sum/max)'}`);

      if (r.distinct_usdc > 1 || r.distinct_token > 1) {
        // Show actual values for partial fills
        console.log(`     usdc_values: [${r.usdc_values.slice(0, 5).map((v: number) => (v / 1000000).toFixed(2)).join(', ')}...]`);
        console.log(`     token_values: [${r.token_values.slice(0, 5).map((v: number) => (v / 1000000).toFixed(2)).join(', ')}...]`);
      }
    }

    // Summary for this wallet
    console.log(`\n  Summary of top 10 repeated event_ids:`);
    console.log(`    True duplicates (rn=1 safe): ${trueDupes}`);
    console.log(`    Partial fills (need sum/max): ${partialFills}`);

    // Check if any repeat has different roles (same event_id, both maker and taker)
    const roleConflictQ = `
      SELECT count() as cnt
      FROM (
        SELECT event_id
        FROM pm_trader_events_v2
        WHERE trader_wallet = '${w.addr}' AND is_deleted = 0
        GROUP BY event_id
        HAVING count(distinct role) > 1
      )
    `;
    const roleR = await client.query({ query: roleConflictQ, format: 'JSONEachRow' });
    const roleConflict = (await roleR.json())[0] as any;
    console.log(`\n  Event IDs with conflicting roles: ${roleConflict.cnt}`);
  }

  console.log('\n\n=== DIAGNOSIS ===\n');
  console.log('If most repeats are TRUE DUPLICATES:');
  console.log('  - Current GROUP BY event_id with any() is correct');
  console.log('  - Duplicates are from multiple backfill ingestions');
  console.log('\nIf many repeats are PARTIAL FILLS:');
  console.log('  - Need to SUM the deltas, not take any()');
  console.log('  - These represent incremental fill updates');
}

main().catch(console.error);
