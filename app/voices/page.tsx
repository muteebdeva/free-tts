"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTTS } from "@/components/tts-provider";
import type { Voice } from "@/engines/engine-interface";

function gradeOf(v: Voice): string {
  const m = v.description.match(/grade (\S+)/);
  return m ? m[1] : "–";
}

const GRADE_ORDER = ["A", "A-", "B-", "B", "C+", "C", "C-", "D+", "D", "D-", "F+"];

export default function VoicesPage() {
  const { voices, previewVoice, previewingId, ensureVoices } = useTTS();
  const [accent, setAccent] = useState("all");
  const [gender, setGender] = useState("all");
  const [sort, setSort] = useState("grade");

  useEffect(() => {
    void ensureVoices();
  }, [ensureVoices]);

  const filtered = useMemo(() => {
    let list = [...voices];
    if (accent !== "all") list = list.filter((v) => v.accent === accent);
    if (gender !== "all") list = list.filter((v) => v.gender === gender);
    if (sort === "grade") {
      list.sort(
        (a, b) => GRADE_ORDER.indexOf(gradeOf(a)) - GRADE_ORDER.indexOf(gradeOf(b)),
      );
    } else {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }
    return list;
  }, [voices, accent, gender, sort]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-3xl font-bold tracking-tight">Voice library</h1>
        <p className="text-muted-foreground">
          {voices.length > 0
            ? `${voices.length} verified English voices. Press play to hear a real sample — every preview is synthesized live on your device.`
            : "Loading voices…"}
        </p>
        <p className="text-xs text-muted-foreground">
          Quality grades come from the upstream Kokoro voice audit (A best).
          Only voices the browser engine actually supports are listed.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <Select value={accent} onValueChange={(v) => setAccent(v ?? "all")}>
          <SelectTrigger className="w-40" aria-label="Filter by accent">
            <SelectValue placeholder="Accent" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All accents</SelectItem>
            <SelectItem value="American">American</SelectItem>
            <SelectItem value="British">British</SelectItem>
          </SelectContent>
        </Select>
        <Select value={gender} onValueChange={(v) => setGender(v ?? "all")}>
          <SelectTrigger className="w-40" aria-label="Filter by voice type">
            <SelectValue placeholder="Voice" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All voices</SelectItem>
            <SelectItem value="female">Feminine</SelectItem>
            <SelectItem value="male">Masculine</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={(v) => setSort(v ?? "grade")}>
          <SelectTrigger className="w-40" aria-label="Sort voices">
            <SelectValue placeholder="Sort" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="grade">Best grade first</SelectItem>
            <SelectItem value="name">Name A–Z</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {voices.length === 0 && (
        <Card>
          <CardContent className="flex items-center gap-3 pt-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading voice list…
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((v) => {
          const previewing = previewingId === v.id;
          return (
            <Card key={v.id}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{v.name}</CardTitle>
                  <Badge variant={gradeOf(v).startsWith("A") ? "default" : "secondary"}>
                    {gradeOf(v)}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {v.accent} English · {v.gender}
                </p>
              </CardHeader>
              <CardContent>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  disabled={previewing}
                  onClick={() => previewVoice(v, "kokoro")}
                >
                  {previewing ? (
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Volume2 className="mr-2 h-3.5 w-3.5" />
                  )}
                  {previewing ? "Speaking…" : "Preview voice"}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
