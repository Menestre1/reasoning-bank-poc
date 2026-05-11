import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OllamaClient } from '../src/OllamaClient.js';

const EMBEDDING_DIM = 768;

function createMockEmbeddingResponse(): any {
  return {
    ok: true,
    json: vi.fn().mockResolvedValue({
      embeddings: [Array.from({ length: EMBEDDING_DIM }, (_, i) => Math.sin(i) * 0.5)],
    }),
  };
}

function createMockErrorResponse(status: number): any {
  return {
    ok: false,
    status,
    text: vi.fn().mockResolvedValue('API error'),
  };
}

describe('OllamaClient', () => {
  let client: OllamaClient;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    client = new OllamaClient({
      baseUrl: 'http://test-ollama:11434',
      model: 'nomic-embed-text',
      temperature: 0,
      contextLength: 512,
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('getEmbedding', () => {
    it('should return embedding array of correct length', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(createMockEmbeddingResponse());
      const result = await client.getEmbedding('test text');
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(EMBEDDING_DIM);
    });

    it('should POST to /api/embed with correct body', async () => {
      const mockFetch = vi.fn().mockResolvedValue(createMockEmbeddingResponse());
      globalThis.fetch = mockFetch;

      await client.getEmbedding('hello world');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0]!;
      expect(url).toBe('http://test-ollama:11434/api/embed');
      expect(options.method).toBe('POST');
      const body = JSON.parse(options.body);
      expect(body.model).toBe('nomic-embed-text');
      expect(body.input).toBe('hello world');
    });

    it('should use custom model name', async () => {
      const mockFetch = vi.fn().mockResolvedValue(createMockEmbeddingResponse());
      globalThis.fetch = mockFetch;

      await client.getEmbedding('text', 'custom-embed-model');
      const [, options] = mockFetch.mock.calls[0]!;
      const body = JSON.parse(options.body);
      expect(body.model).toBe('custom-embed-model');
    });

    it('should throw on non-ok response', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(createMockErrorResponse(500));
      await expect(client.getEmbedding('fail')).rejects.toThrow('Embedding API error');
    });

    it('should return empty array when no embeddings in response', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ embeddings: [] }),
      });
      const result = await client.getEmbedding('empty');
      expect(result).toEqual([]);
    });

    it('should throw on network error', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
      await expect(client.getEmbedding('no-network')).rejects.toThrow('ECONNREFUSED');
    });
  });

  describe('constructor defaults', () => {
    it('should use env fallbacks for constructor options', () => {
      process.env.OLLAMA_BASE_URL = 'http://env-url:11434';
      process.env.OLLAMA_MODEL = 'env-model';
      const envClient = new OllamaClient();
      expect(envClient).toBeInstanceOf(OllamaClient);
      delete process.env.OLLAMA_BASE_URL;
      delete process.env.OLLAMA_MODEL;
    });
  });
});
