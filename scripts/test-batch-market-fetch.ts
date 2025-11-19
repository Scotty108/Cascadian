#!/usr/bin/env npx tsx
/**
 * Test Polymarket API Batch Capabilities
 *
 * Tests if Gamma API supports fetching multiple markets in one request
 */

const POLYMARKET_API = 'https://gamma-api.polymarket.com';

// Sample condition IDs from our missing list
const SAMPLE_IDS = [
  '0xc007c362e141a1e8bd631cc7f6fe3e69a011605ab7a4e6c1fa7b0ac50f81a1ab',
  '0x80bd4a839c8ce62dbaa6d9414e59f2196f2c1ccffc0cb11848831e50c1b1f3e6',
  '0xf8b8c1e8c8a8e8c8a8e8c8a8e8c8a8e8c8a8e8c8a8e8c8a8e8c8a8e8c8a8e8c8'
];

async function testSingleFetch() {
  console.log('\n1️⃣ Testing single fetch...\n');
  
  const start = Date.now();
  const response = await fetch(
    `${POLYMARKET_API}/markets?condition_id=${SAMPLE_IDS[0]}`
  );
  const elapsed = Date.now() - start;
  
  const data = await response.json();
  
  console.log(`  Status: ${response.status}`);
  console.log(`  Time: ${elapsed}ms`);
  console.log(`  Results: ${Array.isArray(data) ? data.length : 'not array'}`);
  console.log(`  Sample:`, data[0] ? Object.keys(data[0]).slice(0, 10) : 'none');
  
  return { elapsed, count: Array.isArray(data) ? data.length : 0 };
}

async function testBatchFetch() {
  console.log('\n2️⃣ Testing batch fetch (comma-separated)...\n');
  
  const start = Date.now();
  const response = await fetch(
    `${POLYMARKET_API}/markets?condition_id=${SAMPLE_IDS.join(',')}`
  );
  const elapsed = Date.now() - start;
  
  const data = await response.json();
  
  console.log(`  Status: ${response.status}`);
  console.log(`  Time: ${elapsed}ms`);
  console.log(`  Results: ${Array.isArray(data) ? data.length : 'not array'}`);
  
  return { elapsed, count: Array.isArray(data) ? data.length : 0 };
}

async function testArrayParam() {
  console.log('\n3️⃣ Testing array parameter...\n');
  
  const params = new URLSearchParams();
  SAMPLE_IDS.forEach(id => params.append('condition_id', id));
  
  const start = Date.now();
  const response = await fetch(`${POLYMARKET_API}/markets?${params}`);
  const elapsed = Date.now() - start;
  
  const data = await response.json();
  
  console.log(`  Status: ${response.status}`);
  console.log(`  Time: ${elapsed}ms`);
  console.log(`  Results: ${Array.isArray(data) ? data.length : 'not array'}`);
  
  return { elapsed, count: Array.isArray(data) ? data.length : 0 };
}

async function testRateLimit() {
  console.log('\n4️⃣ Testing rate limits (10 rapid requests)...\n');
  
  const start = Date.now();
  const promises = SAMPLE_IDS.slice(0, 10).map(id =>
    fetch(`${POLYMARKET_API}/markets?condition_id=${id}`)
  );
  
  const responses = await Promise.all(promises);
  const elapsed = Date.now() - start;
  
  const statuses = responses.map(r => r.status);
  const rate = 10 / (elapsed / 1000);
  
  console.log(`  Statuses: ${statuses.join(', ')}`);
  console.log(`  Time: ${elapsed}ms`);
  console.log(`  Rate: ${rate.toFixed(1)} req/sec`);
  console.log(`  Throttled: ${statuses.some(s => s === 429) ? 'YES' : 'NO'}`);
  
  return { elapsed, rate, throttled: statuses.some(s => s === 429) };
}

async function main() {
  console.log('\n🧪 POLYMARKET API BATCH TESTING\n');
  console.log('═'.repeat(80));
  
  try {
    const single = await testSingleFetch();
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const batch = await testBatchFetch();
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const array = await testArrayParam();
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const rate = await testRateLimit();
    
    console.log('\n═'.repeat(80));
    console.log('📊 RESULTS\n');
    
    if (batch.count > 1) {
      console.log('✅ BATCH FETCH WORKS!');
      console.log(`   Method: Comma-separated condition_ids`);
      console.log(`   Speedup: ${(single.elapsed * 3 / batch.elapsed).toFixed(1)}x`);
      console.log(`   Recommendation: Use batches of 10-50 markets\n`);
    } else if (array.count > 1) {
      console.log('✅ BATCH FETCH WORKS!');
      console.log(`   Method: Array parameter (condition_id repeated)`);
      console.log(`   Speedup: ${(single.elapsed * 3 / array.elapsed).toFixed(1)}x\n`);
    } else {
      console.log('❌ Batch fetch not supported');
      console.log('   Use parallel workers instead\n');
    }
    
    console.log(`Rate limit: ${rate.throttled ? 'STRICT (429 errors)' : 'LENIENT (no throttling)'}`);
    console.log(`Max safe rate: ~${rate.rate.toFixed(0)} req/sec\n`);
    
    console.log('═'.repeat(80) + '\n');
    
  } catch (error) {
    console.error('Error:', error);
  }
}

main();
