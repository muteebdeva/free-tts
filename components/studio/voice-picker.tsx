"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Loader2,
  Search,
  SearchX,
  Volume2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { cn } from "cn";
import type { Voice } from "@/engines/engine-interface";
import type { EngineChoice } from "@/components/tts-provider";
import { useTTS } from "@/components/tts-provider";

function voiceMeta(v: Voice): string {
  const parts: string[] = [];
  if (v.gender) parts.push(v.gender === "female" ? "Female" : "Male");
  if (v.accent) parts.push(v.accent);
  return parts.join(" · ");
}

function GradeBadge({ grade }: { grade: string }) {
  return (
    <Badge
      variant={grade.startsWith("A") ? "default" : "secondary"}
      className="px-1.5 py-0 text-[10px] font-semibold tabular-nums"
      title="Upstream Kokoro voice-audit quality grade (A best)"
    >
      {grade}
    </Badge>
  );
}

/**
 * Searchable voice picker: a compact custom combobox (trigger button +
 * panel with search + keyboard navigation), per-voice real-synthesis
 * preview with loading and error states, and an engine badge so it is
 * always clear which engine a voice belongs to.
 *
 * For Kokoro: 28 verified English voices with upstream quality grades.
 * For system voices: the device's local voices (grade unknown — never
 * invented).
 */
