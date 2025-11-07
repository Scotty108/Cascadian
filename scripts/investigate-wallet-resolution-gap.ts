import { clickhouse } from '../lib/clickhouse/client';

async function investigateWallets() {
  console.log("=== WALLET RESOLUTION DATA GAP INVESTIGATION ===\n");

  const wallets = [
    { addr: "0x1489d26f822b46be3db3a6f83b3e7e42a0e91aba", name: "Wallet 1 (CONTROL)" },
    { addr: "0x8e9eedf20dfa70956d49f608a205e402d9df38e4", name: "Wallet 2" },
    { addr: "0xcce2b7c71f21e358b8e5e797e586cbc03160d58b", name: "Wallet 3" },
    { addr: "0x6770bf688b8121331b1c5cfd7723ebd4152545fb", name: "Wallet 4" },
  ];

  // Query 1: Basic activity
  console.log("1. TRADE ACTIVITY BY WALLET:");
  for (const w of wallets) {
    const result = await clickhouse.query({
      query: `
        SELECT 
          '${w.name}' as wallet_name,
          wallet_address,
          count(*) as total_trades,
          min(timestamp) as first_trade,
          max(timestamp) as last_trade,
          countDistinct(condition_id) as unique_conditions
        FROM trades_raw
        WHERE wallet_address = '${w.addr}'
      `,
      format: "JSONEachRow",
    });
    const rows = (await result.json()) as any[];
    if (rows.length > 0) console.log(rows[0]);
  }

  // Query 2: Resolution status for each wallet
  console.log("\n2. RESOLUTION STATUS (JOIN with market_resolutions_final):");
  for (const w of wallets) {
    const result = await clickhouse.query({
      query: `
        SELECT 
          '${w.name}' as wallet_name,
          t.wallet_address,
          count(*) as total_trade_conditions,
          countIf(r.is_resolved = 1) as resolved_count,
          countIf(r.is_resolved = 0) as unresolved_count,
          countIf(r.condition_id_norm IS NULL) as unmapped_count,
          round(100.0 * countIf(r.condition_id_norm IS NOT NULL) / count(*), 2) as join_match_pct
        FROM trades_raw t
        LEFT JOIN market_resolutions_final r ON 
          lower(replaceAll(t.condition_id, '0x', '')) = r.condition_id_norm
        WHERE t.wallet_address = '${w.addr}'
      `,
      format: "JSONEachRow",
    });
    const rows = (await result.json()) as any[];
    if (rows.length > 0) console.log(rows[0]);
  }

  // Query 3: Sample JOIN verification for Wallet 2
  console.log("\n3. SAMPLE JOIN VERIFICATION (Wallet 2 - first 10 trades):");
  const sampleResult = await clickhouse.query({
    query: `
      SELECT 
        t.condition_id,
        lower(replaceAll(t.condition_id, '0x', '')) as normalized_id,
        r.condition_id_norm,
        r.is_resolved,
        r.winning_index,
        CASE WHEN r.condition_id_norm IS NOT NULL THEN 'MATCH' ELSE 'NO_MATCH' END as join_status
      FROM trades_raw t
      LEFT JOIN market_resolutions_final r ON 
        lower(replaceAll(t.condition_id, '0x', '')) = r.condition_id_norm
      WHERE t.wallet_address = '0x8e9eedf20dfa70956d49f608a205e402d9df38e4'
      LIMIT 10
    `,
    format: "JSONEachRow",
  });
  const sampleRows = (await sampleResult.json()) as any[];
  console.table(sampleRows);

  // Query 4: Check Wallet 2 conditions - are they in the resolution table at all?
  console.log("\n4. WALLET 2 CONDITION EXISTENCE CHECK:");
  const existenceResult = await clickhouse.query({
    query: `
      SELECT 
        count(*) as wallet2_total_trades,
        countDistinct(t.condition_id) as wallet2_unique_conditions,
        countDistinct(r.condition_id_norm) as conditions_found_in_resolutions,
        round(100.0 * countDistinct(r.condition_id_norm) / countDistinct(t.condition_id), 2) as coverage_pct
      FROM trades_raw t
      LEFT JOIN market_resolutions_final r ON 
        lower(replaceAll(t.condition_id, '0x', '')) = r.condition_id_norm
      WHERE t.wallet_address = '0x8e9eedf20dfa70956d49f608a205e402d9df38e4'
    `,
    format: "JSONEachRow",
  });
  const existenceRows = (await existenceResult.json()) as any[];
  if (existenceRows.length > 0) console.log(existenceRows[0]);

  // Query 5: Check if Wallet 2 conditions have ANY resolution data
  console.log("\n5. ARE WALLET 2 CONDITIONS RESOLVED?");
  const resolutionResult = await clickhouse.query({
    query: `
      SELECT 
        t.condition_id,
        r.condition_id_norm,
        r.is_resolved,
        r.winning_index,
        r.resolution_timestamp
      FROM trades_raw t
      LEFT JOIN market_resolutions_final r ON 
        lower(replaceAll(t.condition_id, '0x', '')) = r.condition_id_norm
      WHERE t.wallet_address = '0x8e9eedf20dfa70956d49f608a205e402d9df38e4'
        AND r.condition_id_norm IS NOT NULL
      LIMIT 5
    `,
    format: "JSONEachRow",
  });
  const resolutionRows = (await resolutionResult.json()) as any[];
  if (resolutionRows.length === 0) {
    console.log("⚠️  NO MATCHES FOUND - conditions in trades_raw do not appear in market_resolutions_final");
  } else {
    console.table(resolutionRows);
  }

  console.log("\n✓ Investigation complete");
}

investigateWallets().catch(console.error);
