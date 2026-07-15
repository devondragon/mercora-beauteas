import { NextRequest, NextResponse } from 'next/server';
import { authenticateAgent, hasPermission, COMMERCE_SCOPES } from '../../../../../../lib/mcp/auth';
import { parseAgentContext } from '../../../../../../lib/mcp/context';
import { placeOrder } from '../../../../../../lib/mcp/tools/order';
import { OrderRequest } from '../../../../../../lib/mcp/types';
import { errorDetails } from '../../../../../../lib/utils/error-response';

export async function POST(request: NextRequest) {
  const auth = await authenticateAgent(request, { isOrderOp: true });
  
  if (!auth.success) {
    return NextResponse.json({
      success: false,
      error: auth.error
    }, { status: 401 });
  }

  if (!hasPermission(auth.permissions, COMMERCE_SCOPES.PLACE_ORDERS)) {
    return NextResponse.json({
      success: false,
      error: {
        code: 'FORBIDDEN',
        message: "This tool requires an agent with the 'place:orders' permission"
      }
    }, { status: 403 });
  }

  try {
    const body = await request.json() as any;
    const agentContext = parseAgentContext(request, auth.agentId);
    
    const orderRequest: OrderRequest = {
      ...body,
      agent_context: agentContext || undefined
    };

    const sessionId = body.session_id || 'temp';
    const result = await placeOrder(orderRequest, sessionId, auth.agentId!);
    
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: {
        code: 'ORDER_PLACE_ERROR',
        message: 'Failed to place order',
        details: errorDetails(error)
      }
    }, { status: 500 });
  }
}