# Code Style

Scaffolded copy of the workspace Uncle Bob distillation (`code-style.md` at the Code workspace root). This is the **default philosophy** for a repository; a project may add a short dialect section below, but must not contradict these rules.

| Source | What it is |
|---|---|
| `CLAUDE.md` | Workspace rules for agents across independent projects |
| `clean-code-uncle-bob-lesson-1-…md` | Functions, politeness, side effects, DRY |
| `clean-code-uncle-bob-lesson-2-…md` | Comments, names, file size |
| `clean-code-uncle-bob-lesson-3-…md` | Craft expectations, tests as courage, honesty |
| `clean-code-uncle-bob-lesson-4-…md` | TDD three laws, “say no”, double-entry coding |
| `clean-code-uncle-bob-lesson-5-…md` | Clean architecture, use cases, dependency rule |
| `clean-code-uncle-bob-lesson-6-…md` | Agile as data, iterations, estimates |

This file is a **working style guide**, not a book summary. Every rule ends with a small code example.

---

## 0. Workspace stance (from `CLAUDE.md`)

These apply **before** any Clean Code rule:

1. **One project at a time.** `Code/` is not a monorepo. `cd` into the project; read *that* project’s `AGENTS.md` / `CONTEXT.md`.
2. **Reuse before inventing.** Search for an existing place to edit. Promote to shared only on a real second consumer.
3. **SSOT / KISS / YAGNI / DRY.** One source of truth; simplest thing that works; don’t build what you don’t need yet; don’t copy-paste logic.
4. **Plan first** when a change ripples through shared interfaces (`src/core/types.ts`, package APIs, etc.).
5. **Right package manager** (`pnpm` vs `npm` vs `uv`) — wrong one corrupts the lockfile.

```ts
// BAD — invent a new util because you didn't look
// packages/foo/src/formatDate.ts  (already exists in @repo/utils)

// GOOD — extend the existing shared helper on the second real consumer
import { formatDate } from "@repo/utils";
```

---

## 1. The only way to go fast is to go well

**Conclusion:** Messes feel fast for a week and then destroy the team. Working code is only half the job — clean it once it works. Nobody writes clean code first; humans think in messes, then refactor.

```ts
// Step 1 — make it work (messy is fine)
function handle(order: any) {
  const t = order.total - (order.coupon ? order.total * 0.1 : 0);
  db.query("UPDATE orders SET total=" + t + " WHERE id=" + order.id);
  mailer.send(order.email, "Thanks", "You paid " + t);
  return t;
}

// Step 2 — once green, clean it
function handle(order: Order): Money {
  const total = applyCoupon(order);
  orders.saveTotal(order.id, total);
  receipts.email(order.customer, total);
  return total;
}
```

---

## 2. Clean code = no WTFs per minute

**Conclusion (from Booch, Feathers, Cunningham, Stroustrup):** Clean code is simple, direct, prose-like, looks like someone cares, and every next line is roughly what you expected.

```ts
// BAD — every line is a small surprise
function p(x: any) {
  return x.a.filter((y: any) => y.s === 1).map((y: any) => y.n).join(",");
}

// GOOD — names remove surprise
function activeUserNames(users: User[]): string {
  return users
    .filter((user) => user.status === Status.Active)
    .map((user) => user.name)
    .join(", ");
}
```

---

## 3. Functions: small, one thing, one level of abstraction

**Conclusions (Lesson 1):**

| Rule | Meaning |
|---|---|
| **Small** | Prefer a few lines. Extract until you can’t extract more without losing meaning. |
| **One thing** | If you can still extract a meaningful step, it’s more than one thing. |
| **Same abstraction** | Every line is one level *below* the function name. No mixing “get page” with “append `</div>`”. |
| **Polite (newspaper)** | Title → summary → detail. Reader can exit early. |
| **Few args** | Ideal 0–2. Max ~3. More → pack into an object. |
| **No flag args** | `doThis(true)` is rude. Split into two named functions. |
| **No output args** | Don’t pass an object only to fill it; return a value. |
| **Prefer exceptions** to error codes that force nested `if` ladders. |
| **Avoid switch-on-type** — use polymorphism (Open/Closed). |

