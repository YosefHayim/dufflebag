# Deslop Examples

Use examples like these in the read-only review. Adapt names to the real repo.

## Example 1: Backend Pipeline Naming

Before:

```ts
export async function handle(req: Request) {
  const d = await req.json();
  const x = await save(d);
  await send(x.id);
  return Response.json({ ok: true });
}
```

After:

```ts
export async function createInvoiceFromRequest(req: Request) {
  const invoiceInput = await req.json();
  const invoice = await saveInvoice(invoiceInput);
  await sendInvoiceCreatedEmail(invoice.id);
  return Response.json({ ok: true });
}
```

Review wording:

```txt
Current: route -> handle -> save -> send
Proposed: route -> createInvoiceFromRequest -> saveInvoice -> sendInvoiceCreatedEmail

The behavior is probably fine, but the names hide the business pipeline.
```

## Example 2: Split Only The Real Stages

Before:

```ts
async function processUser(id: string) {
  const user = await db.user.findUnique({ where: { id } });
  if (!user) return null;

  const fullName = `${user.firstName} ${user.lastName}`.trim();
  const label = user.isAdmin ? `${fullName} (admin)` : fullName;

  await audit.log("view_user", { id });
  return { id: user.id, label };
}
```

After:

```ts
async function getUserProfileSummary(id: string) {
  const user = await findUserById(id);
  if (!user) return null;

  await logUserProfileViewed(id);
  return buildUserProfileSummary(user);
}

function buildUserProfileSummary(user: User) {
  const fullName = `${user.firstName} ${user.lastName}`.trim();
  return {
    id: user.id,
    label: user.isAdmin ? `${fullName} (admin)` : fullName,
  };
}
```

Review wording:

```txt
This should become two named stages, not five tiny helpers:
load user -> audit side effect -> build summary
```

## Example 3: React Component To Hook Plus Pure Helper

Before:

```tsx
export function OrdersPage({ orders, query, status }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const visibleOrders = orders
    .filter((o) => status === "all" || o.status === status)
    .filter((o) => o.customerName.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  useEffect(() => {
    if (!selectedId && visibleOrders[0]) setSelectedId(visibleOrders[0].id);
  }, [selectedId, visibleOrders]);

  return <OrdersTable orders={visibleOrders} selectedId={selectedId} onSelect={setSelectedId} />;
}
```

After:

```tsx
export function OrdersPage(props: Props) {
  const { visibleOrders, selectedId, selectOrder } = useOrdersPageState(props);

  return <OrdersTable orders={visibleOrders} selectedId={selectedId} onSelect={selectOrder} />;
}

function useOrdersPageState({ orders, query, status }: Props) {
  const [selectedId, selectOrder] = useState<string | null>(null);
  const visibleOrders = useMemo(
    () => buildVisibleOrders({ orders, query, status }),
    [orders, query, status],
  );

  useEffect(() => {
    if (!selectedId && visibleOrders[0]) selectOrder(visibleOrders[0].id);
  }, [selectedId, visibleOrders]);

  return { visibleOrders, selectedId, selectOrder };
}

function buildVisibleOrders({ orders, query, status }: Props) {
  return orders
    .filter((order) => status === "all" || order.status === status)
    .filter((order) => order.customerName.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
```

Review wording:

```txt
Current: OrdersPage owns state + filtering + sorting + default selection + render
Proposed: OrdersPage renders, useOrdersPageState owns state/effect, buildVisibleOrders owns pure shaping
```

## Example 4: Do Not Over-Extract

Before:

```ts
function isPaid(invoice: Invoice) {
  return invoice.status === "paid";
}

const paidInvoices = invoices.filter(isPaid);
```

After:

```ts
const paidInvoices = invoices.filter((invoice) => invoice.status === "paid");
```

Review wording:

```txt
Inline this helper. The name does not reveal a pipeline step; it makes the reader jump for one comparison.
```

## Example 5: Folder Rename Review

Before:

```txt
src/lib/data/orderStuff.ts
src/lib/data/doOrder.ts
src/components/order.tsx
```

After:

```txt
src/features/orders/api/orderApi.ts
src/features/orders/model/buildOrderViewModel.ts
src/features/orders/components/OrderPage.tsx
```

Review wording:

```txt
Current folders hide ownership: "lib/data" contains API calls, view shaping, and UI-specific naming.
Proposed folders read as a pipeline: api -> model -> components.
Risk: import churn across order screens; search usages before applying.
```
