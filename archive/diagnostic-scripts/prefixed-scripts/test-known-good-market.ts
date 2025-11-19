import { clickhouse } from './lib/clickhouse/client';
import { config } from 'dotenv';
import path from 'path';

config({ path: path.resolve(process.cwd(), '.env.local') });

async function testKnownGood() {
  // Get a market that HAS fills
  const result = await clickhouse.query({
    query: `
      SELECT condition_id, asset_id, count(*) as fill_count
      FROM clob_fills
      GROUP BY condition_id, asset_id
      HAVING fill_count > 10
      LIMIT 1
    `,
    format: 'JSONEachRow'
  });
  const data: any = await result.json();

  if (data.length === 0) {
    console.log('No markets with fills found!');
    return;
  }

  const market = data[0];
  console.log(`Testing market WITH fills in database:`);
  console.log(`  condition_id: ${market.condition_id}`);
  console.log(`  asset_id: ${market.asset_id}`);
  console.log(`  local fills: ${market.fill_count}\n`);

  // Now test Goldsky API
  const normalizedConditionId = market.condition_id.toLowerCase().replace('0x', '');
  const normalizedAssetId = market.asset_id.toLowerCase().replace('0x', '');

  console.log(`Normalized for API:`);
  console.log(`  condition_id: ${normalizedConditionId}`);
  console.log(`  asset_id: ${normalizedAssetId}\n`);

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
        makerAssetId
        takerAssetId
        makerAmountFilled
        takerAmountFilled
      }
    }
  `;

  const response = await fetch(
    'https://api.goldsky.com/api/public/project_clobs1/subgraphs/clob-production/latest/gn',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        variables: { tokenId: normalizedAssetId },
      }),
    }
  );

  console.log(`API Response: ${response.status}`);
  const apiResult = await response.json();

  if (apiResult.errors) {
    console.log('Errors:', JSON.stringify(apiResult.errors, null, 2));
  } else {
    const fills = apiResult.data?.orderFilledEvents || [];
    console.log(`Found ${fills.length} fills from Goldsky API`);
    if (fills.length > 0) {
      console.log('\nFirst fill:');
      console.log(JSON.stringify(fills[0], null, 2));
    }
  }
}

testKnownGood().catch(console.error);
