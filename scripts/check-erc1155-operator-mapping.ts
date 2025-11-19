#!/usr/bin/env npx tsx
/**
 * Check if ERC-1155 transfers contain operator field
 * Operator = actual trader; from/to = proxy relationship
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from './lib/clickhouse/client';

async function main() {
  const ch = getClickHouseClient();

  console.log('\n' + '═'.repeat(80));
  console.log('ERC-1155 OPERATOR ANALYSIS: Finding Proxy→Trader Mappings');
  console.log('═'.repeat(80) + '\n');

  try {
    // Step 1: Check schema
    console.log('1️⃣  Checking ERC-1155 table schema...');
    const schema = await ch.query({
      query: `DESCRIBE TABLE default.erc1155_transfers`,
      format: 'JSONEachRow'
    });
    const cols = await schema.json<any[]>();
    const colNames = cols.map((c: any) => c.name).join(', ');
    console.log(`   Columns: ${colNames}\n`);

    const hasOperator = colNames.includes('operator');
    const hasFrom = colNames.includes('from_address');
    const hasTo = colNames.includes('to_address');

    if (!hasOperator && !hasFrom && !hasTo) {
      console.log('   ❌ No operator/from/to fields found. Schema mismatch.\n');
      await ch.close();
      return;
    }

    // Step 2: Sample data to understand the relationship
    console.log('2️⃣  Sampling ERC-1155 transfers to understand operator relationship...');
    const sample = await ch.query({
      query: `
        SELECT
          operator,
          from_address,
          to_address,
          count() as transfer_count,
          countDistinct(from_address) as unique_from,
          countDistinct(to_address) as unique_to
        FROM default.erc1155_transfers
        WHERE from_address != to_address
        GROUP BY operator, from_address, to_address
        LIMIT 10
      `,
      format: 'JSONEachRow'
    });
    const data = await sample.json<any[]>();

    if (data.length === 0) {
      console.log('   ❌ No transfers found with operator/from/to data\n');
      await ch.close();
      return;
    }

    for (const row of data) {
      console.log(`\n   Operator: ${row.operator?.substring(0, 10)}...`);
      console.log(`   From:     ${row.from_address?.substring(0, 10)}...`);
      console.log(`   To:       ${row.to_address?.substring(0, 10)}...`);
      console.log(`   Transfers: ${row.transfer_count}`);
    }

    // Step 3: Test with known wallet
    console.log('\n3️⃣  Looking for operators in 0xcce2b7c71f21e358b8e5e797e586cbc03160d58b transfers...');
    const wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
    const ops = await ch.query({
      query: `
        SELECT DISTINCT
          operator,
          count() as transfer_count
        FROM default.erc1155_transfers
        WHERE from_address = lower('${wallet}')
          OR to_address = lower('${wallet}')
          OR operator = lower('${wallet}')
        GROUP BY operator
        ORDER BY transfer_count DESC
        LIMIT 5
      `,
      format: 'JSONEachRow'
    });
    const opData = await ops.json<any[]>();

    if (opData.length === 0) {
      console.log(`   ❌ No ERC-1155 transfers found for this wallet\n`);
    } else {
      console.log(`   ✅ Found ${opData.length} distinct operators:\n`);
      for (const op of opData) {
        console.log(`      ${op.operator?.substring(0, 16)}... (${op.transfer_count} transfers)`);
      }
    }

    // Step 4: Operator frequency analysis
    console.log('\n4️⃣  Operator patterns (is operator usually same as from_address or different?)');
    const pattern = await ch.query({
      query: `
        SELECT
          sumIf(1, operator = from_address) as operator_eq_from,
          sumIf(1, operator = to_address) as operator_eq_to,
          sumIf(1, operator != from_address AND operator != to_address) as operator_different,
          count() as total_transfers
        FROM default.erc1155_transfers
        LIMIT 1000000
      `,
      format: 'JSONEachRow'
    });
    const patternData = await pattern.json<any[]>();
    if (patternData.length > 0) {
      const p = patternData[0];
      const total = p.total_transfers;
      console.log(`   Operator = from_address: ${p.operator_eq_from} (${((p.operator_eq_from/total)*100).toFixed(1)}%)`);
      console.log(`   Operator = to_address:   ${p.operator_eq_to} (${((p.operator_eq_to/total)*100).toFixed(1)}%)`);
      console.log(`   Operator different:      ${p.operator_different} (${((p.operator_different/total)*100).toFixed(1)}%)\n`);
    }

    console.log('═'.repeat(80));
    console.log('INTERPRETATION');
    console.log('═'.repeat(80));
    console.log(`\nIf operator ≠ from_address: operator might be the REAL TRADER`);
    console.log(`  → Proxy relationship: from_address is proxy, operator is actual wallet\n`);

  } catch (e: any) {
    console.error(`Error: ${e.message}`);
  }

  await ch.close();
}

main().catch(console.error);
