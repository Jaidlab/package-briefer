import {LRUCache} from 'lru-cache'

export type ExternalCacheStorageOptions = {
  items: number
  seconds: number
}

export type ExternalCaches = {
  npm: ExternalCacheStorage
  npmx: ExternalCacheStorage
}

export class ExternalCacheStorage {
  private readonly cache: LRUCache<string, object>
  private readonly inFlight = new Map<string, Promise<object | undefined>>

  constructor(options: ExternalCacheStorageOptions) {
    this.cache = new LRUCache({
      max: options.items,
      ttl: options.seconds * 1000,
      ttlAutopurge: true,
    })
  }

  async getOrSet<T extends object | undefined>(key: string, factory: () => Promise<T>): Promise<T> {
    const cached = this.cache.get(key) as Exclude<T, undefined> | undefined
    if (cached !== undefined) {
      return cached
    }
    const existing = this.inFlight.get(key) as Promise<T> | undefined
    if (existing) {
      return existing
    }
    const valuePromise = factory()
    this.inFlight.set(key, valuePromise)
    try {
      const value = await valuePromise
      if (value !== undefined) {
        this.cache.set(key, value)
      }
      return value
    } finally {
      this.inFlight.delete(key)
    }
  }
}

export const createExternalCaches = (options: ExternalCacheStorageOptions): ExternalCaches => ({
  npm: new ExternalCacheStorage(options),
  npmx: new ExternalCacheStorage(options),
})
