import { config } from 'dotenv';
import path from 'path';

config({ path: path.resolve(process.cwd(), '.env.local') });

async function testBothFormats() {
  // Test with decimal asset_id
  const decimalAssetId = '108562650306920317036228266091439415826829651532668780696811039786850402176775';

  // Convert to hex
  const hexAssetId = BigInt(decimalAssetId).toString(16);

  console.log('Asset ID formats:');
  console.log(`  Decimal: ${decimalAssetId}`);
  console.log(`  Hex: ${hexAssetId}`);
  console.log(`  Hex length: ${hexAssetId.length}\n`);

  const query = `
    query GetOrderFills($tokenId: String!) {
      orderFilledEvents(
        where: {
          or: [
            { makerAssetId_contains: $tokenId },
            { takerAssetId_contains: $tokenId }
          ]
        }
        first: 5
      ) {
        id
        makerAssetId
        takerAssetId
      }
    }
  `;

  console.log('Testing with HEX format...');
  const hexResponse = await fetch(
    'https://api.goldsky.com/api/public/project_clobs1/subgraphs/clob-production/latest/gn',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        variables: { tokenId: hexAssetId },
      }),
    }
  );

  const hexResult = await hexResponse.json();
  console.log(`  Status: ${hexResponse.status}`);
  console.log(`  Fills found: ${hexResult.data?.orderFilledEvents?.length || 0}`);
  if (hexResult.errors) {
    console.log(`  Errors: ${JSON.stringify(hexResult.errors)}`);
  }

  console.log('\nTesting with DECIMAL format...');
  const decResponse = await fetch(
    'https://api.goldsky.com/api/public/project_clobs1/subgraphs/clob-production/latest/gn',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        variables: { tokenId: decimalAssetId },
      }),
    }
  );

  const decResult = await decResponse.json();
  console.log(`  Status: ${decResponse.status}`);
  console.log(`  Fills found: ${decResult.data?.orderFilledEvents?.length || 0}`);
  if (decResult.errors) {
    console.log(`  Errors: ${JSON.stringify(decResult.errors)}`);
  }

  // Try getting ANY fills to see the format
  console.log('\n\nGetting sample fills (no filter)...');
  const sampleQuery = `
    query GetSample {
      orderFilledEvents(first: 3) {
        id
        makerAssetId
        takerAssetId
        timestamp
      }
    }
  `;

  const sampleResponse = await fetch(
    'https://api.goldsky.com/api/public/project_clobs1/subgraphs/clob-production/latest/gn',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sampleQuery }),
    }
  );

  const sampleResult = await sampleResponse.json();
  console.log(`  Status: ${sampleResponse.status}`);
  if (sampleResult.data?.orderFilledEvents) {
    console.log(`  Sample fills:`, JSON.stringify(sampleResult.data.orderFilledEvents, null, 2));
  } else {
    console.log(`  No fills or errors:`, JSON.stringify(sampleResult, null, 2));
  }
}

testBothFormats().catch(console.error);
