# Dune Backfill Implementation Guide: Step-by-Step

**Purpose:** Detailed instructions for backfilling P&L for 4 test wallets using Dune
**Target:** 3-5 hours to complete
**Outcome:** Full historical P&L loaded into ClickHouse

---

## Phase 1: Setup & Validation (Day 1-2)

### Step 1.1: Create Dune Account (5 min)

1. Visit https://dune.com/
2. Sign up (email + password)
3. No payment required (free tier is sufficient)
4. Verify email

### Step 1.2: Understand Dune Tables (15 min)

The 16 core Polymarket tables:

```
Core Data:
├── polymarket_polygon_market_trades      ← JOIN THIS (what you need)
├── polymarket_polygon_market_trades_raw  (raw, pre-join)
├── polymarket_polygon_markets
├── polymarket_polygon_market_details
├── polymarket_polygon_market_outcomes    ← JOIN THIS for resolution
├── polymarket_polygon_positions
├── polymarket_polygon_users
└── ... (10 more reference tables)
```

**For backfill, you need:**
1. `polymarket_polygon_market_trades` - all trades
2. `polymarket_polygon_market_outcomes` - resolution + payout data

### Step 1.3: Write Sample Query (20 min)

Go to Dune → New → SQL query

**Template for HolyMoses7:**

```sql
-- Get all trades for HolyMoses7
SELECT
  block_number,
  block_time,
  transaction_hash,
  evt_index,
  contract_address,
  trader,
  transactionFrom,
  token_id,
  quantity_traded,
  price_per_share,
  action,
  market_id,
  condition_id,
  outcome_index,
  long_token,
  short_token
FROM polymarket_polygon_market_trades
WHERE
  trader = LOWER('0x[INSERT_HOLYMOSES7_ADDRESS]')
  AND block_time >= '2023-01-01'
ORDER BY block_time DESC
LIMIT 1000;  -- Start small for testing
```

**To run:**
1. Paste into Dune query editor
2. Replace `0x[...]` with actual address
3. Click "Execute"
4. Wait 10-30 seconds for results

### Step 1.4: Get Market Resolution Data (20 min)

**Template for joining to outcomes:**

```sql
-- Get trades + resolution data
SELECT
  t.block_time,
  t.trader,
  t.condition_id,
  t.outcome_index,
  t.quantity_traded,
  t.price_per_share,
  o.resolved,
  o.payout_numerators,
  o.payout_denominator,
  CASE WHEN o.payout_numerators[t.outcome_index + 1] > 0 THEN 'WIN' ELSE 'LOSS' END as outcome
FROM polymarket_polygon_market_trades t
LEFT JOIN polymarket_polygon_market_outcomes o
  ON t.condition_id = o.condition_id
WHERE
  t.trader = LOWER('0x[INSERT_HOLYMOSES7_ADDRESS]')
  AND t.block_time >= '2023-01-01'
  AND o.resolved = true  -- Only resolved markets
ORDER BY t.block_time DESC
LIMIT 1000;
```

**Expected output:**
- Each row = 1 trade
- outcome = WIN if payout > 0, LOSS if payout = 0

### Step 1.5: Export to CSV (5 min)

1. Run query above
2. Click "Export to CSV" button (top right)
3. Save as `holymoses7_trades.csv`
4. Inspect first 10 rows

---

## Phase 2: Calculate P&L (Day 2-3)

### Step 2.1: Write Python ETL Script

**File:** `scripts/dune_backfill_etl.py`

