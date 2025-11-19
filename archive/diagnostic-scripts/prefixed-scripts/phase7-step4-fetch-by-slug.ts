import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';
import { readFileSync, writeFileSync } from 'fs';

const GAMMA_API = 'https://gamma-api.polymarket.com';

interface MarketSlug {
  slug: string;
  expected_ctf?: string;
  expected_shares?: number;
}

const MARKET_SLUGS: MarketSlug[] = [
  {
    slug: 'will-a-dozen-eggs-be-below-4pt50-in-may',
    expected_shares: 53683.1
  },
  {
    slug: 'will-amazon-purchase-bitcoin-by-june',
    expected_ctf: '00d83a0c96a8f37f914ea3e2dbda3149446ee40b3127f7a144cec584ae195d22',
    expected_shares: 5880.1
  },
  {
    slug: 'china-x-philippines-military-clash-by-june-30',
    expected_ctf: '00b2b715c86a72755bbdf9d133e02ab84f4c6ab270b5abead764d08f92bbb7ad',
    expected_shares: 2665.5
  },
  {
    slug: 'us-forces-in-gaza-before-july',
    expected_ctf: '00382a9807918745dccfaacd1d744207bc59ee7834d2f262079ba4f63230c5fe',
    expected_shares: 120.2
  }
];

async function fetchMarketBySlug(slug: string): Promise<any> {
  const url = `${GAMMA_API}/markets?slug=${slug}`;
  console.log(`   Fetching: ${url}`);

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const data = await response.json();

  if (Array.isArray(data) && data.length > 0) {
    return data[0];
  }

  return null;
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('PHASE 7.4: FETCH RESOLUTIONS BY MARKET SLUG');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const results: any[] = [];

  for (const market of MARKET_SLUGS) {
    console.log(`\n[${market.slug}]`);
    console.log(`Expected CTF: ${market.expected_ctf || 'unknown'}`);
    console.log(`Expected shares: ${market.expected_shares?.toLocaleString()}\n`);

    try {
      const data = await fetchMarketBySlug(market.slug);

      if (!data) {
        console.log('   ❌ Market not found\n');
        continue;
      }

      console.log(`   ✅ Found market: ${data.question}`);
      console.log(`   Condition ID: ${data.condition_id}`);
      console.log(`   Closed: ${data.closed}`);
      console.log(`   Resolved: ${data.resolved}`);

      if (data.closed && data.resolved) {
        console.log(`   Outcome prices: [${data.outcome_prices?.join(', ')}]`);
        console.log(`   End date: ${data.end_date_iso}`);

        // Normalize condition_id to 64-char hex
        const conditionId = data.condition_id.toLowerCase().replace('0x', '');
        const conditionId64 = conditionId.padStart(64, '0');

        console.log(`   Normalized CTF (64-char): ${conditionId64.substring(0, 20)}...`);

        // Check if this matches our target CTF
        const targetCsv = readFileSync('tmp/phase7_missing_ctf64.csv', 'utf8');
        const targetLines = targetCsv.split('\n').slice(1).filter(l => l.trim());
        const targetCtfs = targetLines.map(l => l.split(',')[0].toLowerCase());

        const isTarget = targetCtfs.includes(conditionId64);
        console.log(`   Is target CTF: ${isTarget ? '✅ YES' : '❌ NO'}`);

        results.push({
          slug: market.slug,
          question: data.question,
          condition_id_raw: data.condition_id,
          condition_id_64: conditionId64,
          is_target: isTarget,
          closed: data.closed,
          resolved: data.resolved,
          outcome_prices: data.outcome_prices || [],
          end_date_iso: data.end_date_iso,
          tokens: data.tokens || []
        });
      } else {
        console.log('   ⚠️  Market not resolved');
      }

      console.log();

      // Rate limit
      await new Promise(res => setTimeout(res, 1000));

    } catch (error) {
      console.log(`   ❌ Error: ${error.message}\n`);
    }
  }

  // Save results
  writeFileSync('tmp/phase7-slug-results.json', JSON.stringify(results, null, 2));

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log(`   Total slugs queried: ${MARKET_SLUGS.length}`);
  console.log(`   Markets found: ${results.length}`);
  console.log(`   Target CTFs matched: ${results.filter(r => r.is_target).length}\n`);

  if (results.length > 0) {
    console.log('   Results saved to: tmp/phase7-slug-results.json\n');

    console.log('   Market → CTF mappings:\n');
    results.forEach(r => {
      console.log(`   ${r.slug}`);
      console.log(`   → ${r.condition_id_64.substring(0, 20)}... ${r.is_target ? '✅' : '❌'}`);
      console.log();
    });

    console.log('   Next: Insert resolution data into market_resolutions_final\n');
  }

  console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
