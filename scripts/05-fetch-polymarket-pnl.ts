import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

const XCNSTRATEGY_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

interface PolymarketPnLResponse {
  total_pnl?: number;
  total_volume?: number;
  total_trades?: number;
  realized_pnl?: number;
  unrealized_pnl?: number;
  // Add other fields as discovered
  [key: string]: any;
}

async function fetchPolymarketPnL() {
  console.log('=== Fetching Polymarket API PnL Data ===\n');
  console.log('Wallet:', XCNSTRATEGY_WALLET);
  console.log('');

  // Polymarket has a few different endpoints we can try:
  // 1. /pnl endpoint (if it exists)
  // 2. /users/{address} endpoint (may have PnL stats)
  // 3. /positions endpoint (aggregate to calculate PnL)

  const baseUrl = 'https://clob.polymarket.com';

  // Try endpoint 1: User stats
  try {
    console.log('Attempting: GET /users endpoint...');
    const userUrl = `${baseUrl}/users/${XCNSTRATEGY_WALLET}`;
    const userResponse = await fetch(userUrl);

    if (userResponse.ok) {
      const userData = await userResponse.json();
      console.log('✓ Got user data');
      console.log('');
      console.log('User Data:');
      console.log(JSON.stringify(userData, null, 2));
      console.log('');
    } else {
      console.log(`✗ User endpoint returned ${userResponse.status}`);
    }
  } catch (error) {
    console.log('✗ User endpoint failed:', error instanceof Error ? error.message : 'Unknown error');
  }

  console.log('');

  // Try endpoint 2: Positions (for unrealized PnL)
  try {
    console.log('Attempting: GET /positions endpoint...');
    const positionsUrl = `${baseUrl}/positions?user=${XCNSTRATEGY_WALLET}`;
    const positionsResponse = await fetch(positionsUrl);

    if (positionsResponse.ok) {
      const positionsData = await positionsResponse.json();
      console.log('✓ Got positions data');
      console.log('');

      if (Array.isArray(positionsData)) {
        console.log(`Found ${positionsData.length} positions`);
        if (positionsData.length > 0) {
          console.log('Sample position:');
          console.log(JSON.stringify(positionsData[0], null, 2));
        }
      } else {
        console.log('Positions Data:');
        console.log(JSON.stringify(positionsData, null, 2));
      }
      console.log('');
    } else {
      console.log(`✗ Positions endpoint returned ${positionsResponse.status}`);
    }
  } catch (error) {
    console.log('✗ Positions endpoint failed:', error instanceof Error ? error.message : 'Unknown error');
  }

  console.log('');

  // Try endpoint 3: PnL endpoint (if exists)
  try {
    console.log('Attempting: GET /pnl endpoint...');
    const pnlUrl = `${baseUrl}/pnl/${XCNSTRATEGY_WALLET}`;
    const pnlResponse = await fetch(pnlUrl);

    if (pnlResponse.ok) {
      const pnlData = await pnlResponse.json();
      console.log('✓ Got PnL data');
      console.log('');
      console.log('PnL Data:');
      console.log(JSON.stringify(pnlData, null, 2));
      console.log('');
    } else {
      console.log(`✗ PnL endpoint returned ${pnlResponse.status}`);
    }
  } catch (error) {
    console.log('✗ PnL endpoint failed:', error instanceof Error ? error.message : 'Unknown error');
  }

  console.log('');

  // Try endpoint 4: Gamma API (alternative data source)
  try {
    console.log('Attempting: GET Gamma API...');
    const gammaUrl = `https://gamma-api.polymarket.com/users/${XCNSTRATEGY_WALLET}`;
    const gammaResponse = await fetch(gammaUrl);

    if (gammaResponse.ok) {
      const gammaData = await gammaResponse.json();
      console.log('✓ Got Gamma API data');
      console.log('');
      console.log('Gamma Data:');
      console.log(JSON.stringify(gammaData, null, 2));
      console.log('');
    } else {
      console.log(`✗ Gamma API returned ${gammaResponse.status}`);
    }
  } catch (error) {
    console.log('✗ Gamma API failed:', error instanceof Error ? error.message : 'Unknown error');
  }

  console.log('');

  // Try endpoint 5: Strapi API (profile data)
  try {
    console.log('Attempting: GET Strapi API (profile)...');
    const strapiUrl = `https://strapi-matic.poly.market/users?filters[walletAddress][$eq]=${XCNSTRATEGY_WALLET}`;
    const strapiResponse = await fetch(strapiUrl);

    if (strapiResponse.ok) {
      const strapiData = await strapiResponse.json();
      console.log('✓ Got Strapi API data');
      console.log('');
      console.log('Strapi Data:');
      console.log(JSON.stringify(strapiData, null, 2));
      console.log('');
    } else {
      console.log(`✗ Strapi API returned ${strapiResponse.status}`);
    }
  } catch (error) {
    console.log('✗ Strapi API failed:', error instanceof Error ? error.message : 'Unknown error');
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log('If none of the above endpoints returned PnL data,');
  console.log('we may need to calculate it from trades/fills data.');
  console.log('═══════════════════════════════════════════════════════');
}

fetchPolymarketPnL().catch(console.error);
