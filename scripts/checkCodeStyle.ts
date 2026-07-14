import { readFileSync } from "node:fs";
import { join } from "node:path";
import { globSync } from "glob";
import ts from "typescript";

export type CodeStyleViolation = {
  ruleId: string;
  file: string;
  line: number;
  message: string;
};

export type CodeStyleReport = {
  violations: ReadonlyArray<CodeStyleViolation>;
  protectedPaths: ReadonlyArray<string>;
};

type MachineRule = {
  id: string;
  summary: string;
  enforcement: string;
};

type ProtectedPathConfiguration = {
  path: string;
  codeRuleExemptions: ReadonlyArray<string>;
};

type CodeStyleConfiguration = {
  rules: ReadonlyArray<MachineRule>;
  protectedPaths: ReadonlyArray<ProtectedPathConfiguration>;
};

const APPROVED_PROTECTED_PATHS = [
  "src/skills/make-a-trailer/SKILL.md",
  "src/skills/make-a-trailer/reference/pipeline.md",
  "src/skills/make-a-trailer/scripts/assembleCut.mjs",
];

const APPROVED_ASSEMBLE_CUT_EXEMPTIONS = [
  "function.arrow-only",
  "function.input-shape",
  "comment.loop-intent",
];

const ENFORCEMENT_VALUES = new Set(["ast", "biome", "importGraph", "manual", "path"]);

const failConfiguration = (message: string): never => {
  throw new Error(`Invalid code-style configuration: ${message}`);
};

const readStringProperty = (value: object, property: string): string => {
  const candidate: unknown = Reflect.get(value, property);
  if (typeof candidate !== "string") {
    return failConfiguration(`${property} must be a string`);
  }

  return candidate;
};

const readStringArrayProperty = (value: object, property: string): ReadonlyArray<string> => {
  const candidate: unknown = Reflect.get(value, property);
  if (!Array.isArray(candidate)) {
    return failConfiguration(`${property} must be an array`);
  }

  const entries: ReadonlyArray<unknown> = candidate;
  if (!entries.every((entry) => typeof entry === "string")) {
    return failConfiguration(`${property} must contain only strings`);
  }

  return entries.filter((entry): entry is string => typeof entry === "string");
};

const readMachineRule = (value: unknown): MachineRule => {
  if (typeof value !== "object" || value === null) {
    return failConfiguration("each rule must be an object");
  }

  const id = readStringProperty(value, "id");
  const summary = readStringProperty(value, "summary");
  const enforcement = readStringProperty(value, "enforcement");
  if (!ENFORCEMENT_VALUES.has(enforcement)) {
    return failConfiguration(`rule ${id} has invalid enforcement ${enforcement}`);
  }

  return { id, summary, enforcement };
};

const readProtectedPath = (value: unknown): ProtectedPathConfiguration => {
  if (typeof value !== "object" || value === null) {
    return failConfiguration("each protected path must be an object");
  }

  return {
    path: readStringProperty(value, "path"),
    codeRuleExemptions: readStringArrayProperty(value, "codeRuleExemptions"),
  };
};

const readObjectArrayProperty = (value: object, property: string): ReadonlyArray<unknown> => {
  const candidate: unknown = Reflect.get(value, property);
  if (!Array.isArray(candidate)) {
    return failConfiguration(`${property} must be an array`);
  }

  return candidate;
};

const readConfiguration = (repositoryRoot: string): CodeStyleConfiguration => {
  const configurationPath = join(repositoryRoot, "code-style.rules.json");
  const parsed: unknown = JSON.parse(readFileSync(configurationPath, "utf8"));
  if (typeof parsed !== "object" || parsed === null) {
    return failConfiguration("root must be an object");
  }

  return {
    rules: readObjectArrayProperty(parsed, "rules").map(readMachineRule),
    protectedPaths: readObjectArrayProperty(parsed, "protectedPaths").map(readProtectedPath),
  };
};

