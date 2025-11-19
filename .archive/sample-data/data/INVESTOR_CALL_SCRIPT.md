# Investor Call Script - Smart Money Flow Demo

**For: Live demo of /debug/flow page**
**Read aloud on Zoom/screenshare**

---

## "Here's what you're seeing"

What you're looking at right now is our smart money tracking system. At the top, you see our Top Wallet Specialists. These are the four best-performing prediction market traders we've identified, ranked by real profit and loss.

When I say "real," I mean audited realized P&L from closed positions only. No paper gains. No hypotheticals. Every dollar you see here is a dollar these wallets actually made or lost on resolved markets.

The coverage percentage next to each wallet tells you how much of their trading history we can verify. Thirty-six percent coverage means we've analyzed 36% of this wallet's trades that have resolved with known outcomes. Higher coverage means we have more data to trust their track record. We don't surface wallets with thin track records.

## "Here's why this matters"

We know which wallets are actually good, and we know what domain they're good in.

This isn't vibe-based. We're showing audited profit in specific categories: politics, macro, earnings, crypto, sports. Each wallet has a specialty. This one's a geopolitics specialist. That one's a macro trader. We categorize every market using Polymarket's own event tags, so there's no guessing involved.

When you see a wallet with $9,000 in realized profit and 36% coverage specializing in geopolitics, you're looking at someone who has demonstrable edge in that domain. That's not noise. That's signal.

## "Here's the live feed"

Below the specialists, you see the Live Watchlist Stream. This is what the smart money is watching right now.

When you see a "LIVE FLOW" badge, it means a top-5 wallet with high coverage just opened a position within the last 12 hours. Not 48 hours. Not a week ago. In the last 12 hours.

Why does that matter? Because in prediction markets, timing is everything. If a wallet with proven edge in geopolitics just entered a Ukraine market, that's actionable information. You're seeing what the smart money touches, in near real-time, filtered by proven performance.

This isn't "trending markets" or "popular bets." It's capital deployment by domain experts, timestamped and attributed.

## "Here's what's technically hard and why this is defensible"

Behind the scenes, we're doing something that sounds simple but is actually very hard at scale.

We ingest raw on-chain trade execution data from the blockchain. Every fill, every order, every wallet. Then we resolve those trades to Polymarket market IDs by calling their API for each unique on-chain condition identifier.

Then we attach each market to an event, and each event to a canonical category. Politics, macro, earnings, crypto, sports. We use Polymarket's own tags and map them deterministically, so we can defend every categorization.

Here's the critical part: we enforce a rule that we literally refuse to ingest trades we can't enrich. If we can't resolve a trade to a market, we skip it. No garbage in. That means our data quality improves over time and never regresses.

We enrich trades by resolving on-chain condition IDs to Polymarket market IDs, then map to category tags. We now have working attribution for our highest-performing wallets, and that enrichment is rolling out across the full dataset.

## "This is Bloomberg for prediction markets"

Here's the bottom line.

This is basically Bloomberg for prediction markets. We rank the smartest money on-chain by realized profit. We watch what they touch next in real time. And we surface only the moves that come from accounts with proven edge.

We're not scraping vibes or Twitter sentiment. We're measuring actual performance in specific domains and streaming their next move as it happens.

That's the wedge. That's why this is defensible. And that's why investors should care.

---

**[End of script - open for questions]**
