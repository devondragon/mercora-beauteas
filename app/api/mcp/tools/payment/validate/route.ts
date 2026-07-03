import { NextRequest, NextResponse } from 'next/server';
import { authenticateAgent } from '../../../../../../lib/mcp/auth';
import { parseAgentContext } from '../../../../../../lib/mcp/context';
import { validatePayment } from '../../../../../../lib/mcp/tools/payment';
import { requireOwnedSession } from '../../../../../../lib/mcp/session';

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
    const agentContext = parseAgentContext(request, auth.agentId);
    
    if (!body.payment_method) {
      return NextResponse.json({
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'payment_method is required'
        }
      }, { status: 400 });
    }
    
    if (!body.total_amount && body.total_amount !== 0) {
      return NextResponse.json({
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'total_amount is required'
        }
      }, { status: 400 });
    }
    
    // Get cart from session if not provided. A client-supplied session_id must
    // belong to the calling agent before we read its cart — same anti-pattern
    // as the shipping route (BMC-133 review): validatePayment doesn't currently
    // use the cart, but this keeps the read consistent with the other tools.
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

    const paymentRequest = {
      payment_method: body.payment_method,
      billing_address: body.billing_address,
      cart,
      total_amount: body.total_amount,
      agent_context: agentContext || undefined
    };

    const result = await validatePayment(paymentRequest, sessionId);
    
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: {
        code: 'PAYMENT_VALIDATION_ERROR',
        message: 'Failed to validate payment method',
        details: error instanceof Error ? error.message : 'Unknown error'
      }
    }, { status: 500 });
  }
}