/**
 * LRUCache — простой LRU-кэш для результатов поиска
 * Ключ: hash-строка запроса + фильтров
 * Значение: результат retrieve() с TTL
 */

export interface LRUCacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class LRUCache<T> {
  private cache = new Map<string, LRUCacheEntry<T>>();
  private maxSize: number;
  private ttlMs: number;

  constructor(options: { maxSize?: number; ttlMs?: number } = {}) {
    this.maxSize = options.maxSize || 256;
    this.ttlMs = options.ttlMs || 60_000; // 60 сек по умолчанию
  }

  private hashKey(key: string): string {
    let h = 0;
    for (let i = 0; i < key.length; i++) {
      h = ((h << 5) - h + key.charCodeAt(i)) | 0;
    }
    return String(h >>> 0);
  }

  get(key: string): T | null {
    const hash = this.hashKey(key);
    const entry = this.cache.get(hash);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(hash);
      return null;
    }

    // LRU: перемещаем в конец (most recently used)
    this.cache.delete(hash);
    this.cache.set(hash, entry);
    return entry.value;
  }

  set(key: string, value: T): void {
    const hash = this.hashKey(key);

    // Если ключ уже существует, удаляем старую запись
    if (this.cache.has(hash)) {
      this.cache.delete(hash);
    }

    // Evict LRU entry если достигли лимита
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(hash, {
      value,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }

  get hitRate(): { hits: number; misses: number } | null {
    return null; // Можно добавить счётчики если нужно
  }
}
