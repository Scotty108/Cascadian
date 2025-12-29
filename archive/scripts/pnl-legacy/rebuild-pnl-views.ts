#!/usr/bin/env npx tsx
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: "default",
  password: "8miOkWI~OhsDb",
  database: "default",
  request_timeout: 60000,
});

async function executeQuery(query: string, name: string) {
  try {
    await ch.command({ query });
    console.log(`  ✅ ${name}`);
    return true;
  } catch (e: any) {
    console.error(`  ❌ ${name}: ${e.message.split('\n')[0]}`);
    return false;
  }
}

async function main() {
  console.log("\n════════════════════════════════════════════════════════════════");
  console.log("REBUILDING P&L VIEWS WITH CORRECT SCHEMA AND FORMULA");
  console.log("════════════════════════════════════════════════════════════════\n");

  // Step 1: Drop broken views
  console.log("Step 1: Dropping broken views...\n");
  await executeQuery(`DROP VIEW IF EXISTS wallet_pnl_summary_final`, "Drop wallet_pnl_summary_final");
  await executeQuery(`DROP VIEW IF EXISTS wallet_realized_pnl_final`, "Drop wallet_realized_pnl_final");
  await executeQuery(`DROP VIEW IF EXISTS realized_pnl_by_market_final`, "Drop realized_pnl_by_market_final");

  // Step 2: Rebuild realized_pnl_by_market_final with correct formula
  console.log("\nStep 2: Creating realized_pnl_by_market_final (corrected)...\n");
  
  const createRealizedByMarket = `
    CREATE VIEW realized_pnl_by_market_final (
      wallet String,
      condition_id_norm String,
      realized_pnl_usd Float64
    ) AS
    WITH winning_outcomes AS (
      SELECT 
        condition_id_norm,
        toInt16(win_idx) AS win_idx
      FROM winning_index
    )
    SELECT 
      p.wallet,
      p.condition_id_norm,
      round(
        sum(toFloat64(c.cashflow_usdc)) - sumIf(toFloat64(p.net_shares), p.outcome_idx = w.win_idx),
        2
      ) AS realized_pnl_usd
    FROM outcome_positions_v2 AS p
    ANY LEFT JOIN winning_outcomes AS w ON w.condition_id_norm = p.condition_id_norm
    ANY LEFT JOIN trade_cashflows_v3 AS c ON 
      (c.wallet = p.wallet) AND (c.condition_id_norm = p.condition_id_norm)
    WHERE w.win_idx IS NOT NULL
    GROUP BY p.wallet, p.condition_id_norm
  `;
  
  if (!await executeQuery(createRealizedByMarket, "Create realized_pnl_by_market_final")) {
    process.exit(1);
  }

  // Step 3: Create wallet_realized_pnl_final
  console.log("\nStep 3: Creating wallet_realized_pnl_final...\n");
  
  const createWalletRealized = `
    CREATE VIEW wallet_realized_pnl_final (
      wallet String,
      realized_pnl_usd Float64
    ) AS
    SELECT 
      wallet,
      round(sum(realized_pnl_usd), 2) AS realized_pnl_usd
    FROM realized_pnl_by_market_final
    GROUP BY wallet
  `;
  
  if (!await executeQuery(createWalletRealized, "Create wallet_realized_pnl_final")) {
    process.exit(1);
  }

  // Step 4: Create wallet_pnl_summary_final
  console.log("\nStep 4: Creating wallet_pnl_summary_final...\n");
  
  const createWalletSummary = `
    CREATE VIEW wallet_pnl_summary_final (
      wallet String,
      realized_pnl_usd Float64,
      unrealized_pnl_usd Float64,
      total_pnl_usd Float64
    ) AS
    SELECT 
      coalesce(r.wallet, u.wallet) AS wallet,
      coalesce(r.realized_pnl_usd, 0) AS realized_pnl_usd,
      coalesce(u.unrealized_pnl_usd, 0) AS unrealized_pnl_usd,
      round(coalesce(r.realized_pnl_usd, 0) + coalesce(u.unrealized_pnl_usd, 0), 2) AS total_pnl_usd
    FROM wallet_realized_pnl_final AS r
    FULL OUTER JOIN wallet_unrealized_pnl_v2 AS u USING (wallet)
  `;
  
  if (!await executeQuery(createWalletSummary, "Create wallet_pnl_summary_final")) {
    process.exit(1);
  }

  console.log("\n" + "═".repeat(70));
  console.log("✅ ALL VIEWS REBUILT SUCCESSFULLY");
  console.log("═".repeat(70) + "\n");

  // Step 5: Test the results
  console.log("Testing Results:\n");
  
  const niggemon = "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0";
  const holymoses = "0xa4b366ad22fc0d06f1e934ff468e8922431a87b8";

  try {
    const result = await ch.query({
      query: `
        SELECT
          wallet,
          realized_pnl_usd,
          unrealized_pnl_usd,
          total_pnl_usd,
          CASE
            WHEN lower(wallet) = lower('${niggemon}') THEN 'niggemon'
            WHEN lower(wallet) = lower('${holymoses}') THEN 'HolyMoses7'
            ELSE 'OTHER'
          END as name
        FROM wallet_pnl_summary_final
        WHERE lower(wallet) IN (lower('${niggemon}'), lower('${holymoses}'))
        ORDER BY wallet
      `,
      format: "JSONCompact"
    });

    const text = await result.text();
    const data = JSON.parse(text).data || [];

    const expectedValues: Record<string, number> = {
      niggemon: 102001,
      "HolyMoses7": 89975
    };

    for (const row of data) {
      const wallet = row[0];
      const realized = parseFloat(row[1]);
      const unrealized = parseFloat(row[2]);
      const total = parseFloat(row[3]);
      const name = row[4];

      const expected = expectedValues[name];
      const variance = expected ? ((total - expected) / expected) * 100 : null;

      console.log(`${name}:`);
      console.log(`  Realized:   $${realized.toFixed(2)}`);
      console.log(`  Unrealized: $${unrealized.toFixed(2)}`);
      console.log(`  Total:      $${total.toFixed(2)}`);
      console.log(`  Expected:   $${expected.toFixed(2)}`);
      console.log(`  Variance:   ${variance.toFixed(2)}%`);
      console.log(`  Status:     ${Math.abs(variance) <= 5 ? "✅ PASS" : "❌ FAIL"}\n`);
    }
  } catch (e: any) {
    console.error(`Error testing results: ${e.message}\n`);
  }
}

main().catch(console.error);
