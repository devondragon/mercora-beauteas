/**
 * === Order Detail & Returns Management ===
 *
 * Comprehensive order management interface for cancellations, returns, and exchanges.
 * Handles Stripe refund processing and inventory management for returned items.
 *
 * === Features ===
 * - **Order Details**: Complete order information with payment status
 * - **Cancellation Management**: Cancel orders with automatic Stripe refunds
 * - **Return Processing**: Handle individual item returns with reasons
 * - **Exchange Management**: Process item exchanges and replacements
 * - **Refund Processing**: Integrated Stripe refund handling
 * - **Inventory Updates**: Automatic restocking for returned items
 *
 * === Workflow ===
 * - **Cancellation**: Full order cancel + full Stripe refund
 * - **Return**: Individual items + partial Stripe refund
 * - **Exchange**: Return + replacement order creation
 */

"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowLeft, Package, RotateCcw, XCircle, RefreshCw,
  DollarSign, AlertTriangle, CheckCircle,
  Calendar, User, MapPin, CreditCard
} from "lucide-react";
import { orderStatusConfig } from "@/lib/ui/status-styles";
import { Money } from "@/lib/money";
import FulfillmentTimeline from "@/components/admin/orders/FulfillmentTimeline";
import type { FulfillmentEventLike } from "@/lib/fulfillment/queue-view";

interface Order {
  id: string;
  customer_id?: string;
  status: "pending" | "processing" | "shipped" | "delivered" | "cancelled" | "refunded";
  total_amount: {
    amount: number;
    currency: string;
  };
  currency_code: string;
  shipping_address?: {
    recipient?: string;
    line1?: string;
    city?: string;
    region?: string;
    postal_code?: string;
    country?: string;
  };
  items: Array<{
    product_id: string;
    variant_id?: string;
    product_name: string;
    quantity: number;
    // BMC-164: post-Task 8, /api/orders always returns MACH wire money here —
    // amount is in MAJOR units and currency is always present.
    unit_price: number | { amount: number; currency?: string };
    list_price?: number | { amount: number; currency?: string }; // Original price before discount
    discount_amount?: number; // Discount applied to this item
  }>;
  payment_method?: string;
  payment_status?: string;
  tracking_number?: string;
  created_at: string;
  updated_at: string;
  shipped_at?: string;
  delivered_at?: string;
  notes?: string;
  extensions?: {
    // snake_case matches the CheckoutClient writer, the readers below, and the
    // sibling app/admin/orders/page.tsx interface — the prior camelCase keys
    // never matched a real persisted key (BMC-164 review fix).
    subtotal?: number;
    shipping_cost?: number;
    tax_amount?: number;
    discount_amount?: number;
    carrier?: string;
    trackingUrl?: string;
    email?: string;
    payment_intent_id?: string;
    [key: string]: any;
  };
}

interface RefundResponse {
  success: boolean;
  refund: {
    id: string;
    amount: number;
    type: 'full' | 'partial';
    reason: string;
    items: string[];
    processed_at: string;
  };
  order: {
    id: string;
    status: string;
    payment_status: string;
  };
}

