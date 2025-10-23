# Finding Real Polymarket Wallet Addresses

## Why We Need Real Addresses

To test and populate our wallet analytics features, we need **real, active Polymarket wallet addresses**. The Data-API will return empty arrays for inactive addresses.

## Methods to Find Addresses

### Method 1: Browser DevTools (Easiest)

1. **Go to Polymarket.com**
   ```
   https://polymarket.com
   ```

2. **Open Developer Tools**
   - Chrome/Edge: Press `F12` or `Cmd+Option+I` (Mac)
   - Firefox: Press `F12` or `Cmd+Option+I` (Mac)

3. **Go to Network Tab**
   - Click "Network" tab in DevTools
   - Clear existing requests (trash icon)

4. **Navigate to a Popular Market**
   - Click on any high-volume market (e.g., politics, sports)
   - Look for markets with $1M+ volume

5. **Look for API Requests**
   - Filter by: `XHR` or `Fetch`
   - Look for requests to:
     - `data-api.polymarket.com`
     - `clob.polymarket.com`
     - `gamma-api.polymarket.com`

6. **Inspect Response Bodies**
   - Click on each request
   - Click "Response" or "Preview" tab
   - Search for wallet addresses (look for `0x` followed by 40 hex characters)
   - Common patterns:
     - `"wallet": "0x..."`
     - `"maker": "0x..."`
     - `"taker": "0x..."`
     - `"user": "0x..."`

7. **Copy Addresses**
   - Right-click → Copy
   - Save 5-10 addresses for testing

### Method 2: Polymarket Leaderboard (Manual)

1. **Visit Leaderboard**
   ```
   https://polymarket.com/leaderboard
   ```

2. **Inspect Page Source**
   - Right-click → "View Page Source"
   - Search for `0x` in the source
   - Look for wallet addresses in JavaScript data

3. **Click on Top Traders**
   - Click on usernames/profiles
   - URL may contain wallet address: `/profile/0x...`

### Method 3: Blockchain Explorer

1. **Find Polymarket Contract Address**
   - Polymarket uses Polygon (MATIC) blockchain
   - Contract: `0x...` (find on Polymarket docs)

2. **Visit Polygonscan**
   ```
   https://polygonscan.com
   ```

3. **Search for Contract**
   - Paste Polymarket contract address
   - Go to "Transactions" tab
   - Look at recent transactions
   - Copy wallet addresses from `From` or `To` columns

### Method 4: Polymarket Analytics Sites

1. **PolymarketAnalytics.com**
   ```
   https://polymarketanalytics.com/traders
   ```
   - Visit in browser (not API)
   - View trader profiles
   - Wallet addresses may be in URLs or profile pages

2. **Dune Analytics**
   ```
   https://dune.com/polymarket
   ```
   - Search for Polymarket dashboards
   - Look for wallet/trader queries
   - Export data if available

### Method 5: From Our Own Data

Once we populate some data, we can query our own database:

```sql
-- Get wallets that have traded
SELECT DISTINCT wallet_address
FROM wallet_trades
LIMIT 10;

-- Get wallets with positions
SELECT DISTINCT wallet_address
FROM wallet_positions
WHERE shares > 0
LIMIT 10;
```

## Known Top Traders (Usernames)

From web research, these are known top traders (but we need their wallet addresses):

- **WindWalk3** - $1.1M+ profit
- **1j59y6nk** - $1.4M+ profit
- **S-Works** - ~$1M profit
- **Joe-Biden** (username)
- **Erasmus**
- **HyperLiquid0xb**

To find their addresses:
1. Search their username on Polymarket
2. Visit their profile
3. Check URL for wallet address

## Test Addresses

### Zero Address (Always Returns Empty)
```
0x0000000000000000000000000000000000000000
```
- Good for testing API endpoint structure
- Will return `[]` (empty array)
- Confirms endpoint is working

### Example Valid Format (May Be Empty)
```
0x1234567890123456789012345678901234567890
```
- Valid address format
- Likely has no Polymarket activity
- Good for testing empty state UI

## What to Do Once You Have Addresses

### Step 1: Test One Address
```bash
# Replace with real address
WALLET="0xREAL_ADDRESS_HERE"

# Test positions endpoint
curl "http://localhost:3000/api/polymarket/wallet/$WALLET/positions" | jq '.'

# Test trades endpoint
curl "http://localhost:3000/api/polymarket/wallet/$WALLET/trades?limit=10" | jq '.'

# Test value endpoint
curl "http://localhost:3000/api/polymarket/wallet/$WALLET/value" | jq '.'
```

### Step 2: Document Response Structure
Save the JSON responses to understand the data format.

### Step 3: Test in Browser
```
http://localhost:3000/analysis/wallet/0xREAL_ADDRESS_HERE
```

### Step 4: Populate Database
Once confirmed working, add addresses to `wallets` table:

```sql
INSERT INTO wallets (wallet_address, wallet_alias)
VALUES
  ('0x...', 'WindWalk3'),
  ('0x...', '1j59y6nk'),
  ('0x...', 'S-Works');
```

## Quick Win: Use Our API to Find Addresses

Since whale trades may contain wallet addresses:

```bash
# If we find any trades data
curl "https://data-api.polymarket.com/trades?limit=100" | jq '.[].maker, .[].taker' | sort -u
```

This might return wallet addresses from recent trades!

## Backup Plan

If we can't find real addresses today, we can:

1. **Build everything with empty state handling**
2. **Test with zero address** to verify endpoints work
3. **Add addresses incrementally** as we find them
4. **Focus on making the system work** with any valid address

The key is: **Our code should handle both empty data and real data gracefully.**

## Example Addresses Found (To Be Updated)

```bash
# Add real addresses here as you find them
WALLET_1="0x..."
WALLET_2="0x..."
WALLET_3="0x..."
```

## Status

- [ ] Found 1+ wallet addresses
- [ ] Tested addresses with Data-API
- [ ] Verified addresses have data (trades/positions)
- [ ] Documented response structure
- [ ] Added to `wallets` table
