"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, Filter, MoreHorizontal, Search } from "lucide-react";
import { ACCOUNT_TYPES } from "../../constants";

interface AccountsFiltersProps {
  search: string;
  accountType: string;
  onSearchChange: (value: string) => void;
  onAccountTypeChange: (value: string) => void;
}

export function AccountsFilters({ search, accountType, onSearchChange, onAccountTypeChange }: AccountsFiltersProps) {
  return (
    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
      <div className="relative w-full sm:w-auto">
        <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Search accounts..." className="pl-8 w-full sm:w-[200px]" value={search} onChange={(e) => onSearchChange(e.target.value)} />
      </div>
      <Select value={accountType} onValueChange={onAccountTypeChange}>
        <SelectTrigger className="w-full sm:w-[150px]">
          <SelectValue placeholder="Account Type" />
        </SelectTrigger>
        <SelectContent>
          {ACCOUNT_TYPES.map((type) => (
            <SelectItem key={type.value} value={type.value}>
              {type.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="icon">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[200px]" align="end">
          <div className="grid gap-2">
            <Button variant="ghost" className="justify-start" size="sm">
              <Download className="mr-2 h-4 w-4" />
              Export Data
            </Button>
            <Button variant="ghost" className="justify-start" size="sm">
              <Filter className="mr-2 h-4 w-4" />
              Advanced Filter
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
