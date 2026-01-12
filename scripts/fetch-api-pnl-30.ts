import { config } from 'dotenv';
config({ path: '.env.local' });

const wallets = [
  '0x0554c046fa6fa1022d753344d13cfa3025221880',
  '0x1505d852a5bd6d07dc17d57109888d265529cb1c',
  '0x1666b9db2b0568e62875d6cfa38fb20220169882',
  '0x176c4b78b387f744ce0baee0a498f2ec616a089e',
  '0x1e2952379c87882994d5f8a1add9866a34cf5bae',
  '0x264f6da594a36e34ba960e05f85d843220280fe0',
  '0x27516e61ed1861fb1cf8bea1b9b451ce921cdada',
  '0x2c1895ed74628fb2213c388a22f3614ef6ac0abb',
  '0x2f24f9041fffd2ceb853a92d48aa8c0fd7db2754',
  '0x3682d7b7ba5a62b1db37d5a7bbd2f8386f805065',
  '0x3e12d8b40bb6343800db4347443eb82bb892dd1d',
  '0x3ee1e1bf8bbf5f753af8b99a1ebccf51a0b2804e',
  '0x45d136f57f9ee90b5d8cafc42369e8825dbe2854',
  '0x468772b53965262f55a880e31f5bb0895385ef4e',
  '0x4cb22b430a8f72b865f86243a27dc71039774954',
  '0x5e71e6643200d2e0fef5584c61834c8b473a2aea',
  '0x6573ac61af5670d090343c515f67a585456bab02',
  '0x7c4e46e140f3fd458b454e772a6d684bd1c75b7c',
  '0x81e9f0db5df4e88cac1e475d938835ada449b3d5',
  '0x83f8a188d364eb99e9bdd141ce5060faf07a7cb2',
  '0x8dc70e065b6002ab36690694ed0ed688f4c9a21e',
  '0x9437594b4b59caed830dcce2cb0843a2ad1114d2',
  '0xb1c5ab5ef1eb558bbd657b4b630b59140732d9e1',
  '0xbef57f98b8f451c8f1637d84dc50cae79afac761',
  '0xd0baf2404e9e548e90f7b32cd49ab6c10397ee0e',
  '0xdfea29367f42621b5b6da2faa9243458fa90760a',
  '0xe97e488d99dfa580b2b6e6550bec13c9a5c0a368',
  '0xeba7cd7e39c2a882f18f194050179a25302e85b9',
  '0xf6f9c3b1a2b7d2a80f1afac7f973bde35f0b0007',
  '0xfc1c7159c51dc9c8f781f3d762fbf0dec1079b59'
];

