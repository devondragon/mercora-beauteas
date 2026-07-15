import { NextRequest, NextResponse } from 'next/server';
import { authenticateAgent, hasPermission, requiredScopeForTool } from '../../../../../../lib/mcp/auth';
import { parseAgentContext } from '../../../../../../lib/mcp/context';
import { bulkAddToCart } from '../../../../../../lib/mcp/tools/cart';
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

  const requiredScope = requiredScopeForTool('bulk_add_to_cart');
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
    
    if (!body.items || !Array.isArray(body.items)) {
      return NextResponse.json({
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'items array is required'
        }
      }, { status: 400 });
    }
    
    const bulkRequest = {
      items: body.items as CartRequest[],
      sessionId: body.session_id || 'temp',
      agent_context: agentContext || undefined
    };

    const sessionId = body.session_id || 'temp';
    const result = await bulkAddToCart(bulkRequest, sessionId, auth.agentId!);
    
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: {
        code: 'BULK_ADD_ERROR',
        message: 'Failed to bulk add items to cart',
        details: errorDetails(error)
      }
    }, { status: 500 });
  }
}