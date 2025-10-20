"use client"

import { useState, useMemo, useCallback } from "react"
import type { ExecutionLog, SortConfig, PaginationState, UsePaginationReturn } from "../types"
import { DEFAULT_SORT, DEFAULT_PAGINATION } from "../constants"
import { sortLogs, paginateLogs } from "../utils"

export const usePagination = (logs: ExecutionLog[]): UsePaginationReturn => {
  const [currentPage, setCurrentPage] = useState(DEFAULT_PAGINATION.currentPage)
  const [itemsPerPage, setItemsPerPage] = useState(DEFAULT_PAGINATION.itemsPerPage)
  const [sortConfig, setSortConfig] = useState<SortConfig>(DEFAULT_SORT)

  const sortedLogs = useMemo(() => {
    return sortLogs(logs, sortConfig)
  }, [logs, sortConfig])

  const totalPages = useMemo(() => {
    return Math.ceil(logs.length / itemsPerPage)
  }, [logs.length, itemsPerPage])

  const pagination: PaginationState = useMemo(
    () => ({
      currentPage,
      totalPages,
      totalItems: logs.length,
      itemsPerPage,
    }),
    [currentPage, totalPages, logs.length, itemsPerPage],
  )

  const paginatedLogs = useMemo(() => {
    return paginateLogs(sortedLogs, currentPage, itemsPerPage)
  }, [sortedLogs, currentPage, itemsPerPage])

  const goToPage = useCallback(
    (page: number) => {
      setCurrentPage(Math.max(1, Math.min(page, totalPages)))
    },
    [totalPages],
  )

  const changeItemsPerPage = useCallback((newItemsPerPage: number) => {
    setItemsPerPage(newItemsPerPage)
    setCurrentPage(1) // Reset to first page
  }, [])

  const handleSort = useCallback((key: keyof ExecutionLog) => {
    setSortConfig((prev) => ({
      key,
      direction: prev.key === key && prev.direction === "asc" ? "desc" : "asc",
    }))
    setCurrentPage(1) // Reset to first page when sorting
  }, [])

  const resetPagination = useCallback(() => {
    setCurrentPage(DEFAULT_PAGINATION.currentPage)
    setItemsPerPage(DEFAULT_PAGINATION.itemsPerPage)
  }, [])

  // Reset to first page when logs change
  useMemo(() => {
    if (currentPage > totalPages && totalPages > 0) {
      setCurrentPage(1)
    }
  }, [currentPage, totalPages])

  return {
    pagination,
    sortConfig,
    paginatedLogs,
    goToPage,
    changeItemsPerPage,
    handleSort,
    resetPagination,
  }
}
