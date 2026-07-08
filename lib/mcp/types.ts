import { Product } from '../types';
import { CartItem } from '../types/cartitem';
import { MACHAddress as Address } from '../types/mach/Address';
import type { MachMoney } from '../money';

// Agent Context
export interface AgentContext {
  agentId: string;
  userId?: string;
  userPreferences?: {
    budget?: number;
    brands?: string[];
    activities?: string[];
    location?: string;
    experience_level?: string;
  };
  session_context?: string;
}

// MCP Session Management
export interface AgentSession {
  sessionId: string;
  agentId: string;
  userContext: AgentContext;
  cart: CartItem[];
  created_at: string;
  expires_at: string;
}

// Enhanced MCP Response Format
export interface MCPToolResponse<T> {
  success: boolean;
  data: T;
  context: {
    session_id: string;
    agent_id: string;
    processing_time_ms: number;
  };
  error?: {
    code: string;
    message: string;
    details?: string;
    retryable?: boolean;
    suggestion?: string;
  };
  recommendations?: {
    alternative_sites?: string[];
    bundling_opportunities?: string[];
    cost_optimization?: string[];
  };
  metadata: {
    can_fulfill_percentage: number;
    estimated_satisfaction: number;
    next_actions?: string[];
  };
}

// Tool Request Types
export interface SearchRequest {
  query: string;
  options?: {
    category?: string;
    priceMin?: number;
    priceMax?: number;
    limit?: number;
    sortBy?: 'price' | 'rating' | 'popularity';
  };
  agent_context?: AgentContext;
}

export interface AssessRequest {
  requirements: {
    items: string[];
    budget: number;
    timeline: string;
    location: string;
  };
  agent_context?: AgentContext;
}

export interface RecommendRequest {
  context: {
    currentProduct?: number;
    userActivity?: string;
    budget?: number;
    useCase?: string;
  };
  agent_context?: AgentContext;
}

export interface CartRequest {
  productId: number;
  variantId: number;
  quantity?: number;
  agent_context?: AgentContext;
}

export interface OrderRequest {
  shippingAddress: Address;
  billingAddress?: Address;
  paymentMethod: string;
  shippingOption: string;
  specialInstructions?: string;
  agent_context?: AgentContext;
  // BMC-132 (C5): a placed order must be backed by a server-verified Stripe
  // PaymentIntent minted for this agent+session via create_payment_intent.
  // Without it place_order fails closed and no order is created.
  paymentIntentId?: string;
}

// BMC-132: request to mint a Stripe PaymentIntent for an MCP order. The amount
// is derived server-side from the session cart (catalog prices) — never from
// the caller — and the resulting PI is stamped with { agentId, sessionId } so
// place_order can verify it is bound to this caller before fulfilling.
export interface PaymentIntentCreateRequest {
  shippingAddress?: Address;
  agent_context?: AgentContext;
}

export interface PaymentIntentCreateResponse {
  clientSecret: string | null;
  paymentIntentId: string;
  amount: number;
  currency: string;
}

// Tool Response Types
export interface CapabilitiesResponse {
  categories: string[];
  price_ranges: Record<string, { min: number; max: number }>;
  shipping_regions: string[];
  specialties: string[];
}

export interface AssessResponse {
  can_fulfill: string[];
  cannot_fulfill: string[];
  recommendations: Product[];
  // MACH wire shape (BMC-164) — see lib/money/wire.ts toWireMoney.
  estimated_cost: MachMoney;
  estimated_delivery: string;
}

export interface CartResponse {
  cart: CartItem[];
  total_items: number;
  // MACH wire shape (BMC-164) — see lib/money/wire.ts toWireMoney. CartItem.price
  // stays cents internally; only this aggregate is wire-converted.
  estimated_total: MachMoney;
}

export interface OrderResponse {
  orderId: string;
  status: string;
  // MACH wire shape (BMC-164) — see lib/money/wire.ts toWireMoney.
  total: MachMoney;
  tracking_number?: string;
  estimated_delivery: string;
}

// Authentication Types
export interface AgentAuthConfig {
  agentId: string;
  apiKey: string;
  permissions: string[];
  rateLimits: {
    requests_per_minute: number;
    orders_per_hour: number;
  };
}

// Error Response
export interface MCPError {
  success: false;
  error: {
    code: string;
    message: string;
    details?: any;
  };
  context: {
    session_id?: string;
    agent_id?: string;
    timestamp: string;
  };
}

// Chunked Response for large datasets
export interface ChunkedResponse<T> {
  chunk: number;
  total_chunks: number;
  data: T[];
  next_token?: string;
}