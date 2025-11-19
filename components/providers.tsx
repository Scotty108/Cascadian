'use client'

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type React from "react";
import { useState } from "react";
import ThemeProvider from "@/components/theme-provider";
import { SettingsApplier } from "@/components/settings-applier";

export function Providers({ children }: { children: React.ReactNode }) {
  // Create QueryClient instance in component state to ensure it persists across renders
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5 * 60 * 1000, // 5 minutes (matches backend sync interval)
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        retry: 2,
      },
    },
  }))

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <SettingsApplier />
        {children}
      </ThemeProvider>
    </QueryClientProvider>
  );
}
