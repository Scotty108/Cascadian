import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  console.log('=== C3 AUDIT: GHOST WALLETS ANALYSIS ===\n');

  // 1. Check ghost_market_wallets_all table
  console.log('1. Checking ghost_market_wallets_all...\n');
  try {
    const schemaQ = await clickhouse.query({
      query: `DESCRIBE TABLE ghost_market_wallets_all`,
      format: 'JSONEachRow'
    });
    const schema: any = await schemaQ.json();
    console.log('   Schema:');
    schema.forEach((col: any) => {
      console.log(`      ${col.name.padEnd(30)} ${col.type}`);
    });

    const countQ = await clickhouse.query({
      query: `
        SELECT
          COUNT(*) as total_records,
          COUNT(DISTINCT wallet) as unique_wallets
        FROM ghost_market_wallets_all
      `,
      format: 'JSONEachRow'
    });
    const count: any = await countQ.json();
    console.log(`\n   Total Records: ${count[0].total_records.toLocaleString()}`);
    console.log(`   Unique Wallets: ${count[0].unique_wallets.toLocaleString()}`);

    // Sample
    const sampleQ = await clickhouse.query({
      query: `
        SELECT *
        FROM ghost_market_wallets_all
        LIMIT 5
      `,
      format: 'JSONEachRow'
    });
    const sample: any = await sampleQ.json();
    console.log('\n   Sample Records:');
    sample.forEach((r: any, i: number) => {
      console.log(`\n   ${i + 1}. ${JSON.stringify(r, null, 6)}`);
    });

  } catch (e: any) {
    console.log(`   ERROR: ${e.message}`);
  }

  // 2. Check ghost_market_wallets table
  console.log('\n\n2. Checking ghost_market_wallets...\n');
  try {
    const countQ = await clickhouse.query({
      query: `
        SELECT
          COUNT(*) as total_records,
          COUNT(DISTINCT wallet) as unique_wallets
        FROM ghost_market_wallets
      `,
      format: 'JSONEachRow'
    });
    const count: any = await countQ.json();
    console.log(`   Total Records: ${count[0].total_records.toLocaleString()}`);
    console.log(`   Unique Wallets: ${count[0].unique_wallets.toLocaleString()}`);

  } catch (e: any) {
    console.log(`   ERROR: ${e.message}`);
  }

  // 3. Cross-check: How many ghost wallets have trade data?
  console.log('\n\n3. Ghost Wallets Coverage Analysis...\n');
  try {
    const coverageQ = await clickhouse.query({
      query: `
        WITH ghost_wallets AS (
          SELECT DISTINCT lower(wallet) as wallet
          FROM ghost_market_wallets_all
        )
        SELECT
          (SELECT COUNT(DISTINCT wallet) FROM ghost_wallets) as total_ghost_wallets,
          (SELECT COUNT(DISTINCT g.wallet)
           FROM ghost_wallets g
           INNER JOIN vw_trades_canonical t
           ON lower(t.wallet_address_norm) = g.wallet) as ghost_wallets_with_trades,
          (SELECT COUNT(DISTINCT g.wallet)
           FROM ghost_wallets g
           INNER JOIN wallet_metrics_complete w
           ON lower(w.wallet_address) = g.wallet) as ghost_wallets_with_metrics
      `,
      format: 'JSONEachRow'
    });
    const coverage: any = await coverageQ.json();

    const total = parseInt(coverage[0].total_ghost_wallets);
    const withTrades = parseInt(coverage[0].ghost_wallets_with_trades);
    const withMetrics = parseInt(coverage[0].ghost_wallets_with_metrics);

    console.log(`   Total Ghost Wallets: ${total.toLocaleString()}`);
    console.log(`   Ghost Wallets with Trades: ${withTrades.toLocaleString()} (${((withTrades/total)*100).toFixed(1)}%)`);
    console.log(`   Ghost Wallets with Metrics: ${withMetrics.toLocaleString()} (${((withMetrics/total)*100).toFixed(1)}%)`);

    const missing = total - withTrades;
    console.log(`\n   ❌ Ghost Wallets WITHOUT Trades: ${missing.toLocaleString()} (${((missing/total)*100).toFixed(1)}%)`);

  } catch (e: any) {
    console.log(`   ERROR: ${e.message}`);
  }

  // 4. Sample ghost wallets that DO have data
  console.log('\n\n4. Sample Ghost Wallets WITH Data...\n');
  try {
    const sampleQ = await clickhouse.query({
      query: `
        WITH ghost_wallets AS (
          SELECT DISTINCT lower(wallet) as wallet
          FROM ghost_market_wallets_all
          LIMIT 1000
        )
        SELECT
          t.wallet_address_norm,
          COUNT(*) as trade_count,
          min(t.timestamp) as first_trade,
          max(t.timestamp) as last_trade
        FROM vw_trades_canonical t
        INNER JOIN ghost_wallets g
        ON lower(t.wallet_address_norm) = g.wallet
        GROUP BY t.wallet_address_norm
        ORDER BY trade_count DESC
        LIMIT 10
      `,
      format: 'JSONEachRow'
    });
    const sample: any = await sampleQ.json();

    console.log('   Top 10 Ghost Wallets by Trade Count:');
    sample.forEach((w: any, i: number) => {
      console.log(`   ${(i+1).toString().padStart(2)}. ${w.wallet_address_norm}`);
      console.log(`       Trades: ${w.trade_count.toLocaleString()} | Range: ${w.first_trade} to ${w.last_trade}`);
    });

  } catch (e: any) {
    console.log(`   ERROR: ${e.message}`);
  }

  // 5. Sample ghost wallets that DON'T have data
  console.log('\n\n5. Sample Ghost Wallets WITHOUT Data...\n');
  try {
    const sampleQ = await clickhouse.query({
      query: `
        WITH ghost_wallets AS (
          SELECT DISTINCT lower(wallet) as wallet
          FROM ghost_market_wallets_all
        ),
        wallets_with_trades AS (
          SELECT DISTINCT lower(wallet_address_norm) as wallet
          FROM vw_trades_canonical
        )
        SELECT g.wallet
        FROM ghost_wallets g
        LEFT JOIN wallets_with_trades t
        ON g.wallet = t.wallet
        WHERE t.wallet IS NULL
        LIMIT 10
      `,
      format: 'JSONEachRow'
    });
    const sample: any = await sampleQ.json();

    console.log('   Sample Ghost Wallets with NO trades:');
    sample.forEach((w: any, i: number) => {
      console.log(`   ${(i+1).toString().padStart(2)}. ${w.wallet}`);
    });

  } catch (e: any) {
    console.log(`   ERROR: ${e.message}`);
  }
}

main().catch(console.error);
