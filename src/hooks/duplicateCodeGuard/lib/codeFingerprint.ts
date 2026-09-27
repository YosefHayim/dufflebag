// Parses TypeScript once and reduces each declaration to a comparable key: a rename-proof fingerprint per named
// function body and an order-independent signature per object-type shape. Installed hooks cannot bundle
// `typescript`, so this loads the guarded repo's own copy; the type-only import below is erased at build.

import { createRequire } from "node:module";
import path from "node:path";

import type * as TS from "typescript";

export type TypeEntry = {
  name: string;
  signature: string;
  line: number;
  ignored: boolean;
};

export type FunctionEntry = {
  name: string;
  fingerprint: string;
  line: number;
  ignored: boolean;
};

export type ExtractedDeclarations = {
  types: Array<TypeEntry>;
  functions: Array<FunctionEntry>;
};

// Written on a declaration's first line to keep a deliberate copy.
const ALLOW_MARKER = "allow-duplicate";

// e.g. "a \n\t b" → "a b"
const normalizeWhitespace = (text: string): string => text.replace(/\s+/g, " ").trim();

// Null when the repo has no `typescript`, so callers fail open.
export const loadTypeScript = (repoRoot: string): typeof TS | null => {
  try {
    const require = createRequire(path.join(repoRoot, "noop.js"));
    const resolved = require.resolve("typescript", { paths: [repoRoot] });
    // External type correction: the CommonJS module has the shape declared by TypeScript's official package.
    return require(resolved) as typeof TS;
  } catch {
    return null;
  }
};

const canonicalMembers = (request: {
  ts: typeof TS;
  members: ReadonlyArray<TS.TypeElement>;
  sourceFile: TS.SourceFile;
}): string => {
  const parts = request.members.map((member) => {
    if (!request.ts.isPropertySignature(member) || !member.name) {
      return normalizeWhitespace(member.getText(request.sourceFile));
    }
    const modifiers = member.modifiers === undefined ? [] : member.modifiers;
    const readonly = modifiers.some((modifier) => modifier.kind === request.ts.SyntaxKind.ReadonlyKeyword);
    const name = member.name.getText(request.sourceFile);
    const optional = member.questionToken ? "?" : "";
    const typeText = member.type ? normalizeWhitespace(member.type.getText(request.sourceFile)) : "any";
    return `${readonly ? "readonly " : ""}${name}${optional}:${typeText}`;
  });
  return parts.sort().join(";");
};

// Heritage keeps `interface A extends X { a }` from colliding with a bare `{ a }`.
const heritageToken = (node: TS.InterfaceDeclaration, sourceFile: TS.SourceFile): string => {
  if (!node.heritageClauses || node.heritageClauses.length === 0) return "";
  const bases = node.heritageClauses.flatMap((clause) =>
    clause.types.map((type) => normalizeWhitespace(type.getText(sourceFile))),
  );
  return `|H:${bases.sort().join(",")}`;
};

const typeSignature = (request: {
  ts: typeof TS;
  node: TS.Node;
  sourceFile: TS.SourceFile;
}): { name: string; signature: string } | null => {
  const { ts, node, sourceFile } = request;
  if (ts.isInterfaceDeclaration(node)) {
    return {
      name: node.name.text,
      signature: canonicalMembers({ ts, members: node.members, sourceFile }) + heritageToken(node, sourceFile),
    };
  }
  if (ts.isTypeAliasDeclaration(node) && ts.isTypeLiteralNode(node.type)) {
    return { name: node.name.text, signature: canonicalMembers({ ts, members: node.type.members, sourceFile }) };
  }
  return null;
};

const bindingNames = (ts: typeof TS, bindingName: TS.BindingName | undefined): ReadonlyArray<string> => {
  if (!bindingName) return [];
  if (ts.isIdentifier(bindingName)) return [bindingName.text];
  return bindingName.elements.flatMap((element) =>
    ts.isBindingElement(element) ? bindingNames(ts, element.name) : [],
  );
};

// Every name bound inside the function: parameters, locals, nested function names, and catch variables.
const collectBound = (request: {
  ts: typeof TS;
  parameters: ReadonlyArray<TS.ParameterDeclaration>;
  functionNode: TS.Node;
}): Set<string> => {
  const { ts } = request;
  const names = new Set(request.parameters.flatMap((parameter) => bindingNames(ts, parameter.name)));
  const walk = (node: TS.Node): void => {
    if (ts.isVariableDeclaration(node) || ts.isParameter(node)) {
      for (const name of bindingNames(ts, node.name)) names.add(name);
    } else if (ts.isFunctionDeclaration(node) && node.name) {
      names.add(node.name.text);
    } else if (ts.isCatchClause(node) && node.variableDeclaration) {
      for (const name of bindingNames(ts, node.variableDeclaration.name)) names.add(name);
    }
    ts.forEachChild(node, walk);
  };
  walk(request.functionNode);
  return names;
};

