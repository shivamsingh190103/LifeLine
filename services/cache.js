let createClient = null;
try {
  ({ createClient } = require('redis'));
} catch (error) {
  createClient = null;
}

const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

class CacheService {
  constructor() {
    this.memoryCache = new Map();
    this.client = null;
    this.redisConnected = false;
    this.redisRetryAt = 0;
    this.redisRetryMs = parsePositiveInt(process.env.REDIS_RETRY_MS, 30000);
    this.defaultTtlSeconds = parsePositiveInt(process.env.REDIS_CACHE_TTL_SECONDS, 120);
    this.statsData = {
      hits: 0,
      misses: 0,
      writes: 0,
      redisConnected: false,
      fallback: 'memory'
    };
  }

  getRedisConfig() {
    if (process.env.REDIS_URL) {
      return {
        url: process.env.REDIS_URL,
        socket: {
          connectTimeout: parsePositiveInt(process.env.REDIS_CONNECT_TIMEOUT_MS, 2000)
        }
      };
    }

    if (!process.env.REDIS_HOST) {
      return null;
    }

    const config = {
      socket: {
        host: process.env.REDIS_HOST,
        port: parsePositiveInt(process.env.REDIS_PORT, 6379),
        connectTimeout: parsePositiveInt(process.env.REDIS_CONNECT_TIMEOUT_MS, 2000)
      },
      database: parsePositiveInt(process.env.REDIS_DB, 0)
    };

    if (process.env.REDIS_PASSWORD) {
      config.password = process.env.REDIS_PASSWORD;
    }

    return config;
  }

  async ensureRedis() {
    const now = Date.now();
    if (this.redisConnected && this.client) {
      return true;
    }

    if (now < this.redisRetryAt) {
      return false;
    }

    const redisConfig = this.getRedisConfig();
    if (!redisConfig) {
      this.redisRetryAt = Number.MAX_SAFE_INTEGER;
      return false;
    }

    if (!createClient) {
      this.redisRetryAt = Date.now() + this.redisRetryMs;
      return false;
    }

    try {
      if (!this.client) {
        this.client = createClient(redisConfig);
        this.client.on('error', () => {
          this.redisConnected = false;
          this.statsData.redisConnected = false;
          this.redisRetryAt = Date.now() + this.redisRetryMs;
        });
      }

      if (!this.client.isOpen) {
        await this.client.connect();
      }

      this.redisConnected = true;
      this.statsData.redisConnected = true;
      this.statsData.fallback = 'redis';
      return true;
    } catch (error) {
      this.redisConnected = false;
      this.statsData.redisConnected = false;
      this.statsData.fallback = 'memory';
      this.redisRetryAt = Date.now() + this.redisRetryMs;
      return false;
    }
  }

  getFromMemory(key) {
    const item = this.memoryCache.get(key);
    if (!item) {
      return null;
    }

    if (Date.now() > item.expiresAt) {
      this.memoryCache.delete(key);
      return null;
    }

    return item.value;
  }

  setInMemory(key, value, ttlSeconds) {
    this.memoryCache.set(key, {
      value,
      expiresAt: Date.now() + (ttlSeconds * 1000)
    });
  }

  async get(key) {
    const hasRedis = await this.ensureRedis();
    if (hasRedis) {
      try {
        const value = await this.client.get(key);
        if (value === null) {
          this.statsData.misses += 1;
          return null;
        }
        this.statsData.hits += 1;
        return JSON.parse(value);
      } catch (error) {
        this.redisConnected = false;
        this.statsData.redisConnected = false;
        this.redisRetryAt = Date.now() + this.redisRetryMs;
      }
    }

    const memoryValue = this.getFromMemory(key);
    if (memoryValue === null) {
      this.statsData.misses += 1;
      return null;
    }

    this.statsData.hits += 1;
    return memoryValue;
  }

  async set(key, value, ttlSeconds = this.defaultTtlSeconds) {
    const normalizedTtl = parsePositiveInt(ttlSeconds, this.defaultTtlSeconds);
    const hasRedis = await this.ensureRedis();
    if (hasRedis) {
      try {
        await this.client.setEx(key, normalizedTtl, JSON.stringify(value));
        this.statsData.writes += 1;
        return;
      } catch (error) {
        this.redisConnected = false;
        this.statsData.redisConnected = false;
        this.redisRetryAt = Date.now() + this.redisRetryMs;
      }
    }

    this.setInMemory(key, value, normalizedTtl);
    this.statsData.writes += 1;
  }

  async invalidatePrefix(prefix) {
    const hasRedis = await this.ensureRedis();
    if (hasRedis) {
      try {
        let cursor = '0';
        do {
          const { cursor: nextCursor, keys } = await this.client.scan(cursor, {
            MATCH: `${prefix}*`,
            COUNT: 100
          });
          cursor = nextCursor;
          if (keys.length > 0) {
            await this.client.del(keys);
          }
        } while (cursor !== '0');
      } catch (error) {
        this.redisConnected = false;
        this.statsData.redisConnected = false;
      }
    }

    for (const key of this.memoryCache.keys()) {
      if (key.startsWith(prefix)) {
        this.memoryCache.delete(key);
      }
    }
  }

  stats() {
    return {
      ...this.statsData,
      memoryKeys: this.memoryCache.size
    };
  }
}

module.exports = new CacheService();
