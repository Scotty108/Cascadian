"use client"

import { useState } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useStakingPools } from "./hooks/use-staking-pools"
import { OverviewTab } from "./components/overview-tab"
import { DiscoverTab } from "./components/discover-tab"
import { MyStakesTab } from "./components/my-stakes-tab"
import { AnalyticsTab } from "./components/analytics-tab"
import { StakeDialog } from "./components/stake-dialog"
import { CalculatorDialog } from "./components/calculator-dialog"
import type { StakingPool, StakeFormState, CalculatorState } from "./types"

export function StakingPoolsInterface() {
  const [activeTab, setActiveTab] = useState("overview")
  const [selectedPool, setSelectedPool] = useState<StakingPool | null>(null)
  const [isStakeDialogOpen, setIsStakeDialogOpen] = useState(false)
  const [showCalculator, setShowCalculator] = useState(false)

  const [stakeFormState, setStakeFormState] = useState<StakeFormState>({
    amount: "",
    gasOption: "standard",
    autoCompound: true,
  })

  const [calculatorState, setCalculatorState] = useState<CalculatorState>({
    amount: "1000",
    period: "365",
    apy: "5",
    compounding: "daily",
  })

  const { pools, filteredPools, filters, updateFilters, resetFilters, toggleFavorite } = useStakingPools()

  const favoritesPools = pools.filter((pool) => pool.isFavorite)

  const handleStakePool = (pool: StakingPool) => {
    setSelectedPool(pool)
    setIsStakeDialogOpen(true)
  }

  const handleStakeFormChange = (newState: Partial<StakeFormState>) => {
    setStakeFormState((prev) => ({ ...prev, ...newState }))
  }

  const handleCalculatorChange = (newState: Partial<CalculatorState>) => {
    setCalculatorState((prev) => ({ ...prev, ...newState }))
  }

  const handleStakeSubmit = () => {
    // In a real app, this would submit the staking transaction
    console.log("Staking submitted:", { pool: selectedPool, form: stakeFormState })
    setStakeFormState({ amount: "", gasOption: "standard", autoCompound: true })
  }

  const handleDiscoverPools = () => {
    setActiveTab("discover")
    setShowCalculator(false)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Staking Pools</h1>
        <p className="text-muted-foreground">
          Stake your assets to earn passive income and support blockchain networks
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
       <div className="overflow-x-auto">
       <TabsList className="min-w-[350px]">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="discover">Discover</TabsTrigger>
          <TabsTrigger value="my-stakes">My Stakes</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>
       </div>

        <TabsContent value="overview">
          <OverviewTab
            onTabChange={setActiveTab}
            onShowCalculator={() => setShowCalculator(true)}
            onStakePool={handleStakePool}
            onToggleFavorite={toggleFavorite}
            favoritesPools={favoritesPools}
          />
        </TabsContent>

        <TabsContent value="discover">
          <DiscoverTab
            pools={filteredPools}
            filters={filters}
            onFiltersChange={updateFilters}
            onResetFilters={resetFilters}
            onStakePool={handleStakePool}
            onToggleFavorite={toggleFavorite}
          />
        </TabsContent>

        <TabsContent value="my-stakes">
          <MyStakesTab />
        </TabsContent>

        <TabsContent value="analytics">
          <AnalyticsTab />
        </TabsContent>
      </Tabs>

      {/* Stake Dialog */}
      <StakeDialog
        pool={selectedPool}
        isOpen={isStakeDialogOpen}
        onClose={() => setIsStakeDialogOpen(false)}
        formState={stakeFormState}
        onFormChange={handleStakeFormChange}
        onSubmit={handleStakeSubmit}
      />

      {/* Calculator Dialog */}
      <CalculatorDialog
        isOpen={showCalculator}
        onClose={() => setShowCalculator(false)}
        calculatorState={calculatorState}
        onCalculatorChange={handleCalculatorChange}
        onDiscoverPools={handleDiscoverPools}
      />
    </div>
  )
}
