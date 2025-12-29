import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { calculateV20PnL } from '../../lib/pnl/uiActivityEngineV20';

const wallets = [
  '0x94cff0a688ca7b2e5b2602343c49bcd812123db3',
  '0xd34d2111bbc4c579e3e4dbec7bc550d369dacdb4',
  '0x58d8248b1d54ce937733eb4b64fd6a2932d07a4c',
  '0x2785e7022dc20757108204b13c08cea8613b70ae',
  '0x989b67c86daa5675c2a7d0ee4107d2a38f628ef3',
  '0x2373809dadc2c73d05038df89e9399560f445b7f',
  '0x7e97bd09c2ccc632fb728d91b7c37d8ec5f34d54',
  '0xe29aaa4696b824ae186075a4a1220262f2f7612f',
  '0x40aae064996d223447e0515558b7c9d6390a9fe9',
  '0x4685b16fb6ae77a013b4b371947b080d83874de3',
];

async function main() {
  console.log('=== V20 PnL for UI Validation ===\n');
  console.log('Compare these V20 values against Polymarket UI:\n');
  console.log('Wallet                                     | V20 Total PnL    | Positions | URL');
  console.log('-------------------------------------------|------------------|-----------|----');
  
  for (const wallet of wallets) {
    try {
      const result = await calculateV20PnL(wallet);
      const pnlStr = (result.total_pnl >= 0 ? '+' : '') + '$' + result.total_pnl.toFixed(2);
      const shortWallet = wallet.slice(0,10) + '...' + wallet.slice(-4);
      console.log(shortWallet + ' | ' + pnlStr.padStart(16) + ' | ' + String(result.positions).padStart(9) + ' | polymarket.com/portfolio/' + wallet.slice(0,8) + '...');
    } catch (err: any) {
      console.log(wallet.slice(0,14) + '... | ERROR: ' + err.message.slice(0,40));
    }
  }
  
  console.log('\n\nFull URLs for manual checking:');
  wallets.forEach((w, i) => {
    console.log((i+1) + '. https://polymarket.com/portfolio/' + w);
  });
}

main().catch(console.error);