const sameStrings = (left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean =>
  left.length === right.length && left.every((entry, index) => entry === right[index]);

const validateProtectedPaths = (protectedPaths: ReadonlyArray<ProtectedPathConfiguration>): void => {
  const paths = protectedPaths.map((entry) => entry.path);
  if (!sameStrings(paths, APPROVED_PROTECTED_PATHS)) {
    failConfiguration("protected paths must match the three approved exact paths");
  }

  const markdownEntries = protectedPaths.slice(0, 2);
  if (!markdownEntries.every((entry) => entry.codeRuleExemptions.length === 0)) {
    failConfiguration("protected Markdown paths cannot have code-rule exemptions");
  }

  const assembleCut = protectedPaths[2];
  if (!assembleCut || !sameStrings(assembleCut.codeRuleExemptions, APPROVED_ASSEMBLE_CUT_EXEMPTIONS)) {
    failConfiguration("assembleCut.mjs must have exactly the three approved code-rule exemptions");
  }
};

const validateRuleIds = (repositoryRoot: string, rules: ReadonlyArray<MachineRule>): void => {
  const guide = readFileSync(join(repositoryRoot, "CODE-STYLE.md"), "utf8");
  const documentedIds = [...guide.matchAll(/\[rule:([a-z0-9.-]+)\]/gu)].map((match) => match[1] ?? "");
  const machineIds = rules.map((rule) => rule.id);
  const allIds = new Set([...documentedIds, ...machineIds]);

  allIds.forEach((ruleId) => {
    const documentedCount = documentedIds.filter((candidate) => candidate === ruleId).length;
    const machineCount = machineIds.filter((candidate) => candidate === ruleId).length;
    if (documentedCount !== 1 || machineCount !== 1) {
      failConfiguration(
        `rule ${ruleId} must appear exactly once in CODE-STYLE.md and exactly once in code-style.rules.json`,
      );
    }
  });
};

type ViolationInput = {
  ruleId: string;
  sourceFile: ts.SourceFile;
  node: ts.Node;
  message: string;
};

const isEffectGenCall = (node: ts.FunctionExpression): boolean => {
  const parent = node.parent;
  if (!ts.isCallExpression(parent) || parent.arguments[0] !== node) {
    return false;
  }

  const expression = parent.expression;
  return (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === "Effect" &&
    expression.name.text === "gen"
  );
};

const isDirectSchemaTaggedError = (expression: ts.Expression): boolean => {
  if (ts.isCallExpression(expression) || ts.isParenthesizedExpression(expression)) {
    return isDirectSchemaTaggedError(expression.expression);
  }

  return (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === "Schema" &&
    expression.name.text === "TaggedError"
  );
};

const isSchemaTaggedErrorClass = (node: ts.ClassDeclaration | ts.ClassExpression): boolean => {
  const heritageTypes =
    node.heritageClauses
      ?.filter((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword)
      .flatMap((clause) => clause.types) ?? [];

  return heritageTypes.length === 1 && isDirectSchemaTaggedError(heritageTypes[0]?.expression ?? node);
};

const relativeSourceFiles = (repositoryRoot: string): ReadonlyArray<string> =>
  globSync(["src/**/*.{ts,tsx,js,mjs,mts,cts}", "scripts/**/*.{ts,tsx,js,mjs,mts,cts}"], {
    cwd: repositoryRoot,
    nodir: true,
    ignore: [
      "**/node_modules/**",
      "**/dist/**",
      ".agents/**",
      ".cursor/**",
      ".devin/**",
    ],
  }).sort();

const hasImmediatelyPrecedingComment = (sourceFile: ts.SourceFile, node: ts.Node): boolean => {
  const comments = ts.getLeadingCommentRanges(sourceFile.text, node.getFullStart()) ?? [];
  const comment = comments.at(-1);
  if (!comment) {
    return false;
  }

  const gap = sourceFile.text.slice(comment.end, node.getStart(sourceFile));
  return /^[ \t]*\r?\n[ \t]*$/u.test(gap);
};

const nearestStatement = (node: ts.Node): ts.Node => {
  if (ts.isStatement(node) || ts.isVariableDeclaration(node)) {
    return node;
  }

  return node.parent ? nearestStatement(node.parent) : node;
};

const isExplicitLoop = (node: ts.Node): boolean =>
  ts.isForStatement(node) ||
  ts.isForOfStatement(node) ||
  ts.isForInStatement(node) ||
  ts.isWhileStatement(node) ||
  ts.isDoStatement(node);

const hasInvalidInputShape = (node: ts.FunctionLikeDeclaration): boolean =>
  node.parameters.length > 2 ||
  node.parameters.some(
    (parameter) =>
      Boolean(parameter.dotDotDotToken) ||
      parameter.type?.kind === ts.SyntaxKind.BooleanKeyword ||
      parameter.initializer?.kind === ts.SyntaxKind.TrueKeyword ||
      parameter.initializer?.kind === ts.SyntaxKind.FalseKeyword,
  );

const isFunctionStatement = (statement: ts.Statement): boolean => {
  if (ts.isFunctionDeclaration(statement)) {
    return true;
  }

  return (
    ts.isVariableStatement(statement) &&
    statement.declarationList.declarations.some(
      (declaration) => Boolean(declaration.initializer && ts.isArrowFunction(declaration.initializer)),
    )
  );
};

const isControlNode = (node: ts.Node): boolean =>
  ts.isIfStatement(node) ||
  ts.isSwitchStatement(node) ||
  ts.isTryStatement(node) ||
  isExplicitLoop(node);

const nestingDepth = (node: ts.Node): number => {
  const parent = node.parent;
  if (!parent || ts.isFunctionLike(parent)) {
    return 1;
  }

  return nestingDepth(parent) + (isControlNode(parent) ? 1 : 0);
};

const hasExportModifier = (node: ts.Node & { modifiers?: ts.NodeArray<ts.ModifierLike> }): boolean =>
  Boolean(node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword));

const isApplicationFile = (file: string): boolean =>
  file.startsWith("src/") &&
  !file.startsWith("src/runtime/") &&
  !file.includes("/hooks/") &&
  !file.includes("/runtime/") &&
  !file.startsWith("src/skills/png-to-code/scripts/");

const assignedRootIdentifier = (expression: ts.Expression): ts.Identifier | undefined => {
  if (ts.isIdentifier(expression)) {
    return expression;
  }

  if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
    return assignedRootIdentifier(expression.expression);
  }

  return undefined;
};

