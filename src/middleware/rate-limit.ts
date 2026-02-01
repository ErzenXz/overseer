/**
 * Rate Limiting Middleware for Express/Next.js
 * Apply rate limits to API routes
 */

import { NextRequest, NextResponse } from "next/server";
import { getRateLimiter } from "../lib/rate-limiter";

/**
 * Get user identifier from request
 * Priority: authenticated user > IP address
 */
export function getUserIdentifier(request: NextRequest): string {
  // Try to get authenticated user from headers/cookies
  const authHeader = request.headers.get("authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.substring(7);
    // In a real app, decode JWT or session token here
    // For now, use the token itself as identifier
    return `auth:${token}`;
  }

  // Fall back to IP address
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded
    ? forwarded.split(",")[0]
    : request.headers.get("x-real-ip") || "unknown";
  
  return `ip:${ip}`;
}

/**
 * Rate limit middleware for API routes
 */
export async function rateLimitMiddleware(
  request: NextRequest,
  options: {
    interfaceType?: "web" | "api";
    estimatedTokens?: number;
  } = {}
): Promise<NextResponse | null> {
  const rateLimiter = getRateLimiter();
  const userId = getUserIdentifier(request);
  const interfaceType = options.interfaceType || "api";

  try {
    // Check rate limits
    const result = await rateLimiter.checkLimit({
      userId,
      interfaceType,
      tokens: options.estimatedTokens,
    });

    if (!result.allowed) {
      // Rate limit exceeded - return 429
      const response = NextResponse.json(
        {
          error: "Rate limit exceeded",
          message: result.reason,
          retryAfter: result.retryAfter
            ? Math.ceil(result.retryAfter / 1000)
            : undefined,
        },
        { status: 429 }
      );

      // Add rate limit headers
      if (result.limits) {
        response.headers.set(
          "X-RateLimit-Limit",
          result.limits.rpm.limit.toString()
        );
        response.headers.set(
          "X-RateLimit-Remaining",
          Math.max(0, result.limits.rpm.limit - result.limits.rpm.current).toString()
        );
        response.headers.set(
          "X-RateLimit-Reset",
          new Date(Date.now() + (result.retryAfter || 0)).toISOString()
        );
      }

      if (result.retryAfter) {
        response.headers.set(
          "Retry-After",
          Math.ceil(result.retryAfter / 1000).toString()
        );
      }

      return response;
    }

    // Add rate limit info to response headers (for allowed requests)
    if (result.limits) {
      request.headers.set("x-rate-limit-remaining", result.limits.rpm.limit - result.limits.rpm.current + "");
      request.headers.set("x-rate-limit-limit", result.limits.rpm.limit + "");
    }

    // Return null to indicate the request should proceed
    return null;
  } catch (error) {
    console.error("Rate limit middleware error:", error);
    // On error, allow the request through (fail open)
    return null;
  }
}

/**
 * Create a rate limit middleware wrapper for API routes
 */
export function withRateLimit(
  handler: (request: NextRequest) => Promise<NextResponse>,
  options: {
    interfaceType?: "web" | "api";
    estimatedTokens?: number;
  } = {}
) {
  return async (request: NextRequest): Promise<NextResponse> => {
    // Check rate limit
    const rateLimitResponse = await rateLimitMiddleware(request, options);
    
    if (rateLimitResponse) {
      // Rate limit exceeded
      return rateLimitResponse;
    }

    // Proceed with original handler
    return handler(request);
  };
}

/**
 * Record successful API request (call after response is sent)
 */
export function recordApiRequest(params: {
  userId: string;
  interfaceType: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
  conversationId?: number;
}): void {
  try {
    const rateLimiter = getRateLimiter();
    rateLimiter.recordRequest(params);
  } catch (error) {
    console.error("Error recording API request:", error);
  }
}

/**
 * Add rate limit headers to response
 */
export function addRateLimitHeaders(
  response: NextResponse,
  userId: string
): NextResponse {
  try {
    const rateLimiter = getRateLimiter();
    const status = rateLimiter.getStatus(userId);

    response.headers.set(
      "X-RateLimit-Limit-RPM",
      status.limits.rpm.toString()
    );
    response.headers.set(
      "X-RateLimit-Remaining-RPM",
      status.buckets.rpm.toString()
    );
    response.headers.set(
      "X-RateLimit-Limit-TPM",
      status.limits.tpm.toString()
    );
    response.headers.set(
      "X-RateLimit-Remaining-TPM",
      status.buckets.tpm.toString()
    );
    response.headers.set(
      "X-RateLimit-Limit-Daily",
      status.usage.dailyLimit.toString()
    );
    response.headers.set(
      "X-RateLimit-Remaining-Daily",
      status.usage.dailyRemaining.toString()
    );
    response.headers.set(
      "X-RateLimit-Limit-Monthly",
      status.usage.monthlyLimit.toString()
    );
    response.headers.set(
      "X-RateLimit-Remaining-Monthly",
      status.usage.monthlyRemaining.toString()
    );

    return response;
  } catch (error) {
    console.error("Error adding rate limit headers:", error);
    return response;
  }
}

/**
 * Express-compatible middleware (if needed)
 */
export function expressRateLimitMiddleware(options: {
  interfaceType?: "web" | "api";
  estimatedTokens?: number;
} = {}) {
  return async (req: any, res: any, next: any) => {
    const rateLimiter = getRateLimiter();
    
    // Get user ID from request
    const userId =
      req.user?.id ||
      req.headers["x-user-id"] ||
      req.ip ||
      "unknown";

    try {
      const result = await rateLimiter.checkLimit({
        userId,
        interfaceType: options.interfaceType || "api",
        tokens: options.estimatedTokens,
      });

      if (!result.allowed) {
        // Add headers
        if (result.limits) {
          res.setHeader("X-RateLimit-Limit", result.limits.rpm.limit);
          res.setHeader(
            "X-RateLimit-Remaining",
            Math.max(0, result.limits.rpm.limit - result.limits.rpm.current)
          );
        }

        if (result.retryAfter) {
          res.setHeader("Retry-After", Math.ceil(result.retryAfter / 1000));
        }

        return res.status(429).json({
          error: "Rate limit exceeded",
          message: result.reason,
          retryAfter: result.retryAfter
            ? Math.ceil(result.retryAfter / 1000)
            : undefined,
        });
      }

      // Add rate limit info to response
      if (result.limits) {
        res.setHeader("X-RateLimit-Limit", result.limits.rpm.limit);
        res.setHeader(
          "X-RateLimit-Remaining",
          Math.max(0, result.limits.rpm.limit - result.limits.rpm.current)
        );
      }

      next();
    } catch (error) {
      console.error("Rate limit middleware error:", error);
      // Fail open - allow request
      next();
    }
  };
}
