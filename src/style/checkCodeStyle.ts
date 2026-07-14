import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { globSync } from "glob";
import ts from "typescript";

export type CodeStyleViolation = {
  readonly ruleId: string;
  readonly file: string;
  readonly line: number;
  readonly message: string;
};

export type ProtectedPathState = {
  readonly path: string;
  readonly state: "protected-committed" | "protected-overlay";
  readonly sha256: string;
};

export type CodeStyleReport = {
  readonly violations: ReadonlyArray<CodeStyleViolation>;
  readonly protectedStates: ReadonlyArray<ProtectedPathState>;
  readonly manualReviewRuleIds: ReadonlyArray<string>;
};

export type CodeStyleMetadataReport = {
  readonly ruleCount: number;
  readonly protectedPathCount: number;
  readonly exceptionCount: number;
  readonly manualReviewRuleIds: ReadonlyArray<string>;
};

type Enforcement = "formatter" | "linter" | "regex" | "ast" | "path" | "importGraph" | "typecheck" | "test" | "manual";

type MachineRule = {
  readonly id: string;
  readonly applicability: string;
  readonly summary: string;
  readonly rationale: string;
  readonly goodExample: string;
  readonly badExample: string;
  readonly enforcement: ReadonlyArray<Enforcement>;
  readonly autofix: boolean;
};

type ProtectedPathConfiguration = {
  readonly path: string;
  readonly committedSha256: string;
  readonly overlaySha256: string;
};

type ExceptionConfiguration = {
  readonly ruleId: string;
  readonly path: string;
  readonly state: "protected-overlay";
  readonly maxViolations: number;
  readonly reason: string;
  readonly exitCondition: string;
};

type CodeStyleConfiguration = {
  readonly rules: ReadonlyArray<MachineRule>;
  readonly protectedPaths: ReadonlyArray<ProtectedPathConfiguration>;
  readonly exceptions: ReadonlyArray<ExceptionConfiguration>;
};

type ParsedContract = {
  readonly configuration: CodeStyleConfiguration;
  readonly rulesById: ReadonlyMap<string, MachineRule>;
  readonly manualReviewRuleIds: ReadonlyArray<string>;
};

type ViolationInput = {
  readonly ruleId: string;
  readonly channel: "regex" | "ast" | "path" | "importGraph";
  readonly sourceFile: ts.SourceFile;
  readonly node: ts.Node;
  readonly message: string;
};

type RuleChannelRequest = {
  readonly rulesById: ReadonlyMap<string, MachineRule>;
  readonly ruleId: string;
  readonly channel: "regex" | "ast" | "path" | "importGraph";
};

type LineViolationInput = {
  readonly ruleId: string;
  readonly channel: "regex" | "ast" | "path" | "importGraph";
  readonly line: number;
  readonly message: string;
};

type SourceImportRequest = {
  readonly repositoryRoot: string;
  readonly file: string;
  readonly specifier: string;
};

type SourceInspectionRequest = {
  readonly repositoryRoot: string;
  readonly file: string;
  readonly protectedState: ProtectedPathState | undefined;
  readonly rulesById: ReadonlyMap<string, MachineRule>;
  readonly program: ts.Program;
  readonly typeChecker: ts.TypeChecker;
};

type ImportEdgeRequest = {
  readonly repositoryRoot: string;
  readonly files: ReadonlyArray<string>;
  readonly program: ts.Program;
};

type ImportEdge = {
  readonly from: string;
  readonly to: string;
  readonly line: number;
};

type ExecutableFunction =
  | ts.ArrowFunction
  | ts.ConstructorDeclaration
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.GetAccessorDeclaration
  | ts.MethodDeclaration
  | ts.SetAccessorDeclaration;

const APPROVED_PROTECTED_PATHS = [
  "src/skills/make-a-trailer/SKILL.md",
  "src/skills/make-a-trailer/reference/pipeline.md",
  "src/skills/make-a-trailer/scripts/assembleCut.mjs",
];

const APPROVED_EXCEPTION_MAXIMUMS = new Map([
  ["function.arrow-only", 13],
  ["function.input-shape", 5],
  ["comment.loop-intent", 2],
]);

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const SUPPRESSION_PATTERN =
  /(?:@ts-(?:ignore|expect-error|nocheck)|biome-ignore|prettier-ignore|eslint-disable(?:-next-line|-line)?|(?:c8|istanbul|v8)\s+ignore)\b/u;
const PROVIDER_SDK_PATTERN = /^(?:@aws-sdk\/|@google-cloud\/|@octokit\/|firebase-admin$|openai$|resend$|stripe$|twilio$)/u;
const GENERIC_FILE_PATTERN = /^(?:types|helpers|utils|common|misc)\.[cm]?[jt]sx?$/u;
const VAGUE_NAME_PATTERN = /^(?:manager|helper|utils|data|info|common|misc)$|(?:Manager|Helper|Utils|Data|Info|Common|Misc)$/u;

const failConfiguration = (message: string): never => {
  throw new Error(`Invalid code-style configuration: ${message}`);
};

const isRecord = (value: unknown): value is object => typeof value === "object" && value !== null && !Array.isArray(value);

const readProperty = (value: object, property: string): unknown => Reflect.get(value, property);

const readNonEmptyString = (value: object, property: string): string => {
  const candidate = readProperty(value, property);
  if (typeof candidate !== "string" || candidate.trim().length === 0) {
    return failConfiguration(`${property} must be a non-empty string`);
  }

  return candidate;
};

const readObjectArray = (value: object, property: string): ReadonlyArray<unknown> => {
  const candidate = readProperty(value, property);
  if (!Array.isArray(candidate)) {
    return failConfiguration(`${property} must be an array`);
  }

  return candidate;
};

const isEnforcement = (value: unknown): value is Enforcement =>
  value === "formatter" ||
  value === "linter" ||
  value === "regex" ||
  value === "ast" ||
  value === "path" ||
  value === "importGraph" ||
  value === "typecheck" ||
  value === "test" ||
  value === "manual";

const readEnforcement = (value: object, ruleId: string): ReadonlyArray<Enforcement> => {
  const candidate = readProperty(value, "enforcement");
  if (!Array.isArray(candidate) || candidate.length === 0 || !candidate.every(isEnforcement)) {
    return failConfiguration(`rule ${ruleId} must have a non-empty enforcement array from the approved vocabulary`);
  }

  if (new Set(candidate).size !== candidate.length) {
    return failConfiguration(`rule ${ruleId} has duplicate enforcement channels`);
  }

  return candidate.filter(isEnforcement);
};

