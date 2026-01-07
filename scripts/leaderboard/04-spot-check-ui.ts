import * as fs from 'fs';
import { chromium } from 'playwright';

const CSV_PATH = 'scripts/leaderboard/top-500-leaderboard.csv';
const COUNT = 10;

function parseCsvLine(line: string): string[] {
  // Simple CSV split (no quoted commas expected)
  return line.split(',');
}

function extractPnl(text: string): number | null {
  // Try to find Profit/Loss section
  const idx = text.indexOf('Profit/Loss');
  const snippet = idx >= 0 ? text.slice(idx, idx + 300) : text;
  // Match patterns like -$1,234.56 or $1,234.56
  const match = snippet.match(/-?\$[0-9,]+(?:\.[0-9]{2})?/);
  if (!match) return null;
  return parseFloat(match[0].replace(/[$,]/g, ''));
}

async function main() {
  if (!fs.existsSync(CSV_PATH)) {
    console.error(`CSV not found: ${CSV_PATH}`);
    process.exit(1);
  }

  const lines = fs.readFileSync(CSV_PATH, 'utf-8').trim().split('\n');
  const header = lines[0];
  const rows = lines.slice(1, COUNT + 1);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(45000);

  console.log('Spot check top 10 wallets against Polymarket UI (Profit/Loss total):');
  console.log('='.repeat(90));
  console.log('wallet, our_realized_pnl, ui_total_pnl');

  for (const row of rows) {
    const cols = parseCsvLine(row);
    const wallet = cols[0];
    const realized = parseFloat(cols[1]);

    const url = `https://polymarket.com/profile/${wallet}`;
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2000);
      const text = await page.evaluate(() => document.body.innerText);
      const uiPnl = extractPnl(text);
      const uiDisplay = uiPnl === null ? 'N/A' : uiPnl.toFixed(2);
      console.log(`${wallet}, ${realized.toFixed(2)}, ${uiDisplay}`);
    } catch (err: any) {
      console.log(`${wallet}, ${realized.toFixed(2)}, ERROR`);
    }
  }

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
