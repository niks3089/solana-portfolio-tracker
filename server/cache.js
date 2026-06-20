/**
 * LRU Cache Configuration
 */

import { LRUCache } from 'lru-cache';

export const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Cache for individual wallet data (reusable across aggregates)
export const holdingsCache = new LRUCache({ max: 100000, ttl: CACHE_TTL });
export const lambdaDefiCache = new LRUCache({ max: 100000, ttl: CACHE_TTL });
export const dialectDefiCache = new LRUCache({ max: 100000, ttl: CACHE_TTL });
export const pnlCache = new LRUCache({ max: 100000, ttl: CACHE_TTL });

