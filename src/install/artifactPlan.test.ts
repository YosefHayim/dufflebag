import path from "node:path";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { artifactPlanSchema, createUninstallPlan, createUpdatePlan, migrateLegacyManifest, validateArtifactPlan } from "./artifactPlan.js";
import {
  type ArtifactReceipt,
  artifactReceiptJsonSchema,
  artifactReceiptSchema,
  type OwnedArtifact,
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

const decodeArtifact = Schema.validateSync(ownedArtifactSchema, {
  onExcessProperty: "error",
});

const decodeReceipt = Schema.validateSync(artifactReceiptSchema, {
  onExcessProperty: "error",
});

const encodeReceiptJson = Schema.encodeSync(artifactReceiptJsonSchema);

const receiptHash = (receipt: ArtifactReceipt): string => {
  return sha256Bytes(bytes(encodeReceiptJson(receipt)));
};

const applicationOwner = {
  _tag: "application",
};

const runtimeV1 = bytes("runtime-v1");
const runtimeV2 = bytes("runtime-v2");
const originalRuntime = bytes("original-runtime");
const configBytes = bytes('{"debugEnabled":false}\n');
const settingsBytes = bytes('{"env":{},"hooks":{"PreToolUse":["node contextGuard.js"]}}\n');
const priorSettingsBytes = bytes('{"env":{"dufflebagDebugEnabled":"false"},"hooks":{}}\n');
const instructionBytes = bytes("user content\n\n<!-- dufflebag:start -->\nmanaged body\n<!-- dufflebag:end -->\n");
const priorInstructionBytes = bytes("user content\n");
const yamlBytes = bytes("read:\n  - AGENTS.md\n");
const priorYamlBytes = bytes("read: []\n");

const runtimeArtifact = decodeArtifact({
  path: ".claude/dufflebag/hooks/contextGuard.js",
  owner: applicationOwner,
  kind: "runtime",
  ownership: wholeFile(runtimeV1, originalRuntime),
});

const configArtifact = decodeArtifact({
  path: ".claude/dufflebag/config.json",
  owner: applicationOwner,
  kind: "managedConfig",
  ownership: wholeFile(configBytes, undefined),
});

const settingsArtifact = decodeArtifact({
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
});

const instructionArtifact = decodeArtifact({
  path: "AGENTS.md",
  owner: {
    _tag: "agent",
    agentIds: ["codex", "aider", "continue"],
  },
  kind: "instruction",
  ownership: {
    _tag: "managedBlock",
    startMarker: "<!-- dufflebag:start -->",
    endMarker: "<!-- dufflebag:end -->",
    installedBodySha256: sha256Bytes(bytes("\nmanaged body\n")),
    leadingDelimiter: bytes("\n"),
    trailingDelimiter: bytes("\n"),
    priorDocument: {
      _tag: "existing",
    },
  },
});

const yamlArtifact = decodeArtifact({
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
    priorKeyPresence: {
      _tag: "present",
    },
    priorDocument: {
      _tag: "existing",
    },
  },
});

const sortedArtifacts = [yamlArtifact, configArtifact, runtimeArtifact, settingsArtifact, instructionArtifact];

const completeReceipt = decodeReceipt({
  version: 1,
  installerVersion: "0.11.0",
  scope: "project",
  features: ["context-guard"],
  artifacts: sortedArtifacts,
});

const receiptPath = ".claude/dufflebag/receipt.json";
const root = "/tmp/dufflebag-contract";
const receiptSha256 = receiptHash(completeReceipt);

const fileObservation = (artifactPath: string, value: Uint8Array) => ({
  path: artifactPath,
  snapshot: {
    _tag: "file",
    bytes: value,
    sha256: sha256Bytes(value),
  },
});

const missingObservation = (artifactPath: string) => ({
  path: artifactPath,
  snapshot: {
    _tag: "missing",
  },
});

const installedObservationFrom = (artifact: OwnedArtifact) => {
  switch (artifact.path) {
    case configArtifact.path:
      return fileObservation(artifact.path, configBytes);
    case runtimeArtifact.path:
      return fileObservation(
        artifact.path,
        artifact.ownership._tag === "wholeFile" && artifact.ownership.installedSha256 === sha256Bytes(runtimeV2) ? runtimeV2 : runtimeV1,
      );
    case settingsArtifact.path:
      return fileObservation(artifact.path, settingsBytes);
    case instructionArtifact.path:
      return fileObservation(artifact.path, instructionBytes);
    case yamlArtifact.path:
      return fileObservation(artifact.path, yamlBytes);
    default:
      throw new Error(`No installed-byte fixture exists for ${artifact.path}.`);
  }
};

const freshObservations = [
  fileObservation(yamlArtifact.path, priorYamlBytes),
  missingObservation(configArtifact.path),
  fileObservation(runtimeArtifact.path, originalRuntime),
  fileObservation(settingsArtifact.path, priorSettingsBytes),
  fileObservation(instructionArtifact.path, priorInstructionBytes),
];

const receiptAuthority = (receipt = completeReceipt, receiptObservations = receipt.artifacts.map(installedObservationFrom)) => ({
  _tag: "receipt",
  receiptPath,
  receiptSha256: receiptHash(receipt),
  receipt,
  observations: receiptObservations,
});

