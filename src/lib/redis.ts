/**
 * Redis Client Wrapper
 * 
 * Safely loads ioredis dynamically. If ioredis is not installed, REDIS_URL
 * is not configured, or running in Next.js Edge Runtime, gracefully returns null
 * so the system falls back to in-memory rate limiting without breaking Next.js build or dev.
 */

let redisClient: any = null;

export function getRedisClient(): any | null {
  // Edge runtime guard (e.g. Next.js Middleware / Edge routes) or missing REDIS_URL
  if (typeof window !== 'undefined' || process.env.NEXT_RUNTIME === 'edge' || !process.env.REDIS_URL) {
    return null;
  }

  if (!redisClient) {
    try {
      // Dynamic require using eval('require') prevents static bundlers (Turbopack/Webpack)
      // from attempting to trace 'ioredis' into Edge/Middleware bundles
      const req = eval('require');
      const Redis = req('ioredis');
      redisClient = new Redis(process.env.REDIS_URL, {
        maxRetriesPerRequest: 3,
        retryStrategy(times: number) {
          if (times > 3) return null;
          return Math.min(times * 200, 2000);
        },
      });
      redisClient.on('error', (err: { message: string }) => {
        console.error('[Redis] Connection error:', err.message);
      });
    } catch {
      // ioredis is not installed in node_modules — fallback to in-memory store
      return null;
    }
  }
  return redisClient;
}

