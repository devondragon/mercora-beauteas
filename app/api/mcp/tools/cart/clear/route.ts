import { NextRequest, NextResponse } from 'next/server';
import { authenticateAgent, hasPermission, COMMERCE_SCOPES } from '../../../../../../lib/mcp/auth';
import { clearCart } from '../../../../../../lib/mcp/tools/cart';
import { errorDetails } from '../../../../../../lib/utils/error-response';

export async function POST(request: NextRequest) {
  const auth = await authenticateAgent(request);
  
  if (!auth.success) {
    return NextResponse.json({
      success: false,
      error: auth.error
    }, { status: 401 });
  }

  if (!hasPermission(auth.permissions, COMMERCE_SCOPES.WRITE_CART)) {
    return NextResponse.json({
      success: false,
      error: {
        code: 'FORBIDDEN',
        message: "This tool requires an agent with the 'write:cart' permission"
      }
    }, { status: 403 });
  }

  try {
    const body = await request.json() as any;
    const sessionId = body.session_id || 'temp';
    
    const result = await clearCart(sessionId, auth.agentId!);
    
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: {
        code: 'CART_CLEAR_ERROR',
        message: 'Failed to clear cart',
        details: errorDetails(error)
      }
    }, { status: 500 });
  }
}