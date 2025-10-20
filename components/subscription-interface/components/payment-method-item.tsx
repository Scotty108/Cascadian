"use client"

import { CreditCard, MoreHorizontal, Trash2, Star, Edit } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Badge } from "@/components/ui/badge"
import type { PaymentMethod } from "../types"

interface PaymentMethodItemProps {
  method: PaymentMethod
  onSetAsDefault: (methodId: string) => void
  onRemove: (methodId: string) => void
  onEdit: (method: PaymentMethod) => void
  isLoading?: boolean
}

export function PaymentMethodItem({ method, onSetAsDefault, onRemove, onEdit, isLoading }: PaymentMethodItemProps) {
  const getCardIcon = (type: string) => {
    switch (type.toLowerCase()) {
      case "visa":
        return "💳"
      case "mastercard":
        return "💳"
      case "amex":
        return "💳"
      default:
        return "💳"
    }
  }

  return (
    <Card>
      <CardContent className="flex items-center justify-between p-4">
        <div className="flex items-center space-x-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
            <CreditCard className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-medium">
                {method.type} •••• {method.last4}
              </span>
              {method.default && <Badge variant="secondary">Default</Badge>}
            </div>
            <p className="text-sm text-muted-foreground">Expires {method.expiry}</p>
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" disabled={isLoading}>
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onEdit(method)}>
              <Edit className="mr-2 h-4 w-4" />
              Edit
            </DropdownMenuItem>
            {!method.default && (
              <DropdownMenuItem onClick={() => onSetAsDefault(method.id)}>
                <Star className="mr-2 h-4 w-4" />
                Set as Default
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              onClick={() => onRemove(method.id)}
              className="text-destructive"
              disabled={method.default}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Remove
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </CardContent>
    </Card>
  )
}
