import { NextRequest } from 'next/server';
import { AgentContext } from './types';

export function parseAgentContext(request: NextRequest): AgentContext | null {
  try {
    const contextHeader = request.headers.get('X-Agent-Context');
    if (!contextHeader) {
      return null;
    }

    const context: AgentContext = JSON.parse(contextHeader);
    
    // Validate required fields
    if (!context.agentId || typeof context.agentId !== 'string') {
      throw new Error('agentId is required and must be a string');
    }

    // Validate optional fields
    if (context.userPreferences) {
      validateUserPreferences(context.userPreferences);
    }

    // Validate context size (max 1024 bytes)
    const contextSize = new TextEncoder().encode(contextHeader).length;
    if (contextSize > 1024) {
      throw new Error(`Agent context too large: ${contextSize} bytes (max 1024)`);
    }

    return context;
  } catch (error) {
    console.error('Failed to parse agent context:', error);
    return null;
  }
}

function validateUserPreferences(preferences: AgentContext['userPreferences']): void {
  if (!preferences) return;

  if (preferences.budget && (typeof preferences.budget !== 'number' || preferences.budget < 0)) {
    throw new Error('budget must be a positive number');
  }

  if (preferences.brands && !Array.isArray(preferences.brands)) {
    throw new Error('brands must be an array of strings');
  }

  if (preferences.activities && !Array.isArray(preferences.activities)) {
    throw new Error('activities must be an array of strings');
  }

  if (preferences.location && typeof preferences.location !== 'string') {
    throw new Error('location must be a string');
  }

  if (preferences.experience_level && typeof preferences.experience_level !== 'string') {
    throw new Error('experience_level must be a string');
  }
}

export function enhanceUserContext(agentContext: AgentContext | null, existingUserData?: any): any {
  if (!agentContext?.userPreferences) {
    return existingUserData || {};
  }

  return {
    ...existingUserData,
    budget: agentContext.userPreferences.budget,
    preferredBrands: agentContext.userPreferences.brands,
    activities: agentContext.userPreferences.activities,
    location: agentContext.userPreferences.location,
    experienceLevel: agentContext.userPreferences.experience_level,
    agentContext: agentContext.session_context
  };
}

// BMC-147: Date.now() + Math.random() gave only ~31 bits of predictable
// entropy for the session ID suffix. crypto.randomUUID() is Web Crypto —
// available as a global in the Workers runtime, Node 20+, and jsdom — and
// gives >=122 bits of cryptographically secure entropy. The `${agentId}_`
// prefix is preserved since callers may rely on it.
export function createAgentSessionId(agentId: string): string {
  return `${agentId}_${crypto.randomUUID()}`;
}