import { OllamaClient, type ChatMessage } from './OllamaClient.js';
import { ReasoningBankSemantic } from './ReasoningBankSemantic.js';
import { ConfigStorage } from './ConfigStorage.js';

export interface MethodInfo {
  name: string;
  type: 'procedure' | 'function';
  code: string;
  startLine: number;
  endLine: number;
}

export class CodeAnalyzer {
  private ollama: OllamaClient;
  private rb: ReasoningBankSemantic;
  private configStorage: ConfigStorage;

  constructor(ollama: OllamaClient, rb: ReasoningBankSemantic, configStorage: ConfigStorage) {
    this.ollama = ollama;
    this.rb = rb;
    this.configStorage = configStorage;
  }

  async explainMethod(objectName: string, methodName: string): Promise<string> {
    const moduleText = await this.configStorage.getFullModuleTextForObject(objectName);
    if (!moduleText) {
      throw new Error(`Модуль для объекта "${objectName}" не загружен. Сначала выполните /load-config`);
    }

    const methodCode = this.extractMethod(moduleText, methodName);
    if (!methodCode) {
      throw new Error(`Метод "${methodName}" не найден в объекте "${objectName}"`);
    }

    const prompt = this.buildExplainPrompt(objectName, methodName, methodCode);

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: `Ты — эксперт по языку 1С (BSL) и платформе 1С:Предприятие.
Объясни код простыми словами, укажи:
- Назначение метода (что делает)
- Входные параметры (если есть)
- Основные шаги алгоритма (последовательность действий)
- Возможные ошибки или узкие места
- Рекомендации по оптимизации (если применимо)

Отвечай на русском языке, структурированно.`
      },
      { role: 'user', content: prompt },
    ];

    const explanation = await this.ollama.chat(messages);

    const id = `explain_${Date.now()}_${objectName.replace(/[^a-zA-Z0-9]/g, '_')}_${methodName}`;
    const metadata: Record<string, any> = {
      object: objectName,
      method: methodName,
      source_code: methodCode.slice(0, 1000),
      generated_by: 'ollama',
      timestamp: new Date().toISOString(),
    };
    
    await this.rb.recordExperience({
      id,
      task: `Объяснение: ${objectName}.${methodName}`,
      outcome: 'success',
      content: explanation.slice(0, 2000),
      domain: 'code-explanation',
      error_type: 'none',
      confidence: 0.9,
      metadata,
    });

    return explanation;
  }

  private extractMethod(moduleText: string, methodName: string): string | null {
    const escapedName = methodName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(
      `(?:Процедура|Функция)\\s+${escapedName}\\s*\\([^)]*\\)[\\s\\S]*?(?:КонецПроцедуры|КонецФункции))`,
      'i'
    );
    const match = moduleText.match(regex);
    return match ? match[0] : null;
  }

  private buildExplainPrompt(objectName: string, methodName: string, code: string): string {
    return `Объясни метод "${methodName}" объекта "${objectName}" на языке 1С.

Код:
\`\`\`bsl
${code}
\`\`\`

Опиши его назначение, логику работы, параметры и возможные проблемы.`;
  }

  async findDuplicates(): Promise<string> {
    return '🔍 Поиск дубликатов кода в разработке. Функция будет доступна в ближайшее время.';
  }

  async suggestRefactor(objectName?: string): Promise<string> {
    return '📊 Рекомендации по рефакторингу будут доступны после интеграции с замерами производительности.';
  }
}
