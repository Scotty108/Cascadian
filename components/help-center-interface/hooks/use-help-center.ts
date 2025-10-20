"use client"

import { useState, useMemo } from "react"
import type { HelpCenterState } from "../types"
import { POPULAR_ARTICLES } from "../data"
import { filterArticles } from "../utils"

export const useHelpCenter = () => {
  const [state, setState] = useState<HelpCenterState>({
    searchQuery: "",
    selectedCategory: "all",
    filteredArticles: POPULAR_ARTICLES,
    isLoading: false,
    error: null,
  })

  const filteredArticles = useMemo(() => {
    return filterArticles(POPULAR_ARTICLES, state.searchQuery, state.selectedCategory)
  }, [state.searchQuery, state.selectedCategory])

  const setSearchQuery = (query: string) => {
    setState((prev) => ({ ...prev, searchQuery: query }))
  }

  const setSelectedCategory = (category: string) => {
    setState((prev) => ({ ...prev, selectedCategory: category }))
  }

  const clearSearch = () => {
    setState((prev) => ({ ...prev, searchQuery: "", selectedCategory: "all" }))
  }

  return {
    ...state,
    filteredArticles,
    setSearchQuery,
    setSelectedCategory,
    clearSearch,
  }
}
