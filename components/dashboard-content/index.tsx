"use client";

import { KpiCards } from "./components/kpi-cards";
import { ProfitChart } from "./components/profit-chart";
import { RecentTrades } from "./components/recent-trades";
import { TopBots } from "./components/top-bots";
import { WalletOverview } from "./components/wallet-overview";
import { kpiCardsData, profitData, recentTradesData, topBotsData, walletAssetsData } from "./data";
import { useDashboard } from "./hooks/use-dashboard";

export function DashboardContent() {
  const { profitTimeframe, handleTimeframeChange } = useDashboard();

  return (
    <div className="flex flex-col gap-4">
      {/* KPI Cards */}
      <KpiCards cards={kpiCardsData} />

      {/* Charts Section */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <ProfitChart profitData={profitData} timeframe={profitTimeframe} onTimeframeChange={handleTimeframeChange} />
        <RecentTrades trades={recentTradesData} />
      </div>

      {/* Bots and Wallet Section */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <TopBots bots={topBotsData} />
        <WalletOverview assets={walletAssetsData} />
      </div>
    </div>
  );
}
