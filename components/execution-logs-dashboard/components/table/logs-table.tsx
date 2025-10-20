"use client"

import { Table, TableBody } from "@/components/ui/table"
import { LogsTableHeader } from "./table-header"
import { LogTableRow } from "./table-row"
import { Pagination } from "./pagination"
import { EmptyState } from "../shared/empty-state"
import type { ExecutionLog, SortConfig, PaginationState } from "../../types"

interface LogsTableProps {
  logs: ExecutionLog[]
  sortConfig: SortConfig
  pagination: PaginationState
  onSort: (key: keyof ExecutionLog) => void
  onPageChange: (page: number) => void
  onItemsPerPageChange: (itemsPerPage: number) => void
  onViewDetails: (log: ExecutionLog) => void
  onResetFilters?: () => void
  hasActiveFilters: boolean
}

export const LogsTable = ({
  logs,
  sortConfig,
  pagination,
  onSort,
  onPageChange,
  onItemsPerPageChange,
  onViewDetails,
  onResetFilters,
  hasActiveFilters,
}: LogsTableProps) => {
  if (logs.length === 0) {
    return <EmptyState type={hasActiveFilters ? "no-results" : "no-logs"} onReset={onResetFilters} />
  }

  return (
    <div className="space-y-4">
      <div className="border rounded-lg">
        <Table>
          <LogsTableHeader sortConfig={sortConfig} onSort={onSort} />
          <TableBody>
            {logs.map((log) => (
              <LogTableRow key={log.id} log={log} onViewDetails={onViewDetails} />
            ))}
          </TableBody>
        </Table>
      </div>

      <Pagination pagination={pagination} onPageChange={onPageChange} onItemsPerPageChange={onItemsPerPageChange} />
    </div>
  )
}
