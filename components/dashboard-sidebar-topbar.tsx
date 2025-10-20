"use client";
import { cn } from "@/lib/utils";
import React, { useState } from "react";
import { DashboardSidebar } from "./dashboardSidebar";
import { Topbar } from "./topbar";

const DashboardSidebarTopbar = ({ children }: { children: React.ReactNode }) => {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className=" h-screen w-full bg-background relative">
      <DashboardSidebar collapsed={collapsed} setCollapsed={setCollapsed} />

      <div className={cn("duration-300", collapsed ? "translate-x-[72px] max-w-[calc(100%-72px)]" : "translate-x-[72px] max-w-[calc(100%-240px)] md:translate-x-[240px] md:max-w-[calc(100%-240px)]")}>
        <Topbar />
        <main className="p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
};

export default DashboardSidebarTopbar;
