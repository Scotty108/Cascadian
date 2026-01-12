import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getWalletPnLV2 } from '../lib/pnl/pnlEngineV2';
import { clickhouse } from '../lib/clickhouse/client';

async function test() {
  const wallet = '0x105a54a721d475a5d2faaf7902c55475758ba63c';

  // First, call the engine
  console.log('Calling getWalletPnLV2...');
  const result = await getWalletPnLV2(wallet);
  console.log('Engine result - bundled splits:', result.bundledSplitTxs);
  console.log('Engine result - PnL:', result.total);

  // Now manually check if user has any direct splits
  const checkQuery = `
    SELECT count(*) as cnt
    FROM pm_ctf_events
    WHERE event_type = 'PositionSplit'
      AND is_deleted = 0
      AND lower(user_address) = lower('${wallet}')
  `;
  const checkResult = await clickhouse.query({ query: checkQuery, format: 'JSONEachRow' });
  const rows = await checkResult.json() as any[];
  console.log('Direct splits by wallet:', rows[0].cnt);
}

test().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