const readAutofix = ({
  value,
  ruleId,
  enforcement,
}: {
  readonly value: object;
  readonly ruleId: string;
  readonly enforcement: ReadonlyArray<Enforcement>;
}): boolean => {
  const candidate = readProperty(value, "autofix");
  if (candidate === undefined) {
    return false;
  }

  if (typeof candidate !== "boolean") {
    return failConfiguration(`rule ${ruleId} autofix must be a boolean when present`);
  }

  const formatterOrLinterOnly = enforcement.every((channel) => channel === "formatter" || channel === "linter");
  if (candidate && !formatterOrLinterOnly) {
    return failConfiguration(`rule ${ruleId} may autofix only a formatter or linter transformation`);
  }

  return candidate;
};

const readMachineRule = (value: unknown): MachineRule => {
  if (!isRecord(value)) {
    return failConfiguration("each rule must be an object");
  }

  const id = readNonEmptyString(value, "id");
  if (!/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u.test(id)) {
    return failConfiguration(`rule ID ${id} has invalid syntax`);
  }

  const enforcement = readEnforcement(value, id);
  return {
    id,
    applicability: readNonEmptyString(value, "applicability"),
    summary: readNonEmptyString(value, "summary"),
    rationale: readNonEmptyString(value, "rationale"),
    goodExample: readNonEmptyString(value, "goodExample"),
    badExample: readNonEmptyString(value, "badExample"),
    enforcement,
    autofix: readAutofix({ value, ruleId: id, enforcement }),
  };
};

const readProtectedPath = (value: unknown): ProtectedPathConfiguration => {
  if (!isRecord(value)) {
    return failConfiguration("each protected path must be an object");
  }

  return {
    path: readNonEmptyString(value, "path"),
    committedSha256: readNonEmptyString(value, "committedSha256"),
    overlaySha256: readNonEmptyString(value, "overlaySha256"),
  };
};

const readException = (value: unknown): ExceptionConfiguration => {
  if (!isRecord(value)) {
    return failConfiguration("each exception must be an object");
  }

  const state = readNonEmptyString(value, "state");
  if (state !== "protected-overlay") {
    return failConfiguration("exceptions may activate only for protected-overlay state");
  }

  const maximum = readProperty(value, "maxViolations");
  if (typeof maximum !== "number" || !Number.isInteger(maximum)) {
    return failConfiguration("maxViolations must be an integer");
  }

  return {
    ruleId: readNonEmptyString(value, "ruleId"),
    path: readNonEmptyString(value, "path"),
    state,
    maxViolations: maximum,
    reason: readNonEmptyString(value, "reason"),
    exitCondition: readNonEmptyString(value, "exitCondition"),
  };
};

const readConfiguration = (repositoryRoot: string): CodeStyleConfiguration => {
  const configurationPath = join(repositoryRoot, "code-style.rules.json");
  const parsed: unknown = JSON.parse(readFileSync(configurationPath, "utf8"));
  if (!isRecord(parsed)) {
    return failConfiguration("root must be an object");
  }

  return {
    rules: readObjectArray(parsed, "rules").map(readMachineRule),
    protectedPaths: readObjectArray(parsed, "protectedPaths").map(readProtectedPath),
    exceptions: readObjectArray(parsed, "exceptions").map(readException),
  };
};

