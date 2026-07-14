import { Option, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  artifactObservationSchema,
  artifactObservationsEqual,
  currentSnapshotMatches,
  deriveRestorationBytes,
  desiredBytesMatch,
  restorationBytesMatch,
  restorationCanRemove,
} from "./artifactMaterialization.js";
import { type OwnedArtifact, ownedArtifactSchema, sha256Bytes, sha256JsonValue } from "./artifactReceipt.js";

const bytes = (value: string): Uint8Array => {
  return new TextEncoder().encode(value);
};

const decodeArtifact = Schema.validateSync(ownedArtifactSchema, {
  onExcessProperty: "error",
});

const decodeObservation = Schema.validateSync(artifactObservationSchema, {
  onExcessProperty: "error",
});

const fileObservation = (artifactPath: string, value: Uint8Array) => {
  return decodeObservation({
    path: artifactPath,
    snapshot: {
      _tag: "file",
      bytes: value,
      sha256: sha256Bytes(value),
    },
  });
};

const missingObservation = (artifactPath: string) => {
  return decodeObservation({
    path: artifactPath,
    snapshot: {
      _tag: "missing",
    },
  });
};

const applicationOwner = {
  _tag: "application",
};

const priorRuntimeBytes = bytes("runtime-v0");
const installedRuntimeBytes = bytes("runtime-v1");
const runtimeArtifact = decodeArtifact({
  path: "runtime.js",
  owner: applicationOwner,
  kind: "runtime",
  ownership: {
    _tag: "wholeFile",
    installedSha256: sha256Bytes(installedRuntimeBytes),
    prior: {
      _tag: "file",
      bytes: priorRuntimeBytes,
      sha256: sha256Bytes(priorRuntimeBytes),
    },
  },
});

const priorInstructionBytes = bytes("user content\n");
const installedInstructionBytes = bytes("user content\n\n<!-- bag:start -->\nbody\n<!-- bag:end -->\n");
const instructionArtifact = decodeArtifact({
  path: "AGENTS.md",
  owner: applicationOwner,
  kind: "instruction",
  ownership: {
    _tag: "managedBlock",
    startMarker: "<!-- bag:start -->",
    endMarker: "<!-- bag:end -->",
    installedBodySha256: sha256Bytes(bytes("\nbody\n")),
    leadingDelimiter: bytes("\n"),
    trailingDelimiter: bytes("\n"),
    priorDocument: {
      _tag: "existing",
    },
  },
});

const priorSettingsBytes = bytes('{"owned":"old","unrelated":{"keep":true}}');
const installedSettingsBytes = bytes('{"owned":"new","unrelated":{"keep":true}}');
const settingsArtifact = decodeArtifact({
  path: "settings.json",
  owner: applicationOwner,
  kind: "settings",
  ownership: {
    _tag: "jsonValues",
    entries: [
      {
        pointer: "/owned",
        installed: {
          _tag: "value",
          value: "new",
          sha256: sha256JsonValue("new"),
        },
        prior: {
          _tag: "value",
          value: "old",
        },
      },
    ],
    priorDocument: {
      _tag: "existing",
    },
  },
});

const priorYamlBytes = bytes("read: []\nunrelated: keep\n");
const installedYamlBytes = bytes("read:\n  - AGENTS.md\nunrelated: keep\n");
const yamlArtifact = decodeArtifact({
  path: ".aider.conf.yml",
  owner: applicationOwner,
  kind: "configReference",
  ownership: {
    _tag: "yamlSequenceValue",
    key: "read",
    reference: "AGENTS.md",
    priorPresence: {
      _tag: "absent",
    },
    priorKeyPresence: {
      _tag: "present",
    },
    priorDocument: {
      _tag: "existing",
    },
  },
});

