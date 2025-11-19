#!/usr/bin/env tsx
/**
 * Fetch AMM Trades from Polymarket Activity Subgraph
 *
 * Query Split/Merge events for xcnstrategy wallet on 6 ghost markets
 */

import { resolve } from 'path';
import { config } from 'dotenv';
config({ path: resolve(process.cwd(), '.env.local') });

const ACTIVITY_SUBGRAPH_URL = 'https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/activity-subgraph/0.0.4/gn';

const XCN_EOA = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
const XCN_PROXY = '0xd59d03eeb0fd5979c702ba20bcc25da2ae1d9723';

// 6 ghost markets (lowercase, no 0x for GraphQL)
const GHOST_CONDITION_IDS = [
  '293fb49f43b12631ec4ad0617d9c0efc0eacce33416ef16f68521427daca1678',
  'f2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1',
  'bff3fad6e9c96b6e3714c52e6d916b1ffb0f52cdfdb77c7fb153a8ef1ebff608',
  'e9c127a8c35f045d37b5344b0a36711084fa20c2fc1618bf178a5386f90610be',
  'ce733629b3b1bea0649c9c9433401295eb8e1ba6d572803cb53446c93d28cd44',
  'fc4453f83b30fdad8ac707b7bd11309aa4c4c90d0c17ad0c4680d4142d4471f7'
].map(cid => cid.toLowerCase());

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
  console.log('Fetching AMM Trades from Polymarket Activity Subgraph');
  console.log('='.repeat(80));
  console.log('');
  console.log(`Wallet: ${XCN_EOA}`);
  console.log(`Conditions: ${GHOST_CONDITION_IDS.length} ghost markets`);
  console.log('');

  // Query 1: Fetch Split events (BUY trades)
  console.log('Querying Split events (BUY trades)...');
  console.log('');

  const splitsQuery = `
    {
      splits(
        first: 1000
        where: {
          stakeholder_in: ["${XCN_EOA.toLowerCase()}", "${XCN_PROXY.toLowerCase()}"]
        }
        orderBy: timestamp
        orderDirection: asc
      ) {
        id
        timestamp
        stakeholder
        condition {
          id
        }
        amount
      }
    }
  `;

  const splitsResult = await querySubgraph(splitsQuery);

  if (splitsResult.errors) {
    console.log('❌ Splits query errors:', splitsResult.errors);
    return;
  }

  const allSplits = splitsResult.data.splits || [];
  console.log(`Total splits for wallet: ${allSplits.length}`);
  console.log('');

  // Filter to ghost markets only
  const ghostSplits = allSplits.filter((split: any) =>
    GHOST_CONDITION_IDS.includes(split.condition.id.toLowerCase())
  );

  console.log(`Splits on ghost markets: ${ghostSplits.length}`);
  console.log('');

  if (ghostSplits.length > 0) {
    console.log('Sample splits:');
    for (const split of ghostSplits.slice(0, 5)) {
      console.log(`  ${new Date(split.timestamp * 1000).toISOString()}: ${split.amount} shares on ${split.condition.id.substring(0, 12)}...`);
    }
    console.log('');
  }

  // Query 2: Fetch Merge events (SELL trades)
  console.log('Querying Merge events (SELL trades)...');
  console.log('');

  const mergesQuery = `
    {
      merges(
        first: 1000
        where: {
          stakeholder_in: ["${XCN_EOA.toLowerCase()}", "${XCN_PROXY.toLowerCase()}"]
        }
        orderBy: timestamp
        orderDirection: asc
      ) {
        id
        timestamp
        stakeholder
        condition {
          id
        }
        amount
      }
    }
  `;

  const mergesResult = await querySubgraph(mergesQuery);

  if (mergesResult.errors) {
    console.log('❌ Merges query errors:', mergesResult.errors);
    return;
  }

  const allMerges = mergesResult.data.merges || [];
  console.log(`Total merges for wallet: ${allMerges.length}`);
  console.log('');

  // Filter to ghost markets only
  const ghostMerges = allMerges.filter((merge: any) =>
    GHOST_CONDITION_IDS.includes(merge.condition.id.toLowerCase())
  );

  console.log(`Merges on ghost markets: ${ghostMerges.length}`);
  console.log('');

  if (ghostMerges.length > 0) {
    console.log('Sample merges:');
    for (const merge of ghostMerges.slice(0, 5)) {
      console.log(`  ${new Date(merge.timestamp * 1000).toISOString()}: ${merge.amount} shares on ${merge.condition.id.substring(0, 12)}...`);
    }
    console.log('');
  }

  // Query 3: Fetch Redemption events (claiming winnings)
  console.log('Querying Redemption events (claiming winnings)...');
  console.log('');

  const redemptionsQuery = `
    {
      redemptions(
        first: 1000
        where: {
          redeemer_in: ["${XCN_EOA.toLowerCase()}", "${XCN_PROXY.toLowerCase()}"]
        }
        orderBy: timestamp
        orderDirection: asc
      ) {
        id
        timestamp
        redeemer
        condition {
          id
        }
        payout
        indexSets
      }
    }
  `;

  const redemptionsResult = await querySubgraph(redemptionsQuery);

  if (redemptionsResult.errors) {
    console.log('❌ Redemptions query errors:', redemptionsResult.errors);
    return;
  }

  const allRedemptions = redemptionsResult.data.redemptions || [];
  console.log(`Total redemptions for wallet: ${allRedemptions.length}`);
  console.log('');

  // Debug: Check structure
  if (allRedemptions.length > 0) {
    console.log('Sample redemption structure:');
    console.log(JSON.stringify(allRedemptions[0], null, 2));
    console.log('');
  }

  // Filter to ghost markets only (with null check)
  const ghostRedemptions = allRedemptions.filter((redemption: any) => {
    if (!redemption.condition || !redemption.condition.id) {
      return false;
    }
    return GHOST_CONDITION_IDS.includes(redemption.condition.id.toLowerCase());
  });

  console.log(`Redemptions on ghost markets: ${ghostRedemptions.length}`);
  console.log('');

  // Summary
  console.log('='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log('');

  console.log('Ghost Market Activity:');
  console.log(`  Splits (BUY):  ${ghostSplits.length}`);
  console.log(`  Merges (SELL): ${ghostMerges.length}`);
  console.log(`  Redemptions:   ${ghostRedemptions.length}`);
  console.log(`  Total events:  ${ghostSplits.length + ghostMerges.length + ghostRedemptions.length}`);
  console.log('');

  // Calculate total volume
  const splitVolume = ghostSplits.reduce((sum: number, s: any) => sum + parseFloat(s.amount), 0);
  const mergeVolume = ghostMerges.reduce((sum: number, s: any) => sum + parseFloat(s.amount), 0);
  const redemptionVolume = ghostRedemptions.reduce((sum: number, r: any) => sum + parseFloat(r.payout), 0);

  console.log('Volume by Type:');
  console.log(`  Splits:      ${splitVolume.toFixed(2)} shares`);
  console.log(`  Merges:      ${mergeVolume.toFixed(2)} shares`);
  console.log(`  Redemptions: ${redemptionVolume.toFixed(2)} USDC`);
  console.log('');

  // Dome expectation
  console.log('Dome Expected:');
  console.log('  21 trades, 23,890.13 shares');
  console.log('');

  if (ghostSplits.length + ghostMerges.length + ghostRedemptions.length === 0) {
    console.log('⚠️  NO GHOST MARKET ACTIVITY FOUND');
    console.log('');
    console.log('Possible reasons:');
    console.log('1. Activity subgraph does not index these markets');
    console.log('2. Different wallet addresses used (not EOA or known proxy)');
    console.log('3. Markets settled before subgraph deployment');
    console.log('');
    console.log('Recommendation:');
    console.log('- Try Positions subgraph instead (may have different data)');
    console.log('- Or fall back to Dune Analytics / Dome API');
  } else {
    console.log('✅ FOUND GHOST MARKET ACTIVITY!');
    console.log('');
    console.log('Next steps:');
    console.log('1. Transform Split/Merge → pm_trades format');
    console.log('2. Insert into ClickHouse');
    console.log('3. Recompute P&L');
    console.log('4. Validate against Dome');
  }
}

main().catch((error) => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});
