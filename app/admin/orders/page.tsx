/**
 * === Admin Orders Management Page ===
 *
 * Comprehensive order management interface for administrators to view, edit,
 * and process customer orders. Features advanced search, filtering, status
 * updates, and detailed order information with inline editing capabilities.
 *
 * === Features ===
 * - **Order Listing**: Complete order history with expandable details
 * - **Search & Filter**: Find orders by ID, customer, or status
 * - **Status Management**: Update order status with tracking information
 * - **Inline Editing**: Edit tracking numbers, notes, and order details
 * - **Customer Information**: View customer details and shipping addresses
 * - **Order Statistics**: Revenue metrics and order count summaries
 * - **Returns Management**: Placeholder for future returns processing
 * - **Responsive Design**: Mobile-optimized interface with collapsible sections
 *
 * === Order Management Features ===
 * - **Status Updates**: Pending → Processing → Shipped → Delivered workflow
 * - **Tracking Integration**: Add and manage shipping tracking numbers
 * - **Order Notes**: Internal notes for order processing and customer service
 * - **Customer Communication**: Direct access to customer contact information
 * - **Financial Overview**: Order totals, payment status, and revenue tracking
 * - **Bulk Operations**: Future support for batch order processing
 *
 * === Technical Implementation ===
 * - **Client Component**: Interactive interface with real-time updates
 * - **API Integration**: Fetches and updates orders via admin API endpoints
 * - **State Management**: Local state for order data, filters, and UI states
 * - **Error Handling**: Graceful error handling with user feedback
 * - **Performance**: Efficient data loading with pagination support
 * - **Type Safety**: Full TypeScript support with Order interface
 *
 * === Order Status Workflow ===
 * - **Pending**: New orders awaiting processing
 * - **Processing**: Orders being prepared for shipment
 * - **Shipped**: Orders in transit with tracking information
 * - **Delivered**: Successfully completed orders
 * - **Cancelled**: Cancelled orders with reason tracking
 * - **Refunded**: Refunded orders with refund information
 *
 * === Data Sources ===
 * - `/api/orders?admin=true` - Order listing and updates
 * - Authentication temporarily disabled for development
 * - Real-time order status and customer information
 *
 * @returns JSX element with complete order management interface
 */

"use client";

import { useState, useEffect, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  ClipboardList, Search, Filter, Eye, Edit, Truck,
  Calendar, DollarSign, User, MapPin, Package,
  RefreshCw, ChevronDown, ChevronRight,
  CheckCircle, Clock, ArrowRight, MoreHorizontal,
  RotateCcw, ChevronLeft, ChevronsLeft, ChevronsRight
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { orderStatusConfig } from "@/lib/ui/status-styles";

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
    product_name: string;
    quantity: number;
    unit_price: number | { amount: number };
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
    subtotal?: number;
    shippingCost?: number;
    taxAmount?: number;
    discountAmount?: number;
    carrier?: string;
    trackingUrl?: string;
    email?: string;
    [key: string]: any;
  };
}

