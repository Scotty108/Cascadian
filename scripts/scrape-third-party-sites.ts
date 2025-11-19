#!/usr/bin/env npx tsx
/**
 * Browser-based scraper: Visit third-party sites and capture their API calls
 * This will reveal how they're getting resolution data
 */

import { chromium } from 'playwright';

const TEST_WALLET = '0x4ce73141dbfce41e65db3723e31059a730f0abad';

interface CapturedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  postData?: string;
  response?: {
    status: number;
    headers: Record<string, string>;
    body?: string;
  };
}

async function scrapeSite(siteName: string, url: string): Promise<CapturedRequest[]> {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`SCRAPING: ${siteName}`);
  console.log(`URL: ${url}`);
  console.log('='.repeat(80));
  
  const capturedRequests: CapturedRequest[] = [];
  
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  // Capture all network requests
  page.on('request', (request) => {
    const url = request.url();
    if (url.includes('api') || url.includes('graphql') || url.includes('polymarket')) {
      console.log(`  📡 Request: ${request.method()} ${url}`);
      capturedRequests.push({
        url,
        method: request.method(),
        headers: request.headers(),
        postData: request.postData() || undefined,
      });
    }
  });
  
  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('api') || url.includes('graphql') || url.includes('polymarket')) {
      console.log(`  📥 Response: ${response.status()} ${url}`);
      
      // Try to capture response body
      try {
        const contentType = response.headers()['content-type'] || '';
        if (contentType.includes('json')) {
          const body = await response.text();
          console.log(`    Body preview: ${body.substring(0, 200)}...`);
          
          // Find matching request
          const req = capturedRequests.find(r => r.url === url && !r.response);
          if (req) {
            req.response = {
              status: response.status(),
              headers: response.headers(),
              body: body.substring(0, 5000), // Limit to 5KB
            };
          }
        }
      } catch (e) {
        // Response body might not be available
      }
    }
  });
  
  try {
    console.log(`\n  🌐 Navigating to ${url}...`);
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    
    console.log(`  ✅ Page loaded`);
    
    // Wait a bit for any lazy-loaded content
    await page.waitForTimeout(3000);
    
    // Try to capture page content
    const title = await page.title();
    console.log(`  📄 Page title: ${title}`);
    
    // Try to find P&L data in the page
    const pageText = await page.content();
    if (pageText.includes('332') || pageText.includes('pnl') || pageText.includes('P&L')) {
      console.log(`  💰 Page appears to contain P&L data!`);
    }
    
  } catch (error: any) {
    console.log(`  ❌ Error: ${error.message}`);
  } finally {
    await browser.close();
  }
  
  return capturedRequests;
}

async function main() {
  console.log('\n╔════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║  BROWSER-BASED API DISCOVERY: Finding Resolution Data Sources                 ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════╝');
  console.log(`\nTarget wallet: ${TEST_WALLET}`);
  
  const sites = [
    {
      name: 'Polymarket Analytics',
      url: `https://polymarketanalytics.com/wallet/${TEST_WALLET}`,
    },
    {
      name: 'HashDive',
      url: `https://hashdive.com/wallet/${TEST_WALLET}`,
    },
    {
      name: 'Polysites',
      url: `https://polysites.xyz/wallet/${TEST_WALLET}`,
    },
  ];
  
  const allRequests: Record<string, CapturedRequest[]> = {};
  
  for (const site of sites) {
    try {
      const requests = await scrapeSite(site.name, site.url);
      allRequests[site.name] = requests;
    } catch (error: any) {
      console.log(`\n❌ Failed to scrape ${site.name}: ${error.message}`);
    }
  }
  
  // Summary
  console.log(`\n\n${'='.repeat(80)}`);
  console.log('CAPTURED API CALLS SUMMARY');
  console.log('='.repeat(80));
  
  for (const [siteName, requests] of Object.entries(allRequests)) {
    console.log(`\n${siteName}:`);
    if (requests.length === 0) {
      console.log(`  ❌ No API calls captured`);
    } else {
      console.log(`  ✅ Captured ${requests.length} API calls:`);
      requests.forEach((req, i) => {
        console.log(`\n  ${i + 1}. ${req.method} ${req.url}`);
        if (req.postData) {
          console.log(`     POST data: ${req.postData.substring(0, 200)}`);
        }
        if (req.response) {
          console.log(`     Response ${req.response.status}: ${req.response.body?.substring(0, 200)}...`);
        }
      });
    }
  }
  
  console.log(`\n\n${'='.repeat(80)}`);
  console.log('ACTIONABLE FINDINGS');
  console.log('='.repeat(80));
  
  let foundUsefulApis = false;
  for (const [siteName, requests] of Object.entries(allRequests)) {
    const apiRequests = requests.filter(r => 
      r.url.includes('api') && 
      r.response &&
      r.response.body &&
      (r.response.body.includes('pnl') || r.response.body.includes('condition'))
    );
    
    if (apiRequests.length > 0) {
      console.log(`\n✅ ${siteName} makes ${apiRequests.length} useful API call(s):`);
      apiRequests.forEach(req => {
        console.log(`  - ${req.url}`);
        console.log(`    We can replicate this API call to get resolution data!`);
      });
      foundUsefulApis = true;
    }
  }
  
  if (!foundUsefulApis) {
    console.log(`\n❌ No useful API calls found.`);
    console.log(`\nPossible reasons:`);
    console.log(`  1. Sites are client-side rendered and compute P&L from the same sources we have`);
    console.log(`  2. They're showing UNREALIZED P&L (current midprices) not SETTLED P&L`);
    console.log(`  3. URLs are wrong or sites require different access patterns`);
    console.log(`  4. They use WebSockets or other protocols we didn't capture`);
  }
}

main().catch((err) => {
  console.error('\n❌ ERROR:', err);
  process.exit(1);
});