const sameStrings = (left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean =>
  left.length === right.length && left.every((entry, index) => entry === right.at(index));

const validateProtectedPaths = (protectedPaths: ReadonlyArray<ProtectedPathConfiguration>): void => {
  const paths = protectedPaths.map((entry) => entry.path);
  if (!sameStrings(paths, APPROVED_PROTECTED_PATHS)) {
    failConfiguration("protected paths must match the three approved exact paths in order");
  }

  protectedPaths.forEach((entry) => {
    if (/[?*{}[\]]/u.test(entry.path)) {
      failConfiguration(`protected path ${entry.path} cannot contain a wildcard`);
    }
    if (!SHA256_PATTERN.test(entry.committedSha256) || !SHA256_PATTERN.test(entry.overlaySha256)) {
      failConfiguration(`protected path ${entry.path} must have two lowercase SHA-256 hashes`);
    }
    if (entry.committedSha256 === entry.overlaySha256) {
      failConfiguration(`protected path ${entry.path} must record independent committed and overlay hashes`);
    }
  });
};

const validateExceptions = (exceptions: ReadonlyArray<ExceptionConfiguration>, rulesById: ReadonlyMap<string, MachineRule>): void => {
  if (exceptions.length !== APPROVED_EXCEPTION_MAXIMUMS.size) {
    failConfiguration("exceptions must contain exactly the three approved overlay ratchets");
  }

  const assembleCutPath = APPROVED_PROTECTED_PATHS[2];
  exceptions.forEach((entry) => {
    if (!rulesById.has(entry.ruleId)) {
      failConfiguration(`exception references unknown rule ${entry.ruleId}`);
    }
    if (!assembleCutPath || entry.path !== assembleCutPath || /[?*{}[\]]/u.test(entry.path)) {
      failConfiguration("every exception must use the exact protected assembleCut.mjs path");
    }
    const approvedMaximum = APPROVED_EXCEPTION_MAXIMUMS.get(entry.ruleId);
    if (approvedMaximum === undefined || entry.maxViolations !== approvedMaximum) {
      failConfiguration(`exception ${entry.ruleId} must keep its approved nonzero maximum`);
    }
  });

  const actualRuleIds = exceptions.map((entry) => entry.ruleId);
  if (!sameStrings(actualRuleIds, [...APPROVED_EXCEPTION_MAXIMUMS.keys()])) {
    failConfiguration("exceptions must keep the approved unique rule order");
  }
};

const validateRuleBijection = (repositoryRoot: string, rules: ReadonlyArray<MachineRule>): void => {
  const guide = readFileSync(join(repositoryRoot, "CODE-STYLE.md"), "utf8");
  const documentedIds = [...guide.matchAll(/\[rule:([a-z0-9.-]+)\]/gu)].flatMap((match) => (match[1] ? [match[1]] : []));
  const machineIds = rules.map((rule) => rule.id);
  const allIds = new Set([...documentedIds, ...machineIds]);

  allIds.forEach((ruleId) => {
    const documentedCount = documentedIds.filter((candidate) => candidate === ruleId).length;
    const machineCount = machineIds.filter((candidate) => candidate === ruleId).length;
    if (documentedCount !== 1 || machineCount !== 1) {
      failConfiguration(`rule ${ruleId} must appear exactly once in the guide and machine catalog`);
    }
  });

  if (!sameStrings(documentedIds, machineIds)) {
    failConfiguration("guide and machine rule IDs must use the same order");
  }
};

const parseContract = (repositoryRoot: string): ParsedContract => {
  const configuration = readConfiguration(repositoryRoot);
  const rulesById = new Map(configuration.rules.map((rule) => [rule.id, rule]));
  if (rulesById.size !== configuration.rules.length) {
    failConfiguration("rule IDs must be globally unique");
  }

  validateRuleBijection(repositoryRoot, configuration.rules);
  validateProtectedPaths(configuration.protectedPaths);
  validateExceptions(configuration.exceptions, rulesById);
  return {
    configuration,
    rulesById,
    manualReviewRuleIds: configuration.rules.filter((rule) => rule.enforcement.includes("manual")).map((rule) => rule.id),
  };
};

export const validateCodeStyleMetadata = (repositoryRoot: string): CodeStyleMetadataReport => {
  const contract = parseContract(repositoryRoot);
  return {
    ruleCount: contract.configuration.rules.length,
    protectedPathCount: contract.configuration.protectedPaths.length,
    exceptionCount: contract.configuration.exceptions.length,
    manualReviewRuleIds: contract.manualReviewRuleIds,
  };
};

const ruleUses = ({ rulesById, ruleId, channel }: RuleChannelRequest): boolean =>
  rulesById.get(ruleId)?.enforcement.includes(channel) ?? false;

const sha256File = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex");

const selectProtectedStates = (
  repositoryRoot: string,
  protectedPaths: ReadonlyArray<ProtectedPathConfiguration>,
): ReadonlyArray<ProtectedPathState> => {
  const states = protectedPaths.map((entry): ProtectedPathState => {
    const absolutePath = join(repositoryRoot, entry.path);
    if (!existsSync(absolutePath)) {
      return failConfiguration(`protected path ${entry.path} is missing`);
    }

    const sha256 = sha256File(absolutePath);
    if (sha256 === entry.committedSha256) {
      return { path: entry.path, state: "protected-committed", sha256 };
    }
    if (sha256 === entry.overlaySha256) {
      return { path: entry.path, state: "protected-overlay", sha256 };
    }

    return failConfiguration(`protected path ${entry.path} has an unknown content hash ${sha256}`);
  });

  if (new Set(states.map((entry) => entry.state)).size !== 1) {
    failConfiguration("protected paths cannot mix committed and overlay states");
  }
  return states;
};

const relativeSourceFiles = (repositoryRoot: string): ReadonlyArray<string> =>
  globSync(["src/**/*.{ts,tsx,js,mjs,mts,cts}", "scripts/**/*.{ts,tsx,js,mjs,mts,cts}"], {
    cwd: repositoryRoot,
    nodir: true,
    ignore: ["**/node_modules/**", "**/dist/**", ".agents/**", ".cursor/**", ".devin/**"],
  }).sort();

const isEffectGenCall = (node: ts.FunctionExpression): boolean => {
  const parent = node.parent;
  if (!ts.isCallExpression(parent) || parent.arguments[0] !== node) {
    return false;
  }

  return isNamedPropertyCall({ node: parent, owner: "Effect", property: "gen" });
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
    node.heritageClauses?.filter((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword).flatMap((clause) => clause.types) ?? [];
  const heritage = heritageTypes[0];
  return heritageTypes.length === 1 && Boolean(heritage && isDirectSchemaTaggedError(heritage.expression));
};

const isExplicitLoop = (node: ts.Node): node is ts.IterationStatement =>
  ts.isForStatement(node) || ts.isForOfStatement(node) || ts.isForInStatement(node) || ts.isWhileStatement(node) || ts.isDoStatement(node);

const immediateLeadingComment = (sourceFile: ts.SourceFile, node: ts.Node): string | undefined => {
  const comments = ts.getLeadingCommentRanges(sourceFile.text, node.getFullStart()) ?? [];
  const comment = comments.at(-1);
  if (!comment) {
    return undefined;
  }

  const gap = sourceFile.text.slice(comment.end, node.getStart(sourceFile));
  if (!/^[ \t]*\r?\n[ \t]*$/u.test(gap)) {
    return undefined;
  }
  return sourceFile.text.slice(comment.pos, comment.end);
};

const loopNeedsIntent = (node: ts.IterationStatement): boolean => {
  if (!ts.isForOfStatement(node)) {
    return true;
  }
  if (!ts.isBlock(node.statement)) {
    return false;
  }
  if (node.statement.statements.length !== 1) {
    return true;
  }
  const statement = node.statement.statements[0];
  return !statement || !ts.isExpressionStatement(statement);
};

const nearestStatement = (node: ts.Node): ts.Node => {
  if (ts.isStatement(node)) {
    return node;
  }
  return node.parent ? nearestStatement(node.parent) : node;
};

const hasInvalidInputShape = (node: ts.FunctionLikeDeclaration): boolean =>
  node.parameters.length > 2 ||
  node.parameters.some(
    (parameter) =>
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
    statement.declarationList.declarations.some((declaration) =>
      Boolean(declaration.initializer && ts.isArrowFunction(declaration.initializer)),
    )
  );
};

const isControlNode = (node: ts.Node): boolean =>
  ts.isIfStatement(node) || ts.isSwitchStatement(node) || ts.isTryStatement(node) || isExplicitLoop(node);

const nestingDepth = (node: ts.Node): number => {
  const parent = node.parent;
  if (!parent || ts.isFunctionLike(parent)) {
    return 1;
  }
  if (ts.isIfStatement(node) && ts.isIfStatement(parent) && parent.elseStatement === node) {
    return nestingDepth(parent);
  }
  return nestingDepth(parent) + (isControlNode(parent) ? 1 : 0);
};

const hasExportModifier = (node: ts.Node & { readonly modifiers?: ts.NodeArray<ts.ModifierLike> }): boolean =>
  Boolean(node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword));

const hasDefaultModifier = (node: ts.Node & { readonly modifiers?: ts.NodeArray<ts.ModifierLike> }): boolean =>
  Boolean(node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword));

const isHookRuntimeFile = (file: string): boolean =>
  file.startsWith("src/runtime/") || /^src\/skills\/[^/]+\/(?:hooks|runtime)\//u.test(file);

const isToolingFile = (file: string): boolean =>
  file.startsWith("scripts/") || file.startsWith("src/style/") || file.startsWith("src/build/");

const isApplicationFile = (file: string): boolean =>
  file.startsWith("src/") && !isHookRuntimeFile(file) && !isToolingFile(file) && !file.startsWith("src/skills/png-to-code/scripts/");

const assignedRootIdentifier = (expression: ts.Expression): ts.Identifier | undefined => {
  if (ts.isIdentifier(expression)) {
    return expression;
  }
  if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
    return assignedRootIdentifier(expression.expression);
  }
  return undefined;
};

const isExecutableFunction = (node: ts.Node): node is ExecutableFunction =>
  ts.isArrowFunction(node) ||
  ts.isConstructorDeclaration(node) ||
  ts.isFunctionDeclaration(node) ||
  ts.isFunctionExpression(node) ||
  ts.isGetAccessorDeclaration(node) ||
  ts.isMethodDeclaration(node) ||
  ts.isSetAccessorDeclaration(node);

const isGeneratorFunction = (node: ts.Node): node is ts.FunctionDeclaration | ts.FunctionExpression | ts.MethodDeclaration =>
  (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isMethodDeclaration(node)) && Boolean(node.asteriskToken);

