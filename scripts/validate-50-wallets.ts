import { config } from 'dotenv';
config({ path: '/Users/scotty/Projects/Cascadian-app/.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

const apiPnl: Record<string, number> = {
  "0x478ed30948dfed196edffe907747d76997fc324d": -2369.193,
  "0xce58632cad44ea6d4e1e75a66ac2d8073159c6e5": -1.002739,
  "0x2638e06e0b713249703e62d57f13cc3d0a472ca8": -14498.667,
  "0xe3363e7bd77c5b2434b420cd92f2a503ad7cbcac": -2243.3647,
  "0x8f5b37ff834896210e9cd3d945f0c1291e901008": -164.2407,
  "0x7a254d767f65a0f45768b7ed35ca4d272a9d48bc": 125.33271,
  "0x27fe993ddb2a92235275914b12f182d4fdd064f6": 150.81245,
  "0x26b26ac3b434b12ee2d5a3310b2f62ce38164486": -8173.0356,
  "0x3c202e4e962acb5c775092d085cc88d7861f6120": -307.26987,
  "0x544bef5aff9f68a8a208e7c5b83b2c608e5ec0a1": -69.712006,
  "0x6eb0691308f625403c266abea60be6b59a15a15c": -724.2257,
  "0x4ef829c724ebe34c7f5ed9265edd3877fd278712": -1288.4288,
  "0x852e814a1f3fce04a95ac91c27da4b6622328bf9": -263.43393,
  "0x48ebee39aa56b2e96e6c7b98bc0e5ad6bd584add": -107.213486,
  "0x6beeec0494ed4ac8056c2de22dc437d87a99b5a7": -41.418114,
  "0x565a341a801500589db83b0378445129982037f3": -512.5,
  "0x24f9680e6377828522c9e1eb9835d2dc4ea9deae": 128.05473,
  "0xe2801398beb25877219a5833d1989c25ec24e50d": 16.741217,
  "0x4c4ba4f11176bc70e5d628f8ca250913b8f7e3ba": 74.5705,
  "0x2e6da6012a1aaad3120b64d435cb6060d2a92064": 2.584095,
  "0xac80a550c6e32a579943062980b9e56282494ff5": -87.517006,
  "0x94fc4bd1d16df3ec7d4ea26c0d7d3f7ee42ae11f": -205.03261,
  "0x4ad5e4070f17a32916e633b137e49d11bde708e3": -1195.8914,
  "0x4c4a21497dc0e05babcc638d917e17f917546a0c": 3.039014,
  "0x14bf154c1ebbb6a096ee1604a03c991151a6e3a6": -919.431,
  "0x1651695d9d667c5a8960cab700577d2a05da2f16": -462.39044,
  "0x675944713d94c752d614b09d225a34109efb370b": -14.338926,
  "0x8d090d80c30e2dcb29c9675da8d76b1aac075124": -7.365326,
  "0x45b81f3a99eab92fc7a563c08e04934809533c28": -662.14355,
  "0x5628f7292f5b633a9a0d2d6891d62fb5945f84fa": -98.8725,
  "0xe5e4c14876ee86b47363701a48e7495c43e5fce3": 2.205797,
  "0x624e22990e11c3afd9c21d945e8706436670b1a5": -482.44275,
  "0xa4d423e3bacd82c9e98ab3838262d977de29ef77": -272.20312,
  "0x934447585826f9f8b470c38f3f7e5e6e925fe345": -89.556915,
  "0xae6af94f433f2c5e8f897cd1994c86aef8ebbd03": -38.06168,
  "0xf495abe1dab8a86ea1604f999a7dc19ee2df9bc6": -3.991,
  "0x5874b678b602b76dfda09d68eb585f70adc41474": -21.684898,
  "0x69d05fc53805138650539bbb305dd948e3731a0d": 22.014938,
  "0xa91fc31aa37f9ac5ef2dc6fbc5d033b0d9499541": 5.546267,
  "0xe26cdbd2497e4cdbdcbde391595be790ab080b5f": -24.894037,
  "0x0b8a03ef9d297ba2d054f4e53f6447be9d4719f3": 1033.4347,
  "0x02f61c1b6beaf078bf25bc6c3796f1917bb48cf2": -36.861103,
  "0x0c65840880163c0fd8b4bb4696077be3b4dad60d": -3982.129,
  "0x90954591305e2882d0d2379daa733add13512f3f": -3467.624,
  "0xf758fb88227c8848734337b0400b872b4835b0f2": 5.226747,
  "0x4fccd0c3c8691bc4d43a7a69989003d7800418e7": 12.684491,
  "0x9fd1213816a149740ee25f763ab1858b3308b42b": 255.93889,
  "0xb5b2724ba1bb54625c3d4e69de5092459d6217eb": -421.0262,
  "0xa9baf65b5964d8217141612736269b703db975ec": 184.08417,
  "0xb4bc17b234f62d86c9ff50e2fac98068c878ae51": -55.51843
};

async function getClobPnl(wallet: string): Promise<number> {
  const query = `
    WITH
      wt AS (SELECT transaction_hash, token_id, side, role, usdc_amount/1e6 AS usdc, token_amount/1e6 AS tokens, fee_amount/1e6 AS fee FROM pm_trader_events_v3 WHERE lower(trader_wallet) = '${wallet}'),
      sf AS (SELECT transaction_hash FROM wt GROUP BY transaction_hash HAVING countIf(role='maker')>0 AND countIf(role='taker')>0),
      cc AS (SELECT m.condition_id, m.outcome_index, side, (usdc + if(side='buy', fee, -fee)) AS usdc_net, tokens FROM wt t JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec WHERE m.condition_id != '' AND (transaction_hash NOT IN (SELECT transaction_hash FROM sf) OR role='taker')),
      pos AS (SELECT condition_id, outcome_index, sumIf(tokens, side='buy') - sumIf(tokens, side='sell') AS net_tokens, sumIf(usdc_net, side='sell') - sumIf(usdc_net, side='buy') AS cash_flow FROM cc GROUP BY condition_id, outcome_index),
      wr AS (SELECT p.*, toInt64OrNull(JSONExtractString(r.payout_numerators, p.outcome_index + 1)) = 1 AS won FROM pos p LEFT JOIN pm_condition_resolutions r ON p.condition_id = r.condition_id AND r.is_deleted = 0)
    SELECT round(sum(cash_flow) + sumIf(net_tokens, net_tokens > 0 AND won) - sumIf(-net_tokens, net_tokens < 0 AND won), 2) AS pnl FROM wr
  `;
  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as any[];
  return Number(rows[0]?.pnl) || 0;
}

async function main() {
  const wallets = Object.keys(apiPnl);
  let passed = 0;
  let failed = 0;
  const results: Array<{wallet: string, api: number, clob: number, diff: number, status: string}> = [];

  console.log('Running validation on 50 wallets...\n');

  for (let i = 0; i < wallets.length; i++) {
    const w = wallets[i];
    const clob = await getClobPnl(w);
    const api = apiPnl[w];
    const diff = Math.abs(clob - api);
    const status = diff < 1 ? 'PASS' : 'FAIL';
    if (diff < 1) passed++; else failed++;
    results.push({ wallet: w, api, clob, diff, status });
    process.stdout.write(`\rProcessed ${i + 1}/50...`);
  }

  console.log('\n\nWallet                                     | API PnL      | CLOB PnL     | Diff       | Status');
  console.log('-------------------------------------------|--------------|--------------|------------|-------');
  for (const r of results) {
    const apiStr = r.api.toFixed(2).padStart(12);
    const clobStr = r.clob.toFixed(2).padStart(12);
    const diffStr = r.diff.toFixed(2).padStart(10);
    console.log(`${r.wallet} | ${apiStr} | ${clobStr} | ${diffStr} | ${r.status}`);
  }

  console.log('\n---');
  console.log(`Passed: ${passed}/50 (${Math.round(passed/50*100)}%)`);
  console.log(`Failed: ${failed}/50`);

  // Show failed wallets breakdown
  const failedResults = results.filter(r => r.status === 'FAIL');
  if (failedResults.length > 0) {
    console.log('\nFailed wallets (diff > $1):');
    for (const r of failedResults) {
      console.log(`  ${r.wallet}: diff $${r.diff.toFixed(2)}`);
    }
  }

  // Client cleanup handled by lib
}

main().catch(console.error);
