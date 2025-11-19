import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

const GAMMA_API = 'https://gamma-api.polymarket.com';

async function main() {
  const slug = 'will-amazon-purchase-bitcoin-by-june';
  const url = `${GAMMA_API}/markets?slug=${slug}`;

  console.log(`Fetching: ${url}\n`);

  const response = await fetch(url);
  const data = await response.json();

  console.log('Full API Response:\n');
  console.log(JSON.stringify(data, null, 2));
}

main().catch(console.error);
