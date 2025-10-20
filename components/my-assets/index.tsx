"use client";

import { useRouter } from "next/navigation";
import { AssetList } from "./components/asset-list";
import { KpiCards } from "./components/kpi-cards";
import { PortfolioChart } from "./components/portfolio-chart";
import { TopAssets } from "./components/top-assets";
import { TransactionHistory } from "./components/transaction-history";
import { kpiMetrics, portfolioData, topAssets, transactions } from "./data";

export function MyAssets() {
  const router = useRouter();




  return (
    <div className="flex flex-col gap-4">
      <KpiCards metrics={kpiMetrics} />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <PortfolioChart data={portfolioData} />
        <TopAssets assets={topAssets} />
      </div>

      <div className="md:grid max-md:space-y-4 gap-4 md:grid-cols-2 lg:grid-cols-7">
        <AssetList assets={portfolioData}  />
        <TransactionHistory transactions={transactions}  />
      </div>
    </div>
  );
}
