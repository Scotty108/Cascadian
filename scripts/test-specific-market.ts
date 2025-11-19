#!/usr/bin/env npx tsx
/**
 * Test a specific recent market that SHOULD have fills
 */

const MARKET = {
  question: "Evansville Aces vs. Purdue Boilermakers: O/U 149.5",
  condition_id: "0x54625984ec20476ea88ceeaa93c1e38f3bccdd038adf391744a9a0bc1222ff9e",
  token_id: "23595159900201440292163582921668176574982876357547003450906099724556243903822"
};

console.log('Testing Market:', MARKET.question);
console.log('Condition ID:', MARKET.condition_id);
console.log('Token ID:', MARKET.token_id);
console.log('');

async function testGoldskyAPI() {
  console.log('1. Testing Goldsky API...');

  const query = `
    query GetOrderFills($tokenId: String!) {
      orderFilledEvents(
        where: {
          or: [
            { makerAssetId: $tokenId },
            { takerAssetId: $tokenId }
          ]
        }
        first: 10
        orderBy: timestamp
        orderDirection: desc
      ) {
        id
        timestamp
        makerAssetId
        takerAssetId
        makerAmountFilled
        takerAmountFilled
      }
    }
  `;

  try {
    const response = await fetch(
      'https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/orderbook-subgraph/prod/gn',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          variables: { tokenId: MARKET.token_id },
        }),
      }
    );

    const result = await response.json();

    if (result.errors) {
      console.log('   ❌ API Error:', result.errors[0].message.substring(0, 100));
    } else {
      const fills = result.data?.orderFilledEvents || [];
      console.log(`   ${fills.length > 0 ? '✅' : '⚠️'} Found ${fills.length} fills`);

      if (fills.length > 0) {
        console.log('\n   First fill:');
        console.log('   ', JSON.stringify(fills[0], null, 2));
      }
    }
  } catch (err) {
    console.log('   ❌ Fetch error:', (err as Error).message);
  }
}

async function testPolymarketAPI() {
  console.log('\n2. Testing Polymarket Public API...');
  console.log('   (Checking if this market exists on Polymarket.com)');

  try {
    // Try to get market info from Polymarket
    const conditionIdClean = MARKET.condition_id.replace('0x', '');
    const response = await fetch(
      `https://gamma-api.polymarket.com/markets?condition_id=${conditionIdClean}`,
      {
        headers: {
          'Accept': 'application/json',
        },
      }
    );

    if (response.ok) {
      const data = await response.json();
      console.log(`   ✅ Market exists on Polymarket`);
      console.log(`   Response:`, JSON.stringify(data, null, 2).substring(0, 500));
    } else {
      console.log(`   ❌ Market not found on Polymarket (${response.status})`);
    }
  } catch (err) {
    console.log('   ❌ Polymarket API error:', (err as Error).message);
  }
}

async function main() {
  await testGoldskyAPI();
  await testPolymarketAPI();

  console.log('\n─'.repeat(80));
  console.log('CONCLUSION:');
  console.log('  If Goldsky shows 0 fills but Polymarket shows market exists,');
  console.log('  then Goldsky data is incomplete for this market.');
  console.log('─'.repeat(80));
}

main();
