import { LRUCache } from 'lru-cache';
import type { Holdings, DefiPosition, TokenPnL } from './types.js';

export const CACHE_TTL = 5 * 60 * 1000;

export const holdingsCache = new LRUCache<string, Holdings>({ max: 100_000, ttl: CACHE_TTL });
export const lambdaDefiCache = new LRUCache<string, DefiPosition[]>({ max: 100_000, ttl: CACHE_TTL });
export const dialectDefiCache = new LRUCache<string, DefiPosition[]>({ max: 100_000, ttl: CACHE_TTL });
// LRU values can't be `null` in the type param; we encode "negative cache" via .has()/.get() returning undefined.
export const pnlCache = new LRUCache<string, TokenPnL>({ max: 100_000, ttl: CACHE_TTL });