```python
import csv
import json
from decimal import Decimal
from datetime import datetime
from pathlib import Path

class DuneBackfillETL:
    """Convert Dune CSV export to Cascadian P&L format"""

    def __init__(self, csv_path: str):
        self.csv_path = csv_path
        self.trades = []

    def load_csv(self):
        """Load Dune CSV export"""
        with open(self.csv_path) as f:
            reader = csv.DictReader(f)
            for row in reader:
                self.trades.append(row)
        print(f"Loaded {len(self.trades)} trades")

    def normalize_condition_id(self, condition_id: str) -> str:
        """Normalize condition ID: lowercase, strip 0x, pad to 64 chars"""
        # Remove 0x prefix if present
        if condition_id.startswith('0x') or condition_id.startswith('0X'):
            condition_id = condition_id[2:]
        # Lowercase
        condition_id = condition_id.lower()
        # Pad to 64 chars (32 bytes in hex)
        if len(condition_id) < 64:
            condition_id = condition_id.zfill(64)
        assert len(condition_id) == 64, f"Invalid condition_id length: {condition_id}"
        return condition_id

    def calculate_pnl(self, row: dict) -> dict:
        """Calculate realized P&L for this trade"""
        try:
            qty = Decimal(row['quantity_traded'])
            price = Decimal(row['price_per_share'])
            outcome = row.get('outcome', 'UNKNOWN')
            payout_numerator = Decimal(row.get('payout_numerators[outcome_index+1]', '0'))
            payout_denom = Decimal(row.get('payout_denominator', '1'))

            cost_basis = qty * price

            if outcome == 'WIN':
                realized_payout = qty * (payout_numerator / payout_denom)
                realized_pnl = realized_payout - cost_basis
            else:
                # Loss: lose all cost basis, get nothing back
                realized_payout = 0
                realized_pnl = -cost_basis

            return {
                'cost_basis': float(cost_basis),
                'realized_payout': float(realized_payout),
                'realized_pnl': float(realized_pnl),
                'outcome': outcome
            }
        except Exception as e:
            print(f"ERROR calculating PnL for row: {row}")
            print(f"Exception: {e}")
            return None

    def transform(self) -> list:
        """Transform CSV to ClickHouse format"""
        output = []
        total_cost = 0
        total_payout = 0
        total_pnl = 0

        for row in self.trades:
            # Normalize ID
            condition_id = self.normalize_condition_id(row['condition_id'])

            # Calculate PnL
            pnl_calc = self.calculate_pnl(row)
            if not pnl_calc:
                continue

            # Build output record
            record = {
                'block_time': row['block_time'],
                'block_number': row['block_number'],
                'tx_hash': row['transaction_hash'],
                'evt_index': row['evt_index'],
                'trader': row['trader'].lower(),
                'condition_id_normalized': condition_id,
                'market_id': row['market_id'],
                'outcome_index': row['outcome_index'],
                'quantity': float(row['quantity_traded']),
                'price_per_share': float(row['price_per_share']),
                'cost_basis': pnl_calc['cost_basis'],
                'realized_payout': pnl_calc['realized_payout'],
                'realized_pnl': pnl_calc['realized_pnl'],
                'outcome': pnl_calc['outcome']
            }

            output.append(record)
            total_cost += pnl_calc['cost_basis']
            total_payout += pnl_calc['realized_payout']
            total_pnl += pnl_calc['realized_pnl']

        print(f"\nTransformation complete:")
        print(f"  Total records: {len(output)}")
        print(f"  Total cost basis: ${total_cost:.2f}")
        print(f"  Total realized payout: ${total_payout:.2f}")
        print(f"  Total realized PnL: ${total_pnl:.2f}")

        return output

    def to_clickhouse_inserts(self, table_name: str = 'pnl_trades_from_dune') -> str:
        """Generate ClickHouse INSERT statements"""
        transformed = self.transform()

        # Build INSERT statement
        columns = [
            'block_time', 'block_number', 'tx_hash', 'evt_index',
            'trader', 'condition_id_normalized', 'market_id',
            'outcome_index', 'quantity', 'price_per_share',
            'cost_basis', 'realized_payout', 'realized_pnl', 'outcome'
        ]

        values = []
        for record in transformed:
            row_values = [
                f"'{record['block_time']}'",
                record['block_number'],
                f"'{record['tx_hash']}'",
                record['evt_index'],
                f"'{record['trader']}'",
                f"'{record['condition_id_normalized']}'",
                f"'{record['market_id']}'",
                record['outcome_index'],
                record['quantity'],
                record['price_per_share'],
                record['cost_basis'],
                record['realized_payout'],
                record['realized_pnl'],
                f"'{record['outcome']}'"
            ]
            values.append(f"({', '.join(str(v) for v in row_values)})")

        sql = f"INSERT INTO {table_name} ({', '.join(columns)}) VALUES\n"
        sql += ',\n'.join(values) + ";"

        return sql

# Usage
if __name__ == "__main__":
    etl = DuneBackfillETL('holymoses7_trades.csv')
    etl.load_csv()
    sql = etl.to_clickhouse_inserts()

    # Print first 1000 chars of SQL
    print(f"\nGenerated SQL (first 1000 chars):\n{sql[:1000]}\n...")

    # Save to file
    with open('holymoses7_insert.sql', 'w') as f:
        f.write(sql)
    print(f"Saved INSERT statement to holymoses7_insert.sql")
```

