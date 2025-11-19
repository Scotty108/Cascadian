# Database Search Protocol - Quick Reference

**#remember - Use this for ALL database investigations**

---

## 🎯 The Golden Rule

**BEFORE any database search: Read `/docs/systems/database/TABLE_RELATIONSHIPS.md`**

---

## ✅ Required Steps (In Order)

### 1. Check Documentation FIRST
```
Read: /docs/systems/database/TABLE_RELATIONSHIPS.md
- Check if table already documented
- Look for existing join patterns
- Review known format quirks
```

### 2. If Searching New Territory
```sql
-- ALWAYS run both:
DESCRIBE TABLE table_name;          -- See full schema
SELECT * FROM table_name LIMIT 5;   -- See actual data
```

### 3. Test Thoroughly
- Check ALL plausible column names (variations, plurals, formats)
- Try format variations (decimal, hex, 0x prefix, arrays)
- Look in JSON/metadata fields
- Never conclude "table doesn't have X" after one query

### 4. Document Discoveries
Update `/docs/systems/database/TABLE_RELATIONSHIPS.md` with:
- New tables found
- New columns with useful data
- New join patterns
- Format differences from expected
- Common gotchas

---

## 🚫 Common Mistakes

### ❌ What NOT to Do
```
1. Skip checking existing docs
2. Try one query, fail, give up
3. Assume column names
4. Ignore format variations
5. Forget to update docs with discoveries
```

### ✅ What TO Do
```
1. Read TABLE_RELATIONSHIPS.md first
2. Run DESCRIBE + SAMPLE before dismissing
3. Test ALL column name variations
4. Check format variations (hex/decimal, 0x prefix)
5. Update docs immediately with findings
```

---

## 📚 Real Example: The 4-Hour Miss

**What happened:**
- Searched 40+ tables for token mappings
- Checked `gamma_markets` for `metadata` column → failed
- Concluded "gamma_markets has no tokens" ❌
- Spent 4 hours checking other tables
- Later discovered: `gamma_markets.metadata` has `clobTokenIds` with 149K mappings

**What should have been done:**
```sql
-- Instead of just:
SELECT metadata FROM gamma_markets;  -- ❌ Failed, gave up

-- Should have done:
DESCRIBE TABLE gamma_markets;        -- ✅ Shows actual schema
SELECT * FROM gamma_markets LIMIT 5; -- ✅ Shows data structure
-- Would have found clobTokenIds immediately!
```

**Result:** Had 100% coverage all along, just didn't look properly.

---

## 🎯 Quick Decision Tree

```
Need database info?
↓
├─ Is it documented in TABLE_RELATIONSHIPS.md?
│  ├─ YES → Use documented pattern ✅
│  └─ NO → Continue investigation ↓
│
├─ Run DESCRIBE TABLE + SELECT * LIMIT 5
│  ↓
├─ Found what you need?
│  ├─ YES → Update TABLE_RELATIONSHIPS.md ✅
│  └─ NO → Test variations (column names, formats) ↓
│
└─ Still not found?
   ├─ Check JSON/metadata fields
   ├─ Try format conversions (hex/decimal)
   ├─ Test ALL plausible column names
   └─ Document findings in TABLE_RELATIONSHIPS.md
```

---

## 💾 Update Protocol

**When to update TABLE_RELATIONSHIPS.md:**
- ✅ New table discovered
- ✅ New column with important data
- ✅ New join pattern found
- ✅ Data format different than documented
- ✅ Better query approach found
- ✅ Common mistake encountered

**How to update:**
1. Add to relevant section (Core/Supporting/Bridge tables)
2. Document schema and sample data
3. Add join keys and relationships
4. Include example queries if useful
5. Note any format quirks or gotchas

---

## 🔗 Key Documents

| Document | Purpose |
|----------|---------|
| `/docs/systems/database/TABLE_RELATIONSHIPS.md` | Complete table reference (READ FIRST) |
| `/docs/systems/database/FINAL_DATABASE_SCHEMA.md` | Production schema details |
| `/docs/systems/database/CLICKHOUSE_QUICK_REFERENCE.md` | Query patterns |

---

**Last Updated:** 2025-11-11
**Status:** Active - Use for all database work

