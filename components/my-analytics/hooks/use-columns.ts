"use client"

import { useState } from "react"
import type { ColumnKey, ColumnVisibility } from "../types"

export function useColumns() {
  const [visibleColumns, setVisibleColumns] = useState<ColumnVisibility>({
    name: true,
    status: true,
    trades: true,
    winRate: true,
    profit: true,
    profitPercent: true,
    volume: true,
    timeframe: true,
    actions: true,
  })

  const handleColumnVisibilityChange = (column: ColumnKey) => {
    setVisibleColumns((prev) => ({
      ...prev,
      [column]: !prev[column],
    }))
  }

  const resetColumns = () => {
    setVisibleColumns({
      name: true,
      status: true,
      trades: true,
      winRate: true,
      profit: true,
      profitPercent: true,
      volume: true,
      timeframe: true,
      actions: true,
    })
  }

  return {
    visibleColumns,
    handleColumnVisibilityChange,
    resetColumns,
  }
}