```ts
// BAD — long, multi-level, flag arg, output arg, switch magnet
function process(page: Page, isTest: boolean, out: string[]) {
  let html = page.raw;
  if (isTest) {
    html = setup + html + teardown;
  }
  switch (page.kind) {
    case "wiki":
      out.push(toWikiHtml(html));
      break;
    case "blog":
      out.push(toBlogHtml(html));
      break;
  }
}

// GOOD — small, one level, return values, polymorphism
function renderPageWithSetupsAndTeardowns(page: Page): string {
  const body = page.isTestPage()
    ? includeSetupsAndTeardowns(page)
    : page.content();
  return page.toHtml(body);
}

interface Page {
  isTestPage(): boolean;
  content(): string;
  toHtml(body: string): string;
}
```

```ts
// BAD — boolean flag
sendEmail(user, true);

// GOOD — named intent
sendWelcomeEmail(user);
sendPasswordResetEmail(user);
```

```ts
// BAD — output argument
function fillTotals(order: Order, result: number[]) {
  result.push(order.subtotal);
  result.push(order.tax);
}

// GOOD — return a value
function totals(order: Order): { subtotal: Money; tax: Money } {
  return { subtotal: order.subtotal, tax: order.tax };
}
```

---

## 4. Side effects and Command–Query Separation

**Conclusions (Lesson 1):**

- A **side effect** is a change to system state (open file, write DB, mutate global).
- Side-effect functions come in **pairs** (`open`/`close`, `new`/`delete`) — and humans are bad at pairs. Prefer APIs that own the whole pair (pass a lambda / callback so open+close stay together).
- **Command–Query Separation (CQS):**
  - **Command** → changes state, returns `void`.
  - **Query** → returns a value, does **not** change state.

```ts
// BAD — query that also mutates (surprise side effect)
function getNextId(): number {
  currentId += 1; // mutation hidden behind "get"
  return currentId;
}

// GOOD — command and query separated
function advanceId(): void {
  currentId += 1;
}
function currentIdValue(): number {
  return currentId;
}

// GOOD — side-effect pair owned by one function
function withOpenFile(path: string, process: (f: File) => void): void {
  const file = open(path);
  try {
    process(file);
  } finally {
    file.close();
  }
}
```

```ts
// Prefer exceptions over error codes
// BAD
function parse(json: string): { ok: boolean; value?: User; error?: string } {
  try {
    return { ok: true, value: JSON.parse(json) };
  } catch {
    return { ok: false, error: "bad json" };
  }
}

// GOOD
function parseUser(json: string): User {
  try {
    return User.fromJson(JSON.parse(json));
  } catch (cause) {
    throw new InvalidUserJsonError({ cause });
  }
}
```

---

## 5. DRY — Don’t Repeat Yourself

**Conclusion:** Duplication is the root of fragile change. Extract shared loops *and* shared decisions. Lambdas/callbacks kill “same loop, different body” duplication.

```ts
// BAD — same loop twice
for (const row of rows) {
  if (row.active) emails.push(row.email);
}
for (const row of rows) {
  if (row.active) ids.push(row.id);
}

// GOOD — one traversal policy, different bodies
function forEachActive(rows: Row[], visit: (row: Row) => void): void {
  for (const row of rows) {
    if (row.active) visit(row);
  }
}
forEachActive(rows, (r) => emails.push(r.email));
forEachActive(rows, (r) => ids.push(r.id));
```

---

## 6. Comments: last resort, not a virtue

**Conclusions (Lesson 2):**

- Every comment is a **failure to express yourself in code** (you will still fail sometimes — that’s life).
- **Comments lie** because code changes and comments don’t.
- Don’t use comments to makeup for bad names or bad structure — **clean the code**.
- Delete noise, journals, position markers, commented-out code, HTML-in-comments.
- Acceptable comments: legal headers, public API docs, **warning of consequences**, TODOs with context, clarifying intent when the language truly can’t.