### Step 2.2: Run Script (5 min)

```bash
cd /Users/scotty/Projects/Cascadian-app
python scripts/dune_backfill_etl.py

# Output should look like:
# Loaded 847 trades
#
# Transformation complete:
#   Total records: 847
#   Total cost basis: $1,234.56
#   Total realized payout: $1,456.78
#   Total realized PnL: $222.22
#
# Generated SQL (first 1000 chars):
# INSERT INTO pnl_trades_from_dune (block_time, block_number, ...
```

### Step 2.3: Validate Against Polymarket UI (15 min)

**For HolyMoses7:**

1. Visit: https://polymarket.com/portfolio/[HolyMoses7_address]
2. Note the "Total Wins" and "Total Losses" shown
3. Compare vs your calculated PnL:

```
Polymarket UI:        Total Wins = $1,456.78, Total Losses = $(1,234.56)
Your calculation:     Total realized payout = $1,456.78, Total cost basis = $1,234.56
Calculated PnL:       $1,456.78 - $1,234.56 = $222.22

UI shows:             +$222.22 (Total Wins - Total Losses)
Your calculation:     +$222.22

✅ MATCH! Within ±5%, proceed to backfill.
```

**If they don't match:**

Debug checklist:
- [ ] Check condition_id normalization (must be 64-char lowercase hex)
- [ ] Verify payout vector application (winning outcome should have payout > 0)
- [ ] Check fee handling (Dune may or may not include 2% trading fee)
- [ ] Filter to resolved markets only (resolved = true)
- [ ] Verify outcome_index mapping (1-indexed vs 0-indexed)

---

## Phase 3: Load to ClickHouse (Day 3-4)

### Step 3.1: Create ClickHouse Table (5 min)

```sql
-- Run in ClickHouse
CREATE TABLE IF NOT EXISTS pnl_trades_from_dune (
  block_time DateTime,
  block_number UInt64,
  tx_hash String,
  evt_index UInt64,
  trader String,
  condition_id_normalized String,
  market_id String,
  outcome_index UInt8,
  quantity Decimal(38, 8),
  price_per_share Decimal(38, 8),
  cost_basis Decimal(38, 8),
  realized_payout Decimal(38, 8),
  realized_pnl Decimal(38, 8),
  outcome String,
  inserted_at DateTime DEFAULT now()
) ENGINE = MergeTree()
ORDER BY (trader, block_time)
```

### Step 3.2: Load Data (5 min)

**Option A: From generated SQL file**

```bash
# If you generated holymoses7_insert.sql:
clickhouse-client < holymoses7_insert.sql
```

**Option B: From CSV via ClickHouse client**

```bash
clickhouse-client \
  --query "INSERT INTO pnl_trades_from_dune FORMAT CSV" \
  < holymoses7_trades.csv
```

