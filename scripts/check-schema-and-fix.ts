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
    return JSON.parse(text).data || [];
  } catch (e: any) {
    console.error(`❌ Query error: ${e.message}`);
    return [];
  }
}

async function main() {
  console.log("\n════════════════════════════════════════════════════════════════");
  console.log("SCHEMA AUDIT AND ROOT CAUSE ANALYSIS");
  console.log("════════════════════════════════════════════════════════════════\n");
  
  // Check what columns actually exist in key tables
  console.log("1️⃣ CONDITION_MARKET_MAP COLUMNS:\n");
  const cmm = await queryData(`
    SELECT * FROM condition_market_map LIMIT 1
  `);
  
  console.log("   (checking by trying to select each field...)\n");
  
  // Check if the views are querying the right tables
  console.log("2️⃣ WINNING_INDEX ACTUAL CONTENT:\n");
  const winning = await queryData(`
    SELECT 
      condition_id_norm,
      win_idx,
      count() as cnt
    FROM winning_index
    GROUP BY condition_id_norm, win_idx
    LIMIT 10
  `);
  
  if (winning.length > 0) {
    console.log("   condition_id_norm | win_idx");
    winning.forEach((row: any) => {
      console.log(`   ${row[0].substring(0, 16)}... | ${row[1]}`);
    });
  }
  
  // Check if there are ANY trades that match the winning indices
  console.log("\n3️⃣ CHECKING OUTCOME MISMATCH FOR A SPECIFIC MARKET:\n");
  const sample = await queryData(`
    SELECT DISTINCT lower(market_id) as market_id
    FROM trades_raw
    WHERE lower(wallet_address) = '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0'
      AND market_id != '12'
      AND market_id != '0x0000000000000000000000000000000000000000000000000000000000000000'
    LIMIT 1
  `);
  
  if (sample.length > 0) {
    const mkt = sample[0][0];
    console.log(`   Sample market: ${mkt}`);
    
    // Get outcome indices from this market
    const outcomesInTrades = await queryData(`
      SELECT DISTINCT outcome_index
      FROM trades_raw
      WHERE lower(market_id) = '${mkt}'
    `);
    console.log(`   Outcome indices in trades: ${outcomesInTrades.map((r: any) => r[0]).join(', ')}`);
    
    // Get winning index for this market
    const winningForMarket = await queryData(`
      SELECT wi.win_idx
      FROM winning_index wi
      WHERE EXISTS (
        SELECT 1 FROM canonical_condition cc 
        WHERE cc.market_id = '${mkt}'
        AND cc.condition_id_norm = wi.condition_id_norm
      )
    `);
    console.log(`   Winning index for market: ${winningForMarket.length > 0 ? winningForMarket[0][0] : 'NOT FOUND'}`);
  }
  
  // Check total records in trades_raw
  console.log("\n4️⃣ DATA VOLUME CHECK:\n");
  const volumes = await queryData(`
    SELECT 
      count() as total_trades,
      count(DISTINCT lower(wallet_address)) as unique_wallets,
      count(DISTINCT lower(market_id)) as unique_markets
    FROM trades_raw
  `);
  
  if (volumes.length > 0) {
    console.log(`   Total trades: ${volumes[0][0]}`);
    console.log(`   Unique wallets: ${volumes[0][1]}`);
    console.log(`   Unique markets: ${volumes[0][2]}`);
  }
  
  console.log("\n════════════════════════════════════════════════════════════════");
  console.log("HYPOTHESIS:");
  console.log("The sumIf(delta_shares, outcome_idx = win_idx) is always 0");
  console.log("because trades have outcome_index=1 but winning_index has win_idx=0");
  console.log("or there's NO matching condition found for most trades");
  console.log("════════════════════════════════════════════════════════════════\n");
}

main().catch(console.error);