```ts
// BAD — noise / lies / makeup for bad names
// Increment i
i++;
// Check if employee is eligible for full benefits
if (employee.flags & HOURLY && employee.age > 65) { ... }

// GOOD — explain yourself in code
const eligibleForFullBenefits =
  employee.isHourly() && employee.isSenior();
if (eligibleForFullBenefits) { ... }

// GOOD — rare justified comment (non-obvious consequence)
// Must run before process.env is frozen by the runtime; do not move.
loadDotEnv();
```

```ts
// BAD — journal / attribution / commented-out
// 2024-01-12 JS: fixed tax
// 2024-03-01 AM: rewrote tax
// return oldTax(order);
return tax(order);

// GOOD — git owns history; dead code is deleted
return tax(order);
```

---

## 7. Names reveal intent

**Conclusions (Lesson 2):**

- Names are everywhere — spend time on them.
- **Reveal intent.** Disambiguate. Avoid noise words (`data`, `info`, `manager`, `a1`, `a2`).
- No convenient misspellings. No number series (`account1`, `account2`).
- Distinguish names *meaningfully* (`source` vs `destination`, not `a` vs `b`).

```ts
// BAD
const d = 15; // days?
function getThem() {
  const list1 = [];
  for (const x of theList) if (x[0] === 4) list1.push(x);
  return list1;
}

// GOOD
const daysUntilDeadline = 15;
function flaggedCells(gameBoard: Cell[]): Cell[] {
  return gameBoard.filter((cell) => cell.isFlagged());
}
```

---

## 8. Professional expectations (Lesson 3)

Treat these as **team contracts**, not slogans:

| Expectation | In practice |
|---|---|
| **We will not ship shit** | Definition of done includes clean + tested. |
| **Always ready** | Main branch is releasable every iteration. |
| **Stable productivity** | Speed doesn’t collapse as the codebase grows. |
| **Inexpensive adaptability** | Software is *soft* — change should be cheap. |
| **Continuous improvement** | Code gets better over time, not worse. |
| **Fearless competence** | Tests remove fear of change. |
| **QA finds nothing** | Don’t dump quality onto QA. |
| **Honest estimates** | Three numbers: best / likely / worst — not a single lie. |
| **Cover for each other** | Team > hero. |

```ts
// BAD — single false-precision estimate
// "It'll take 3 days"

// GOOD — honest range
// best: 1d | likely: 3d | worst: 8d (unknown: payment provider sandbox)
```

```ts
// BAD — "we'll clean it later" permanently
if (legacy) {
  // TODO: fix this mess before launch (written 2 years ago)
  doTheMess();
}

// GOOD — leave the campground cleaner
if (legacy) {
  return migrateAndHandle(legacy); // improved path, covered by tests
}
```

---

## 9. TDD — three laws + double-entry bookkeeping

**Conclusions (Lesson 4):**

1. **You may not write production code** until a failing test forces you to.
2. **You may not write more of a test** than is sufficient to fail (incl. compile fail).
3. **You may not write more production code** than is sufficient to pass the one failing test.

TDD is **double-entry bookkeeping**: every behavior is entered twice (test + production) so they check each other. Tests are the **examples / living documentation** of the system.

Also: **say no** when the answer is no. The most valuable word a programmer has under deadline pressure is *no* (then work hard to find a yes that still protects quality).

```ts
// Cycle: red → green → refactor (stack example, abbreviated)

// 1) RED — test fails (class doesn't exist yet)
test("new stack is empty", () => {
  const stack = new MyStack<number>();
  expect(stack.isEmpty()).toBe(true);
});

// 2) GREEN — minimum production code
class MyStack<T> {
  isEmpty(): boolean {
    return true;
  }
}

// 3) RED — next behavior
test("after push, stack is not empty", () => {
  const stack = new MyStack<number>();
  stack.push(1);
  expect(stack.isEmpty()).toBe(false);
});

// 4) GREEN — only enough to pass
class MyStack<T> {
  private size = 0;
  isEmpty(): boolean {
    return this.size === 0;
  }
  push(_value: T): void {
    this.size += 1;
  }
}

// 5) REFACTOR — only with green bar
```

