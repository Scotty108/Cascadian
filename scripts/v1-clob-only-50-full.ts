/**
 * V1 CLOB-Only 50 Wallet Full Report
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getWalletPnLV1 } from '../lib/pnl/pnlEngineV1';

const CLOB_ONLY_WALLETS = [
  '0xa975950714a5d33e56efcc4c64065c08c48afdfd',
  '0x6d1dac1a63ae38b7da0fae77d2d64466a28e2cad',
  '0x487046bcc0002755a5675b423709ffd105984e9a',
  '0xc42b6f2ab7e1318e8bf652f05b54674a48ebddd6',
  '0x67ea7f82e968b4dc80862d833ca40f6e6fdb0715',
  '0x608c841e84de44eb0c63e447a3f4654bce67aac7',
  '0x52f3e07e1f4c3b253916338fd5857936fcb4b4b4',
  '0x6f541b0eed98d3d65e00ef67d51c58cd4a744b5d',
  '0xa808b8060c72c37f0a3e4f631ff0fdb0c3ab7dac',
  '0xf73c1ea91cd0c58a4e3edd5b248475c2db41f857',
  '0x0c7e6d4df16e18adf4579cb4d58b5fc08f545c87',
  '0x411df39bca6990e4f0bd2a09c41a710acc0fbf7a',
  '0xd4eebfcad6b368df43cfe6493ec4fb9cf69b6470',
  '0xfe5967af0d7a8c1f23d8169e59ea8ddb54eeb733',
  '0xc7bdf24419499fab77ce71842a6df616b48f60dd',
  '0x7c34dd026cff35328cc9b20b4ddacbf23cdb1bde',
  '0xb149c6383dcb8b4a1aa497d2fc3d8c72b8dacb27',
  '0x477875ea527a046ea95babce657ac6e3bece87f3',
  '0xf1b65aadbbd712989b5146fd3a4d2ec5be66882b',
  '0x23b8aff765a777200200d22317eb4d5f7322c62d',
  '0xfa9ceb619195461d4b339688da42cb12db926e6f',
  '0xd1b9b82620134e7d52466e71b64b0b72736ec238',
  '0xc1d628d865fe761e4e406b913c2cee568ac48b22',
  '0x19f8f439f96eab14dc1b373cb4f674abcae408a5',
  '0xcb9b2314544ce3ed42dbdd325484a4cf582d044a',
  '0x25cdaf029601d935dd5733cb1c5dcf7742b4eadc',
  '0x96139ae57c3151addaca97b9f1d3ecbb4aa740f8',
  '0x96c1ea25763b3ddbf14c27f1cfd055d64f9f7037',
  '0x99549975dade1d21436beb58c81fd6ea68a28aa1',
  '0x35338dcdfe2c6385f29e3a4782d61ac338fb5cc8',
  '0x261a4eb3fafb6d009c54bd0b6e16aa7392c1fad0',
  '0x734436838ab1bad8d97ad780d5037a6b78034da2',
  '0xb883e78b4a1a7010783663c36d5ffcf8ebab331e',
  '0x13121f36f3aaabd3142ce719cf7454b35ebcbc0b',
  '0x5de1f827b83a36e3b726e548b3173667bb040b3f',
  '0x42f63fb7b9423b3284e3fd85ea248cad8fcc3228',
  '0x4808f0e1ce1dd1f46e931b8d7212d1b05d7215d6',
  '0x5a914f3aea097ce2731f3366170bdf88aea74173',
  '0x5da30b12ff8cd62f8b36295e60d98ea0143d85d1',
  '0x9bc249e2c4fde51233a51fa0d0e553a1ba0c32e8',
  '0xa1137ecd14a5f3e2bc59ad0b705223d436dce375',
  '0xa207a6355d155d6ecd98ff244579a560b3019471',
  '0xa84ce2cfa212cb8aa66cf0dbc51e7be8a32a323d',
  '0xa47dcfa6e90817028d276a4f764f187818bc67ed',
  '0x2d19b5ea815f28ddd3d36b787db38039f11aaaca',
  '0x5c31d722ea7b1520b1c3f6dae84e1093e24cce03',
  '0x09ed10b7b4bf6fa713924306778ff790d7e2aef9',
  '0xba90e16f29f821eb355f9902b23ad45f5c5fc0d1',
  '0x5a2f38f65070b937e247a9dd5ba3ce95ea3f0faf',
  '0x8b485ec589b98b7e93f636876d3b2e9ce2fdfc04',
];

async function fetchPM(wallet: string): Promise<number | null> {
  try {
    const res = await fetch(`https://user-pnl-api.polymarket.com/user-pnl?user_address=${wallet}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) {
      return data[data.length - 1].p;
    }
    return null;
  } catch { return null; }
}

function fmt(val: number): string {
  const abs = Math.abs(val);
  if (abs >= 1e6) return `$${(val / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(val / 1e3).toFixed(1)}K`;
  return `$${val.toFixed(0)}`;
}

async function main() {
  console.log('V1 CLOB-Only Full Report\n');
  console.log('Wallet'.padEnd(44) + '│' + 'Polymarket'.padStart(12) + '│' + 'V1'.padStart(12) + '│' + 'Error%'.padStart(8) + '│' + 'Status');
  console.log('─'.repeat(90));

  const results: Array<{wallet: string, pm: number, v1: number, pct: number}> = [];

  for (const wallet of CLOB_ONLY_WALLETS) {
    const pm = await fetchPM(wallet);
    if (pm === null) {
      console.log(wallet.padEnd(44) + '│' + 'N/A'.padStart(12) + '│');
      continue;
    }

    let v1: number | null = null;
    try {
      const result = await getWalletPnLV1(wallet);
      v1 = result.total;
    } catch {
      console.log(wallet.padEnd(44) + '│' + fmt(pm).padStart(12) + '│' + 'ERROR'.padStart(12));
      continue;
    }

    const absErr = Math.abs(v1 - pm);
    const pctErr = pm !== 0 ? (absErr / Math.abs(pm)) * 100 : (v1 === 0 ? 0 : 100);
    const threshold = Math.max(100, Math.abs(pm) * 0.10);
    const isAccurate = absErr < threshold;

    results.push({ wallet, pm, v1, pct: pctErr });

    console.log(
      wallet.padEnd(44) + '│' +
      fmt(pm).padStart(12) + '│' +
      fmt(v1).padStart(12) + '│' +
      `${pctErr.toFixed(1)}%`.padStart(8) + '│' +
      (isAccurate ? ' ✓' : ' ✗')
    );

    await new Promise(r => setTimeout(r, 50));
  }

  // Summary stats
  const sorted = results.sort((a, b) => a.pct - b.pct);
  const accurate = sorted.filter(r => {
    const threshold = Math.max(100, Math.abs(r.pm) * 0.10);
    return Math.abs(r.v1 - r.pm) < threshold;
  });

  console.log('\n' + '═'.repeat(90));
  console.log('SUMMARY');
  console.log('═'.repeat(90));
  console.log(`Accuracy: ${accurate.length}/${sorted.length} (${(accurate.length/sorted.length*100).toFixed(0)}%)`);
  console.log(`\nError Distribution:`);
  console.log(`  <1%:   ${sorted.filter(r => r.pct < 1).length}`);
  console.log(`  1-5%:  ${sorted.filter(r => r.pct >= 1 && r.pct < 5).length}`);
  console.log(`  5-10%: ${sorted.filter(r => r.pct >= 5 && r.pct < 10).length}`);
  console.log(`  >10%:  ${sorted.filter(r => r.pct >= 10).length}`);
}

main().catch(console.error);
