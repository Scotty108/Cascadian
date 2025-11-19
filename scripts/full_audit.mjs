import { createClient } from "@clickhouse/client";
import dotenv from "dotenv";
import fs from "fs";

dotenv.config({ path: ".env.local" });

async function runAudit() {
  const client = createClient({
    url: process.env.CLICKHOUSE_HOST,
    username: process.env.CLICKHOUSE_USER || "default",
    password: process.env.CLICKHOUSE_PASSWORD,
    database: process.env.CLICKHOUSE_DATABASE || "default",
  });

  const findings = {
    timestamp: new Date().toISOString(),
    step2_erc1155: {},
    step3_wallet: {},
    step4_tables: {},
    step5_direction: {},
  };

  try {
    // STEP 2: ERC-1155 overall
    console.log("STEP 2: ERC-1155 Coverage");
    let res = await client.query({
      query: "SELECT min(block_number) as min_block, max(block_number) as max_block, count() as total_rows FROM default.erc1155_transfers",
    });
    let data = await res.json();
    findings.step2_erc1155.overall = data.data[0];
    console.log("Overall: " + JSON.stringify(data.data[0]));

    // Block ranges
    const blockRanges = [[0, 5e6], [5e6, 10e6], [10e6, 15e6], [15e6, 20e6], [20e6, 25e6], [25e6, 30e6], [30e6, 35e6], [35e6, 40e6], [40e6, 80e6]];
    const coverage = [];
    for (const [min, max] of blockRanges) {
      res = await client.query({
        query: "SELECT count() as cnt FROM default.erc1155_transfers WHERE block_number BETWEEN " + min + " AND " + max,
      });
      data = await res.json();
      const cnt = data.data[0].cnt;
      coverage.push({ range: min + "-" + max, count: cnt });
      console.log("  [" + min + "-" + max + "]: " + cnt);
    }
    findings.step2_erc1155.block_coverage = coverage;

    // STEP 3: Wallet coverage
    console.log("\nSTEP 3: Wallet 0x4ce73141dbfce41e65db3723e31059a730f0abad");
    res = await client.query({
      query: "SELECT count() as cnt, min(block_number) as min_block, max(block_number) as max_block FROM default.erc1155_transfers WHERE from_address = '0x4ce73141dbfce41e65db3723e31059a730f0abad' OR to_address = '0x4ce73141dbfce41e65db3723e31059a730f0abad'",
    });
    data = await res.json();
    findings.step3_wallet.erc1155_transfers = data.data[0];
    console.log("ERC-1155 transfers: " + JSON.stringify(data.data[0]));

    res = await client.query({
      query: "SELECT count() as cnt, min(block_time) as min_time, max(block_time) as max_time FROM default.trades_raw WHERE lower(wallet) = '0x4ce73141dbfce41e65db3723e31059a730f0abad'",
    });
    data = await res.json();
    findings.step3_wallet.trades_raw = data.data[0];
    console.log("Trades raw: " + JSON.stringify(data.data[0]));

    // STEP 4: Table counts
    console.log("\nSTEP 4: Table Health");
    const tables = ["trades_raw", "vw_trades_canonical", "trade_direction_assignments", "trades_with_direction"];
    for (const tbl of tables) {
      res = await client.query({
        query: "SELECT count() as cnt FROM default." + tbl,
      });
      data = await res.json();
      findings.step4_tables[tbl] = parseInt(data.data[0].cnt);
      console.log(tbl + ": " + data.data[0].cnt);
    }

    // Try fact_trades_clean
    try {
      res = await client.query({
        query: "SELECT count() as cnt FROM cascadian_clean.fact_trades_clean",
      });
      data = await res.json();
      findings.step4_tables.fact_trades_clean = parseInt(data.data[0].cnt);
      console.log("fact_trades_clean: " + data.data[0].cnt);
    } catch (e) {
      findings.step4_tables.fact_trades_clean = "NOT_FOUND";
      console.log("fact_trades_clean: NOT FOUND");
    }

    // STEP 5: Direction pipeline
    console.log("\nSTEP 5: Direction Pipeline");
    const raw = findings.step4_tables.trades_raw;
    const dir = findings.step4_tables.trade_direction_assignments;
    const with_dir = findings.step4_tables.trades_with_direction;

    findings.step5_direction.raw_count = raw;
    findings.step5_direction.dir_count = dir;
    findings.step5_direction.with_dir_count = with_dir;
    findings.step5_direction.loss_stage1 = raw - dir;
    findings.step5_direction.loss_stage1_pct = ((raw - dir) / raw * 100).toFixed(2);
    findings.step5_direction.loss_stage2 = dir - with_dir;
    findings.step5_direction.loss_stage2_pct = ((dir - with_dir) / dir * 100).toFixed(2);
    findings.step5_direction.loss_total = raw - with_dir;
    findings.step5_direction.loss_total_pct = ((raw - with_dir) / raw * 100).toFixed(2);

    console.log("trades_raw: " + raw);
    console.log("direction_assignments: " + dir + " (loss: " + findings.step5_direction.loss_stage1 + " = " + findings.step5_direction.loss_stage1_pct + "%)");
    console.log("with_direction: " + with_dir + " (loss: " + findings.step5_direction.loss_stage2 + " = " + findings.step5_direction.loss_stage2_pct + "%)");
    console.log("TOTAL LOSS: " + findings.step5_direction.loss_total + " (" + findings.step5_direction.loss_total_pct + "%)");

    // Check NULL directions
    res = await client.query({
      query: "SELECT count() as cnt FROM default.trades_with_direction WHERE direction IS NULL",
    });
    data = await res.json();
    findings.step5_direction.null_direction_count = data.data[0].cnt;
    console.log("NULL direction rows: " + data.data[0].cnt);

    // Distinct trades
    res = await client.query({
      query: "SELECT count() as cnt FROM (SELECT DISTINCT tx_hash, wallet FROM default.trades_with_direction)",
    });
    data = await res.json();
    findings.step5_direction.distinct_trades = data.data[0].cnt;
    console.log("Distinct trades: " + data.data[0].cnt);

    // Sample NULLs
    res = await client.query({
      query: "SELECT tx_hash, wallet, direction FROM default.trades_with_direction WHERE direction IS NULL LIMIT 3",
    });
    data = await res.json();
    findings.step5_direction.null_samples = data.data;

    // Write findings
    const output = JSON.stringify(findings, null, 2);
    fs.writeFileSync("AUDIT_FINDINGS.json", output);
    console.log("\n\nFindings saved to AUDIT_FINDINGS.json");

  } catch (e) {
    console.error("ERROR: " + e.message);
  } finally {
    await client.close();
  }
}

runAudit();
