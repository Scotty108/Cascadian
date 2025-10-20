"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Bell, BellOff, Edit, Star, Trash2 } from "lucide-react";
import { useState } from "react";
import type { WatchlistItem } from "../../types";
import { DeleteWatchlistModal } from "./delete-watchlist-modal";
import { EditWatchlistModal } from "./edit-watchlist-modal";

interface WatchlistTableProps {
  watchlist: WatchlistItem[];
  favorites: Set<string>;
  onToggleFavorite: (symbol: string) => void;
}

export function WatchlistTable({ watchlist, favorites, onToggleFavorite }: WatchlistTableProps) {
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<WatchlistItem | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [watchlistData, setWatchlistData] = useState(watchlist);

  const handleEdit = (item: WatchlistItem, index: number) => {
    setSelectedItem(item);
    setSelectedIndex(index);
    setEditModalOpen(true);
  };

  const handleDelete = (item: WatchlistItem, index: number) => {
    setSelectedItem(item);
    setSelectedIndex(index);
    setDeleteModalOpen(true);
  };

  const handleSaveEdit = (updatedItem: WatchlistItem) => {
    if (selectedIndex !== null) {
      const newWatchlist = [...watchlistData];
      newWatchlist[selectedIndex] = updatedItem;
      setWatchlistData(newWatchlist);
    }
  };

  const handleConfirmDelete = () => {
    if (selectedIndex !== null) {
      const newWatchlist = watchlistData.filter((_, index) => index !== selectedIndex);
      setWatchlistData(newWatchlist);
    }
  };

  const handleToggleAlert = (index: number) => {
    const newWatchlist = [...watchlistData];
    newWatchlist[index] = { ...newWatchlist[index], alert: !newWatchlist[index].alert };
    setWatchlistData(newWatchlist);
  };

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Watchlist</CardTitle>
              <CardDescription>Monitor specific assets for pump opportunities</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12"></TableHead>
                <TableHead>Symbol</TableHead>
                <TableHead>Exchange</TableHead>
                <TableHead>Alerts</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead className="w-24">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {watchlistData.map((item, index) => (
                <TableRow key={index}>
                  <TableCell>
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => onToggleFavorite(item.symbol)}>
                      <Star className={`h-3 w-3 ${favorites.has(item.symbol) ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground"}`} />
                    </Button>
                  </TableCell>
                  <TableCell className="font-medium">{item.symbol}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{item.exchange}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Switch checked={item.alert} onCheckedChange={() => handleToggleAlert(index)} />
                      {item.alert ? <Bell className="h-3 w-3 text-green-500" /> : <BellOff className="h-3 w-3 text-muted-foreground" />}
                    </div>
                  </TableCell>
                  <TableCell className="max-w-xs truncate text-sm text-muted-foreground">{item.notes}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => handleEdit(item, index)}>
                        <Edit className="h-3 w-3" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => handleDelete(item, index)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <EditWatchlistModal isOpen={editModalOpen} onClose={() => setEditModalOpen(false)} item={selectedItem} onSave={handleSaveEdit} />

      <DeleteWatchlistModal isOpen={deleteModalOpen} onClose={() => setDeleteModalOpen(false)} item={selectedItem} onConfirm={handleConfirmDelete} />
    </>
  );
}
