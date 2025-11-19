#!/usr/bin/env npx tsx

// Test different API endpoint formats
async function testEndpoint(url: string, description: string) {
  console.log(`\nTesting: ${description}`);
  console.log(`URL: ${url}`);
  
  try {
    const response = await fetch(url);
    console.log(`Status: ${response.status} ${response.statusText}`);
    
    if (response.ok) {
      const data = await response.json();
      console.log(`✅ SUCCESS!`);
      console.log(`Response sample:`, JSON.stringify(data).substring(0, 300));
      return true;
    }
  } catch (error: any) {
    console.log(`❌ Error: ${error.message}`);
  }
  return false;
}

async function main() {
  // Use a known condition_id from gamma_markets
  const testId = '0000a3aa2ac9a909841538e97750d8cf5ef95fdf46b74a3d670e50771c58bbed';
  const testIdWith0x = '0x' + testId;

  console.log('Testing Polymarket API endpoints...');
  console.log('═'.repeat(80));

  // Try different formats
  await testEndpoint(`https://gamma-api.polymarket.com/markets?id=${testId}`, 'Gamma API with id param (no 0x)');
  await testEndpoint(`https://gamma-api.polymarket.com/markets?condition_id=${testId}`, 'Gamma API with condition_id param (no 0x)');
  await testEndpoint(`https://gamma-api.polymarket.com/markets?condition_id=${testIdWith0x}`, 'Gamma API with condition_id param (with 0x)');
  await testEndpoint(`https://gamma-api.polymarket.com/markets/${testId}`, 'Gamma API path param (no 0x)');
  await testEndpoint(`https://clob.polymarket.com/markets/${testId}`, 'CLOB API path param');
}

main();