const declarationBelongsToParameter = (node: ts.Node): boolean => {
  if (ts.isParameter(node)) {
    return true;
  }
  if (ts.isVariableDeclaration(node) || ts.isCatchClause(node) || isExecutableFunction(node) || ts.isSourceFile(node)) {
    return false;
  }
  return node.parent ? declarationBelongsToParameter(node.parent) : false;
};

const identifierBindsParameter = (typeChecker: ts.TypeChecker, identifier: ts.Identifier): boolean =>
  Boolean(typeChecker.getSymbolAtLocation(identifier)?.declarations?.some((declaration) => declarationBelongsToParameter(declaration)));

const isAssignmentOperator = (kind: ts.SyntaxKind): boolean =>
  kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;

const isAssignmentTarget = (node: ts.ElementAccessExpression): boolean =>
  ts.isBinaryExpression(node.parent) && node.parent.left === node && isAssignmentOperator(node.parent.operatorToken.kind);

const containsIdentifier = (node: ts.Node, name: string): boolean => {
  if (ts.isIdentifier(node) && node.text === name) {
    return true;
  }

  let found = false;
  ts.forEachChild(node, (child) => {
    if (!found && containsIdentifier(child, name)) {
      found = true;
    }
  });
  return found;
};

const declaredLoopIndex = (node: ts.ForStatement): string | undefined => {
  const initializer = node.initializer;
  if (!initializer || !ts.isVariableDeclarationList(initializer)) {
    return undefined;
  }

  const declaration = initializer.declarations[0];
  return declaration && ts.isIdentifier(declaration.name) ? declaration.name.text : undefined;
};

const conditionBoundsCollection = ({
  condition,
  collectionText,
  indexName,
}: {
  readonly condition: ts.Expression;
  readonly collectionText: string;
  readonly indexName: string;
}): boolean => {
  if (ts.isBinaryExpression(condition)) {
    const rightIsLength =
      ts.isPropertyAccessExpression(condition.right) &&
      condition.right.name.text === "length" &&
      condition.right.expression.getText() === collectionText;
    const leftIsLength =
      ts.isPropertyAccessExpression(condition.left) &&
      condition.left.name.text === "length" &&
      condition.left.expression.getText() === collectionText;
    const indexOnLeft = containsIdentifier(condition.left, indexName);
    const indexOnRight = containsIdentifier(condition.right, indexName);
    const upperBound =
      (indexOnLeft && rightIsLength && condition.operatorToken.kind === ts.SyntaxKind.LessThanToken) ||
      (leftIsLength && indexOnRight && condition.operatorToken.kind === ts.SyntaxKind.GreaterThanToken);

    if (upperBound) {
      return true;
    }
  }

  let bounded = false;
  ts.forEachChild(condition, (child) => {
    if (!bounded && ts.isExpression(child) && conditionBoundsCollection({ condition: child, collectionText, indexName })) {
      bounded = true;
    }
  });
  return bounded;
};

const enclosingForStatement = (node: ts.Node): ts.ForStatement | undefined => {
  if (ts.isForStatement(node)) {
    return node;
  }
  return node.parent ? enclosingForStatement(node.parent) : undefined;
};

const isStructurallyBoundedAccess = (node: ts.ElementAccessExpression): boolean => {
  const loop = enclosingForStatement(node);
  const indexName = loop && declaredLoopIndex(loop);
  return Boolean(
    loop?.condition &&
      indexName &&
      node.argumentExpression &&
      containsIdentifier(node.argumentExpression, indexName) &&
      conditionBoundsCollection({ condition: loop.condition, collectionText: node.expression.getText(), indexName }),
  );
};

const MUTATING_METHODS = new Set([
  "add",
  "clear",
  "copyWithin",
  "delete",
  "fill",
  "pop",
  "push",
  "reverse",
  "set",
  "shift",
  "sort",
  "splice",
  "unshift",
]);

const mutationTarget = (node: ts.Node): ts.Expression | undefined => {
  if (ts.isBinaryExpression(node) && isAssignmentOperator(node.operatorToken.kind)) {
    return node.left;
  }
  if (
    (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
    (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken)
  ) {
    return node.operand;
  }
  if (ts.isDeleteExpression(node)) {
    return node.expression;
  }
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && MUTATING_METHODS.has(node.expression.name.text)) {
    return node.expression.expression;
  }
  return undefined;
};

const isBuilderReduce = (node: ts.CallExpression): boolean => {
  const expression = node.expression;
  const initial = node.arguments[1];
  return (
    ts.isPropertyAccessExpression(expression) &&
    expression.name.text === "reduce" &&
    Boolean(initial && (ts.isArrayLiteralExpression(initial) || ts.isObjectLiteralExpression(initial)))
  );
};

const isNamedPropertyCall = ({
  node,
  owner,
  property,
}: {
  readonly node: ts.CallExpression;
  readonly owner: string;
  readonly property: string;
}): boolean =>
  ts.isPropertyAccessExpression(node.expression) &&
  ts.isIdentifier(node.expression.expression) &&
  node.expression.expression.text === owner &&
  node.expression.name.text === property;

const isEffectRunCall = (node: ts.CallExpression): boolean =>
  ts.isPropertyAccessExpression(node.expression) &&
  ts.isIdentifier(node.expression.expression) &&
  node.expression.expression.text === "Effect" &&
  node.expression.name.text.startsWith("run");

const isNamedPropertyAccess = ({
  node,
  owner,
  property,
}: {
  readonly node: ts.PropertyAccessExpression;
  readonly owner: string;
  readonly property: string;
}): boolean => ts.isIdentifier(node.expression) && node.expression.text === owner && node.name.text === property;

const isConsoleCall = (node: ts.CallExpression): boolean =>
  ts.isPropertyAccessExpression(node.expression) &&
  ts.isIdentifier(node.expression.expression) &&
  node.expression.expression.text === "console";

const moduleSpecifierFor = (node: ts.Node): string | undefined => {
  if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
    return ts.isStringLiteralLike(node.moduleSpecifier) ? node.moduleSpecifier.text : undefined;
  }
  if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments.length === 1) {
    const argument = node.arguments[0];
    return argument && ts.isStringLiteralLike(argument) ? argument.text : undefined;
  }
  return undefined;
};

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

const sourceCandidates = (target: string): ReadonlyArray<string> => {
  if (target.endsWith(".mjs")) {
    return [target, target.replace(/\.mjs$/u, ".mts"), target.replace(/\.mjs$/u, ".ts")];
  }
  if (target.endsWith(".cjs")) {
    return [target, target.replace(/\.cjs$/u, ".cts"), target.replace(/\.cjs$/u, ".ts")];
  }
  if (target.endsWith(".js")) {
    return [target, target.replace(/\.js$/u, ".ts"), target.replace(/\.js$/u, ".tsx")];
  }
  return [target, `${target}.ts`, `${target}.tsx`, `${target}/index.ts`];
};

