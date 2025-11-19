#!/usr/bin/env npx tsx
/**
 * Investigate Reliable Sources for Resolved Markets
 * 
 * Test multiple data sources to find markets that are ACTUALLY resolved
 */

const GAMMA_API = 'https://gamma-api.polymarket.com';
const CLOB_API = 'https://clob.polymarket.com';

async function testGammaResolvedEndpoint() {
  console.log('\n1️⃣ Testing Gamma API - Closed Markets\n');
  
  try {
    // Try fetching closed markets
    const response = await fetch(`${GAMMA_API}/markets?closed=true&limit=100`);
    const data = await response.json();
    
    console.log(`  Status: ${response.status}`);
    console.log(`  Markets returned: ${Array.isArray(data) ? data.length : 0}`);
    
    if (Array.isArray(data) && data.length > 0) {
      // Check first few for payout data
      let withPayouts = 0;
      let withoutPayouts = 0;
      
      for (const market of data.slice(0, 20)) {
        if (market.payout_numerators && market.payout_numerators.length > 0) {
          withPayouts++;
        } else {
          withoutPayouts++;
        }
      }
      
      console.log(`  Sample (first 20):`);
      console.log(`    With payouts: ${withPayouts}`);
      console.log(`    Without payouts: ${withoutPayouts}`);
      
      // Show a resolved market example
      const resolved = data.find(m => m.payout_numerators?.length > 0);
      if (resolved) {
        console.log(`\n  Example resolved market:`);
        console.log(`    Question: ${resolved.question}`);
        console.log(`    Condition ID: ${resolved.conditionId}`);
        console.log(`    Payouts: [${resolved.payout_numerators.join(', ')}]`);
        console.log(`    Closed: ${resolved.closed}`);
      }
      
      return { success: true, count: data.length, endpoint: `${GAMMA_API}/markets?closed=true` };
    }
    
    return { success: false, error: 'No markets returned' };
  } catch (error: any) {
    console.log(`  Error: ${error.message}`);
    return { success: false, error: error.message };
  }
}

async function testGammaActiveFilter() {
  console.log('\n2️⃣ Testing Gamma API - Active=false Filter\n');
  
  try {
    const response = await fetch(`${GAMMA_API}/markets?active=false&limit=100`);
    const data = await response.json();
    
    console.log(`  Status: ${response.status}`);
    console.log(`  Markets returned: ${Array.isArray(data) ? data.length : 0}`);
    
    if (Array.isArray(data) && data.length > 0) {
      let withPayouts = 0;
      
      for (const market of data) {
        if (market.payout_numerators?.length > 0) {
          withPayouts++;
        }
      }
      
      console.log(`  Markets with payouts: ${withPayouts}/${data.length}`);
      return { success: true, count: withPayouts };
    }
    
    return { success: false, error: 'No markets returned' };
  } catch (error: any) {
    console.log(`  Error: ${error.message}`);
    return { success: false, error: error.message };
  }
}

async function testCLOBMarketsEndpoint() {
  console.log('\n3️⃣ Testing CLOB API - Markets Endpoint\n');
  
  try {
    const response = await fetch(`${CLOB_API}/markets`);
    const data = await response.json();
    
    console.log(`  Status: ${response.status}`);
    console.log(`  Response type: ${typeof data}`);
    console.log(`  Keys: ${Object.keys(data).slice(0, 10).join(', ')}`);
    
    return { success: response.ok };
  } catch (error: any) {
    console.log(`  Error: ${error.message}`);
    return { success: false, error: error.message };
  }
}

async function testSamplingStrategy() {
  console.log('\n4️⃣ Testing Sampling Strategy - Random Markets\n');
  
  try {
    // Fetch general markets and check resolution status
    const response = await fetch(`${GAMMA_API}/markets?limit=1000`);
    const data = await response.json();
    
    if (!Array.isArray(data)) {
      console.log('  Not an array response');
      return { success: false };
    }
    
    let totalMarkets = data.length;
    let closedMarkets = 0;
    let withPayouts = 0;
    let openMarkets = 0;
    
    for (const market of data) {
      if (market.closed === true) {
        closedMarkets++;
        if (market.payout_numerators?.length > 0) {
          withPayouts++;
        }
      } else {
        openMarkets++;
      }
    }
    
    console.log(`  Total markets: ${totalMarkets}`);
    console.log(`  Open: ${openMarkets} (${(openMarkets/totalMarkets*100).toFixed(1)}%)`);
    console.log(`  Closed: ${closedMarkets} (${(closedMarkets/totalMarkets*100).toFixed(1)}%)`);
    console.log(`  With payouts: ${withPayouts} (${(withPayouts/totalMarkets*100).toFixed(1)}%)`);
    
    return { success: true, totalMarkets, closedMarkets, withPayouts };
  } catch (error: any) {
    console.log(`  Error: ${error.message}`);
    return { success: false, error: error.message };
  }
}

async function main() {
  console.log('\n🔍 INVESTIGATING RESOLVED MARKETS SOURCES\n');
  console.log('═'.repeat(80));
  
  const results: any = {};
  
  results.gamma_closed = await testGammaResolvedEndpoint();
  await new Promise(r => setTimeout(r, 1000));
  
  results.gamma_inactive = await testGammaActiveFilter();
  await new Promise(r => setTimeout(r, 1000));
  
  results.clob = await testCLOBMarketsEndpoint();
  await new Promise(r => setTimeout(r, 1000));
  
  results.sampling = await testSamplingStrategy();
  
  console.log('\n═'.repeat(80));
  console.log('📊 RESULTS SUMMARY\n');
  
  if (results.gamma_closed?.success) {
    console.log('✅ GAMMA API with closed=true WORKS!');
    console.log(`   Endpoint: ${results.gamma_closed.endpoint}`);
    console.log(`   Sample size: ${results.gamma_closed.count} markets`);
    console.log('   Recommendation: Use this as primary source\n');
  }
  
  if (results.sampling?.success) {
    console.log(`📈 Market Resolution Stats (1000 sample):`);
    console.log(`   Closed markets: ${results.sampling.closedMarkets}`);
    console.log(`   With payouts: ${results.sampling.withPayouts}`);
    console.log(`   Resolution rate: ${(results.sampling.withPayouts/results.sampling.closedMarkets*100).toFixed(1)}%\n`);
  }
  
  console.log('🎯 RECOMMENDED APPROACH:\n');
  
  if (results.gamma_closed?.success && results.gamma_closed.count > 50) {
    console.log('1. Use Gamma API: /markets?closed=true');
    console.log('2. Paginate through ALL closed markets (not just our traded list)');
    console.log('3. Filter for markets with payout_numerators');
    console.log('4. Cross-reference with our traded condition IDs');
    console.log('5. Insert payouts for matches\n');
    
    console.log('Expected coverage improvement:');
    const estResolved = results.sampling ? results.sampling.withPayouts * 100 : 5000;
    console.log(`  If ~${estResolved} markets are resolved globally`);
    console.log(`  And we have 227K traded markets`);
    console.log(`  Potential match rate: ${(estResolved/227000*100).toFixed(1)}%\n`);
  } else {
    console.log('⚠️  No reliable endpoint found');
    console.log('   Will need to use on-chain events or manual curation\n');
  }
  
  console.log('═'.repeat(80) + '\n');
}

main();
