# Style Catalog — the pick-the-code gallery

The comprehensive checklist of code-style dimensions the grill covers, grouped into rounds. Run it as a **pick-the-code** gallery: for each dimension, show code variants in the TUI (`AskUserQuestion`, one option per variant, code in the `preview`) and let me **pick**. This is the surface where "what the agent writes" surprises you — cover it, so we don't discover the surprise at PR review.

The list below is a **floor, not a ceiling** — for the average codebase it's roughly complete; add any dimension a specific project needs that isn't here.

---

## Language-conditional sections

Sections tagged `<!-- if: typescript -->` … `<!-- endif -->` (or any language) apply only when the detected/chosen language matches. The agent **skips** irrelevant conditional sections silently — never fabricates alternatives for languages they don't apply to.

When a dimension is language-specific, a note like `[TS/JS only]` appears in the bullet. Universal dimensions have no tag.

---

## How to run it

### Existing codebase (grill-me-code-style-with-docs)

- **Grouped rounds, checkpoints between.** Walk the areas in order. Within a round, ask each dimension as its own TUI question. After each round, checkpoint: **keep going · go deeper here · skip the rest**. Scale to the stack — skip a whole round when it doesn't apply (no UI → skip Frontend; no HTTP surface → trim API/IO).
- **Variants are the repo's REAL code.** Variant **A** is the actual incumbent, pulled **verbatim** from the scan with a `file:symbol` cite — warts and all, so you're reacting to *your* code, not a textbook. Variant **B** is the de-slopped rewrite. Two variants by default; add a third only when there's a genuine spectrum (e.g. throw / Result / neverthrow).
- **Uncontested → keep/kill, not a fake choice.** If the repo already settles a dimension one way and it isn't slop, show the single incumbent and ask **keep or kill** — never fabricate an alternative just to fill the slot. (An uncontested dimension is still shown — that's how you stay un-surprised.)

### Greenfield (grill-me-code-style)

- **Grouped rounds, checkpoints between.** Same structure as above.
- **Variants are illustrative, grounded in purpose.** With no code to cite, variant **A** is the common/default idiom for this language + framework (the one the agent would reach for), variant **B** is the alternative worth considering. Two variants by default; add a third only when there's a genuine spectrum. Make the snippets concrete to THIS project's domain — not `foo`/`bar`.
- **Recommend, then let me pick.** Derive a recommended variant from the purpose + framework and mark it, but the pick is mine.

### Both variants

- **Every pick is recorded.** Chosen variant → the `✓` example on a `CODE-STYLE.md` rule; rejected variant → the `✗ not this` line. A rejected variant that's *actual slop* also becomes a concrete `## Never` entry (with a real `file:symbol` offender for existing repos). Tag each rule `[lint: <rule>]` (a linter catches it) or `[taste]`.
- **Compose at the end.** After the rounds, assemble every pick into one **canonical example** — a real feature slice (existing) or representative feature (greenfield) written in the agreed style — and land it as the `## Canonical example` block in `CODE-STYLE.md` (see [CODE-STYLE-FORMAT.md](CODE-STYLE-FORMAT.md)). It's the litmus you show in the plan before approval.

---

## Round 1 — Language idioms

- **Function form** — arrow vs declaration; when each is used.
  <!-- if: typescript, javascript -->
  - Arrow for inline/callbacks, declaration for top-level named fns? Or arrows everywhere?
  <!-- endif -->
  <!-- if: python -->
  - `def` vs `lambda`; when a lambda earns its place vs a named function.
  <!-- endif -->
  <!-- if: rust -->
  - Closure style; `fn` naming; when to use `impl Fn` vs concrete types.
  <!-- endif -->

- **Async style** — the project's async idiom.
  <!-- if: typescript, javascript -->
  - `async/await` vs `.then()`; where `await` lands; parallel (`Promise.all` / `Promise.allSettled`) vs sequential.
  <!-- endif -->
  <!-- if: python -->
  - `asyncio` / `async def` vs sync; when to go async.
  <!-- endif -->
  <!-- if: rust -->
  - `tokio` / `async-std`; `.await` placement; `spawn` vs sequential.
  <!-- endif -->
  <!-- if: go -->
  - Goroutines + channels vs sync; `errgroup` patterns.
  <!-- endif -->

- **Returns & guards** — early-return / guard clauses vs single-return.

