"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useSearchData } from "@/hooks/use-search-data";
import { cn } from "@/lib/utils";
import { ArrowRight, Bot, Clock, Hash, Search, TrendingUp } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export function SearchBar() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const router = useRouter();
  const { searchResults, recentSearches, addRecentSearch, isLoading } = useSearchData(query);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((open) => !open);
      }
    };

    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  const handleSelect = (item: any) => {
    addRecentSearch(item);
    setOpen(false);
    setQuery("");
    router.push(item.href);
  };

  const handleSearch = (value: string) => {
    setQuery(value);
    if (!open && value) {
      setOpen(true);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} className="w-full min-w-[280px] justify-start text-sm font-normal lg:w-[370px] rounded-full border border-zinc-200 dark:border-zinc-700 bg-gradient-to-r from-white to-zinc-50 dark:from-zinc-800 dark:to-zinc-900 text-muted-foreground hover:from-zinc-50 hover:to-zinc-100 dark:hover:from-zinc-700 dark:hover:to-zinc-800">
          <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
          <span className="truncate">{query || "Search"}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-0 lg:w-[370px]" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search markets, assets, bots..." value={query} onValueChange={handleSearch} />
          <CommandList>
            {!query && recentSearches.length > 0 && (
              <>
                <CommandGroup heading="Recent Searches">
                  {recentSearches.slice(0, 3).map((item) => (
                    <CommandItem key={`recent-${item.id}`} value={item.title} onSelect={() => handleSelect(item)} className="flex items-center gap-2">
                      <Clock className="h-4 w-4 opacity-50" />
                      <div className="flex flex-1 items-center justify-between">
                        <span>{item.title}</span>
                        <Badge variant="secondary" className="text-xs">
                          {item.category}
                        </Badge>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
                <CommandSeparator />
              </>
            )}

            {!query && (
              <CommandGroup heading="Quick Actions">
                <CommandItem onSelect={() => handleSelect({ href: "/trading", title: "Trading", category: "Page" })}>
                  <TrendingUp className="mr-2 h-4 w-4" />
                  <span>Go to Trading</span>
                </CommandItem>
                <CommandItem onSelect={() => handleSelect({ href: "/ai-bot", title: "AI Bot", category: "Page" })}>
                  <Bot className="mr-2 h-4 w-4" />
                  <span>AI Bot Dashboard</span>
                </CommandItem>
                <CommandItem onSelect={() => handleSelect({ href: "/portfolio-tracker", title: "Portfolio", category: "Page" })}>
                  <Hash className="mr-2 h-4 w-4" />
                  <span>Portfolio Tracker</span>
                </CommandItem>
              </CommandGroup>
            )}

            {query && (
              <>
                {isLoading ? (
                  <div className="py-6 text-center text-sm">
                    <div className="animate-pulse">Searching...</div>
                  </div>
                ) : (
                  <>
                    {searchResults.markets.length > 0 && (
                      <CommandGroup heading="Markets">
                        {searchResults.markets.slice(0, 3).map((market) => (
                          <CommandItem key={`market-${market.id}`} value={market.title} onSelect={() => handleSelect(market)} className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-orange-100 text-xs font-medium text-orange-600 dark:bg-orange-900 dark:text-orange-300">
                                {market.symbol?.split("/")[0].charAt(0)}
                              </div>
                              <div>
                                <div className="font-medium">{market.title}</div>
                                <div className="text-xs text-muted-foreground">{market.symbol}</div>
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="text-sm font-medium">${market.price}</div>
                              <div className={cn("text-xs", market.change?.startsWith("+") ? "text-emerald-600" : "text-red-600")}>{market.change}</div>
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    )}

                    {searchResults.bots.length > 0 && (
                      <>
                        {searchResults.markets.length > 0 && <CommandSeparator />}
                        <CommandGroup heading="Bots">
                          {searchResults.bots.slice(0, 3).map((bot) => (
                            <CommandItem key={`bot-${bot.id}`} value={bot.title} onSelect={() => handleSelect(bot)} className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <Bot className="h-4 w-4 opacity-50" />
                                <div>
                                  <div className="font-medium">{bot.title}</div>
                                  <div className="text-xs text-muted-foreground">{bot.description}</div>
                                </div>
                              </div>
                              <Badge variant={bot.status === "active" ? "default" : "secondary"} className="text-xs">
                                {bot.status}
                              </Badge>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </>
                    )}

                    {searchResults.pages.length > 0 && (
                      <>
                        {(searchResults.markets.length > 0 || searchResults.bots.length > 0) && <CommandSeparator />}
                        <CommandGroup heading="Pages">
                          {searchResults.pages.slice(0, 3).map((page) => (
                            <CommandItem key={`page-${page.id}`} value={page.title} onSelect={() => handleSelect(page)} className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <Hash className="h-4 w-4 opacity-50" />
                                <div>
                                  <div className="font-medium">{page.title}</div>
                                  <div className="text-xs text-muted-foreground">{page.description}</div>
                                </div>
                              </div>
                              <ArrowRight className="h-4 w-4 opacity-50" />
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </>
                    )}

                    {searchResults.markets.length === 0 && searchResults.bots.length === 0 && searchResults.pages.length === 0 && (
                      <CommandEmpty>
                        <div className="py-6 text-center text-sm">
                          <Search className="mx-auto h-8 w-8 opacity-50" />
                          <div className="mt-2 font-medium">No results found</div>
                          <div className="text-muted-foreground">Try searching for markets, bots, or pages</div>
                        </div>
                      </CommandEmpty>
                    )}
                  </>
                )}
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
