-- STAGE 2: Atomic table swap
-- Renames corrupted table to backup and puts fixed table in place

RENAME TABLE trade_cashflows_v3 TO trade_cashflows_v3_corrupted,
             trade_cashflows_v3_fixed TO trade_cashflows_v3;
