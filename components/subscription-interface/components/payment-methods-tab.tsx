"use client"

import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import type { PaymentMethod } from "../types"
import { PaymentMethodItem } from "./payment-method-item"

interface PaymentMethodsTabProps {
  paymentMethods: PaymentMethod[]
  onSetAsDefault: (methodId: string) => void
  onRemove: (methodId: string) => void
  onEdit: (method: PaymentMethod) => void
  onAddNew: () => void
  isLoading?: boolean
}

export function PaymentMethodsTab({
  paymentMethods,
  onSetAsDefault,
  onRemove,
  onEdit,
  onAddNew,
  isLoading,
}: PaymentMethodsTabProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Payment Methods</CardTitle>
        <CardDescription>Manage your payment methods</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {paymentMethods.map((method) => (
          <PaymentMethodItem
            key={method.id}
            method={method}
            onSetAsDefault={onSetAsDefault}
            onRemove={onRemove}
            onEdit={onEdit}
            isLoading={isLoading}
          />
        ))}
        <Button className="mt-2" variant="outline" onClick={onAddNew}>
          <Plus className="mr-2 h-4 w-4" />
          Add Payment Method
        </Button>
      </CardContent>
    </Card>
  )
}