- **Null & optionality** — how the language handles absence.
  <!-- if: typescript, javascript -->
  - `null` vs `undefined`; `?.` / `??` vs explicit guards.
  <!-- endif -->
  <!-- if: rust -->
  - `Option<T>` patterns; when to `.unwrap()` vs propagate with `?`.
  <!-- endif -->
  <!-- if: python -->
  - `None` handling; `Optional[T]` annotations; sentinel values.
  <!-- endif -->
  <!-- if: go -->
  - Zero values vs pointer-to-indicate-absence; error as the nil signal.
  <!-- endif -->
  <!-- if: swift -->
  - Optionals; forced unwrap policy; `guard let` vs `if let`.
  <!-- endif -->

- **Immutability** — mutability defaults.
  <!-- if: typescript, javascript -->
  - `const` / `readonly`; spread vs mutate; `Object.freeze` policy.
  <!-- endif -->
  <!-- if: rust -->
  - Default immutable; when `mut` is acceptable; `Clone` vs borrow.
  <!-- endif -->
  <!-- if: python -->
  - Frozen dataclasses; tuple vs list for fixed data; `@property` vs public attrs.
  <!-- endif -->

- **Control flow** — nesting-depth cap; ternary policy; branching idioms.
  <!-- if: typescript, javascript, python -->
  - Nested / duplicated ternaries — banned or capped.
  - `switch` vs lookup map vs `if/else` chains.
  <!-- endif -->
  <!-- if: rust -->
  - `match` exhaustiveness; when `if let` beats `match`; nesting depth.
  <!-- endif -->
  <!-- if: go -->
  - `switch` vs `if/else`; early returns to flatten.
  <!-- endif -->

- **Collection ops** — iteration style.
  <!-- if: typescript, javascript -->
  - `map`/`filter`/`reduce` vs `for` loops; when a loop wins.
  <!-- endif -->
  <!-- if: rust -->
  - Iterator combinators vs `for` loops; `.collect()` placement.
  <!-- endif -->
  <!-- if: python -->
  - Comprehensions vs `map`/`filter`; generator expressions; when a loop wins.
  <!-- endif -->

