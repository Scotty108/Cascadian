#!/usr/bin/env npx tsx

import "dotenv/config";
import fetch from "node-fetch";
import fs from "fs";

// Standard Polymarket Subgraph URL (The Graph)
const SUBGRAPH_URL = process.env.POLY_SUBGRAPH_URL ||
  "https://api.thegraph.com/subgraphs/name/propsproject/polymarket";

console.log(`\nIntrospecting Subgraph: ${SUBGRAPH_URL}\n`);

const introspectionQuery = `
  query IntrospectionQuery {
    __schema {
      types {
        name
        fields {
          name
          type {
            name
            kind
          }
        }
      }
    }
  }
`;

async function introspect() {
  try {
    const response = await fetch(SUBGRAPH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: introspectionQuery }),
    });

    const json = await (response as any).json();
    if (json.errors) {
      console.error("GraphQL errors:", json.errors);
      process.exit(1);
    }

    const types = json.data.__schema.types;

    // Look for entities with promising names
    const candidates = types.filter((t: any) => {
      const name = (t.name || "").toLowerCase();
      return (
        name.includes("trade") ||
        name.includes("fill") ||
        name.includes("order") ||
        name.includes("match")
      ) && !name.startsWith("_");
    });

    console.log("Candidate entities:");
    candidates.forEach((c: any) => {
      console.log(`\n${c.name}:`);
      if (c.fields) {
        c.fields.forEach((f: any) => {
          console.log(`  - ${f.name}`);
        });
      }
    });

    // Auto-detect best mapping
    let bestEntity = candidates[0];
    if (!bestEntity) {
      console.error("No trade/fill entities found. Check Subgraph URL.");
      process.exit(1);
    }

    console.log(`\nSelected entity: ${bestEntity.name}`);

    const fieldNames = (bestEntity.fields || []).map((f: any) => f.name);
    const mapping = {
      entity: bestEntity.name.toLowerCase(),
      fields: {
        id: fieldNames.includes("id") ? "id" : null,
        tx_hash: fieldNames.find((f: string) =>
          ["transactionHash", "txHash", "tx", "hash"].includes(f)
        ) || null,
        log_index: fieldNames.find((f: string) =>
          ["logIndex", "index"].includes(f)
        ) || null,
        wallet_choices: fieldNames.filter((f: string) =>
          ["maker", "taker", "account", "trader", "proxyWallet", "user"].includes(f)
        ),
        price: fieldNames.find((f: string) =>
          ["price", "executionPrice"].includes(f)
        ) || null,
        size: fieldNames.find((f: string) =>
          ["size", "amount", "shares"].includes(f)
        ) || null,
        market_id_choices: fieldNames.filter((f: string) =>
          ["market", "conditionId", "marketId", "questionId"].includes(f)
        ),
        token_id_choices: fieldNames.filter((f: string) =>
          ["tokenId", "outcomeTokenId", "outcomeId"].includes(f)
        ),
        outcome_choices: fieldNames.filter((f: string) =>
          ["outcome", "outcomeId", "side"].includes(f)
        ),
        timestamp: fieldNames.find((f: string) =>
          ["timestamp", "createdAtTimestamp", "createdAt"].includes(f)
        ) || null,
      },
      cursor_field: "id",
    };

    console.log("\nDetected mapping:");
    console.log(JSON.stringify(mapping, null, 2));

    fs.writeFileSync(".subgraph_mapping.json", JSON.stringify(mapping, null, 2));
    console.log("\n✅ Mapping saved to .subgraph_mapping.json\n");

  } catch (e) {
    console.error("Error:", e);
    process.exit(1);
  }
}

introspect();