type ExecutableFunction =
  | ts.ArrowFunction
  | ts.ConstructorDeclaration
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.GetAccessorDeclaration
  | ts.MethodDeclaration
  | ts.SetAccessorDeclaration;

const isExecutableFunction = (node: ts.Node): node is ExecutableFunction =>
  ts.isArrowFunction(node) ||
  ts.isConstructorDeclaration(node) ||
  ts.isFunctionDeclaration(node) ||
  ts.isFunctionExpression(node) ||
  ts.isGetAccessorDeclaration(node) ||
  ts.isMethodDeclaration(node) ||
  ts.isSetAccessorDeclaration(node);

const isGeneratorFunction = (
  node: ts.Node,
): node is ts.FunctionDeclaration | ts.FunctionExpression | ts.MethodDeclaration =>
  (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isMethodDeclaration(node)) &&
  Boolean(node.asteriskToken);

const containingFunction = (node: ts.Node): ExecutableFunction | undefined => {
  const parent = node.parent;
  if (!parent) {
    return undefined;
  }

  return isExecutableFunction(parent) ? parent : containingFunction(parent);
};

const isAssignmentOperator = (kind: ts.SyntaxKind): boolean =>
  kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;

const isBuilderReduce = (node: ts.CallExpression): boolean => {
  const expression = node.expression;
  const initial = node.arguments[1];
  return (
    ts.isPropertyAccessExpression(expression) &&
    expression.name.text === "reduce" &&
    Boolean(initial && (ts.isArrayLiteralExpression(initial) || ts.isObjectLiteralExpression(initial)))
  );
};

const isNamedPropertyCall = (node: ts.CallExpression, owner: string, property: string): boolean =>
  ts.isPropertyAccessExpression(node.expression) &&
  ts.isIdentifier(node.expression.expression) &&
  node.expression.expression.text === owner &&
  node.expression.name.text === property;

const isEffectRunCall = (node: ts.CallExpression): boolean =>
  ts.isPropertyAccessExpression(node.expression) &&
  ts.isIdentifier(node.expression.expression) &&
  node.expression.expression.text === "Effect" &&
  node.expression.name.text.startsWith("run");

const isConsoleCall = (node: ts.CallExpression): boolean =>
  ts.isPropertyAccessExpression(node.expression) &&
  ts.isIdentifier(node.expression.expression) &&
  node.expression.expression.text === "console";

