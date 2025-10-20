"use client"

import { useState, useCallback } from "react"
import type { PaymentMethod } from "../types"
import { paymentMethods as initialPaymentMethods } from "../data"

export const usePaymentMethods = () => {
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>(initialPaymentMethods)
  const [isLoading, setIsLoading] = useState(false)

  const setAsDefault = useCallback(async (methodId: string) => {
    setIsLoading(true)
    try {
      setPaymentMethods((prev) =>
        prev.map((method) => ({
          ...method,
          default: method.id === methodId,
        })),
      )
      console.log(`Set payment method ${methodId} as default`)
    } catch (error) {
      console.error("Failed to set default payment method:", error)
    } finally {
      setIsLoading(false)
    }
  }, [])

  const removePaymentMethod = useCallback(async (methodId: string) => {
    setIsLoading(true)
    try {
      setPaymentMethods((prev) => prev.filter((method) => method.id !== methodId))
      console.log(`Removed payment method ${methodId}`)
    } catch (error) {
      console.error("Failed to remove payment method:", error)
    } finally {
      setIsLoading(false)
    }
  }, [])

  const addPaymentMethod = useCallback(async (method: Omit<PaymentMethod, "id">) => {
    setIsLoading(true)
    try {
      const newMethod: PaymentMethod = {
        ...method,
        id: `pm-${Date.now()}`,
      }

      // If this is set as default, make all others non-default
      if (newMethod.default) {
        setPaymentMethods((prev) => [...prev.map((m) => ({ ...m, default: false })), newMethod])
      } else {
        setPaymentMethods((prev) => [...prev, newMethod])
      }

      console.log("Added new payment method")
    } catch (error) {
      console.error("Failed to add payment method:", error)
    } finally {
      setIsLoading(false)
    }
  }, [])

  const updatePaymentMethod = useCallback(async (updatedMethod: PaymentMethod) => {
    setIsLoading(true)
    try {
      setPaymentMethods((prev) => {
        const updated = prev.map((method) => (method.id === updatedMethod.id ? updatedMethod : method))

        // If this method is set as default, make all others non-default
        if (updatedMethod.default) {
          return updated.map((method) => ({
            ...method,
            default: method.id === updatedMethod.id,
          }))
        }

        return updated
      })
      console.log(`Updated payment method ${updatedMethod.id}`)
    } catch (error) {
      console.error("Failed to update payment method:", error)
    } finally {
      setIsLoading(false)
    }
  }, [])

  return {
    paymentMethods,
    setAsDefault,
    removePaymentMethod,
    addPaymentMethod,
    updatePaymentMethod,
    isLoading,
  }
}
