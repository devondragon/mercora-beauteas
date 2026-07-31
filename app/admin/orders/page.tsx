/**
 * Admin fulfillment queue (BMC-216D / BMC-228).
 *
 * The previous implementation loaded a page of orders and filtered it in React
 * (so the status filter and search only ever saw the current page), and offered
 * inline status / carrier / tracking editing that wrote through PUT /api/orders
 * with browser-stamped shipped_at/delivered_at and a client-built tracking URL
 * (which fell back to a Google search link for unknown carriers).
 *
 * All of that is gone: filtering, sorting, counting and pagination now happen in
 * SQL behind GET /api/admin/orders, and the only mutations are the guarded
 * ship / tracking / shipping-email endpoints.
 */
import OrdersQueueClient from "./OrdersQueueClient";

export default function AdminOrdersPage() {
  return <OrdersQueueClient />;
}
