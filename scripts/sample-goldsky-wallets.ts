import { createClient } from '@clickhouse/client';

const client = createClient({
  url: 'https://ja9egedrv0.us-central1.gcp.clickhouse.cloud:8443',
  username: 'default',
  password: 'Lbr.jYtw5ikf3',
  database: 'default',
});

async function main() {
  try {
    console.log('=== GOLDSKY DATA SAMPLES ===\n');

    // Just get any 3 positions from pm_wallet_market_pnl_v4
    console.log('📊 pm_archive.pm_wallet_market_pnl_v4 - Random Samples\n');
    const pnlSample = await client.query({
      query: `
        SELECT *
        FROM pm_archive.pm_wallet_market_pnl_v4
        WHERE is_resolved = 1
        LIMIT 3
      `,
      format: 'JSONEachRow',
    });
    const pnlData = await pnlSample.json() as any[];
    pnlData.forEach((row, idx) => {
      console.log(`\nPosition ${idx + 1}:`);
      Object.entries(row).forEach(([k, v]) => {
        let display = v;
        if (typeof v === 'string' && v.length > 60) {
          display = v.substring(0, 57) + '...';
        }
        console.log(`  ${k.padEnd(30)} ${JSON.stringify(display)}`);
      });
    });

    // Check field types more carefully
    console.log('\n\n📋 Field Analysis:\n');
    const descResult = await client.query({
      query: `DESCRIBE TABLE pm_archive.pm_wallet_market_pnl_v4`,
      format: 'JSONEachRow',
    });
    const fields = await descResult.json() as any[];
    fields.forEach(f => {
      console.log(`  ${f.name.padEnd(30)} ${f.type}`);
    });

    // Get summary stats
    console.log('\n\n📊 Summary Statistics:\n');
    const statsResult = await client.query({
      query: `
        SELECT
          count() as total_positions,
          count(DISTINCT wallet) as unique_wallets,
          count(DISTINCT condition_id) as unique_conditions,
          sum(total_pnl) as total_pnl,
          sum(trading_pnl) as total_trading_pnl,
          sum(resolution_pnl) as total_resolution_pnl
        FROM pm_archive.pm_wallet_market_pnl_v4
        WHERE is_resolved = 1
      `,
      format: 'JSONEachRow',
    });
    const stats = await statsResult.json() as any[];
    const s = stats[0];
    console.log(`  Total Positions:      ${s.total_positions.toLocaleString()}`);
    console.log(`  Unique Wallets:       ${s.unique_wallets.toLocaleString()}`);
    console.log(`  Unique Conditions:    ${s.unique_conditions.toLocaleString()}`);
    console.log(`  Total PnL:            $${(s.total_pnl / 1000000).toFixed(2)}`);
    console.log(`  Total Trading PnL:    $${(s.total_trading_pnl / 1000000).toFixed(2)}`);
    console.log(`  Total Resolution PnL: $${(s.total_resolution_pnl / 1000000).toFixed(2)}`);

    await client.close();

  } catch (error) {
    console.error('Error:', error);
    await client.close();
    process.exit(1);
  }
}

main();
