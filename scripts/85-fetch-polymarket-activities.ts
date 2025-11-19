#!/usr/bin/env npx tsx

const WALLET = '0x7f3c8979d0afa00007bae4747d5347122af05613';

async function fetchAllActivities() {
  let allActivities: any[] = [];
  let offset = 0;
  const limit = 100;
  let hasMore = true;

  console.log('Fetching all Polymarket activities...\n');

  while (hasMore) {
    const url = `https://data-api.polymarket.com/activities?user=${WALLET}&limit=${limit}&offset=${offset}`;

    try {
      const response = await fetch(url);
      const data = await response.json();

      if (data.activities && Array.isArray(data.activities)) {
        allActivities = allActivities.concat(data.activities);
        console.log(`Fetched ${data.activities.length} activities (offset ${offset})...`);
      }

      hasMore = data.pagination?.has_more || false;
      offset += limit;

      // Safety limit
      if (offset > 10000) {
        console.log('Safety limit reached (10,000 activities)');
        break;
      }

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      console.error(`Error at offset ${offset}:`, error);
      break;
    }
  }

  console.log(`\nTotal activities fetched: ${allActivities.length}`);

  // Analyze by side
  const bySide = allActivities.reduce((acc: any, a: any) => {
    acc[a.side] = (acc[a.side] || 0) + 1;
    return acc;
  }, {});

  console.log('\nBreakdown by side:');
  Object.entries(bySide).forEach(([side, count]) => {
    console.log(`  ${side}: ${count}`);
  });

  // Analyze redemptions
  const redemptions = allActivities.filter(a => a.side === 'REDEEM');
  const totalRedeemed = redemptions.reduce((sum, r) => sum + parseFloat(r.shares_normalized || 0), 0);

  console.log(`\nRedemptions (settlements):`);
  console.log(`  Count: ${redemptions.length}`);
  console.log(`  Total shares redeemed: ${totalRedeemed.toLocaleString()}`);

  // Unique markets
  const uniqueMarkets = new Set(allActivities.map(a => a.condition_id).filter(Boolean));
  console.log(`\nUnique markets: ${uniqueMarkets.size}`);

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('COMPARISON WITH OUR DATA:');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`Polymarket activities:    ${allActivities.length}`);
  console.log(`Our CLOB fills:           2,795`);
  console.log(`Difference:               ${Math.abs(allActivities.length - 2795)}`);
  console.log();
  console.log(`Polymarket unique markets: ${uniqueMarkets.size}`);
  console.log(`Our unique markets:        168`);
  console.log(`Difference:                ${Math.abs(uniqueMarkets.size - 168)}`);
}

fetchAllActivities().catch(console.error);
