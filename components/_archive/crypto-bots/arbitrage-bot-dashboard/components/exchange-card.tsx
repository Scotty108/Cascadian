"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle, Check, Cog, Lock, X } from "lucide-react";
import type { Exchange } from "../types";
import Image from "next/image";

interface ExchangeCardProps {
  exchange: Exchange;
  onConnect?: (exchangeId: string) => void;
  onDisconnect?: (exchangeId: string) => void;
}

export function ExchangeCard({ exchange, onConnect, onDisconnect }: ExchangeCardProps) {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="h-8 w-8 overflow-hidden rounded-full">
              <Image src={exchange.logo || "/placeholder.svg"} alt={exchange.name} className="h-full w-full object-cover" width={32} height={32} />
            </div>
            <div>
              <CardTitle className="text-base">{exchange.name}</CardTitle>
              <CardDescription>{exchange.status === "connected" ? "Connected" : exchange.status === "error" ? "Error" : "Disconnected"}</CardDescription>
            </div>
          </div>
          <Badge variant={exchange.status === "connected" ? "default" : exchange.status === "error" ? "destructive" : "secondary"} className="px-2 py-0">
            {exchange.status === "connected" ? <Check className="mr-1 h-3 w-3" /> : exchange.status === "error" ? <AlertCircle className="mr-1 h-3 w-3" /> : <X className="mr-1 h-3 w-3" />}
            {exchange.status.charAt(0).toUpperCase() + exchange.status.slice(1)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        <div className="flex items-center justify-between">
          <div className="text-sm">API Key</div>
          <div className="flex items-center">
            {exchange.apiKeyConfigured ? (
              <Badge variant="outline" className="flex items-center gap-1 px-2 py-0">
                <Lock className="h-3 w-3" />
                Configured
              </Badge>
            ) : (
              <Badge variant="outline" className="bg-muted px-2 py-0 text-muted-foreground">
                Not Set
              </Badge>
            )}
          </div>
        </div>
      </CardContent>
      <CardFooter className="flex justify-between p-4 pt-0">
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => {
            if (exchange.status === "connected") {
              onDisconnect?.(exchange.id);
            } else {
              onConnect?.(exchange.id);
            }
          }}
        >
          {exchange.status === "connected" ? "Disconnect" : "Connect"}
        </Button>
        <Button variant="outline" size="sm" className="w-full">
          <Cog className="mr-1 h-3 w-3" />
          Configure
        </Button>
      </CardFooter>
    </Card>
  );
}
