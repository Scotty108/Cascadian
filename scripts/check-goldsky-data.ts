import { createClient } from '@clickhouse/client';

const client = createClient({
  url: 'https://ja9egedrv0.us-central1.gcp.clickhouse.cloud:8443',
  username: 'default',
  password: 'Lbr.jYtw5ikf3',
  database: 'default',
});

async function main() {
  try {
    console.log('=== GOLDSKY PRE-COMPUTED DATA ===\n');

    // Check pm_user_positions
    console.log('📊 pm_archive.pm_user_positions\n');
    console.log('Row count: 54,431,782\n');

    // Get a wallet's position to understand the data
    console.log('📋 Sample wallet positions:\n');
    const walletSample = await client.query({
      query: `
        SELECT *
        FROM pm_archive.pm_user_positions
        WHERE proxy_wallet = '0x6a0978c4a1b0ccff7e88c05fded8c4c8ea0bcb11'
        LIMIT 5
      `,
      format: 'JSONEachRow',
    });
    const walletData = await walletSample.json() as any[];
    walletData.forEach((row, idx) => {
      console.log(`\nPosition ${idx + 1}:`);
      Object.entries(row).forEach(([k, v]) => {
        console.log(`  ${k.padEnd(30)} ${JSON.stringify(v)}`);
      });
    });

    // Check pm_wallet_market_pnl_v4
    console.log('\n\n📊 pm_archive.pm_wallet_market_pnl_v4\n');
    console.log('Row count: 35,223,748\n');

    console.log('📋 Sample wallet market PnL:\n');
    const pnlSample = await client.query({
      query: `
        SELECT *
        FROM pm_archive.pm_wallet_market_pnl_v4
        WHERE wallet = '0x6a0978c4a1b0ccff7e88c05fded8c4c8ea0bcb11'
        AND is_resolved = 1
        LIMIT 3
      `,
      format: 'JSONEachRow',
    });
    const pnlData = await pnlSample.json() as any[];
    pnlData.forEach((row, idx) => {
      console.log(`\nMarket ${idx + 1}:`);
      Object.entries(row).forEach(([k, v]) => {
        let display = v;
        if (typeof v === 'string' && v.length > 60) {
          display = v.substring(0, 57) + '...';
        }
        console.log(`  ${k.padEnd(30)} ${JSON.stringify(display)}`);
      });
    });

    // Check total resolved positions
    console.log('\n\n📊 Resolved Markets Summary:\n');
    const resolvedSummary = await client.query({
      query: `
        SELECT
          is_resolved,
          count() as positions,
          count(DISTINCT wallet) as unique_wallets,
          sum(total_pnl) as total_pnl_sum
        FROM pm_archive.pm_wallet_market_pnl_v4
        GROUP BY is_resolved
      `,
      format: 'JSONEachRow',
    });
    const resolvedData = await resolvedSummary.json() as any[];
    resolvedData.forEach(row => {
      const status = row.is_resolved === 1 ? 'RESOLVED' : 'UNRESOLVED';
      console.log(`\n${status}:`);
      console.log(`  Positions:      ${row.positions.toLocaleString()}`);
      console.log(`  Unique Wallets: ${row.unique_wallets.toLocaleString()}`);
      console.log(`  Total PnL Sum:  $${(row.total_pnl_sum / 1000000).toFixed(2)}`);
    });

    await client.close();

  } catch (error) {
    console.error('Error:', error);
    await client.close();
    process.exit(1);
  }
}

main();
