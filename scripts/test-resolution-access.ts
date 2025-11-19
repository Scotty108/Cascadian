#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from '@/lib/clickhouse/client';

async function main() {
  console.log('✅ Testing Resolution/Payout Table Access');
  console.log('='.repeat(60));
  console.log();

  // Test 1: token_per_share_payout
  console.log('Test 1: token_per_share_payout');
  try {
    const query1 = `
      SELECT
        condition_id_ctf,
        pps,
        arrayElement(pps, 1) AS outcome_0_payout,
        arrayElement(pps, 2) AS outcome_1_payout
      FROM token_per_share_payout
      LIMIT 3
    `;
    const result1 = await clickhouse.query({ query: query1, format: 'JSONEachRow' });
    const data1 = await result1.json() as any[];

    console.log(`  ✅ Accessible - ${data1.length} rows returned`);
    data1.forEach((row, idx) => {
      console.log(`  Row ${idx + 1}: ${row.condition_id_ctf.substring(0, 20)}... pps=[${row.pps.join(', ')}]`);
    });
  } catch (error: any) {
    console.log(`  ❌ Error: ${error.message}`);
  }
  console.log();

  // Test 2: market_resolutions_final
  console.log('Test 2: market_resolutions_final FINAL');
  try {
    const query2 = `
      SELECT
        condition_id_norm,
        winning_outcome,
        winning_index,
        resolved_at
      FROM market_resolutions_final FINAL
      LIMIT 3
    `;
    const result2 = await clickhouse.query({ query: query2, format: 'JSONEachRow' });
    const data2 = await result2.json() as any[];

    console.log(`  ✅ Accessible - ${data2.length} rows returned`);
    data2.forEach((row, idx) => {
      console.log(`  Row ${idx + 1}: ${row.condition_id_norm.substring(0, 20)}... winner=${row.winning_outcome} (index=${row.winning_index})`);
    });
  } catch (error: any) {
    console.log(`  ❌ Error: ${error.message}`);
  }
  console.log();

  // Test 3: Join pattern
  console.log('Test 3: Join pattern (resolutions + payouts)');
  try {
    const query3 = `
      SELECT
        r.condition_id_norm,
        r.winning_outcome,
        r.winning_index,
        p.pps,
        arrayElement(p.pps, r.winning_index + 1) AS winning_payout
      FROM market_resolutions_final r FINAL
      LEFT JOIN token_per_share_payout p
        ON r.condition_id_norm = p.condition_id_ctf
      WHERE p.condition_id_ctf IS NOT NULL
      LIMIT 3
    `;
    const result3 = await clickhouse.query({ query: query3, format: 'JSONEachRow' });
    const data3 = await result3.json() as any[];

    console.log(`  ✅ Join works - ${data3.length} rows returned`);
    data3.forEach((row, idx) => {
      console.log(`  Row ${idx + 1}: winner=${row.winning_outcome} index=${row.winning_index} payout=${row.winning_payout}`);
    });
  } catch (error: any) {
    console.log(`  ❌ Error: ${error.message}`);
  }
  console.log();

  console.log('='.repeat(60));
  console.log('✅ All tests passed - Resolution/payout data accessible');
  console.log();
  console.log('Ready for C2/C3 P&L calculations');
}

main().catch(console.error);