export default function OrderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const orderId = params.id as string;

  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [actionType, setActionType] = useState<'cancel' | 'return' | 'exchange' | null>(null);
  const [reason, setReason] = useState("");
  const [returnType, setReturnType] = useState<'full' | 'partial'>('partial');

  // Configurable refund policies - loaded from database
  const [refundPolicy, setRefundPolicy] = useState({
    refundShipping: false, // Most retailers don't refund shipping
    refundShippingOnFullReturn: false, // Even on full returns, shipping usually not refunded
    restockingFeePercent: 0, // Percentage restocking fee (0-100)
    minimumRefundAmount: 0, // Minimum refund amount in cents
    applyRestockingFeeOnPartialReturn: true
  });

  // BMC-216D: fulfillment audit history for this order.
  const [events, setEvents] = useState<FulfillmentEventLike[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventsError, setEventsError] = useState<string | null>(null);

  const fetchEvents = useCallback(async () => {
    setEventsLoading(true);
    setEventsError(null);
    try {
      const response = await fetch(`/api/admin/orders/${orderId}/events`);
      if (!response.ok) throw new Error(`Could not load fulfillment history (${response.status})`);
      const data = (await response.json()) as { events?: FulfillmentEventLike[] };
      setEvents(data.events ?? []);
    } catch (error) {
      setEvents([]);
      setEventsError(error instanceof Error ? error.message : "Could not load fulfillment history");
    } finally {
      setEventsLoading(false);
    }
  }, [orderId]);

  const fetchOrder = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/orders?admin=true&orderId=${orderId}`);
      if (response.ok) {
        const data = await response.json() as { data: Order[] };
        setOrder(data.data?.[0] || null);
      } else {
        console.error("Failed to fetch order");
      }
    } catch (error) {
      console.error("Error fetching order:", error);
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  const fetchRefundPolicy = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/settings?category=refund');
      if (response.ok) {
        const data = await response.json() as { data: Array<{key: string, value: string}> };
        const policySettings: Record<string, any> = {};

        data.data.forEach(setting => {
          const key = setting.key.replace('refund.', '');
          try {
            policySettings[key] = JSON.parse(setting.value);
          } catch {
            policySettings[key] = setting.value;
          }
        });

        setRefundPolicy({
          refundShipping: policySettings.shipping_refunded || false,
          refundShippingOnFullReturn: policySettings.shipping_refunded_on_full_return || false,
          restockingFeePercent: policySettings.restocking_fee_percent || 0,
          minimumRefundAmount: policySettings.minimum_refund_amount || 0,
          applyRestockingFeeOnPartialReturn: policySettings.apply_restocking_fee_on_partial !== false
        });
      }
    } catch (error) {
      console.error("Error fetching refund policy:", error);
      // Keep default values on error
    }
  }, []);

  const getStatusBadge = (status: Order["status"]) => {
    const config = orderStatusConfig[status];
    const Icon = config.icon;
    return (
      <Badge variant={config.variant}>
        <Icon className="w-3 h-3 mr-1" />
        {config.label}
      </Badge>
    );
  };

  const handleCancelOrder = async () => {
    if (!order || !reason.trim()) return;

    setActionLoading(true);
    try {
      const response = await fetch('/api/orders/refund', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
          // Authentication will be handled by the authenticateRequest function in the API
        },
        body: JSON.stringify({
          orderId: order.id,
          type: 'full',
          reason: reason.trim(),
          notes: `Order cancelled by admin`
        })
      });

      if (!response.ok) {
        const errorData = await response.json() as { error?: string };
        throw new Error(errorData.error || 'Failed to cancel order');
      }

      const result = await response.json() as RefundResponse;

      // Refresh order data
      await fetchOrder();

      alert(`Order cancelled successfully! Refund ID: ${result.refund.id}\nAmount refunded: $${(result.refund.amount / 100).toFixed(2)}`);

    } catch (error) {
      console.error('Error cancelling order:', error);
      alert(`Error processing cancellation: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setActionLoading(false);
      setActionType(null);
      setReason("");
    }
  };

  const handleReturnItems = async () => {
    if (!order || selectedItems.size === 0 || !reason.trim()) return;

    setActionLoading(true);
    try {
      // Calculate refund amount with tax, discount, and shipping considerations
      const selectedItemsArray = Array.from(selectedItems);
      const returnCalculation = calculateReturnAmount(selectedItemsArray);

      if (returnCalculation.total <= 0) {
        alert('No items selected or invalid refund amount');
        return;
      }

      const response = await fetch('/api/orders/refund', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
          // Authentication will be handled by the authenticateRequest function in the API
        },
        body: JSON.stringify({
          orderId: order.id,
          type: 'partial',
          reason: reason.trim(),
          amount: returnCalculation.totalMoney.toMinorUnits(),
          items: selectedItemsArray,
          notes: `Return: ${selectedItemsArray.length} item(s) - Subtotal: $${(returnCalculation.subtotal/100).toFixed(2)}, Tax: $${(returnCalculation.tax/100).toFixed(2)}, Discount: -$${(returnCalculation.discount/100).toFixed(2)}, Shipping: $${(returnCalculation.shipping/100).toFixed(2)}${(returnCalculation.restockingFee || 0) > 0 ? `, Restocking Fee: -$${((returnCalculation.restockingFee || 0)/100).toFixed(2)}` : ''}`
        })
      });

      if (!response.ok) {
        const errorData = await response.json() as { error?: string };
        throw new Error(errorData.error || 'Failed to process return');
      }

      const result = await response.json() as RefundResponse;

      // Refresh order data
      await fetchOrder();

      alert(`Return processed successfully! Refund ID: ${result.refund.id}\nAmount refunded: $${(result.refund.amount / 100).toFixed(2)}\nItems returned: ${result.refund.items.length}`);

    } catch (error) {
      console.error('Error processing return:', error);
      alert(`Error processing return: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setActionLoading(false);
      setActionType(null);
      setSelectedItems(new Set());
      setReason("");
    }
  };

  const calculateReturnAmount = (selectedItemIds: string[]) => {
    const zero = Money.zero(order?.total_amount.currency ?? 'USD');
    if (!order) {
      return { subtotal: 0, tax: 0, discount: 0, shipping: 0, total: 0, totalMoney: zero };
    }

    const currency = order.total_amount.currency;

    // BMC-164: order.extensions money fields (subtotal/tax_amount/discount_amount/
    // shipping_cost) are always MINOR units (cents) — Task 9/11. item.unit_price is
    // MACH wire money — always MAJOR units (Task 8). Build every input as a Money
    // in its actual unit so nothing gets mixed or double-scaled.
    const orderSubtotalExt = Money.fromMinor(order.extensions?.subtotal || 0, currency);
    const orderTax = Money.fromMinor(order.extensions?.tax_amount || 0, currency);
    const orderDiscount = Money.fromMinor(order.extensions?.discount_amount || 0, currency);
    const orderShipping = Money.fromMinor(order.extensions?.shipping_cost || 0, currency);

    const lineTotal = (item: Order["items"][number]): Money => {
      const wirePrice = typeof item.unit_price === 'number'
        ? { amount: item.unit_price, currency }
        : item.unit_price;
      return Money.fromMajor(wirePrice.amount, wirePrice.currency ?? currency).times(item.quantity);
    };

    // Calculate actual order subtotal from items (as verification)
    const calculatedOrderSubtotal = order.items.reduce(
      (total, item) => total.add(lineTotal(item)),
      zero
    );

    // Use the calculated subtotal if extensions subtotal doesn't exist or doesn't match
    const actualOrderSubtotal = orderSubtotalExt.gt(zero) ? orderSubtotalExt : calculatedOrderSubtotal;

    // Calculate item subtotal for selected items
    const returnItemsSubtotal = order.items
      .filter(item => {
        const itemKey = `${item.product_id}-${item.variant_id || 'default'}`;
        return selectedItemIds.includes(itemKey);
      })
      .reduce((total, item) => total.add(lineTotal(item)), zero);

    // Calculate proportional amounts
    const subtotalRatio = actualOrderSubtotal.gt(zero)
      ? returnItemsSubtotal.toMinorUnits() / actualOrderSubtotal.toMinorUnits()
      : 0;

    const returnTax = orderTax.applyRate(subtotalRatio);
    const returnDiscount = orderDiscount.applyRate(subtotalRatio);

    // Shipping refund based on policy
    const isFullReturn = selectedItemIds.length === order.items.length;
    const returnShipping = (isFullReturn && refundPolicy.refundShippingOnFullReturn) ||
                          (!isFullReturn && refundPolicy.refundShipping) ? orderShipping : zero;

    // Calculate base refund amount
    const baseRefundAmount = returnItemsSubtotal.add(returnTax).subtract(returnDiscount).add(returnShipping);

    // Apply restocking fee if configured
    let restockingFee = zero;
    if ((isFullReturn || refundPolicy.applyRestockingFeeOnPartialReturn) && refundPolicy.restockingFeePercent > 0) {
      restockingFee = baseRefundAmount.applyRate(refundPolicy.restockingFeePercent / 100);
    }

    const returnTotal = baseRefundAmount.subtract(restockingFee);
    const totalMoney = returnTotal.isNegative() ? zero : returnTotal; // Ensure never negative

    return {
      subtotal: returnItemsSubtotal.toMinorUnits(),
      tax: returnTax.toMinorUnits(),
      discount: returnDiscount.toMinorUnits(),
      shipping: returnShipping.toMinorUnits(),
      restockingFee: restockingFee.toMinorUnits(),
      baseAmount: baseRefundAmount.toMinorUnits(),
      total: totalMoney.toMinorUnits(),
      totalMoney,
      policy: {
        shippingRefunded: returnShipping.gt(zero),
        restockingFeeApplied: restockingFee.gt(zero),
        restockingFeePercent: refundPolicy.restockingFeePercent
      }
    };
  };

  const toggleItemSelection = (productId: string, variantId?: string) => {
    const itemKey = `${productId}-${variantId || 'default'}`;
    setSelectedItems(prev => {
      const newSet = new Set(prev);
      if (newSet.has(itemKey)) {
        newSet.delete(itemKey);
      } else {
        newSet.add(itemKey);
      }
      return newSet;
    });
  };

  const selectAllItems = () => {
    setSelectedItems(new Set(order?.items.map(item => `${item.product_id}-${item.variant_id || 'default'}`) || []));
  };

  const clearItemSelection = () => {
    setSelectedItems(new Set());
  };

  useEffect(() => {
    if (orderId) {
      fetchOrder();
      fetchRefundPolicy();
      fetchEvents();
    }
  }, [orderId, fetchOrder, fetchRefundPolicy, fetchEvents]);


  if (loading) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="w-8 h-8 text-primary-500 animate-spin" />
        </div>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="p-6">
        <div className="text-center py-12">
          <Package className="w-12 h-12 text-text-muted mx-auto mb-4" />
          <h3 className="text-lg font-medium text-text-secondary mb-2">Order not found</h3>
          <p className="text-text-muted">The requested order could not be found</p>
          <Button
            onClick={() => router.push('/admin/orders')}
            className="mt-4 bg-primary-500 hover:bg-primary-600"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Orders
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Debug Information - Remove after fixing */}
      {process.env.NODE_ENV === 'development' && (
        <Card className="bg-state-error-bg border-state-error p-4">
          <h4 className="text-state-error font-semibold mb-2">Debug Info</h4>
          <div className="text-xs text-state-error space-y-1">
            <div>Extensions keys: {order.extensions ? Object.keys(order.extensions).join(', ') : 'none'}</div>
            <div>Discount amount: {order.extensions?.discount_amount ?? 'undefined'}</div>
            <div>Subtotal: {order.extensions?.subtotal ?? 'undefined'}</div>
            <div>Tax: {order.extensions?.tax_amount ?? 'undefined'}</div>
            <div>Sample item keys: {order.items[0] ? Object.keys(order.items[0]).join(', ') : 'no items'}</div>
            {order.items[0] && (
              <div>Sample item data: {JSON.stringify(order.items[0], null, 2)}</div>
            )}
          </div>
        </Card>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <Button
            onClick={() => router.push('/admin/orders')}
            variant="ghost"
            className="text-text-secondary hover:text-text-primary"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Orders
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-text-primary">Order #{order.id}</h1>
            <div className="flex items-center space-x-4 mt-1">
              {getStatusBadge(order.status)}
              <span className="text-sm text-text-secondary">
                Created {new Date(order.created_at).toLocaleDateString()}
              </span>
            </div>
          </div>
        </div>
        <Button
          onClick={fetchOrder}
          disabled={loading}
          className="bg-primary-500 hover:bg-primary-600"
        >
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Order Information */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Customer & Payment Info */}
        <Card className="admin-card p-6">
          <h3 className="text-lg font-semibold text-text-primary mb-4">Customer & Payment</h3>
          <div className="space-y-3">
            <div className="flex items-center space-x-2">
              <User className="w-4 h-4 text-text-secondary" />
              <span className="text-text-secondary">{order.shipping_address?.recipient || 'Guest Customer'}</span>
            </div>
            <div className="flex items-center space-x-2">
              <CreditCard className="w-4 h-4 text-text-secondary" />
              <span className="text-text-secondary">{order.payment_method || 'Not specified'}</span>
            </div>
            <div className="flex items-center space-x-2">
              <DollarSign className="w-4 h-4 text-text-secondary" />
              <span className={`font-medium ${
                order.payment_status === 'paid' ? 'text-state-success' :
                order.payment_status === 'failed' ? 'text-state-error' :
                order.payment_status === 'refunded' ? 'text-state-error' :
                'text-state-warning'
              }`}>
                {order.payment_status || 'pending'}
              </span>
            </div>
          </div>
        </Card>

        {/* Shipping Info */}
        <Card className="admin-card p-6">
          <h3 className="text-lg font-semibold text-text-primary mb-4">Shipping Information</h3>
          {order.shipping_address ? (
            <div className="space-y-2 text-sm text-text-secondary">
              <div>{order.shipping_address.recipient}</div>
              <div>{order.shipping_address.line1}</div>
              <div>
                {order.shipping_address.city}, {order.shipping_address.region} {order.shipping_address.postal_code}
              </div>
              <div>{order.shipping_address.country}</div>
              {order.tracking_number && (
                <div className="mt-3 pt-3 border-t border-border-default">
                  <p className="text-xs text-text-secondary mb-1">Tracking</p>
                  <p className="font-medium">{order.tracking_number}</p>
                  {order.extensions?.carrier && (
                    <p className="text-xs text-text-secondary">{order.extensions.carrier}</p>
                  )}
                </div>
              )}
            </div>
          ) : (
            <p className="text-text-secondary text-sm">No shipping address</p>
          )}
        </Card>

        {/* Order Totals */}
        <Card className="admin-card p-6">
          <h3 className="text-lg font-semibold text-text-primary mb-4">Order Totals</h3>
          <div className="space-y-2 text-sm">
            {order.extensions?.subtotal && (
              <div className="flex justify-between">
                <span className="text-text-secondary">Subtotal:</span>
                <span className="text-text-primary">{Money.fromStored(order.extensions.subtotal).format()}</span>
              </div>
            )}
            {order.extensions?.shipping_cost && (
              <div className="flex justify-between">
                <span className="text-text-secondary">Shipping:</span>
                <span className="text-text-primary">{Money.fromStored(order.extensions.shipping_cost).format()}</span>
              </div>
            )}
            {order.extensions?.tax_amount && (
              <div className="flex justify-between">
                <span className="text-text-secondary">Tax:</span>
                <span className="text-text-primary">{Money.fromStored(order.extensions.tax_amount).format()}</span>
              </div>
            )}
            {/* Try multiple discount field names */}
            {(() => {
              const extensions = order.extensions || {};
              const discountAmount = extensions.discount_amount ||
                                   extensions.discountAmount ||
                                   extensions.discount ||
                                   extensions.promotion_discount ||
                                   0;

              if (discountAmount > 0) {
                return (
                  <div className="flex justify-between">
                    <span className="text-text-secondary">Discount:</span>
                    <span className="text-state-success">-{Money.fromStored(discountAmount).format()}</span>
                  </div>
                );
              }

              // Debug: show if any discount-related fields exist
              const discountFields = Object.keys(extensions).filter(key =>
                key.toLowerCase().includes('discount') || key.toLowerCase().includes('promotion')
              );

              if (discountFields.length > 0 && process.env.NODE_ENV === 'development') {
                return (
                  <div className="text-xs text-state-warning mt-1">
                    Found discount fields: {discountFields.join(', ')}
                  </div>
                );
              }

              return null;
            })()}

            {/* Calculate discount from item-level data if available */}
            {(() => {
              // BMC-164: unit_price/list_price arrive as MACH wire major units.
              const itemLevelDiscount = order.items.reduce((total, item) => {
                const finalPrice = typeof item.unit_price === 'number' ? item.unit_price : item.unit_price.amount;
                const listPrice = item.list_price
                  ? (typeof item.list_price === 'number' ? item.list_price : item.list_price.amount)
                  : finalPrice;
                return total + ((listPrice - finalPrice) * item.quantity);
              }, 0);

              if (itemLevelDiscount > 0) {
                return (
                  <div className="flex justify-between">
                    <span className="text-text-secondary">Discount (from items):</span>
                    <span className="text-state-success">-{Money.fromMajor(itemLevelDiscount, order.total_amount.currency).format()}</span>
                  </div>
                );
              }

              return null;
            })()}

            <div className="flex justify-between text-base font-semibold border-t border-border-default pt-2">
              <span className="text-text-primary">Total:</span>
              <span className="text-primary-600">{Money.fromMajor(order.total_amount.amount, order.total_amount.currency).format()}</span>
            </div>
          </div>
        </Card>
      </div>

      {/* Order Items */}
      <Card className="admin-card p-6">
        <h3 className="text-lg font-semibold text-text-primary mb-4">Order Items</h3>
        <div className="space-y-3">
          {order.items.map((item, index) => {
            const itemKey = `${item.product_id}-${item.variant_id || 'default'}`;
            return (
              <div key={itemKey} className="flex items-center justify-between bg-surface p-4 rounded">
                {actionType === 'return' && (
                  <input
                    type="checkbox"
                    id={`item-${itemKey}`}
                    checked={selectedItems.has(itemKey)}
                    onChange={() => toggleItemSelection(item.product_id, item.variant_id)}
                    className="mr-3"
                  />
                )}
                <div className="flex-1">
                  <p className="text-text-primary font-medium">{item.product_name}</p>
                  <div className="text-sm space-y-1">
                    <p className="text-text-secondary">
                      Quantity: {item.quantity}
                    </p>
                    {(() => {
                      // BMC-164: unit_price/list_price arrive as MACH wire major units.
                      const currency = (typeof item.unit_price === 'object' && item.unit_price.currency) || order.total_amount.currency;
                      const finalPrice = typeof item.unit_price === 'number' ? item.unit_price : item.unit_price.amount;
                      const listPrice = item.list_price
                        ? (typeof item.list_price === 'number' ? item.list_price : item.list_price.amount)
                        : finalPrice;
                      const hasDiscount = listPrice > finalPrice;

                      return (
                        <div className="space-y-1">
                          {hasDiscount ? (
                            <>
                              <p className="text-text-muted">
                                List: {Money.fromMajor(listPrice, currency).format()} × {item.quantity} = {Money.fromMajor(listPrice, currency).times(item.quantity).format()}
                              </p>
                              <p className="text-state-success">
                                Discounted: {Money.fromMajor(finalPrice, currency).format()} × {item.quantity} = {Money.fromMajor(finalPrice, currency).times(item.quantity).format()}
                              </p>
                              <p className="text-state-sale text-xs">
                                Item savings: {Money.fromMajor(listPrice - finalPrice, currency).times(item.quantity).format()}
                              </p>
                            </>
                          ) : (
                            <p className="text-text-secondary">
                              Price: {Money.fromMajor(finalPrice, currency).format()} × {item.quantity}
                            </p>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                </div>
                <p className="text-text-primary font-semibold">
                  {Money.fromMajor(
                    typeof item.unit_price === 'number' ? item.unit_price : item.unit_price.amount,
                    (typeof item.unit_price === 'object' && item.unit_price.currency) || order.total_amount.currency
                  ).times(item.quantity).format()}
                </p>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Action Buttons */}
      {!actionType && order.status !== 'cancelled' && order.status !== 'refunded' && (
        <Card className="admin-card p-6">
          <h3 className="text-lg font-semibold text-text-primary mb-4">Returns & Exchanges</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Button
              onClick={() => setActionType('cancel')}
              variant="destructive"
              disabled={order.status === 'delivered'}
            >
              <XCircle className="w-4 h-4 mr-2" />
              Cancel Order
            </Button>
            <Button
              onClick={() => setActionType('return')}
              variant="secondary"
              disabled={order.status !== 'delivered'}
            >
              <RotateCcw className="w-4 h-4 mr-2" />
              Process Return
            </Button>
            <Button
              onClick={() => setActionType('exchange')}
              variant="outline"
              disabled={order.status !== 'delivered'}
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Process Exchange
            </Button>
          </div>
          <div className="mt-4 text-sm text-text-secondary">
            <p>• Cancellation: Available for pending/processing orders only</p>
            <p>• Returns & Exchanges: Available for delivered orders only</p>
            <p>• All actions will process appropriate Stripe refunds automatically</p>
          </div>
        </Card>
      )}

      {/* Action Forms */}
      {actionType && (
        <Card className="admin-card p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-text-primary">
              {actionType === 'cancel' ? 'Cancel Order' :
               actionType === 'return' ? 'Process Return' :
               'Process Exchange'}
            </h3>
            <Button
              onClick={() => {
                setActionType(null);
                setSelectedItems(new Set());
                setReason("");
              }}
              variant="ghost"
              className="text-text-secondary hover:text-text-primary"
            >
              <XCircle className="w-4 h-4" />
            </Button>
          </div>

          {actionType === 'cancel' && (
            <div className="space-y-4">
              <div className="bg-state-error-bg border border-state-error p-4 rounded">
                <div className="flex items-center space-x-2 mb-2">
                  <AlertTriangle className="w-4 h-4 text-state-error" />
                  <span className="font-medium text-state-error">Order Cancellation</span>
                </div>
                <p className="text-sm text-text-secondary">
                  This will cancel the entire order and process a full refund of {Money.fromMajor(order.total_amount.amount, order.total_amount.currency).format()}
                  to the customer&rsquo;s original payment method via Stripe.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">Cancellation Reason</label>
                <Textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="admin-input"
                  placeholder="Enter reason for cancellation..."
                  rows={3}
                />
              </div>

              <Button
                onClick={handleCancelOrder}
                disabled={!reason.trim() || actionLoading}
                variant="destructive"
              >
                {actionLoading ? (
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <XCircle className="w-4 h-4 mr-2" />
                )}
                Confirm Cancellation & Refund
              </Button>
            </div>
          )}

          {actionType === 'return' && (
            <div className="space-y-4">
              <div className="bg-state-warning-bg border border-state-warning p-4 rounded">
                <div className="flex items-center space-x-2 mb-2">
                  <RotateCcw className="w-4 h-4 text-state-warning" />
                  <span className="font-medium text-state-warning">Item Return Processing</span>
                </div>
                <p className="text-sm text-text-secondary">
                  Select individual items to return or use the buttons below to select all items.
                  Refund amounts include proportional tax and discount calculations.
                </p>
              </div>

              {/* Item Selection Controls */}
              <div className="flex items-center space-x-3">
                <Button
                  onClick={selectAllItems}
                  variant="outline"
                  size="sm"
                  className="border-border-default text-text-secondary hover:text-text-primary"
                >
                  Select All
                </Button>
                <Button
                  onClick={clearItemSelection}
                  variant="outline"
                  size="sm"
                  className="border-border-default text-text-secondary hover:text-text-primary"
                >
                  Clear Selection
                </Button>
                <span className="text-sm text-text-secondary">
                  {selectedItems.size} of {order?.items.length || 0} items selected
                </span>
              </div>

              {/* Return Calculation Preview */}
              {selectedItems.size > 0 && (() => {
                const calculation = calculateReturnAmount(Array.from(selectedItems));
                return (
                  <div className="bg-surface p-4 rounded border-l-4 border-state-success">
                    <h4 className="text-sm font-medium text-text-primary mb-3">Return Amount Breakdown</h4>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-text-secondary">Items Subtotal:</span>
                        <span className="text-text-primary">${(calculation.subtotal / 100).toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-text-secondary">Proportional Tax:</span>
                        <span className="text-text-primary">${(calculation.tax / 100).toFixed(2)}</span>
                      </div>
                      {calculation.discount > 0 && (
                        <div className="flex justify-between">
                          <span className="text-text-secondary">Proportional Discount:</span>
                          <span className="text-state-success">-${(calculation.discount / 100).toFixed(2)}</span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span className="text-text-secondary">Shipping Refund:</span>
                        <span className="text-text-primary">${(calculation.shipping / 100).toFixed(2)}</span>
                      </div>
                      {(calculation.restockingFee || 0) > 0 && (
                        <div className="flex justify-between">
                          <span className="text-text-secondary">Restocking Fee ({calculation.policy?.restockingFeePercent || 0}%):</span>
                          <span className="text-state-error">-${((calculation.restockingFee || 0) / 100).toFixed(2)}</span>
                        </div>
                      )}
                      <div className="col-span-2 border-t border-border-default pt-2 mt-2">
                        <div className="flex justify-between text-base font-semibold">
                          <span className="text-text-primary">Total Refund:</span>
                          <span className="text-primary-600">${(calculation.total / 100).toFixed(2)}</span>
                        </div>
                      </div>
                    </div>
                    <div className="text-xs text-text-secondary mt-2 space-y-1">
                      {calculation.discount > 0 && (
                        <p>* Discount prorated based on returned item value</p>
                      )}
                      {calculation.shipping > 0 ? (
                        <p>* Shipping refund included per refund policy</p>
                      ) : (
                        <p>* Shipping not refunded per refund policy</p>
                      )}
                      {(calculation.restockingFee || 0) > 0 && (
                        <p>* Restocking fee applied per refund policy</p>
                      )}
                      <p>* Refund policies can be configured in Admin Settings</p>
                    </div>
                  </div>
                );
              })()}

              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">Return Reason</label>
                <Textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="admin-input"
                  placeholder="Enter reason for return..."
                  rows={3}
                />
              </div>

              <Button
                onClick={handleReturnItems}
                disabled={selectedItems.size === 0 || !reason.trim() || actionLoading}
                variant="secondary"
              >
                {actionLoading ? (
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <RotateCcw className="w-4 h-4 mr-2" />
                )}
                Process Return & Refund {selectedItems.size > 0 && `($${(calculateReturnAmount(Array.from(selectedItems)).total / 100).toFixed(2)})`}
              </Button>
            </div>
          )}

          {actionType === 'exchange' && (
            <div className="space-y-4">
              <div className="bg-state-info-bg border border-state-info p-4 rounded">
                <div className="flex items-center space-x-2 mb-2">
                  <RefreshCw className="w-4 h-4 text-state-info" />
                  <span className="font-medium text-state-info">Exchange Processing</span>
                </div>
                <p className="text-sm text-text-secondary">
                  Exchange feature coming soon. This will allow customers to exchange items for different sizes,
                  colors, or products with automatic payment adjustments.
                </p>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Fulfillment History (BMC-216D) */}
      <FulfillmentTimeline events={events} loading={eventsLoading} error={eventsError} />

      {/* Refund History */}
      {order.extensions?.refunds && order.extensions.refunds.length > 0 && (
        <Card className="admin-card p-6">
          <h3 className="text-lg font-semibold text-text-primary mb-4">Refund History</h3>
          <div className="space-y-3">
            {order.extensions.refunds.map((refund: any, index: number) => (
              <div key={index} className="bg-surface p-4 rounded border-l-4 border-primary-500">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <Badge className={refund.type === 'full' ? 'bg-state-error' : 'bg-state-warning'}>
                      {refund.type === 'full' ? 'Full Refund' : 'Partial Refund'}
                    </Badge>
                    <span className="text-text-primary font-semibold">
                      ${(refund.amount / 100).toFixed(2)}
                    </span>
                    {/* BMC-213: reconciled from a refund issued outside the app
                        (Stripe Dashboard) rather than through the admin UI. */}
                    {refund.source === 'stripe_external' && (
                      <Badge className="bg-state-info">Stripe Dashboard</Badge>
                    )}
                  </div>
                  <span className="text-xs text-text-secondary">
                    {new Date(refund.processed_at).toLocaleDateString()}
                  </span>
                </div>
                <div className="text-sm text-text-secondary space-y-1">
                  <p><strong>Reason:</strong> {refund.reason}</p>
                  {refund.notes && <p><strong>Notes:</strong> {refund.notes}</p>}
                  {refund.items && refund.items.length > 0 && (
                    <p><strong>Items:</strong> {refund.items.length} item(s)</p>
                  )}
                  {/* A reconciled external refund may carry no id (the provenance
                      lookup is best-effort) — don't render a dangling label. */}
                  {refund.stripe_refund_id && (
                    <p className="text-xs text-text-secondary">
                      <strong>Stripe Refund ID:</strong> {refund.stripe_refund_id}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Notes Section */}
      {order.notes && (
        <Card className="admin-card p-6">
          <h3 className="text-lg font-semibold text-text-primary mb-4">Order Notes</h3>
          <p className="text-text-secondary whitespace-pre-line">{order.notes}</p>
        </Card>
      )}
    </div>
  );
}
