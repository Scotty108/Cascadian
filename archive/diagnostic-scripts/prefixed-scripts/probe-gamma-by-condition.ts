import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

const GAMMA = "https://gamma-api.polymarket.com";
const CTFs = [
  "001dcf4c1446fcacb42af305419f7310e7c9c356b2366367c25eb7d6fb202b48",
  "00f92278bd8759aa69d9d1286f359f02f3f3615088907c8b5ac83438bda452af",
  "00abdc242048b65fa2e976bb31bf0018931768118cd3c05e87c26d1daace4beb",
  "00a972afa513fbe4fd5aa7e2dbda3149446ee40b3127f7a144cec584ae195d22",
  "001e511c90e45a81eb1783832455ebafd10785810d27daf195a2e26bdb99516e",
];

interface ProbeResult {
  id: string;
  slug: string | null;
  conditionId?: string;
  title?: string;
  resolved?: boolean;
  winning_outcome?: string;
}

async function probeOne(id: string): Promise<ProbeResult> {
  // Try both with and without 0x prefix
  const queries = [
    `${GAMMA}/markets?conditionId=0x${id}`,
    `${GAMMA}/markets?conditionId=${id}`
  ];

  for (const url of queries) {
    try {
      console.log(`   Trying: ${url.substring(0, 80)}...`);
      const r = await fetch(url);

      if (!r.ok) {
        console.log(`   Response ${r.status}: ${r.statusText}`);
        continue;
      }

      const data: any = await r.json();

      // Handle different response formats
      const market = Array.isArray(data) ? data[0] : data?.markets?.[0];

      if (market?.slug) {
        console.log(`   ✅ FOUND: ${market.slug}`);
        return {
          id,
          slug: market.slug,
          conditionId: market.conditionId,
          title: market.question || market.title,
          resolved: market.closed || market.resolved,
          winning_outcome: market.winningOutcome,
        };
      }

      console.log(`   Response has no market with slug`);
    } catch (error: any) {
      console.log(`   Error: ${error.message}`);
    }
  }

  return { id, slug: null };
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('GAMMA API DIRECT PROBE BY CONDITION ID');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('Probing Gamma API for 5 CTF condition IDs...\n');

  const results: ProbeResult[] = [];

  for (let i = 0; i < CTFs.length; i++) {
    const id = CTFs[i];
    console.log(`${i + 1}/5: ${id.substring(0, 20)}...`);
    const result = await probeOne(id);
    results.push(result);
    console.log();
  }

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('PROBE RESULTS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.table(results.map(r => ({
    CTF: r.id.substring(0, 20) + '...',
    Slug: r.slug || 'NULL',
    Title: r.title?.substring(0, 40) || 'N/A',
    Resolved: r.resolved ? 'Yes' : 'No',
    Winning: r.winning_outcome || 'N/A',
  })));

  const foundCount = results.filter(r => r.slug).length;

  console.log(`\nFound: ${foundCount} / 5 slugs\n`);

  if (foundCount > 0) {
    console.log('✅ SUCCESS! Found slugs through Gamma API\n');
    console.log('Next steps:');
    console.log('   1. Insert into bridge: cascadian_clean.bridge_ctf_condition');
    console.log('   2. Check if resolved, insert into market_resolutions_by_market');
    console.log('   3. Rebuild Phase 3 (PPS)');
    console.log('   4. Rebuild Phase 4 (burns valuation)');
    console.log('   5. Validate new P&L\n');

    // Save results
    const fs = require('fs');
    fs.writeFileSync(
      'gamma-probe-results.json',
      JSON.stringify(results.filter(r => r.slug), null, 2)
    );
    console.log('   Saved to gamma-probe-results.json\n');
  } else {
    console.log('❌ No slugs found through Gamma API\n');
    console.log('Next step: Try burn timestamp proximity search\n');
    console.log('   Run: npx tsx probe-markets-by-burn-time.ts\n');
  }

  console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
