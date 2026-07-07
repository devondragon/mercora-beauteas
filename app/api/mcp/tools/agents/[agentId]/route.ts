import { NextRequest, NextResponse } from 'next/server';
import { authenticateAgent, hasAgentManagementPermission } from '../../../../../../lib/mcp/auth';
import { getAgentDetails, updateAgentStatus } from '../../../../../../lib/mcp/tools/agent';
import { errorDetails } from '../../../../../../lib/utils/error-response';

const FORBIDDEN_RESPONSE = {
  success: false,
  error: {
    code: 'FORBIDDEN',
    message: 'Agent management requires an agent with admin or agents:manage permission'
  }
} as const;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const auth = await authenticateAgent(request);

  if (!auth.success) {
    return NextResponse.json({
      success: false,
      error: auth.error
    }, { status: 401 });
  }

  // Inspecting an agent exposes its recent session ids and stats — a plain
  // commerce agent must not read another agent's details (BMC-133, C7).
  // Fail closed.
  if (!hasAgentManagementPermission(auth.permissions)) {
    return NextResponse.json(FORBIDDEN_RESPONSE, { status: 403 });
  }

  try {
    const { agentId } = await params;
    const { searchParams } = request.nextUrl;
    const sessionId = searchParams.get('session_id') || 'temp';
    
    const result = await getAgentDetails(agentId, sessionId, auth.agentId!);
    
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: {
        code: 'AGENT_DETAILS_ERROR',
        message: 'Failed to get agent details',
        details: errorDetails(error)
      }
    }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const auth = await authenticateAgent(request);

  if (!auth.success) {
    return NextResponse.json({
      success: false,
      error: auth.error
    }, { status: 401 });
  }

  // Enabling/disabling an agent is a privileged operation — a plain commerce
  // agent must not be able to deactivate other agents (BMC-133, C8). Fail closed.
  if (!hasAgentManagementPermission(auth.permissions)) {
    return NextResponse.json(FORBIDDEN_RESPONSE, { status: 403 });
  }

  try {
    const { agentId } = await params;
    const body = await request.json() as any;
    
    // Currently only support status updates
    if (typeof body.isActive !== 'boolean') {
      return NextResponse.json({
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'isActive boolean field is required'
        }
      }, { status: 400 });
    }
    
    const sessionId = body.session_id || 'temp';
    const result = await updateAgentStatus(
      agentId,
      body.isActive,
      sessionId,
      auth.agentId!
    );
    
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: {
        code: 'AGENT_UPDATE_ERROR',
        message: 'Failed to update agent',
        details: errorDetails(error)
      }
    }, { status: 500 });
  }
}