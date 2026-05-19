import { describe, it, expect } from "vitest";
import { validateName, toKebab } from "../src/core/name.js";

describe("validateName", () => {
  it("accepts PascalCase", () => {
    expect(validateName("QuoteCard").ok).toBe(true);
    expect(validateName("ABCard").ok).toBe(true);
    expect(validateName("Card1").ok).toBe(true);
  });

  it("rejects single letter", () => {
    const r = validateName("Q");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/PascalCase/);
  });

  it("rejects lowercase start", () => {
    expect(validateName("quoteCard").ok).toBe(false);
  });

  it("rejects empty string", () => {
    expect(validateName("").ok).toBe(false);
  });

  it("rejects non-ASCII or punctuation", () => {
    expect(validateName("Quote-Card").ok).toBe(false);
    expect(validateName("QuôteCard").ok).toBe(false);
    expect(validateName("Quote Card").ok).toBe(false);
  });

  it("rejects JS reserved words", () => {
    expect(validateName("Class").ok).toBe(false);
    expect(validateName("Return").ok).toBe(false);
  });
});

describe("toKebab", () => {
  it("single word", () => {
    expect(toKebab("Card")).toBe("card");
  });
  it("two words", () => {
    expect(toKebab("QuoteCard")).toBe("quote-card");
  });
  it("acronym prefix", () => {
    expect(toKebab("OAuthButton")).toBe("o-auth-button");
  });
  it("trailing digit", () => {
    expect(toKebab("Card2")).toBe("card2");
  });
});