describe("artifactObservationSchema", () => {
  it("binds exact file bytes to their hash and rejects excess snapshot authority", () => {
    const observation = fileObservation(runtimeArtifact.path, installedRuntimeBytes);

    expect(observation.snapshot._tag).toBe("file");
    expect(() => {
      decodeObservation({
        ...observation,
        snapshot: {
          ...observation.snapshot,
          sha256: sha256Bytes(bytes("different")),
        },
      });
    }).toThrow();
    expect(() => {
      decodeObservation({
        ...observation,
        deleteAllowed: true,
      });
    }).toThrow();
  });

  it("compares missing and file observations without trusting object identity", () => {
    const first = fileObservation(runtimeArtifact.path, installedRuntimeBytes);
    const second = fileObservation(runtimeArtifact.path, new Uint8Array(installedRuntimeBytes));

    expect(artifactObservationsEqual(first, second)).toBe(true);
    expect(artifactObservationsEqual(first, missingObservation(runtimeArtifact.path))).toBe(false);
    expect(artifactObservationsEqual(first, fileObservation("other.js", installedRuntimeBytes))).toBe(false);
  });
});

describe("whole-file materialization", () => {
  it("matches installed and prior snapshots and derives the exact inverse", () => {
    const installed = fileObservation(runtimeArtifact.path, installedRuntimeBytes);
    const prior = fileObservation(runtimeArtifact.path, priorRuntimeBytes);

    expect(currentSnapshotMatches({ artifact: runtimeArtifact, observation: installed, target: "installed" })).toBe(true);
    expect(currentSnapshotMatches({ artifact: runtimeArtifact, observation: prior, target: "prior" })).toBe(true);
    expect(
      desiredBytesMatch({
        artifact: runtimeArtifact,
        candidateBytes: installedRuntimeBytes,
        observation: prior,
        previous: Option.none<OwnedArtifact>(),
      }),
    ).toBe(true);
    expect(
      desiredBytesMatch({
        artifact: runtimeArtifact,
        candidateBytes: bytes("different runtime"),
        observation: prior,
        previous: Option.none<OwnedArtifact>(),
      }),
    ).toBe(false);
    expect(deriveRestorationBytes(runtimeArtifact, installed)).toEqual(Option.some(priorRuntimeBytes));
    expect(restorationBytesMatch({ artifact: runtimeArtifact, observation: installed, candidateBytes: priorRuntimeBytes })).toBe(true);
  });

  it("allows removal only when the receipt proves the target was originally missing", () => {
    const createdArtifact = decodeArtifact({
      ...runtimeArtifact,
      ownership: {
        ...runtimeArtifact.ownership,
        prior: {
          _tag: "missing",
        },
      },
    });

    expect(restorationCanRemove(createdArtifact, fileObservation(createdArtifact.path, installedRuntimeBytes))).toBe(true);
    expect(restorationCanRemove(runtimeArtifact, fileObservation(runtimeArtifact.path, installedRuntimeBytes))).toBe(false);
  });
});

describe("managed-block materialization", () => {
  it("requires complete marker lines and preserves every unrelated byte", () => {
    const prior = fileObservation(instructionArtifact.path, priorInstructionBytes);

    expect(
      desiredBytesMatch({
        artifact: instructionArtifact,
        candidateBytes: installedInstructionBytes,
        observation: prior,
        previous: Option.none<OwnedArtifact>(),
      }),
    ).toBe(true);
    expect(
      desiredBytesMatch({
        artifact: instructionArtifact,
        candidateBytes: bytes("user content\nprefix <!-- bag:start -->\nbody\n<!-- bag:end -->\n"),
        observation: prior,
        previous: Option.none<OwnedArtifact>(),
      }),
    ).toBe(false);
  });

  it("removes only the exact managed span during restoration", () => {
    const installed = fileObservation(instructionArtifact.path, installedInstructionBytes);

    expect(deriveRestorationBytes(instructionArtifact, installed)).toEqual(Option.some(priorInstructionBytes));
    expect(restorationBytesMatch({ artifact: instructionArtifact, observation: installed, candidateBytes: priorInstructionBytes })).toBe(
      true,
    );
    expect(restorationBytesMatch({ artifact: instructionArtifact, observation: installed, candidateBytes: bytes("replacement\n") })).toBe(
      false,
    );
  });
});

