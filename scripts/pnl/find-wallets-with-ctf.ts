/**
 * Find wallets that have BOTH CLOB trades AND CTF flows for V7 validation
 */

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: 'https://ja9egedrv0.us-central1.gcp.clickhouse.cloud:8443',
  username: 'default',
  password: 'Lbr.jYtw5ikf3',
  database: 'default',
  request_timeout: 180000
});

async function main() {
  console.log('=== FINDING WALLETS WITH BOTH CLOB AND CTF ===');
  console.log('');

  // Get wallets from V7 view that have CTF data
  const result = await client.query({
    query: `
      SELECT
        wallet,
        total_ctf_payouts,
        total_ctf_deposits,
        realized_pnl_clob,
        realized_pnl_v7,
        resolved_outcomes
      FROM vw_realized_pnl_v7_txhash
      WHERE total_ctf_payouts > 1000 OR total_ctf_deposits > 1000
      ORDER BY abs(realized_pnl_v7) DESC
      LIMIT 20
    `,
    format: 'JSONEachRow'
  });
  const data = await result.json() as any[];

  console.log('Wallets with CLOB trades AND CTF flows:');
  console.log('wallet                                       | CTF Pay      | CTF Dep      | CLOB PnL     | V7 PnL       | Resolved');
  console.log('-'.repeat(120));

  for (const row of data) {
    console.log(
      row.wallet.substring(0, 42).padEnd(42) + ' | ' +
      ('$' + Number(row.total_ctf_payouts).toLocaleString()).padStart(12) + ' | ' +
      ('$' + Number(row.total_ctf_deposits).toLocaleString()).padStart(12) + ' | ' +
      ('$' + Number(row.realized_pnl_clob).toFixed(2)).padStart(12) + ' | ' +
      ('$' + Number(row.realized_pnl_v7).toFixed(2)).padStart(12) + ' | ' +
      row.resolved_outcomes
    );
  }

  // Pick first one with meaningful CTF activity for deep validation
  if (data.length > 0) {
    const testWallet = data[0].wallet;
    console.log('');
    console.log('=== VALIDATING ' + testWallet.substring(0, 20) + '... AGAINST API ===');

    try {
      const apiResponse = await fetch(`https://data-api.polymarket.com/closed-positions?user=${testWallet}`);
      const apiPositions = await apiResponse.json() as any[];
      const apiPnl = apiPositions.reduce((sum: number, p: any) => sum + Number(p.realizedPnl || 0), 0);

      const ourPnl = Number(data[0].realized_pnl_v7);
      const variance = ourPnl - apiPnl;
      const variancePct = apiPnl !== 0 ? Math.abs(variance / apiPnl * 100) : 0;

      console.log(`API closed positions: ${apiPositions.length}`);
      console.log(`API total realizedPnl: $${apiPnl.toFixed(2)}`);
      console.log(`Our V7 PnL: $${ourPnl.toFixed(2)}`);
      console.log(`Variance: $${variance.toFixed(2)} (${variancePct.toFixed(2)}%)`);
    } catch (e) {
      console.log('API error:', (e as Error).message);
    }
  }

  await client.close();
}

main().catch(console.error);
