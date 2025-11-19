import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

const GAMMA = "https://gamma-api.polymarket.com";

// Use one of our 5 CTF IDs to query
const sampleCTF = "001dcf4c1446fcacb42af305419f7310e7c9c356b2366367c25eb7d6fb202b48";

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('FETCH BIDEN-COVID MARKET BY CONDITION ID');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('1. Fetching from Gamma API...\n');
  const url = `${GAMMA}/markets?conditionId=0x${sampleCTF}`;
  console.log(`   URL: ${url.substring(0, 100)}...`);

  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Gamma API failed: ${resp.status} ${resp.statusText}`);
  }

  const data: any = await resp.json();
  const market = Array.isArray(data) ? data[0] : data?.markets?.[0];

  if (!market) {
    throw new Error('No market returned from API');
  }

  console.log(`   ✅ Fetched market data\n`);

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('MARKET DETAILS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log(`Slug: ${market.slug || market.market_slug}`);
  console.log(`Question: ${market.question || market.title}`);
  console.log(`Condition ID: ${market.conditionId || market.condition_id}`);
  console.log(`Closed: ${market.closed}`);
  console.log(`Resolved: ${market.resolved}`);
  console.log(`Active: ${market.active}`);
  console.log(`End Date: ${market.endDate || market.end_date_iso || 'N/A'}\n`);

  // Show full JSON structure to understand what fields are available
  console.log('Full response (first 50 keys):');
  Object.keys(market).slice(0, 50).forEach(key => {
    const val = market[key];
    const preview = typeof val === 'object' ? `[${typeof val}]` : String(val).substring(0, 60);
    console.log(`   ${key}: ${preview}`);
  });
  console.log();

  // Try to find outcomes and tokens
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('OUTCOMES & TOKENS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const outcomes = market.outcomes || market.outcome_prices || [];
  const tokens = market.tokens || market.clobTokenIds || [];

  if (Array.isArray(outcomes) && outcomes.length > 0) {
    console.log(`Found ${outcomes.length} outcomes:\n`);
    outcomes.forEach((outcome: any, i: number) => {
      if (typeof outcome === 'string') {
        console.log(`   ${i}. ${outcome}`);
      } else {
        console.log(`   ${i}. ${JSON.stringify(outcome).substring(0, 80)}`);
      }
    });
    console.log();
  } else {
    console.log('⚠️  No outcomes array found\n');
  }

  if (Array.isArray(tokens) && tokens.length > 0) {
    console.log(`Found ${tokens.length} tokens:\n`);
    tokens.forEach((token: any, i: number) => {
      console.log(`   ${i}. ${token}`);
    });
    console.log();
  } else {
    console.log('⚠️  No tokens array found\n');
  }

  // Check for resolution data
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('RESOLUTION DATA');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const winningOutcome = market.outcome || market.winningOutcome || market.resolvedOutcome;
  const payoutNumerators = market.payoutNumerators || market.payout_numerators;
  const resolvedAt = market.resolvedAt || market.resolved_at || market.endDate;

  if (winningOutcome) {
    console.log(`   Winning outcome: ${winningOutcome}`);
  } else {
    console.log(`   ⚠️  No winning outcome found`);
  }

  if (payoutNumerators) {
    console.log(`   Payout numerators: [${payoutNumerators}]`);
  } else {
    console.log(`   ⚠️  No payout numerators found`);
  }

  if (resolvedAt) {
    console.log(`   Resolved at: ${resolvedAt}`);
  } else {
    console.log(`   ⚠️  No resolution timestamp found`);
  }
  console.log();

  // Save full market data
  const fs = require('fs');
  fs.writeFileSync('biden-market-raw-response.json', JSON.stringify(market, null, 2));
  console.log('✅ Saved full response to biden-market-raw-response.json\n');

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('ASSESSMENT');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const hasConditionId = !!(market.conditionId || market.condition_id);
  const hasSlug = !!(market.slug || market.market_slug);
  const hasOutcomes = outcomes.length > 0;
  const hasTokens = tokens.length > 0;
  const hasResolution = !!winningOutcome;

  console.log(`   Has condition ID: ${hasConditionId ? 'Yes ✅' : 'No ❌'}`);
  console.log(`   Has slug: ${hasSlug ? 'Yes ✅' : 'No ❌'}`);
  console.log(`   Has outcomes: ${hasOutcomes ? 'Yes ✅' : 'No ❌'}`);
  console.log(`   Has tokens: ${hasTokens ? 'Yes ✅' : 'No ❌'}`);
  console.log(`   Has resolution: ${hasResolution ? 'Yes ✅' : 'No ❌'}\n`);

  if (hasConditionId && hasSlug && hasResolution) {
    console.log('✅ Market has all required data for insertion\n');
    console.log('Next step: npx tsx insert-biden-market.ts\n');
  } else {
    console.log('⚠️  Market missing some data - review biden-market-raw-response.json\n');
  }

  console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
