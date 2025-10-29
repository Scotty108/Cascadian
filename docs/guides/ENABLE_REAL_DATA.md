# Enable Real Polymarket Data - Quick Start

## Current State
Your workflows are using **mock/stub data** (Trump, Bitcoin, Lakers markets).

This is **normal** - real data requires configuration!

---

## Enable Real Data (3 Steps)

### Step 1: Create `.env.local` file
In your project root (same folder as `package.json`):

```bash
# Create the file
touch .env.local
```

### Step 2: Add these lines to `.env.local`

```bash
NEXT_PUBLIC_USE_REAL_POLYMARKET=true
NEXT_PUBLIC_API_URL=http://localhost:3009
```

**Important:** Must be EXACTLY these variable names!

### Step 3: Restart server

```bash
# Stop server (Ctrl+C)
pnpm dev
```

---

## Verify It's Working

1. Create a workflow with AI Copilot
2. Execute the workflow (Run button)
3. **Check the data:**
   - ❌ Mock: "Will Trump win 2024?"
   - ✅ Real: Actual markets from your Supabase database

4. **Check server console:**
   ```
   [Polymarket Stream] Fetching from API...
   ✅ Found 10 markets with real data
   ```

---

## Troubleshooting

### "Still seeing mock data"
1. Did you restart the server? (Required!)
2. Check `.env.local` exists in project root
3. Check variable names are EXACT (no typos)
4. Hard refresh browser (Cmd+Shift+R)

### "API errors in console"
1. Is your Supabase database set up?
2. Check `/api/polymarket/markets` endpoint works
3. Verify you have markets in the database

### "No markets returned"
1. Your database might be empty
2. Run the Polymarket sync (other Claude instance's work)
3. Check Supabase dashboard for data

---

## What You'll Get

### With Real Data
- **Live markets** from Polymarket via your database
- **Analytics** (momentum, trades, volume)
- **Up-to-date prices** (synced every 5 minutes)
- **Real categories** (Politics, Crypto, Sports, etc.)
- **Accurate data** for backtesting

### With Mock Data (Default)
- **3 fake markets** for testing
- **No database dependency**
- **Always works** (good for development)
- **Fast** (no API calls)

---

## When to Use Which

### Use Mock Data When:
- Developing new features
- Testing UI changes
- Learning the system
- No database access

### Use Real Data When:
- Building actual trading bots
- Testing strategies
- Production use
- Need accurate market data

---

## Optional: Different Port?

If your dev server runs on a different port:

```bash
# Change port number to match
NEXT_PUBLIC_API_URL=http://localhost:YOUR_PORT
```

Default is 3009.

---

## File Location

**Correct:**
```
/Users/scotty/Projects/Cascadian-app/.env.local  ✅
```

**Wrong:**
```
/Users/scotty/Projects/Cascadian-app/app/.env.local  ❌
/Users/scotty/.env.local  ❌
```

Must be in the **project root** (same level as `package.json`)!

---

## Quick Copy-Paste

Just run this in your terminal:

```bash
# Navigate to project root
cd /Users/scotty/Projects/Cascadian-app

# Create .env.local with required variables
cat > .env.local << 'EOF'
NEXT_PUBLIC_USE_REAL_POLYMARKET=true
NEXT_PUBLIC_API_URL=http://localhost:3009
EOF

# Restart server
pnpm dev
```

Done! Real data enabled! 🎉
