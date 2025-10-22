import { MarketScreener } from "@/components/market-screener-interface";
import { MarketScreenerTanStack } from "@/components/market-screener-tanstack";

export default function MarketScreenerPage() {
  return (
    <div className="space-y-12">
      {/* Original Table */}
      {/* <MarketScreener /> */}

      {/* Divider */}
      {/* <div className="border-t border-dashed my-8" /> */}

      {/* New TanStack Table */}
      <MarketScreenerTanStack />
    </div>
  );
}
