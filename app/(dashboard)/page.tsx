import { MarketScreenerTanStack } from "@/components/market-screener-tanstack";

export const metadata = {
  title: "Market Screener | CASCADIAN",
  description: "Discover and analyze prediction markets on Polymarket",
};

export default function Home() {
  return <MarketScreenerTanStack />;
}
