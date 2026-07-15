import { NextRequest, NextResponse } from 'next/server';
import { authenticateAgent, hasPermission, requiredScopeForTool } from '../../../../../../lib/mcp/auth';
import { parseAgentContext } from '../../../../../../lib/mcp/context';
import { addToCart } from '../../../../../../lib/mcp/tools/cart';
import { CartRequest } from '../../../../../../lib/mcp/types';
import { errorDetails } from '../../../../../../lib/utils/error-response';

export async function POST(request: NextRequest) {
  const auth = await authenticateAgent(request);
  
  if (!auth.success) {
    return NextResponse.json({
      success: false,
      error: auth.error
    }, { status: 401 });
  }

  const requiredScope = requiredScopeForTool('add_to_cart');
  if (requiredScope && !hasPermission(auth.permissions, requiredScope)) {
    return NextResponse.json({
      success: false,
      error: {
        code: 'FORBIDDEN',
        message: `This tool requires an agent with the '${requiredScope}' permission`
      }
    }, { status: 403 });
  }

  try {
    const body = await request.json() as any;
    const agentContext = parseAgentContext(request, auth.agentId);
    
    const cartRequest: CartRequest & { sessionId: string } = {
      ...body,
      agent_context: agentContext || undefined
    };

    const sessionId = body.session_id || 'temp';
    const result = await addToCart(cartRequest, sessionId, auth.agentId!);
    
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: {
        code: 'CART_ADD_ERROR',
        message: 'Failed to add item to cart',
        details: errorDetails(error)
      }
    }, { status: 500 });
  }
}