import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  console.log("Analyzing outcome label → index mapping...\n");

  // Check gamma_outcome_mapping if it exists
  console.log("Checking if gamma_outcome_mapping exists...");
  try {
    const mapQuery = await clickhouse.query({
      query: `
        SELECT
          condition_id_norm,
          outcome_label,
          outcome_index
        FROM gamma_outcome_mapping
        WHERE outcome_label IN ('Yes', 'No')
        LIMIT 5
      `,
      format: 'JSONEachRow'
    });
    const mapData = await mapQuery.json();
    console.log("\ngamma_outcome_mapping samples:");
    console.table(mapData);
  } catch (error: any) {
    console.log(`❌ gamma_outcome_mapping not found: ${error.message}\n`);
  }

  // For binary markets, check a sample condition_id
  console.log("\nLet's check a sample market's outcome structure...");
  const testWallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  const sampleQuery = await clickhouse.query({
    query: `
      SELECT DISTINCT
        tc.condition_id_norm,
        tc.outcome_idx,
        gm.winning_outcome
      FROM trade_cashflows_v3_blockchain tc
      INNER JOIN gamma_resolved gm ON tc.condition_id_norm = gm.cid
      WHERE lower(tc.wallet) = lower('${testWallet}')
        AND gm.winning_outcome IN ('Yes', 'No')
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });
  const sampleData = await sampleQuery.json();

  console.log("\nSample markets with Yes/No outcomes:");
  console.table(sampleData);

  // Check outcome index pattern
  console.log("\nOutcome index distribution:");
  const distQuery = await clickhouse.query({
    query: `
      SELECT
        gm.winning_outcome,
        groupArray(DISTINCT tc.outcome_idx) as outcome_indices
      FROM trade_cashflows_v3_blockchain tc
      INNER JOIN gamma_resolved gm ON tc.condition_id_norm = gm.cid
      WHERE gm.winning_outcome IN ('Yes', 'No', 'Up', 'Down')
      GROUP BY gm.winning_outcome
    `,
    format: 'JSONEachRow'
  });
  console.table(await distQuery.json());
}

main().catch(console.error);
