import { config } from 'dotenv';
import path from 'path';

config({ path: path.resolve(process.cwd(), '.env.local') });

async function testCorrectEndpoint() {
  const correctUrl = 'https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/orderbook-subgraph/prod/gn';

  console.log('Testing CORRECT Goldsky endpoint...\n');

  // Get sample fills
  const sampleQuery = `
    query GetSample {
      orderFilledEvents(first: 3) {
        id
        makerAssetId
        takerAssetId
        timestamp
        transactionHash
      }
    }
  `;

  const response = await fetch(correctUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sampleQuery }),
  });

  console.log(`HTTP Status: ${response.status}\n`);

  const result = await response.json();

  if (result.errors) {
    console.log('Errors:', JSON.stringify(result.errors, null, 2));
  } else if (result.data?.orderFilledEvents) {
    console.log(`✅ SUCCESS! Found ${result.data.orderFilledEvents.length} fills\n`);
    console.log('Sample fills:');
    result.data.orderFilledEvents.forEach((fill: any, i: number) => {
      console.log(`\n${i + 1}.`);
      console.log(`  makerAssetId: ${fill.makerAssetId}`);
      console.log(`  takerAssetId: ${fill.takerAssetId}`);
      console.log(`  timestamp: ${new Date(fill.timestamp * 1000).toISOString()}`);
      console.log(`  tx: ${fill.transactionHash}`);
    });
  } else {
    console.log('Unexpected response:', JSON.stringify(result, null, 2));
  }
}

testCorrectEndpoint().catch(console.error);
