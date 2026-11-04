import { describe, expect, it } from "vitest";
import { KOKORO_VOICES } from "../engines/kokoro/voices";

describe("kokoro voice grades", () => {
  it("every voice exposes overallGrade as a real field", () => {
    expect(KOKORO_VOICES.length).toBe(28);
    for (const v of KOKORO_VOICES) {
      expect(typeof v.overallGrade).toBe("string");
      expect(v.overallGrade!.length).toBeGreaterThan(0);
    }
  });

  it("the field matches the grade previously re-parsed from the description", () => {
    for (const v of KOKORO_VOICES) {
      const m = v.description.match(/grade (\S+)/);
      expect(m, `${v.id} description should mention its grade`).not.toBeNull();
      expect(m![1]).toBe(v.overallGrade);
    }
  });
});
