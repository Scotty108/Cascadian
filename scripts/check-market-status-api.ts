#!/usr/bin/env npx tsx
/**
 * Check market resolution status via Polymarket CLOB API
 *
 * Tests if the wallet's markets are actually resolved or still open.
 */

const MARKET_IDS = [
  '0x3eb16c3138377017c6a27f11b0d5ebf6c1f57b7cc38bd34cf09f3b3a09fa39be00',
  '0xdfa2fbe708fefc0fc3e3f3f3bb49e8e8e8c9c9c9c9c9c9c9c9c9c9c9c9c9c9c900',
  '0xb2ea311c60bc55900fe9ff073e2c8b8e8e8c9c9c9c9c9c9c9c9c9c9c9c9c9c900',
  '0x00bbbbe23c0fc0ff0d30809419c4eeecc14df9b4d789e92d9782a14ec0a3fd7600',
];

async function checkMarket(marketId: string) {
  try {
    console.log(`\nChecking market ${marketId.substring(0, 20)}...`);

    // Try CLOB API first (has market status)
    const response = await fetch(`https://clob.polymarket.com/markets/${marketId}`);

    if (!response.ok) {
      console.log(`  ❌ Not found in CLOB API (${response.status})`);
      return null;
    }

    const data = await response.json();

    console.log(`  Title: ${data.question || 'Unknown'}`);
    console.log(`  Closed: ${data.closed}`);
    console.log(`  Active: ${data.active}`);
    console.log(`  Resolved: ${data.resolved !== undefined ? data.resolved : 'N/A'}`);

    if (data.closed && data.resolved) {
      console.log(`  ✅ RESOLVED - Need to fetch payout data!`);
      return { resolved: true, data };
    } else if (data.closed && !data.active) {
      console.log(`  ⚠️  CLOSED but not resolved - Delisted?`);
      return { resolved: false, data };
    } else {
      console.log(`  ℹ️  OPEN - Market still active`);
      return { resolved: false, data };
    }
  } catch (e: any) {
    console.log(`  ❌ Error: ${e.message}`);
    return null;
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('CHECKING MARKET RESOLUTION STATUS');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log(`\nChecking ${MARKET_IDS.length} markets from audit wallet...\n`);

  const results = [];

  for (const marketId of MARKET_IDS) {
    const result = await checkMarket(marketId);
    results.push(result);
    // Rate limit
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log('\n═'.repeat(80));
  console.log('SUMMARY');
  console.log('═'.repeat(80));

  const resolved = results.filter(r => r?.resolved).length;
  const open = results.filter(r => r && !r.resolved).length;
  const notFound = results.filter(r => r === null).length;

  console.log(`\nResolved: ${resolved}/${MARKET_IDS.length}`);
  console.log(`Open/Delisted: ${open}/${MARKET_IDS.length}`);
  console.log(`Not Found: ${notFound}/${MARKET_IDS.length}`);

  console.log('\n═'.repeat(80));
  console.log('VERDICT');
  console.log('═'.repeat(80));
  console.log('');

  if (resolved > 0) {
    console.log(`✅ FOUND ${resolved} RESOLVED MARKETS`);
    console.log('');
    console.log('Next step: Fetch payout data for these markets and ingest into vw_resolutions_truth.');
    console.log('This should close the gap to Polymarket\'s $332K P&L.');
  } else if (open > 0) {
    console.log(`⚠️  ALL MARKETS ARE OPEN OR DELISTED (NOT RESOLVED)`);
    console.log('');
    console.log('This explains the gap:');
    console.log('  - Polymarket shows UNREALIZED P&L (based on current midprices)');
    console.log('  - Our system shows SETTLED P&L (only resolved markets)');
    console.log('  - Since none are resolved, settled P&L is $0');
    console.log('');
    console.log('The $332K is unrealized gains, not settled gains.');
    console.log('We need to backfill midprices to show unrealized P&L.');
  } else {
    console.log('❌ MARKETS NOT FOUND');
    console.log('');
    console.log('These market IDs may be invalid or delisted.');
    console.log('Need to investigate further.');
  }
  console.log('');
}

main().catch(console.error);
