#!/usr/bin/env npx tsx
/**
 * V2 UI PnL Scraper - Self-Validating with Tooltip Check
 *
 * This script uses Playwright MCP to properly scrape Polymarket profile PnL values.
 *
 * VALIDATION STRATEGY:
 * 1. Click the "ALL" timeframe tab
 * 2. Extract 4 fields: Profit/Loss, Positions Value, Biggest Win, Predictions
 * 3. Hover info icon and extract tooltip: Volume, Gain, Loss, Net Total
 * 4. Validate: Net Total === Profit/Loss (within tolerance)
 * 5. Flag as SCRAPE_SUSPECT if PnL equals Positions Value or Biggest Win
 *
 * This is a MANUAL script - you run it and drive Playwright via Claude.
 * The goal is to produce a clean snapshot file with validated PnL values.
 */

import fs from 'fs';

interface ScrapedWallet {
  wallet: string;
  timestamp: string;
  // From main profile card
  pnl: number | null;
  positionsValue: number | null;
  biggestWin: number | null;
  predictions: number | null;
  // From tooltip (hover info icon)
  volumeTraded: number | null;
  gain: number | null;
  loss: number | null;
  netTotal: number | null;
  // Validation
  tooltipMatch: boolean; // gain - loss ~= pnl
  scrapeSuspect: boolean; // pnl == positionsValue or biggestWin
  validatedPnl: number | null; // Final PnL after validation
  notes: string;
}