const resolveSourceImport = ({ repositoryRoot, file, specifier }: SourceImportRequest): string | undefined => {
  const target = resolvedImportPath(file, specifier);
  return target ? sourceCandidates(target).find((candidate) => existsSync(join(repositoryRoot, candidate))) : undefined;
};

const suppressionCommentLines = (sourceFile: ts.SourceFile): ReadonlyArray<number> => {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, sourceFile.languageVariant, sourceFile.text);
  const lines: Array<number> = [];

  // Lexical scanning avoids treating directive-looking string data as comments.
  while (scanner.scan() !== ts.SyntaxKind.EndOfFileToken) {
    const token = scanner.getToken();
    const isComment = token === ts.SyntaxKind.SingleLineCommentTrivia || token === ts.SyntaxKind.MultiLineCommentTrivia;
    if (isComment && SUPPRESSION_PATTERN.test(scanner.getTokenText())) {
      lines.push(sourceFile.getLineAndCharacterOfPosition(scanner.getTokenPos()).line + 1);
    }
  }
  return lines;
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
  return Boolean(featureRoot && (target.startsWith(`${featureRoot}/hooks/`) || target.startsWith(`${featureRoot}/runtime/`)));
};

const authoredStem = (file: string): string =>
  basename(file)
    .replace(/\.(?:tsx?|jsx?|mts|cts|mjs|cjs)$/u, "")
    .replace(/\.(?:test|config|d)$/u, "");

const invalidAuthoredFileName = (file: string): boolean => {
  const stem = authoredStem(file);
  const isComponent = /\.(?:tsx|jsx)$/u.test(file) && /^[A-Z]/u.test(stem);
  const validCase = isComponent ? /^[A-Z][a-zA-Z0-9]*$/u.test(stem) : /^[a-z][a-zA-Z0-9]*$/u.test(stem);
  const hasDottedRole = stem.includes(".");
  const hasRepeatedRole = /(?:Repository|Service|Controller|Manager|Adapter|Handler|Schema){2}$/u.test(stem);
  return !validCase || hasDottedRole || hasRepeatedRole;
};

const isEarnedCapabilityPort = (file: string, node: ts.InterfaceDeclaration): boolean =>
  /^(?:src\/skills\/[^/]+|src\/[^/]+)\/adapters\//u.test(file) &&
  /(?:Port|Gateway)$/u.test(node.name.text) &&
  hasExportModifier(node) &&
  node.members.length >= 2;

const hasNullAndUndefined = (node: ts.UnionTypeNode): boolean => {
  const hasNull = node.types.some(
    (type) => type.kind === ts.SyntaxKind.NullKeyword || (ts.isLiteralTypeNode(type) && type.literal.kind === ts.SyntaxKind.NullKeyword),
  );
  const hasUndefined = node.types.some((type) => type.kind === ts.SyntaxKind.UndefinedKeyword);
  return hasNull && hasUndefined;
};

