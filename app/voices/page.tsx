"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Loader2,
  MicOff,
  Search,
  SearchX,
  Volume2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useTTS } from "@/components/tts-provider";
import type { Voice } from "@/engines/engine-interface";
import { SystemEngine } from "@/engines/system/system-engine";

/**
 * Upstream Kokoro quality grade for a voice. Track B is hoisting
 * `overallGrade` out of the description string into a first-class field;
 * prefer the field when present, parse the description defensively until
 * then. Never invented — it comes from the upstream Kokoro voice audit.
 */
function gradeOf(v: Voice): string {
  const field = (v as Voice & { overallGrade?: string }).overallGrade;
  if (typeof field === "string" && field.length > 0) return field;
  const m = v.description.match(/grade (\S+)/i);
  return m ? m[1] : "–";
}

const GRADE_ORDER = [
  "A",
  "A-",
  "B+",
  "B",
  "B-",
  "C+",
  "C",
  "C-",
  "D+",
  "D",
  "D-",
  "F+",
];

function gradeRank(g: string): number {
  const i = GRADE_ORDER.indexOf(g);
  return i === -1 ? GRADE_ORDER.length : i;
}

function VoiceCard({
  voice,
  engine,
  previewing,
  onPreview,
}: {
  voice: Voice;
  engine: "kokoro" | "system";
  previewing: boolean;
  onPreview: () => void;
}) {
  const grade = engine === "kokoro" ? gradeOf(voice) : null;
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base font-medium tracking-tight">
            {voice.name}
          </CardTitle>
          {grade !== null && (
            <Badge
              variant={grade.startsWith("A") ? "default" : "secondary"}
              title="Upstream Kokoro voice-audit quality grade (A best). It reflects the training data quality for this voice, not this app's opinion."
            >
              {grade}
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {engine === "kokoro" ? (
            <>
              {voice.accent} English · {voice.gender}
            </>
          ) : (
            <>{voice.language}</>
          )}
        </p>
      </CardHeader>
      <CardContent className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          disabled={previewing}
          onClick={onPreview}
          aria-label={
            previewing ? `Playing ${voice.name}` : `Preview ${voice.name}`
          }
        >
          {previewing ? (
            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Volume2 className="mr-2 h-3.5 w-3.5" />
          )}
          {previewing ? "Speaking…" : "Preview"}
        </Button>
        <Badge variant="outline" className="shrink-0 font-normal">
          {engine === "kokoro" ? "Kokoro · neural" : "System · on-device"}
        </Badge>
      </CardContent>
    </Card>
  );
}

export default function VoicesPage() {
  const {
    voices,
    voicesLoading,
    ensureVoices,
    previewVoice,
    previewingId,
  } = useTTS();
  const [query, setQuery] = useState("");
  const [accent, setAccent] = useState("all");
  const [gender, setGender] = useState("all");
  const [sort, setSort] = useState("grade");

  // System voices load here independently: the provider only fetches them
  // when the Studio's engine is switched to "system", so the library cannot
  // rely on provider state. Same SystemEngine class, same on-device-only
  // voice list — name and language are all the Web Speech API gives us.
  const [systemVoices, setSystemVoices] = useState<Voice[]>([]);
  const [systemLoading, setSystemLoading] = useState(true);
  const [systemSupported, setSystemSupported] = useState(true);

  useEffect(() => {
    void ensureVoices();
  }, [ensureVoices]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const engine = new SystemEngine();
      try {
        await engine.load();
        if (!cancelled) setSystemVoices(await engine.getVoices());
      } catch {
        if (!cancelled) {
          setSystemSupported(false);
          setSystemVoices([]);
        }
      } finally {
        if (!cancelled) setSystemLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = voices.filter(
      (v) => !q || v.name.toLowerCase().includes(q),
    );
    if (accent !== "all") list = list.filter((v) => v.accent === accent);
    if (gender !== "all") list = list.filter((v) => v.gender === gender);
    list = [...list];
    if (sort === "grade") {
      list.sort((a, b) => gradeRank(gradeOf(a)) - gradeRank(gradeOf(b)));
    } else {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }
    return list;
  }, [voices, query, accent, gender, sort]);

  const clearFilters = () => {
    setQuery("");
    setAccent("all");
    setGender("all");
  };

  return (
    <div className="mx-auto max-w-5xl space-y-10">
      <div className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight">Voice library</h1>
        <p className="text-muted-foreground">
          Every voice you can use in FreeTTS. Press preview to hear a real
          sample — synthesized live on your device, not a recording.
        </p>
      </div>

      {/* ---- Kokoro AI voices ------------------------------------------ */}
      <section className="space-y-4" aria-labelledby="kokoro-heading">
        <div className="space-y-1">
          <h2 id="kokoro-heading" className="text-xl font-semibold tracking-tight">
            Kokoro AI voices
          </h2>
          <p className="text-sm text-muted-foreground">
            28 neural voices verified to work with the in-browser Kokoro-82M
            engine. Quality grades come from the upstream Kokoro voice audit
            (A best) — they describe training-data quality, not this app&apos;s
            opinion. Previewing downloads the model (~92 MB) once, on first use.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <div className="relative w-full sm:w-56">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search voices…"
              aria-label="Search voices by name"
              className="flex h-9 w-full rounded-md border border-input bg-background py-1 pr-3 pl-9 text-sm shadow-xs transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
            />
          </div>
          <Select value={accent} onValueChange={(v) => setAccent(v ?? "all")}>
            <SelectTrigger className="w-full sm:w-40" aria-label="Filter by accent">
              <SelectValue placeholder="Accent" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All accents</SelectItem>
              <SelectItem value="American">American</SelectItem>
              <SelectItem value="British">British</SelectItem>
            </SelectContent>
          </Select>
          <Select value={gender} onValueChange={(v) => setGender(v ?? "all")}>
            <SelectTrigger className="w-full sm:w-40" aria-label="Filter by voice type">
              <SelectValue placeholder="Voice type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All voices</SelectItem>
              <SelectItem value="female">Feminine</SelectItem>
              <SelectItem value="male">Masculine</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={(v) => setSort(v ?? "grade")}>
            <SelectTrigger className="w-full sm:w-40" aria-label="Sort voices">
              <SelectValue placeholder="Sort" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="grade">Best grade first</SelectItem>
              <SelectItem value="name">Name A–Z</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {voicesLoading && voices.length === 0 && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Loading voices">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="space-y-3 rounded-xl border p-4">
                <Skeleton className="h-5 w-24" />
                <Skeleton className="h-3 w-32" />
                <Skeleton className="h-8 w-full" />
              </div>
            ))}
          </div>
        )}

        {!voicesLoading && voices.length === 0 && (
          <EmptyState
            icon={Volume2}
            title="Voice list unavailable"
            description="The Kokoro voice registry couldn't be loaded. This is static metadata — try reloading the page."
          />
        )}

        {voices.length > 0 && filtered.length === 0 && (
          <EmptyState
            icon={SearchX}
            title="No voices match your filters"
            description="Try a different search term, or clear the accent and voice-type filters."
            action={
              <Button variant="outline" size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            }
          />
        )}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((v) => (
            <VoiceCard
              key={v.id}
              voice={v}
              engine="kokoro"
              previewing={previewingId === v.id}
              onPreview={() => {
                void previewVoice(v, "kokoro");
              }}
            />
          ))}
        </div>
        {filtered.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Showing {filtered.length} of {voices.length} voices.
          </p>
        )}
      </section>

      {/* ---- System voices ---------------------------------------------- */}
      <section className="space-y-4" aria-labelledby="system-heading">
        <div className="space-y-1">
          <h2 id="system-heading" className="text-xl font-semibold tracking-tight">
            System voices
          </h2>
          <p className="text-sm text-muted-foreground">
            Your device&apos;s built-in voices. Instant, no download. Only
            on-device voices are listed — network voices, which would send
            your text to a vendor&apos;s servers, are deliberately excluded.
            The list varies by device: name and language are all the
            information the Web Speech API provides.
          </p>
        </div>

        {systemLoading && (
          <div className="space-y-2" aria-label="Loading system voices">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        )}

        {!systemLoading && systemVoices.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {systemVoices.map((v) => (
              <VoiceCard
                key={v.id}
                voice={v}
                engine="system"
                previewing={previewingId === v.id}
                onPreview={() => {
                  void previewVoice(v, "system");
                }}
              />
            ))}
          </div>
        )}

        {!systemLoading && systemVoices.length === 0 && (
          <EmptyState
            icon={MicOff}
            title={
              systemSupported
                ? "No on-device voices found"
                : "System voices not supported here"
            }
            description={
              systemSupported
                ? "This browser reports no local voices. Some devices ship with none installed; the list varies by device and OS."
                : "This browser doesn't support the Web Speech API, so there are no system voices to list."
            }
          />
        )}
      </section>

    </div>
  );
}
