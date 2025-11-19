#!/usr/bin/env npx tsx
/**
 * Test different query patterns against Goldsky Activity Subgraph
 */

const CONDITION_ID = '0x54625984ec20476ea88ceeaa93c1e38f3bccdd038adf391744a9a0bc1222ff9e';

async function testQuery(name: string, query: string, variables: any = {}) {
  console.log(`\nTesting: ${name}`);
  console.log('─'.repeat(80));
  
  try {
    const response = await fetch(
      'https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/activity-subgraph/0.0.4/gn',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables }),
      }
    );

    const result = await response.json();

    if (result.errors) {
      console.log(`❌ Error: ${result.errors[0].message}`);
    } else if (result.data) {
      console.log('✅ Success!');
      console.log(JSON.stringify(result.data, null, 2));
    } else {
      console.log('⚠️  No data or errors');
      console.log(JSON.stringify(result, null, 2));
    }
  } catch (err) {
    console.log(`❌ Fetch error: ${(err as Error).message}`);
  }
}

async function main() {
  // Test 1: Try to get condition by ID
  await testQuery(
    'Get Condition by ID',
    `query GetCondition($id: String!) {
      condition(id: $id) {
        id
      }
    }`,
    { id: CONDITION_ID.toLowerCase() }
  );

  // Test 2: Try plural conditions query
  await testQuery(
    'List Conditions',
    `query GetConditions($id: String!) {
      conditions(where: { id: $id }, first: 1) {
        id
      }
    }`,
    { id: CONDITION_ID.toLowerCase() }
  );

  // Test 3: Try positions query
  await testQuery(
    'List Positions by Condition',
    `query GetPositions($conditionId: String!) {
      positions(where: { conditionId: $conditionId }, first: 5) {
        id
        conditionId
        collectionId
      }
    }`,
    { conditionId: CONDITION_ID.toLowerCase() }
  );

  // Test 4: GraphQL introspection to see available types
  await testQuery(
    'Schema Introspection',
    `query IntrospectionQuery {
      __schema {
        queryType {
          fields {
            name
            type {
              name
              kind
            }
          }
        }
      }
    }`
  );
}

main();
