"use client"

import { EnhancedPumpAlertsTable } from "./enhanced-pump-alerts-table"
import type { PumpAlert } from "../../types"

interface PumpAlertsTableProps {
  alerts: PumpAlert[]
  selectedAlert: number | null
  onSelectAlert: (id: number) => void
  favorites: Set<string>
  onToggleFavorite: (symbol: string) => void
  sortBy: "timestamp" | "priceChange" | "volumeChange" | "confidence" | "risk"
  sortOrder: "asc" | "desc"
  onUpdateSorting: (sortBy: any, sortOrder?: "asc" | "desc") => void
}

export function PumpAlertsTable(props: PumpAlertsTableProps) {
  return <EnhancedPumpAlertsTable {...props} />
}
