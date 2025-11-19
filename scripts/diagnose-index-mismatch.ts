#!/usr/bin/env npx tsx
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: "default",
  password: "8miOkWI~OhsDb",
  database: "default",
  request_timeout: 60000,
});

async function queryData(query: string) {
  try {
    const result = await ch.query({ query, format: 'JSONCompact' });
    const text = await result.text();
    const data = JSON.parse(text).data;
    return data || [];
  } catch (e: any) {
    console.error(`Query error: ${e.message}`);
    return [];
  }
}

async function main() {
  console.log("\n════════════════════════════════════════════════════════════════");
  console.log("DIAGNOSING OUTCOME INDEX MISMATCH");
  console.log("════════════════════════════════════════════════════════════════\n");
  
  // Find one specific market where niggemon traded
  console.log("1️⃣ FIND A SAMPLE MARKET:\n");
  const sampleMarket = await queryData(`
    SELECT 
      market_id,
      count() as trade_count,
      sum(if(lowerUTF8(toString(side)) = 'buy', cast(shares as Float64), -cast(shares as Float64))) as net_position
    FROM trades_raw
    WHERE lower(wallet_address) = '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0'
    GROUP BY market_id
    ORDER BY trade_count DESC
    LIMIT 1
  `);
  
  if (sampleMarket.length > 0) {
    const marketId = sampleMarket[0][0];
    const tradeCount = sampleMarket[0][1];
    const netPos = parseFloat(sampleMarket[0][2]);
    console.log(`   Market: ${marketId}`);
    console.log(`   Trades: ${tradeCount}`);
    console.log(`   Net position: ${netPos} shares\n`);
    
    // Get the condition ID for this market
    console.log("2️⃣ GET CONDITION ID MAPPING:\n");
    const mapping = await queryData(`
      SELECT 
        market_id,
        condition_id,
        condition_id_norm
      FROM condition_market_map
      WHERE market_id = '${marketId}'
      LIMIT 1
    `);
    
    if (mapping.length > 0) {
      const condId = mapping[0][1];
      const condIdNorm = mapping[0][2];
      console.log(`   Raw condition_id: ${condId}`);
      console.log(`   Normalized: ${condIdNorm}\n`);
      
      // Check what outcomes are in market_outcomes for this condition
      console.log("3️⃣ GET OUTCOME DEFINITIONS:\n");
      const outcomes = await queryData(`
        SELECT 
          condition_id_norm,
          outcomes,
          array_length(outcomes) as outcome_count
        FROM market_outcomes
        WHERE condition_id_norm = lower('${condIdNorm}')
        LIMIT 1
      `);
      
      if (outcomes.length > 0) {
        const outcomesArray = outcomes[0][1];
        const count = outcomes[0][2];
        console.log(`   Outcomes (${count}): ${JSON.stringify(outcomesArray)}`);
      } else {
        console.log(`   ⚠️  No market_outcomes entry for this condition`);
      }
      
      // Check winning_index
      console.log("\n4️⃣ CHECK WINNING INDEX:\n");
      const winning = await queryData(`
        SELECT 
          condition_id_norm,
          win_idx,
          resolved_at
        FROM winning_index
        WHERE condition_id_norm = lower('${condIdNorm}')
      `);
      
      if (winning.length > 0) {
        console.log(`   Condition: ${winning[0][0]}`);
        console.log(`   Winning index: ${winning[0][1]}`);
        console.log(`   Resolved at: ${winning[0][2]}`);
      } else {
        console.log(`   ⚠️  No winning_index entry for this condition`);
      }
      
      // Check trades for outcome_index values
      console.log("\n5️⃣ CHECK OUTCOME INDICES IN TRADES:\n");
      const trades = await queryData(`
        SELECT 
          outcome_index,
          cast(outcome as String) as outcome_label,
          count() as count
        FROM trades_raw
        WHERE market_id = '${marketId}' 
          AND lower(wallet_address) = '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0'
        GROUP BY outcome_index, outcome
      `);
      
      if (trades.length > 0) {
        console.log(`   Index | Label | Count`);
        trades.forEach((t: any) => {
          console.log(`   ${t[0]} | ${t[1]} | ${t[2]}`);
        });
      }
      
      // Compare trade outcome_index with winning_index
      console.log("\n6️⃣ COMPARISON:\n");
      console.log(`   ⚠️  Trade outcome_indices: ${trades.map((t: any) => t[0]).join(', ')}`);
      console.log(`   ⚠️  Winning index value: ${winning.length > 0 ? winning[0][1] : 'NOT FOUND'}`);
      console.log(`   ⚠️  Do they match? ${trades.some((t: any) => t[0] === winning[0]?.[1]) ? 'YES ✅' : 'NO ❌'}`);
    }
  }
  
  console.log("\n════════════════════════════════════════════════════════════════\n");
}

main().catch(console.error);
