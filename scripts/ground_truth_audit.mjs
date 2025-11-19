import { createClient } from "@clickhouse/client";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

async function runAudit() {
  const client = createClient({
    url: process.env.CLICKHOUSE_HOST,
    username: process.env.CLICKHOUSE_USER || "default",
    password: process.env.CLICKHOUSE_PASSWORD,
    database: process.env.CLICKHOUSE_DATABASE || "default",
  });

  try {
    console.log("STEP 1: Check trades_raw schema");
    const schema = await client.query({
      query: "DESCRIBE TABLE default.trades_raw",
    });
    const schemaData = await schema.json();
    console.log(JSON.stringify(schemaData.data, null, 2));

    console.log("\n\nSTEP 2: ERC-1155 Coverage Analysis\n");
    console.log("Query 1: Overall min/max/count for erc1155_transfers");
    const overallErc = await client.query({
      query: "SELECT min(block_number) as min_block, max(block_number) as max_block, count() as total_rows FROM default.erc1155_transfers",
    });
    const overallResult = await overallErc.json();
    console.log(JSON.stringify(overallResult.data[0], null, 2));

    // Block range coverage
    const blockRanges = [
      [0, 5000000],
      [5000000, 10000000],
      [10000000, 15000000],
      [15000000, 20000000],
      [20000000, 25000000],
      [25000000, 30000000],
      [30000000, 35000000],
      [35000000, 40000000],
      [40000000, 80000000],
    ];

    console.log("\nBlock Range Coverage:");
    for (const [min, max] of blockRanges) {
      const res = await client.query({
        query: `SELECT count() as row_count FROM default.erc1155_transfers WHERE block_number BETWEEN ${min} AND ${max}`,
      });
      const data = await res.json();
      const count = data.data[0].row_count || 0;
      console.log(`  [${min}-${max}]: ${count} rows`);
    }

    // STEP 3: Test wallet coverage - Check actual columns
    console.log("\n\nSTEP 3: Wallet 0x4ce73141dbfce41e65db3723e31059a730f0abad Coverage\n");

    console.log("Query A: ERC-1155 transfers for wallet");
    const erc1155Wallet = await client.query({
      query: "SELECT count() as erc1155_count, min(block_number) as min_block, max(block_number) as max_block FROM default.erc1155_transfers WHERE from_address = '0x4ce73141dbfce41e65db3723e31059a730f0abad' OR to_address = '0x4ce73141dbfce41e65db3723e31059a730f0abad'",
    });
    const erc1155Result = await erc1155Wallet.json();
    console.log(JSON.stringify(erc1155Result.data[0], null, 2));

    // Query actual columns
    console.log("\nQuery B: Check what columns exist in trades_raw");
    const colsCheck = await client.query({
      query: "SELECT * FROM default.trades_raw LIMIT 1",
    });
    const colsData = await colsCheck.json();
    const cols = Object.keys(colsData.data[0] || {});
    console.log("Available columns: " + cols.join(", "));

    // Check for trader/user/wallet column
    let walletCol = cols.find(c => c.toLowerCase().includes('wallet') || c.toLowerCase().includes('trader') || c.toLowerCase().includes('user'));
    if (!walletCol && cols.length > 0) {
      walletCol = cols[0]; // fallback to first column if no obvious match
    }

    if (walletCol) {
      console.log(`\nQuery C: Trades in trades_raw for wallet (using column: ${walletCol})`);
      const tradesWallet = await client.query({
        query: `SELECT count() as trades_count, min(block_time) as min_time, max(block_time) as max_time FROM default.trades_raw WHERE lower(${walletCol}) = '0x4ce73141dbfce41e65db3723e31059a730f0abad' LIMIT 5`,
      });
      const tradesResult = await tradesWallet.json();
      console.log(JSON.stringify(tradesResult.data[0], null, 2));
    }

    // STEP 4: Canonical table health
    console.log("\n\nSTEP 4: Canonical Table Health & Row Counts\n");

    console.log("trades_raw:");
    const raw = await client.query({
      query: "SELECT count() as row_count FROM default.trades_raw",
    });
    console.log(JSON.stringify((await raw.json()).data[0], null, 2));

    console.log("\nvw_trades_canonical:");
    const vwTrades = await client.query({
      query: "SELECT count() as row_count FROM default.vw_trades_canonical",
    });
    console.log(JSON.stringify((await vwTrades.json()).data[0], null, 2));

    console.log("\ntrade_direction_assignments:");
    const dirAssign = await client.query({
      query: "SELECT count() as row_count FROM default.trade_direction_assignments",
    });
    console.log(JSON.stringify((await dirAssign.json()).data[0], null, 2));

    console.log("\ntrades_with_direction:");
    const tradesDir = await client.query({
      query: "SELECT count() as row_count FROM default.trades_with_direction",
    });
    console.log(JSON.stringify((await tradesDir.json()).data[0], null, 2));

    // Try fact_trades_clean if it exists
    try {
      console.log("\nfact_trades_clean:");
      const factClean = await client.query({
        query: "SELECT count() as row_count FROM cascadian_clean.fact_trades_clean",
      });
      console.log(JSON.stringify((await factClean.json()).data[0], null, 2));
    } catch (e) {
      console.log("fact_trades_clean: TABLE NOT FOUND OR ERROR");
    }

    // STEP 5: Direction pipeline audit
    console.log("\n\nSTEP 5: Direction Pipeline Audit\n");

    console.log("trades_raw rowcount:");
    const rawCount = await client.query({
      query: "SELECT count() as trades_raw_count FROM default.trades_raw",
    });
    console.log(JSON.stringify((await rawCount.json()).data[0], null, 2));

    console.log("\ntrade_direction_assignments rowcount:");
    const dirCount = await client.query({
      query: "SELECT count() as direction_assignments_count FROM default.trade_direction_assignments",
    });
    console.log(JSON.stringify((await dirCount.json()).data[0], null, 2));

    console.log("\ntrades_with_direction rowcount:");
    const dirWithCount = await client.query({
      query: "SELECT count() as trades_with_direction_count FROM default.trades_with_direction",
    });
    console.log(JSON.stringify((await dirWithCount.json()).data[0], null, 2));

    console.log("\nNULL direction count:");
    const nullDir = await client.query({
      query: "SELECT count() as null_direction FROM default.trades_with_direction WHERE direction IS NULL",
    });
    console.log(JSON.stringify((await nullDir.json()).data[0], null, 2));

  } catch (e) {
    console.error("Audit error:", e.message || e);
  } finally {
    await client.close();
  }
}

runAudit().catch(console.error);