// Calculated PnL from our query
const calculated: Record<string, number> = {
  '0x0554c046fa6fa1022d753344d13cfa3025221880': -560.85,
  '0x1505d852a5bd6d07dc17d57109888d265529cb1c': -113.02,
  '0x1666b9db2b0568e62875d6cfa38fb20220169882': 161.88,
  '0x176c4b78b387f744ce0baee0a498f2ec616a089e': -120.24,
  '0x1e2952379c87882994d5f8a1add9866a34cf5bae': -159.1,
  '0x264f6da594a36e34ba960e05f85d843220280fe0': 84.79,
  '0x27516e61ed1861fb1cf8bea1b9b451ce921cdada': 19.67,
  '0x2c1895ed74628fb2213c388a22f3614ef6ac0abb': 3803.48,
  '0x2f24f9041fffd2ceb853a92d48aa8c0fd7db2754': 44.79,
  '0x3682d7b7ba5a62b1db37d5a7bbd2f8386f805065': -98.36,
  '0x3e12d8b40bb6343800db4347443eb82bb892dd1d': 21.16,
  '0x3ee1e1bf8bbf5f753af8b99a1ebccf51a0b2804e': 289.7,
  '0x45d136f57f9ee90b5d8cafc42369e8825dbe2854': 20.49,
  '0x468772b53965262f55a880e31f5bb0895385ef4e': -797.64,
  '0x4cb22b430a8f72b865f86243a27dc71039774954': -8.06,
  '0x5e71e6643200d2e0fef5584c61834c8b473a2aea': 25.55,
  '0x6573ac61af5670d090343c515f67a585456bab02': -1288.76,
  '0x7c4e46e140f3fd458b454e772a6d684bd1c75b7c': 2642.1,
  '0x81e9f0db5df4e88cac1e475d938835ada449b3d5': -42.5,
  '0x83f8a188d364eb99e9bdd141ce5060faf07a7cb2': 1.55,
  '0x8dc70e065b6002ab36690694ed0ed688f4c9a21e': -0.91,
  '0x9437594b4b59caed830dcce2cb0843a2ad1114d2': -1170.84,
  '0xb1c5ab5ef1eb558bbd657b4b630b59140732d9e1': -58.03,
  '0xbef57f98b8f451c8f1637d84dc50cae79afac761': -12511.97,
  '0xd0baf2404e9e548e90f7b32cd49ab6c10397ee0e': 1424.12,
  '0xdfea29367f42621b5b6da2faa9243458fa90760a': -6.1,
  '0xe97e488d99dfa580b2b6e6550bec13c9a5c0a368': -3.16,
  '0xeba7cd7e39c2a882f18f194050179a25302e85b9': 14529.78,
  '0xf6f9c3b1a2b7d2a80f1afac7f973bde35f0b0007': 1864.58,
  '0xfc1c7159c51dc9c8f781f3d762fbf0dec1079b59': 326.84
};

async function getApiPnL(wallet: string): Promise<number> {
  try {
    const res = await fetch(`https://user-pnl-api.polymarket.com/user-pnl?user_address=${wallet}`);
    if (res.ok) {
      const data = await res.json() as Array<{ t: number; p: number }>;
      if (data && data.length > 0) {
        return data[data.length - 1].p || 0;
      }
    }
  } catch {
    // API failed
  }
  return 0;
}

async function main() {
  console.log('='.repeat(80));
  console.log('30-Wallet Pilot: Calculated vs API PnL');
  console.log('='.repeat(80));
  console.log('');

  const results: Array<{
    wallet: string;
    calc: number;
    api: number;
    error: number;
    withinTen: boolean;
  }> = [];

  for (const wallet of wallets) {
    process.stdout.write(`${wallet.slice(0, 10)}... `);
    const apiPnl = await getApiPnL(wallet);
    const calcPnl = calculated[wallet] || 0;
    const error = calcPnl - apiPnl;
    const withinTen = Math.abs(error) <= 10;

    results.push({ wallet, calc: calcPnl, api: apiPnl, error, withinTen });
    console.log(
      `Calc: ${calcPnl.toFixed(2).padStart(12)} | ` +
      `API: ${apiPnl.toFixed(2).padStart(12)} | ` +
      `Error: ${error.toFixed(2).padStart(12)} | ` +
      `${withinTen ? '✓' : '✗'}`
    );

    await new Promise(r => setTimeout(r, 100));
  }

  console.log('');
  console.log('='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));

  const withinTen = results.filter(r => r.withinTen).length;
  const withinHundred = results.filter(r => Math.abs(r.error) <= 100).length;
  const withinThousand = results.filter(r => Math.abs(r.error) <= 1000).length;

  console.log(`Within $10:   ${withinTen}/${results.length} (${(100 * withinTen / results.length).toFixed(0)}%)`);
  console.log(`Within $100:  ${withinHundred}/${results.length} (${(100 * withinHundred / results.length).toFixed(0)}%)`);
  console.log(`Within $1000: ${withinThousand}/${results.length} (${(100 * withinThousand / results.length).toFixed(0)}%)`);

  // Show worst errors
  const sorted = [...results].sort((a, b) => Math.abs(b.error) - Math.abs(a.error));
  console.log('\nTop 10 worst errors:');
  for (const r of sorted.slice(0, 10)) {
    console.log(`  ${r.wallet.slice(0, 10)}... error: ${r.error.toFixed(2)}`);
  }
}

main().catch(console.error);
