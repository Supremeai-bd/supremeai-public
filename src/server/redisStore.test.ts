import { describe, expect, it } from 'vitest';
import { encodeRespCommand, parseRedisUrl, PersistentSessionMap } from './redisStore';

describe('redisStore', () => {
  it('parses redis and rediss URLs cleanly', () => {
    const plain = parseRedisUrl('redis://default:secret@redis.internal:6380/2');
    expect(plain).toEqual({
      host: 'redis.internal',
      port: 6380,
      username: 'default',
      password: 'secret',
      db: 2,
      useTls: false,
    });

    const secure = parseRedisUrl('rediss://:upstash_tok@us1-example.upstash.io:6379');
    expect(secure?.useTls).toBe(true);
    expect(secure?.password).toBe('upstash_tok');
    expect(parseRedisUrl('http://not-redis')).toBeNull();
  });

  it('encodes RESP2 array frames accurately', () => {
    expect(encodeRespCommand(['SET', 'mykey', 'hello'])).toBe(
      '*3\r\n$3\r\nSET\r\n$5\r\nmykey\r\n$5\r\nhello\r\n'
    );
  });

  it('functions identically to Map when REDIS_URL is unset', () => {
    const prev = process.env.REDIS_URL;
    delete process.env.REDIS_URL;
    try {
      const store = new PersistentSessionMap<string>('test:', 60, true);
      store.set('tok_abc', 'usr_1');
      expect(store.get('tok_abc')).toBe('usr_1');
      expect(store.delete('tok_abc')).toBe(true);
      expect(store.get('tok_abc')).toBeUndefined();
    } finally {
      if (prev !== undefined) process.env.REDIS_URL = prev;
    }
  });
});
