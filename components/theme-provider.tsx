"use client";
import { ThemeProvider as NextThemeProvider } from "next-themes";
import { useEffect, useState } from "react";
const ThemeProvider = ({ children }: { children: React.ReactNode }) => {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  if (!mounted) {
    return <>{children}</>;
  }
  return (
    <NextThemeProvider enableSystem={true} defaultTheme="system" attribute="class" disableTransitionOnChange>
      {children}
    </NextThemeProvider>
  );
};
export default ThemeProvider;