- **Naming — "reads like prose"** — [Locked] every name is a word in the sentence the code is telling. If you read the function aloud and it sounds like gibberish, the names are wrong. Variables describe what they hold, functions describe what they do, booleans read as questions (`isComplete`, `hasPermission`), and the data flows like a narrative from input → transform → output. This is non-negotiable; the grill demonstrates it but never offers an alternative.

  <details><summary>Exemplar gallery (read each aloud)</summary>

  **Pure core**

  ```typescript
  export const scorePoseFrame = (
    measuredAngles: ReadonlyArray<JointAngle>,
    catalogTargets: ReadonlyArray<CatalogTarget>
  ): Effect.Effect<number, NoMatchingJoints> => {
    const matchedScores = catalogTargets.flatMap((targetPose) => {
      const userAngle = measuredAngles.find(
        (angle) => angle.jointId === targetPose.jointId
      )
      if (!userAngle) return []

      const deviationFromTarget = Math.abs(userAngle.degrees - targetPose.targetDegrees)
      const normalizedScore = Math.max(0, 1 - deviationFromTarget / targetPose.toleranceDegrees)
      return [normalizedScore]
    })

    if (matchedScores.length === 0) return Effect.fail(NoMatchingJoints)

    const averageAccuracy = matchedScores.reduce((total, score) => total + score, 0) / matchedScores.length
    return Effect.succeed(Math.min(1, Math.max(0, averageAccuracy)))
  }
  ```

  > Read aloud: "For each target pose, find the user angle where the angle's joint matches the target's joint. The deviation from target is the absolute difference. The normalized score is 1 minus deviation over tolerance."

  ---

  **Hook**

  ```typescript
  export const useSessionsForMood = (allSessions: ReadonlyArray<Session>, selectedMood: Mood) => {
    const sessionsMatchingMood = useMemo(
      () => allSessions.filter((session) => session.mood === selectedMood),
      [allSessions, selectedMood]
    )

    const hasCompletedSessions = sessionsMatchingMood.length > 0
    const mostRecentSession = sessionsMatchingMood.at(0)
    const totalDurationMinutes = sessionsMatchingMood.reduce(
      (total, session) => total + session.durationMs / 60_000, 0
    )

    return { sessionsMatchingMood, hasCompletedSessions, mostRecentSession, totalDurationMinutes }
  }
  ```

  > Read aloud: "Use sessions for mood. Filter all sessions where session mood equals selected mood. Has completed sessions if length > 0. Most recent session is the first one."

  ---

  **Util**

  ```typescript
  export const isSessionCompletedToday = (session: Session, currentDate: Date): boolean => {
    const sessionDate = new Date(session.completedAt)
    const isSameYear = sessionDate.getFullYear() === currentDate.getFullYear()
    const isSameMonth = sessionDate.getMonth() === currentDate.getMonth()
    const isSameDay = sessionDate.getDate() === currentDate.getDate()
    return isSameYear && isSameMonth && isSameDay
  }

  export const buildWeeklyProgressChart = (
    sessionsThisWeek: ReadonlyArray<Session>,
    daysInWeek: ReadonlyArray<string>
  ): ChartPayload => {
    const minutesPerDay = daysInWeek.map((dayLabel) => {
      const sessionsOnDay = sessionsThisWeek.filter(
        (session) => formatDayLabel(session.completedAt) === dayLabel
      )
      const totalMinutesOnDay = sessionsOnDay.reduce(
        (total, session) => total + session.durationMs / 60_000, 0
      )
      return totalMinutesOnDay
    })

    return { labels: daysInWeek, data: minutesPerDay, yAxisSuffix: 'min' }
  }
  ```

  > Read aloud: "Is session completed today? Session date. Is same year, is same month, is same day. Return is-same-year AND is-same-month AND is-same-day."

  ---

  **Lambda handler**

  ```typescript
  export const handleAppendSession = (authenticatedRequest: http.AuthedRequest) =>
    pipe(
      http.parseBody(authenticatedRequest, AppendSessionBody),
      Effect.flatMap((validatedBody) => {
        const frameAngles = validatedBody.frames.map((frame) => ({
          jointId: frame.jointId,
          degrees: frame.degrees
        }))
        return pipe(
          scorePoseFrame(frameAngles, catalogTargetsForFlow(validatedBody.flowId)),
          Effect.orElseSucceed(() => 0),
          Effect.map((computedAccuracy) => ({
            userId: authenticatedRequest.cognitoSub,
            sessionId: validatedBody.sessionId,
            flowId: validatedBody.flowId,
            durationMs: validatedBody.durationMs,
            accuracy: computedAccuracy,
            completedAt: Date.now()
          }))
        )
      }),
      Effect.flatMap((sessionRecord) =>
        db.put({
          table: 'Sessions',
          item: {
            pk: `USER#${sessionRecord.userId}`,
            sk: `SESSION#${sessionRecord.sessionId}`,
            ...sessionRecord
          }
        })
      ),
      Effect.map(() => http.json(201, { status: 'created' })),
      Effect.catchTag('ParseError', (parseError) =>
        Effect.succeed(http.json(400, { error: parseError.message }))
      ),
      Effect.catchTag('DbError', (databaseError) =>
        Effect.succeed(http.json(500, { error: databaseError.message }))
      )
    )
  ```

  > Read aloud: "Handle append session. Parse body from authenticated request. Map frames to frame angles. Score pose frame with frame angles and catalog targets for flow. The computed accuracy becomes part of the session record. Put the session record in the Sessions table. Catch parse error → 400. Catch database error → 500."

  ---

  **Component**

  ```typescript
  const PoseSessionScreen = () => {
    const { currentFlow, catalogTargets } = useSessionContext()

    const [currentAccuracy, setCurrentAccuracy] = useState(0)
    const [secondsHeld, setSecondsHeld] = useState(0)

    const holdTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

    const { latestFrame, isDetecting } = usePoseDetection()

    const holdIsComplete = secondsHeld >= (currentFlow?.holdDuration ?? 30)
    const accuracyAsPercent = Math.round(currentAccuracy * 100)
    const holdProgressLabel = `${secondsHeld}s / ${currentFlow?.holdDuration ?? 30}s`

    const handlePoseCompleted = useCallback(() => { /* navigate */ }, [])

    useEffect(() => {
      if (!isDetecting) return
      holdTimerRef.current = setInterval(() => setSecondsHeld((prev) => prev + 1), 1000)
      return () => { if (holdTimerRef.current) clearInterval(holdTimerRef.current) }
    }, [isDetecting])

    if (!currentFlow) return <EmptyState title="No flow selected" icon="fitness-outline" />

    return (
      <View style={styles.container}>
        <Text style={styles.accuracy}>{accuracyAsPercent}%</Text>
        <Text style={styles.timer}>{holdProgressLabel}</Text>
        {holdIsComplete && (
          <Button label="Complete Pose" onPress={handlePoseCompleted} variant="primary" />
        )}
      </View>
    )
  }
  ```

  > Read aloud: "Current accuracy. Seconds held. Hold is complete when seconds held >= current flow hold duration. Accuracy as percent. Hold progress label. If hold is complete, show button 'Complete Pose' on press handle pose completed."

  </details>

  **The rule distilled:** Every name is a word in a sentence the code is telling. If you read the function aloud and it sounds like gibberish, the names are wrong. Variables describe what they hold, functions describe what they do, booleans read as questions (`isComplete`, `hasPermission`), and the data flows like a narrative from input → transform → output.

---

## Round 2 — Data, types & errors

- **Error shape** — how errors propagate.
  <!-- if: typescript, javascript -->
  - `throw` vs `Result`/`Either` (e.g. neverthrow); error types; where boundaries catch.
  <!-- endif -->
  <!-- if: rust -->
  - `Result<T, E>` vs `anyhow`/`thiserror`; when to `panic!`; error conversion with `?` and `From`.
  <!-- endif -->
  <!-- if: go -->
  - Error wrapping (`fmt.Errorf %w`); sentinel errors vs typed; `errors.Is` / `errors.As`.
  <!-- endif -->
  <!-- if: python -->
  - Exception hierarchy; when to catch vs propagate; custom exception classes.
  <!-- endif -->

- **Types & contracts** — the type system's role.
  <!-- if: typescript -->
  - `type` vs `interface`; inference vs explicit annotation; `unknown` vs `any` ban.
  <!-- endif -->
  <!-- if: python -->
  - Type hints (`typing` module); `TypedDict` vs dataclass vs Pydantic; runtime checking.
  <!-- endif -->
  <!-- if: rust -->
  - Trait bounds; generics vs `dyn`; `impl Trait` in return position.
  <!-- endif -->

- **Contracts & schemas** — where shared contracts live; parse-don't-validate at boundaries.
  <!-- if: typescript, javascript -->
  - zod / valibot / io-ts; where schemas live relative to the domain.
  <!-- endif -->
  <!-- if: python -->
  - Pydantic models / attrs / dataclasses; validation at boundaries.
  <!-- endif -->

- **Data modeling** — how domain state is shaped.
  <!-- if: typescript -->
  - Discriminated unions vs boolean flags; branded / opaque IDs.
  <!-- endif -->
  <!-- if: rust -->
  - Enums with data; newtype pattern; `From` / `Into` conversions.
  <!-- endif -->
  <!-- if: python -->
  - Dataclasses vs NamedTuple vs Pydantic; `Literal` types; `Enum` usage.
  <!-- endif -->

- **Serialization / DTOs** — domain model vs wire shape; where the mapping lives.

---

## Round 3 — Modules & boundaries

- **Exports** — module surface area.
  <!-- if: typescript, javascript -->
  - Named vs default export; barrel files (`index.ts`) yes/no.
  <!-- endif -->
  <!-- if: python -->
  - `__all__`; `__init__.py` re-exports; public vs `_private` naming.
  <!-- endif -->
  <!-- if: rust -->
  - `pub` granularity; `mod.rs` vs file-per-module; re-exports.
  <!-- endif -->
  <!-- if: go -->
  - Exported (uppercase) vs unexported; package boundary = directory.
  <!-- endif -->

- **Imports** — order, grouping, and path resolution.
  <!-- if: typescript, javascript -->
  - Import order / grouping; `import type` usage; path aliases vs relative.
  <!-- endif -->
  <!-- if: python -->
  - `isort` grouping (stdlib / third-party / local); relative vs absolute imports.
  <!-- endif -->
  <!-- if: rust -->
  - `use` grouping; `self` / `super` / `crate`; glob imports policy.
  <!-- endif -->

- **File / module size** — when to split.
  - One-export-per-file? Size cap? The signal that a module is too big.

- **Module boundaries** — what's shared vs local; allowed dependency direction.

- **Config & env** — where config lives; validated env access vs raw globals.
  <!-- if: typescript, javascript -->
  - Validated env (e.g. `envalid`, zod) vs raw `process.env`.
  <!-- endif -->
  <!-- if: python -->
  - `pydantic-settings` / `environ` vs raw `os.environ`.
  <!-- endif -->

- **Workspace & packages** — [skip for single-package repos]
  - Single package or monorepo/workspace?
  - Package boundary rules (what can import what).
  - Shared config (one formatter/tsconfig/linter at root vs per-package).
  - Where shared types/contracts live (a `packages/shared` vs co-located).
  - Build order / dependency graph tooling (turborepo / nx / pnpm workspaces / cargo workspaces).
  - Whether the style guide is repo-wide or per-package.

---

## Round 4 — API / IO (backend surface; skip if none)

- **Handler shape** — route/controller structure; thin handler + service vs fat handler.

- **Input validation** — where and how requests are validated.

- **Data access** — repository / query layer vs inline queries; ORM idioms.

- **Side-effect isolation** — pure core vs I/O edges; where effects live.

- **Auth & context** — how identity / tenant threads through a request.

- **Security & trust boundary** — [1–2 picks, scoped to project-level policy]
  - Where is the trust boundary? (edge middleware, handler-level, framework-provided)
  - Fail-closed default — unauthenticated requests denied unless explicitly opened.
  - Secret handling — env vars only, never logged, never in error messages.
  - Input sanitization — where does untrusted data get validated/escaped?
  - Defer to framework skills for specifics (CORS, headers, XSS, injection); this is the *policy*.

- **Async jobs** — queue / worker idioms; retry & idempotency shape.

- **Logging & observability** — structured logging; what gets logged where.

---

## Round 5 — Frontend / UI (skip if no UI)

- **Component form** — function components; props shape; default vs named export.
  <!-- if: typescript, javascript -->
  - React/Preact/Solid: FC type or plain function; props interface inline or extracted.
  <!-- endif -->
  <!-- if: swift -->
  - SwiftUI: View struct shape; body extraction; ViewModifier vs extension.
  <!-- endif -->
  <!-- if: kotlin -->
  - Jetpack Compose: Composable function shape; state hoisting pattern.
  <!-- endif -->
  <!-- if: dart -->
  - Flutter: StatelessWidget vs StatefulWidget; widget extraction.
  <!-- endif -->

- **Hook & component order** — file layout; where hooks / handlers / render sit.

- **State management** — local vs global; server-state idioms.
  <!-- if: typescript, javascript -->
  - React Query / SWR / TanStack; Zustand / Jotai / Redux; when global state earns its place.
  <!-- endif -->

- **Data fetching** — where fetches live; loading / error patterns.

- **Forms & validation** — controlled vs uncontrolled; schema-driven forms.

- **Styling** — the styling system; class / variant conventions.

- **i18n & a11y** — string externalization; the a11y baseline.

---

## Round 6 — Tests, tooling & lifecycle

- **Test shape** — arrange/act/assert; naming; one-assert vs many.

- **Test location** — colocated vs `__tests__` / `tests/`; unit vs integration split.
  <!-- if: rust -->
  - `#[cfg(test)] mod tests` inline vs `tests/` directory for integration.
  <!-- endif -->
  <!-- if: go -->
  - `_test.go` colocated; `testdata/` directory.
  <!-- endif -->

