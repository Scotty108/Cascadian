"use client"

import { useState, useCallback } from "react"
import { DashboardHeader } from "./components/header/dashboard-header"
import { FiltersPanel } from "./components/filters/filters-panel"
import { LogsTable } from "./components/table/logs-table"
import { LogDetailModal } from "./components/modals/log-detail-modal"
import { LoadingState } from "./components/shared/loading-state"
import { ErrorState } from "./components/shared/error-state"
import { useExecutionLogs } from "./hooks/use-execution-logs"
import { useFilters } from "./hooks/use-filters"
import { usePagination } from "./hooks/use-pagination"
import { exportLogs, downloadFile } from "./utils"
import type { ExecutionLog } from "./types"

export default function ExecutionLogsDashboard() {
  const [selectedLog, setSelectedLog] = useState<ExecutionLog | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)

  // Custom hooks for data management
  const { logs, isLoading, error, refreshLogs, isAutoRefresh, setAutoRefresh, refreshInterval, setRefreshInterval } =
    useExecutionLogs()

  const { filters, updateFilter, resetFilters, filteredLogs, hasActiveFilters } = useFilters(logs)

  const { pagination, sortConfig, paginatedLogs, goToPage, changeItemsPerPage, handleSort, resetPagination } =
    usePagination(filteredLogs)

  // Event handlers
  const handleViewDetails = useCallback((log: ExecutionLog) => {
    setSelectedLog(log)
    setIsModalOpen(true)
  }, [])

  const handleCloseModal = useCallback(() => {
    setIsModalOpen(false)
  }, [])

  const handleExport = useCallback(
    async (format: "csv" | "json" | "xlsx") => {
      try {
        const content = await exportLogs(filteredLogs, format)
        const timestamp = new Date().toISOString().split("T")[0]
        const filename = `execution-logs-${timestamp}.${format}`
        const mimeType = {
          csv: "text/csv",
          json: "application/json",
          xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }[format]

        downloadFile(content, filename, mimeType)
      } catch (error) {
        console.error("Export failed:", error)
        // In a real app, you'd show a toast notification here
      }
    },
    [filteredLogs],
  )

  const handleResetFilters = useCallback(() => {
    resetFilters()
    resetPagination()
  }, [resetFilters, resetPagination])

  // Loading state
  if (isLoading && logs.length === 0) {
    return <LoadingState />
  }

  // Error state
  if (error) {
    return <ErrorState error={error} onRetry={refreshLogs} />
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <DashboardHeader
        onRefresh={refreshLogs}
        isLoading={isLoading}
        isAutoRefresh={isAutoRefresh}
        onAutoRefreshChange={setAutoRefresh}
        refreshInterval={refreshInterval}
        onRefreshIntervalChange={setRefreshInterval}
        totalLogs={logs.length}
        filteredLogs={filteredLogs.length}
        onExport={handleExport}
      />

      {/* Filters */}
      <FiltersPanel
        filters={filters}
        onFilterChange={updateFilter}
        onResetFilters={handleResetFilters}
        hasActiveFilters={hasActiveFilters}
      />

      {/* Table */}
      <LogsTable
        logs={paginatedLogs}
        sortConfig={sortConfig}
        pagination={pagination}
        onSort={handleSort}
        onPageChange={goToPage}
        onItemsPerPageChange={changeItemsPerPage}
        onViewDetails={handleViewDetails}
        onResetFilters={handleResetFilters}
        hasActiveFilters={hasActiveFilters}
      />

      {/* Detail Modal */}
      <LogDetailModal log={selectedLog} isOpen={isModalOpen} onClose={handleCloseModal} />
    </div>
  )
}
