#!/usr/bin/env npx tsx
/**
 * Diagnose Unresolved Markets - Are they truly unresolved or is it a data issue?
 */

import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
});

async function main() {
  console.log('\n🔍 DIAGNOSING UNRESOLVED MARKETS\n');

  // Get top unresolved market with most wallets
  const topMarket = await ch.query({
    query: `
      SELECT
        t.cid_hex as condition_id,
        COUNT(DISTINCT t.wallet_address) as wallet_count,
        COUNT(*) as trade_count,
        MIN(t.block_time) as first_trade,
        MAX(t.block_time) as last_trade,
        dateDiff('day', first_trade, now()) as days_old
      FROM cascadian_clean.fact_trades_clean t
      LEFT JOIN default.market_resolutions_final r
        ON lower(replaceAll(t.cid_hex, '0x', '')) = lower(r.condition_id_norm)
      WHERE r.payout_denominator = 0 OR r.condition_id_norm IS NULL
      GROUP BY t.cid_hex
      ORDER BY wallet_count DESC
      LIMIT 1
    `,
    format: 'JSONEachRow'
  });

  const market = (await topMarket.json<any>())[0];
  const conditionId = market.condition_id.toLowerCase().replace(/^0x/, '');

  console.log('📊 Top Unresolved Market:');
  console.log(`   Condition ID: ${conditionId}`);
  console.log(`   Wallets: ${market.wallet_count}`);
  console.log(`   Trades: ${market.trade_count}`);
  console.log(`   Age: ${market.days_old} days`);
  console.log(`   First trade: ${market.first_trade}`);
  console.log(`   Last trade: ${market.last_trade}\n`);

  // Check if it's in api_markets_staging
  console.log('1️⃣ Checking api_markets_staging...');
  const marketInfo = await ch.query({
    query: `
      SELECT
        condition_id,
        question,
        market_slug,
        active,
        closed,
        resolved
      FROM default.api_markets_staging
      WHERE condition_id = '${conditionId}'
      LIMIT 1
    `,
    format: 'JSONEachRow'
  });

  const marketData = await marketInfo.json<any>();
  if (marketData.length > 0) {
    console.log(`   ✅ Found in api_markets_staging`);
    console.log(`   Question: ${marketData[0].question}`);
    console.log(`   Slug: ${marketData[0].market_slug}`);
    console.log(`   Active: ${marketData[0].active}`);
    console.log(`   Closed: ${marketData[0].closed}`);
    console.log(`   Resolved: ${marketData[0].resolved}\n`);
  } else {
    console.log(`   ❌ NOT in api_markets_staging\n`);
  }

  // Check Gamma API directly
  console.log('2️⃣ Checking Gamma API...');
  try {
    const gammaResponse = await fetch(
      `https://gamma-api.polymarket.com/markets?condition_id=0x${conditionId}`
    );
    const gammaData = await gammaResponse.json();

    if (Array.isArray(gammaData) && gammaData.length > 0) {
      const m = gammaData[0];
      console.log(`   ✅ Found in Gamma API`);
      console.log(`   Question: ${m.question}`);
      console.log(`   Slug: ${m.slug}`);
      console.log(`   Active: ${m.active}`);
      console.log(`   Closed: ${m.closed}`);
      console.log(`   End date: ${m.endDate}\n`);
    } else {
      console.log(`   ❌ NOT found in Gamma API\n`);
    }
  } catch (error) {
    console.log(`   ⚠️  Error querying Gamma API\n`);
  }

  // Check PNL Subgraph
  console.log('3️⃣ Checking PNL Subgraph (Goldsky)...');
  try {
    const query = `
      query {
        condition(id: "${conditionId}") {
          id
          payoutNumerators
          payoutDenominator
          positionIds
        }
      }
    `;

    const response = await fetch(
      'https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/pnl-subgraph/0.0.14/gn',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query })
      }
    );

    const data = await response.json();

    if (data.data?.condition) {
      console.log(`   ✅ Found in PNL Subgraph`);
      console.log(`   Payout Numerators: ${JSON.stringify(data.data.condition.payoutNumerators)}`);
      console.log(`   Payout Denominator: ${data.data.condition.payoutDenominator}`);
      console.log(`   Position IDs: ${data.data.condition.positionIds?.length || 0} positions\n`);

      if (data.data.condition.payoutDenominator > 0) {
        console.log(`   🎉 HAS RESOLUTION DATA! This market is resolved!`);
        console.log(`   📊 Winning outcome: ${data.data.condition.payoutNumerators.indexOf(1) !== -1 ? data.data.condition.payoutNumerators.indexOf(1) : 'unclear'}\n`);
      }
    } else {
      console.log(`   ❌ NOT found in PNL Subgraph`);
      console.log(`   Response: ${JSON.stringify(data)}\n`);
    }
  } catch (error) {
    console.log(`   ⚠️  Error querying PNL Subgraph: ${error}\n`);
  }

  // Check if already in market_resolutions_final
  console.log('4️⃣ Checking market_resolutions_final...');
  const resCheck = await ch.query({
    query: `
      SELECT
        condition_id_norm,
        payout_numerators,
        payout_denominator,
        winning_index,
        source
      FROM default.market_resolutions_final
      WHERE lower(condition_id_norm) = '${conditionId}'
      LIMIT 1
    `,
    format: 'JSONEachRow'
  });

  const resData = await resCheck.json<any>();
  if (resData.length > 0) {
    console.log(`   ✅ Found in market_resolutions_final`);
    console.log(`   Payout Numerators: ${JSON.stringify(resData[0].payout_numerators)}`);
    console.log(`   Payout Denominator: ${resData[0].payout_denominator}`);
    console.log(`   Winning Index: ${resData[0].winning_index}`);
    console.log(`   Source: ${resData[0].source}\n`);
  } else {
    console.log(`   ❌ NOT in market_resolutions_final\n`);
  }

  // Summary
  console.log('═'.repeat(80));
  console.log('📊 DIAGNOSIS SUMMARY\n');

  console.log(`Market ${conditionId.substring(0, 16)}...`);
  console.log(`- ${market.wallet_count.toLocaleString()} wallets trading`);
  console.log(`- ${market.days_old} days old`);
  console.log(`- Status: Need to check sources above\n`);

  console.log('Next Steps:');
  console.log('1. If PNL Subgraph has payout data → Backfill from there');
  console.log('2. If Gamma shows closed=true → Market closed, check why no payout');
  console.log('3. If neither has data → Market genuinely unresolved (rare for old markets)');
  console.log('═'.repeat(80) + '\n');

  await ch.close();
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('❌ Error:', err);
    process.exit(1);
  });
