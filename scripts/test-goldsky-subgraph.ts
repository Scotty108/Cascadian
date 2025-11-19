#!/usr/bin/env npx tsx

/**
 * Test Goldsky Polymarket Subgraph Endpoints
 * Purpose: Verify what data is available from public Goldsky subgraphs
 */

const ENDPOINTS = {
  orders: 'https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/orderbook-subgraph/0.0.1/gn',
  // Add other endpoints as discovered
};

async function testOrdersSubgraph() {
  console.log('Testing Goldsky Orders Subgraph');
  console.log('='.repeat(80), '\n');

  // Test 1: Get recent OrderFilledEvents
  console.log('1. Testing OrderFilledEvent query:');
  try {
    const query = `
      {
        orderFilledEvents(first: 3, orderBy: timestamp, orderDirection: desc) {
          id
          timestamp
          transactionHash
          maker
          taker
          makerAssetId
          takerAssetId
          makerAmountFilled
          takerAmountFilled
          fee
        }
      }
    `;

    const response = await fetch(ENDPOINTS.orders, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });

    if (!response.ok) {
      console.log(`   ❌ HTTP ${response.status}: ${response.statusText}`);
      const text = await response.text();
      console.log(`   Response: ${text.slice(0, 200)}\n`);
      return;
    }

    const data = await response.json();
    console.log(`   ✅ Success`);
    console.log(JSON.stringify(data, null, 2), '\n');
  } catch (e: any) {
    console.log(`   ❌ Error: ${e.message}\n`);
  }

  // Test 2: Get schema introspection
  console.log('2. Testing schema introspection:');
  try {
    const query = `
      {
        __schema {
          types {
            name
            kind
            description
          }
        }
      }
    `;

    const response = await fetch(ENDPOINTS.orders, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });

    if (!response.ok) {
      console.log(`   ❌ HTTP ${response.status}: ${response.statusText}\n`);
      return;
    }

    const data = await response.json();
    const types = data.data?.__schema?.types || [];
    const relevantTypes = types.filter((t: any) =>
      !t.name.startsWith('__') &&
      t.kind === 'OBJECT' &&
      !['Query', 'Subscription'].includes(t.name)
    );

    console.log(`   ✅ Found ${relevantTypes.length} entity types:`);
    relevantTypes.forEach((t: any) => {
      console.log(`      - ${t.name}${t.description ? ': ' + t.description : ''}`);
    });
    console.log('');
  } catch (e: any) {
    console.log(`   ❌ Error: ${e.message}\n`);
  }
}

testOrdersSubgraph().catch(console.error);
