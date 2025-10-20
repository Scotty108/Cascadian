"use client"

import { ProtocolFiltersComponent } from "../protocol-filters"
import { ProtocolsTable } from "../protocols-table"
import { ProtocolDetails } from "../protocol-details"
import type { Protocol, ProtocolFilters, SortConfig } from "../../types"

interface ProtocolsTabProps {
  protocols: Protocol[]
  filters: ProtocolFilters
  sortConfig: SortConfig
  favorites: string[]
  selectedProtocol: string | null
  onFiltersChange: (filters: Partial<ProtocolFilters>) => void
  onRiskFilterToggle: (risk: string) => void
  onSortChange: (field: string) => void
  onFavoriteToggle: (id: string) => void
  onProtocolSelect: (id: string) => void
  onProtocolClose: () => void
  getProtocolDetails: (id: string) => Protocol | undefined
}

export function ProtocolsTab({
  protocols,
  filters,
  sortConfig,
  favorites,
  selectedProtocol,
  onFiltersChange,
  onRiskFilterToggle,
  onSortChange,
  onFavoriteToggle,
  onProtocolSelect,
  onProtocolClose,
  getProtocolDetails,
}: ProtocolsTabProps) {
  const selectedProtocolData = selectedProtocol ? getProtocolDetails(selectedProtocol) : null

  return (
    <div className="space-y-4">
      <ProtocolFiltersComponent
        filters={filters}
        onFiltersChange={onFiltersChange}
        onRiskFilterToggle={onRiskFilterToggle}
      />

      <ProtocolsTable
        protocols={protocols}
        favorites={favorites}
        sortConfig={sortConfig}
        onSortChange={onSortChange}
        onFavoriteToggle={onFavoriteToggle}
        onProtocolSelect={onProtocolSelect}
      />

      {selectedProtocolData && <ProtocolDetails protocol={selectedProtocolData} onClose={onProtocolClose} />}
    </div>
  )
}
