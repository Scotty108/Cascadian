import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';
import { readFileSync, writeFileSync } from 'fs';

const GAMMA_API = 'https://gamma-api.polymarket.com';

const MARKET_SLUGS = [
  'fed-rate-hike-in-2024',
  'will-ethereum-hit-6000pt00-by-march-31'
];

interface MarketData {
  slug: string;
  question: string;
  conditionId: string;
  outcomePrices: string[];
  outcomes: string[];
  closed: boolean;
  umaResolutionStatus: string;
  endDateIso: string;
  clobTokenIds: string[];
  decodedCtfIds: {
    ctf_hex64: string;
    mask: number;
    is_target: boolean;
  }[];
}

async function fetchMarket(slug: string): Promise<any> {
  const url = `${GAMMA_API}/markets?slug=${slug}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const data = await response.json();
  return Array.isArray(data) && data.length > 0 ? data[0] : null;
}

function decodeTokenId(tokenId: string): { ctf_hex64: string; mask: number } {
  const tokenIdBigInt = BigInt(tokenId);
  const ctfId = tokenIdBigInt >> 8n;
  const mask = Number(tokenIdBigInt & 0xFFn);
  const ctf_hex64 = ctfId.toString(16).padStart(64, '0').toLowerCase();

  return { ctf_hex64, mask };
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('PHASE 7.7: FETCH FINAL 2 MARKETS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Load target CTF IDs
  const csv = readFileSync('tmp/phase7_missing_ctf64.csv', 'utf8');
  const targetCtfs = csv.split('\n')
    .slice(1)
    .filter(l => l.trim())
    .map(l => {
      const [ctf, shares] = l.split(',');
      return { ctf: ctf.toLowerCase(), shares: parseFloat(shares) };
    });

  console.log(`Target CTF IDs: ${targetCtfs.length}\n`);
  targetCtfs.forEach(t => {
    console.log(`   ${t.ctf.substring(0, 20)}... (${t.shares.toLocaleString()} shares)`);
  });
  console.log();

  const results: MarketData[] = [];

  for (const slug of MARKET_SLUGS) {
    console.log(`\n[${slug}]`);

    try {
      const market = await fetchMarket(slug);

      if (!market) {
        console.log('   ❌ Not found\n');
        continue;
      }

      console.log(`   ✅ ${market.question}`);
      console.log(`   Market conditionId: ${market.conditionId?.substring(0, 20)}...`);
      console.log(`   Closed: ${market.closed}`);
      console.log(`   Resolution: ${market.umaResolutionStatus}`);

      if (!market.closed || market.umaResolutionStatus !== 'resolved') {
        console.log('   ⚠️  Not resolved\n');
        continue;
      }

      // Parse clobTokenIds
      const clobTokenIds = JSON.parse(market.clobTokenIds || '[]');
      console.log(`   CLOB Token IDs: ${clobTokenIds.length}`);

      // Decode each token ID
      const decodedCtfIds = clobTokenIds.map((tokenId: string) => {
        const decoded = decodeTokenId(tokenId);
        const target = targetCtfs.find(t => t.ctf === decoded.ctf_hex64);
        const is_target = !!target;
        return { ...decoded, is_target, target_shares: target?.shares };
      });

      console.log();
      decodedCtfIds.forEach((ctf, i) => {
        console.log(`   Token ${i + 1}:`);
        console.log(`      CTF: ${ctf.ctf_hex64.substring(0, 20)}...`);
        console.log(`      Mask: ${ctf.mask}`);
        console.log(`      Target: ${ctf.is_target ? '✅ YES' : '❌ NO'}`);
        if (ctf.is_target) {
          console.log(`      Expected shares: ${ctf.target_shares?.toLocaleString()}`);
        }
      });

      const matchCount = decodedCtfIds.filter(c => c.is_target).length;
      console.log(`\n   ✅ Found ${matchCount} target CTF(s)\n`);

      // Parse outcome prices
      const outcomePrices = JSON.parse(market.outcomePrices || '[]');
      const outcomes = JSON.parse(market.outcomes || '[]');

      console.log(`   Outcomes: ${outcomes.join(', ')}`);
      console.log(`   Outcome Prices: ${outcomePrices.join(', ')}`);

      results.push({
        slug,
        question: market.question,
        conditionId: market.conditionId,
        outcomePrices,
        outcomes,
        closed: market.closed,
        umaResolutionStatus: market.umaResolutionStatus,
        endDateIso: market.endDateIso,
        clobTokenIds,
        decodedCtfIds
      });

      // Rate limit
      await new Promise(res => setTimeout(res, 1000));

    } catch (error) {
      console.log(`   ❌ Error: ${error.message}\n`);
    }
  }

  // Save results
  const existingMapping = JSON.parse(readFileSync('tmp/phase7-complete-mapping.json', 'utf8'));
  const combinedMapping = [...existingMapping, ...results];
  writeFileSync('tmp/phase7-complete-mapping.json', JSON.stringify(combinedMapping, null, 2));

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('MAPPING SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log(`   Markets fetched: ${results.length}`);

  let totalTargetCtfs = 0;
  results.forEach(r => {
    const targetCount = r.decodedCtfIds.filter(c => c.is_target).length;
    totalTargetCtfs += targetCount;

    console.log(`\n   ${r.question}`);
    console.log(`   Market ID: ${r.conditionId?.substring(0, 20)}...`);
    console.log(`   Target CTFs: ${targetCount}`);

    r.decodedCtfIds.filter(c => c.is_target).forEach(ctf => {
      console.log(`      → ${ctf.ctf_hex64.substring(0, 20)}... (mask: ${ctf.mask}, shares: ${ctf.target_shares?.toLocaleString()})`);
    });
  });

  console.log(`\n   Total NEW target CTFs found: ${totalTargetCtfs}\n`);

  if (totalTargetCtfs > 0) {
    console.log('   Next: Insert these resolutions\n');
    console.log('   Run: npx tsx phase7-step6-insert-resolutions.ts\n');
  }

  console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
