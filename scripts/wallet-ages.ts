import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

const wallets = [
  '0xbd78a780bd24ec2244c3d848c7781f315c87d376',
  '0x63e3e2bd72ce83336104c25d91757a1280c27d85',
  '0xaf0e8d81903a627056a60f291fe4db6a596322d5',
  '0xc30f6390d6fb95c41c1c6c20e3c37b985aa22e65',
  '0xd2020940c4b8a45c6e4a4a52b00fedc98585964d',
  '0x2938916bc4009581677a9451fe3ac30d811bf251',
  '0x552000e88ae1283034d56b5966f51055783332ff',
  '0x2b2866a724e73bf45af306036f12f20170b4d021',
  '0xfd4263b3ad08226034fe1b1ea678a46d80b58895',
  '0xfbd42fd52d8ae47785356e05dfc966a341f6efec',
  '0xf9442951035b143f3b5a30bb4fa1f4f6b908c249',
  '0x9e1f86ef27beb047edc91d97e260c4da210df3c4',
  '0xb3e6f092d890fd935ee2e18595aaad8af7fb3218',
  '0x0f969283107e288aa5a00d913c36d8dc3389e6a2',
];

async function main() {
  const walletList = wallets.map(w => "'" + w + "'").join(',');
  const query = `
    SELECT
      trader_wallet,
      min(trade_time) as first_trade,
      max(trade_time) as last_trade,
      dateDiff('day', min(trade_time), now()) as age_days,
      dateDiff('day', min(trade_time), max(trade_time)) as active_days
    FROM pm_trader_events_v2
    WHERE trader_wallet IN (${walletList})
      AND is_deleted = 0
    GROUP BY trader_wallet
    ORDER BY age_days DESC
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows: any[] = await result.json();

  console.log('| Wallet | First Trade | Age (days) | Last Trade | Active Days |');
  console.log('|--------|-------------|------------|------------|-------------|');
  for (const r of rows) {
    const wallet = r.trader_wallet.slice(0,6) + '...' + r.trader_wallet.slice(-4);
    const firstDate = r.first_trade.split('T')[0];
    const lastDate = r.last_trade.split('T')[0];
    console.log(`| ${wallet} | ${firstDate} | ${r.age_days} | ${lastDate} | ${r.active_days} |`);
  }

  console.log('\n--- CSV ---');
  console.log('wallet,first_trade,age_days,last_trade,active_days');
  for (const r of rows) {
    console.log(`${r.trader_wallet},${r.first_trade.split('T')[0]},${r.age_days},${r.last_trade.split('T')[0]},${r.active_days}`);
  }
}

main().catch(console.error);