**Coverage tip (Lesson 3):** The only target that makes sense is *as close to 100% as the team can honestly hold*. Don’t let coverage become a manager vanity metric (teams will gut asserts to protect the number). Coverage is a **team introspection** tool.

```ts
// BAD — high coverage, no meaning
test("create user", () => {
  createUser({ name: "Ada" }); // no assert
});

// GOOD — assert the behavior you care about
test("create user persists and returns id", async () => {
  const user = await createUser({ name: "Ada" });
  expect(user.id).toBeTruthy();
  expect(await users.find(user.id)).toEqual(user);
});
```

---

## 10. Architecture: structure over frameworks

**Conclusions (Lesson 5):**

### Two values of software
1. **Behavior** — it does what stakeholders asked (urgent).
2. **Structure** — it can still change (important).  
   Eisenhower: don’t let urgent behavior kill important structure. **Fight for the architecture.**

### Goal of architecture
Minimize the human resources required to build and maintain the system.  
**Messes aren’t faster** even in the short term.

### Rules that don’t depend on framework/language/DB
- **Use-case driven.** Core is **Interactors** (use cases) + **Entities** (business rules).
- **Web is a delivery mechanism** (an I/O device), not the app.
- **Database is a detail.** ORM stays behind a gateway; entities don’t import it.
- **Dependency rule:** source code dependencies point **inward**. Outer rings (UI, DB, frameworks) depend on inner rings (use cases, entities) — never the reverse.
- **Plugin model:** frameworks are plugins to *your* app, not the other way around.
- **Good architecture defers critical decisions** (DB, framework, web) as long as possible.

```ts
// BAD — "Rails/Next/Nest shape" leaks into the core
// app/api/orders/route.ts
export async function POST(req: Request) {
  const body = await req.json();
  const order = await prisma.order.create({ data: body }); // DB in the center
  await stripe.charges.create({ amount: order.total });    // provider in the center
  return Response.json(order);
}

// GOOD — dependency rule: use case in the center
// domain/entities/Order.ts
export class Order {
  constructor(
    readonly id: OrderId,
    readonly lines: Line[],
  ) {}
  total(): Money {
    return Money.sum(this.lines.map((l) => l.subtotal()));
  }
}

// application/PlaceOrder.ts  (Interactor / use case)
export class PlaceOrder {
  constructor(
    private readonly orders: OrderRepository, // interface, not Prisma
    private readonly payments: PaymentGateway, // interface, not Stripe
  ) {}

  async execute(request: PlaceOrderRequest): Promise<PlaceOrderResponse> {
    const order = Order.fromRequest(request);
    await this.payments.charge(order.total());
    await this.orders.save(order);
    return PlaceOrderResponse.from(order);
  }
}

// infrastructure/http/placeOrderController.ts  (delivery mechanism)
export async function placeOrderController(req: Request): Promise<Response> {
  const result = await placeOrder.execute(PlaceOrderRequest.fromHttp(req));
  return Response.json(result.toJson());
}

// infrastructure/prisma/PrismaOrderRepository.ts  (DB is a detail)
export class PrismaOrderRepository implements OrderRepository {
  async save(order: Order): Promise<void> {
    await prisma.order.upsert(/* map entity → rows */);
  }
}
```

```text
        [ UI / HTTP / CLI ]     delivery mechanisms
                 |
                 v
        [ Controllers / Presenters ]
                 |
                 v
        [ Interactors / Use Cases ]   <── application rules
                 |
                 v
        [ Entities ]                  <── business rules
                 ^
                 |  (interfaces owned inward)
        [ Gateways: DB, Mail, Pay ]
```

---

## 11. Agile is data, not a speed spell

**Conclusions (Lesson 6):**

- **Purpose of agile:** put **truth on the wall** (velocity + burndown) so hope dies early and management can manage.
- Agile does **not** make you go faster by itself — it produces data about how messed up the plan is.
- **Waterfall** fails because testing discovers design is wrong too late → death march.
- **Short iterations** (days/weeks): plan a little, build a little, measure, replan.
- Estimates are **guesses that improve** as variables shrink; never treat early estimates as contracts.
- **Control knobs** of project management: scope, resources, date, quality — quality is not a real knob (cutting it bankrupts the future).