### Step 3.3: Verify Load (5 min)

```sql
-- Check row count
SELECT COUNT(*) as total_trades
FROM pnl_trades_from_dune
WHERE trader = '0x[holymoses7_address]';

-- Check totals
SELECT
  trader,
  SUM(cost_basis) as total_cost,
  SUM(realized_payout) as total_payout,
  SUM(realized_pnl) as total_pnl,
  COUNT(*) as num_trades
FROM pnl_trades_from_dune
WHERE trader = '0x[holymoses7_address]'
GROUP BY trader;

-- Expected: match your Python script output
```

---

## Phase 4: Backfill Remaining Wallets (Day 5-7)

### Step 4.1: Repeat for Each Wallet

For each of: niggemon, [wallet3], [wallet4]:

1. Create new Dune query (change `trader` address)
2. Export to CSV
3. Run ETL script
4. Validate against UI (±5%)
5. Load to ClickHouse

**Estimated time per wallet:** 45 min (20 min query + 10 min ETL + 10 min validate + 5 min load)

### Step 4.2: Aggregate Summary (10 min)

```sql
-- View all 4 wallets summary
SELECT
  trader,
  COUNT(*) as num_trades,
  SUM(cost_basis) as total_invested,
  SUM(realized_payout) as total_won,
  SUM(realized_pnl) as total_pnl,
  ROUND(100.0 * SUM(realized_pnl) / SUM(cost_basis), 2) as roi_percent
FROM pnl_trades_from_dune
GROUP BY trader
ORDER BY total_pnl DESC;
```

**Expected output:**

```
┌─trader──────────────┬─num_trades─┬─total_invested─┬─total_won─┬─total_pnl──┬─roi_percent─┐
│ 0xholymoses7...    │        847 │        1234.56 │  1456.78  │    222.22  │       18.01 │
│ 0xniggemon...      │        523 │         789.45 │   654.32  │   -135.13  │      -17.12 │
│ 0xwallet3...       │        312 │         456.78 │   512.34  │     55.56  │       12.16 │
│ 0xwallet4...       │        198 │         234.56 │   267.89  │     33.33  │       14.21 │
└────────────────────┴────────────┴────────────────┴───────────┴────────────┴─────────────┘
```

---

## Phase 5: Integration & Testing (Day 8-10)

### Step 5.1: Create View for Dashboard

```sql
-- Create view for dashboard consumption
CREATE OR REPLACE VIEW v_wallet_pnl_summary AS
SELECT
  trader,
  COUNT(*) as num_trades,
  SUM(cost_basis) as total_invested,
  SUM(realized_payout) as total_won,
  SUM(realized_pnl) as total_pnl,
  ROUND(100.0 * SUM(realized_pnl) / SUM(cost_basis), 2) as roi_percent,
  MIN(block_time) as first_trade,
  MAX(block_time) as last_trade
FROM pnl_trades_from_dune
GROUP BY trader
ORDER BY total_pnl DESC;
```

### Step 5.2: Validation Queries (20 min)

```sql
-- 1. Check for data gaps
SELECT
  trader,
  DATE(block_time) as trade_date,
  COUNT(*) as num_trades
FROM pnl_trades_from_dune
GROUP BY trader, trade_date
ORDER BY trader, trade_date;

-- 2. Check for outliers
SELECT
  trader,
  MAX(realized_pnl) as max_win,
  MIN(realized_pnl) as max_loss,
  STDDEV(realized_pnl) as pnl_volatility
FROM pnl_trades_from_dune
GROUP BY trader;

-- 3. Verify no nulls
SELECT
  COUNT(*) as total_rows,
  SUM(CASE WHEN trader IS NULL THEN 1 ELSE 0 END) as null_trader,
  SUM(CASE WHEN realized_pnl IS NULL THEN 1 ELSE 0 END) as null_pnl
FROM pnl_trades_from_dune;
```

