import { NextRequest, NextResponse } from 'next/server';
import { authenticateAgent } from '../../../../../lib/mcp/auth';
import { parseAgentContext } from '../../../../../lib/mcp/context';
import { getShippingOptions } from '../../../../../lib/mcp/tools/shipping';
import { requireOwnedSession } from '../../../../../lib/mcp/session';

export async function POST(request: NextRequest) {
  const auth = await authenticateAgent(request);
  
  if (!auth.success) {
    return NextResponse.json({
      success: false,
      error: auth.error
    }, { status: 401 });
  }

  try {
    const body = await request.json() as any;
    const agentContext = parseAgentContext(request);
    
    if (!body.address) {
      return NextResponse.json({
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'Shipping address is required'
        }
      }, { status: 400 });
    }
    
    // Get cart from session if not provided. A client-supplied session_id must
    // belong to the calling agent before we read its cart — otherwise an
    // attacker agent could pass a victim's session_id (omitting body.cart) and
    // learn that victim's cart size/value via the shipping weight/cost
    // (BMC-133 review — same disclosure vector already gated for get_cart).
    const sessionId = body.session_id || 'temp';
    let cart = body.cart;
    if (!cart) {
      const owned = await requireOwnedSession(sessionId, auth.agentId!);
      if (!owned.ok) {
        return NextResponse.json({
          success: false,
          error: {
            code: owned.code,
            message: owned.message
          }
        }, { status: 403 });
      }
      cart = owned.session.cart;
    }

    const shippingRequest = {
      address: body.address,
      cart,
      agent_context: agentContext || undefined
    };

    const result = await getShippingOptions(shippingRequest, sessionId);
    
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: {
        code: 'SHIPPING_ERROR',
        message: 'Failed to get shipping options',
        details: error instanceof Error ? error.message : 'Unknown error'
      }
    }, { status: 500 });
  }
}