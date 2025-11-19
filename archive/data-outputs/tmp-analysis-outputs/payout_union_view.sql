-- Union payout source for better coverage
CREATE OR REPLACE VIEW payout_source_union AS
SELECT * FROM market_resolutions_final
UNION ALL
SELECT * FROM market_resolutions;
