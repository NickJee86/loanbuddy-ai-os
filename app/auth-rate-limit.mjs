const attempts = new Map();
export function loginRateLimit(key, now = Date.now()) { const value = attempts.get(key) || { count: 0, resetAt: now + 15 * 60_000 }; if (value.resetAt <= now) { attempts.delete(key); return { allowed: true, remaining: 5 }; } return { allowed: value.count < 5, remaining: Math.max(0, 5 - value.count), retryAfter: Math.ceil((value.resetAt - now) / 1000) }; }
export function recordLoginFailure(key, now = Date.now()) { const value = attempts.get(key); attempts.set(key, !value || value.resetAt <= now ? { count: 1, resetAt: now + 15 * 60_000 } : { ...value, count: value.count + 1 }); }
export function clearLoginFailures(key) { attempts.delete(key); }
