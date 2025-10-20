export const validateEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

export const validatePhone = (phone: string): boolean => {
  const phoneRegex = /^\+?[\d\s\-$$$$]+$/;
  return phoneRegex.test(phone) && phone.replace(/\D/g, "").length >= 10;
};

export const validatePassword = (password: string): { isValid: boolean; score: number; feedback: string[] } => {
  const feedback: string[] = [];
  let score = 0;

  if (password.length >= 8) {
    score += 1;
  } else {
    feedback.push("Password must be at least 8 characters long");
  }

  if (/[A-Z]/.test(password)) {
    score += 1;
  } else {
    feedback.push("Password must contain at least one uppercase letter");
  }

  if (/[a-z]/.test(password)) {
    score += 1;
  } else {
    feedback.push("Password must contain at least one lowercase letter");
  }

  if (/\d/.test(password)) {
    score += 1;
  } else {
    feedback.push("Password must contain at least one number");
  }

  if (/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
    score += 1;
  } else {
    feedback.push("Password must contain at least one special character");
  }

  return {
    isValid: score === 5,
    score,
    feedback,
  };
};

export const getPasswordStrength = (score: number): { label: string; color: string } => {
  if (score <= 1) return { label: "Very Weak", color: "destructive" };
  if (score <= 2) return { label: "Weak", color: "destructive" };
  if (score <= 3) return { label: "Fair", color: "warning" };
  if (score <= 4) return { label: "Good", color: "default" };
  return { label: "Strong", color: "success" };
};

export const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Number.parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
};

export const formatDate = (date: string | Date, format = "MM/DD/YYYY"): string => {
  const d = new Date(date);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const year = d.getFullYear();

  switch (format) {
    case "DD/MM/YYYY":
      return `${day}/${month}/${year}`;
    case "YYYY-MM-DD":
      return `${year}-${month}-${day}`;
    case "MM/DD/YYYY":
    default:
      return `${month}/${day}/${year}`;
  }
};

export const formatTime = (date: string | Date, format: "12h" | "24h" = "12h"): string => {
  const d = new Date(date);

  if (format === "24h") {
    return d.toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  return d.toLocaleTimeString("en-US", {
    hour12: true,
    hour: "numeric",
    minute: "2-digit",
  });
};

export const generateApiKey = (): string => {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "sk_live_";
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

export const maskApiKey = (key: string): string => {
  if (key.length <= 8) return key;
  return key.substring(0, 8) + "*".repeat(key.length - 8);
};

export const getDeviceIcon = (device: string): string => {
  const deviceLower = device.toLowerCase();
  if (deviceLower.includes("iphone") || deviceLower.includes("android")) return "Smartphone";
  if (deviceLower.includes("ipad") || deviceLower.includes("tablet")) return "Tablet";
  if (deviceLower.includes("mac") || deviceLower.includes("windows") || deviceLower.includes("linux")) return "Laptop";
  return "Monitor";
};

export const getBrowserIcon = (browser: string): string => {
  const browserLower = browser.toLowerCase();
  if (browserLower.includes("chrome")) return "Chrome";
  if (browserLower.includes("firefox")) return "Firefox";
  if (browserLower.includes("safari")) return "Safari";
  if (browserLower.includes("edge")) return "Edge";
  return "Globe";
};

export const getRelativeTime = (date: string | Date): string => {
  const now = new Date();
  const past = new Date(date);
  const diffInSeconds = Math.floor((now.getTime() - past.getTime()) / 1000);

  if (diffInSeconds < 60) return "Just now";
  if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)} minutes ago`;
  if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)} hours ago`;
  if (diffInSeconds < 2592000) return `${Math.floor(diffInSeconds / 86400)} days ago`;
  if (diffInSeconds < 31536000) return `${Math.floor(diffInSeconds / 2592000)} months ago`;
  return `${Math.floor(diffInSeconds / 31536000)} years ago`;
};

export const exportToJson = (data: any, filename: string): void => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${filename}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

export const exportToCsv = (data: any[], filename: string): void => {
  if (data.length === 0) return;

  const headers = Object.keys(data[0]);
  const csvContent = [headers.join(","), ...data.map((row) => headers.map((header) => `"${row[header] || ""}"`).join(","))].join("\n");

  const blob = new Blob([csvContent], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${filename}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

export const debounce = <T extends (...args: any[]) => any>(func: T, wait: number): ((...args: Parameters<T>) => void) => {
  let timeout: NodeJS.Timeout;
  return (...args: Parameters<T>) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
};

export const deepClone = <T>(obj: T): T => {
  return JSON.parse(JSON.stringify(obj));
};

export const hasUnsavedChanges = (original: any, current: any): boolean => {
  return JSON.stringify(original) !== JSON.stringify(current);
};
