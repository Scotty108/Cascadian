"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { PriceRange, SortOption, StrategyCategory } from "../types";

interface FiltersSectionProps {
  selectedCategory: StrategyCategory;
  selectedPriceRange: PriceRange;
  sortOption: SortOption;
  onCategoryChange: (category: StrategyCategory) => void;
  onPriceRangeChange: (priceRange: PriceRange) => void;
  onSortChange: (sort: SortOption) => void;
}

export function FiltersSection({ selectedCategory, selectedPriceRange, sortOption, onCategoryChange, onPriceRangeChange, onSortChange }: FiltersSectionProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={selectedCategory} onValueChange={onCategoryChange}>
        <SelectTrigger className="h-9 w-[130px]">
          <SelectValue placeholder="Category" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="All">All Categories</SelectItem>
          <SelectItem value="AI-Powered">AI-Powered</SelectItem>
          <SelectItem value="Trend Following">Trend Following</SelectItem>
          <SelectItem value="Mean Reversion">Mean Reversion</SelectItem>
          <SelectItem value="Breakout">Breakout</SelectItem>
          <SelectItem value="Scalping">Scalping</SelectItem>
          <SelectItem value="Grid Trading">Grid Trading</SelectItem>
          <SelectItem value="DCA">DCA</SelectItem>
          <SelectItem value="Arbitrage">Arbitrage</SelectItem>
        </SelectContent>
      </Select>

      <Select value={selectedPriceRange} onValueChange={onPriceRangeChange}>
        <SelectTrigger className="h-9 w-[130px]">
          <SelectValue placeholder="Price" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="All">All Prices</SelectItem>
          <SelectItem value="Free">Free</SelectItem>
          <SelectItem value="Under $50">Under $50</SelectItem>
          <SelectItem value="$50-$100">$50-$100</SelectItem>
          <SelectItem value="$100-$500">$100-$500</SelectItem>
          <SelectItem value="Over $500">Over $500</SelectItem>
        </SelectContent>
      </Select>

      <Select value={sortOption} onValueChange={onSortChange}>
        <SelectTrigger className="h-9 w-[180px]">
          <SelectValue placeholder="Sort by" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="Most Popular">Most Popular</SelectItem>
          <SelectItem value="Highest Rated">Highest Rated</SelectItem>
          <SelectItem value="Newest">Newest</SelectItem>
          <SelectItem value="Highest Returns">Highest Returns</SelectItem>
          <SelectItem value="Lowest Risk">Lowest Risk</SelectItem>
          <SelectItem value="Price: Low to High">Price: Low to High</SelectItem>
          <SelectItem value="Price: High to Low">Price: High to Low</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
