"use client";
import { cn } from "@/lib/utils";
import React, { useState } from "react";
import { DashboardSidebar } from "./dashboardSidebar";
import { Topbar } from "./topbar";

const DashboardSidebarTopbar = ({ children }: { children: React.ReactNode }) => {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="min-h-screen w-full relative bg-[#F1F1F1] dark:bg-[#0a0a0a] animated-blob-bg">
      <div className="relative z-10">
        <DashboardSidebar collapsed={collapsed} setCollapsed={setCollapsed} />

        <div className={cn("duration-300 min-h-screen", collapsed ? "translate-x-[72px] max-w-[calc(100%-72px)]" : "translate-x-[72px] max-w-[calc(100%-280px)] md:translate-x-[280px] md:max-w-[calc(100%-280px)]")}>
          <Topbar />
          <main className="px-4 pb-4 md:px-6 md:pb-6">{children}</main>
        </div>
      </div>
    </div>
  );
};

export default DashboardSidebarTopbar;