### Step 5.3: Documentation (15 min)

Create `DUNE_BACKFILL_NOTES.md`:

```markdown
# Dune Backfill Execution Notes

Date: [DATE]
Executor: [NAME]

## Wallets Backfilled
- [x] HolyMoses7: 847 trades, $222.22 PnL
- [x] niggemon: 523 trades, -$135.13 PnL
- [x] wallet3: 312 trades, $55.56 PnL
- [x] wallet4: 198 trades, $33.33 PnL

## Validation Results
- [x] All 4 wallets ±5% accurate vs polymarket.com UI
- [x] No data quality issues detected
- [x] Row counts verified
- [x] PnL calculations spot-checked

## Known Issues
- None

## Next Steps
1. Start CLOB API ingestion (live trades)
2. Build blockchain monitor for settlements
3. Implement deduplication logic
4. Run 7-day reconciliation test
```

---

## Quick Reference: SQL Templates

### Query 1: Get Trades for One Wallet

```sql
SELECT * FROM polymarket_polygon_market_trades
WHERE trader = LOWER('0x[ADDRESS]')
ORDER BY block_time DESC
LIMIT 10000;
```

### Query 2: Trades + Resolution Data

```sql
SELECT
  t.block_time,
  t.trader,
  t.condition_id,
  t.quantity_traded,
  t.price_per_share,
  o.payout_numerators,
  o.payout_denominator
FROM polymarket_polygon_market_trades t
LEFT JOIN polymarket_polygon_market_outcomes o
  ON t.condition_id = o.condition_id
WHERE t.trader = LOWER('0x[ADDRESS]')
  AND o.resolved = true
ORDER BY t.block_time DESC;
```

### Query 3: Summary Stats

```sql
SELECT
  trader,
  COUNT(*) as num_trades,
  SUM(quantity_traded * price_per_share) as total_invested,
  COUNT(DISTINCT condition_id) as num_markets,
  MIN(block_time) as first_trade,
  MAX(block_time) as last_trade
FROM polymarket_polygon_market_trades
WHERE trader IN (
  LOWER('0x[ADDR1]'),
  LOWER('0x[ADDR2]'),
  LOWER('0x[ADDR3]'),
  LOWER('0x[ADDR4]')
)
GROUP BY trader;
```

---

## Troubleshooting

### Problem: "Query timeout"
**Solution:** Add LIMIT clause, reduce date range, or break into smaller batches

### Problem: "No data returned"
**Solution:** Verify wallet address is correct and lowercased; check date range

### Problem: "PnL doesn't match UI"
**Solution:**
1. Check condition_id normalization
2. Verify payout vector is applied correctly
3. Check if fees are included (2% on Polymarket)
4. Filter to resolved markets only

### Problem: "CSV export failed"
**Solution:** Try export as JSON instead, then convert to CSV with Python

---

## Timeline & Effort

| Phase | Tasks | Time | Effort |
|-------|-------|------|--------|
| 1 | Setup + Sample query + Validation | 1 hour | Easy |
| 2 | P&L calculation + Python script | 1.5 hours | Easy |
| 3 | ClickHouse load | 0.5 hours | Easy |
| 4 | Backfill 3 more wallets | 2.5 hours | Easy |
| 5 | Integration + testing | 1 hour | Easy |
| **Total** | | **6.5 hours** | **Easy** |

(Note: May be faster with practice; first wallet takes longest due to setup)

---

## Success Criteria

✅ Checklist:

- [ ] Dune account created
- [ ] Sample SQL query runs
- [ ] CSV export successful
- [ ] Python ETL script works
- [ ] Validation passes ±5% test
- [ ] HolyMoses7 loaded to ClickHouse
- [ ] 3 remaining wallets backfilled
- [ ] Summary view created
- [ ] No data quality issues
- [ ] Documentation complete

**Once all ✅, you're ready for Phase 2 (live pipeline)**

