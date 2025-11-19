#!/usr/bin/env tsx
/**
 * Test Polymarket Activity Subgraph
 *
 * Goal: Query the Activity subgraph to fetch AMM trades for xcnstrategy wallet
 */

import { resolve } from 'path';
import { config } from 'dotenv';
config({ path: resolve(process.cwd(), '.env.local') });

const ACTIVITY_SUBGRAPH_URL = 'https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/activity-subgraph/0.0.4/gn';

const XCN_EOA = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
const XCN_PROXY = '0xd59d03eeb0fd5979c702ba20bcc25da2ae1d9723';

// 6 ghost markets
const GHOST_CONDITION_IDS = [
  '0x293fb49f43b12631ec4ad0617d9c0efc0eacce33416ef16f68521427daca1678',
  '0xf2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1',
  '0xbff3fad6e9c96b6e3714c52e6d916b1ffb0f52cdfdb77c7fb153a8ef1ebff608',
  '0xe9c127a8c35f045d37b5344b0a36711084fa20c2fc1618bf178a5386f90610be',
  '0xce733629b3b1bea0649c9c9433401295eb8e1ba6d572803cb53446c93d28cd44',
  '0xfc4453f83b30fdad8ac707b7bd11309aa4c4c90d0c17ad0c4680d4142d4471f7'
];

async function querySubgraph(query: string) {
  const response = await fetch(ACTIVITY_SUBGRAPH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query })
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return await response.json();
}

async function main() {
  console.log('Testing Polymarket Activity Subgraph');
  console.log('='.repeat(80));
  console.log('');
  console.log(`Endpoint: ${ACTIVITY_SUBGRAPH_URL}`);
  console.log('');

  // Test 1: Introspection query to discover schema
  console.log('Test 1: Schema Introspection');
  console.log('-'.repeat(80));

  const introspectionQuery = `
    {
      __schema {
        types {
          name
          fields {
            name
            type {
              name
              kind
            }
          }
        }
      }
    }
  `;

  try {
    const schemaResult = await querySubgraph(introspectionQuery);

    if (schemaResult.errors) {
      console.log('❌ Introspection errors:', schemaResult.errors);
    } else if (schemaResult.data?.__schema) {
      console.log('✅ Schema discovered!');
      console.log('');
      console.log('Available entities:');

      const types = schemaResult.data.__schema.types.filter((t: any) =>
        !t.name.startsWith('__') &&
        t.fields &&
        t.fields.length > 0 &&
        !['Query', 'Subscription', 'BigDecimal', 'BigInt', 'Bytes'].includes(t.name)
      );

      for (const type of types.slice(0, 10)) {
        console.log(`\n${type.name}:`);
        for (const field of (type.fields || []).slice(0, 8)) {
          console.log(`  - ${field.name}: ${field.type.name || field.type.kind}`);
        }
      }
    }
  } catch (error: any) {
    console.log(`❌ Introspection failed: ${error.message}`);
  }

  console.log('');
  console.log('');

  // Test 2: Try common entity names for trades
  console.log('Test 2: Query Common Trade Entities');
  console.log('-'.repeat(80));
  console.log('');

  const entityTests = [
    { name: 'trades', idField: 'id' },
    { name: 'userTrades', idField: 'id' },
    { name: 'swaps', idField: 'id' },
    { name: 'transactions', idField: 'id' },
    { name: 'activities', idField: 'id' }
  ];

  for (const entity of entityTests) {
    console.log(`Trying entity: ${entity.name}`);

    const testQuery = `
      {
        ${entity.name}(
          first: 5
          where: {
            user: "${XCN_EOA.toLowerCase()}"
          }
        ) {
          ${entity.idField}
        }
      }
    `;

    try {
      const result = await querySubgraph(testQuery);

      if (result.errors) {
        console.log(`  ❌ Not available: ${result.errors[0].message}`);
      } else if (result.data?.[entity.name]) {
        console.log(`  ✅ Found! ${result.data[entity.name].length} results`);
        console.log(`  Sample:`, JSON.stringify(result.data[entity.name][0], null, 2));
      } else {
        console.log(`  ⚠️  No data returned`);
      }
    } catch (error: any) {
      console.log(`  ❌ Query failed: ${error.message}`);
    }

    console.log('');
  }

  console.log('');
  console.log('='.repeat(80));
  console.log('NEXT STEPS');
  console.log('='.repeat(80));
  console.log('');
  console.log('Once we identify the correct entity name and fields:');
  console.log('1. Query for xcnstrategy trades on 6 ghost condition_ids');
  console.log('2. Transform to pm_trades format');
  console.log('3. Insert into ClickHouse');
  console.log('4. Validate against Dome (21 trades, 23,890.13 shares)');
}

main().catch((error) => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});
