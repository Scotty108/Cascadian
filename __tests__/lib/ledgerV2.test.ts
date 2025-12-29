import { describe, expect, it } from '@jest/globals';
import { config } from 'dotenv';

import { computeLedgerV2Pnl, redeemedTokensFromPayout } from '@/lib/pnl/ledgerV2';

config({ path: '.env.local' });

describe('ledgerV2 helpers', () => {
  it('converts redemption payouts to tokens using resolution price', () => {
    expect(redeemedTokensFromPayout(100, 1)).toBe(100);
    expect(redeemedTokensFromPayout(100, 0.5)).toBe(200);
    expect(redeemedTokensFromPayout(100, 0)).toBe(0);
    expect(redeemedTokensFromPayout(100, null)).toBe(0);
    expect(redeemedTokensFromPayout(100, undefined)).toBe(0);
  });
});

describe('ledgerV2 integration', () => {
  const hasClickhouse = Boolean(process.env.CLICKHOUSE_HOST && process.env.CLICKHOUSE_PASSWORD);
  const itIf = hasClickhouse ? it : it.skip;

  itIf('calibration wallet matches cash parity (~-$86)', async () => {
    const wallet = '0x925ad88d18dbc7bfeff3b71db7b96ed4bb572c2e';
    const result = await computeLedgerV2Pnl(wallet);
    // Allow a small tolerance due to data drift.
    expect(result.realizedPnl).toBeLessThan(-75);
    expect(result.realizedPnl).toBeGreaterThan(-100);
  }, 120000);
});
