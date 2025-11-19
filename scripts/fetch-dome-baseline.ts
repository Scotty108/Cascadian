import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { writeFileSync } from 'fs';

async function main() {
  console.log("═".repeat(80));
  console.log("FETCH DOME BASELINE FOR COMPARISON");
  console.log("═".repeat(80));
  console.log();

  const testWallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  console.log("To get market-by-market comparison with Dome, we need their API response.");
  console.log();
  console.log("Please run this command:");
  console.log("─".repeat(80));
  console.log();
  console.log(`curl "https://clob.polymarket.com/pnl?wallet=${testWallet}" \\`);
  console.log(`  -H "accept: application/json" \\`);
  console.log(`  > tmp/dome-api-response.json`);
  console.log();
  console.log("─".repeat(80));
  console.log();
  console.log("Alternative API endpoints to try:");
  console.log(`  - https://gamma-api.polymarket.com/pnl?wallet=${testWallet}`);
  console.log(`  - https://clob.polymarket.com/positions?wallet=${testWallet}`);
  console.log(`  - https://data-api.polymarket.com/pnl?address=${testWallet}`);
  console.log();
  console.log("Once you have the response, save it to tmp/dome-api-response.json");
  console.log("Then run: npx tsx scripts/compare-dome-market-by-market.ts");
  console.log();
  console.log("This will show us EXACTLY which markets have different P&L values.");
  console.log();
  console.log("═".repeat(80));
}

main().catch(console.error);
