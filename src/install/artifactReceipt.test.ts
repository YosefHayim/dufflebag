import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  artifactReceiptJsonSchema,
  artifactReceiptSchema,
  jsonValueSchema,
  ownedArtifactSchema,
  sha256Bytes,
  sha256JsonValue,
} from "./artifactReceipt.js";

const bytes = (value: string): Uint8Array => {
  return new TextEncoder().encode(value);
};

const wholeFile = (installed: Uint8Array, prior: Uint8Array | undefined) => ({
  _tag: "wholeFile",
  installedSha256: sha256Bytes(installed),
  prior:
    prior === undefined
      ? { _tag: "missing" }
      : {
          _tag: "file",
          bytes: prior,
          sha256: sha256Bytes(prior),
        },
});

const applicationOwner = {
  _tag: "application",
};

const sharedAgentOwner = {
  _tag: "agent",
  agentIds: ["codex", "aider", "continue"],
};

const receiptArtifacts = [
  {
    path: ".aider.conf.yml",
    owner: {
      _tag: "agent",
      agentIds: ["aider"],
    },
    kind: "configReference",
    ownership: {
      _tag: "yamlSequenceValue",
      key: "read",
      reference: "AGENTS.md",
      priorPresence: {
        _tag: "absent",
      },
      priorDocument: {
        _tag: "existing",
      },
    },
  },
  {
    path: ".claude/dufflebag/config.json",
    owner: applicationOwner,
    kind: "managedConfig",
    ownership: wholeFile(bytes("config-v1"), undefined),
  },
  {
    path: ".claude/dufflebag/hooks/contextGuard.js",
    owner: applicationOwner,
    kind: "runtime",
    ownership: wholeFile(bytes("runtime-v1"), bytes("original-runtime")),
  },
  {
    path: ".claude/settings.json",
    owner: applicationOwner,
    kind: "settings",
    ownership: {
      _tag: "jsonValues",
      entries: [
        {
          pointer: "/env/dufflebagDebugEnabled",
          installed: {
            _tag: "missing",
          },
          prior: {
            _tag: "value",
            value: "false",
          },
        },
        {
          pointer: "/hooks/PreToolUse",
          installed: {
            _tag: "value",
            value: ["node contextGuard.js"],
            sha256: sha256JsonValue(["node contextGuard.js"]),
          },
          prior: {
            _tag: "missing",
          },
        },
      ],
      priorDocument: {
        _tag: "existing",
      },
    },
  },
  {
    path: ".continue/config.json",
    owner: {
      _tag: "agent",
      agentIds: ["continue"],
    },
    kind: "configReference",
    ownership: {
      _tag: "jsonValues",
      entries: [
        {
          pointer: "/rules",
          installed: {
            _tag: "value",
            value: ["AGENTS.md"],
            sha256: sha256JsonValue(["AGENTS.md"]),
          },
          prior: {
            _tag: "missing",
          },
        },
      ],
      priorDocument: {
        _tag: "missing",
      },
    },
  },
  {
    path: ".cursor/rules/context-guard.mdc",
    owner: {
      _tag: "agent",
      agentIds: ["cursor"],
    },
    kind: "rule",
    ownership: wholeFile(bytes("rule-v1"), undefined),
  },
  {
    path: ".windsurfrules",
    owner: {
      _tag: "agent",
      agentIds: ["windsurf"],
    },
    kind: "instruction",
    ownership: {
      _tag: "managedBlock",
      startMarker: "<!-- dufflebag:skills start -->",
      endMarker: "<!-- dufflebag:skills end -->",
      installedBodySha256: sha256Bytes(bytes("\nmanaged body\n")),
      leadingDelimiter: bytes("\n\n"),
      trailingDelimiter: bytes("\n"),
      priorDocument: {
        _tag: "existing",
      },
    },
  },
  {
    path: "AGENTS.md",
    owner: sharedAgentOwner,
    kind: "instruction",
    ownership: {
      _tag: "managedBlock",
      startMarker: "<!-- dufflebag:skills start -->",
      endMarker: "<!-- dufflebag:skills end -->",
      installedBodySha256: sha256Bytes(bytes("\nshared body\n")),
      leadingDelimiter: bytes("\n\n"),
      trailingDelimiter: bytes("\n"),
      priorDocument: {
        _tag: "missing",
      },
    },
  },
  {
    path: "skills/context-guard/SKILL.md",
    owner: {
      _tag: "agent",
      agentIds: ["claude-code"],
    },
    kind: "skill",
    ownership: wholeFile(bytes("skill-v1"), undefined),
  },
];