const moduleSpecifierFor = (node: ts.Node): string | undefined => {
  if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
    return ts.isStringLiteralLike(node.moduleSpecifier) ? node.moduleSpecifier.text : undefined;
  }

  if (
    ts.isCallExpression(node) &&
    node.expression.kind === ts.SyntaxKind.ImportKeyword &&
    node.arguments.length === 1
  ) {
    const argument = node.arguments[0];
    return argument && ts.isStringLiteralLike(argument) ? argument.text : undefined;
  }

  return undefined;
};

const isHookRuntimeFile = (file: string): boolean =>
  file.startsWith("src/runtime/") || file.includes("/hooks/") || file.includes("/runtime/");

const resolvedImportPath = (file: string, specifier: string): string | undefined => {
  if (!specifier.startsWith(".")) {
    return undefined;
  }

  const segments = file.split("/");
  segments.pop();
  specifier.split("/").forEach((segment) => {
    if (segment === "..") {
      segments.pop();
    } else if (segment !== "." && segment !== "") {
      segments.push(segment);
    }
  });
  return segments.join("/");
};

const featureRuntimeRoot = (file: string): string | undefined => {
  const match = /^(src\/skills\/[^/]+)\/(?:hooks|runtime)\//u.exec(file);
  return match?.[1];
};

const hookImportAllowed = (file: string, specifier: string): boolean => {
  if (specifier.startsWith("node:")) {
    return true;
  }

  const target = resolvedImportPath(file, specifier);
  if (!target) {
    return false;
  }

  if (target.startsWith("src/runtime/")) {
    return true;
  }

  const featureRoot = featureRuntimeRoot(file);
  return Boolean(
    featureRoot &&
      (target.startsWith(`${featureRoot}/hooks/`) || target.startsWith(`${featureRoot}/runtime/`)),
  );
};