function parseMoneyValue(raw: string): number | null {
  if (!raw) return null;
  const cleaned = raw
    .replace(/[$,]/g, '')
    .replace(/−/g, '-')
    .replace(/\+/g, '')
    .trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

// The wallets to scrape
const WALLETS = [
  '0xc560678264c907a18381fd89b2e4a4e2a73b4dbc',
  '0x2c241914d4c4d881b0edd38e060fad1139b4309c',
  '0x16f6db7d6889bbe3d76dfdce2500e2b5136c29ff',
  '0x7724f6f8023f40bc9ad3e4496449f5924fa56deb',
  '0xb7e2e03432637ed6100b9427cf9eeaefbfad5bc6',
  '0xefebb9230a0ed255d59ccc0d299dcf982fd73b05',
  '0xa54e71a8c4656175183a51f98ea46015609a090e',
  '0xaee6bc1c9177217c0ab4b374a0ca8a552f8e5485',
  '0x17b4aa863bf1add299f3ece1a54a9bf19cf44d48',
  '0xf732a0c8552e3f0524652b3f51e561fd1435d078',
  '0xc05535d2c73e51c4799ee337682145f06f09909d',
  '0x97c7b6a8a6b7afcb117db5487233fe6bb759c67a',
  '0x7a3051610fed486c6f21e04a89bddaf22dfc8abd',
  '0xde182fb13123faaa1201853e880f85dce5d4bdc7',
  '0x6d2d6150d615bf56dc7ca7369107987c42bfcf06',
  '0xd2ddcdc757d0d26b5a859bb524e5fd341fa28d79',
  '0xccf9011b5d7a7ff81ee38bf8f0d96409cf6d21f6',
  '0xb947d2094e627c27377a23fba2183fd0c15ee969',
  '0xf118d0d18e1762ed3ebc212ced3bbbafe72a1f58',
  '0x3df02b8c4f7d181ab946a881a83aadb4329548f0',
  '0x83c83c902761b7674eb9e789f3c53f2a189667b3',
  '0x8eea2d8458fcad16bf50dec2b7de76e989d6e285',
  '0x20190c139a1589c871a39e7cd4e339d5a3133a66',
  '0xc56fccc7fde53bd9c90f010b9d8a7684135527ad',
  '0xf62762a2e247eec68ff67f71d55a1fc9cf7ed1aa',
  '0x2e41d5e1de9a072d73fd30eef9df55396270f050',
  '0x16180ae4e361879b7f1c9e1e3945e2cdadc2f448',
  '0x78e3e885e0924a3be4d3ac2501815b6b5fa1c585',
  '0x9c2e0423f5a36abeb7da8d2b6efd9102864917f0',
  '0x4d6d6fea2dab70681572e616e90d4b0ffefe1ba1',
  '0x80af0757eafc85e4e317c889f7ddd03f5a142269',
  '0x688beacb04b6b329f38e5da04c212e5c3d594fe1',
  '0xd05922ddd31974420f5489f4dd0009e8fba47a8b',
  '0xe41da3934d450afca1a2f1d99b97bd2f7ab4fdce',
  '0x326dab646573ac77d6ed649d15a449faabd4ec8f',
  '0xf16dc583c0b7208126531ca112b6e0ffca4b49f1',
  '0xff912dfd952fb5dc664da9e1de5577f5415b0b95',
  '0xd9a04f21526c3f277bfb19f54a01f77251468b5b',
  '0x218d506207b51a7211a86a02695113197469a420',
  '0xa6f7075f940a40a2c6cd8c75ab55a2138351b476',
];

console.log('='.repeat(80));
console.log('UI PNL SCRAPER V2 - Self-Validating');
console.log('='.repeat(80));
console.log(`\nTotal wallets to scrape: ${WALLETS.length}`);
console.log('\nThis is a MANUAL scraping guide. Use Playwright MCP tools to scrape.');
console.log('\nFor each wallet:');
console.log('1. Navigate to: https://polymarket.com/profile/{wallet}');
console.log('2. Click the "ALL" button in the P/L timeframe selector');
console.log('3. Take a snapshot to get: Profit/Loss, Positions Value, Biggest Win, Predictions');
console.log('4. Hover the info (i) icon next to Profit/Loss');
console.log('5. Take another snapshot to get tooltip: Volume, Gain, Loss, Net Total');
console.log('6. Verify: Net Total === Profit/Loss');
console.log('7. Record validated PnL\n');

console.log('--- WALLET URLs ---\n');
for (let i = 0; i < WALLETS.length; i++) {
  console.log(`${i + 1}. https://polymarket.com/profile/${WALLETS[i]}`);
}

// Helper function to validate a scraped wallet
function validateScrapedWallet(w: Partial<ScrapedWallet>): ScrapedWallet {
  const result: ScrapedWallet = {
    wallet: w.wallet || '',
    timestamp: new Date().toISOString(),
    pnl: w.pnl ?? null,
    positionsValue: w.positionsValue ?? null,
    biggestWin: w.biggestWin ?? null,
    predictions: w.predictions ?? null,
    volumeTraded: w.volumeTraded ?? null,
    gain: w.gain ?? null,
    loss: w.loss ?? null,
    netTotal: w.netTotal ?? null,
    tooltipMatch: false,
    scrapeSuspect: false,
    validatedPnl: null,
    notes: '',
  };

  // Check tooltip match: gain - loss should equal netTotal (and pnl)
  if (result.gain !== null && result.loss !== null && result.netTotal !== null) {
    const computed = result.gain - Math.abs(result.loss);
    const tolerance = Math.max(1, Math.abs(result.netTotal) * 0.01); // 1% tolerance
    result.tooltipMatch = Math.abs(computed - result.netTotal) < tolerance;

    if (!result.tooltipMatch) {
      result.notes += `Tooltip mismatch: gain(${result.gain}) - loss(${Math.abs(result.loss)}) = ${computed} vs netTotal(${result.netTotal}). `;
    }
  }

  // Check for suspect scrape: PnL equals some other field
  if (result.pnl !== null) {
    if (result.positionsValue !== null && Math.abs(result.pnl - result.positionsValue) < 1) {
      result.scrapeSuspect = true;
      result.notes += 'SUSPECT: PnL equals Positions Value. ';
    }
    if (result.biggestWin !== null && Math.abs(result.pnl - result.biggestWin) < 1) {
      result.scrapeSuspect = true;
      result.notes += 'SUSPECT: PnL equals Biggest Win. ';
    }
    if (result.volumeTraded !== null && Math.abs(result.pnl - result.volumeTraded) < 1) {
      result.scrapeSuspect = true;
      result.notes += 'SUSPECT: PnL equals Volume Traded. ';
    }
  }

  // Set validated PnL - prefer netTotal from tooltip as ground truth
  if (result.netTotal !== null && result.tooltipMatch) {
    result.validatedPnl = result.netTotal;
  } else if (result.pnl !== null && !result.scrapeSuspect) {
    result.validatedPnl = result.pnl;
  }

  return result;
}

// Export for use
export { WALLETS, ScrapedWallet, parseMoneyValue, validateScrapedWallet };
