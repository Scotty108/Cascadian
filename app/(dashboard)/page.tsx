import { MarketScreener } from "@/components/market-screener-interface";

export const metadata = {
  title: "Market Screener | CASCADIAN",
  description: "Discover and analyze prediction markets on Polymarket",
};

export default function Home() {
  return <MarketScreener />;
}
