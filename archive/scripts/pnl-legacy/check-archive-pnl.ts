/**
 * Check archive table realized_pnl against UI values
 */
import { createClient } from '@clickhouse/client';

const client = createClient({
  url: 'https://ja9egedrv0.us-central1.gcp.clickhouse.cloud:8443',
  username: 'default',
  password: 'Lbr.jYtw5ikf3',
  database: 'default',
  request_timeout: 30000
});

const wallets = [
  { label: 'W1', addr: '0x9d36c904930a7d06c5403f9e16996e919f586486', expected: -6138.90 },
  { label: 'W2', addr: '0xdfe10ac1e7de4f273bae988f2fc4d42434f72838', expected: 4404.92 },
  { label: 'W3', addr: '0x418db17eaa8f25eaf2085657d0becd82462c6786', expected: 5.44 },
  { label: 'W4', addr: '0x4974d02a2e6ca79b33f6e915e98f5a8cc5237fdb', expected: -1.13 },
  { label: 'W5', addr: '0xeab03de44f98ad31ecc19cd597bcdef1c9fe42c2', expected: 146.90 },
  { label: 'W6', addr: '0x7dca4d9f31ceba9d2d5b7a723eccd5e2e7ccc48d', expected: 319.42 },
];

async function main() {
  console.log('=== Archive table with /1e6 scaling ===');
  console.log('Wallet | UI PnL      | Archive/1e6 | Error%');
  console.log('-'.repeat(55));

  for (const w of wallets) {
    const result = await client.query({
      query: `SELECT SUM(realized_pnl)/1e6 as total FROM pm_archive.pm_user_positions WHERE proxy_wallet = '${w.addr}' AND is_deleted = 0`,
      format: 'JSONEachRow'
    });
    const row = (await result.json() as any[])[0];
    const actual = row?.total || 0;
    const error = w.expected !== 0 ? Math.abs((actual - w.expected) / w.expected) * 100 : 0;
    console.log(`${w.label}     | $${w.expected.toFixed(2).padStart(9)} | $${actual.toFixed(2).padStart(9)} | ${error.toFixed(1)}%`);
  }

  await client.close();
}

main();
