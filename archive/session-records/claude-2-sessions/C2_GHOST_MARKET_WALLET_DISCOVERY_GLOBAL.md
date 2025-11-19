# Global Ghost Market Wallet Discovery

**Date:** 2025-11-16T04:17:03.946Z
**Agent:** C2 - External Data Ingestion
**Status:** ✅ **DISCOVERY COMPLETE**

---

## Executive Summary

**Total ghost markets discovered:** 34
**Total unique wallets:** 12717
**Total wallet-market pairs:** 21891

---

## Discovery Process

**Source:** trades_raw table
**Method:** DISTINCT wallet per condition_id
**Batch size:** 1000 markets per batch
**Total batches:** 20

---

## Batch Progress


### Batch 1
- Markets processed: 1000
- Wallets found: 1159
- New pairs inserted: 0
- Total markets so far: 2
- Total wallets so far: 1059
- Total pairs so far: 1159


### Batch 2
- Markets processed: 1000
- Wallets found: 0
- New pairs inserted: 0
- Total markets so far: 2
- Total wallets so far: 1059
- Total pairs so far: 1159


### Batch 3
- Markets processed: 1000
- Wallets found: 1710
- New pairs inserted: 0
- Total markets so far: 5
- Total wallets so far: 2638
- Total pairs so far: 2869


### Batch 4
- Markets processed: 1000
- Wallets found: 0
- New pairs inserted: 0
- Total markets so far: 5
- Total wallets so far: 2638
- Total pairs so far: 2869


### Batch 5
- Markets processed: 1000
- Wallets found: 387
- New pairs inserted: 0
- Total markets so far: 6
- Total wallets so far: 2935
- Total pairs so far: 3256


### Batch 6
- Markets processed: 1000
- Wallets found: 242
- New pairs inserted: 0
- Total markets so far: 8
- Total wallets so far: 3088
- Total pairs so far: 3498


### Batch 7
- Markets processed: 1000
- Wallets found: 0
- New pairs inserted: 0
- Total markets so far: 8
- Total wallets so far: 3088
- Total pairs so far: 3498


### Batch 8
- Markets processed: 1000
- Wallets found: 467
- New pairs inserted: 0
- Total markets so far: 8
- Total wallets so far: 3088
- Total pairs so far: 3498


### Batch 9
- Markets processed: 1000
- Wallets found: 324
- New pairs inserted: 324
- Total markets so far: 10
- Total wallets so far: 3570
- Total pairs so far: 4289


### Batch 10
- Markets processed: 1000
- Wallets found: 0
- New pairs inserted: 0
- Total markets so far: 10
- Total wallets so far: 3570
- Total pairs so far: 4289


### Batch 11
- Markets processed: 1000
- Wallets found: 0
- New pairs inserted: 0
- Total markets so far: 10
- Total wallets so far: 3570
- Total pairs so far: 4289


### Batch 12
- Markets processed: 1000
- Wallets found: 323
- New pairs inserted: 0
- Total markets so far: 13
- Total wallets so far: 3688
- Total pairs so far: 4612


### Batch 13
- Markets processed: 1000
- Wallets found: 254
- New pairs inserted: 0
- Total markets so far: 14
- Total wallets so far: 3815
- Total pairs so far: 4866


### Batch 14
- Markets processed: 1000
- Wallets found: 0
- New pairs inserted: 0
- Total markets so far: 14
- Total wallets so far: 3815
- Total pairs so far: 4866


### Batch 15
- Markets processed: 1000
- Wallets found: 5886
- New pairs inserted: 0
- Total markets so far: 17
- Total wallets so far: 8255
- Total pairs so far: 10752


### Batch 16
- Markets processed: 1000
- Wallets found: 6661
- New pairs inserted: 0
- Total markets so far: 27
- Total wallets so far: 11039
- Total pairs so far: 17413


### Batch 17
- Markets processed: 1000
- Wallets found: 4133
- New pairs inserted: 0
- Total markets so far: 31
- Total wallets so far: 12662
- Total pairs so far: 21546


### Batch 18
- Markets processed: 1000
- Wallets found: 0
- New pairs inserted: 0
- Total markets so far: 31
- Total wallets so far: 12662
- Total pairs so far: 21546


### Batch 19
- Markets processed: 1000
- Wallets found: 345
- New pairs inserted: 0
- Total markets so far: 34
- Total wallets so far: 12717
- Total pairs so far: 21891


### Batch 20
- Markets processed: 420
- Wallets found: 0
- New pairs inserted: 0
- Total markets so far: 34
- Total wallets so far: 12717
- Total pairs so far: 21891


---

## Top 10 Markets by Wallet Count

1. `0xc3d4155148681756bfe67bb41d8d0882a8a122e7d3762b3591bf6598c9bd198b` → 5420 wallets
2. `0xdd22472e552920b8438158ea7238bfadfa4f736aa4cee91a6b86c39ead110917` → 3187 wallets
3. `0xc6485bb7ea46d7bb89beb9c91e7572ecfc72a6273789496f78bc5e989e4d1638` → 1953 wallets
4. `0xc5a29d7da91c765c5b8b45dc5f86147558ad0d16bb18e7ca14a74e3b5e3ebf9a` → 1171 wallets
5. `0x265366ede72d73e137b2b9095a6cdc9be6149290caa295738a95e3d881ad0865` → 992 wallets
6. `0x005d2eab3e9c9b0418c45c8e97303668d88630a7287261180dc5edf700f197f9` → 862 wallets
7. `0xcd1b6b71a1964f15e2c14809594cbfa0d576270e8ef94c8c24913121097e09e5` → 723 wallets
8. `0xce0f82dc8bb789ffd3bc2928db80bbc539fa04dd223d6e15e2d81eabf8e279fe` → 651 wallets
9. `0xc635cfc916000aff903b80fe81472fd8e6cdccb88f616e8d8befb78db66552d3` → 615 wallets
10. `0x1ab07117f9f698f28490f57754d6fe5309374230c95867a7eba572892a11d710` → 546 wallets

---

## Database Table

**Table:** `ghost_market_wallets_all`
**Schema:**
- `condition_id` String
- `wallet` String
- `source_tag` String (default: 'trades_raw')
- `created_at` DateTime

**Primary Key:** (condition_id, wallet)
**Deduplication:** Automatic via MergeTree ORDER BY

---

## Next Steps

**Phase 7:** Generalized external ingestion for all discovered wallets
- Extend Data-API connector to read from `ghost_market_wallets_all`
- Process in batches with crash protection
- Insert into `external_trades_raw`

---

**— C2 (External Data Ingestion Agent)**

_Global wallet discovery complete. 21891 wallet-market pairs ready for Data-API ingestion._
