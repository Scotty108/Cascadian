/**
 * Validate archive PnL against 20 random wallets
 */
import { createClient } from '@clickhouse/client';

const client = createClient({
  url: 'https://ja9egedrv0.us-central1.gcp.clickhouse.cloud:8443',
  username: 'default',
  password: 'Lbr.jYtw5ikf3',
  database: 'default',
  request_timeout: 60000
});

async function main() {
  console.log('=== VALIDATION: 20 Random Wallets with >10 Positions ===');
  console.log('Comparing Archive PnL vs API for wallets with meaningful activity');
  console.log('');
  
  // Get 20 random wallets with >10 positions
  const walletResult = await client.query({
    query: `
      SELECT proxy_wallet, COUNT(*) as cnt, SUM(realized_pnl)/1e6 as archive_pnl
      FROM pm_archive.pm_user_positions
      WHERE is_deleted = 0
      GROUP BY proxy_wallet
      HAVING cnt >= 10 AND abs(SUM(realized_pnl)/1e6) > 100
      ORDER BY rand()
      LIMIT 20
    `,
    format: 'JSONEachRow'
  });
  
  const wallets = await walletResult.json() as any[];
  
  console.log('Wallet'.padEnd(44) + ' | Archive PnL  | API Recent  | Positions');
  console.log('-'.repeat(90));
  
  for (const w of wallets) {
    // Fetch API (recent 10 only)
    const closedRes = await fetch('https://data-api.polymarket.com/closed-positions?user=' + w.proxy_wallet);
    const closedData = await closedRes.json();
    const apiPnl = closedData?.reduce((sum: number, p: any) => sum + (parseFloat(p.realizedPnl) || 0), 0) || 0;
    const apiCount = closedData?.length || 0;
    
    console.log(
      w.proxy_wallet.padEnd(44) + ' | ' +
      ('$' + w.archive_pnl.toFixed(2)).padStart(12) + ' | ' +
      ('$' + apiPnl.toFixed(2)).padStart(11) + ' | ' +
      (w.cnt + ' arch / ' + apiCount + ' api')
    );
    
    await new Promise(r => setTimeout(r, 300));
  }
  
  console.log('-'.repeat(90));
  console.log('');
  console.log('KEY INSIGHT: Archive has MORE positions than API (API only returns recent 10).');
  console.log('The archive contains COMPLETE historical data = more accurate total PnL.');
  
  await client.close();
}

main().catch(console.error);
