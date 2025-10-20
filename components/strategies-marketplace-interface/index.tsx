"use client";

import { Button } from "@/components/ui/button";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { CategoryFilters } from "./components/category-filters";
import { EmptyState } from "./components/empty-state";
import { FiltersSection } from "./components/filters-section";
import { SearchBar } from "./components/search-bar";
import { StrategyCard } from "./components/strategy-card";
import { StrategyDetailsModal } from "./components/strategy-details-modal";
import { useFilters } from "./hooks/use-filters";
import { useStrategies } from "./hooks/use-strategies";
import type { Strategy } from "./types";

export function StrategiesMarketplaceInterface() {
  const { strategies, toggleFavorite, purchaseStrategy } = useStrategies();
  const { filters, filteredAndSortedStrategies, updateFilter, resetFilters } = useFilters({ strategies });
  const [selectedStrategy, setSelectedStrategy] = useState<Strategy | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleViewDetails = (strategy: Strategy) => {
    setSelectedStrategy(strategy);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedStrategy(null);
  };

  const handlePurchase = (strategyId: string) => {
    purchaseStrategy(strategyId);
    handleCloseModal();
  };

  const featuredStrategies = filteredAndSortedStrategies.filter((s) => s.isFeatured);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Strategies Marketplace</h1>
        <p className="text-muted-foreground">Discover, compare, and acquire AI-powered trading strategies for crypto markets</p>
      </div>

      {/* Tabs */}
      <Tabs value={filters.activeTab} onValueChange={(tab) => updateFilter("activeTab", tab)}>
        <TabsContent value="all" className="space-y-6">
          {/* Search and filters */}
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <SearchBar value={filters.searchQuery} onChange={(value) => updateFilter("searchQuery", value)} />

            <FiltersSection
              selectedCategory={filters.selectedCategory}
              selectedPriceRange={filters.selectedPriceRange}
              sortOption={filters.sortOption}
              onCategoryChange={(category) => updateFilter("selectedCategory", category)}
              onPriceRangeChange={(priceRange) => updateFilter("selectedPriceRange", priceRange)}
              onSortChange={(sort) => updateFilter("sortOption", sort)}
            />
          </div>

          {/* Featured strategies */}
          {featuredStrategies.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold">Featured Strategies</h2>
                <Button variant="link" size="sm" className="gap-1 text-primary">
                  <span>View all</span>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {featuredStrategies.slice(0, 3).map((strategy) => (
                  <StrategyCard key={strategy.id} strategy={strategy} onToggleFavorite={toggleFavorite} onViewDetails={handleViewDetails} />
                ))}
              </div>
            </div>
          )}

          {/* Category filters */}
          <CategoryFilters selectedCategory={filters.selectedCategory} onCategoryChange={(category) => updateFilter("selectedCategory", category)} />

          {/* All strategies */}
          <div className="space-y-4">
            <h2 className="text-xl font-semibold">All Strategies</h2>

            {filteredAndSortedStrategies.length === 0 ? (
              <EmptyState onResetFilters={resetFilters} />
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {filteredAndSortedStrategies.map((strategy) => (
                  <StrategyCard key={strategy.id} strategy={strategy} onToggleFavorite={toggleFavorite} onViewDetails={handleViewDetails} />
                ))}
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="featured" className="space-y-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredAndSortedStrategies
              .filter((s) => s.isFeatured)
              .map((strategy) => (
                <StrategyCard key={strategy.id} strategy={strategy} onToggleFavorite={toggleFavorite} onViewDetails={handleViewDetails} />
              ))}
          </div>
        </TabsContent>

        <TabsContent value="favorites" className="space-y-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredAndSortedStrategies
              .filter((s) => s.isFavorite)
              .map((strategy) => (
                <StrategyCard key={strategy.id} strategy={strategy} onToggleFavorite={toggleFavorite} onViewDetails={handleViewDetails} />
              ))}
          </div>
        </TabsContent>

        <TabsContent value="purchased" className="space-y-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredAndSortedStrategies
              .filter((s) => s.isPurchased)
              .map((strategy) => (
                <StrategyCard key={strategy.id} strategy={strategy} onToggleFavorite={toggleFavorite} onViewDetails={handleViewDetails} />
              ))}
          </div>
        </TabsContent>
      </Tabs>

      {/* Strategy Details Modal */}
      <StrategyDetailsModal strategy={selectedStrategy} isOpen={isModalOpen} onClose={handleCloseModal} onToggleFavorite={toggleFavorite} onPurchase={handlePurchase} />
    </div>
  );
}
