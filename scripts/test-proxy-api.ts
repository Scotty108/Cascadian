#!/usr/bin/env npx tsx

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

const WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function testAPIs() {
  console.log('Testing Proxy Resolution APIs for wallet:', WALLET);
  console.log('='.repeat(80), '\n');

  // Test 1: Strapi API
  console.log('1. Testing Strapi API:');
  console.log(`   URL: https://strapi-matic.poly.market/user/trades?user=${WALLET}&limit=1`);
  try {
    const r1 = await fetch(`https://strapi-matic.poly.market/user/trades?user=${WALLET}&limit=1`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    console.log(`   Status: ${r1.status} ${r1.statusText}`);
    if (r1.ok) {
      const json = await r1.json();
      console.log('   Response:', JSON.stringify(json, null, 2));
    } else {
      const text = await r1.text();
      console.log('   Error:', text.slice(0, 200));
    }
  } catch (e: any) {
    console.log('   Error:', e.message);
  }
  console.log('');

  // Test 2: Data API
  console.log('2. Testing Data API:');
  console.log(`   URL: https://data-api.polymarket.com/positions?user=${WALLET}`);
  try {
    const r2 = await fetch(`https://data-api.polymarket.com/positions?user=${WALLET}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    console.log(`   Status: ${r2.status} ${r2.statusText}`);
    if (r2.ok) {
      const json = await r2.json();
      console.log('   Response (first position):', JSON.stringify(json?.[0] || json, null, 2));

      // Look for proxy wallet field
      if (Array.isArray(json) && json.length > 0) {
        const fields = Object.keys(json[0]);
        const proxyFields = fields.filter(f => f.toLowerCase().includes('proxy') || f.toLowerCase().includes('wallet'));
        console.log('   Proxy-related fields:', proxyFields);
      }
    } else {
      const text = await r2.text();
      console.log('   Error:', text.slice(0, 200));
    }
  } catch (e: any) {
    console.log('   Error:', e.message);
  }
  console.log('');

  // Test 3: CLOB API
  console.log('3. Testing CLOB API (with proxy):');
  console.log(`   URL: https://clob.polymarket.com/trades?maker=${WALLET}&limit=1`);
  try {
    const r3 = await fetch(`https://clob.polymarket.com/trades?maker=${WALLET}&limit=1`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    console.log(`   Status: ${r3.status} ${r3.statusText}`);
    if (r3.ok) {
      const json = await r3.json();
      console.log('   Response:', JSON.stringify(json, null, 2));
    } else {
      const text = await r3.text();
      console.log('   Error:', text.slice(0, 200));
    }
  } catch (e: any) {
    console.log('   Error:', e.message);
  }
}

testAPIs().catch(console.error);
