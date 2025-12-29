/**
 * Get Fresh UI PnL Values from Polymarket
 * Terminal: Claude 1
 */

const TEST_WALLETS = [
  { label: 'W2', address: '0xdfe10ac1e7de4f273bae988f2fc4d42434f72838' },
  { label: 'W1', address: '0x9d36c904930a7d06c5403f9e16996e919f586486' },
  { label: 'W3', address: '0x418db17eaa8f25eaf2085657d0becd82462c6786' },
  { label: 'W4', address: '0x4974d02a2e6ca79b33f6e915e98f5a8cc5237fdb' },
  { label: 'W5', address: '0xeab03de44f98ad31ecc19cd597bcdef1c9fe42c2' },
  { label: 'W6', address: '0x7dca4d9f31ceba9d2d5b7a723eccd5e2e7ccc48d' },
  { label: 'EGG', address: '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b' },
  { label: 'WHALE', address: '0x56687bf447db6ffa42ffe2204a05edaa20f55839' },
  { label: 'NEW', address: '0xf29bb8e0712075041e87e8605b69833ef738dd4c' },
];

async function getPnL(address: string): Promise<number | null> {
  try {
    const response = await fetch(`https://polymarket.com/profile/${address}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const html = await response.text();
    const match = html.match(/"pnl":([0-9.-]+)/);
    if (match) {
      return parseFloat(match[1]);
    }
    return null;
  } catch (e) {
    return null;
  }
}

async function main() {
  console.log('=== FRESH UI PNL VALUES ===');
  console.log('');
  console.log('Label  | Address                                    | UI PnL');
  console.log('-'.repeat(70));

  for (const w of TEST_WALLETS) {
    const pnl = await getPnL(w.address);
    const pnlStr = pnl !== null
      ? (pnl >= 0 ? '+$' : '-$') + Math.abs(pnl).toLocaleString(undefined, { maximumFractionDigits: 2 })
      : 'N/A';
    console.log(`${w.label.padEnd(7)}| ${w.address} | ${pnlStr}`);

    // Rate limit
    await new Promise(r => setTimeout(r, 500));
  }

  console.log('-'.repeat(70));
}

main().catch(console.error);