const completePlan = {
  scope: "project",
  root,
  authority: {
    _tag: "fresh",
    observations: freshObservations,
  },
  artifacts: sortedArtifacts,
  operations: [
    {
      _tag: "write",
      path: configArtifact.path,
      bytes: configBytes,
      source: {
        _tag: "desiredArtifact",
      },
    },
    {
      _tag: "write",
      path: settingsArtifact.path,
      bytes: settingsBytes,
      source: {
        _tag: "desiredArtifact",
      },
    },
    {
      _tag: "write",
      path: runtimeArtifact.path,
      bytes: runtimeV1,
      source: {
        _tag: "desiredArtifact",
      },
    },
    {
      _tag: "write",
      path: instructionArtifact.path,
      bytes: instructionBytes,
      source: {
        _tag: "desiredArtifact",
      },
    },
    {
      _tag: "write",
      path: yamlArtifact.path,
      bytes: yamlBytes,
      source: {
        _tag: "desiredArtifact",
      },
    },
  ],
  receipt: {
    _tag: "publishReceipt",
    path: receiptPath,
    value: completeReceipt,
  },
};

const observationFrom = installedObservationFrom;

const observations = sortedArtifacts.map(observationFrom);

describe("artifactPlanSchema", () => {
  it("decodes a complete plan and preserves config-before-settings semantic order", () => {
    const decoded = validateArtifactPlan(completePlan);

    expect(decoded.operations.map((operation) => operation.path)).toEqual([
      configArtifact.path,
      settingsArtifact.path,
      runtimeArtifact.path,
      instructionArtifact.path,
      yamlArtifact.path,
    ]);
    expect(decoded.receipt._tag).toBe("publishReceipt");
  });

  it("rejects excess properties and a scope mismatch", () => {
    expect(() => {
      validateArtifactPlan({
        ...completePlan,
        extra: true,
      });
    }).toThrow();
    expect(() => {
      validateArtifactPlan({
        ...completePlan,
        scope: "global",
      });
    }).toThrow();
  });

  it.each([
    "relative/root",
    "/tmp/dufflebag-contract/",
    "/tmp/dufflebag-contract/../other",
  ])("rejects non-absolute or non-normalized root %j", (invalidRoot) => {
    expect(() => {
      validateArtifactPlan({
        ...completePlan,
        root: invalidRoot,
      });
    }).toThrow();
  });

  it("accepts a native-normalized absolute root when it contains backslashes", () => {
    const nativeRoot = path.join(path.parse(process.cwd()).root, "tmp", "dufflebag\\contract");

    expect(
      validateArtifactPlan({
        ...completePlan,
        root: nativeRoot,
      }).root,
    ).toBe(nativeRoot);
  });

  it("rejects duplicate physical targets and parent-child target conflicts", () => {
    expect(() => {
      validateArtifactPlan({
        ...completePlan,
        operations: [...completePlan.operations, completePlan.operations[0]],
      });
    }).toThrow();
    expect(() => {
      validateArtifactPlan({
        ...completePlan,
        artifacts: [
          decodeArtifact({
            ...runtimeArtifact,
            path: "owned",
          }),
          decodeArtifact({
            ...configArtifact,
            path: "owned/child.json",
          }),
        ],
        operations: [],
        receipt: {
          ...completePlan.receipt,
          value: {
            ...completeReceipt,
            artifacts: [
              decodeArtifact({
                ...runtimeArtifact,
                path: "owned",
              }),
              decodeArtifact({
                ...configArtifact,
                path: "owned/child.json",
              }),
            ],
          },
        },
      });
    }).toThrow();

    const interposedPaths = ["owned", "owned-sibling", "owned/child.json"];
    const interposedArtifacts = interposedPaths.map((artifactPath) => {
      return decodeArtifact({
        ...configArtifact,
        path: artifactPath,
      });
    });

    expect(() => {
      validateArtifactPlan({
        ...completePlan,
        artifacts: [],
        operations: interposedArtifacts.map((artifact) => ({
          _tag: "remove",
          path: artifact.path,
          authority: {
            _tag: "receiptOwned",
            artifact,
          },
        })),
        receipt: {
          _tag: "removeReceipt",
          path: receiptPath,
          expectedSha256: sha256Bytes(bytes("receipt")),
        },
      });
    }).toThrow();
  });

  it("reserves the receipt path from artifacts and ordinary operations", () => {
    expect(() => {
      validateArtifactPlan({
        ...completePlan,
        operations: [
          {
            _tag: "write",
            path: receiptPath,
            bytes: bytes("not-a-receipt"),
            source: {
              _tag: "desiredArtifact",
            },
          },
        ],
      });
    }).toThrow();
    expect(() => {
      validateArtifactPlan({
        ...completePlan,
        artifacts: [
          decodeArtifact({
            ...runtimeArtifact,
            path: receiptPath,
          }),
        ],
        operations: [],
        receipt: {
          ...completePlan.receipt,
          value: {
            ...completeReceipt,
            artifacts: [
              decodeArtifact({
                ...runtimeArtifact,
                path: receiptPath,
              }),
            ],
          },
        },
      });
    }).toThrow();
  });

  it("requires receipt artifacts to exactly match desired artifacts", () => {
    expect(() => {
      validateArtifactPlan({
        ...completePlan,
        artifacts: [configArtifact],
      });
    }).toThrow();
  });

  it("rejects fresh receipt ownership without a matching desired write", () => {
    expect(() => {
      validateArtifactPlan({
        ...completePlan,
        artifacts: [configArtifact],
        operations: [],
        receipt: {
          ...completePlan.receipt,
          value: decodeReceipt({
            ...completeReceipt,
            artifacts: [configArtifact],
          }),
        },
      });
    }).toThrow();
  });

  it("rejects changed installed metadata without matching whole-file, managed-block, JSON, or YAML writes", () => {
    const changedArtifacts = [
      decodeArtifact({
        ...runtimeArtifact,
        ownership: {
          ...runtimeArtifact.ownership,
          installedSha256: sha256Bytes(runtimeV2),
        },
      }),
      decodeArtifact({
        ...instructionArtifact,
        ownership: {
          ...instructionArtifact.ownership,
          installedBodySha256: sha256Bytes(bytes("\nchanged body\n")),
        },
      }),
      decodeArtifact({
        ...settingsArtifact,
        ownership: {
          ...settingsArtifact.ownership,
          entries:
            settingsArtifact.ownership._tag === "jsonValues"
              ? settingsArtifact.ownership.entries.map((entry) => {
                  return entry.pointer === "/hooks/PreToolUse"
                    ? {
                        ...entry,
                        installed: {
                          _tag: "value",
                          value: ["node changed.js"],
                          sha256: sha256JsonValue(["node changed.js"]),
                        },
                      }
                    : entry;
                })
              : [],
        },
      }),
      decodeArtifact({
        ...yamlArtifact,
        ownership: {
          ...yamlArtifact.ownership,
          reference: "OTHER.md",
        },
      }),
    ];

    changedArtifacts.forEach((artifact) => {
      expect(() => {
        validateArtifactPlan({
          ...completePlan,
          artifacts: [artifact],
          operations: [],
          receipt: {
            ...completePlan.receipt,
            value: decodeReceipt({
              ...completeReceipt,
              artifacts: [artifact],
            }),
          },
        });
      }).toThrow();
    });
  });

  it.each([
    {
      label: "whole-file prior bytes",
      previous: runtimeArtifact,
      desired: decodeArtifact({
        ...runtimeArtifact,
        ownership: {
          ...runtimeArtifact.ownership,
          prior: {
            _tag: "missing",
          },
        },
      }),
      desiredBytes: runtimeV1,
    },
    {
      label: "managed-block delimiters",
      previous: instructionArtifact,
      desired: decodeArtifact({
        ...instructionArtifact,
        ownership: {
          ...instructionArtifact.ownership,
          leadingDelimiter: bytes(""),
          trailingDelimiter: bytes(""),
        },
      }),
      desiredBytes: instructionBytes,
    },
    {
      label: "managed-block document existence",
      previous: instructionArtifact,
      desired: decodeArtifact({
        ...instructionArtifact,
        ownership: {
          ...instructionArtifact.ownership,
          priorDocument: {
            _tag: "missing",
          },
        },
      }),
      desiredBytes: instructionBytes,
    },
    {
      label: "JSON prior values and document existence",
      previous: settingsArtifact,
      desired: decodeArtifact({
        ...settingsArtifact,
        ownership: {
          ...settingsArtifact.ownership,
          entries:
            settingsArtifact.ownership._tag === "jsonValues"
              ? settingsArtifact.ownership.entries.map((entry) => ({
                  ...entry,
                  prior: {
                    _tag: "missing",
                  },
                }))
              : [],
          priorDocument: {
            _tag: "missing",
          },
        },
      }),
      desiredBytes: settingsBytes,
    },
    {
      label: "YAML prior presence",
      previous: yamlArtifact,
      desired: decodeArtifact({
        ...yamlArtifact,
        ownership: {
          ...yamlArtifact.ownership,
          priorPresence: {
            _tag: "present",
          },
        },
      }),
      desiredBytes: yamlBytes,
    },
    {
      label: "YAML document existence",
      previous: yamlArtifact,
      desired: decodeArtifact({
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
      }),
      desiredBytes: yamlBytes,
    },
    {
      label: "YAML key presence",
      previous: yamlArtifact,
      desired: decodeArtifact({
        ...yamlArtifact,
        ownership: {
          ...yamlArtifact.ownership,
          priorKeyPresence: {
            _tag: "absent",
          },
        },
      }),
      desiredBytes: yamlBytes,
    },
  ])("rejects forged same-path restoration metadata: $label", ({ previous, desired, desiredBytes }) => {
    const previousReceipt = decodeReceipt({
      ...completeReceipt,
      artifacts: [previous],
    });
    const desiredReceipt = decodeReceipt({
      ...completeReceipt,
      installerVersion: "0.12.0",
      artifacts: [desired],
    });

    expect(() => {
      validateArtifactPlan({
        ...completePlan,
        authority: receiptAuthority(previousReceipt, [observationFrom(previous)]),
        artifacts: [desired],
        operations: [
          {
            _tag: "write",
            path: desired.path,
            bytes: desiredBytes,
            source: {
              _tag: "desiredArtifact",
            },
          },
        ],
        receipt: {
          ...completePlan.receipt,
          value: desiredReceipt,
        },
      });
    }).toThrow();
  });

  it("rejects a newly owned JSON pointer whose prior state disagrees with the current document", () => {
    const currentBytes = bytes('{"new":"user-value","owned":"v1"}');
    const previous = decodeArtifact({
      ...settingsArtifact,
      path: "new-pointer.json",
      ownership: {
        _tag: "jsonValues",
        entries: [
          {
            pointer: "/owned",
            installed: {
              _tag: "value",
              value: "v1",
              sha256: sha256JsonValue("v1"),
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
    const desired = decodeArtifact({
      ...previous,
      ownership: {
        ...previous.ownership,
        entries: [
          {
            pointer: "/new",
            installed: {
              _tag: "value",
              value: "owned-value",
              sha256: sha256JsonValue("owned-value"),
            },
            prior: {
              _tag: "missing",
            },
          },
          ...(previous.ownership._tag === "jsonValues" ? previous.ownership.entries : []),
        ],
      },
    });
    const previousReceipt = decodeReceipt({
      ...completeReceipt,
      artifacts: [previous],
    });
    const desiredReceipt = decodeReceipt({
      ...completeReceipt,
      installerVersion: "0.12.0",
      artifacts: [desired],
    });

    expect(() => {
      validateArtifactPlan({
        ...completePlan,
        authority: receiptAuthority(previousReceipt, [fileObservation(previous.path, currentBytes)]),
        artifacts: [desired],
        operations: [
          {
            _tag: "write",
            path: desired.path,
            bytes: bytes('{"new":"owned-value","owned":"v1"}'),
            source: {
              _tag: "desiredArtifact",
            },
          },
        ],
        receipt: {
          ...completePlan.receipt,
          value: desiredReceipt,
        },
      });
    }).toThrow();
  });

  it("rejects a desired write without matching desired receipt ownership", () => {
    expect(() => {
      validateArtifactPlan({
        ...completePlan,
        operations: [
          {
            _tag: "write",
            path: "unowned.txt",
            bytes: bytes("unowned"),
            source: {
              _tag: "desiredArtifact",
            },
          },
        ],
      });
    }).toThrow();
  });

  it("rejects remove operations without receipt or fixed legacy authority", () => {
    expect(() => {
      validateArtifactPlan({
        ...completePlan,
        operations: [
          {
            _tag: "remove",
            path: "detected-only.txt",
            authority: {
              _tag: "detected",
            },
          },
        ],
      });
    }).toThrow();
  });

  it("rejects a raw plan with caller-fabricated receipt deletion authority", () => {
    const victimBytes = bytes("unowned user file");
    const victimArtifact = decodeArtifact({
      ...configArtifact,
      path: "user-owned.txt",
      ownership: wholeFile(victimBytes, undefined),
    });
    const fabricatedReceipt = decodeReceipt({
      ...completeReceipt,
      artifacts: [victimArtifact],
    });
    const unrelatedReceiptHash = sha256Bytes(bytes("different receipt bytes"));

    expect(() => {
      validateArtifactPlan({
        ...completePlan,
        authority: {
          _tag: "receipt",
          receiptPath,
          receiptSha256: unrelatedReceiptHash,
          receipt: fabricatedReceipt,
          observations: [fileObservation(victimArtifact.path, victimBytes)],
        },
        artifacts: [],
        operations: [
          {
            _tag: "remove",
            path: victimArtifact.path,
            authority: {
              _tag: "receiptOwned",
            },
          },
        ],
        receipt: {
          _tag: "removeReceipt",
          path: receiptPath,
          expectedSha256: unrelatedReceiptHash,
        },
      });
    }).toThrow();
  });

  it("rejects receipt authority that silently drops stale owned targets", () => {
    const successorReceipt = decodeReceipt({
      ...completeReceipt,
      artifacts: [configArtifact],
    });

    expect(() => {
      validateArtifactPlan({
        ...completePlan,
        authority: receiptAuthority(),
        artifacts: [configArtifact],
        operations: [completePlan.operations[0]],
        receipt: {
          ...completePlan.receipt,
          value: successorReceipt,
        },
      });
    }).toThrow();
  });

  it("decodes through the exported schema as well as the validation boundary", () => {
    expect(
      Schema.validateSync(artifactPlanSchema, {
        onExcessProperty: "error",
      })(completePlan),
    ).toEqual(validateArtifactPlan(completePlan));
  });
});

describe("createUpdatePlan", () => {
  it("carries original whole-file restoration state through a v2 update", () => {
    const desiredArtifact = decodeArtifact({
      ...runtimeArtifact,
      ownership: wholeFile(runtimeV2, runtimeV1),
    });
    const desiredReceipt = decodeReceipt({
      ...completeReceipt,
      installerVersion: "0.12.0",
      artifacts: [desiredArtifact],
    });
    const previousReceipt = decodeReceipt({
      ...completeReceipt,
      artifacts: [runtimeArtifact],
    });
    const desiredPlan = {
      ...completePlan,
      authority: receiptAuthority(previousReceipt, [observationFrom(runtimeArtifact)]),
      artifacts: [desiredArtifact],
      operations: [
        {
          _tag: "write",
          path: desiredArtifact.path,
          bytes: runtimeV2,
          source: {
            _tag: "desiredArtifact",
          },
        },
      ],
      receipt: {
        ...completePlan.receipt,
        value: desiredReceipt,
      },
    };
    const update = createUpdatePlan({
      previousReceiptPath: receiptPath,
      previousReceiptSha256: receiptHash(previousReceipt),
      previousReceipt,
      desiredPlan,
      observations: [observationFrom(runtimeArtifact)],
      mode: {
        _tag: "replace",
        staleRestorations: [],
      },
    });

    expect(update.receipt._tag).toBe("publishReceipt");
    if (update.receipt._tag !== "publishReceipt") {
      throw new Error("An update must publish a receipt.");
    }

    const updatedArtifact = update.receipt.value.artifacts[0];
    expect(updatedArtifact?.ownership._tag).toBe("wholeFile");
    if (updatedArtifact?.ownership._tag !== "wholeFile") {
      throw new Error("The updated runtime must retain whole-file ownership.");
    }

    expect(updatedArtifact.ownership.installedSha256).toBe(sha256Bytes(runtimeV2));
    expect(updatedArtifact.ownership.prior).toEqual(runtimeArtifact.ownership.prior);
  });

  it("carries managed-block, JSON, and YAML restoration metadata through updates", () => {
    const updatedInstructionBytes = bytes("user content\n\n<!-- dufflebag:start -->\nnew body\n<!-- dufflebag:end -->\n");
    const desiredInstruction = decodeArtifact({
      ...instructionArtifact,
      ownership: {
        ...instructionArtifact.ownership,
        installedBodySha256: sha256Bytes(bytes("\nnew body\n")),
        leadingDelimiter: instructionArtifact.ownership.leadingDelimiter,
        trailingDelimiter: instructionArtifact.ownership.trailingDelimiter,
        priorDocument: {
          _tag: "missing",
        },
      },
    });
    const desiredSettings = decodeArtifact({
      ...settingsArtifact,
      ownership: {
        ...settingsArtifact.ownership,
        entries:
          settingsArtifact.ownership._tag === "jsonValues"
            ? settingsArtifact.ownership.entries.map((entry) => ({
                ...entry,
                prior: {
                  _tag: "missing",
                },
              }))
            : [],
        priorDocument: {
          _tag: "missing",
        },
      },
    });
    const desiredYaml = decodeArtifact({
      ...yamlArtifact,
      ownership: {
        ...yamlArtifact.ownership,
        priorPresence: {
          _tag: "absent",
        },
        priorKeyPresence: {
          _tag: "absent",
        },
        priorDocument: {
          _tag: "missing",
        },
      },
    });
    const previousReceipt = decodeReceipt({
      ...completeReceipt,
      artifacts: [yamlArtifact, settingsArtifact, instructionArtifact],
    });
    const desiredReceipt = decodeReceipt({
      ...completeReceipt,
      installerVersion: "0.12.0",
      artifacts: [desiredYaml, desiredSettings, desiredInstruction],
    });
    const desiredPlan = {
      ...completePlan,
      authority: receiptAuthority(previousReceipt),
      artifacts: desiredReceipt.artifacts,
      operations: [
        completePlan.operations[1],
        {
          _tag: "write",
          path: desiredInstruction.path,
          bytes: updatedInstructionBytes,
          source: {
            _tag: "desiredArtifact",
          },
        },
        completePlan.operations[4],
      ],
      receipt: {
        ...completePlan.receipt,
        value: desiredReceipt,
      },
    };
    const update = createUpdatePlan({
      previousReceiptPath: receiptPath,
      previousReceiptSha256: receiptHash(previousReceipt),
      previousReceipt,
      desiredPlan,
      observations: previousReceipt.artifacts.map(observationFrom),
      mode: {
        _tag: "replace",
        staleRestorations: [],
      },
    });

    expect(update.receipt._tag).toBe("publishReceipt");
    if (update.receipt._tag !== "publishReceipt") {
      throw new Error("An update must publish a receipt.");
    }

    const updatedInstruction = update.receipt.value.artifacts.find((artifact) => artifact.path === instructionArtifact.path);
    const updatedSettings = update.receipt.value.artifacts.find((artifact) => artifact.path === settingsArtifact.path);
    const updatedYaml = update.receipt.value.artifacts.find((artifact) => artifact.path === yamlArtifact.path);

    expect(updatedInstruction?.ownership._tag).toBe("managedBlock");
    if (updatedInstruction?.ownership._tag === "managedBlock" && instructionArtifact.ownership._tag === "managedBlock") {
      expect(updatedInstruction.ownership.leadingDelimiter).toEqual(instructionArtifact.ownership.leadingDelimiter);
      expect(updatedInstruction.ownership.trailingDelimiter).toEqual(instructionArtifact.ownership.trailingDelimiter);
      expect(updatedInstruction.ownership.priorDocument).toEqual(instructionArtifact.ownership.priorDocument);
    }

    expect(updatedSettings?.ownership._tag).toBe("jsonValues");
    if (updatedSettings?.ownership._tag === "jsonValues" && settingsArtifact.ownership._tag === "jsonValues") {
      expect(updatedSettings.ownership.entries.map((entry) => entry.prior)).toEqual(
        settingsArtifact.ownership.entries.map((entry) => entry.prior),
      );
      expect(updatedSettings.ownership.priorDocument).toEqual(settingsArtifact.ownership.priorDocument);
    }

    expect(updatedYaml?.ownership._tag).toBe("yamlSequenceValue");
    if (updatedYaml?.ownership._tag === "yamlSequenceValue" && yamlArtifact.ownership._tag === "yamlSequenceValue") {
      expect(updatedYaml.ownership.priorPresence).toEqual(yamlArtifact.ownership.priorPresence);
      expect(updatedYaml.ownership.priorKeyPresence).toEqual(yamlArtifact.ownership.priorKeyPresence);
      expect(updatedYaml.ownership.priorDocument).toEqual(yamlArtifact.ownership.priorDocument);
    }
  });

  it("carries the full prior receipt and feature set for a config-only patch", () => {
    const patchReceipt = decodeReceipt({
      ...completeReceipt,
      installerVersion: "0.12.0",
      features: [],
      artifacts: [configArtifact],
    });
    const patchPlan = {
      ...completePlan,
      authority: receiptAuthority(),
      artifacts: [configArtifact],
      operations: [completePlan.operations[0]],
      receipt: {
        ...completePlan.receipt,
        value: patchReceipt,
      },
    };

    const update = createUpdatePlan({
      previousReceiptPath: receiptPath,
      previousReceiptSha256: receiptSha256,
      previousReceipt: completeReceipt,
      desiredPlan: patchPlan,
      observations,
      mode: {
        _tag: "patch",
      },
    });

    expect(update.receipt._tag).toBe("publishReceipt");
    if (update.receipt._tag !== "publishReceipt") {
      throw new Error("An update must publish a receipt.");
    }

    expect(update.receipt.value.features).toEqual(completeReceipt.features);
    expect(update.receipt.value.artifacts.map((artifact) => artifact.path)).toEqual(
      completeReceipt.artifacts.map((artifact) => artifact.path),
    );
    expect(update.operations.map((operation) => operation.path)).toEqual([configArtifact.path]);
  });

  it("uses explicit stale order for replace updates without sorting physical operations", () => {
    const desiredReceipt = decodeReceipt({
      ...completeReceipt,
      artifacts: [configArtifact],
    });
    const desiredPlan = {
      ...completePlan,
      authority: receiptAuthority(),
      artifacts: [configArtifact],
      operations: [completePlan.operations[0]],
      receipt: {
        ...completePlan.receipt,
        value: desiredReceipt,
      },
    };
    const staleRestorations = [
      {
        _tag: "write",
        path: instructionArtifact.path,
        bytes: bytes("user content\n"),
      },
      {
        _tag: "write",
        path: settingsArtifact.path,
        bytes: priorSettingsBytes,
      },
      {
        _tag: "write",
        path: runtimeArtifact.path,
        bytes: originalRuntime,
      },
      {
        _tag: "write",
        path: yamlArtifact.path,
        bytes: bytes("read: []\n"),
      },
    ];

    const update = createUpdatePlan({
      previousReceiptPath: receiptPath,
      previousReceiptSha256: receiptSha256,
      previousReceipt: completeReceipt,
      desiredPlan,
      observations,
      mode: {
        _tag: "replace",
        staleRestorations,
      },
    });

    expect(update.operations.map((operation) => operation.path)).toEqual([
      configArtifact.path,
      ...staleRestorations.map((restoration) => restoration.path),
    ]);
    expect(update.operations.slice(1).every((operation) => operation._tag === "write")).toBe(true);
  });

  it("rejects stale paths that do not exactly name the previous-minus-desired set", () => {
    const desiredReceipt = decodeReceipt({
      ...completeReceipt,
      artifacts: [configArtifact],
    });
    const desiredPlan = {
      ...completePlan,
      authority: receiptAuthority(),
      artifacts: [configArtifact],
      operations: [completePlan.operations[0]],
      receipt: {
        ...completePlan.receipt,
        value: desiredReceipt,
      },
    };

    expect(() => {
      createUpdatePlan({
        previousReceiptPath: receiptPath,
        previousReceiptSha256: receiptSha256,
        previousReceipt: completeReceipt,
        desiredPlan,
        observations,
        mode: {
          _tag: "replace",
          staleRestorations: [
            {
              _tag: "remove",
              path: "detected-but-unreceipted.txt",
            },
          ],
        },
      });
    }).toThrow();
  });

  it("rejects dropping a receipt-owned JSON pointer at a retained path without restoring its prior value", () => {
    if (settingsArtifact.ownership._tag !== "jsonValues") {
      throw new Error("The settings fixture must use JSON-value ownership.");
    }

    const retainedEntry = settingsArtifact.ownership.entries.find((entry) => entry.pointer === "/hooks/PreToolUse");
    if (retainedEntry === undefined) {
      throw new Error("The settings fixture must contain the retained hook pointer.");
    }

    const desiredSettings = decodeArtifact({
      ...settingsArtifact,
      ownership: {
        ...settingsArtifact.ownership,
        entries: [retainedEntry],
      },
    });
    const desiredReceipt = decodeReceipt({
      ...completeReceipt,
      artifacts: [desiredSettings],
    });
    const previousReceipt = decodeReceipt({
      ...completeReceipt,
      artifacts: [settingsArtifact],
    });
    const desiredBytesWithoutPriorRestoration = settingsBytes;
    expect(() => {
      validateArtifactPlan({
        ...completePlan,
        authority: receiptAuthority(previousReceipt, [observationFrom(settingsArtifact)]),
        artifacts: [desiredSettings],
        operations: [
          {
            _tag: "write",
            path: desiredSettings.path,
            bytes: desiredBytesWithoutPriorRestoration,
            source: {
              _tag: "desiredArtifact",
            },
          },
        ],
        receipt: {
          ...completePlan.receipt,
          value: desiredReceipt,
        },
      });
    }).toThrow();
  });

  it("rejects changed owned evidence for every metadata state", () => {
    const changedObservations = observations.map((observation) => {
      if (observation.path !== runtimeArtifact.path) {
        return observation;
      }

      return {
        ...fileObservation(runtimeArtifact.path, bytes("user-edited-runtime")),
      };
    });

    const desiredPlan = validateArtifactPlan({
      ...completePlan,
      authority: receiptAuthority(),
    });

    expect(() => {
      createUpdatePlan({
        previousReceiptPath: receiptPath,
        previousReceiptSha256: receiptSha256,
        previousReceipt: completeReceipt,
        desiredPlan,
        observations: changedObservations,
        mode: {
          _tag: "replace",
          staleRestorations: [],
        },
      });
    }).toThrow("Owned artifact changed");
  });

  it("rejects missing, duplicate, or extraneous observations", () => {
    const desiredPlan = validateArtifactPlan({
      ...completePlan,
      authority: receiptAuthority(),
    });

    [observations.slice(1), [...observations, observations[0]], [...observations, missingObservation("detected.txt")]].forEach(
      (invalidObservations) => {
        expect(() => {
          createUpdatePlan({
            previousReceiptPath: receiptPath,
            previousReceiptSha256: receiptSha256,
            previousReceipt: completeReceipt,
            desiredPlan,
            observations: invalidObservations,
            mode: {
              _tag: "replace",
              staleRestorations: [],
            },
          });
        }).toThrow();
      },
    );
  });

  it("keeps repeated identical updates byte-stable", () => {
    const desiredPlan = validateArtifactPlan({
      ...completePlan,
      authority: receiptAuthority(),
    });
    const first = createUpdatePlan({
      previousReceiptPath: receiptPath,
      previousReceiptSha256: receiptSha256,
      previousReceipt: completeReceipt,
      desiredPlan,
      observations,
      mode: {
        _tag: "replace",
        staleRestorations: [],
      },
    });
    const second = createUpdatePlan({
      previousReceiptPath: receiptPath,
      previousReceiptSha256: receiptSha256,
      previousReceipt: completeReceipt,
      desiredPlan,
      observations,
      mode: {
        _tag: "replace",
        staleRestorations: [],
      },
    });

    expect(second).toEqual(first);
  });
});

describe("createUninstallPlan", () => {
  it("derives authority only from the receipt and preserves caller-declared inverse order", () => {
    const restorations = [
      {
        _tag: "write",
        path: instructionArtifact.path,
        bytes: bytes("user content\n"),
      },
      {
        _tag: "write",
        path: settingsArtifact.path,
        bytes: priorSettingsBytes,
      },
      {
        _tag: "write",
        path: runtimeArtifact.path,
        bytes: originalRuntime,
      },
      {
        _tag: "remove",
        path: configArtifact.path,
      },
      {
        _tag: "write",
        path: yamlArtifact.path,
        bytes: bytes("read: []\n"),
      },
    ];

    const uninstall = createUninstallPlan({
      scope: "project",
      root,
      receiptPath,
      receiptSha256,
      receipt: completeReceipt,
      observations,
      restorations,
    });

    expect(uninstall.operations.map((operation) => operation.path)).toEqual(restorations.map((operation) => operation.path));
    expect(uninstall.artifacts).toEqual([]);
    expect(uninstall.receipt).toEqual({
      _tag: "removeReceipt",
      path: receiptPath,
      expectedSha256: receiptSha256,
    });
  });

  it("rejects restoration paths not owned by the receipt and detection-shaped excess input", () => {
    expect(() => {
      createUninstallPlan({
        scope: "project",
        root,
        receiptPath,
        receiptSha256,
        receipt: completeReceipt,
        observations,
        restorations: [
          {
            _tag: "remove",
            path: "detected-only.txt",
          },
        ],
      });
    }).toThrow();
    expect(() => {
      createUninstallPlan({
        scope: "project",
        root,
        receiptPath,
        receiptSha256,
        receipt: completeReceipt,
        observations,
        restorations: [],
        detectedPaths: ["detected-only.txt"],
      });
    }).toThrow();
  });

  it("requires one safe inverse per receipt artifact and exact prior whole-file bytes", () => {
    const runtimeReceipt = decodeReceipt({
      ...completeReceipt,
      artifacts: [runtimeArtifact],
    });

    expect(() => {
      createUninstallPlan({
        scope: "project",
        root,
        receiptPath,
        receiptSha256: receiptHash(runtimeReceipt),
        receipt: runtimeReceipt,
        observations: [observationFrom(runtimeArtifact)],
        restorations: [],
      });
    }).toThrow();
    expect(() => {
      createUninstallPlan({
        scope: "project",
        root,
        receiptPath,
        receiptSha256: receiptHash(runtimeReceipt),
        receipt: runtimeReceipt,
        observations: [observationFrom(runtimeArtifact)],
        restorations: [
          {
            _tag: "write",
            path: runtimeArtifact.path,
            bytes: bytes("not-original"),
          },
        ],
      });
    }).toThrow();
  });

  it("rejects JSON ownership that traverses array indexes before sibling removals can shift unrelated values", () => {
    const installedArrayBytes = bytes('{"items":["owned-0","owned-1","unrelated"]}');
    const arrayArtifact = decodeArtifact({
      ...settingsArtifact,
      path: "array-settings.json",
      ownership: {
        _tag: "jsonValues",
        entries: [
          {
            pointer: "/items/0",
            installed: {
              _tag: "value",
              value: "owned-0",
              sha256: sha256JsonValue("owned-0"),
            },
            prior: {
              _tag: "missing",
            },
          },
          {
            pointer: "/items/1",
            installed: {
              _tag: "value",
              value: "owned-1",
              sha256: sha256JsonValue("owned-1"),
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
    const arrayReceipt = decodeReceipt({
      ...completeReceipt,
      artifacts: [arrayArtifact],
    });

    expect(() => {
      createUninstallPlan({
        scope: "project",
        root,
        receiptPath,
        receiptSha256: receiptHash(arrayReceipt),
        receipt: arrayReceipt,
        observations: [fileObservation(arrayArtifact.path, installedArrayBytes)],
        restorations: [
          {
            _tag: "write",
            path: arrayArtifact.path,
            bytes: bytes('{"items":["owned-1"]}'),
          },
        ],
      });
    }).toThrow();
  });

  it("rejects changed owned state before planning restoration", () => {
    const runtimeReceipt = decodeReceipt({
      ...completeReceipt,
      artifacts: [runtimeArtifact],
    });

    expect(() => {
      createUninstallPlan({
        scope: "project",
        root,
        receiptPath,
        receiptSha256: receiptHash(runtimeReceipt),
        receipt: runtimeReceipt,
        observations: [fileObservation(runtimeArtifact.path, bytes("changed"))],
        restorations: [
          {
            _tag: "write",
            path: runtimeArtifact.path,
            bytes: originalRuntime,
          },
        ],
      });
    }).toThrow("Owned artifact changed");
  });

  it("treats a previously existing JSON document disappearing as an ownership conflict", () => {
    expect(() => {
      createUninstallPlan({
        scope: "project",
        root,
        receiptPath,
        receiptSha256,
        receipt: decodeReceipt({
          ...completeReceipt,
          artifacts: [settingsArtifact],
        }),
        observations: [missingObservation(settingsArtifact.path)],
        restorations: [
          {
            _tag: "write",
            path: settingsArtifact.path,
            bytes: priorSettingsBytes,
          },
        ],
      });
    }).toThrow("Owned artifact changed");
  });
});

describe("migrateLegacyManifest", () => {
  const legacyManifest = {
    version: "0.10.0",
    scope: "project",
    features: ["context-guard"],
    skills: ["context-guard"],
    installedAt: "2026-07-14T00:00:00.000Z",
  };
  const legacyManifestBytes = bytes(JSON.stringify(legacyManifest, undefined, 2));
  const legacyManifestSha256 = sha256Bytes(legacyManifestBytes);

  it("reuses only strict legacy feature selection and removes only the fixed manifest path", () => {
    const migrated = migrateLegacyManifest({
      legacyManifest,
      legacyManifestBytes,
      legacyManifestSha256,
      desiredPlan: completePlan,
    });

    expect(migrated.operations.slice(0, -1)).toEqual(validateArtifactPlan(completePlan).operations);
    expect(migrated.operations.at(-1)).toEqual({
      _tag: "remove",
      path: ".claude/dufflebag/manifest.json",
      authority: {
        _tag: "legacyManifest",
      },
    });
    expect(migrated.receipt).toEqual(validateArtifactPlan(completePlan).receipt);
  });

  it("allows resolved desired dependency additions without subtracting a legacy-selected feature", () => {
    const desiredReceipt = decodeReceipt({
      ...completeReceipt,
      features: ["context-guard", "required-dependency"],
    });
    const desiredPlan = validateArtifactPlan({
      ...completePlan,
      receipt: {
        ...completePlan.receipt,
        value: desiredReceipt,
      },
    });

    expect(() => {
      migrateLegacyManifest({
        legacyManifest,
        legacyManifestBytes,
        legacyManifestSha256,
        desiredPlan,
      });
    }).not.toThrow();
  });

  it("rejects unknown legacy fields, mismatched selection, and attempts to choose a deletion path", () => {
    expect(() => {
      migrateLegacyManifest({
        legacyManifest: {
          ...legacyManifest,
          detectedPaths: ["delete-me"],
        },
        legacyManifestBytes,
        legacyManifestSha256,
        desiredPlan: completePlan,
      });
    }).toThrow();
    expect(() => {
      migrateLegacyManifest({
        legacyManifest: {
          ...legacyManifest,
          features: ["different-feature"],
        },
        legacyManifestBytes,
        legacyManifestSha256,
        desiredPlan: completePlan,
      });
    }).toThrow();
    expect(() => {
      migrateLegacyManifest({
        legacyManifest,
        legacyManifestBytes,
        legacyManifestSha256,
        desiredPlan: completePlan,
        legacyManifestPath: "delete-me",
      });
    }).toThrow();
  });

  it("rejects legacy bytes and hashes that decode to a different manifest", () => {
    const differentBytes = bytes(
      JSON.stringify(
        {
          ...legacyManifest,
          skills: ["different-skill"],
        },
        undefined,
        2,
      ),
    );

    expect(() => {
      migrateLegacyManifest({
        legacyManifest,
        legacyManifestBytes: differentBytes,
        legacyManifestSha256: sha256Bytes(differentBytes),
        desiredPlan: completePlan,
      });
    }).toThrow();
  });
});
