"use client"

import { useState, useCallback } from "react"
import type { Invoice } from "../types"
import { billingHistory as initialBillingHistory } from "../data"

export const useBilling = () => {
  const [billingHistory] = useState<Invoice[]>(initialBillingHistory)
  const [isDownloading, setIsDownloading] = useState<string | null>(null)

  const downloadInvoice = useCallback(async (invoiceId: string) => {
    setIsDownloading(invoiceId)
    try {
      // Simulate download
      await new Promise((resolve) => setTimeout(resolve, 1000))
      console.log(`Downloading invoice ${invoiceId}`)
      // Implement actual download logic
    } catch (error) {
      console.error("Failed to download invoice:", error)
    } finally {
      setIsDownloading(null)
    }
  }, [])

  const viewInvoice = useCallback((invoiceId: string) => {
    console.log(`Viewing invoice ${invoiceId}`)
    // Implement view logic
  }, [])

  return {
    billingHistory,
    downloadInvoice,
    viewInvoice,
    isDownloading,
  }
}
