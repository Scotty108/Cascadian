#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

// Test fetching a single market by condition_id
async function testSingleFetch() {
  const testId = '0000a3aa2ac9a909841538e97750d8cf5ef95fdf46b74a3d670e50771c58bbed';

  console.log('Testing single market fetch...');
  console.log(`ID: ${testId}\n`);

  const url = `https://gamma-api.polymarket.com/markets?condition_id=${testId}`;
  console.log(`URL: ${url}\n`);

  try {
    const response = await fetch(url);
    console.log(`Status: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      const text = await response.text();
      console.log(`Error body: ${text}`);
      return;
    }

    const data = await response.json();
    console.log('\n✅ SUCCESS!\n');
    console.log('Response structure:');
    console.log(JSON.stringify(data, null, 2).substring(0, 1000));
    console.log('\n...(truncated)');

  } catch (error: any) {
    console.error(`Error: ${error.message}`);
  }
}

testSingleFetch();
