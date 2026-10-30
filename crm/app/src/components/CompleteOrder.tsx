// Closing an order: the database finalises and sends the invoice of the one-off items and creates
// the review request; it refuses in plain German when that is not possible.
import { completeOrder } from "../api/flow";
import type { Order } from "../api/types";
import { useAction } from "../hooks/useAsync";

export function CompleteOrder({ order, onDone }: { order: Pick<Order, "id" | "status">; onDone: () => void }) {
  const action = useAction();
  if (order.status !== "open" && order.status !== "in_progress") return null;
  const complete = () => { void action.run(async () => { await completeOrder(order.id); onDone(); }); };
  return (
    <>
      <button class="button button--gold" type="button" disabled={action.busy} onClick={complete}>Auftrag abschließen</button>
      {action.error !== null && <span class="small late" role="alert">{action.error}</span>}
    </>
  );
}
