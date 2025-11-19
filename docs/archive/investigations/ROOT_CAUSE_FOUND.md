# ROOT CAUSE IDENTIFIED: Different Condition ID Sources

## Summary

The 24.8% join coverage is NOT a normalization bug - it's because `market_resolutions_final` and `fact_trades_clean` contain **completely different sets of markets**.

---

## The Smoking Gun Evidence

### Sample Comparison

**market_resolutions_final CIDs** (all samples have 3-4 leading zeros):
```
0000a3aa2ac9a909841538e97750d8cf5ef95fdf46b74a3d670e50771c58bbed  (4 leading zeros)
0000bd14c46a76b3cf2d7bdb48e39f21ecef57130b0ad8681e51d938e5715296  (4 leading zeros)
000149d7a2971f4ba69343b6ebc8b5d76a29b2f20caa7b7041ae2f2da0a448f3  (3 leading zeros)
0001bd6b1ce49b28d822af08b0ff1844bf789bfeb7634a88b45e7619a0d45837  (3 leading zeros)
00027317e0ce68a40dbef0df232baf27619f982961bbbe5f9d3ed0e389a46d5d  (3 leading zeros)
```

**fact_trades_clean CIDs** (all samples have 0 leading zeros):
```
dd5ca79b065d24df49a7b3d59deff7be20657c69fe7d156a773b6a27fb9af658  (0 leading zeros)
c87a86de17d45996889548284f4bb1c24abbdce7327dc9be4224c713346fa80e  (0 leading zeros)
91ab818cc0469d4eec5118360f42d259b84aa91da0c04928b0b68a793ca25c6a  (0 leading zeros)
93deb262e5f3548c49ca8956abc85036eb54a38ac96f4a11f010532f7e9a6cb9  (0 leading zeros)
f894eb863bcafd6e89008e58e5946dad29bc4239b01ca08a64459b2e91397842  (0 leading zeros)
```

### The One That Works

The 24.8% that DO match are CIDs **without leading zeros**:
```
Example matching CID:
b921eceb145f5006861387a2775b93765ec1f493f29a06cbad57e36e927b7da8
```

This CID exists in BOTH tables because it has no leading zeros.

---

## What This Means

1. **market_resolutions_final** has 224,396 markets with mostly leading-zero CIDs
2. **fact_trades_clean** has 227,838 markets with mostly non-leading-zero CIDs
3. **Only 56,504 markets** overlap (24.8%)
4. **171,334 markets** in fact_trades have NO resolution data
5. **167,892 markets** in resolutions have NO trade data

---

## Key Numbers

| Metric | Value |
|--------|-------|
| Total markets in fact_trades_clean | 227,838 |
| Total markets in market_resolutions_final | 224,396 |
| Markets that match | 56,504 (24.8%) |
| Markets missing resolutions | 171,334 (75.2%) |

---

## The Question

**Where did the condition_ids in market_resolutions_final come from?**

The table exists with 224K rows, but the condition_ids are fundamentally different from the ones we're trading on (based on vw_trades_canonical).

Possible explanations:
1. **Different data source**: resolutions came from a different API/source than trades
2. **Different encoding**: condition_ids were transformed/encoded differently
3. **Historical artifact**: market_resolutions_final is from old data, trades are from new data
4. **Token ID vs Condition ID**: mixing up different identifier types

---

## Next Steps

Need to determine:
1. Where did market_resolutions_final get its condition_ids from?
2. Is there another resolutions table with the "correct" condition_ids?
3. Should we backfill market_resolutions_final from the Polymarket API using the condition_ids from fact_trades?

---

## What We Fixed (But It Didn't Help)

✅ Rebuilt fact_trades_clean with correct CID format (0x + 64 hex chars)
✅ Verified normalization formula works for the 24.8% that match
❌ But 75% of markets still have no resolution because they're different markets entirely
