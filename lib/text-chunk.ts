/**
 * Sentence-aware text chunking for long-form TTS.
 *
 * Neural TTS models accept limited input lengths (a few hundred characters is
 * a safe universal budget). Feeding arbitrarily long text at once degrades
 * quality, blows memory, and makes cancellation/progress impossible.
 *
 * Strategy:
 *  1. Split on paragraph boundaries (blank lines) — never merge across them
 *     when it can be avoided; a paragraph break is a natural prosodic pause.
 *  2. Within a paragraph, split into sentences with Intl.Segmenter
 *     (locale-aware, no regex hacks, handles abbreviations better).
 *  3. Greedily pack sentences into chunks <= maxChars, never splitting a
 *     sentence across chunks unless one sentence alone exceeds maxChars —
 *     then fall back to word-boundary splitting.
 */

export interface ChunkOptions {
  /** Maximum characters per chunk. Default 400. */
  maxChars?: number;
  /** BCP-47 locale for sentence segmentation, e.g. "en", "hi", "es". */
  locale?: string;
}

/**
 * Split text into synthesis-ready chunks. Never returns empty chunks.
 * Throws on empty/whitespace-only input so callers validate first.
 */
export function chunkText(text: string, options: ChunkOptions = {}): string[] {
  const { maxChars = 400, locale = "en" } = options;
  if (!text || !text.trim()) {
    throw new Error("chunkText: text is empty");
  }
  if (maxChars < 20) {
    throw new Error("chunkText: maxChars must be >= 20");
  }

  const segmenter = new Intl.Segmenter(locale, { granularity: "sentence" });
  const chunks: string[] = [];

  // Paragraphs: split on blank lines, keep non-empty.
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length > 0);

  for (const paragraph of paragraphs) {
    const sentences = [...segmenter.segment(paragraph)]
      .map((s) => s.segment.trim())
      .filter((s) => s.length > 0);

    let current = "";
    const flush = () => {
      if (current) {
        chunks.push(current);
        current = "";
      }
    };

    for (const sentence of sentences) {
      // Oversize single sentence: hard-split on word boundaries.
      if (sentence.length > maxChars) {
        flush();
        for (const piece of splitOnWords(sentence, maxChars)) chunks.push(piece);
        continue;
      }
      const candidate = current ? `${current} ${sentence}` : sentence;
      if (candidate.length <= maxChars) {
        current = candidate;
      } else {
        flush();
        current = sentence;
      }
    }
    flush();
  }

  if (chunks.length === 0) {
    throw new Error("chunkText: no chunks produced (unexpected)");
  }
  return chunks;
}

/** Split an over-long string on word boundaries into pieces <= maxChars. */
export function splitOnWords(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const pieces: string[] = [];
  let current = "";
  for (const word of words) {
    // A single pathological word longer than maxChars: hard cut it.
    if (word.length > maxChars) {
      if (current) {
        pieces.push(current);
        current = "";
      }
      for (let i = 0; i < word.length; i += maxChars) {
        pieces.push(word.slice(i, i + maxChars));
      }
      continue;
    }
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) {
      current = candidate;
    } else {
      pieces.push(current);
      current = word;
    }
  }
  if (current) pieces.push(current);
  return pieces;
}

/** Rough validation shared by the UI: returns an error message or null. */
export function validateTextInput(text: string, maxTotalChars = 5000): string | null {
  if (!text || !text.trim()) return "Enter some text to convert to speech.";
  if (text.length > maxTotalChars) {
    return `Text is too long (${text.length.toLocaleString()} characters; limit ${maxTotalChars.toLocaleString()}). Split it into smaller parts.`;
  }
  return null;
}
