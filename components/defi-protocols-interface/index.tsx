"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { OverviewStats } from "./components/overview-stats";
import { AnalyticsTab } from "./components/tabs/analytics-tab";
import { OpportunitiesTab } from "./components/tabs/opportunities-tab";
import { OverviewTab } from "./components/tabs/overview-tab";
import { ProtocolsTab } from "./components/tabs/protocols-tab";
import { GOVERNANCE_PROPOSALS, PROTOCOL_DISTRIBUTION, PROTOCOLS, TVL_CHART_DATA } from "./constants";
import { useProtocols } from "./hooks/use-protocols";

export function DeFiProtocolsInterface() {
  const { protocols, filters, sortConfig, favorites, selectedProtocol, isLoading, updateFilters, toggleSortOrder, toggleFavorite, toggleRiskFilter, setSelectedProtocol, getProtocolDetails } =
    useProtocols();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">DeFi Protocols</h1>
        <p className="text-muted-foreground">Monitor, analyze, and interact with DeFi protocols across multiple chains</p>
      </div>

      <OverviewStats totalTvl="$17.04B" tvlChange="+0.8%" activeProtocols={248} newProtocols={12} averageApy="4.8%" apyChange="-0.3%" userExposure="$24,530" exposureChange="+5.2%" />

      <Tabs defaultValue="overview" className="space-y-4">
        <div className="flex items-center gap-3 flex-wrap justify-between">
          <div className="overflow-x-auto">
            <TabsList className="min-w-[400px]">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="protocols">Protocols</TabsTrigger>
              <TabsTrigger value="analytics">Analytics</TabsTrigger>
              <TabsTrigger value="opportunities">Opportunities</TabsTrigger>
            </TabsList>
          </div>
        </div>

        <TabsContent value="overview">
          <OverviewTab protocols={PROTOCOLS} tvlData={TVL_CHART_DATA} distributionData={PROTOCOL_DISTRIBUTION} governanceProposals={GOVERNANCE_PROPOSALS} />
        </TabsContent>

        <TabsContent value="protocols">
          <ProtocolsTab
            protocols={protocols}
            filters={filters}
            sortConfig={sortConfig}
            favorites={favorites}
            selectedProtocol={selectedProtocol}
            onFiltersChange={updateFilters}
            onRiskFilterToggle={toggleRiskFilter}
            onSortChange={toggleSortOrder}
            onFavoriteToggle={toggleFavorite}
            onProtocolSelect={setSelectedProtocol}
            onProtocolClose={() => setSelectedProtocol(null)}
            getProtocolDetails={getProtocolDetails}
          />
        </TabsContent>

        <TabsContent value="analytics">
          <AnalyticsTab />
        </TabsContent>

        <TabsContent value="opportunities">
          <OpportunitiesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