// Bodies that differ only by formatting, comments, or a consistent rename of locals and parameters give the same
// string; a changed operator, literal, or free name does not.
const fingerprintSource = (request: {
  ts: typeof TS;
  parameters: ReadonlyArray<TS.ParameterDeclaration>;
  functionNode: TS.Node;
}): string => {
  const { ts } = request;
  const bound = collectBound(request);
  const placeholder = new Map<string, string>();
  let localCount = 0;
  for (const parameterName of request.parameters.flatMap((parameter) => bindingNames(ts, parameter.name))) {
    if (!placeholder.has(parameterName)) placeholder.set(parameterName, `P${placeholder.size}`);
  }

  const serializeIdentifier = (identifier: TS.Identifier): string => {
    if (!bound.has(identifier.text)) return `@${identifier.text}`;
    const existingPlaceholder = placeholder.get(identifier.text);
    if (existingPlaceholder !== undefined) return `#${existingPlaceholder}`;
    const localPlaceholder = `L${localCount++}`;
    placeholder.set(identifier.text, localPlaceholder);
    return `#${localPlaceholder}`;
  };

  const serialize = (node: TS.Node | undefined): string => {
    if (!node) return "";
    if (ts.isIdentifier(node)) return serializeIdentifier(node);
    if (ts.isStringLiteralLike(node)) return `S${JSON.stringify(node.text)}`;
    if (ts.isNumericLiteral(node)) return `N${node.text}`;
    if (node.kind === ts.SyntaxKind.TrueKeyword) return "true";
    if (node.kind === ts.SyntaxKind.FalseKeyword) return "false";
    if (node.kind === ts.SyntaxKind.NullKeyword) return "null";
    if (ts.isPropertyAccessExpression(node)) return `PA(${serialize(node.expression)}.${node.name.text})`;
    if (ts.isBinaryExpression(node)) {
      return `B${node.operatorToken.kind}(${serialize(node.left)},${serialize(node.right)})`;
    }
    if (ts.isPrefixUnaryExpression(node)) return `U${node.operator}(${serialize(node.operand)})`;
    if (ts.isPostfixUnaryExpression(node)) return `PU${node.operator}(${serialize(node.operand)})`;
    const children: Array<string> = [];
    // A truthy callback return would stop forEachChild early, so push inside a block.
    ts.forEachChild(node, (child) => {
      children.push(serialize(child));
    });
    return `K${node.kind}(${children.join(",")})`;
  };

  return `A${request.parameters.length}|${serialize(request.functionNode)}`;
};

// A named function declaration, method, or function assigned to a variable or property.
const functionFingerprint = (ts: typeof TS, node: TS.Node): { name: string; fingerprint: string } | null => {
  if (ts.isFunctionDeclaration(node) && node.name && node.body) {
    return {
      name: node.name.text,
      fingerprint: fingerprintSource({ ts, parameters: node.parameters, functionNode: node.body }),
    };
  }
  if (ts.isMethodDeclaration(node) && node.name && node.body) {
    return {
      name: node.name.getText(),
      fingerprint: fingerprintSource({ ts, parameters: node.parameters, functionNode: node.body }),
    };
  }
  if (ts.isVariableDeclaration(node) || ts.isPropertyAssignment(node) || ts.isPropertyDeclaration(node)) {
    const init = node.initializer;
    if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) && init.body && node.name) {
      return {
        name: node.name.getText(),
        fingerprint: fingerprintSource({ ts, parameters: init.parameters, functionNode: init.body }),
      };
    }
  }
  return null;
};

const extractDeclarations = (request: {
  ts: typeof TS;
  sourceText: string;
  fileName: string;
}): ExtractedDeclarations => {
  const { ts } = request;
  // e.g. "Button.tsx" → TSX; "format.ts" → TS
  const scriptKind = /\.tsx$/.test(request.fileName) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(
    request.fileName || "snippet.tsx",
    request.sourceText,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
  const lines = request.sourceText.split("\n");
  const types: Array<TypeEntry> = [];
  const functions: Array<FunctionEntry> = [];
  const locate = (node: TS.Node): { line: number; ignored: boolean } => {
    const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
    return { line, ignored: lines.at(line - 1)?.includes(ALLOW_MARKER) === true };
  };

  const visit = (node: TS.Node): void => {
    const typeShape = typeSignature({ ts, node, sourceFile });
    if (typeShape) types.push({ ...typeShape, ...locate(node) });
    const functionShape = functionFingerprint(ts, node);
    if (functionShape) functions.push({ ...functionShape, ...locate(node) });
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return { types, functions };
};

// A parser failure gives no entries, so a guard never blocks on its own bug.
export const extractFromText = (request: {
  ts: typeof TS;
  sourceText: string;
  fileName: string;
}): ExtractedDeclarations => {
  try {
    return extractDeclarations(request);
  } catch {
    return { types: [], functions: [] };
  }
};
