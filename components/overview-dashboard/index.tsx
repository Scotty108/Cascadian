"use client"

import { PageHeader } from "./components/header/page-header"
import { StatsCards } from "./components/stats/stats-cards"
import { AssetsSection } from "./components/assets/assets-section"
import { AccountsSection } from "./components/accounts/accounts-section"
import { useOverviewDashboard } from "./hooks/use-overview-dashboard"

export function OverviewDashboard() {
  const { dateRange, setDateRange, filters, updateFilter, filteredAssets, filteredAccounts, totalPortfolioValue } =
    useOverviewDashboard()

  return (
    <div className="space-y-6">
      <PageHeader dateRange={dateRange} onDateRangeChange={setDateRange} />

      <StatsCards />

      <AssetsSection
        assets={filteredAssets}
        totalPortfolioValue={totalPortfolioValue}
        filters={filters}
        onFilterChange={updateFilter}
      />

      <AccountsSection accounts={filteredAccounts} filters={filters} onFilterChange={updateFilter} />
    </div>
  )
}
