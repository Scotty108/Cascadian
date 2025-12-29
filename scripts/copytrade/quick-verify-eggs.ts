/**
 * Quick verification of egg traders - simplified
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

import { clickhouse } from '../../lib/clickhouse/client.js';

const WALLETS = [
  { wallet: '0xc5d563a36ae78145c45a50134d48a1215220f80a', label: 'Top egg #1' },
  { wallet: '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e', label: 'Top egg #2' },
  { wallet: '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b', label: '@xcnstrategy REF' },
  { wallet: '0xaee8e802e29a2dd32d6234a3d28e3bd7e2ca6eeb', label: 'Top egg #3' },
  { wallet: '0xd218e474776403a330142299f7796e8ba32eb5c9', label: 'Top egg #4' },
];

async function main() {
  console.log('=== QUICK VERIFY: EGG TRADERS ===\n');
  console.log('Wallet                                     | Label           | Total    | Taker% | Buy%  | Volume      | Verdict');
  console.log('-------------------------------------------|-----------------|----------|--------|-------|-------------|--------');

  for (const { wallet, label } of WALLETS) {
    const query = `
      SELECT
        count() as total,
        countIf(role = 'taker') as takers,
        countIf(lower(side) = 'buy') as buys,
        sum(usdc_amount) / 1000000 as volume
      FROM pm_trader_events_v2
      WHERE trader_wallet = {wallet:String}
        AND is_deleted = 0
    `;

    const result = await clickhouse.query({
      query,
      query_params: { wallet: wallet.toLowerCase() },
      format: 'JSONEachRow',
    });

    const row = (await result.json())[0] as any;
    const takerPct = (row.takers / row.total * 100);
    const buyPct = (row.buys / row.total * 100);

    // Determine verdict
    let verdict = '';
    if (takerPct > 95) verdict = '⚠️ ALL_TAKER';
    else if (takerPct < 20) verdict = '🤖 MAKER_BOT';
    else if (Math.abs(buyPct - 50) < 5) verdict = '⚖️ BALANCED';
    else if (takerPct > 40 && Math.abs(buyPct - 50) > 10) verdict = '✅ LOOKS_REAL';
    else verdict = '❓ CHECK';

    console.log(
      `${wallet} | ${label.padEnd(15)} | ${row.total.toLocaleString().padStart(8)} | ${takerPct.toFixed(0).padStart(5)}% | ${buyPct.toFixed(0).padStart(4)}% | $${Math.round(row.volume).toLocaleString().padStart(10)} | ${verdict}`
    );
  }

  console.log('\n');
  console.log('INTERPRETATION:');
  console.log('- Taker% > 95%: Unusual - either aggressive trader or API bot');
  console.log('- Taker% < 20%: Likely market maker / liquidity bot');
  console.log('- Buy% ~50%: No directional conviction (market maker pattern)');
  console.log('- Buy% far from 50% + Taker > 40%: Real trader with conviction');
}

main().catch(console.error);
