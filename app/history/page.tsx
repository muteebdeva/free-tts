"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AudioWaveform,
  History,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { toast } from "@/components/ui/toast";
import type { EngineChoice } from "@/components/tts-provider";
import {
  clearHistory,
  deleteHistoryEntry,
  getHistory,
  setPendingGenerate,
  type HistoryEntry,
} from "@/lib/history";

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "unknown date";
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  return new Date(iso).toLocaleDateString();
}

function formatDuration(sec: number | null): string {
  if (sec === null || !Number.isFinite(sec) || sec < 0) return "";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function engineBadge(engine: EngineChoice): string {
  return engine === "kokoro" ? "Kokoro · neural" : "System · on-device";
}

export default function HistoryPage() {
  const router = useRouter();
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [clearOpen, setClearOpen] = useState(false);

  const reload = useCallback(() => {
    setEntries(getHistory());
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const onRegenerate = (id: string) => {
    // Handoff: the Studio reads the pending id on mount and regenerates it.
    setPendingGenerate(id);
    router.push("/");
  };

  const onDelete = (id: string) => {
    deleteHistoryEntry(id);
    reload();
    toast.success("Entry deleted");
  };

  const onClearAll = () => {
    setClearOpen(false);
    clearHistory();
    reload();
    toast.success("History cleared", "All entries were deleted from this device.");
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold tracking-tight">History</h1>
          <p className="text-muted-foreground">
            Your generations, stored only on this device. Audio is never
            saved — only the text and settings needed to regenerate it.
          </p>
        </div>
        {entries.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setClearOpen(true)}
            className="shrink-0 text-destructive hover:text-destructive"
          >
            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
            Clear all
          </Button>
        )}
      </div>

      {entries.length === 0 && (
        <EmptyState
          icon={History}
          title="No history yet"
          description="Generations you create in the Studio appear here, newest first. Everything stays in this browser — nothing is sent anywhere."
          action={
            <Link href="/">
              <Button size="sm">
                <AudioWaveform className="mr-1.5 h-3.5 w-3.5" />
                Go to Studio
              </Button>
            </Link>
          }
        />
      )}

      <div className="space-y-3">
        {entries.map((e) => {
          const duration = formatDuration(e.durationSec);
          return (
            <Card key={e.id}>
              <CardContent className="pt-4">
                <p className="line-clamp-3 text-sm leading-relaxed">
                  {e.textPreview}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {e.voiceName}
                  </span>
                  <Badge variant="outline" className="font-normal">
                    {engineBadge(e.engine)}
                  </Badge>
                  {e.partial && (
                    <Badge variant="secondary">Partial audio</Badge>
                  )}
                  <span>{relativeTime(e.createdAt)}</span>
                  {duration && <span>{duration}</span>}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onRegenerate(e.id)}
                    aria-label={`Regenerate "${e.textPreview.slice(0, 40)}"`}
                  >
                    <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                    Regenerate
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onDelete(e.id)}
                    aria-label={`Delete "${e.textPreview.slice(0, 40)}"`}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                    Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog open={clearOpen} onOpenChange={setClearOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clear all history?</DialogTitle>
            <DialogDescription>
              This deletes all {entries.length} entr
              {entries.length === 1 ? "y" : "ies"} from this device. The
              generated audio was never saved, so entries can&apos;t be
              recovered — but you can always regenerate from new text.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setClearOpen(false)}>
              Keep history
            </Button>
            <Button variant="destructive" onClick={onClearAll}>
              Clear all
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
