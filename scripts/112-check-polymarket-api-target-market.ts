#!/usr/bin/env tsx
/**
 * Task 2.3: Check Polymarket APIs for Target Market
 *
 * Cross-checks if the target market exists in Polymarket's official APIs
 * to determine if it's a CLOB market, AMM market, or uses different infrastructure.
 */

const TARGET_CID = '0xf2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1';

async function main() {
  console.log('Task 2.3: Cross-Check with Polymarket APIs');
  console.log('='.repeat(80));
  console.log('');
  console.log('Target: Xi Jinping out in 2025?');
  console.log(`Condition ID: ${TARGET_CID}`);
  console.log('');

  // Try Gamma API first (markets endpoint)
  console.log('1. Checking Gamma API /markets...');
  try {
    const url = `https://gamma-api.polymarket.com/markets?condition_id=${TARGET_CID}`;
    console.log(`   URL: ${url}`);

    const resp = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10000)
    });

    if (resp.ok) {
      const data = await resp.json();
      if (Array.isArray(data) && data.length > 0) {
        const market = data[0];
        console.log(`   ✅ Market found in Gamma API!`);
        console.log('');
        console.log('   Market details:');
        console.log(`   - Question: ${market.question}`);
        console.log(`   - Status: active=${market.active}, closed=${market.closed}`);
        console.log(`   - Market type: ${market.market_type || 'binary'}`);
        console.log(`   - Enable order book: ${market.enable_order_book}`);
        console.log(`   - End date: ${market.end_date_iso}`);
        console.log('');

        console.log('   CLOB token IDs:', market.clob_token_ids);
        console.log('');

        if (!market.enable_order_book) {
          console.log('   ⚠️  CRITICAL: enable_order_book = false');
          console.log('   This market does NOT use CLOB!');
          console.log('   Likely AMM-only or different execution mechanism');
        } else {
          console.log('   ✅ enable_order_book = true (CLOB market)');
          console.log('   Data SHOULD be in CLOB fills if backfilled correctly');
        }
      } else {
        console.log('   ❌ No market data returned (empty array)');
      }
    } else {
      console.log(`   ⚠️  HTTP ${resp.status}: ${resp.statusText}`);
    }
  } catch (e: any) {
    console.log(`   ❌ Error: ${e.message}`);
  }

  console.log('');

  // Try CLOB API /trades endpoint
  console.log('2. Checking CLOB API /trades...');
  try {
    const url = `https://clob.polymarket.com/trades?condition_id=${TARGET_CID}`;
    console.log(`   URL: ${url}`);

    const resp = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10000)
    });

    if (resp.ok) {
      const trades = await resp.json();
      const count = Array.isArray(trades) ? trades.length : 0;
      console.log(`   ✅ Response: ${count} trades`);

      if (count > 0) {
        console.log('   Market HAS CLOB trades');
        console.log('   Sample trade:', JSON.stringify(trades[0], null, 2).substring(0, 300));
      } else {
        console.log('   ⚠️  Zero trades in CLOB API');
      }
    } else if (resp.status === 401) {
      console.log('   ⚠️  401 Unauthorized (authentication required)');
    } else {
      console.log(`   ⚠️  HTTP ${resp.status}: ${resp.statusText}`);
    }
  } catch (e: any) {
    console.log(`   ❌ Error: ${e.message}`);
  }

  console.log('');
  console.log('='.repeat(80));
  console.log('CONCLUSION');
  console.log('='.repeat(80));
  console.log('Based on API responses, determine:');
  console.log('1. Does market exist in Gamma API?');
  console.log('2. Is enable_order_book true or false?');
  console.log('3. Does CLOB API have trades?');
  console.log('');
  console.log('If enable_order_book=false → AMM-only market');
  console.log('If enable_order_book=true but no CLOB trades → Ingestion gap');
  console.log('If market not in Gamma API → Different market ID encoding');
}

main().catch((error) => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});
