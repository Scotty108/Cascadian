-- Step 5: Populate from decoded view
INSERT INTO ctf_token_map (token_id, condition_id_norm, outcome_index, source)
SELECT token_id, condition_id_norm, outcome_index, source
FROM ctf_token_decoded
SETTINGS max_execution_time = 600;

-- Validation
SELECT
  count(*) as total,
  countIf(condition_id_norm = lower(hex(bitShiftRight(toUInt256(token_id), 8)))) as cid_correct,
  countIf(outcome_index = toUInt8(bitAnd(toUInt256(token_id), 255))) as idx_correct,
  round(cid_correct / total * 100, 2) as pct_correct
FROM ctf_token_map;
