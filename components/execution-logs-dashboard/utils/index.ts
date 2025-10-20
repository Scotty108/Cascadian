import type { ExecutionLog } from "../types";

export const formatTimestamp = (timestamp: Date): string => {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(timestamp);
};

export const formatDuration = (duration: number): string => {
  if (duration < 1000) {
    return `${duration}ms`;
  }
  if (duration < 60000) {
    return `${(duration / 1000).toFixed(1)}s`;
  }
  return `${(duration / 60000).toFixed(1)}m`;
};

export const formatAmount = (amount: number): string => {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 8,
  }).format(amount);
};

export const filterLogs = (logs: ExecutionLog[], filters: any): ExecutionLog[] => {
  return logs.filter((log) => {
    // Search filter
    if (filters.search) {
      const searchTerm = filters.search.toLowerCase();
      const searchableText = [log.message, log.botName, log.action, log.details?.pair, log.details?.exchange, log.details?.orderId].filter(Boolean).join(" ").toLowerCase();

      if (!searchableText.includes(searchTerm)) {
        return false;
      }
    }

    // Level filter
    if (filters.level !== "all" && log.level !== filters.level) {
      return false;
    }

    // Status filter
    if (filters.status !== "all" && log.status !== filters.status) {
      return false;
    }

    // Bot filter
    if (filters.botId !== "all" && log.botId !== filters.botId) {
      return false;
    }

    // Action filter
    if (filters.action !== "all" && log.action !== filters.action) {
      return false;
    }

    // Exchange filter
    if (filters.exchange !== "all" && log.details?.exchange !== filters.exchange) {
      return false;
    }

    // Date range filter
    if (filters.dateRange.from && log.timestamp < filters.dateRange.from) {
      return false;
    }
    if (filters.dateRange.to && log.timestamp > filters.dateRange.to) {
      return false;
    }

    return true;
  });
};

export const sortLogs = (logs: ExecutionLog[], sortConfig: any): ExecutionLog[] => {
  return [...logs].sort((a, b) => {
    const aValue = a[sortConfig.key as keyof ExecutionLog];
    const bValue = b[sortConfig.key as keyof ExecutionLog];

    if (aValue === bValue) return 0;

    let comparison = 0;
    if (aValue instanceof Date && bValue instanceof Date) {
      comparison = aValue.getTime() - bValue.getTime();
    } else if (typeof aValue === "string" && typeof bValue === "string") {
      comparison = aValue.localeCompare(bValue);
    } else if (typeof aValue === "number" && typeof bValue === "number") {
      comparison = aValue - bValue;
    } else {
      comparison = String(aValue).localeCompare(String(bValue));
    }

    return sortConfig.direction === "asc" ? comparison : -comparison;
  });
};

export const paginateLogs = (logs: ExecutionLog[], page: number, itemsPerPage: number): ExecutionLog[] => {
  const startIndex = (page - 1) * itemsPerPage;
  return logs.slice(startIndex, startIndex + itemsPerPage);
};

export const exportLogs = async (logs: ExecutionLog[], format: "csv" | "json" | "xlsx"): Promise<string | Blob> => {
  switch (format) {
    case "json":
      return JSON.stringify(logs, null, 2);

    case "csv":
      const headers = ["Timestamp", "Level", "Bot Name", "Bot ID", "Action", "Status", "Duration", "Message", "Pair", "Exchange", "Side", "Amount", "Price", "Order ID"];

      const csvRows = logs.map((log) => [
        log.timestamp.toISOString(),
        log.level,
        log.botName,
        log.botId,
        log.action,
        log.status,
        log.duration || "",
        `"${log.message.replace(/"/g, '""')}"`,
        log.details?.pair || "",
        log.details?.exchange || "",
        log.details?.side || "",
        log.details?.amount || "",
        log.details?.price || "",
        log.details?.orderId || "",
      ]);

      return [headers.join(","), ...csvRows.map((row) => row.join(","))].join("\n");

    case "xlsx":
      // For XLSX, we'll return CSV format as a fallback
      // In a real implementation, you'd use a library like xlsx
      return exportLogs(logs, "csv");

    default:
      throw new Error(`Unsupported export format: ${format}`);
  }
};

export const downloadFile = (content: string | Blob, filename: string, mimeType: string): void => {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

// Mock data generator for development
export const generateMockLogs = (count = 100): ExecutionLog[] => {
  const levels: ExecutionLog["level"][] = ["error", "warning", "info", "debug"];
  const statuses: ExecutionLog["status"][] = ["success", "failed", "pending", "cancelled"];
  const actions = ["trade_executed", "order_placed", "order_cancelled", "signal_received", "analysis_completed"];
  const exchanges = ["binance", "coinbase", "kraken", "bybit"];
  const pairs = ["BTC/USDT", "ETH/USDT", "ADA/USDT", "SOL/USDT", "DOT/USDT"];
  const sides: ("buy" | "sell")[] = ["buy", "sell"];

  return Array.from({ length: count }, (_, i) => {
    const level = levels[Math.floor(Math.random() * levels.length)];
    const status = statuses[Math.floor(Math.random() * statuses.length)];
    const action = actions[Math.floor(Math.random() * actions.length)];
    const exchange = exchanges[Math.floor(Math.random() * exchanges.length)];
    const pair = pairs[Math.floor(Math.random() * pairs.length)];
    const side = sides[Math.floor(Math.random() * sides.length)];

    return {
      id: `log-${i + 1}`,
      timestamp: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000), // Last 7 days
      level,
      botId: `bot-${Math.floor(Math.random() * 10) + 1}`,
      botName: `Trading Bot ${Math.floor(Math.random() * 10) + 1}`,
      action,
      status,
      message: `${action.replace("_", " ")} ${status} for ${pair} on ${exchange}`,
      duration: Math.random() * 5000,
      details: {
        pair,
        exchange,
        side,
        amount: Math.random() * 10,
        price: Math.random() * 50000,
        orderId: `order-${Math.random().toString(36).substr(2, 9)}`,
        ...(level === "error" && {
          error: "Connection timeout",
          stackTrace: "Error: Connection timeout\n    at fetch (/app/lib/exchange.js:45:12)",
        }),
        metadata: {
          userId: `user-${Math.floor(Math.random() * 100)}`,
          sessionId: `session-${Math.random().toString(36).substr(2, 9)}`,
        },
      },
    };
  });
};