const completeReceipt = {
  version: 1,
  installerVersion: "0.11.0",
  scope: "project",
  features: ["context-guard", "dedup-guard"],
  artifacts: receiptArtifacts,
};

const decodeReceipt = Schema.validateSync(artifactReceiptSchema, {
  onExcessProperty: "error",
});

const decodeEncodedReceipt = Schema.decodeUnknownSync(artifactReceiptSchema, {
  onExcessProperty: "error",
});

const decodeArtifact = Schema.validateSync(ownedArtifactSchema, {
  onExcessProperty: "error",
});

const decodeJsonValue = Schema.decodeUnknownSync(jsonValueSchema, {
  onExcessProperty: "error",
});

const symbolKeyedJsonObject = {
  visible: "value",
};
Object.defineProperty(symbolKeyedJsonObject, Symbol("hidden"), {
  enumerable: true,
  value: "not-json",
});

const accessorJsonObject = {};
Object.defineProperty(accessorJsonObject, "value", {
  enumerable: true,
  get: () => "not-plain-data",
});

describe("artifactReceiptSchema", () => {
  it("decodes every artifact kind, metadata tag, and ownership tag", () => {
    const decoded = decodeReceipt(completeReceipt);

    expect(decoded.version).toBe(1);
    expect(new Set(decoded.artifacts.map((artifact) => artifact.kind))).toEqual(
      new Set(["runtime", "skill", "rule", "instruction", "configReference", "settings", "managedConfig"]),
    );
    expect(new Set(decoded.artifacts.map((artifact) => artifact.ownership._tag))).toEqual(
      new Set(["wholeFile", "managedBlock", "jsonValues", "yamlSequenceValue"]),
    );
    expect(decoded.artifacts.find((artifact) => artifact.path === "AGENTS.md")?.owner).toEqual(sharedAgentOwner);
  });

  it("round-trips canonical receipt JSON including exact arbitrary prior bytes", () => {
    const arbitraryBytes = new Uint8Array([0, 10, 13, 255]);
    const decoded = decodeReceipt({
      ...completeReceipt,
      artifacts: [
        {
          path: "runtime.js",
          owner: applicationOwner,
          kind: "runtime",
          ownership: wholeFile(bytes("installed"), arbitraryBytes),
        },
      ],
    });

    const encodedJson = Schema.encodeSync(artifactReceiptJsonSchema)(decoded);
    const roundTripped = Schema.decodeUnknownSync(artifactReceiptJsonSchema, {
      onExcessProperty: "error",
    })(encodedJson);

    expect(encodedJson).toContain("AAoN/w==");
    expect(roundTripped).toEqual(decoded);
    expect(Schema.encodeSync(artifactReceiptJsonSchema)(roundTripped)).toBe(encodedJson);
  });

  it("encodes equivalent JSON object values to byte-identical receipt JSON", () => {
    const receiptWithValue = (value: { readonly a: number; readonly b: number }) => {
      return decodeReceipt({
        ...completeReceipt,
        artifacts: [
          {
            path: "settings.json",
            owner: applicationOwner,
            kind: "settings",
            ownership: {
              _tag: "jsonValues",
              entries: [
                {
                  pointer: "/value",
                  installed: {
                    _tag: "value",
                    value,
                    sha256: sha256JsonValue(value),
                  },
                  prior: {
                    _tag: "missing",
                  },
                },
              ],
              priorDocument: {
                _tag: "existing",
              },
            },
          },
        ],
      });
    };
    const first = receiptWithValue({ b: 2, a: 1 });
    const second = receiptWithValue({ a: 1, b: 2 });

    expect(Schema.encodeSync(artifactReceiptJsonSchema)(first)).toBe(Schema.encodeSync(artifactReceiptJsonSchema)(second));
  });

  it("accepts recursive JSON values and hashes canonical object-key order", () => {
    const first = decodeJsonValue({
      z: [true, null, { b: 2, a: "one" }],
      a: false,
    });
    const second = decodeJsonValue({
      a: false,
      z: [true, null, { a: "one", b: 2 }],
    });

    expect(first).toEqual(second);
    expect(sha256JsonValue(first)).toBe(sha256JsonValue(second));
    expect(sha256JsonValue([1, 2])).not.toBe(sha256JsonValue([2, 1]));
  });

  it.each([
    undefined,
    1n,
    () => "no",
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    new Date("2026-01-01T00:00:00.000Z"),
    new Map([["key", "value"]]),
    new Uint8Array([1]),
    /not-json/,
    {
      nested: new Date("2026-01-01T00:00:00.000Z"),
    },
    Array(2),
    symbolKeyedJsonObject,
    accessorJsonObject,
  ])("rejects non-JSON runtime values %#", (value) => {
    expect(() => {
      decodeJsonValue(value);
    }).toThrow();
  });

  it("rejects noncanonical or invalid persisted base64", () => {
    const encoded = Schema.encodeSync(artifactReceiptSchema)(
      decodeReceipt({
        ...completeReceipt,
        artifacts: [
          {
            path: "runtime.js",
            owner: applicationOwner,
            kind: "runtime",
            ownership: wholeFile(bytes("installed"), new Uint8Array([0])),
          },
        ],
      }),
    );
    const artifact = encoded.artifacts[0];

    expect(artifact?.ownership._tag).toBe("wholeFile");
    if (artifact?.ownership._tag !== "wholeFile" || artifact.ownership.prior._tag !== "file") {
      throw new Error("The encoded fixture must contain prior file bytes.");
    }

    expect(() => {
      decodeEncodedReceipt({
        ...encoded,
        artifacts: [
          {
            ...artifact,
            ownership: {
              ...artifact.ownership,
              prior: {
                ...artifact.ownership.prior,
                bytes: "AA==\n",
              },
            },
          },
        ],
      });
    }).toThrow();
    expect(() => {
      decodeEncodedReceipt({
        ...encoded,
        artifacts: [
          {
            ...artifact,
            ownership: {
              ...artifact.ownership,
              prior: {
                ...artifact.ownership.prior,
                bytes: "AB==",
              },
            },
          },
        ],
      });
    }).toThrow();
    expect(() => {
      decodeEncodedReceipt({
        ...encoded,
        artifacts: [
          {
            ...artifact,
            ownership: {
              ...artifact.ownership,
              prior: {
                ...artifact.ownership.prior,
                bytes: "not-base64",
              },
            },
          },
        ],
      });
    }).toThrow();
  });

  it.each([
    ["runtime", "managedBlock"],
    ["skill", "jsonValues"],
    ["rule", "yamlSequenceValue"],
    ["managedConfig", "managedBlock"],
    ["instruction", "wholeFile"],
    ["settings", "wholeFile"],
    ["configReference", "wholeFile"],
  ])("rejects the closed %s and %s kind-metadata mismatch", (kind, ownershipTag) => {
    const ownershipByTag = new Map([
      ["wholeFile", wholeFile(bytes("installed"), undefined)],
      ["managedBlock", receiptArtifacts[6]?.ownership],
      ["jsonValues", receiptArtifacts[3]?.ownership],
      ["yamlSequenceValue", receiptArtifacts[0]?.ownership],
    ]);
    const ownership = ownershipByTag.get(ownershipTag);

    expect(ownership).toBeDefined();
    expect(() => {
      decodeArtifact({
        path: "mismatch.txt",
        owner: applicationOwner,
        kind,
        ownership,
      });
    }).toThrow();
  });

  it("rejects receipt as an owned artifact and unknown keys at nested boundaries", () => {
    expect(() => {
      decodeArtifact({
        path: "receipt.json",
        owner: applicationOwner,
        kind: "receipt",
        ownership: wholeFile(bytes("receipt"), undefined),
      });
    }).toThrow();
    expect(() => {
      decodeReceipt({
        ...completeReceipt,
        unknown: true,
      });
    }).toThrow();
    expect(() => {
      decodeArtifact({
        ...receiptArtifacts[1],
        owner: {
          _tag: "application",
          unknown: true,
        },
      });
    }).toThrow();
    expect(() => {
      decodeArtifact({
        ...receiptArtifacts[1],
        ownership: {
          ...receiptArtifacts[1]?.ownership,
          unknown: true,
        },
      });
    }).toThrow();
  });

  it("requires stable non-empty unique agent IDs without reordering them", () => {
    expect(decodeArtifact(receiptArtifacts[7])?.owner).toEqual(sharedAgentOwner);
    expect(() => {
      decodeArtifact({
        ...receiptArtifacts[7],
        owner: {
          _tag: "agent",
          agentIds: [],
        },
      });
    }).toThrow();
    expect(() => {
      decodeArtifact({
        ...receiptArtifacts[7],
        owner: {
          _tag: "agent",
          agentIds: ["codex", "codex"],
        },
      });
    }).toThrow();
    expect(() => {
      decodeArtifact({
        ...receiptArtifacts[7],
        owner: {
          _tag: "agent",
          agentIds: ["Codex"],
        },
      });
    }).toThrow();
  });

  it.each([
    "",
    ".",
    "..",
    "../x",
    "a/../b",
    "a/./b",
    "a//b",
    "a/",
    "/a",
    "C:/a",
    "\\\\server\\x",
    "a\\b",
    "a\0b",
  ])("rejects unsafe or non-normalized artifact path %j", (path) => {
    expect(() => {
      decodeArtifact({
        ...receiptArtifacts[1],
        path,
      });
    }).toThrow();
  });

  it("requires strict path sorting and rejects duplicate or parent-child receipt artifacts", () => {
    expect(() => {
      decodeReceipt({
        ...completeReceipt,
        artifacts: [...receiptArtifacts].reverse(),
      });
    }).toThrow();
    expect(() => {
      decodeReceipt({
        ...completeReceipt,
        artifacts: [receiptArtifacts[1], receiptArtifacts[1]],
      });
    }).toThrow();
    expect(() => {
      decodeReceipt({
        ...completeReceipt,
        artifacts: [
          {
            ...receiptArtifacts[1],
            path: "owned",
          },
          {
            ...receiptArtifacts[2],
            path: "owned/child.js",
          },
        ],
      });
    }).toThrow();
    expect(() => {
      decodeReceipt({
        ...completeReceipt,
        artifacts: [
          {
            ...receiptArtifacts[1],
            path: "owned",
          },
          {
            ...receiptArtifacts[2],
            path: "owned-sibling",
          },
          {
            ...receiptArtifacts[3],
            path: "owned/child.js",
          },
        ],
      });
    }).toThrow();
  });

  it("rejects malformed hashes and whole-file prior byte hash mismatches", () => {
    expect(() => {
      decodeArtifact({
        ...receiptArtifacts[1],
        ownership: {
          _tag: "wholeFile",
          installedSha256: "BAD",
          prior: {
            _tag: "missing",
          },
        },
      });
    }).toThrow();
    expect(() => {
      decodeArtifact({
        ...receiptArtifacts[2],
        ownership: {
          _tag: "wholeFile",
          installedSha256: sha256Bytes(bytes("runtime-v1")),
          prior: {
            _tag: "file",
            bytes: bytes("original-runtime"),
            sha256: sha256Bytes(bytes("different")),
          },
        },
      });
    }).toThrow();
  });

  it.each(["", "rules", "/a~2b", "/a~", "/a/~x"])("rejects unsafe or malformed JSON pointer %j", (pointer) => {
    const settings = receiptArtifacts[3];

    expect(settings?.ownership._tag).toBe("jsonValues");
    if (settings?.ownership._tag !== "jsonValues") {
      throw new Error("The settings fixture must use JSON value ownership.");
    }

    expect(() => {
      decodeArtifact({
        ...settings,
        ownership: {
          ...settings.ownership,
          entries: [
            {
              ...settings.ownership.entries[0],
              pointer,
            },
          ],
        },
      });
    }).toThrow();
  });

  it("accepts escaped RFC 6901 pointers but rejects duplicate and overlapping ownership", () => {
    const settings = receiptArtifacts[3];

    expect(settings?.ownership._tag).toBe("jsonValues");
    if (settings?.ownership._tag !== "jsonValues") {
      throw new Error("The settings fixture must use JSON value ownership.");
    }

    const entry = settings.ownership.entries[0];
    expect(
      decodeArtifact({
        ...settings,
        ownership: {
          ...settings.ownership,
          entries: [
            {
              ...entry,
              pointer: "/a~1b/~0c",
            },
          ],
        },
      }),
    ).toBeDefined();
    expect(() => {
      decodeArtifact({
        ...settings,
        ownership: {
          ...settings.ownership,
          entries: [entry, entry],
        },
      });
    }).toThrow();
    expect(() => {
      decodeArtifact({
        ...settings,
        ownership: {
          ...settings.ownership,
          entries: [
            {
              ...entry,
              pointer: "/env",
            },
            {
              ...entry,
              pointer: "/env/debug",
            },
          ],
        },
      });
    }).toThrow();
  });

  it("validates installed JSON hashes and document-history consistency", () => {
    const settings = receiptArtifacts[3];

    expect(settings?.ownership._tag).toBe("jsonValues");
    if (settings?.ownership._tag !== "jsonValues") {
      throw new Error("The settings fixture must use JSON value ownership.");
    }

    expect(() => {
      decodeArtifact({
        ...settings,
        ownership: {
          ...settings.ownership,
          entries: [
            {
              pointer: "/value",
              installed: {
                _tag: "value",
                value: false,
                sha256: sha256JsonValue(true),
              },
              prior: {
                _tag: "missing",
              },
            },
          ],
        },
      });
    }).toThrow();
    expect(() => {
      decodeArtifact({
        ...settings,
        ownership: {
          ...settings.ownership,
          entries: [
            {
              pointer: "/value",
              installed: {
                _tag: "missing",
              },
              prior: {
                _tag: "value",
                value: false,
              },
            },
          ],
          priorDocument: {
            _tag: "missing",
          },
        },
      });
    }).toThrow();
  });

  it.each(["x", "\r", "\n\n\n", "\r\n\r\n\n"])("rejects invalid managed-block delimiter %j", (delimiter) => {
    const instruction = receiptArtifacts[6];

    expect(instruction?.ownership._tag).toBe("managedBlock");
    if (instruction?.ownership._tag !== "managedBlock") {
      throw new Error("The instruction fixture must use managed block ownership.");
    }

    expect(() => {
      decodeArtifact({
        ...instruction,
        ownership: {
          ...instruction.ownership,
          leadingDelimiter: bytes(delimiter),
        },
      });
    }).toThrow();
  });

  it("rejects empty, duplicate, multiline, and NUL managed-block markers", () => {
    const instruction = receiptArtifacts[6];

    expect(instruction?.ownership._tag).toBe("managedBlock");
    if (instruction?.ownership._tag !== "managedBlock") {
      throw new Error("The instruction fixture must use managed block ownership.");
    }

    ["", instruction.ownership.endMarker, "start\nmarker", "start\0marker"].forEach((startMarker) => {
      expect(() => {
        decodeArtifact({
          ...instruction,
          ownership: {
            ...instruction.ownership,
            startMarker,
          },
        });
      }).toThrow();
    });
  });

  it("requires receipt version one, a separate installer version, unique features, and no excess properties", () => {
    expect(() => {
      decodeReceipt({
        ...completeReceipt,
        version: 2,
      });
    }).toThrow();
    expect(() => {
      decodeReceipt({
        ...completeReceipt,
        installerVersion: "",
      });
    }).toThrow();
    expect(() => {
      decodeReceipt({
        ...completeReceipt,
        features: ["context-guard", "context-guard"],
      });
    }).toThrow();
  });
});