- **Fixtures & mocks** — factory vs inline; mock policy.

- **Comments & docs** — density; doc-comments vs inline; when a comment earns its place.
  <!-- if: typescript, javascript -->
  - JSDoc/TSDoc on exports; `//` inline for non-obvious logic.
  <!-- endif -->
  <!-- if: python -->
  - Docstrings (Google/NumPy/Sphinx style); `#` inline.
  <!-- endif -->
  <!-- if: rust -->
  - `///` doc-comments; `//!` module docs; examples in doc-comments.
  <!-- endif -->

- **Formatting** — quotes / semis / width / trailing-commas / import-order → a **formatter config**, not prose. See [FORMATTERS.md](FORMATTERS.md) for the language → tool lookup.

- **Lint tells** — the machine-catchable slop wired as lint rules.
  <!-- if: typescript, javascript -->
  - `no-nested-ternary`, complexity / length caps, `no-restricted-syntax` for banned identifiers (`isRecord`-style helpers) and shapes.
  <!-- endif -->
  - Generic: function length cap, cognitive complexity cap, banned identifier patterns.

- **Git & collaboration** — [2–3 picks]
  - Commit message format — conventional commits (`feat:` / `fix:` / `chore:`) vs free-form.
  - Branch naming — `feature/xxx`, `fix/xxx`, kebab-case? Prefixed with ticket ID?
  - PR size policy — small & focused vs batched.
  - Merge strategy — squash (default recommendation), merge, rebase.
  - When to open a PR vs commit directly to the working branch.

- **Documentation lifecycle** — [2 picks]
  - When does new work need an ADR? (any decision an agent would otherwise guess at)
  - When do CONTEXT.md / LANGUAGE.md get updated? (same PR that introduces a new concept)
  - Does a new module need its own README, or is colocated doc-comments sufficient?
  - Who owns the update — the PR author, or a periodic sweep?
