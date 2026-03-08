/**
 * Clerk Loader
 *
 * Creates users in Clerk Backend API with skipPasswordRequirement.
 * Used for migrating Shopify customers to Clerk authentication.
 */

import { createClerkClient } from '@clerk/clerk-sdk-node';
import { logger } from '../lib/logger.js';

export interface ClerkUserInput {
  email: string;
  firstName?: string;
  lastName?: string;
  shopifyId: string;
}

export interface ClerkUserResult {
  shopifyId: string;
  clerkUserId: string;
}

export interface ClerkUserError {
  shopifyId: string;
  error: string;
}

/**
 * Create users in Clerk with skipPasswordRequirement.
 *
 * Processes sequentially to respect Clerk API rate limits for <1K customers.
 * Handles duplicate email errors gracefully by looking up existing users.
 */
export async function createClerkUsers(
  customers: ClerkUserInput[],
  secretKey: string
): Promise<Array<ClerkUserResult | ClerkUserError>> {
  const clerk = createClerkClient({ secretKey });
  const results: Array<ClerkUserResult | ClerkUserError> = [];

  for (const customer of customers) {
    try {
      const user = await clerk.users.createUser({
        emailAddress: [customer.email],
        firstName: customer.firstName || undefined,
        lastName: customer.lastName || undefined,
        skipPasswordRequirement: true,
        publicMetadata: {
          shopifyCustomerId: customer.shopifyId,
          migratedAt: new Date().toISOString(),
        },
      });

      results.push({
        shopifyId: customer.shopifyId,
        clerkUserId: user.id,
      });

      logger.info(`Created Clerk user for ${customer.email} -> ${user.id}`);
    } catch (err: unknown) {
      // Check for duplicate email error -- try to look up existing user
      const errMsg = err instanceof Error ? err.message : String(err);

      if (
        errMsg.includes('already exists') ||
        errMsg.includes('taken') ||
        errMsg.includes('unique') ||
        errMsg.includes('duplicate')
      ) {
        logger.warn(
          `Customer ${customer.email} already exists in Clerk, looking up...`
        );

        try {
          const existingUsers = await clerk.users.getUserList({
            emailAddress: [customer.email],
          });

          // getUserList returns User[] directly
          const userList = Array.isArray(existingUsers)
            ? existingUsers
            : (existingUsers as { data: Array<{ id: string }> }).data ?? [];

          if (userList.length > 0) {
            const existingUser = userList[0];
            results.push({
              shopifyId: customer.shopifyId,
              clerkUserId: existingUser.id,
            });
            logger.info(
              `Found existing Clerk user for ${customer.email} -> ${existingUser.id}`
            );
            continue;
          }
        } catch (lookupErr) {
          logger.error(
            `Failed to look up existing user ${customer.email}`,
            lookupErr
          );
        }
      }

      logger.error(`Failed to create Clerk user for ${customer.email}`, err);
      results.push({
        shopifyId: customer.shopifyId,
        error: errMsg,
      });
    }
  }

  return results;
}
