import { NextRequest, NextResponse } from 'next/server';
import { authenticateAgent } from '../../../../../../lib/mcp/auth';
import { parseAgentContext } from '../../../../../../lib/mcp/context';
import { createAgentPaymentIntent } from '../../../../../../lib/mcp/tools/payment';
import { PaymentIntentCreateRequest } from '../../../../../../lib/mcp/types';
import { errorDetails } from '../../../../../../lib/utils/error-response';

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

    const intentRequest: PaymentIntentCreateRequest = {
      ...body,
      agent_context: agentContext || undefined
    };

    const sessionId = body.session_id || 'temp';
    const result = await createAgentPaymentIntent(intentRequest, sessionId, auth.agentId!);

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: {
        code: 'PAYMENT_INTENT_ERROR',
        message: 'Failed to create payment intent',
        details: errorDetails(error)
      }
    }, { status: 500 });
  }
}
