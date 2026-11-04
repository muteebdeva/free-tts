/**
 * Verified Kokoro voice registry for the browser engine.
 *
 * Source: the frozen VOICES map in kokoro-js 1.2.1
 * (node_modules/kokoro-js/dist/kokoro.js, inspected 2026-11-04).
 * kokoro-js 1.2.1 only accepts these 28 voices — `_validate_voice` throws on
 * anything else — and only ships English phonemization. Non-English upstream
 * voices (es/fr/hi/it/ja/pt/zh) are NOT registered here because they cannot
 * run through the current browser pipeline (see MODEL-RESEARCH.md §1.3).
 *
 * overallGrade comes from upstream VOICES.md audits (A best … F worst).
 * Never invent voices: this list is exactly what the library accepts.
 */
import type { Voice } from "../engine-interface";

interface RawVoice {
  name: string;
  language: "en-us" | "en-gb";
  gender: "Female" | "Male";
  overallGrade: string;
}

const RAW: Record<string, RawVoice> = {
  af_heart: { name: "Heart", language: "en-us", gender: "Female", overallGrade: "A" },
  af_alloy: { name: "Alloy", language: "en-us", gender: "Female", overallGrade: "C" },
  af_aoede: { name: "Aoede", language: "en-us", gender: "Female", overallGrade: "C+" },
  af_bella: { name: "Bella", language: "en-us", gender: "Female", overallGrade: "A-" },
  af_jessica: { name: "Jessica", language: "en-us", gender: "Female", overallGrade: "D" },
  af_kore: { name: "Kore", language: "en-us", gender: "Female", overallGrade: "C+" },
  af_nicole: { name: "Nicole", language: "en-us", gender: "Female", overallGrade: "B-" },
  af_nova: { name: "Nova", language: "en-us", gender: "Female", overallGrade: "C" },
  af_river: { name: "River", language: "en-us", gender: "Female", overallGrade: "D" },
  af_sarah: { name: "Sarah", language: "en-us", gender: "Female", overallGrade: "C+" },
  af_sky: { name: "Sky", language: "en-us", gender: "Female", overallGrade: "C-" },
  am_adam: { name: "Adam", language: "en-us", gender: "Male", overallGrade: "F+" },
  am_echo: { name: "Echo", language: "en-us", gender: "Male", overallGrade: "D" },
  am_eric: { name: "Eric", language: "en-us", gender: "Male", overallGrade: "D" },
  am_fenrir: { name: "Fenrir", language: "en-us", gender: "Male", overallGrade: "C+" },
  am_liam: { name: "Liam", language: "en-us", gender: "Male", overallGrade: "D" },
  am_michael: { name: "Michael", language: "en-us", gender: "Male", overallGrade: "C+" },
  am_onyx: { name: "Onyx", language: "en-us", gender: "Male", overallGrade: "D" },
  am_puck: { name: "Puck", language: "en-us", gender: "Male", overallGrade: "C+" },
  am_santa: { name: "Santa", language: "en-us", gender: "Male", overallGrade: "D-" },
  bf_emma: { name: "Emma", language: "en-gb", gender: "Female", overallGrade: "B-" },
  bf_isabella: { name: "Isabella", language: "en-gb", gender: "Female", overallGrade: "C" },
  bf_alice: { name: "Alice", language: "en-gb", gender: "Female", overallGrade: "D" },
  bf_lily: { name: "Lily", language: "en-gb", gender: "Female", overallGrade: "D" },
  bm_george: { name: "George", language: "en-gb", gender: "Male", overallGrade: "C" },
  bm_lewis: { name: "Lewis", language: "en-gb", gender: "Male", overallGrade: "D+" },
  bm_daniel: { name: "Daniel", language: "en-gb", gender: "Male", overallGrade: "D" },
  bm_fable: { name: "Fable", language: "en-gb", gender: "Male", overallGrade: "C" },
};

function toVoice(id: string, raw: RawVoice): Voice {
  const language = raw.language === "en-us" ? "en-US" : "en-GB";
  const accent = raw.language === "en-us" ? "American" : "British";
  return {
    id,
    name: raw.name,
    language,
    gender: raw.gender === "Female" ? "female" : "male",
    accent,
    // Grade is upstream's own audit label; surfaced so users can pick better voices.
    description: `${accent} English · ${raw.gender} · upstream quality grade ${raw.overallGrade}`,
  };
}

export const KOKORO_VOICES: Voice[] = Object.entries(RAW).map(([id, raw]) =>
  toVoice(id, raw),
);

/** Default voice: the highest-graded American female voice. */
export const DEFAULT_VOICE_ID = "af_heart";

export function isKnownVoice(voiceId: string): boolean {
  return Object.hasOwn(RAW, voiceId);
}
