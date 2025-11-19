import { config } from 'dotenv';
import path from 'path';

config({ path: path.resolve(process.cwd(), '.env.local') });

async function testQuery() {
  const conditionId = '0xfae06963c2516ad164e8d0b939a69f75ac9e9b7806be307886ac2cef8a22a291';
  const normalizedId = conditionId.toLowerCase().replace('0x', '');

  console.log(`Testing condition_id: ${conditionId}`);
  console.log(`Normalized: ${normalizedId}\n`);

  const query = `
    query GetOrderFills($tokenId: String!, $first: Int!) {
      orderFilledEvents(
        where: {
          or: [
            { makerAssetId: $tokenId },
            { takerAssetId: $tokenId }
          ]
        }
        first: $first
        orderBy: timestamp
        orderDirection: desc
      ) {
        id
        transactionHash
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
      'https://api.goldsky.com/api/public/project_clobs1/subgraphs/clob-production/latest/gn',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          variables: { tokenId: normalizedId, first: 10 },
        }),
      }
    );

    console.log(`HTTP Status: ${response.status}\n`);

    const result = await response.json();

    if (result.errors) {
      console.log('GraphQL Errors:');
      console.log(JSON.stringify(result.errors, null, 2));
    } else {
      const fills = result.data?.orderFilledEvents || [];
      console.log(`✅ Success! Found ${fills.length} fills`);
      if (fills.length > 0) {
        console.log('\nFirst fill:');
        console.log(JSON.stringify(fills[0], null, 2));
      }
    }
  } catch (err) {
    console.error('Error:', err);
  }
}

testQuery().catch(console.error);
