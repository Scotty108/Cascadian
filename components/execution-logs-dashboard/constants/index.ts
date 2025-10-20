import type { FilterState, SortConfig } from "../types"

// Default filter state
export const DEFAULT_FILTERS: FilterState = {
  search: "",
  level: "all",
  status: "all",
  botId: "all",
  action: "all",
  exchange: "all",
  dateRange: {
    from: null,
    to: null,
  },
  showAdvanced: false,
}

// Default sort configuration
export const DEFAULT_SORT: SortConfig = {
  key: "timestamp",
  direction: "desc",
}

// Default pagination state
export const DEFAULT_PAGINATION = {
  currentPage: 1,
  itemsPerPage: 25,
}

// Log level options
export const LOG_LEVELS = [
  { value: "all", label: "All Levels" },
  { value: "error", label: "Error" },
  { value: "warning", label: "Warning" },
  { value: "info", label: "Info" },
  { value: "debug", label: "Debug" },
]

// Status options
export const STATUS_OPTIONS = [
  { value: "all", label: "All Statuses" },
  { value: "success", label: "Success" },
  { value: "failed", label: "Failed" },
  { value: "pending", label: "Pending" },
  { value: "cancelled", label: "Cancelled" },
]

// Items per page options
export const ITEMS_PER_PAGE_OPTIONS = [
  { value: 10, label: "10 per page" },
  { value: 25, label: "25 per page" },
  { value: 50, label: "50 per page" },
  { value: 100, label: "100 per page" },
]

// Export format options
export const EXPORT_FORMATS = [
  { value: "csv", label: "CSV", icon: "FileText" },
  { value: "json", label: "JSON", icon: "Code" },
  { value: "xlsx", label: "Excel", icon: "Table" },
]

// Auto-refresh interval options (in milliseconds)
export const REFRESH_INTERVALS = [
  { value: 5000, label: "5 seconds" },
  { value: 10000, label: "10 seconds" },
  { value: 30000, label: "30 seconds" },
  { value: 60000, label: "1 minute" },
  { value: 300000, label: "5 minutes" },
]