describe("JSON-value materialization", () => {
  it("rejects an existing document when fresh ownership records the document as missing", () => {
    const createdArtifact = decodeArtifact({
      ...settingsArtifact,
      path: "created.json",
      ownership: {
        _tag: "jsonValues",
        entries: [
          {
            pointer: "/owned",
            installed: {
              _tag: "value",
              value: "new",
              sha256: sha256JsonValue("new"),
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
    });
    const existing = fileObservation(createdArtifact.path, bytes("{}"));

    expect(currentSnapshotMatches({ artifact: createdArtifact, observation: existing, target: "prior" })).toBe(false);
    expect(
      desiredBytesMatch({
        artifact: createdArtifact,
        candidateBytes: bytes('{"owned":"new"}'),
        observation: existing,
        previous: Option.none<OwnedArtifact>(),
      }),
    ).toBe(false);
  });

  it("preserves unrelated semantic values and rejects a clobbering candidate", () => {
    const prior = fileObservation(settingsArtifact.path, priorSettingsBytes);

    expect(
      desiredBytesMatch({
        artifact: settingsArtifact,
        candidateBytes: installedSettingsBytes,
        observation: prior,
        previous: Option.none<OwnedArtifact>(),
      }),
    ).toBe(true);
    expect(
      desiredBytesMatch({
        artifact: settingsArtifact,
        candidateBytes: bytes('{"owned":"new"}'),
        observation: prior,
        previous: Option.none<OwnedArtifact>(),
      }),
    ).toBe(false);
  });

  it("distinguishes a present null value from a missing pointer", () => {
    const nullArtifact = decodeArtifact({
      ...settingsArtifact,
      path: "null.json",
      ownership: {
        _tag: "jsonValues",
        entries: [
          {
            pointer: "/value",
            installed: {
              _tag: "value",
              value: null,
              sha256: sha256JsonValue(null),
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
    });

    expect(
      desiredBytesMatch({
        artifact: nullArtifact,
        candidateBytes: bytes('{"value":null}'),
        observation: fileObservation(nullArtifact.path, bytes("{}")),
        previous: Option.none<OwnedArtifact>(),
      }),
    ).toBe(true);
    expect(
      currentSnapshotMatches({
        artifact: nullArtifact,
        observation: fileObservation(nullArtifact.path, bytes("{}")),
        target: "installed",
      }),
    ).toBe(false);
  });

  it("proves a newly owned pointer prior against the post-restoration current document", () => {
    const previous = decodeArtifact({
      ...settingsArtifact,
      path: "extended.json",
    });
    const desired = decodeArtifact({
      ...previous,
      ownership: {
        ...previous.ownership,
        entries: [
          {
            pointer: "/new",
            installed: {
              _tag: "value",
              value: "owned",
              sha256: sha256JsonValue("owned"),
            },
            prior: {
              _tag: "missing",
            },
          },
          ...(previous.ownership._tag === "jsonValues" ? previous.ownership.entries : []),
        ],
      },
    });
    const current = fileObservation(previous.path, bytes('{"new":"user","owned":"new","unrelated":{"keep":true}}'));

    expect(
      desiredBytesMatch({
        artifact: desired,
        candidateBytes: bytes('{"new":"owned","owned":"new","unrelated":{"keep":true}}'),
        observation: current,
        previous: Option.some(previous),
      }),
    ).toBe(false);
  });

  it("rejects traversal into array indexes while allowing ownership of an entire array value", () => {
    const indexedArtifact = decodeArtifact({
      ...settingsArtifact,
      path: "array.json",
      ownership: {
        _tag: "jsonValues",
        entries: [
          {
            pointer: "/items/0",
            installed: {
              _tag: "value",
              value: "owned",
              sha256: sha256JsonValue("owned"),
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
    });
    const wholeArrayArtifact = decodeArtifact({
      ...indexedArtifact,
      ownership: {
        ...indexedArtifact.ownership,
        entries: [
          {
            pointer: "/items",
            installed: {
              _tag: "value",
              value: ["owned"],
              sha256: sha256JsonValue(["owned"]),
            },
            prior: {
              _tag: "value",
              value: ["user"],
            },
          },
        ],
      },
    });
    const indexedObservation = fileObservation(indexedArtifact.path, bytes('{"items":["owned","unrelated"]}'));
    const priorArrayObservation = fileObservation(wholeArrayArtifact.path, bytes('{"items":["user"]}'));

    expect(currentSnapshotMatches({ artifact: indexedArtifact, observation: indexedObservation, target: "installed" })).toBe(false);
    expect(
      desiredBytesMatch({
        artifact: wholeArrayArtifact,
        candidateBytes: bytes('{"items":["owned"]}'),
        observation: priorArrayObservation,
        previous: Option.none<OwnedArtifact>(),
      }),
    ).toBe(true);
  });

  it("restores owned pointers without discarding unrelated values", () => {
    const installed = fileObservation(settingsArtifact.path, installedSettingsBytes);

    expect(
      restorationBytesMatch({
        artifact: settingsArtifact,
        observation: installed,
        candidateBytes: priorSettingsBytes,
      }),
    ).toBe(true);
    expect(
      restorationBytesMatch({
        artifact: settingsArtifact,
        observation: installed,
        candidateBytes: bytes('{"owned":"old"}'),
      }),
    ).toBe(false);
  });
});

describe("YAML sequence materialization", () => {
  it("rejects an existing document when fresh ownership records the document as missing", () => {
    const createdArtifact = decodeArtifact({
      ...yamlArtifact,
      ownership: {
        ...yamlArtifact.ownership,
        priorKeyPresence: {
          _tag: "absent",
        },
        priorDocument: {
          _tag: "missing",
        },
      },
    });
    const existing = fileObservation(createdArtifact.path, bytes("read: []\n"));

    expect(currentSnapshotMatches({ artifact: createdArtifact, observation: existing, target: "prior" })).toBe(false);
    expect(
      desiredBytesMatch({
        artifact: createdArtifact,
        candidateBytes: bytes("read:\n  - AGENTS.md\n"),
        observation: existing,
        previous: Option.none<OwnedArtifact>(),
      }),
    ).toBe(false);
  });

  it("materializes the only valid document from a previously missing YAML target", () => {
    const createdArtifact = decodeArtifact({
      ...yamlArtifact,
      ownership: {
        ...yamlArtifact.ownership,
        priorKeyPresence: {
          _tag: "absent",
        },
        priorDocument: {
          _tag: "missing",
        },
      },
    });

    expect(
      desiredBytesMatch({
        artifact: createdArtifact,
        candidateBytes: bytes("read:\n  - AGENTS.md\n"),
        observation: missingObservation(createdArtifact.path),
        previous: Option.none<OwnedArtifact>(),
      }),
    ).toBe(true);
    expect(
      desiredBytesMatch({
        artifact: createdArtifact,
        candidateBytes: bytes("unrelated: lost\nread:\n  - AGENTS.md\n"),
        observation: missingObservation(createdArtifact.path),
        previous: Option.none<OwnedArtifact>(),
      }),
    ).toBe(false);
  });

  it("uses strict full-document parsing before applying the narrow byte-range edit", () => {
    expect(
      desiredBytesMatch({
        artifact: yamlArtifact,
        candidateBytes: installedYamlBytes,
        observation: fileObservation(yamlArtifact.path, priorYamlBytes),
        previous: Option.none<OwnedArtifact>(),
      }),
    ).toBe(true);

    const invalidCases = [
      {
        current: "broken: [\nread: []\n",
        desired: "broken: [\nread:\n  - AGENTS.md\n",
      },
      {
        current: 'read: []\n"read": []\n',
        desired: 'read:\n  - AGENTS.md\n"read": []\n',
      },
    ];

    // Exercise both whole-document parser failures through the same exact materialization boundary.
    invalidCases.forEach(({ current, desired }) => {
      expect(
        desiredBytesMatch({
          artifact: yamlArtifact,
          candidateBytes: bytes(desired),
          observation: fileObservation(yamlArtifact.path, bytes(current)),
          previous: Option.none<OwnedArtifact>(),
        }),
      ).toBe(false);
    });
  });

  it("adds a missing owned key while preserving every existing byte", () => {
    const missingKeyArtifact = decodeArtifact({
      ...yamlArtifact,
      ownership: {
        ...yamlArtifact.ownership,
        priorKeyPresence: {
          _tag: "absent",
        },
      },
    });
    const prior = bytes('# keep this comment\r\nmode: "safe"\r\n');
    const installed = bytes('# keep this comment\r\nmode: "safe"\r\n\r\nread:\r\n  - AGENTS.md\r\n');
    const priorObservation = fileObservation(missingKeyArtifact.path, prior);
    const installedObservation = fileObservation(missingKeyArtifact.path, installed);

    expect(currentSnapshotMatches({ artifact: missingKeyArtifact, observation: priorObservation, target: "prior" })).toBe(true);
    expect(
      desiredBytesMatch({
        artifact: missingKeyArtifact,
        candidateBytes: installed,
        observation: priorObservation,
        previous: Option.none<OwnedArtifact>(),
      }),
    ).toBe(true);
    expect(
      desiredBytesMatch({
        artifact: missingKeyArtifact,
        candidateBytes: bytes("mode: safe\r\nread:\r\n  - AGENTS.md\r\n"),
        observation: priorObservation,
        previous: Option.none<OwnedArtifact>(),
      }),
    ).toBe(false);
    expect(deriveRestorationBytes(missingKeyArtifact, installedObservation)).toEqual(Option.some(prior));
  });

  it("restores a missing key without adding a final newline to the prior document", () => {
    const missingKeyArtifact = decodeArtifact({
      ...yamlArtifact,
      ownership: {
        ...yamlArtifact.ownership,
        priorKeyPresence: {
          _tag: "absent",
        },
      },
    });
    const prior = bytes("mode: safe");
    const installed = bytes("mode: safe\nread:\n  - AGENTS.md\n");
    const priorObservation = fileObservation(missingKeyArtifact.path, prior);
    const installedObservation = fileObservation(missingKeyArtifact.path, installed);

    expect(
      desiredBytesMatch({
        artifact: missingKeyArtifact,
        candidateBytes: installed,
        observation: priorObservation,
        previous: Option.none<OwnedArtifact>(),
      }),
    ).toBe(true);
    expect(deriveRestorationBytes(missingKeyArtifact, installedObservation)).toEqual(Option.some(prior));
  });

  it("edits a flow sequence containing quoted values without reformatting it", () => {
    const prior = bytes('header: "keep"\nread: ["RULES.md", \'notes file.md\'] # keep this spacing\nfooter: keep\n');
    const installed = bytes('header: "keep"\nread: ["RULES.md", \'notes file.md\', AGENTS.md] # keep this spacing\nfooter: keep\n');
    const priorObservation = fileObservation(yamlArtifact.path, prior);
    const installedObservation = fileObservation(yamlArtifact.path, installed);

    expect(
      desiredBytesMatch({
        artifact: yamlArtifact,
        candidateBytes: installed,
        observation: priorObservation,
        previous: Option.none<OwnedArtifact>(),
      }),
    ).toBe(true);
    expect(deriveRestorationBytes(yamlArtifact, installedObservation)).toEqual(Option.some(prior));
  });

  it("edits a BOM-prefixed block sequence containing quoted values without reformatting it", () => {
    const bom = new Uint8Array([0xef, 0xbb, 0xbf]);
    const prior = new Uint8Array([
      ...bom,
      ...bytes('read:\r\n  - "RULES.md"\r\n  - \'notes file.md\' # keep this comment\r\nother: "keep"\r\n'),
    ]);
    const installed = new Uint8Array([
      ...bom,
      ...bytes('read:\r\n  - "RULES.md"\r\n  - \'notes file.md\' # keep this comment\r\n  - AGENTS.md\r\nother: "keep"\r\n'),
    ]);
    const priorObservation = fileObservation(yamlArtifact.path, prior);
    const installedObservation = fileObservation(yamlArtifact.path, installed);

    expect(
      desiredBytesMatch({
        artifact: yamlArtifact,
        candidateBytes: installed,
        observation: priorObservation,
        previous: Option.none<OwnedArtifact>(),
      }),
    ).toBe(true);
    expect(deriveRestorationBytes(yamlArtifact, installedObservation)).toEqual(Option.some(prior));
  });

  it("restores a quoted block sequence without manufacturing a final newline", () => {
    const prior = bytes('read:\n  - "RULES.md"');
    const installed = bytes('read:\n  - "RULES.md"\n  - AGENTS.md');
    const priorObservation = fileObservation(yamlArtifact.path, prior);
    const installedObservation = fileObservation(yamlArtifact.path, installed);

    expect(
      desiredBytesMatch({
        artifact: yamlArtifact,
        candidateBytes: installed,
        observation: priorObservation,
        previous: Option.none<OwnedArtifact>(),
      }),
    ).toBe(true);
    expect(deriveRestorationBytes(yamlArtifact, installedObservation)).toEqual(Option.some(prior));
  });

  it("rejects anchors and aliases even when the owned sequence itself is direct", () => {
    const anchored = bytes("defaults: &paths [RULES.md]\nread: []\n");
    const anchoredCandidate = bytes("defaults: &paths [RULES.md]\nread:\n  - AGENTS.md\n");
    const aliased = bytes("defaults: &paths [RULES.md]\nread: *paths\n");

    expect(
      desiredBytesMatch({
        artifact: yamlArtifact,
        candidateBytes: anchoredCandidate,
        observation: fileObservation(yamlArtifact.path, anchored),
        previous: Option.none<OwnedArtifact>(),
      }),
    ).toBe(false);
    expect(
      currentSnapshotMatches({
        artifact: yamlArtifact,
        observation: fileObservation(yamlArtifact.path, aliased),
        target: "prior",
      }),
    ).toBe(false);
  });

  it("requires one top-level key with direct unique scalar-string entries", () => {
    const invalidDocuments = [
      "- AGENTS.md\n",
      'read: [AGENTS.md, "AGENTS.md"]\n',
      "read:\n  - AGENTS.md\n  - { path: RULES.md }\n",
      "read: [AGENTS.md, 1]\n",
      'read: [AGENTS.md]\n"read": [RULES.md]\n',
    ];

    // Each document violates a different structural authority invariant at the same public matching boundary.
    invalidDocuments.forEach((document) => {
      expect(
        currentSnapshotMatches({
          artifact: yamlArtifact,
          observation: fileObservation(yamlArtifact.path, bytes(document)),
          target: "installed",
        }),
      ).toBe(false);
    });
  });

  it("rejects multiline scalars in owned and unrelated document positions", () => {
    const invalidDocuments = [
      "read:\n  - |\n    RULES.md\n",
      "read:\n  - >\n    RULES.md\n",
      'read:\n  - "RULES\n    .md"\n',
      "notes: |\n  keep\nread: []\n",
      "notes: >\n  keep\nread: []\n",
      'notes: "keep\n  going"\nread: []\n',
    ];

    // Every scalar range must stay on one physical line before any source offset can authorize an edit.
    invalidDocuments.forEach((document) => {
      expect(
        currentSnapshotMatches({
          artifact: yamlArtifact,
          observation: fileObservation(yamlArtifact.path, bytes(document)),
          target: "prior",
        }),
      ).toBe(false);
    });
  });

  it("preserves spacing and comments around an empty flow sequence", () => {
    const prior = bytes("header: keep\nread: [ ] # untouched\nfooter: keep\n");
    const installed = bytes("header: keep\nread: [AGENTS.md ] # untouched\nfooter: keep\n");
    const priorObservation = fileObservation(yamlArtifact.path, prior);
    const installedObservation = fileObservation(yamlArtifact.path, installed);

    expect(
      desiredBytesMatch({
        artifact: yamlArtifact,
        candidateBytes: installed,
        observation: priorObservation,
        previous: Option.none<OwnedArtifact>(),
      }),
    ).toBe(true);
    expect(deriveRestorationBytes(yamlArtifact, installedObservation)).toEqual(Option.some(prior));
  });

  it("restores an empty flow sequence without manufacturing a final newline", () => {
    const prior = bytes("read: []");
    const installed = bytes("read:\n  - AGENTS.md");
    const priorObservation = fileObservation(yamlArtifact.path, prior);
    const installedObservation = fileObservation(yamlArtifact.path, installed);

    expect(
      desiredBytesMatch({
        artifact: yamlArtifact,
        candidateBytes: installed,
        observation: priorObservation,
        previous: Option.none<OwnedArtifact>(),
      }),
    ).toBe(true);
    expect(deriveRestorationBytes(yamlArtifact, installedObservation)).toEqual(Option.some(prior));
  });

  it("preserves a UTF-8 BOM through desired and restoration transforms", () => {
    const bom = new Uint8Array([0xef, 0xbb, 0xbf]);
    const prior = new Uint8Array([...bom, ...bytes("read: []\nunrelated: keep\n")]);
    const installed = new Uint8Array([...bom, ...bytes("read:\n  - AGENTS.md\nunrelated: keep\n")]);
    const priorObservation = fileObservation(yamlArtifact.path, prior);
    const installedObservation = fileObservation(yamlArtifact.path, installed);

    expect(
      desiredBytesMatch({
        artifact: yamlArtifact,
        candidateBytes: installed,
        observation: priorObservation,
        previous: Option.none<OwnedArtifact>(),
      }),
    ).toBe(true);
    expect(deriveRestorationBytes(yamlArtifact, installedObservation)).toEqual(Option.some(prior));
    expect(restorationBytesMatch({ artifact: yamlArtifact, observation: installedObservation, candidateBytes: prior })).toBe(true);
  });

  it("keeps a later UTF-8 BOM when the YAML target was originally missing", () => {
    const bom = new Uint8Array([0xef, 0xbb, 0xbf]);
    const createdArtifact = decodeArtifact({
      ...yamlArtifact,
      path: "created-bom.yml",
      ownership: {
        ...yamlArtifact.ownership,
        priorKeyPresence: {
          _tag: "absent",
        },
        priorDocument: {
          _tag: "missing",
        },
      },
    });
    const installed = new Uint8Array([...bom, ...bytes("read:\n  - AGENTS.md\n")]);
    const observation = fileObservation(createdArtifact.path, installed);

    expect(restorationCanRemove(createdArtifact, observation)).toBe(false);
    expect(deriveRestorationBytes(createdArtifact, observation)).toEqual(Option.some(bom));
  });

  it("restores only the owned reference and keeps unrelated YAML bytes", () => {
    const installed = fileObservation(yamlArtifact.path, installedYamlBytes);

    expect(deriveRestorationBytes(yamlArtifact, installed)).toEqual(Option.some(priorYamlBytes));
    expect(restorationBytesMatch({ artifact: yamlArtifact, observation: installed, candidateBytes: priorYamlBytes })).toBe(true);
    expect(restorationBytesMatch({ artifact: yamlArtifact, observation: installed, candidateBytes: bytes("read: []\n") })).toBe(false);
  });
});
