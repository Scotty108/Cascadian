"use client"

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { STATUS_OPTIONS } from "../../constants"
import type { FilterState } from "../../types"

interface AdvancedFiltersProps {
  filters: FilterState
  onFilterChange: <K extends keyof FilterState>(key: K, value: FilterState[K]) => void
}

export const AdvancedFilters = ({ filters, onFilterChange }: AdvancedFiltersProps) => {
  // These would typically come from an API or constants
  const botOptions = [
    { value: "all", label: "All Bots" },
    { value: "bot-1", label: "Trading Bot 1" },
    { value: "bot-2", label: "Trading Bot 2" },
    { value: "bot-3", label: "Trading Bot 3" },
    { value: "bot-4", label: "Trading Bot 4" },
    { value: "bot-5", label: "Trading Bot 5" },
  ]

  const actionOptions = [
    { value: "all", label: "All Actions" },
    { value: "trade_executed", label: "Trade Executed" },
    { value: "order_placed", label: "Order Placed" },
    { value: "order_cancelled", label: "Order Cancelled" },
    { value: "signal_received", label: "Signal Received" },
    { value: "analysis_completed", label: "Analysis Completed" },
  ]

  const exchangeOptions = [
    { value: "all", label: "All Exchanges" },
    { value: "binance", label: "Binance" },
    { value: "coinbase", label: "Coinbase" },
    { value: "kraken", label: "Kraken" },
    { value: "bybit", label: "Bybit" },
  ]

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
      <Select value={filters.status} onValueChange={(value) => onFilterChange("status", value)}>
        <SelectTrigger>
          <SelectValue placeholder="Select status" />
        </SelectTrigger>
        <SelectContent>
          {STATUS_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={filters.botId} onValueChange={(value) => onFilterChange("botId", value)}>
        <SelectTrigger>
          <SelectValue placeholder="Select bot" />
        </SelectTrigger>
        <SelectContent>
          {botOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={filters.action} onValueChange={(value) => onFilterChange("action", value)}>
        <SelectTrigger>
          <SelectValue placeholder="Select action" />
        </SelectTrigger>
        <SelectContent>
          {actionOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={filters.exchange} onValueChange={(value) => onFilterChange("exchange", value)}>
        <SelectTrigger>
          <SelectValue placeholder="Select exchange" />
        </SelectTrigger>
        <SelectContent>
          {exchangeOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
