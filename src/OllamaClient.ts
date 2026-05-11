import 'dotenv/config';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ModelInfo {
  name: string;
  modified_at: string;
  size: number;
  digest: string;
  details?: {
    parent_model: string;
    format: string;
    family: string;
    families: string[];
    parameter_size: string;
    quantization_level: string;
  };
}

export class OllamaClient {
  private apiKey: string;
  private baseUrl: string;
  private defaultModel: string;
  private temperature: number;
  private contextLength: number;

  constructor(options?: {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    temperature?: number;
    contextLength?: number;
  }) {
    this.apiKey = options?.apiKey || process.env.OLLAMA_API_KEY || '';
    this.baseUrl = options?.baseUrl || process.env.OLLAMA_BASE_URL || 'https://ollama.com';
    this.defaultModel = options?.model || process.env.OLLAMA_MODEL || 'gpt-oss:20b-cloud';
    this.temperature = options?.temperature ?? parseFloat(process.env.OLLAMA_TEMPERATURE || '0.7');
    this.contextLength = options?.contextLength ?? parseInt(process.env.OLLAMA_CONTEXT_LENGTH || '4096');
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.apiKey && this.baseUrl.includes('ollama.com')) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  async listModels(): Promise<ModelInfo[]> {
    const url = `${this.baseUrl}/api/tags`;
    try {
      const response = await fetch(url, { headers: this.getHeaders() });
      if (!response.ok) {
        throw new Error(`Failed to fetch models: ${response.status}`);
      }
      const data = await response.json();
      return data.models || [];
    } catch (error: any) {
      console.error('OllamaClient listModels Error:', error.message);
      throw error;
    }
  }

  async chat(messages: ChatMessage[], model?: string): Promise<string> {
    const selectedModel = model || this.defaultModel;
    const url = `${this.baseUrl}/api/chat`;

    const body = {
      model: selectedModel,
      messages: messages,
      stream: false,
      options: {
        temperature: this.temperature,
        num_ctx: this.contextLength,
      },
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API Error (${response.status}): ${errorText}`);
      }

      const data = await response.json();
      return data.message?.content || 'No response';
    } catch (error: any) {
      console.error('OllamaClient Error:', error.message);
      throw error;
    }
  }

  /**
   * Callback-based streaming (kept for backward compatibility)
   */
  async chatStreamCallback(
    messages: ChatMessage[],
    onChunk: (chunk: string) => void,
    model?: string
  ): Promise<void> {
    for await (const chunk of this.chatStream(messages, { model })) {
      onChunk(chunk);
    }
  }

  /**
   * AsyncGenerator-based streaming — yields tokens as they arrive.
   * Supports optional AbortSignal for cancellation.
   */
  async *chatStream(
    messages: ChatMessage[],
    options?: { model?: string; temperature?: number; signal?: AbortSignal }
  ): AsyncGenerator<string> {
    const selectedModel = options?.model || this.defaultModel;
    const url = `${this.baseUrl}/api/chat`;

    const body = {
      model: selectedModel,
      messages: messages,
      stream: true,
      options: {
        temperature: options?.temperature ?? this.temperature,
        num_ctx: this.contextLength,
      },
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body),
      signal: options?.signal,
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status}`);
    }

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();

    if (!reader) return;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (line.trim()) {
          try {
            const data = JSON.parse(line);
            if (data.message?.content) {
              yield data.message.content;
            }
          } catch {
            // ignore parse errors for partial chunks
          }
        }
      }
    }
  }

  async getEmbedding(text: string, model?: string): Promise<number[]> {
    const embedModel = model || 'nomic-embed-text';
    const url = `${this.baseUrl}/api/embed`;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ model: embedModel, input: text }),
      });
      if (!response.ok) throw new Error(`Embedding API error: ${response.status}`);
      const data = await response.json();
      return data.embeddings?.[0] || [];
    } catch (err: any) {
      console.error(`[OllamaClient] Embedding error (${embedModel}): ${err.message}`);
      throw err;
    }
  }

  async ping(model?: string): Promise<boolean> {
    try {
      await this.chat([{ role: 'user', content: 'ping' }], model);
      return true;
    } catch {
      return false;
    }
  }
}
