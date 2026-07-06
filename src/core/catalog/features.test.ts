/**
 * Tests for the feature catalog's dependency resolution — the rule that asking
 * for the autonomous loop always also pulls the context guard it depends on, in
 * a stable catalog order, with no duplicates.
 */

import { describe, expect, it } from "vitest";

import { resolveFeatures, skillsFor } from "./features.js";

describe("resolveFeatures", () => {
  it("pulls context-guard when autonomous-loop is requested", () => {
    expect(resolveFeatures(["autonomous-loop"])).toEqual(["context-guard", "autonomous-loop"]);
  });

  it("dedupes and returns catalog order regardless of request order", () => {
    expect(resolveFeatures(["speak-response", "autonomous-loop", "context-guard"])).toEqual([
      "context-guard",
      "autonomous-loop",
      "speak-response",
    ]);
  });

  it("throws on an unknown feature id", () => {
    // @ts-expect-error — exercising the runtime guard with an invalid id
    expect(() => resolveFeatures(["nope"])).toThrow(/Unknown feature/);
  });

  it("resolves png-to-code as a standalone feature with no dependencies", () => {
    expect(resolveFeatures(["png-to-code"])).toEqual(["png-to-code"]);
  });

  it("resolves refresh-agent-docs as a standalone feature with no dependencies", () => {
    expect(resolveFeatures(["refresh-agent-docs"])).toEqual(["refresh-agent-docs"]);
  });

  it("resolves readme-editor as a standalone feature with no dependencies", () => {
    expect(resolveFeatures(["readme-editor"])).toEqual(["readme-editor"]);
  });
});

describe("skillsFor", () => {
  it("collects the autonomous-loop skills and nothing for guard-only", () => {
    expect(skillsFor(["context-guard"])).toEqual([]);
    expect(skillsFor(["autonomous-loop"])).toEqual(["autorun"]);
  });

  it("maps png-to-code to its own skill directory", () => {
    expect(skillsFor(["png-to-code"])).toEqual(["png-to-code"]);
  });

  it("maps refresh-agent-docs to its own skill directory", () => {
    expect(skillsFor(["refresh-agent-docs"])).toEqual(["refresh-agent-docs"]);
  });

  it("maps readme-editor to its own skill directory", () => {
    expect(skillsFor(["readme-editor"])).toEqual(["readme-editor"]);
  });
});
