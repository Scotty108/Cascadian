export interface ExecutionLog {
  id: string
  timestamp: Date
  level: "error" | "warning" | "info" | "debug"
  botId: string
  botName: string
  action: string
  status: "success" | "failed" | "pending" | "cancelled"
  message: string
  duration?: number
  details?: {
    pair?: string
    exchange?: string
    side?: "buy" | "sell"
    amount?: number
    price?: number
    orderId?: string
    error?: string
    stackTrace?: string
    metadata?: Record<string, any>
  }
}

export interface FilterState {
  search: string
  level: string
  status: string
  botId: string
  action: string
  exchange: string
  dateRange: {
    from: Date | null
    to: Date | null
  }
  showAdvanced: boolean
}

export interface SortConfig {
  key: keyof ExecutionLog
  direction: "asc" | "desc"
}

export interface PaginationState {
  currentPage: number
  totalPages: number
  totalItems: number
  itemsPerPage: number
}

export interface UseExecutionLogsReturn {
  logs: ExecutionLog[]
  isLoading: boolean
  error: string | null
  refreshLogs: () => void
  isAutoRefresh: boolean
  setAutoRefresh: (enabled: boolean) => void
  refreshInterval: number
  setRefreshInterval: (interval: number) => void
}

export interface UseFiltersReturn {
  filters: FilterState
  updateFilter: <K extends keyof FilterState>(key: K, value: FilterState[K]) => void
  resetFilters: () => void
  filteredLogs: ExecutionLog[]
  hasActiveFilters: boolean
}

export interface UsePaginationReturn {
  pagination: PaginationState
  sortConfig: SortConfig
  paginatedLogs: ExecutionLog[]
  goToPage: (page: number) => void
  changeItemsPerPage: (itemsPerPage: number) => void
  handleSort: (key: keyof ExecutionLog) => void
  resetPagination: () => void
}