```ts
// BAD — fake agile
// "We're agile" + no charts + fixed scope + fixed date + "just work weekends"

// GOOD — agile as feedback loop
type Iteration = {
  number: number;
  plannedPoints: number;
  donePoints: number; // measured, not hoped
};

function velocity(history: Iteration[]): number {
  const recent = history.slice(-3);
  return average(recent.map((i) => i.donePoints));
}

// Forecast: remainingPoints / velocity → iterations left
// If charts say you won't make the date: cut scope or move date — don't cut quality.
```

---

## 12. Open/Closed without the textbook fog

**Conclusion (Lesson 1 → OCP):** Prefer adding a new type/class over hunting every `switch`/`if` when a new case appears.

```ts
// BAD — every new shape edits every switch
function area(shape: { type: string; w?: number; r?: number }): number {
  switch (shape.type) {
    case "rect":
      return (shape.w ?? 0) ** 2;
    case "circle":
      return Math.PI * (shape.r ?? 0) ** 2;
    // add "triangle"? edit here + draw() + serialize() + ...
  }
  return 0;
}

// GOOD — open for extension, closed for modification
interface Shape {
  area(): number;
}
class Rect implements Shape {
  constructor(private w: number) {}
  area() {
    return this.w * this.w;
  }
}
class Circle implements Shape {
  constructor(private r: number) {}
  area() {
    return Math.PI * this.r * this.r;
  }
}
// New Rhombus? Add a class. Call sites stay untouched.
```

---

## 13. One-page checklist (print this)

Before you merge:

- [ ] **Works**, then **cleaned** (not “clean later”).
- [ ] Functions **small**, **one thing**, **one abstraction level**.
- [ ] Names **reveal intent**; no flag/output args.
- [ ] **CQS** respected; side-effect pairs owned.
- [ ] **No duplication** you can still see.
- [ ] **Comments** only where code truly can’t speak.
- [ ] **Test** exists for the behavior (preferably first).
- [ ] New dependency points **inward** (use case/entity free of UI/DB/framework).
- [ ] You didn’t trade **structure** for a false sense of speed.
- [ ] Estimate / scope talk was **honest**.

---

## 14. How this maps to *this* workspace

Uncle Bob’s rules are **language-agnostic**. In `~/Desktop/Code` they show up as:

| Uncle Bob | How it already shows up here |
|---|---|
| SSOT / DRY | “Reuse before create”; `CONTEXT.md` ubiquitous language |
| Dependency rule | Shared packages (`@zaatar/*`, `@repo/*`) with clear boundaries |
| DB/web are details | Workers/Pages/Nest as delivery; domain kept separate where projects mature |
| Small functions / prose | Project `AGENTS.md` “terse, clear” norms (e.g. Oly-App casing) |
| Plan before ripple | “Plan first before shared interface changes” in `CLAUDE.md` |
| Say no / honest estimates | Craft over cargo-cult agile consultants (Lesson 1 intro) |

When a **specific project** has its own `CODE-STYLE.md` or `code-style.rules.json`, **that file wins inside that project**. This root file is the cross-cutting distillation from the root lessons + workspace index.

---

## Sources (root only)

```text
CLAUDE.md
clean-code-uncle-bob-lesson-1-7EmboKQH8lM.md   # functions, ethics, DRY, CQS
clean-code-uncle-bob-lesson-2-2a_ytyt9sf8.md   # comments, names
clean-code-uncle-bob-lesson-3-Qjywrq2gM8o.md   # craft expectations, tests as courage
clean-code-uncle-bob-lesson-4-58jGpV2Cg50.md   # TDD three laws, say no
clean-code-uncle-bob-lesson-5-sn0aFEMVTpA.md   # architecture, interactors, dependency rule
clean-code-uncle-bob-lesson-6-l-gF0vDhJVI.md   # agile as data, iterations
```
