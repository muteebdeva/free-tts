/**
 * Generation history — localStorage only, no backend.
 *
 * Metadata + full text are stored so an entry can be regenerated exactly.
 * Audio itself is never stored (blobs are transient by design); Kokoro audio
 * is regenerable deterministically enough, system audio is live-only.
 * Everything this module writes is disclosed on the Privacy page.
 */
import type { EngineChoice } from "@/components/tts-provider";

export const HISTORY_KEY = "freetts:history:v1";
export const DRAFT_KEY = "freetts:draft:v1";
/** Entry id the Studio should auto-generate on next mount (then consumed). */
export const PENDING_GENERATE_KEY = "freetts:pending-generate:v1";
const MAX_ENTRIES = 50;
const PREVIEW_CHARS = 140;

export interface HistoryEntry {
  id: string;
  createdAt: string; // ISO 8601
  engine: EngineChoice;
  voiceId: string;
  voiceName: string;
  speed: number;
  charCount: number;
  /** Kokoro only (from generated PCM); null for system voices. */
  durationSec: number | null;
  /** Full text — needed for Regenerate. */
  text: string;
  /** First ~140 chars, for list display. */
  textPreview: string;
  /** True when generation was stopped before completion. */
  partial: boolean;
}

function safeParse(raw: string | null): HistoryEntry[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is HistoryEntry =>
        typeof e === "object" &&
        e !== null &&
        typeof (e as HistoryEntry).id === "string" &&
        typeof (e as HistoryEntry).text === "string",
    );
  } catch {
    return [];
  }
}

function safeWrite(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode / quota: history is best-effort, never fatal.
  }
}

function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function recordHistoryEntry(
  e: Omit<HistoryEntry, "id" | "createdAt" | "textPreview">,
): HistoryEntry {
  const entry: HistoryEntry = {
    ...e,
    id: uid(),
    createdAt: new Date().toISOString(),
    textPreview:
      e.text.length > PREVIEW_CHARS
        ? e.text.slice(0, PREVIEW_CHARS).trimEnd() + "…"
        : e.text,
  };
  const list = safeParse(
    typeof localStorage !== "undefined"
      ? localStorage.getItem(HISTORY_KEY)
      : null,
  );
  list.unshift(entry);
  safeWrite(HISTORY_KEY, JSON.stringify(list.slice(0, MAX_ENTRIES)));
  return entry;
}

export function getHistory(): HistoryEntry[] {
  if (typeof localStorage === "undefined") return [];
  return safeParse(localStorage.getItem(HISTORY_KEY));
}

export function getHistoryEntry(id: string): HistoryEntry | undefined {
  return getHistory().find((e) => e.id === id);
}

export function deleteHistoryEntry(id: string): void {
  safeWrite(
    HISTORY_KEY,
    JSON.stringify(getHistory().filter((e) => e.id !== id)),
  );
}

export function clearHistory(): void {
  try {
    localStorage.removeItem(HISTORY_KEY);
  } catch {
    /* ignore */
  }
}

/** Draft text persistence (survives navigation). */
export function saveDraft(text: string): void {
  safeWrite(DRAFT_KEY, text);
}

export function loadDraft(): string {
  try {
    return localStorage.getItem(DRAFT_KEY) ?? "";
  } catch {
    return "";
  }
}

/** One-shot handoff: History → Studio auto-regenerate. */
export function setPendingGenerate(id: string): void {
  safeWrite(PENDING_GENERATE_KEY, id);
}

export function consumePendingGenerate(): string | null {
  try {
    const id = localStorage.getItem(PENDING_GENERATE_KEY);
    if (id) localStorage.removeItem(PENDING_GENERATE_KEY);
    return id;
  } catch {
    return null;
  }
}
