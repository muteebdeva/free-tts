import { describe, expect, it } from "vitest";
import { chunkText, splitOnWords, validateTextInput } from "../lib/text-chunk";

describe("chunkText", () => {
  it("returns a single chunk for short text", () => {
    expect(chunkText("Hello world.")).toEqual(["Hello world."]);
  });

  it("throws on empty input", () => {
    expect(() => chunkText("   ")).toThrow();
  });

  it("never splits a sentence across chunks", () => {
    const s1 = "The quick brown fox jumps over the lazy dog.";
    const s2 = "Pack my box with five dozen liquor jugs.";
    const chunks = chunkText(`${s1} ${s2}`, { maxChars: s1.length + 1 });
    // Both sentences must appear whole in some chunk.
    expect(chunks.some((c) => c.includes(s1))).toBe(true);
    expect(chunks.some((c) => c.includes(s2))).toBe(true);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(s1.length + 1);
  });

  it("packs multiple short sentences into one chunk", () => {
    const chunks = chunkText("One. Two. Three.", { maxChars: 400 });
    expect(chunks).toEqual(["One. Two. Three."]);
  });

  it("keeps every chunk within maxChars", () => {
    const text = Array.from({ length: 50 }, (_, i) => `Sentence number ${i} is here.`).join(" ");
    const chunks = chunkText(text, { maxChars: 120 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(120);
    // No text lost: rejoining covers all sentences.
    expect(chunks.join(" ")).toContain("Sentence number 49 is here.");
  });

  it("respects paragraph boundaries (blank lines split paragraphs)", () => {
    const chunks = chunkText("First paragraph here.\n\nSecond paragraph here.", {
      maxChars: 400,
    });
    expect(chunks).toEqual(["First paragraph here.", "Second paragraph here."]);
  });

  it("word-splits a single over-long sentence without losing words", () => {
    const long = Array.from({ length: 100 }, () => "word").join(" ");
    const chunks = chunkText(long, { maxChars: 50 });
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(50);
    expect(chunks.join(" ").split(" ").filter(Boolean)).toHaveLength(100);
  });

  it("handles Hindi (Devanagari) input without crashing", () => {
    const chunks = chunkText("नमस्ते दुनिया। यह एक परीक्षण है।", {
      maxChars: 400,
      locale: "hi",
    });
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks.join(" ")).toContain("नमस्ते");
  });

  it("handles numbers and punctuation", () => {
    const chunks = chunkText("In 2026, prices rose 3.5%! Really? Yes — by $1,000.", {
      maxChars: 400,
    });
    expect(chunks.join(" ")).toContain("3.5%");
  });

  it("never returns empty chunks", () => {
    const chunks = chunkText("\n\n  Hello.  \n\n\nWorld.\n\n", { maxChars: 20 });
    expect(chunks.length).toBeGreaterThan(0);
    for (const c of chunks) expect(c.trim().length).toBeGreaterThan(0);
  });
});

describe("splitOnWords", () => {
  it("hard-cuts a single pathological word", () => {
    const pieces = splitOnWords("a".repeat(100), 30);
    expect(pieces.join("")).toHaveLength(100);
    for (const p of pieces) expect(p.length).toBeLessThanOrEqual(30);
  });
});

describe("validateTextInput", () => {
  it("rejects empty text", () => {
    expect(validateTextInput("  ")).toMatch(/enter some text/i);
  });
  it("rejects over-limit text", () => {
    expect(validateTextInput("x".repeat(5001))).toMatch(/too long/i);
  });
  it("accepts normal text", () => {
    expect(validateTextInput("Hello.")).toBeNull();
  });
});
