import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

async function checkWalletAttribution() {
  const original = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
  const fixed = '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e';
  const xi_cid = 'f2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1';

  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('🔍 WALLET ATTRIBUTION CHECK');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  console.log('Checking Xi market (CID: f2ce8d3897...)\n');

  try {
    // Check raw wallet_address field
    const query = `
      SELECT
        lower(wallet_address) AS wallet_raw,
        lower(wallet_address_fixed) AS wallet_fixed,
        count() AS trades,
        sum(abs(usd_value)) AS volume
      FROM vw_trades_canonical_normed
      WHERE cid_norm = '${xi_cid}'
      GROUP BY wallet_raw, wallet_fixed
      ORDER BY trades DESC
      LIMIT 20
    `;

    const result = await clickhouse.query({ query, format: 'JSONEachRow' });
    const data = await result.json<any[]>();

    console.log(`Found ${data.length} unique wallet(s) trading Xi market:\n`);

    data.forEach((row, i) => {
      const trades = Number(row.trades);
      const volume = Number(row.volume);

      console.log(`${(i+1).toString().padStart(2)}. Raw Address:   ${row.wallet_raw}`);
      console.log(`    Fixed Address: ${row.wallet_fixed}`);
      console.log(`    Trades:        ${trades.toLocaleString()}`);
      console.log(`    Volume:        $${volume.toLocaleString()}\n`);
    });

    // Check if original appears anywhere
    console.log('═══════════════════════════════════════════════════════════════════════════════');
    console.log('WALLET PRESENCE CHECK');
    console.log('═══════════════════════════════════════════════════════════════════════════════\n');

    const originalCheck = data.find(r =>
      r.wallet_raw === original.toLowerCase() ||
      r.wallet_fixed === original.toLowerCase()
    );

    const fixedCheck = data.find(r =>
      r.wallet_raw === fixed.toLowerCase() ||
      r.wallet_fixed === fixed.toLowerCase()
    );

    console.log(`Original wallet (${original}):`);
    if (originalCheck) {
      console.log(`  ✅ Found with ${Number(originalCheck.trades).toLocaleString()} trades`);
      console.log(`     As raw: ${originalCheck.wallet_raw}`);
      console.log(`     As fixed: ${originalCheck.wallet_fixed}`);
    } else {
      console.log(`  ❌ Not found in Xi market`);
    }
    console.log('');

    console.log(`Fixed wallet (${fixed}):`);
    if (fixedCheck) {
      console.log(`  ✅ Found with ${Number(fixedCheck.trades).toLocaleString()} trades`);
      console.log(`     As raw: ${fixedCheck.wallet_raw}`);
      console.log(`     As fixed: ${fixedCheck.wallet_fixed}`);
    } else {
      console.log(`  ❌ Not found in Xi market`);
    }
    console.log('');

    // Summary
    console.log('═══════════════════════════════════════════════════════════════════════════════');
    console.log('SUMMARY');
    console.log('═══════════════════════════════════════════════════════════════════════════════\n');

    console.log('Polymarket API shows:');
    console.log(`  ${original} → $63k in Xi market`);
    console.log(`  ${fixed} → Only 2 positions (AC Milan, Amazon)\n`);

    console.log('Our Database shows:');
    console.log(`  ${original} → ${originalCheck ? Number(originalCheck.trades).toLocaleString() + ' trades' : 'ZERO trades'}`);
    console.log(`  ${fixed} → ${fixedCheck ? Number(fixedCheck.trades).toLocaleString() + ' trades' : 'ZERO trades'}\n`);

    if (!originalCheck && fixedCheck) {
      console.log('🚨 PROBLEM CONFIRMED:');
      console.log('   Trades that belong to ORIGINAL wallet are attributed to FIXED wallet.\n');
    }

  } catch (error: any) {
    console.log('❌ ERROR:', error.message);
  }
}

checkWalletAttribution().catch(console.error);
