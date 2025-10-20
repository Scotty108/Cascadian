"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Asset, Transaction, Wallet } from "../../types";
import { AssetsTab } from "./assets-tab/assets-tab";
import { NFTsTab } from "./nfts-tab/nfts-tab";
import { OverviewTab } from "./overview-tab/overview-tab";
import { TransactionsTab } from "./transactions-tab/transactions-tab";

interface WalletTabsProps {
  wallet: Wallet;
  activeTab: string;
  onTabChange: (tab: string) => void;
  filteredAssets: (Asset & { networkId: string })[];
  filteredTransactions: Transaction[];
  activeNetwork: string;
  onNetworkChange: (network: string) => void;
  onViewAllTransactions: () => void;
}

export function WalletTabs({ wallet, activeTab, onTabChange, filteredAssets, filteredTransactions, activeNetwork, onNetworkChange, onViewAllTransactions }: WalletTabsProps) {
  return (
    <Tabs value={activeTab} onValueChange={onTabChange} className="w-full">
      <div className="overflow-x-auto">
        <div className="min-w-[400px] ">
          <TabsList className="grid  grid-cols-4">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="assets">Assets</TabsTrigger>
            <TabsTrigger value="transactions">Transactions</TabsTrigger>
            <TabsTrigger value="nfts">NFTs</TabsTrigger>
          </TabsList>
        </div>
      </div>

      <TabsContent value="overview" className="space-y-4">
        <OverviewTab wallet={wallet} onViewAllTransactions={onViewAllTransactions} />
      </TabsContent>

      <TabsContent value="assets" className="space-y-4">
        <AssetsTab assets={filteredAssets} activeNetwork={activeNetwork} onNetworkChange={onNetworkChange} />
      </TabsContent>

      <TabsContent value="transactions" className="space-y-4">
        <TransactionsTab transactions={filteredTransactions} activeNetwork={activeNetwork} onNetworkChange={onNetworkChange} />
      </TabsContent>

      <TabsContent value="nfts" className="space-y-4">
        <NFTsTab />
      </TabsContent>
    </Tabs>
  );
}