export function VoicePicker({
  voiceId,
  onChange,
  disabled,
}: {
  voiceId: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const {
    engineChoice,
    voices,
    systemVoices,
    voicesLoading,
    previewVoice,
    previewingId,
    previewError,
    clearPreviewError,
    loadProgress,
    kokoroLoaded,
  } = useTTS();

  const list: Voice[] = engineChoice === "kokoro" ? voices : systemVoices;
  const selected = list.find((v) => v.id === voiceId) ?? list[0];

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Voice-preview failures used to be silent (the provider clears the
  // spinner in a catch{}). They now arrive here and become a toast.
  useEffect(() => {
    if (previewError) {
      toast.error("Voice preview failed", previewError);
      clearPreviewError();
    }
  }, [previewError, clearPreviewError]);

  // Close the panel on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node))
        setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open ]);

  // Reset + focus search whenever the panel opens; close on engine switch.
  useEffect(() => {
    if (open) {
      setQuery("");
      setHighlight(0);
      searchRef.current?.focus();
    }
  }, [open ]);
  useEffect(() => {
    setOpen(false);
  }, [engineChoice ]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (v) =>
        v.name.toLowerCase().includes(q) ||
        (v.accent ?? "").toLowerCase().includes(q) ||
        v.id.toLowerCase().includes(q),
    );
  }, [list, query ]);

  useEffect(() => {
    setHighlight(0);
  }, [filtered.length ]);

  const choose = (v: Voice) => {
    onChange(v.id);
    setOpen(false);
  };

  const onSearchKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter" && filtered[highlight]) {
      e.preventDefault();
      choose(filtered[highlight]);
    }
  };

  const onPreview = (e: React.MouseEvent, v: Voice) => {
    e.stopPropagation();
    void previewVoice(v, engineChoice);
  };

  // Loading states: Kokoro voices resolve from the static registry
  // (voicesLoading), while system voices arrive via the async
  // speechSynthesis handshake — show skeletons briefly before concluding
  // there genuinely are none.
  const [systemSettled, setSystemSettled] = useState(false);
  useEffect(() => {
    if (engineChoice !== "system") {
      setSystemSettled(false);
      return;
    }
    if (systemVoices.length > 0) {
      setSystemSettled(true);
      return;
    }
    const t = window.setTimeout(() => setSystemSettled(true), 4000);
    return () => window.clearTimeout(t);
  }, [engineChoice, systemVoices.length ]);

  const kokoroLoading = engineChoice === "kokoro" && list.length === 0;
  const systemLoading =
    engineChoice === "system" && list.length === 0 && !systemSettled;

  // A Kokoro preview on a cold start triggers the one-time model download —
  // say so honestly instead of spinning without explanation.
  const downloadingForPreview =
    previewingId !== null &&
    engineChoice === "kokoro" &&
    !kokoroLoaded &&
    loadProgress !== null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Voice</h2>
        {selected && selected.overallGrade && (
          <GradeBadge grade={selected.overallGrade} />
        )}
      </div>

      {kokoroLoading || systemLoading ? (
        <div className="space-y-2" aria-label="Loading voices">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : engineChoice === "system" && list.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          No on-device voices found. Install a TTS voice in your OS settings,
          then reopen this page.
        </p>
      ) : (
        <div ref={rootRef} className="relative">
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-label="Choose a voice"
            aria-haspopup="listbox"
            disabled={disabled || list.length === 0}
            onClick={() => setOpen((o) => !o)}
            className="h-10 w-full justify-between font-normal"
          >
            <span className="flex min-w-0 items-center gap-2">
              <Badge variant="secondary" className="shrink-0 px-1.5 py-0 text-[10px]">
                {engineChoice === "kokoro" ? "Kokoro" : "System"}
              </Badge>
              <span className="truncate">
                {selected ? (
                  <>
                    <span className="font-medium">{selected.name}</span>
                    {voiceMeta(selected) && (
                      <span className="text-muted-foreground">
                        {" "}
                        · {voiceMeta(selected)}
                      </span>
                    )}
                  </>
                ) : (
                  <span className="text-muted-foreground">Choose a voice…</span>
                )}
              </span>
            </span>
            <ChevronDown
              className={cn(
                "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                open && "rotate-180",
              )}
            />
          </Button>

          {open && (
            <div className="absolute inset-x-0 top-full z-50 mt-1.5 overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-lg">
              <div className="flex items-center gap-2 border-b px-3">
                <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={onSearchKey}
                  placeholder="Search voices…"
                  aria-label="Search voices"
                  role="searchbox"
                  className="h-10 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                />
              </div>
              {downloadingForPreview && (
                <p className="border-b px-3 py-2 text-xs text-muted-foreground">
                  Downloading the voice model for the preview…{" "}
                  {Math.round(loadProgress * 100)}% (one-time, cached after)
                </p>
              )}
              {filtered.length === 0 ? (
                <EmptyState
                  icon={SearchX}
                  title="No voices match"
                  description={
                    query.trim()
                      ? `Nothing matches "${query.trim()}". Try a different name.`
                      : "No voices available."
                  }
                  className="border-0 py-8"
                />
              ) : (
                <ul
                  role="listbox"
                  aria-label="Voices"
                  className="max-h-64 overflow-y-auto p-1.5"
                >
                  {filtered.map((v, i) => {
                    const isSelected = v.id === selected?.id;
                    const isPreviewing = previewingId === v.id;
                    return (
                      <li key={v.id} role="option" aria-selected={isSelected}>
                        <div
                          onClick={() => choose(v)}
                          onMouseEnter={() => setHighlight(i)}
                          className={cn(
                            "flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2",
                            i === highlight && "bg-accent",
                            isSelected && "bg-accent/60",
                          )}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5 text-sm">
                              <span className="truncate font-medium">
                                {v.name}
                              </span>
                              {v.overallGrade && (
                                <GradeBadge grade={v.overallGrade} />
                              )}
                            </span>
                            {voiceMeta(v) && (
                              <span className="block truncate text-xs text-muted-foreground">
                                {voiceMeta(v)}
                              </span>
                            )}
                          </span>
                          {isSelected && (
                            <Check className="h-4 w-4 shrink-0 text-primary" />
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={disabled || isPreviewing}
                            onClick={(e) => onPreview(e, v)}
                            aria-label={`Preview voice ${v.name}`}
                            title="Preview (real synthesis)"
                            className="h-8 w-8 shrink-0"
                          >
                            {isPreviewing ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Volume2 className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {selected && (
        <p className="text-xs text-muted-foreground">{selected.description}</p>
      )}
    </div>
  );
}