const isCeremonialTsdoc = (sourceFile: ts.SourceFile, node: ts.Node): boolean => {
  const leading = sourceFile.text.slice(node.getFullStart(), node.getStart(sourceFile));
  const comments = [...leading.matchAll(/\/\*\*([\s\S]*?)\*\//gu)];
  const body = comments.at(-1)?.[1];
  if (!body) {
    return false;
  }

  const normalized = body
    .replace(/^\s*\*\s?/gmu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  const restatesParameter = /@param\s+([a-zA-Z_$][\w$]*)\s+(?:-|is\s+)?(?:the\s+)?\1\b/iu.test(normalized);
  const genericReturn = /@returns?\s+(?:-|is\s+)?(?:the\s+)?(?:result|value)\.?\s*$/iu.test(normalized);
  const genericSummary = /^(?:gets?|sets?|returns?|creates?|runs?)\s+(?:the\s+)?[a-zA-Z_$][\w$]*\.?/iu.test(normalized);
  return restatesParameter || genericReturn || genericSummary;
};

const referenceCounts = (sourceFile: ts.SourceFile): ReadonlyMap<string, number> => {
  const counts = new Map<string, number>();
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) {
      counts.set(node.text, (counts.get(node.text) ?? 0) + 1);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return counts;
};

const expressionFromArrow = (arrow: ts.ArrowFunction): ts.Expression | undefined => {
  if (!ts.isBlock(arrow.body)) {
    return arrow.body;
  }
  const statement = arrow.body.statements[0];
  return arrow.body.statements.length === 1 && statement && ts.isReturnStatement(statement) ? statement.expression : undefined;
};

const isPointlessExtraction = (node: ts.VariableDeclaration, counts: ReadonlyMap<string, number>): boolean => {
  if (!ts.isIdentifier(node.name) || !node.initializer || !ts.isArrowFunction(node.initializer)) {
    return false;
  }
  const variableStatement = node.parent.parent;
  if (ts.isVariableStatement(variableStatement) && hasExportModifier(variableStatement)) {
    return false;
  }
  if ((counts.get(node.name.text) ?? 0) !== 2) {
    return false;
  }
  const expression = expressionFromArrow(node.initializer);
  return Boolean(expression && (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)));
};

const collectEffectFlatMaps = (node: ts.Node): ReadonlyArray<ts.CallExpression> => {
  const calls: Array<ts.CallExpression> = [];
  const visit = (candidate: ts.Node): void => {
    if (candidate !== node && ts.isFunctionLike(candidate)) {
      return;
    }
    if (ts.isCallExpression(candidate) && isNamedPropertyCall({ node: candidate, owner: "Effect", property: "flatMap" })) {
      calls.push(candidate);
    }
    ts.forEachChild(candidate, visit);
  };
  visit(node);
  return calls;
};

const statementContainsYield = (statement: ts.Statement): boolean => {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (ts.isYieldExpression(node)) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(statement);
  return found;
};

const pipelineHasContract = ({
  sourceFile,
  call,
  generator,
}: {
  readonly sourceFile: ts.SourceFile;
  readonly call: ts.CallExpression;
  readonly generator: ts.FunctionExpression;
}): boolean => {
  const phases = generator.body.statements.filter(statementContainsYield);
  if (phases.length < 3) {
    return true;
  }

  const owner = nearestStatement(call);
  if (!immediateLeadingComment(sourceFile, owner)) {
    return false;
  }
  return phases.every((phase, index) => {
    const comment = immediateLeadingComment(sourceFile, phase);
    return Boolean(comment && new RegExp(`(?:^|\\s)${index + 1}\\.`, "u").test(comment));
  });
};

const importedScriptOwnerBindings = (sourceFile: ts.SourceFile, file: string): ReadonlySet<string> => {
  const bindings = new Set<string>();
  sourceFile.statements.forEach((statement) => {
    if (!ts.isImportDeclaration(statement)) {
      return;
    }
    const specifier = moduleSpecifierFor(statement);
    if (!specifier || !resolvedImportPath(file, specifier)?.startsWith("src/")) {
      return;
    }
    const clause = statement.importClause;
    if (clause?.name) {
      bindings.add(clause.name.text);
    }
    const namedBindings = clause?.namedBindings;
    if (namedBindings && ts.isNamespaceImport(namedBindings)) {
      bindings.add(namedBindings.name.text);
    }
    if (namedBindings && ts.isNamedImports(namedBindings)) {
      namedBindings.elements.forEach((element) => {
        bindings.add(element.name.text);
      });
    }
  });
  return bindings;
};

const delegatesToImportedOwner = (root: ts.Node, bindings: ReadonlySet<string>): boolean => {
  let delegates = false;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const expression = node.expression;
      if (
        (ts.isIdentifier(expression) && bindings.has(expression.text)) ||
        (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression) && bindings.has(expression.expression.text))
      ) {
        delegates = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return delegates;
};

const inspectSourceFile = ({
  repositoryRoot,
  file,
  protectedState,
  rulesById,
  program,
  typeChecker,
}: SourceInspectionRequest): ReadonlyArray<CodeStyleViolation> => {
  if (protectedState?.state === "protected-committed") {
    return [];
  }

  const sourceFile = program.getSourceFile(join(repositoryRoot, file));
  if (!sourceFile) {
    return failConfiguration(`could not parse ${file}`);
  }
  const sourceText = sourceFile.text;
  const violations: Array<CodeStyleViolation> = [];
  const counts = referenceCounts(sourceFile);

  const addViolation = ({ ruleId, channel, sourceFile: source, node, message }: ViolationInput): void => {
    if (!ruleUses({ rulesById, ruleId, channel })) {
      return;
    }
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    violations.push({ ruleId, file, line, message });
  };

  const addLineViolation = ({ ruleId, channel, line, message }: LineViolationInput): void => {
    if (ruleUses({ rulesById, ruleId, channel })) {
      violations.push({ ruleId, file, line, message });
    }
  };

  if (!protectedState) {
    if (GENERIC_FILE_PATTERN.test(basename(file))) {
      addLineViolation({
        ruleId: "path.no-generic-bucket",
        channel: "path",
        line: 1,
        message: "Name the file after its domain job.",
      });
    }
    const authoredDirectories = file.split("/").slice(1, -1);
    const hasInvalidDirectory = authoredDirectories.some((directory) => !/^[a-z][a-zA-Z0-9]*$/u.test(directory));
    if (invalidAuthoredFileName(file) || hasInvalidDirectory) {
      addLineViolation({
        ruleId: "path.authored-file-name",
        channel: "path",
        line: 1,
        message: "Use camelCase or PascalCase without a repeated role suffix.",
      });
    }
    if (/^src\/(?:core|commands|payload)(?:\/|$)/u.test(file)) {
      addLineViolation({
        ruleId: "path.capability-layout",
        channel: "path",
        line: 1,
        message: "Move this source into the capability that owns it.",
      });
    }
  }

  const inspectStatementSpacing = (node: ts.Node): void => {
    if (ts.isSourceFile(node) || ts.isBlock(node)) {
      node.statements.forEach((statement, index) => {
        const previous = index > 0 ? node.statements.at(index - 1) : undefined;
        if (previous && isFunctionStatement(previous) && isFunctionStatement(statement)) {
          const gap = sourceText.slice(previous.end, statement.getStart(sourceFile));
          if ((gap.match(/\r?\n/gu) ?? []).length < 2) {
            addViolation({
              ruleId: "function.blank-line",
              channel: "ast",
              sourceFile,
              node: statement,
              message: "Separate adjacent function declarations with one blank line.",
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
        channel: "importGraph",
        sourceFile,
        node,
        message: "Hook graphs may import only node modules and their dependency-free runtime island.",
      });
    }
    if (moduleSpecifier && isApplicationFile(file)) {
      const target = resolvedImportPath(file, moduleSpecifier);
      if (target && isHookRuntimeFile(target)) {
        addViolation({
          ruleId: "import.application-boundary",
          channel: "importGraph",
          sourceFile,
          node,
          message: "Application modules cannot import installed hook runtime code.",
        });
      }
    }
    if (moduleSpecifier && file.startsWith("src/") && resolvedImportPath(file, moduleSpecifier)?.startsWith("scripts/")) {
      addViolation({
        ruleId: "import.application-no-scripts",
        channel: "importGraph",
        sourceFile,
        node,
        message: "Authored source cannot import root script entrypoints.",
      });
    }
    if (moduleSpecifier && PROVIDER_SDK_PATTERN.test(moduleSpecifier) && !/\/adapters\//u.test(file)) {
      addViolation({
        ruleId: "adapter.external-sdk-confinement",
        channel: "importGraph",
        sourceFile,
        node,
        message: "Import provider SDKs only from an earned feature-owned adapter.",
      });
    }

    const generatorFunction = isGeneratorFunction(node);
    const forbiddenFunctionForm =
      !generatorFunction && (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isFunctionExpression(node));
    if (forbiddenFunctionForm) {
      addViolation({
        ruleId: "function.arrow-only",
        channel: "ast",
        sourceFile,
        node,
        message: "Use an arrow constant declared before use.",
      });
    }
    if (generatorFunction) {
      const allowed = ts.isFunctionExpression(node) && !node.name && isEffectGenCall(node);
      if (!allowed) {
        addViolation({
          ruleId: "function.effect-generator",
          channel: "ast",
          sourceFile,
          node,
          message: "Only an anonymous generator directly passed to Effect.gen is allowed.",
        });
      }
    }
    if (isExecutableFunction(node) && hasInvalidInputShape(node)) {
      addViolation({
        ruleId: "function.input-shape",
        channel: "ast",
        sourceFile,
        node,
        message: "Use at most two positional inputs and no positional boolean behavior flag.",
      });
    }
    if (ts.isVariableDeclaration(node) && isPointlessExtraction(node, counts)) {
      addViolation({
        ruleId: "function.no-pointless-extraction",
        channel: "ast",
        sourceFile,
        node,
        message: "Inline this private one-use property accessor until it owns a real concept.",
      });
    }
    if ((ts.isClassDeclaration(node) || ts.isClassExpression(node)) && !isSchemaTaggedErrorClass(node)) {
      addViolation({
        ruleId: "class.tagged-error-only",
        channel: "ast",
        sourceFile,
        node,
        message: "Classes are allowed only when they directly extend Schema.TaggedError.",
      });
    }
    if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node)) {
      addViolation({
        ruleId: "type.no-assertion",
        channel: "ast",
        sourceFile,
        node,
        message: "Decode or narrow the value instead of asserting its type or presence.",
      });
    }
    if (
      ts.isElementAccessExpression(node) &&
      node.argumentExpression &&
      !ts.isStringLiteralLike(node.argumentExpression) &&
      !ts.isNumericLiteral(node.argumentExpression) &&
      !isAssignmentTarget(node) &&
      !isStructurallyBoundedAccess(node) &&
      !immediateLeadingComment(sourceFile, nearestStatement(node))
    ) {
      addViolation({
        ruleId: "comment.index-proof",
        channel: "ast",
        sourceFile,
        node,
        message: "Place a safety proof immediately above this non-literal indexed access.",
      });
    }
    if (isExplicitLoop(node) && loopNeedsIntent(node) && !immediateLeadingComment(sourceFile, node)) {
      addViolation({
        ruleId: "comment.loop-intent",
        channel: "ast",
        sourceFile,
        node,
        message: "Explain the non-obvious loop invariant or ordering immediately above it.",
      });
    }
    if (ts.isInterfaceDeclaration(node) && !/\.d\.(?:c|m)?ts$/u.test(file) && !isEarnedCapabilityPort(file, node)) {
      addViolation({
        ruleId: "type.interface-cases",
        channel: "ast",
        sourceFile,
        node,
        message: "Interfaces are limited to declaration augmentation and earned feature-owned external ports.",
      });
    }
    if (ts.isEnumDeclaration(node)) {
      addViolation({
        ruleId: "type.no-enum",
        channel: "ast",
        sourceFile,
        node,
        message: "Use Schema literals and their derived union instead of an enum.",
      });
    }
    if (ts.isConditionalTypeNode(node)) {
      addViolation({
        ruleId: "type.no-conditional",
        channel: "ast",
        sourceFile,
        node,
        message: "Derive the type directly from its schema instead of conditional or infer machinery.",
      });
    }
    if (isControlNode(node) && nestingDepth(node) > 2) {
      addViolation({
        ruleId: "function.nesting",
        channel: "ast",
        sourceFile,
        node,
        message: "Use a guard clause or extract a cohesive operation before a third nesting level.",
      });
    }
    if (ts.isTypeAliasDeclaration(node) && hasExportModifier(node) && ts.isTypeLiteralNode(node.type) && isApplicationFile(file)) {
      addViolation({
        ruleId: "type.schema-owned-runtime",
        channel: "ast",
        sourceFile,
        node,
        message: "Exported runtime object types must derive from an Effect Schema.",
      });
    }
    if (ts.isUnionTypeNode(node) && hasNullAndUndefined(node)) {
      addViolation({
        ruleId: "type.absence-boundary",
        channel: "ast",
        sourceFile,
        node,
        message: "Do not expose null and undefined for the same value.",
      });
    }
    if ((ts.isExportAssignment(node) || hasDefaultModifier(node)) && !file.endsWith(".config.ts") && !file.endsWith(".config.js")) {
      addViolation({
        ruleId: "export.named-only",
        channel: "ast",
        sourceFile,
        node,
        message: "Use a named export unless this file is a framework-required boundary.",
      });
    }
    if (ts.isExportDeclaration(node)) {
      const isExportStar = !node.exportClause;
      const isInternalIndex = /(?:^|\/)index\.[cm]?[jt]sx?$/u.test(file) && file !== "src/index.ts";
      if (isExportStar || isInternalIndex) {
        addViolation({
          ruleId: "export.no-internal-barrel",
          channel: "ast",
          sourceFile,
          node,
          message: "Import internal owners directly; export star and internal barrels are forbidden.",
        });
      }
    }
    if (ts.isIdentifier(node) && VAGUE_NAME_PATTERN.test(node.text)) {
      addViolation({
        ruleId: "name.domain-specific",
        channel: "ast",
        sourceFile,
        node,
        message: "Use a name that states the domain job instead of a vague role.",
      });
    }
    const target = mutationTarget(node);
    if (target) {
      const root = assignedRootIdentifier(target);
      if (root && identifierBindsParameter(typeChecker, root)) {
        addViolation({
          ruleId: "mutation.no-input",
          channel: "ast",
          sourceFile,
          node,
          message: "Create a new value instead of mutating a function input.",
        });
      }
    }
    if (ts.isCallExpression(node) && isBuilderReduce(node)) {
      addViolation({
        ruleId: "collection.no-builder-reduce",
        channel: "ast",
        sourceFile,
        node,
        message: "Use a direct transform, Object.fromEntries, or a clear local loop.",
      });
    }
    if (ts.isFunctionLike(node)) {
      const flatMaps = collectEffectFlatMaps(node);
      const secondFlatMap = flatMaps[1];
      if (secondFlatMap) {
        addViolation({
          ruleId: "effect.composition-depth",
          channel: "ast",
          sourceFile,
          node: secondFlatMap,
          message: "Use Effect.gen for two or more dependent handoffs.",
        });
      }
    }
    if (ts.isCallExpression(node) && isApplicationFile(file)) {
      if (isNamedPropertyCall({ node, owner: "Promise", property: "all" })) {
        addViolation({
          ruleId: "effect.no-promise-all",
          channel: "ast",
          sourceFile,
          node,
          message: "Use Effect collection operators with explicit concurrency policy.",
        });
      }
      if (file !== "src/cli/main.ts" && isEffectRunCall(node)) {
        addViolation({
          ruleId: "effect.runtime-edge",
          channel: "ast",
          sourceFile,
          node,
          message: "Run the main Effect only at src/cli/main.ts.",
        });
      }
      if (isConsoleCall(node)) {
        addViolation({
          ruleId: "presentation.terminal-ui",
          channel: "ast",
          sourceFile,
          node,
          message: "Route application presentation through TerminalUI.",
        });
      }
    }
    if (
      file.startsWith("src/") &&
      file !== "src/cli/main.ts" &&
      ts.isCallExpression(node) &&
      isNamedPropertyCall({ node, owner: "NodeRuntime", property: "runMain" })
    ) {
      addViolation({
        ruleId: "effect.runtime-edge",
        channel: "ast",
        sourceFile,
        node,
        message: "Run and provide the main Effect only at src/cli/main.ts.",
      });
    }
    if (
      file.startsWith("src/") &&
      file !== "src/cli/main.ts" &&
      ts.isPropertyAccessExpression(node) &&
      isNamedPropertyAccess({ node, owner: "NodeContext", property: "layer" })
    ) {
      addViolation({
        ruleId: "effect.runtime-edge",
        channel: "ast",
        sourceFile,
        node,
        message: "Run and provide the main Effect only at src/cli/main.ts.",
      });
    }
    if (ts.isCallExpression(node) && isNamedPropertyCall({ node, owner: "Effect", property: "gen" })) {
      const generator = node.arguments[0];
      if (generator && ts.isFunctionExpression(generator) && !pipelineHasContract({ sourceFile, call: node, generator })) {
        addViolation({
          ruleId: "comment.pipeline-contract",
          channel: "ast",
          sourceFile,
          node,
          message: "Document the ordered pipeline contract and number each dependent phase.",
        });
      }
    }
    if (
      (ts.isVariableStatement(node) || ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isTypeAliasDeclaration(node)) &&
      hasExportModifier(node) &&
      isCeremonialTsdoc(sourceFile, node)
    ) {
      addViolation({
        ruleId: "documentation.signal-tsdoc",
        channel: "ast",
        sourceFile,
        node,
        message: "Remove TSDoc that merely restates the name, inputs, or return value.",
      });
    }

    ts.forEachChild(node, visit);
  };

  suppressionCommentLines(sourceFile).forEach((line) => {
    addLineViolation({
      ruleId: "type.no-suppression",
      channel: "regex",
      line,
      message: "Remove the suppression and fix the boundary.",
    });
  });

  if (file.startsWith("scripts/")) {
    const rootFunctions = sourceFile.statements.flatMap((statement) =>
      ts.isVariableStatement(statement)
        ? statement.declarationList.declarations.filter((declaration) =>
            Boolean(declaration.initializer && ts.isArrowFunction(declaration.initializer)),
          )
        : [],
    );
    const ownsSubstantiveDeclaration = sourceFile.statements.some(
      (statement) =>
        ts.isTypeAliasDeclaration(statement) ||
        ts.isInterfaceDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        hasExportModifier(statement),
    );
    const ownsToolEngine = sourceFile.statements.some((statement) => {
      const specifier = moduleSpecifierFor(statement);
      return specifier === "typescript" || specifier === "glob" || specifier === "node:fs";
    });
    const ownerBindings = importedScriptOwnerBindings(sourceFile, file);
    const delegates = delegatesToImportedOwner(sourceFile, ownerBindings);
    const ownsLargeLocalArrow = rootFunctions.some(
      (declaration) =>
        declaration.initializer &&
        ts.isArrowFunction(declaration.initializer) &&
        ts.isBlock(declaration.initializer.body) &&
        declaration.initializer.body.statements.length > 4 &&
        !delegatesToImportedOwner(declaration.initializer, ownerBindings),
    );
    if (ownsSubstantiveDeclaration || ownsToolEngine || ownsLargeLocalArrow || rootFunctions.length > 4 || !delegates) {
      addLineViolation({
        ruleId: "script.thin-entrypoint",
        channel: "ast",
        line: 1,
        message: "Move substantive script logic to a co-located owner under src and keep this entrypoint thin.",
      });
    }
  }

  inspectStatementSpacing(sourceFile);
  visit(sourceFile);
  return violations;
};

const importEdges = ({ repositoryRoot, files, program }: ImportEdgeRequest): ReadonlyArray<ImportEdge> =>
  files.flatMap((file) => {
    const sourceFile = program.getSourceFile(join(repositoryRoot, file));
    if (!sourceFile) {
      return [];
    }
    return sourceFile.statements.flatMap((statement): ReadonlyArray<ImportEdge> => {
      const specifier = moduleSpecifierFor(statement);
      const target = specifier ? resolveSourceImport({ repositoryRoot, file, specifier }) : undefined;
      if (!target || !files.includes(target)) {
        return [];
      }
      return [
        {
          from: file,
          to: target,
          line: sourceFile.getLineAndCharacterOfPosition(statement.getStart(sourceFile)).line + 1,
        },
      ];
    });
  });

const inspectImportCycles = (
  edges: ReadonlyArray<ImportEdge>,
  rulesById: ReadonlyMap<string, MachineRule>,
): ReadonlyArray<CodeStyleViolation> => {
  if (!ruleUses({ rulesById, ruleId: "architecture.no-cycle", channel: "importGraph" })) {
    return [];
  }

  const outgoing = new Map<string, ReadonlyArray<ImportEdge>>();
  edges.forEach((edge) => {
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge]);
  });
  const violations: Array<CodeStyleViolation> = [];
  const seenCycles = new Set<string>();

  const visit = (file: string, path: ReadonlyArray<string>): void => {
    (outgoing.get(file) ?? []).forEach((edge) => {
      const cycleStart = path.indexOf(edge.to);
      if (cycleStart >= 0) {
        const cycle = [...path.slice(cycleStart), edge.to];
        const key = [...new Set(cycle)].sort().join("|");
        if (!seenCycles.has(key)) {
          seenCycles.add(key);
          violations.push({
            ruleId: "architecture.no-cycle",
            file: edge.from,
            line: edge.line,
            message: `Break the internal import cycle: ${cycle.join(" -> ")}.`,
          });
        }
        return;
      }
      visit(edge.to, [...path, edge.to]);
    });
  };

  [...outgoing.keys()].sort().forEach((file) => {
    visit(file, [file]);
  });
  return violations;
};

const compareViolations = (left: CodeStyleViolation, right: CodeStyleViolation): number =>
  left.file.localeCompare(right.file) || left.line - right.line || left.ruleId.localeCompare(right.ruleId);

const applyOverlayExceptions = (
  violations: ReadonlyArray<CodeStyleViolation>,
  exceptions: ReadonlyArray<ExceptionConfiguration>,
): ReadonlyArray<CodeStyleViolation> => {
  exceptions.forEach((exception) => {
    const actual = violations.filter((violation) => violation.file === exception.path && violation.ruleId === exception.ruleId).length;
    if (actual !== exception.maxViolations) {
      failConfiguration(`overlay exception ${exception.ruleId} requires exactly ${exception.maxViolations} violations, found ${actual}`);
    }
  });

  return violations.filter(
    (violation) => !exceptions.some((exception) => exception.path === violation.file && exception.ruleId === violation.ruleId),
  );
};

export const checkCodeStyle = (repositoryRoot: string): CodeStyleReport => {
  const contract = parseContract(repositoryRoot);
  const protectedStates = selectProtectedStates(repositoryRoot, contract.configuration.protectedPaths);
  const protectedStateByPath = new Map(protectedStates.map((entry) => [entry.path, entry]));
  const files = relativeSourceFiles(repositoryRoot);
  const program = ts.createProgram({
    rootNames: files.map((file) => join(repositoryRoot, file)),
    options: {
      allowJs: true,
      checkJs: false,
      jsx: ts.JsxEmit.Preserve,
      noLib: true,
      noResolve: true,
      target: ts.ScriptTarget.Latest,
    },
  });
  const typeChecker = program.getTypeChecker();
  const rawViolations = [
    ...files.flatMap((file) =>
      inspectSourceFile({
        repositoryRoot,
        file,
        protectedState: protectedStateByPath.get(file),
        rulesById: contract.rulesById,
        program,
        typeChecker,
      }),
    ),
    ...inspectImportCycles(importEdges({ repositoryRoot, files, program }), contract.rulesById),
  ];
  const overlayActive = protectedStates.every((entry) => entry.state === "protected-overlay");
  const violations = overlayActive ? applyOverlayExceptions(rawViolations, contract.configuration.exceptions) : rawViolations;

  return {
    violations: [...violations].sort(compareViolations),
    protectedStates,
    manualReviewRuleIds: contract.manualReviewRuleIds,
  };
};
