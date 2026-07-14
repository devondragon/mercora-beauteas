import { NextRequest, NextResponse } from 'next/server';
import { authenticateAgent } from '../../../../../../lib/mcp/auth';
import { MCPToolResponse } from '../../../../../../lib/mcp/types';
import { errorDetails } from '../../../../../../lib/utils/error-response';
import { getOrderById } from '../../../../../../lib/models/mach/orders';
import { describeOrderDelivery } from '../../../../../../lib/mcp/tools/order';

interface TrackingResponse {
  orderId: string;
  trackingNumber?: string;
  status: string;
  location?: string;
  estimatedDelivery: string;
  history: Array<{
    date: string;
    status: string;
    location?: string;
    description: string;
  }>;
}

// Build a tracking response from a real order (BMC-181) — no fabricated data.
// The order is looked up and ownership-checked by the caller; history is
// assembled only from timestamps the order actually carries.
function buildTracking(order: NonNullable<Awaited<ReturnType<typeof getOrderById>>>): TrackingResponse {
  const history: TrackingResponse['history'] = [];
  if (order.created_at) {
    history.push({
      date: order.created_at,
      status: 'order_confirmed',
      description: 'Order received and processing'
    });
  }
  if (order.shipped_at) {
    history.push({
      date: order.shipped_at,
      status: 'shipped',
      description: 'Package shipped'
    });
  }
  if (order.delivered_at) {
    history.push({
      date: order.delivered_at,
      status: 'delivered',
      description: 'Package delivered'
    });
  }

  return {
    orderId: order.id!.toString(),
    trackingNumber: order.tracking_number || undefined,
    status: order.status,
    estimatedDelivery: describeOrderDelivery(order),
    history
  };
}

// Resolve an order for tracking, scoped to the calling agent (BMC-181). MCP
// orders carry the placing agent's id in extensions.agent_id (see placeOrder);
// an agent may only track an order it placed. Returns an IDENTICAL not-found for
// a missing order and one owned by another agent so an agent can't probe order
// ids it doesn't own (closes the latent IDOR).
async function resolveTracking(
  orderId: string | null,
  agentId: string
): Promise<
  | { ok: true; response: MCPToolResponse<TrackingResponse> }
  | { ok: false; status: number; body: { success: false; error: { code: string; message: string } } }
> {
  if (!orderId) {
    return {
      ok: false,
      status: 400,
      body: { success: false, error: { code: 'MISSING_ORDER_ID', message: 'orderId is required' } }
    };
  }

  const order = await getOrderById(orderId);
  if (!order || !order.extensions?.agent_id || order.extensions.agent_id !== agentId) {
    return {
      ok: false,
      status: 404,
      body: { success: false, error: { code: 'ORDER_NOT_FOUND', message: 'No order found for this agent with that ID.' } }
    };
  }

  return {
    ok: true,
    response: {
      success: true,
      data: buildTracking(order),
      context: {
        session_id: 'tracking',
        agent_id: agentId,
        processing_time_ms: 0
      },
      metadata: {
        can_fulfill_percentage: 100,
        estimated_satisfaction: 95,
        next_actions: ['Monitor delivery progress', 'Prepare for package arrival']
      }
    }
  };
}

export async function GET(request: NextRequest) {
  const auth = await authenticateAgent(request);

  if (!auth.success) {
    return NextResponse.json({
      success: false,
      error: auth.error
    }, { status: 401 });
  }

  try {
    const orderId = request.nextUrl.searchParams.get('orderId');

    const result = await resolveTracking(orderId, auth.agentId!);
    if (!result.ok) {
      return NextResponse.json(result.body, { status: result.status });
    }

    return NextResponse.json(result.response);
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: {
        code: 'TRACKING_ERROR',
        message: 'Failed to get tracking information',
        details: errorDetails(error)
      }
    }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  // Alternative POST method for tracking lookup
  const auth = await authenticateAgent(request);
  
  if (!auth.success) {
    return NextResponse.json({
      success: false,
      error: auth.error
    }, { status: 401 });
  }

  try {
    const body = await request.json() as any;
    const orderId: string | null = body?.orderId ?? null;

    const result = await resolveTracking(orderId, auth.agentId!);
    if (!result.ok) {
      return NextResponse.json(result.body, { status: result.status });
    }

    return NextResponse.json(result.response);
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: {
        code: 'TRACKING_ERROR',
        message: 'Failed to get tracking information',
        details: errorDetails(error)
      }
    }, { status: 500 });
  }
}