import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

const XCNSTRATEGY_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function tryPolymarketWebAPIs() {
  console.log('=== Trying Polymarket Web/Public APIs ===\n');
  console.log('Wallet:', XCNSTRATEGY_WALLET);
  console.log('');

  // Try the data API (used by polymarket.com frontend)
  const attempts = [
    {
      name: 'Data API - Profile',
      url: `https://data-api.polymarket.com/profile/${XCNSTRATEGY_WALLET}`,
    },
    {
      name: 'Data API - Stats',
      url: `https://data-api.polymarket.com/users/${XCNSTRATEGY_WALLET}/stats`,
    },
    {
      name: 'Data API - PnL',
      url: `https://data-api.polymarket.com/users/${XCNSTRATEGY_WALLET}/pnl`,
    },
    {
      name: 'Polymarket.com API - Profile',
      url: `https://polymarket.com/api/profile/${XCNSTRATEGY_WALLET}`,
    },
    {
      name: 'Polymarket.com API - User',
      url: `https://polymarket.com/api/user/${XCNSTRATEGY_WALLET}`,
    },
    {
      name: 'Polymarket.com API - Stats',
      url: `https://polymarket.com/api/stats/${XCNSTRATEGY_WALLET}`,
    },
    {
      name: 'Leaderboard API',
      url: `https://leaderboard.polymarket.com/api/user/${XCNSTRATEGY_WALLET}`,
    },
  ];

  for (const attempt of attempts) {
    try {
      console.log(`Trying: ${attempt.name}`);
      console.log(`  URL: ${attempt.url}`);

      const response = await fetch(attempt.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
          'Accept': 'application/json',
        },
      });

      if (response.ok) {
        const data = await response.json();
        console.log(`  ✓ SUCCESS (${response.status})`);
        console.log('');
        console.log('  Response:');
        console.log(JSON.stringify(data, null, 2));
        console.log('');
        console.log('═══════════════════════════════════════════════════════');
        console.log('');
      } else {
        console.log(`  ✗ Failed (${response.status})`);
      }
    } catch (error) {
      console.log(`  ✗ Error: ${error instanceof Error ? error.message : 'Unknown'}`);
    }
    console.log('');
  }

  // Also try to see if we can find it via the profile slug/username
  console.log('Note: Polymarket may require a profile slug/username instead of wallet address.');
  console.log('Checking if this wallet has a public profile...');
  console.log('');

  try {
    // Try to find profile by looking at Polymarket's public pages
    const profileSearchUrl = `https://polymarket.com/${XCNSTRATEGY_WALLET}`;
    console.log(`Trying profile URL: ${profileSearchUrl}`);

    const profileResponse = await fetch(profileSearchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      },
      redirect: 'manual',
    });

    console.log(`  Status: ${profileResponse.status}`);

    if (profileResponse.status === 301 || profileResponse.status === 302) {
      const location = profileResponse.headers.get('location');
      console.log(`  Redirected to: ${location}`);
    }
  } catch (error) {
    console.log(`  Error: ${error instanceof Error ? error.message : 'Unknown'}`);
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log('Recommendation: Check Polymarket.com directly by visiting:');
  console.log(`https://polymarket.com/${XCNSTRATEGY_WALLET}`);
  console.log('Or search for "xcnstrategy" username if that\'s their profile name.');
  console.log('═══════════════════════════════════════════════════════');
}

tryPolymarketWebAPIs().catch(console.error);
