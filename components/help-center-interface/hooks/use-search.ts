"use client"

import { useState, useCallback } from "react"

export const useSearch = (onSearch?: (query: string) => void) => {
  const [searchQuery, setSearchQuery] = useState("")
  const [isSearching, setIsSearching] = useState(false)

  const handleSearch = useCallback(
    async (query: string) => {
      setSearchQuery(query)
      setIsSearching(true)

      try {
        // Simulate search delay
        await new Promise((resolve) => setTimeout(resolve, 300))
        onSearch?.(query)
      } catch (error) {
        console.error("Search error:", error)
      } finally {
        setIsSearching(false)
      }
    },
    [onSearch],
  )

  const clearSearch = useCallback(() => {
    setSearchQuery("")
    onSearch?.("")
  }, [onSearch])

  return {
    searchQuery,
    isSearching,
    handleSearch,
    clearSearch,
  }
}
