import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

const ENDPOINTS = [
  'https://api.goldsky.com/api/public/project_clz7i86vs0xpi01we6h8qdss6/subgraphs/polymarket-ctf/1.0.0/gn',
  'https://api.goldsky.com/api/public/project_clz7i86vs0xpi01we6h8qdss6/subgraphs/polymarket-ctf/gn',
  'https://api.goldsky.com/api/public/project_clhf0dxq101rs01x6ae0s3l6u/subgraphs/polymarket/1.0.0/gn'
];

async function testEndpoint(url: string) {
  console.log(`\nTesting: ${url}\n`);

  // Try a simple introspection query
  const query = `
    query {
      _meta {
        block {
          number
          hash
        }
      }
    }
  `;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query })
    });

    console.log(`Status: ${response.status} ${response.statusText}`);

    if (response.ok) {
      const data = await response.json();
      console.log('Response:', JSON.stringify(data, null, 2));
      return true;
    } else {
      const text = await response.text();
      console.log('Error:', text);
      return false;
    }
  } catch (error) {
    console.log('Error:', error.message);
    return false;
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('GOLDSKY ENDPOINT TEST');
  console.log('═══════════════════════════════════════════════════════════════');

  for (const endpoint of ENDPOINTS) {
    const works = await testEndpoint(endpoint);
    if (works) {
      console.log('\n✅ This endpoint works!\n');
      break;
    }
  }
}

main().catch(console.error);
