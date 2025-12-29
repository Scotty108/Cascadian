import { calculateV23cPnL } from '../../lib/pnl/shadowLedgerV23c';

// The wallet that previously returned $0 because of missing metadata
const TARGET_WALLET = '0xdcd7007b1a0b1e118684c47f6aaf8ba1b032a2d2';
const EXPECTED_UI_PNL = -293.91; // From Polymarket UI

async function main() {
  console.log(`Testing Wallet: ${TARGET_WALLET}`);

  // Run V23c (The Canonical Engine)
  const result = await calculateV23cPnL(TARGET_WALLET, { useUIOracle: true });

  if (!result) {
    console.log('❌ FAILED: Engine returned null/undefined');
    return;
  }

  console.log('---------------------------------------------------');
  console.log(`Calculated PnL: ${result.totalPnl.toFixed(2)}`);
  console.log(`Expected (UI):  ${EXPECTED_UI_PNL.toFixed(2)}`);
  console.log('---------------------------------------------------');

  if (Math.abs(result.totalPnl) < 1.0) {
    console.log('❌ FAIL: Still returning ~$0. Data ingestion didn\'t reach this wallet.');
  } else {
    console.log('✅ PASS: We have data! The freeze is fixed.');
  }
}

main().catch(console.error);
