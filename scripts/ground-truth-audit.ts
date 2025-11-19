import { createClient } from "@clickhouse/client";

const client = createClient({
  host: "localhost",
  port: 8123,
  database: "default",
});

async function runAudit() {
  try {
    console.log("STEP 2: ERC-1155 Coverage Analysis\n");
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
        query: "SELECT count() as row_count FROM default.erc1155_transfers WHERE block_number BETWEEN " + min + " AND " + max,
      });
      const data = await res.json();
      const count = data.data[0].row_count || 0;
      console.log("  [" + min + "-" + max + "]: " + count + " rows");
    }

    // STEP 3: Test wallet coverage
    console.log("\n\nSTEP 3: Wallet 0x4ce73141dbfce41e65db3723e31059a730f0abad Coverage\n");

    console.log("Query A: ERC-1155 transfers for wallet");
    const erc1155Wallet = await client.query({
      query: "SELECT count() as erc1155_count, min(block_number) as min_block, max(block_number) as max_block FROM default.erc1155_transfers WHERE from_address = '0x4ce73141dbfce41e65db3723e31059a730f0abad' OR to_address = '0x4ce73141dbfce41e65db3723e31059a730f0abad'",
    });
    const erc1155Result = await erc1155Wallet.json();
    console.log(JSON.stringify(erc1155Result.data[0], null, 2));

    console.log("\nQuery B: Trades in trades_raw for wallet");
    const tradesWallet = await client.query({
      query: "SELECT count() as trades_count, min(block_time) as min_time, max(block_time) as max_time FROM default.trades_raw WHERE lower(wallet_address) = '0x4ce73141dbfce41e65db3723e31059a730f0abad'",
    });
    const tradesResult = await tradesWallet.json();
    console.log(JSON.stringify(tradesResult.data[0], null, 2));

    console.log("\nQuery C: Case variation check for wallet");
    const caseCheck = await client.query({
      query: "SELECT count() as trades_count FROM default.trades_raw WHERE wallet_address LIKE '%4ce73141%' OR wallet_address LIKE '%4CE73141%'",
    });
    const caseResult = await caseCheck.json();
    console.log(JSON.stringify(caseResult.data[0], null, 2));

    // STEP 4: Canonical table health
    console.log("\n\nSTEP 4: Canonical Table Health & Row Counts\n");

    console.log("trades_raw:");
    const raw = await client.query({
      query: "SELECT count() as row_count, max(created_at) as last_updated FROM default.trades_raw",
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

    console.log("\nDistinct trade pairs:");
    const distinct = await client.query({
      query: "SELECT count() as distinct_trades FROM (SELECT DISTINCT tx_hash, wallet_address FROM default.trades_with_direction)",
    });
    console.log(JSON.stringify((await distinct.json()).data[0], null, 2));

    console.log("\nSample NULL direction rows (first 10):");
    const sample = await client.query({
      query: "SELECT tx_hash, wallet_address, block_number, direction, erc1155_token_id FROM default.trades_with_direction WHERE direction IS NULL LIMIT 10",
    });
    const sampleData = await sample.json();
    console.log(JSON.stringify(sampleData.data, null, 2));

  } catch (e) {
    console.error("Audit error:", e);
    throw e;
  } finally {
    await client.close();
  }
}

runAudit().catch(console.error);
