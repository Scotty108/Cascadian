-- Export query for high_confidence_realized_winners_20251217.csv

SELECT
  wallet,
  realized_pnl,
  engine_pnl,
  trade_count,
  profit_factor,
  external_sells_ratio,
  open_exposure_ratio,
  taker_ratio,
  toString(computed_at) as computed_at
FROM pm_wallet_engine_pnl_cache FINAL
WHERE external_sells_ratio <= 0.05
  AND open_exposure_ratio <= 0.25
  AND taker_ratio <= 0.15
  AND trade_count >= 50
  AND realized_pnl > 0
ORDER BY realized_pnl DESC
