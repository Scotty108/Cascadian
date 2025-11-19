#!/usr/bin/env tsx
/**
 * Test what format Goldsky actually returns for payout arrays
 */

const GOLDSKY_ENDPOINT =
  'https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/positions-subgraph/0.0.7/gn';

async function fetchSample() {
  const query = `{
    conditions(
      first: 5
      where: {payouts_not: null}
      orderBy: id
      orderDirection: asc
    ) {
      id
      payouts
    }
  }`;

  const response = await fetch(GOLDSKY_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });

  const result = await response.json();
  console.log('📊 Sample Goldsky Response:\n');
  console.log(JSON.stringify(result.data.conditions, null, 2));

  // Test parsing
  console.log('\n🔍 Testing payout parsing:');
  result.data.conditions.forEach((c: any) => {
    console.log(`\nCondition: ${c.id}`);
    console.log(`Raw payouts:`, c.payouts);
    console.log(`Payouts type:`, typeof c.payouts);
    console.log(`Is array:`, Array.isArray(c.payouts));

    if (Array.isArray(c.payouts)) {
      const parsed = c.payouts.map((p: any) => {
        console.log(`  - Raw: "${p}" (type: ${typeof p})`);
        const num = parseFloat(p);
        console.log(`  - Parsed: ${num} (isNaN: ${isNaN(num)})`);
        return num;
      });
      console.log(`Parsed array:`, parsed);
    }
  });
}

fetchSample().catch(console.error);
