"use client";

import { Loader2, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Voice } from "@/engines/engine-interface";
import type { EngineChoice } from "@/components/tts-provider";
import { useTTS } from "@/components/tts-provider";

/**
 * Voice picker: grouped dropdown + real-synthesis preview button.
 * For Kokoro: 28 verified English voices grouped by accent, with upstream
 * quality grades. For system voices: the device's local voices.
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
  const { engineChoice, voices, systemVoices, previewVoice, previewingId } = useTTS();
  const list: Voice[] =
    engineChoice === "kokoro" ? voices : systemVoices;

  const selected = list.find((v) => v.id === voiceId) ?? list[0];
  const previewing = previewingId === selected?.id;

  const groups = groupVoices(list, engineChoice);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Voice</h2>
        {selected && engineChoice === "kokoro" && (
          <Badge variant="secondary" className="text-xs">
            {gradeOf(selected)}
          </Badge>
        )}
      </div>
      <div className="flex gap-2">
        <Select
          value={selected?.id ?? ""}
          onValueChange={(v) => v && onChange(v)}
          disabled={disabled || list.length === 0}
        >
          <SelectTrigger className="flex-1" aria-label="Choose a voice">
            <SelectValue placeholder="Choose a voice…" />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            {groups.map((g) => (
              <SelectGroup key={g.label}>
                <SelectLabel>{g.label}</SelectLabel>
                {g.voices.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.name}
                    {v.gender ? ` · ${v.gender}` : ""}
                    {engineChoice === "kokoro" ? ` · grade ${gradeOf(v)}` : ""}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="icon"
          disabled={disabled || !selected || previewing}
          onClick={() => selected && previewVoice(selected, engineChoice)}
          aria-label={`Preview voice ${selected?.name ?? ""}`}
          title="Preview (real synthesis)"
        >
          {previewing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Volume2 className="h-4 w-4" />
          )}
        </Button>
      </div>
      {selected && (
        <p className="text-xs text-muted-foreground">{selected.description}</p>
      )}
      {engineChoice === "kokoro" && list.length === 0 && (
        <p className="text-xs text-muted-foreground">Loading voices…</p>
      )}
      {engineChoice === "system" && list.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No on-device voices found. Install a TTS voice in your OS settings.
        </p>
      )}
    </div>
  );
}

function gradeOf(v: Voice): string {
  const m = v.description.match(/grade (\S+)/);
  return m ? m[1] : "–";
}

function groupVoices(
  list: Voice[],
  engine: EngineChoice,
): Array<{ label: string; voices: Voice[] }> {
  if (engine !== "kokoro") {
    return [{ label: "On-device voices", voices: list }];
  }
  const us = list.filter((v) => v.language === "en-US");
  const uk = list.filter((v) => v.language === "en-GB");
  const other = list.filter((v) => v.language !== "en-US" && v.language !== "en-GB");
  const groups = [];
  if (us.length) groups.push({ label: "American English", voices: us });
  if (uk.length) groups.push({ label: "British English", voices: uk });
  if (other.length) groups.push({ label: "Other", voices: other });
  return groups;
}