export default function AdminOrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set());
  const [editingOrder, setEditingOrder] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    status: "",
    tracking_number: "",
    carrier: "",
    notes: ""
  });
  // Pagination state
  const [totalOrders, setTotalOrders] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [ordersPerPage] = useState(20); // Same as products page
  const [totalPages, setTotalPages] = useState(1);

  const fetchOrders = useCallback(async (page: number = 1) => {
    try {
      setLoading(true);
      const offset = (page - 1) * ordersPerPage;
      const url = `/api/orders?admin=true&limit=${ordersPerPage}&offset=${offset}`;
      const response = await fetch(url);

      if (response.ok) {
        const result = await response.json() as any;
        const orders: Order[] = result?.data || [];
        const meta = result?.meta || {};

        // Update pagination state from API metadata
        const total = meta.total || orders.length;
        setTotalOrders(total);
        setTotalPages(Math.ceil(total / ordersPerPage));
        setCurrentPage(page);

        setOrders(orders);
      } else {
        console.error("Failed to fetch orders");
      }
    } catch (error) {
      console.error("Error fetching orders:", error);
    } finally {
      setLoading(false);
    }
  }, [ordersPerPage]);

  const handlePageChange = (page: number) => {
    setLoading(true);
    fetchOrders(page);
  };

  const updateOrderStatus = async (orderId: string, updates: Partial<Order>) => {
    try {
      const response = await fetch("/api/orders", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          orderId,
          ...updates
        }),
      });

      if (response.ok) {
        const updatedData = await response.json() as { data: Order };
        setOrders(prev => prev.map(order =>
          order.id === orderId ? updatedData.data : order
        ));
        setEditingOrder(null);
        setEditForm({ status: "", tracking_number: "", carrier: "", notes: "" });
      } else {
        alert("Failed to update order");
      }
    } catch (error) {
      console.error("Error updating order:", error);
      alert("Error updating order");
    }
  };

  const handleEditSubmit = (orderId: string) => {
    const updates: any = {};
    if (editForm.status) updates.status = editForm.status;
    if (editForm.tracking_number) updates.tracking_number = editForm.tracking_number;
    if (editForm.notes) updates.notes = editForm.notes;

    // Handle carrier information in extensions
    if (editForm.carrier || editForm.tracking_number) {
      const currentOrder = orders.find(o => o.id === orderId);
      const currentExtensions = currentOrder?.extensions || {};
      updates.extensions = {
        ...currentExtensions,
        ...(editForm.carrier && { carrier: editForm.carrier }),
        ...(editForm.tracking_number && editForm.carrier && {
          trackingUrl: generateTrackingUrl(editForm.tracking_number, editForm.carrier)
        })
      };
    }

    if (editForm.status === "shipped") {
      updates.shipped_at = new Date().toISOString();
    }
    if (editForm.status === "delivered") {
      updates.delivered_at = new Date().toISOString();
    }

    updateOrderStatus(orderId, updates);
  };

  const toggleOrderExpansion = (orderId: string) => {
    setExpandedOrders(prev => {
      const newSet = new Set(prev);
      if (newSet.has(orderId)) {
        newSet.delete(orderId);
      } else {
        newSet.add(orderId);
      }
      return newSet;
    });
  };

  // Apply client-side filtering to current page results
  const filteredOrders = orders.filter(order => {
    const matchesStatus = statusFilter === "all" || order.status === statusFilter;
    const matchesSearch = searchQuery === "" ||
      order.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      order.shipping_address?.recipient?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      order.items.some(item => item.product_name.toLowerCase().includes(searchQuery.toLowerCase()));

    return matchesStatus && matchesSearch;
  });

  // For stats, use totalOrders from API metadata instead of local orders array
  const totalOrdersForStats = totalOrders;
  const pendingOrdersCount = orders.filter(o => o.status === 'pending').length; // This is just for current page
  const shippedOrdersCount = orders.filter(o => o.status === 'shipped').length; // This is just for current page

  const formatCurrency = (amount: number, currency: string = "USD") => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
    }).format(amount / 100);
  };

  const generateTrackingUrl = (trackingNumber: string, carrier?: string) => {
    if (!trackingNumber) return null;

    const normalizedCarrier = carrier?.toLowerCase() || '';

    if (normalizedCarrier.includes('ups')) {
      return `https://www.ups.com/track?track=yes&trackNums=${trackingNumber}`;
    } else if (normalizedCarrier.includes('fedex')) {
      return `https://www.fedex.com/fedextrack/?trknbr=${trackingNumber}`;
    } else if (normalizedCarrier.includes('usps')) {
      return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${trackingNumber}`;
    } else if (normalizedCarrier.includes('dhl')) {
      return `https://www.dhl.com/us-en/home/tracking/tracking-express.html?submit=1&tracking-id=${trackingNumber}`;
    }

    // Generic tracking search for unknown carriers
    return `https://www.google.com/search?q=track+package+${trackingNumber}`;
  };

  const getStatusBadge = (status: Order["status"]) => {
    const config = orderStatusConfig[status];
    const Icon = config.icon;
    return (
      <Badge variant={config.variant} className="text-xs">
        <Icon className="w-3 h-3 mr-1" />
        {config.label}
      </Badge>
    );
  };

  useEffect(() => {
    fetchOrders(1);
  }, [fetchOrders]);

  if (loading) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="w-8 h-8 text-primary-500 animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary mb-2">Order Management</h1>
          <p className="text-text-secondary">View and manage customer orders</p>
        </div>
        <Button
          onClick={() => fetchOrders(currentPage)}
          disabled={loading}
          className="bg-primary-500 hover:bg-primary-600"
        >
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="admin-card p-4">
          <div className="flex items-center space-x-3">
            <ClipboardList className="w-8 h-8 text-state-info" />
            <div>
              <p className="text-sm text-text-secondary">Total Orders</p>
              <p className="text-2xl font-bold text-text-primary">{totalOrdersForStats}</p>
            </div>
          </div>
        </Card>

        <Card className="admin-card p-4">
          <div className="flex items-center space-x-3">
            <Clock className="w-8 h-8 text-state-warning" />
            <div>
              <p className="text-sm text-text-secondary">Pending (Page)</p>
              <p className="text-2xl font-bold text-text-primary">
                {pendingOrdersCount}
              </p>
            </div>
          </div>
        </Card>

        <Card className="admin-card p-4">
          <div className="flex items-center space-x-3">
            <Truck className="w-8 h-8 text-state-info" />
            <div>
              <p className="text-sm text-text-secondary">Shipped (Page)</p>
              <p className="text-2xl font-bold text-text-primary">
                {shippedOrdersCount}
              </p>
            </div>
          </div>
        </Card>

        <Card className="admin-card p-4">
          <div className="flex items-center space-x-3">
            <DollarSign className="w-8 h-8 text-state-success" />
            <div>
              <p className="text-sm text-text-secondary">Revenue</p>
              <p className="text-2xl font-bold text-text-primary">
                {formatCurrency(orders.reduce((sum, order) =>
                  sum + (order.total_amount?.amount || 0), 0
                ))}
              </p>
            </div>
          </div>
        </Card>
      </div>

      {/* Filters */}
      <Card className="admin-card p-4">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-text-secondary w-4 h-4" />
              <Input
                placeholder="Search orders by ID, customer, or product..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 admin-input"
              />
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <Filter className="w-4 h-4 text-text-secondary" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 border admin-input rounded-md"
            >
              <option value="all">All Status</option>
              <option value="pending">Pending</option>
              <option value="processing">Processing</option>
              <option value="shipped">Shipped</option>
              <option value="delivered">Delivered</option>
              <option value="cancelled">Cancelled</option>
              <option value="refunded">Refunded</option>
            </select>
          </div>
        </div>
      </Card>

      {/* Orders List */}
      <Card className="admin-card">
        {filteredOrders.length === 0 ? (
          <div className="p-8 text-center">
            <ClipboardList className="w-12 h-12 text-text-muted mx-auto mb-4" />
            <h3 className="text-lg font-medium text-text-secondary mb-2">No orders found</h3>
            <p className="text-text-muted">No orders match your current filters</p>
          </div>
        ) : (
          <div className="divide-y divide-border-default">
            {filteredOrders.map((order) => {
              const isExpanded = expandedOrders.has(order.id);
              const isEditing = editingOrder === order.id;

              return (
                <div key={order.id} className="p-4">
                  {/* Order Header */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-4">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => toggleOrderExpansion(order.id)}
                        className="text-text-secondary hover:text-text-primary p-1"
                      >
                        {isExpanded ? (
                          <ChevronDown className="w-4 h-4" />
                        ) : (
                          <ChevronRight className="w-4 h-4" />
                        )}
                      </Button>

                      <div>
                        <h3 className="font-medium text-text-primary">#{order.id}</h3>
                        <div className="flex items-center space-x-3 text-sm text-text-secondary">
                          <span className="flex items-center">
                            <Calendar className="w-3 h-3 mr-1" />
                            {new Date(order.created_at).toLocaleDateString()}
                          </span>
                          <span className="flex items-center">
                            <User className="w-3 h-3 mr-1" />
                            {order.shipping_address?.recipient || "Guest"}
                          </span>
                          <span className="flex items-center">
                            <Package className="w-3 h-3 mr-1" />
                            {order.items.length} items
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center space-x-3">
                      {getStatusBadge(order.status)}
                      <span className="text-lg font-semibold text-text-primary">
                        {formatCurrency(order.total_amount.amount, order.currency_code)}
                      </span>
                      <div className="flex items-center space-x-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => window.location.href = `/admin/orders/${order.id}`}
                          className="text-xs"
                          title="Returns & Exchanges"
                        >
                          <RotateCcw className="w-3 h-3 mr-1" />
                          Returns
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            if (isEditing) {
                              setEditingOrder(null);
                              setEditForm({ status: "", tracking_number: "", carrier: "", notes: "" });
                            } else {
                              setEditingOrder(order.id);
                              setEditForm({
                                status: order.status,
                                tracking_number: order.tracking_number || "",
                                carrier: order.extensions?.carrier || "",
                                notes: order.notes || ""
                              });
                            }
                          }}
                          className="text-text-secondary hover:text-text-primary"
                          title="Quick Edit"
                        >
                          <Edit className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </div>

                  {/* Order Details (Expanded) */}
                  {isExpanded && (
                    <div className="mt-4 pl-8 space-y-4">
                      {/* Order Breakdown */}
                      <div>
                        <h4 className="text-sm font-medium text-text-secondary mb-2">Order Summary</h4>
                        <div className="bg-surface p-4 rounded space-y-2">
                          {/* Items */}
                          <div className="space-y-2 mb-4">
                            {order.items.map((item, index) => (
                              <div key={index} className="flex items-center justify-between">
                                <div className="flex-1">
                                  <p className="text-text-primary text-sm">{item.product_name}</p>
                                  <p className="text-xs text-text-secondary">
                                    {item.quantity} × {formatCurrency(
                                      typeof item.unit_price === 'number'
                                        ? item.unit_price
                                        : item.unit_price.amount
                                    )}
                                  </p>
                                </div>
                                <p className="text-text-primary font-medium text-sm">
                                  {formatCurrency(
                                    (typeof item.unit_price === 'number'
                                      ? item.unit_price
                                      : item.unit_price.amount) * item.quantity
                                  )}
                                </p>
                              </div>
                            ))}
                          </div>

                          {/* Order Breakdown */}
                          <div className="border-t border-border-default pt-3 space-y-1">
                            {order.extensions?.subtotal && (
                              <div className="flex justify-between text-sm">
                                <span className="text-text-secondary">Subtotal:</span>
                                <span className="text-text-primary">{formatCurrency(order.extensions.subtotal)}</span>
                              </div>
                            )}
                            {order.extensions?.shippingCost && (
                              <div className="flex justify-between text-sm">
                                <span className="text-text-secondary">Shipping:</span>
                                <span className="text-text-primary">{formatCurrency(order.extensions.shippingCost)}</span>
                              </div>
                            )}
                            {order.extensions?.taxAmount && (
                              <div className="flex justify-between text-sm">
                                <span className="text-text-secondary">Tax:</span>
                                <span className="text-text-primary">{formatCurrency(order.extensions.taxAmount)}</span>
                              </div>
                            )}
                            {order.extensions?.discountAmount && (
                              <div className="flex justify-between text-sm">
                                <span className="text-text-secondary">Discount:</span>
                                <span className="text-state-success">-{formatCurrency(order.extensions.discountAmount)}</span>
                              </div>
                            )}
                            <div className="flex justify-between text-base font-semibold border-t border-border-default pt-2">
                              <span className="text-text-primary">Total:</span>
                              <span className="text-primary-600">{formatCurrency(order.total_amount.amount)}</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Payment & Shipping Info */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Payment Method */}
                        <div>
                          <h4 className="text-sm font-medium text-text-secondary mb-2">Payment Method</h4>
                          <div className="bg-surface p-3 rounded text-sm text-text-secondary">
                            <div className="flex items-center space-x-2">
                              <DollarSign className="w-4 h-4 text-state-success" />
                              <span>{order.payment_method || 'Not specified'}</span>
                            </div>
                            <div className="text-xs text-text-secondary mt-1">
                              Status: <span className={`font-medium ${
                                order.payment_status === 'paid' ? 'text-state-success' :
                                order.payment_status === 'failed' ? 'text-state-error' :
                                order.payment_status === 'refunded' ? 'text-state-error' :
                                'text-state-warning'
                              }`}>
                                {order.payment_status || 'pending'}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Shipping Address */}
                        {order.shipping_address && (
                          <div>
                            <h4 className="text-sm font-medium text-text-secondary mb-2">Shipping Address</h4>
                            <div className="bg-surface p-3 rounded text-sm text-text-secondary">
                              <div>{order.shipping_address.recipient}</div>
                              <div>{order.shipping_address.line1}</div>
                              <div>
                                {order.shipping_address.city}, {order.shipping_address.region} {order.shipping_address.postal_code}
                              </div>
                              <div>{order.shipping_address.country}</div>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Tracking & Notes */}
                      {(order.tracking_number || order.notes) && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {order.tracking_number && (
                            <div>
                              <h4 className="text-sm font-medium text-text-secondary mb-2">Tracking Information</h4>
                              <div className="bg-surface p-3 rounded text-sm text-text-secondary">
                                <div className="flex items-center justify-between">
                                  <div>
                                    <p className="font-medium">{order.tracking_number}</p>
                                    {order.extensions?.carrier && (
                                      <p className="text-xs text-text-secondary mt-1">Carrier: {order.extensions.carrier}</p>
                                    )}
                                  </div>
                                  {(() => {
                                    const trackingUrl = generateTrackingUrl(order.tracking_number, order.extensions?.carrier);
                                    return trackingUrl ? (
                                      <Button
                                        onClick={() => window.open(trackingUrl, '_blank')}
                                        size="sm"
                                        className="bg-primary-500 hover:bg-primary-600 text-xs"
                                      >
                                        <Truck className="w-3 h-3 mr-1" />
                                        Track
                                      </Button>
                                    ) : null;
                                  })()}
                                </div>
                              </div>
                            </div>
                          )}
                          {order.notes && (
                            <div>
                              <h4 className="text-sm font-medium text-text-secondary mb-2">Notes</h4>
                              <div className="bg-surface p-3 rounded text-sm text-text-secondary">
                                {order.notes}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Edit Form */}
                      {isEditing && (
                        <div className="bg-surface p-4 rounded-lg space-y-4">
                          <h4 className="text-sm font-medium text-text-primary">Edit Order</h4>

                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                            <div>
                              <label className="block text-sm font-medium text-text-secondary mb-2">Status</label>
                              <select
                                value={editForm.status}
                                onChange={(e) => setEditForm(prev => ({ ...prev, status: e.target.value }))}
                                className="w-full px-3 py-2 border admin-input rounded-md"
                              >
                                <option value="pending">Pending</option>
                                <option value="processing">Processing</option>
                                <option value="shipped">Shipped</option>
                                <option value="delivered">Delivered</option>
                              </select>
                            </div>

                            <div>
                              <label className="block text-sm font-medium text-text-secondary mb-2">Carrier</label>
                              <select
                                value={editForm.carrier}
                                onChange={(e) => setEditForm(prev => ({ ...prev, carrier: e.target.value }))}
                                className="w-full px-3 py-2 border admin-input rounded-md"
                              >
                                <option value="">Select carrier</option>
                                <option value="UPS">UPS</option>
                                <option value="FedEx">FedEx</option>
                                <option value="USPS">USPS</option>
                                <option value="DHL">DHL</option>
                                <option value="Other">Other</option>
                              </select>
                            </div>

                            <div>
                              <label className="block text-sm font-medium text-text-secondary mb-2">Tracking Number</label>
                              <Input
                                value={editForm.tracking_number}
                                onChange={(e) => setEditForm(prev => ({ ...prev, tracking_number: e.target.value }))}
                                className="admin-input"
                                placeholder="Enter tracking number"
                              />
                            </div>

                            <div>
                              <label className="block text-sm font-medium text-text-secondary mb-2">Notes</label>
                              <Textarea
                                value={editForm.notes}
                                onChange={(e) => setEditForm(prev => ({ ...prev, notes: e.target.value }))}
                                className="admin-input"
                                placeholder="Add notes..."
                                rows={2}
                              />
                            </div>
                          </div>

                          <div className="flex items-center space-x-3">
                            <Button
                              onClick={() => handleEditSubmit(order.id)}
                            >
                              <CheckCircle className="w-4 h-4 mr-2" />
                              Save Changes
                            </Button>
                            <Button
                              variant="outline"
                              onClick={() => {
                                setEditingOrder(null);
                                setEditForm({ status: "", tracking_number: "", carrier: "", notes: "" });
                              }}
                              className="border-border-default text-text-secondary hover:text-text-primary"
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Pagination Controls */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between admin-card border rounded-lg p-4">
          <div className="flex items-center space-x-2 text-sm text-text-secondary">
            <span>Showing</span>
            <span className="font-medium text-text-primary">
              {Math.min((currentPage - 1) * ordersPerPage + 1, totalOrders)}-{Math.min(currentPage * ordersPerPage, totalOrders)}
            </span>
            <span>of</span>
            <span className="font-medium text-text-primary">{totalOrders}</span>
            <span>orders</span>
          </div>

          <div className="flex items-center space-x-1">
            {/* First Page */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handlePageChange(1)}
              disabled={currentPage === 1 || loading}
              className="text-text-secondary hover:text-text-primary"
            >
              <ChevronsLeft className="w-4 h-4" />
            </Button>

            {/* Previous Page */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handlePageChange(currentPage - 1)}
              disabled={currentPage === 1 || loading}
              className="text-text-secondary hover:text-text-primary"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>

            {/* Page Numbers */}
            <div className="flex items-center space-x-1">
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let pageNum;
                if (totalPages <= 5) {
                  pageNum = i + 1;
                } else if (currentPage <= 3) {
                  pageNum = i + 1;
                } else if (currentPage >= totalPages - 2) {
                  pageNum = totalPages - 4 + i;
                } else {
                  pageNum = currentPage - 2 + i;
                }

                return (
                  <Button
                    key={pageNum}
                    variant={currentPage === pageNum ? "default" : "ghost"}
                    size="sm"
                    onClick={() => handlePageChange(pageNum)}
                    disabled={loading}
                    className={`min-w-[2rem] ${
                      currentPage === pageNum
                        ? ""
                        : "text-text-secondary hover:text-text-primary"
                    }`}
                  >
                    {pageNum}
                  </Button>
                );
              })}
            </div>

            {/* Next Page */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handlePageChange(currentPage + 1)}
              disabled={currentPage === totalPages || loading}
              className="text-text-secondary hover:text-text-primary"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>

            {/* Last Page */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handlePageChange(totalPages)}
              disabled={currentPage === totalPages || loading}
              className="text-text-secondary hover:text-text-primary"
            >
              <ChevronsRight className="w-4 h-4" />
            </Button>
          </div>

          <div className="flex items-center space-x-2">
            <span className="text-sm text-text-secondary">Page</span>
            <span className="font-medium text-text-primary">{currentPage}</span>
            <span className="text-sm text-text-secondary">of</span>
            <span className="font-medium text-text-primary">{totalPages}</span>
          </div>
        </div>
      )}

    </div>
  );
}
