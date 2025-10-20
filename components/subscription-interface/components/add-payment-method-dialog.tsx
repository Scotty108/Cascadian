"use client"

import type React from "react"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import type { PaymentMethod } from "../types"

interface AddPaymentMethodDialogProps {
  isOpen: boolean
  onClose: () => void
  onAdd: (method: Omit<PaymentMethod, "id">) => void
  isLoading?: boolean
}

export function AddPaymentMethodDialog({ isOpen, onClose, onAdd, isLoading }: AddPaymentMethodDialogProps) {
  const [formData, setFormData] = useState({
    type: "",
    cardNumber: "",
    expiryMonth: "",
    expiryYear: "",
    cvv: "",
    name: "",
    setAsDefault: false,
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    const last4 = formData.cardNumber.slice(-4)
    const expiry = `${formData.expiryMonth}/${formData.expiryYear}`

    onAdd({
      type: formData.type,
      last4,
      expiry,
      default: formData.setAsDefault,
    })

    // Reset form
    setFormData({
      type: "",
      cardNumber: "",
      expiryMonth: "",
      expiryYear: "",
      cvv: "",
      name: "",
      setAsDefault: false,
    })

    onClose()
  }

  const isFormValid =
    formData.type &&
    formData.cardNumber.length >= 16 &&
    formData.expiryMonth &&
    formData.expiryYear &&
    formData.cvv.length >= 3 &&
    formData.name

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Add Payment Method</DialogTitle>
          <DialogDescription>Add a new payment method to your account.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="card-type">Card Type</Label>
            <Select value={formData.type} onValueChange={(value) => setFormData({ ...formData, type: value })}>
              <SelectTrigger>
                <SelectValue placeholder="Select card type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Visa">Visa</SelectItem>
                <SelectItem value="Mastercard">Mastercard</SelectItem>
                <SelectItem value="American Express">American Express</SelectItem>
                <SelectItem value="Discover">Discover</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="card-number">Card Number</Label>
            <Input
              id="card-number"
              placeholder="1234 5678 9012 3456"
              value={formData.cardNumber}
              onChange={(e) => {
                const value = e.target.value.replace(/\D/g, "")
                if (value.length <= 16) {
                  setFormData({ ...formData, cardNumber: value })
                }
              }}
              maxLength={19}
            />
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

          <div className="space-y-2">
            <Label htmlFor="cvv">CVV</Label>
            <Input
              id="cvv"
              placeholder="123"
              value={formData.cvv}
              onChange={(e) => {
                const value = e.target.value.replace(/\D/g, "")
                if (value.length <= 4) {
                  setFormData({ ...formData, cvv: value })
                }
              }}
              maxLength={4}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="cardholder-name">Cardholder Name</Label>
            <Input
              id="cardholder-name"
              placeholder="John Doe"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            />
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
            <Button type="submit" disabled={!isFormValid || isLoading}>
              {isLoading ? "Adding..." : "Add Payment Method"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