const inspectSourceFile = (
  repositoryRoot: string,
  file: string,
  protectedPaths: ReadonlyArray<ProtectedPathConfiguration>,
): ReadonlyArray<CodeStyleViolation> => {
  const sourceText = readFileSync(join(repositoryRoot, file), "utf8");
  const sourceFile = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true);
  const violations: Array<CodeStyleViolation> = [];
  const protectedEntry = protectedPaths.find((entry) => entry.path === file);

  const addViolation = ({ ruleId, sourceFile: source, node, message }: ViolationInput): void => {
    if (protectedEntry?.codeRuleExemptions.includes(ruleId)) {
      return;
    }

    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    violations.push({ ruleId, file, line, message });
  };

  const addLineViolation = (ruleId: string, line: number, message: string): void => {
    if (!protectedEntry?.codeRuleExemptions.includes(ruleId)) {
      violations.push({ ruleId, file, line, message });
    }
  };

  const protectedPath = Boolean(protectedEntry);
  if (!protectedPath) {
    const basename = file.split("/").at(-1) ?? "";
    if (/^(?:types|helpers|utils|common|misc)\.[cm]?[jt]sx?$/u.test(basename)) {
      addLineViolation("path.no-generic-bucket", 1, "Use a filename that names the domain job.");
    }

    const sourceDirectories = file.split("/").slice(1, -1);
    if (sourceDirectories.some((directory) => !/^[a-z][a-zA-Z0-9]*$/u.test(directory))) {
      addLineViolation("path.source-directory-case", 1, "Authored source directories must use camelCase.");
    }

    if (/^src\/(?:core|commands|payload)(?:\/|$)/u.test(file)) {
      addLineViolation("path.capability-layout", 1, "Move this source into the capability that owns it.");
    }
  }

  const inspectStatementSpacing = (node: ts.Node): void => {
    if (ts.isSourceFile(node) || ts.isBlock(node)) {
      node.statements.forEach((statement, index) => {
        const previous = node.statements[index - 1];
        if (previous && isFunctionStatement(previous) && isFunctionStatement(statement)) {
          const gap = sourceText.slice(previous.end, statement.getStart(sourceFile));
          if ((gap.match(/\r?\n/gu) ?? []).length < 2) {
            addViolation({
              ruleId: "function.blank-line",
              sourceFile,
              node: statement,
              message: "Separate function declarations with one blank line.",
            });
          }
        }
      });
    }

    ts.forEachChild(node, inspectStatementSpacing);
  };

  const visit = (node: ts.Node): void => {
    const moduleSpecifier = moduleSpecifierFor(node);
    if (moduleSpecifier && isHookRuntimeFile(file) && !hookImportAllowed(file, moduleSpecifier)) {
      addViolation({
        ruleId: "import.hook-runtime",
        sourceFile,
        node,
        message: "Installed hook graphs may import only node modules and their runtime island.",
      });
    }

    if (moduleSpecifier && isApplicationFile(file)) {
      const target = resolvedImportPath(file, moduleSpecifier);
      if (target && isHookRuntimeFile(target)) {
        addViolation({
          ruleId: "import.application-boundary",
          sourceFile,
          node,
          message: "Application modules cannot import the dependency-free installed hook runtime.",
        });
      }
    }

    const generatorFunction = isGeneratorFunction(node);
    const forbiddenFunctionForm =
      !generatorFunction &&
      (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isFunctionExpression(node));
    if (forbiddenFunctionForm) {
      addViolation({
        ruleId: "function.arrow-only",
        sourceFile,
        node,
        message: "Use an arrow function instead of a declaration, method, or function expression.",
      });
    }

    if (generatorFunction) {
      const allowed = ts.isFunctionExpression(node) && !node.name && isEffectGenCall(node);
      if (!allowed) {
        addViolation({
          ruleId: "function.effect-generator",
          sourceFile,
          node,
          message: "Anonymous generators are allowed only as the direct Effect.gen callback.",
        });
      }
    }

    if (isExecutableFunction(node) && hasInvalidInputShape(node)) {
      addViolation({
        ruleId: "function.input-shape",
        sourceFile,
        node,
        message: "Use at most two natural positional inputs, no rest input, and no positional boolean flag.",
      });
    }

    if ((ts.isClassDeclaration(node) || ts.isClassExpression(node)) && !isSchemaTaggedErrorClass(node)) {
      addViolation({
        ruleId: "class.tagged-error-only",
        sourceFile,
        node,
        message: "Classes are allowed only when they directly extend Schema.TaggedError.",
      });
    }

    if (
      ts.isAsExpression(node) ||
      ts.isTypeAssertionExpression(node) ||
      (ts.isNonNullExpression(node) && !ts.isElementAccessExpression(node.expression))
    ) {
      addViolation({
        ruleId: "type.no-assertion",
        sourceFile,
        node,
        message: "Decode or narrow values instead of asserting a type.",
      });
    }

    if (
      ts.isNonNullExpression(node) &&
      ts.isElementAccessExpression(node.expression) &&
      !hasImmediatelyPrecedingComment(sourceFile, nearestStatement(node))
    ) {
      addViolation({
        ruleId: "comment.index-proof",
        sourceFile,
        node,
        message: "Place the indexed-access proof comment immediately above this assertion.",
      });
    }

    if (isExplicitLoop(node) && !hasImmediatelyPrecedingComment(sourceFile, node)) {
      addViolation({
        ruleId: "comment.loop-intent",
        sourceFile,
        node,
        message: "Place one short intent comment immediately above this explicit loop.",
      });
    }

    if (ts.isInterfaceDeclaration(node) && !/\.d\.(?:c|m)?ts$/u.test(file)) {
      addViolation({
        ruleId: "type.no-interface",
        sourceFile,
        node,
        message: "Use an Effect Schema-derived type; interfaces are reserved for declaration augmentation.",
      });
    }

    if (ts.isEnumDeclaration(node)) {
      addViolation({
        ruleId: "type.no-enum",
        sourceFile,
        node,
        message: "Use schema literals or a literal union instead of an enum.",
      });
    }

    if (ts.isConditionalTypeNode(node)) {
      addViolation({
        ruleId: "type.no-conditional",
        sourceFile,
        node,
        message: "Authored conditional and infer type machinery is forbidden.",
      });
    }

    if (isControlNode(node) && nestingDepth(node) > 2) {
      addViolation({
        ruleId: "function.nesting",
        sourceFile,
        node,
        message: "Use a guard clause or extract a cohesive operation before a third nesting level.",
      });
    }

    if (ts.isTypeAliasDeclaration(node) && hasExportModifier(node) && ts.isTypeLiteralNode(node.type) && file.startsWith("src/")) {
      addViolation({
        ruleId: "type.schema-owned-runtime",
        sourceFile,
        node,
        message: "Exported runtime object types must derive from an Effect Schema.",
      });
    }

    if (/\/index\.[cm]?[jt]sx?$/u.test(`/${file}`) && ts.isStatement(node) && node.parent === sourceFile) {
      const directWildcard =
        ts.isExportDeclaration(node) &&
        !node.exportClause &&
        Boolean(node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) &&
        !/(?:^|\/)index\.(?:js|mjs|cjs|ts|mts|cts)$/u.test(
          node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : "",
        );
      if (!directWildcard) {
        addViolation({
          ruleId: "barrel.direct-wildcard",
          sourceFile,
          node,
          message: "A barrel may contain only direct export * from declarations.",
        });
      }
    }

    if (
      ts.isIdentifier(node) &&
      /^(?:manager|helper|utils|data|info|common|misc)$|(?:Manager|Helper|Utils|Data|Info|Common|Misc)$/u.test(
        node.text,
      )
    ) {
      addViolation({
        ruleId: "name.domain-specific",
        sourceFile,
        node,
        message: "Use a name that states the domain job instead of a vague role.",
      });
    }

    if (ts.isBinaryExpression(node) && isAssignmentOperator(node.operatorToken.kind)) {
      const root = assignedRootIdentifier(node.left);
      const owner = containingFunction(node);
      const mutatesInput = Boolean(
        root &&
          owner?.parameters.some(
            (parameter) => ts.isIdentifier(parameter.name) && parameter.name.text === root.text,
          ),
      );
      if (mutatesInput) {
        addViolation({
          ruleId: "mutation.no-input",
          sourceFile,
          node,
          message: "Create a new value instead of mutating a function input.",
        });
      }
    }

    if (ts.isCallExpression(node) && isBuilderReduce(node)) {
      addViolation({
        ruleId: "collection.no-builder-reduce",
        sourceFile,
        node,
        message: "Use a direct collection transformation instead of reduce to build a collection.",
      });
    }

    if (ts.isCallExpression(node) && isApplicationFile(file)) {
      if (isNamedPropertyCall(node, "Promise", "all")) {
        addViolation({
          ruleId: "effect.no-promise-all",
          sourceFile,
          node,
          message: "Use sequential Effect collection operators unless bounded concurrency is justified.",
        });
      }

      if (file !== "src/cli/main.ts" && isEffectRunCall(node)) {
        addViolation({
          ruleId: "effect.runtime-edge",
          sourceFile,
          node,
          message: "Effect.run calls belong only at src/cli/main.ts.",
        });
      }

      if (isConsoleCall(node)) {
        addViolation({
          ruleId: "presentation.terminal-ui",
          sourceFile,
          node,
          message: "Route application presentation through TerminalUI.",
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  sourceText.split(/\r?\n/u).forEach((lineText, index) => {
    if (/^\s*(?:\/\/|\/\*)\s*@ts-(?:ignore|expect-error|nocheck)\b/u.test(lineText)) {
      addLineViolation(
        "type.no-suppression",
        index + 1,
        "Remove the TypeScript suppression and fix the boundary instead.",
      );
    }
  });

  inspectStatementSpacing(sourceFile);
  visit(sourceFile);
  return violations;
};

const compareViolations = (left: CodeStyleViolation, right: CodeStyleViolation): number =>
  left.file.localeCompare(right.file) || left.line - right.line || left.ruleId.localeCompare(right.ruleId);

export const checkCodeStyle = (repositoryRoot: string): CodeStyleReport => {
  const configuration = readConfiguration(repositoryRoot);
  validateRuleIds(repositoryRoot, configuration.rules);
  validateProtectedPaths(configuration.protectedPaths);

  const violations = relativeSourceFiles(repositoryRoot)
    .flatMap((file) => inspectSourceFile(repositoryRoot, file, configuration.protectedPaths))
    .sort(compareViolations);

  return {
    violations,
    protectedPaths: configuration.protectedPaths.map((entry) => entry.path),
  };
};
