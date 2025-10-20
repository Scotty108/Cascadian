"use client"

import type React from "react"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import type { PaymentMethod } from "../types"

interface EditPaymentMethodDialogProps {
  isOpen: boolean
  onClose: () => void
  onUpdate: (method: PaymentMethod) => void
  method: PaymentMethod | null
  isLoading?: boolean
}

export function EditPaymentMethodDialog({
  isOpen,
  onClose,
  onUpdate,
  method,
  isLoading,
}: EditPaymentMethodDialogProps) {
  const [formData, setFormData] = useState({
    expiryMonth: "",
    expiryYear: "",
    setAsDefault: false,
  })

  useEffect(() => {
    if (method) {
      const [month, year] = method.expiry.split("/")
      setFormData({
        expiryMonth: month,
        expiryYear: year,
        setAsDefault: method.default,
      })
    }
  }, [method])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    if (!method) return

    const updatedMethod: PaymentMethod = {
      ...method,
      expiry: `${formData.expiryMonth}/${formData.expiryYear}`,
      default: formData.setAsDefault,
    }

    onUpdate(updatedMethod)
    onClose()
  }

  if (!method) return null

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Edit Payment Method</DialogTitle>
          <DialogDescription>Update your payment method details.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Card Information</Label>
            <div className="rounded-md border p-3 bg-muted/50">
              <p className="font-medium">
                {method.type} •••• {method.last4}
              </p>
              <p className="text-sm text-muted-foreground">Card number cannot be changed</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="expiry-month">Expiry Month</Label>
              <Select
                value={formData.expiryMonth}
                onValueChange={(value) => setFormData({ ...formData, expiryMonth: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="MM" />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 12 }, (_, i) => {
                    const month = (i + 1).toString().padStart(2, "0")
                    return (
                      <SelectItem key={month} value={month}>
                        {month}
                      </SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="expiry-year">Expiry Year</Label>
              <Select
                value={formData.expiryYear}
                onValueChange={(value) => setFormData({ ...formData, expiryYear: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="YY" />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 10 }, (_, i) => {
                    const year = (new Date().getFullYear() + i).toString().slice(-2)
                    return (
                      <SelectItem key={year} value={year}>
                        {year}
                      </SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="set-default"
              checked={formData.setAsDefault}
              onCheckedChange={(checked) => setFormData({ ...formData, setAsDefault: checked as boolean })}
            />
            <Label htmlFor="set-default">Set as default payment method</Label>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? "Updating..." : "Update Payment Method"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
