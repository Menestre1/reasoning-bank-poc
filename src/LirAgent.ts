import { ReasoningBankSemantic, type ErrorWarning, type ErrorType } from './ReasoningBankSemantic.js';
import { OllamaClient, type ChatMessage, type ModelInfo } from './OllamaClient.js';
import 'dotenv/config';
import { SafeFileSystemReader } from './SafeFileSystemReader.js';
import { ConfigLoader } from './ConfigLoader.js';
import { ConfigStorage } from './ConfigStorage.js';
import { PerformanceLoader } from './PerformanceLoader.js';
import { PerformanceStorage } from './PerformanceStorage.js';
import { DependencyGraph } from './DependencyGraph.js';
import { DependencyParser } from './DependencyParser.js';
import { ComparisonStorage } from './ComparisonStorage.js';
import { ConfigComparator } from './ConfigComparator.js';
import { CodeAnalyzer } from './CodeAnalyzer.js';
import { ToolRegistry } from './tools/ToolRegistry.js';
import { IntentAnalyzer } from './tools/IntentAnalyzer.js';
import { ToolOrchestrator } from './tools/ToolOrchestrator.js';
import { ToolExecutor } from './tools/ToolExecutor.js';
import { ToolIntegration } from './tools/ToolIntegration.js';
import { AgentToolDialog } from './tools/AgentToolDialog.js';
import { PatientKnowledgeBase } from './PatientKnowledgeBase.js';
import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';

type Language = '1С (BSL)' | 'JavaScript' | 'TypeScript' | 'Python' | 'Go' | 'general';

interface AgentSession {
  agentId: string;
  conversationHistory: ChatMessage[];
  lastExperienceId: string | null;
  lastUserInput: string;
  lastAgentResponse: string;
  lastDetectedLanguage?: Language;
  waitingForFeedback: boolean;
  waitingForErrorType: boolean;
  waitingForLanguage: boolean;
  pendingInput: string;
  // Tool states
  waitingForTool: boolean;
  pendingTool: any;
  pendingToolInput: string;
  waitingForToolParameter: boolean;
  pendingToolParamName: string | null;
  // Dialogue save
  lastDialogueId?: string | null;
}

const LANGUAGE_KEYWORDS: Record<Language, string[]> = {
  '1С (BSL)': ['1с', 'транзакц', 'начатьтранзакцию', 'записьжурналарегистрации', 'вызватьисключение', 'отменитьтранзакцию', 'зафиксироватьтранзакцию', 'блокировкаданных'],
  'JavaScript': ['function', 'console.log', 'const', 'let', '=>', 'typeof'],
  'TypeScript': [': string', 'interface', 'type', 'readonly', '.ts'],
  'Python': ['def ', 'import ', ':', 'print(', 'self.'],
  'Go': ['func ', 'package ', ':=', 'go ', 'defer'],
  'general': [],
};

export class LirAgent {
  private memory: ReasoningBankSemantic;
  private llmClient: OllamaClient;
  private session: AgentSession;
  private systemPrompt: string;
  private llmModel: string;
  private dbPath: string;
  private configLoader?: ConfigLoader;
  private configStorage?: ConfigStorage;
  private fsReader: SafeFileSystemReader;
  private perfStorage?: PerformanceStorage;
  private perfLoader?: PerformanceLoader;
  private depGraph?: DependencyGraph;
  private depParser?: DependencyParser;
  private compStorage?: ComparisonStorage;
  private comparator?: ConfigComparator;
  private codeAnalyzer?: CodeAnalyzer;
  private toolRegistry?: ToolRegistry;
  private intentAnalyzer?: IntentAnalyzer;
  private toolOrchestrator?: ToolOrchestrator;
  private toolExecutor?: ToolExecutor;
  private toolIntegration?: ToolIntegration;
  private agentToolDialog?: AgentToolDialog;
  private patientKB: PatientKnowledgeBase;

  constructor(options: {
    dbPath: string;
    agentId?: string;
    systemPrompt?: string;
    llmModel?: string;
    temperature?: number;
    contextLength?: number;
    patientKbPath?: string;
  }) {
    this.dbPath = options.dbPath;

    this.patientKB = new PatientKnowledgeBase(options.patientKbPath || './patient_kb.db');

    this.memory = new ReasoningBankSemantic({
      dbPath: options.dbPath,
      namespace: `agent:${options.agentId || 'lir'}`,
      hnswEnabled: true,
      cacheSize: 256,
    });

    this.llmClient = new OllamaClient({
      model: options.llmModel ?? 'gpt-oss:20b-cloud',
      ...(options.temperature !== undefined && { temperature: options.temperature }),
      ...(options.contextLength !== undefined && { contextLength: options.contextLength }),
    });
    this.llmModel = options.llmModel || process.env.OLLAMA_MODEL || 'gpt-oss:20b-cloud';

    this.session = {
      agentId: options.agentId || 'lir',
      conversationHistory: [],
      lastExperienceId: null,
      lastUserInput: '',
      lastAgentResponse: '',
      waitingForFeedback: false,
      waitingForErrorType: false,
      waitingForLanguage: false,
      pendingInput: '',
      // Tool states
      waitingForTool: false,
      pendingTool: null,
      pendingToolInput: '',
      waitingForToolParameter: false,
      pendingToolParamName: null,
    };

    this.systemPrompt = options.systemPrompt || 'Ты — Лирь, полезный ассистент. Отвечай кратко и по делу.';

    const allowedRoots = (process.env.ALLOWED_CONFIG_ROOTS?.split(',') || []).map(p => p.trim()) || [process.cwd()];
    this.fsReader = new SafeFileSystemReader(allowedRoots);

    // Initialize tool integration
    const toolThreshold = parseFloat(process.env.TOOL_SUGGESTION_THRESHOLD || '0.6');
    const allowedToolRoots = (process.env.ALLOWED_TOOL_ROOTS?.split(',') || []).map(p => p.trim()) || ['./tools'];
    const defaultTimeout = parseInt(process.env.TOOL_DEFAULT_TIMEOUT_SEC || '30');

    this.toolIntegration = new ToolIntegration(this.memory, {
      toolThreshold,
      allowedToolRoots,
      defaultTimeoutSec: defaultTimeout,
    });

    // Initialize AgentToolDialog
    if (this.toolIntegration) {
      this.agentToolDialog = new AgentToolDialog(
        this.toolIntegration,
        {
          waitingForTool: this.session.waitingForTool,
          pendingTool: this.session.pendingTool,
          pendingToolInput: this.session.pendingToolInput,
          waitingForToolParameter: this.session.waitingForToolParameter,
          pendingToolParamName: this.session.pendingToolParamName,
        },
        {
          onFeedback: (response) => {
            this.session.waitingForFeedback = true;
            this.session.lastUserInput = response;
          },
          onLanguageAsk: (question) => {
            this.session.waitingForLanguage = true;
            this.session.pendingInput = question;
          },
        }
      );
    }

    // Don't auto-initialize - let chat.ts control the order
  }

  private getErrorTypeOptions(): string {
    return `\nВыберите тип ошибки:\n\n1. 📢 эхолалия — повторение фразы пользователя\n2. 🔄 парафазия — искажение терминов, неправильный синтаксис\n3. 🌀 контаминация — смешивание разных контекстов\n4. 🎭 галлюцинация — выдумывание несуществующих функций\n\nВведите номер (1-4) или название ошибки:`;
  }

  private parseErrorTypeChoice(input: string): string | null {
    const lower = input.toLowerCase().trim();
    
    const errorTypes: Record<string, string> = {
      '1': 'эхолалия',
      'эхолалия': 'эхолалия',
      'эхо': 'эхолалия',
      '2': 'парафазия',
      'парафазия': 'парафазия',
      '3': 'контаминация',
      'контаминация': 'контаминация',
      '4': 'галлюцинация',
      'галлюцинация': 'галлюцинация',
      'галлюцинации': 'галлюцинация',
    };
    
    return errorTypes[lower] || null;
  }

  private detectLanguage(userInput: string): { language: Language; confidence: number; matches: string[] } {
    const lower = userInput.toLowerCase();
    const matches: string[] = [];
    
    for (const [lang, keywords] of Object.entries(LANGUAGE_KEYWORDS)) {
      if (lang === 'general') continue;
      for (const keyword of keywords) {
        if (lower.includes(keyword.toLowerCase())) {
          matches.push(`${lang}: ${keyword}`);
        }
      }
    }
    
    const scores: Record<Language, number> = {
      '1С (BSL)': 0,
      'JavaScript': 0,
      'TypeScript': 0,
      'Python': 0,
      'Go': 0,
      'general': 0,
    };
    
    for (const [lang, keywords] of Object.entries(LANGUAGE_KEYWORDS)) {
      if (lang === 'general') continue;
      for (const keyword of keywords) {
        if (lower.includes(keyword.toLowerCase())) {
          scores[lang as Language] = (scores[lang as Language] || 0) + 1;
        }
      }
    }
    
    let bestLanguage: Language = 'general';
    let bestScore = 0;
    
    for (const [lang, score] of Object.entries(scores)) {
      if (score > bestScore) {
        bestScore = score as number;
        bestLanguage = lang as Language;
      }
    }
    
    const confidence = bestScore > 0 ? Math.min(0.6 + bestScore * 0.1, 0.95) : 0;
    
    return { language: bestLanguage, confidence, matches };
  }

  async processMessage(userInput: string): Promise<any> {
    // Обработка команд загрузки и поиска
    if (userInput.startsWith('/load-config')) {
      const targetPath = userInput.slice(13).trim();
      if (!targetPath) return this.createResponse('Укажите путь к выгрузке конфигурации.');
      return this.handleLoadConfig(targetPath);
    }
    if (userInput.startsWith('/search-code')) {
      const query = userInput.slice(12).trim();
      if (!query) return this.createResponse('Укажите текст для поиска.');
      return this.handleSearchCode(query);
    }
    if (userInput.startsWith('/semantic-search')) {
      const query = userInput.slice(16).trim();
      if (!query) return this.createResponse('Укажите описание для семантического поиска.');
      return this.handleSemanticSearch(query);
    }
    if (userInput.startsWith('/load-measurements')) {
      const dirPath = userInput.slice(18).trim();
      if (!dirPath) return this.createResponse('Укажите путь к папке с замерами.');
      return this.handleLoadMeasurements(dirPath);
    }
    if (userInput.startsWith('/top-slow')) {
      const parts = userInput.slice(9).trim().split(' ') || [];
      const limit = parseInt(parts[0] || '10');
      const objectName = parts[1] || null;
      return this.handleTopSlow(limit, objectName);
    }
    if (userInput.startsWith('/explain-slow')) {
      const objectName = userInput.slice(13).trim();
      if (!objectName) return this.createResponse('Укажите имя объекта.');
      return this.handleExplainSlow(objectName);
    }
    if (userInput.startsWith('/build-graph')) {
      return this.handleBuildGraph();
    }
    if (userInput.startsWith('/callers')) {
      const parts = userInput.slice(8).trim().split('.');
      const objectName = parts[0] || '';
      const methodName = parts[1] || null;
      if (!objectName) return this.createResponse('Укажите имя объекта: /callers <Объект.Метод>');
      return this.handleCallers(objectName, methodName);
    }
    if (userInput.startsWith('/callees')) {
      const parts = userInput.slice(8).trim().split('.');
      const objectName = parts[0] || '';
      const methodName = parts[1] || null;
      if (!objectName) return this.createResponse('Укажите имя объекта: /callees <Объект.Метод>');
      return this.handleCallees(objectName, methodName);
    }
    if (userInput.startsWith('/cycles')) {
      return this.handleFindCycles();
    }
    if (userInput.startsWith('/graph-viz')) {
      const objectName = userInput.slice(10).trim() || null;
      return this.handleGraphViz(objectName);
    }
    if (userInput.startsWith('/compare-config')) {
      const parts = userInput.slice(16).trim().split(' ');
      if (parts.length < 2 || !parts[0] || !parts[1]) return this.createResponse('Укажите оба пути: /compare-config <old> <new>');
      return this.handleCompareConfig(parts[0], parts[1]);
    }
    if (userInput.startsWith('/comparison-summary')) {
      return this.handleComparisonSummary();
    }
    if (userInput.startsWith('/diff-module')) {
      const objectName = userInput.slice(13).trim();
      if (!objectName) return this.createResponse('Укажите имя объекта: /diff-module <объект>');
      return this.handleDiffModule(objectName);
    }
    if (userInput.startsWith('/changed-objects')) {
      const type = userInput.slice(17).trim() || null;
      return this.handleChangedObjects(type);
    }
    if (userInput.startsWith('/explain')) {
      const rest = userInput.slice(8).trim();
      if (!rest) return this.createResponse('Укажите объект и метод: /explain Объект.Метод');
      return this.handleExplain(rest);
    }
    if (userInput.startsWith('/extract-my-code')) {
      const parts = userInput.slice(16).trim().split(/\s+/);
      const inputFile = parts[0];
      const outputFile = parts[1] || './extracted_code.txt';
      if (!inputFile) return this.createResponse('Укажите входной файл. Пример: /extract-my-code ./1.txt ./my_code.txt');
      const result = await this.runExtractMyCode(inputFile, outputFile);
      this.session.waitingForFeedback = true;
      this.session.lastUserInput = userInput;
      return {
        response: `${result.response}\n\nЯ справился? (да/нет/отмена)`,
        fullPrompt: result.fullPrompt,
        warnings: result.warnings,
        action: 'waiting_feedback',
      };
    }

    // Learn from last successful dialog (only if NOT waiting for feedback)
    if (userInput === '/learn' && !this.session.waitingForFeedback) {
      return this.handleLearn();
    }

    // === TOOL INTEGRATION ===

    // 1. If waiting for tool confirmation
    if (this.session.waitingForTool) {
      console.log(`[LirAgent] Processing tool confirmation: "${userInput}"`);
      const result = await this.toolIntegration?.processConfirmation(
        userInput,
        this.session.pendingTool,
        this.session.pendingToolInput
      );

      if (result?.action === 'waiting_confirmation' || result?.action === 'waiting_parameter') {
        return {
          response: result.response || 'Waiting for input...',
          fullPrompt: '',
          warnings: [],
          action: 'respond',
        };
      }

      if (result?.action === 'completed') {
        this.session.waitingForTool = false;
        this.session.pendingTool = null;
        this.session.pendingToolInput = '';

        if (result.executionResult?.success) {
          return {
            response: `Tool executed: ${result.toolResponse}\n\nDid I succeed? (yes/no/cancel)`,
            fullPrompt: '',
            warnings: [],
            action: 'waiting_feedback',
          };
        } else {
          return {
            response: `Tool error: ${result.executionResult?.error || 'Unknown error'}`,
            fullPrompt: '',
            warnings: [],
            action: 'respond',
          };
        }
      }

      if (result?.action === 'cancelled') {
        this.session.waitingForTool = false;
        this.session.pendingTool = null;
        this.session.pendingToolInput = '';
        return {
          response: result.response || 'Cancelled.',
          fullPrompt: '',
          warnings: [],
          action: 'respond',
        };
      }
    }

    // 2. Semantic analysis - should we suggest a tool?
    if (!this.session.lastDetectedLanguage || this.session.lastDetectedLanguage === 'general') {
      console.log(`[LirAgent] Running semantic analysis for: "${userInput}"`);
      const intentResult = await this.toolIntegration?.analyzeIntent(userInput);

      if (intentResult?.shouldSuggest && intentResult.tool) {
        this.session.waitingForTool = true;
        this.session.pendingTool = intentResult.tool;
        this.session.pendingToolInput = userInput;

        return {
          response: `Tool detected: "${intentResult.tool.name}".\n${intentResult.tool.content}\n\nRun tool? (yes/no)`,
          fullPrompt: '',
          warnings: [],
          action: 'respond',
        };
      }
    }

    // If waiting for language choice — handle it
    if (this.session.waitingForLanguage) {
      this.session.waitingForLanguage = false;
      const pending = this.session.pendingInput;
      const langResult = await this.handleLanguageChoice(userInput);
      
      if (langResult.detectedLanguage === 'general') {
        this.session.lastDetectedLanguage = 'general';
        return this.processWithLanguage(pending, 'general');
      } else if (langResult.action === 'language_set') {
        this.session.lastDetectedLanguage = langResult.detectedLanguage;
        return this.processWithLanguage(pending, langResult.detectedLanguage);
      } else {
        this.session.waitingForLanguage = true;
        this.session.pendingInput = pending;
        return {
          response: `Не понял. ${this.getLanguageOptions()}`,
          fullPrompt: '',
          warnings: [],
          action: 'ask_language',
          languageQuestion: this.getLanguageOptions(),
        };
      }
    }
    
    // Если ждём feedback после предыдущего ответа — обрабатываем ДО processWithLanguage
    if (this.session.waitingForFeedback) {
      // COMMANDS: Allow commands (starting with '/') even in feedback mode
      if (userInput.startsWith('/')) {
        const commandResult = await this.handleCommandInFeedbackMode(userInput);
        // If command exits feedback mode (like /exit), return directly
        if (commandResult.exitsFeedbackMode) {
          this.session.waitingForFeedback = false;
          return commandResult;
        }
        // Otherwise, stay in feedback mode and ask again
        // Merge commandResult fields into response object
        const responseText = commandResult.response || '';
        const fullPrompt = commandResult.fullPrompt || '';
        const warnings = commandResult.warnings || [];
        return {
          response: responseText + '\n\n---\n**Я справился? (да/нет/отмена)**',
          fullPrompt,
          warnings,
          action: 'waiting_feedback',
        };
      }
      return this.processWithLanguage(userInput, this.session.lastDetectedLanguage || 'general');
    }

    // Если ждём выбор языка
    if (this.session.waitingForLanguage) {
      this.session.waitingForLanguage = false;
      const pending = this.session.pendingInput;
      const langResult = await this.handleLanguageChoice(userInput);
      
      if (langResult.detectedLanguage === 'general') {
        this.session.lastDetectedLanguage = 'general';
        return this.processWithLanguage(pending || userInput, 'general');
      } else if (langResult.action === 'language_set') {
        this.session.lastDetectedLanguage = langResult.detectedLanguage;
        return this.processWithLanguage(pending || userInput, langResult.detectedLanguage);
      } else {
        this.session.waitingForLanguage = true;
        this.session.pendingInput = pending;
        return {
          response: `Не понял. ${this.getLanguageOptions()}`,
          fullPrompt: '',
          warnings: [],
          action: 'ask_language',
          languageQuestion: this.getLanguageOptions(),
        };
      }
    }

    // Если язык ещё не выбран — сначала пробуем найти в памяти
    if (!this.session.lastDetectedLanguage) {
      // Пробуем обработать как 'general' (поиск по всей памяти)
      const result = await this.processWithLanguage(userInput, 'general');
      // Если нашли что-то осмысленное — возвращаем
      if (result.action !== 'ask_language' && result.response.trim()) {
        return result;
      }
      // Иначе спрашиваем язык
      this.session.waitingForLanguage = true;
      this.session.pendingInput = userInput;
      return {
        response: '',
        fullPrompt: '',
        warnings: [],
        action: 'ask_language',
        languageQuestion: this.getLanguageOptions(),
      };
    }
    
    // Язык уже выбран — обрабатываем normally
    return this.processWithLanguage(userInput, this.session.lastDetectedLanguage);
  }

  /**
   * processMessageStream — like processMessage but streams LLM response chunks.
   * For early-return cases (commands, tool confirmations, feedback, language choice)
   * it behaves identically to processMessage.
   * For the LLM interaction path, it calls ollamaClient.chatStream() and invokes
   * onChunk for each token, then performs the same post-processing.
   */
  async processMessageStream(
    userInput: string,
    onChunk?: (chunk: string) => void
  ): Promise<any> {
    // === Command handlers (same as processMessage lines 236-327) ===
    if (userInput.startsWith('/load-config')) {
      const targetPath = userInput.slice(13).trim();
      if (!targetPath) return this.createResponse('Укажите путь к выгрузке конфигурации.');
      return this.handleLoadConfig(targetPath);
    }
    if (userInput.startsWith('/search-code')) {
      const query = userInput.slice(12).trim();
      if (!query) return this.createResponse('Укажите текст для поиска.');
      return this.handleSearchCode(query);
    }
    if (userInput.startsWith('/semantic-search')) {
      const query = userInput.slice(16).trim();
      if (!query) return this.createResponse('Укажите описание для семантического поиска.');
      return this.handleSemanticSearch(query);
    }
    if (userInput.startsWith('/load-measurements')) {
      const dirPath = userInput.slice(18).trim();
      if (!dirPath) return this.createResponse('Укажите путь к папке с замерами.');
      return this.handleLoadMeasurements(dirPath);
    }
    if (userInput.startsWith('/top-slow')) {
      const parts = userInput.slice(9).trim().split(' ') || [];
      const limit = parseInt(parts[0] || '10');
      const objectName = parts[1] || null;
      return this.handleTopSlow(limit, objectName);
    }
    if (userInput.startsWith('/explain-slow')) {
      const objectName = userInput.slice(13).trim();
      if (!objectName) return this.createResponse('Укажите имя объекта.');
      return this.handleExplainSlow(objectName);
    }
    if (userInput.startsWith('/build-graph')) {
      return this.handleBuildGraph();
    }
    if (userInput.startsWith('/callers')) {
      const parts = userInput.slice(8).trim().split('.');
      const objectName = parts[0] || '';
      const methodName = parts[1] || null;
      if (!objectName) return this.createResponse('Укажите имя объекта: /callers <Объект.Метод>');
      return this.handleCallers(objectName, methodName);
    }
    if (userInput.startsWith('/callees')) {
      const parts = userInput.slice(8).trim().split('.');
      const objectName = parts[0] || '';
      const methodName = parts[1] || null;
      if (!objectName) return this.createResponse('Укажите имя объекта: /callees <Объект.Метод>');
      return this.handleCallees(objectName, methodName);
    }
    if (userInput.startsWith('/cycles')) {
      return this.handleFindCycles();
    }
    if (userInput.startsWith('/graph-viz')) {
      const objectName = userInput.slice(10).trim() || null;
      return this.handleGraphViz(objectName);
    }
    if (userInput.startsWith('/compare-config')) {
      const parts = userInput.slice(16).trim().split(' ');
      if (parts.length < 2 || !parts[0] || !parts[1]) return this.createResponse('Укажите оба пути: /compare-config <old> <new>');
      return this.handleCompareConfig(parts[0], parts[1]);
    }
    if (userInput.startsWith('/comparison-summary')) {
      return this.handleComparisonSummary();
    }
    if (userInput.startsWith('/diff-module')) {
      const objectName = userInput.slice(13).trim();
      if (!objectName) return this.createResponse('Укажите имя объекта: /diff-module <объект>');
      return this.handleDiffModule(objectName);
    }
    if (userInput.startsWith('/changed-objects')) {
      const type = userInput.slice(17).trim() || null;
      return this.handleChangedObjects(type);
    }
    if (userInput.startsWith('/explain')) {
      const rest = userInput.slice(8).trim();
      if (!rest) return this.createResponse('Укажите объект и метод: /explain Объект.Метод');
      return this.handleExplain(rest);
    }
    if (userInput.startsWith('/extract-my-code')) {
      const parts = userInput.slice(16).trim().split(/\s+/);
      const inputFile = parts[0];
      const outputFile = parts[1] || './extracted_code.txt';
      if (!inputFile) return this.createResponse('Укажите входной файл. Пример: /extract-my-code ./1.txt ./my_code.txt');
      const result = await this.runExtractMyCode(inputFile, outputFile);
      this.session.waitingForFeedback = true;
      this.session.lastUserInput = userInput;
      return {
        response: `${result.response}\n\nЯ справился? (да/нет/отмена)`,
        fullPrompt: result.fullPrompt,
        warnings: result.warnings,
        action: 'waiting_feedback',
      };
    }

    // Learn from last successful dialog
    if (userInput === '/learn' && !this.session.waitingForFeedback) {
      return this.handleLearn();
    }

    // === TOOL INTEGRATION (same as processMessage lines 334-406) ===
    if (this.session.waitingForTool) {
      const result = await this.toolIntegration?.processConfirmation(
        userInput,
        this.session.pendingTool,
        this.session.pendingToolInput
      );

      if (result?.action === 'waiting_confirmation' || result?.action === 'waiting_parameter') {
        return { response: result.response || 'Waiting for input...', fullPrompt: '', warnings: [], action: 'respond' };
      }

      if (result?.action === 'completed') {
        this.session.waitingForTool = false;
        this.session.pendingTool = null;
        this.session.pendingToolInput = '';
        if (result.executionResult?.success) {
          return { response: `Tool executed: ${result.toolResponse}\n\nDid I succeed? (yes/no/cancel)`, fullPrompt: '', warnings: [], action: 'waiting_feedback' };
        } else {
          return { response: `Tool error: ${result.executionResult?.error || 'Unknown error'}`, fullPrompt: '', warnings: [], action: 'respond' };
        }
      }

      if (result?.action === 'cancelled') {
        this.session.waitingForTool = false;
        this.session.pendingTool = null;
        this.session.pendingToolInput = '';
        return { response: result.response || 'Cancelled.', fullPrompt: '', warnings: [], action: 'respond' };
      }
    }

    // Semantic analysis
    if (!this.session.lastDetectedLanguage || this.session.lastDetectedLanguage === 'general') {
      const intentResult = await this.toolIntegration?.analyzeIntent(userInput);
      if (intentResult?.shouldSuggest && intentResult.tool) {
        this.session.waitingForTool = true;
        this.session.pendingTool = intentResult.tool;
        this.session.pendingToolInput = userInput;
        return { response: `Tool detected: "${intentResult.tool.name}".\n${intentResult.tool.content}\n\nRun tool? (yes/no)`, fullPrompt: '', warnings: [], action: 'respond' };
      }
    }

    // Waiting for language
    if (this.session.waitingForLanguage) {
      this.session.waitingForLanguage = false;
      const pending = this.session.pendingInput;
      const langResult = await this.handleLanguageChoice(userInput);
      if (langResult.detectedLanguage === 'general') {
        this.session.lastDetectedLanguage = 'general';
        return this.processMessageStream(pending, onChunk);
      } else if (langResult.action === 'language_set') {
        this.session.lastDetectedLanguage = langResult.detectedLanguage;
        return this.processMessageStream(pending, onChunk);
      } else {
        this.session.waitingForLanguage = true;
        this.session.pendingInput = pending;
        return { response: `Не понял. ${this.getLanguageOptions()}`, fullPrompt: '', warnings: [], action: 'ask_language', languageQuestion: this.getLanguageOptions() };
      }
    }

    // Waiting for feedback
    if (this.session.waitingForFeedback) {
      if (userInput.startsWith('/')) {
        const commandResult = await this.handleCommandInFeedbackMode(userInput);
        if (commandResult.exitsFeedbackMode) {
          this.session.waitingForFeedback = false;
          return commandResult;
        }
        return { response: commandResult.response + '\n\n---\n**Я справился? (да/нет/отмена)**', fullPrompt: '', warnings: [], action: 'waiting_feedback' };
      }
      return this.processWithLanguage(userInput, this.session.lastDetectedLanguage || 'general');
    }

    // Waiting for language (second check)
    if (this.session.waitingForLanguage) {
      this.session.waitingForLanguage = false;
      const pending = this.session.pendingInput;
      const langResult = await this.handleLanguageChoice(userInput);
      if (langResult.detectedLanguage === 'general') {
        this.session.lastDetectedLanguage = 'general';
        return this.processMessageStream(pending || userInput, onChunk);
      } else if (langResult.action === 'language_set') {
        this.session.lastDetectedLanguage = langResult.detectedLanguage;
        return this.processMessageStream(pending || userInput, onChunk);
      } else {
        this.session.waitingForLanguage = true;
        this.session.pendingInput = pending;
        return { response: `Не понял. ${this.getLanguageOptions()}`, fullPrompt: '', warnings: [], action: 'ask_language', languageQuestion: this.getLanguageOptions() };
      }
    }

    // Language not yet detected — default to 'general' and fall through to streaming
    if (!this.session.lastDetectedLanguage) {
      this.session.lastDetectedLanguage = 'general';
    }

    // === LLM interaction path with streaming ===
    const language = this.session.lastDetectedLanguage;
    this.session.lastUserInput = userInput;

    // Save any code blocks from user input to patient knowledge base
    const codeBlocks = this.extractCodeBlocks(userInput);
    if (codeBlocks.length > 0) {
      const patientProfile = this.session.agentId || 'default';
      for (const block of codeBlocks) {
        try {
          await this.patientKB.saveCode(patientProfile, block.code, block.language, 'user_message');
        } catch {
          // silently ignore save errors
        }
      }
    }

    const knowledgeResult = await this.searchKnowledge(userInput);

    const dialogueId = `dialogue-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      const actualId = await this.memory.recordExperience({
        id: dialogueId,
        task: userInput.slice(0, 200),
        outcome: 'pending',
        content: '',
        domain: 'dialogue',
        error_type: 'none',
        confidence: 0.5,
        user_input: userInput,
        metadata: {
          language: language || 'general',
          timestamp: new Date().toISOString(),
          pending: true,
          feedback_description: null,
        },
      });
      this.session.lastDialogueId = actualId;
      this.session.lastExperienceId = actualId;
    } catch (err: any) {
      console.error('[LirAgent] Error saving dialogue:', err.message);
    }

    const enriched = await this.memory.recommendWithWarnings(userInput, { k: 5, threshold: 0.4, language });
    let fullSystemPrompt = this.buildSystemPrompt(enriched.enrichedPrompt, language);

    const hasWarnings = enriched.warnings.length > 0;
    if (hasWarnings) {
      fullSystemPrompt += `\n\n⚠️ ВНИМАНИЕ: Обнаружены негативные паттерны! НЕ используй информацию, которая приводила к ошибкам: ${enriched.warnings.map(w => w.error_type).join(', ')}. Измени подход!`;
    } else if (knowledgeResult.bestScore >= 0.6 && knowledgeResult.content) {
      fullSystemPrompt += `\n\nYou are Лирь. Answer the question using ONLY the following information (do not add your own explanations):\n${knowledgeResult.content}\n\nEnd of knowledge.`;
    }

    // Append patient's recent code to context
    const patientProfile = this.session.agentId || 'default';
    const recentCode = await this.patientKB.findRecentCode(patientProfile, 3);
    if (recentCode.length > 0) {
      const codeBlock = recentCode.map(c => `\`\`\`${c.language || ''}\n${c.content}\n\`\`\``).join('\n\n');
      fullSystemPrompt += `\n\n## Recent code from this patient\n${codeBlock}`;
    }

    this.session.conversationHistory.push({ role: 'user', content: userInput });

    const messages: ChatMessage[] = [
      { role: 'system', content: fullSystemPrompt },
      ...this.session.conversationHistory.slice(-10),
    ];

    let response = '';
    try {
      if (onChunk) {
        // Streaming mode
        for await (const chunk of this.llmClient.chatStream(messages, { model: this.llmModel })) {
          response += chunk;
          onChunk(chunk);
        }
      } else {
        // Non-streaming fallback (same as processMessage)
        response = await this.llmClient.chat(messages, this.llmModel);
      }
    } catch (error) {
      console.error('LLM generation failed:', error);
      response = this.generateFallbackResponse(userInput, enriched);
    }

    this.session.lastAgentResponse = response;
    this.session.conversationHistory.push({ role: 'assistant', content: response });

    await this.recordExperiencePending(userInput, response, enriched.warnings, language);

    this.session.waitingForFeedback = true;

    if (onChunk) {
      onChunk('\n\n---\n**Я справился? (да/нет/отмена)**');
    }

    return {
      response: response + '\n\n---\n**Я справился? (да/нет/отмена)**',
      fullPrompt: fullSystemPrompt,
      warnings: enriched.warnings,
      action: 'waiting_feedback',
    };
  }

  private async searchKnowledge(query: string): Promise<{
    content: string;
    bestScore: number;
    results: any[];
  }> {
    try {
      console.log(`[LirAgent] Searching knowledge for: "${query}"`);
      const results = await this.memory.retrieve(query, {
        k: 3,
        domain: 'knowledge',
      });
      if (results.length === 0) {
        console.log(`[LirAgent] No knowledge found`);
        return { content: '', bestScore: 0, results: [] };
      }
      console.log(`[LirAgent] Found ${results.length} knowledge items`);
      const parts: string[] = [];
      let bestScore = 0;
      for (const r of results) {
        const score = r.score || 0;
        if (score > bestScore) bestScore = score;
        const exp = r.experience;
        if (!exp) continue;
        const content = exp.content || exp.task || '';
        parts.push(`[Knowledge: ${exp.task || 'Untitled'} | score: ${score.toFixed(3)}]\n${content}`);
      }
      return {
        content: parts.join('\n\n'),
        bestScore,
        results,
      };
    } catch (error: any) {
      console.error(`[LirAgent] Error searching knowledge: ${error.message}`);
      return { content: '', bestScore: 0, results: [] };
    }
  }

  private async processWithLanguage(userInput: string, language: Language): Promise<any> {
    // FIRST: Check if waiting for feedback (BEFORE saving dialogue!)
    // NEW: Also check for "нет, <описание>" pattern
    if (this.session.waitingForFeedback) {
      // First try to parse as "нет, <описание>"
      const errorCommand = this.parseErrorCommand(userInput);
      if (errorCommand) {
        this.session.waitingForFeedback = false;
        this.session.waitingForErrorType = false;
        // If description provided, use it directly (skip error type selection)
        if (errorCommand.description) {
          return this.handleErrorFeedback('none', errorCommand.description);
        }
        // Otherwise, ask for error type
        this.session.waitingForErrorType = true;
        return this.handleErrorFeedback(errorCommand.errorType);
      }
      
      const feedbackResult = await this.processFeedback(userInput);
      
      if (feedbackResult.action === 'ask_error_type') {
        this.session.waitingForErrorType = true;
        this.session.waitingForFeedback = false;
        return {
          response: feedbackResult.errorOptions || this.getErrorTypeOptions(),
          fullPrompt: '',
          warnings: [],
          action: 'waiting_feedback',
        };
      }
      
      if (feedbackResult.action === 'learn_error') {
        this.session.waitingForFeedback = false;
        this.session.waitingForErrorType = false;
        return feedbackResult;
      }
      
      this.session.waitingForFeedback = false;
      this.session.waitingForErrorType = false;
      return feedbackResult;
    }

    // SECOND: Check if waiting for error type choice
    if (this.session.waitingForErrorType) {
      const errorType = this.parseErrorTypeChoice(userInput);
      if (errorType) {
        this.session.waitingForErrorType = false;
        this.session.waitingForFeedback = false;
        return this.handleErrorFeedback(errorType);
      } else {
        return {
          response: `Не понял. ${this.getErrorTypeOptions()}`,
          fullPrompt: '',
          warnings: [],
          action: 'waiting_feedback',
        };
      }
    }

    // Special handling ONLY for explicit tool list commands (exact match)
    const lowerInput = userInput.toLowerCase().trim();
    const toolListCommands = ['/tools', 'инструменты', 'tools', 'список команд', 'что ты умеешь'];
    const isExactToolListCommand = toolListCommands.includes(lowerInput);
    
    if (isExactToolListCommand) {
      // Use knowledge base - let LLM generate response from tools-list.md
      const knowledgeResult = await this.searchKnowledge('список всех инструментов и команд');
      if (knowledgeResult.content) {
        const messages: ChatMessage[] = [
          { role: 'system', content: `Ответь на вопрос пользователя, используя ТОЛЬКО следующую информацию, без добавлений:\n\n${knowledgeResult.content}\n\nКонец информации.` },
          { role: 'user', content: userInput }
        ];
        const llmResponse = await this.llmClient.chat(messages, this.llmModel);
        return {
          response: llmResponse,
          fullPrompt: '',
          warnings: [],
          action: 'respond',
        };
      }
      // Fallback
      return {
        response: 'Для просмотра инструментов используйте команды напрямую, начиная с /. Всего доступно: работа с конфигурацией, производительность, графы, сравнение и анализ кода.',
        fullPrompt: '',
        warnings: [],
        action: 'respond',
      };
    }
    
    // For ALL other queries (including "помоги с инструментом", "какой инструмент использовать") 
    // - let them flow through to normal LLM processing with knowledge search below
    // Если ждём feedback после предыдущего ответа
    if (this.session.waitingForFeedback) {
      // FIRST: Check if user provided feedback with description (e.g., "нет, <описание>")
      const errorCommand = this.parseErrorCommand(userInput);
      if (errorCommand) {
        this.session.waitingForFeedback = false;
        this.session.waitingForErrorType = false;
        // If description provided, use it directly
        if (errorCommand.description) {
          return this.handleErrorFeedback('none', errorCommand.description);
        }
        // Otherwise, ask for error type
        this.session.waitingForErrorType = true;
        return this.handleErrorFeedback(errorCommand.errorType);
      }
      
      // Otherwise, process normal feedback
      const feedbackResult = await this.processFeedback(userInput);
      
      if (feedbackResult.action === 'ask_error_type') {
        this.session.waitingForErrorType = true;
        this.session.waitingForFeedback = false;
        return {
          response: feedbackResult.errorOptions || this.getErrorTypeOptions(),
          fullPrompt: '',
          warnings: [],
          action: 'waiting_feedback',
        };
      }
      
      if (feedbackResult.action === 'learn_error') {
        this.session.waitingForFeedback = false;
        this.session.waitingForErrorType = false;
        return feedbackResult;
      }
      
      this.session.waitingForFeedback = false;
      this.session.waitingForErrorType = false;
      return feedbackResult;
    }

    // Если ждём выбор типа ошибки
    if (this.session.waitingForErrorType) {
      const errorType = this.parseErrorTypeChoice(userInput);
      if (errorType) {
        this.session.waitingForErrorType = false;
        this.session.waitingForFeedback = false;
        return this.handleErrorFeedback(errorType);
      } else {
        return {
          response: `Не понял. ${this.getErrorTypeOptions()}`,
          fullPrompt: '',
          warnings: [],
          action: 'waiting_feedback',
        };
      }
    }

    // Проверка быстрых команд
    if (this.parsePraiseCommand(userInput)) {
      return this.handleSuccessFeedback();
    }

    const errorCommand = this.parseErrorCommand(userInput);
    if (errorCommand) {
      return this.handleErrorFeedback(errorCommand.errorType);
    }

    this.session.lastUserInput = userInput;

    // Save any code blocks from user input to patient knowledge base
    const codeBlocks = this.extractCodeBlocks(userInput);
    if (codeBlocks.length > 0) {
      const patientProfile = this.session.agentId || 'default';
      for (const block of codeBlocks) {
        try {
          await this.patientKB.saveCode(patientProfile, block.code, block.language, 'user_message');
        } catch {
          // silently ignore save errors
        }
      }
    }

    // Search knowledge base for how-to questions
    const knowledgeResult = await this.searchKnowledge(userInput);

    // Save dialogue BEFORE LLM generation (pending state)
    const dialogueId = `dialogue-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      const actualId = await this.memory.recordExperience({
        id: dialogueId,
        task: userInput.slice(0, 200), // short task description
        outcome: 'pending', // will be updated after feedback
        content: '', // will be filled after LLM generates
        domain: 'dialogue',
        error_type: 'none',
        confidence: 0.5,
        user_input: userInput,
        metadata: {
          language: language || 'general',
          timestamp: new Date().toISOString(),
          pending: true,
          feedback_description: null, // will be filled after feedback
        },
      });
      this.session.lastDialogueId = actualId; // Use actual ID (may be merged with similar)
      this.session.lastExperienceId = actualId; // Set for recordFeedback!
      console.log(`[LirAgent] Saved dialogue (pending): ${actualId} (requested: ${dialogueId}), lastExperienceId set to: ${actualId}`);
    } catch (err: any) {
      console.error('[LirAgent] Error saving dialogue:', err.message);
    }

    // Decision protocol for knowledge usage
    // NEVER return directly - always use LLM with strict context
    // This prevents returning irrelevant knowledge (e.g., /explain for a diagnosis question)

    const enriched = await this.memory.recommendWithWarnings(userInput, { k: 5, threshold: 0.4, language });
    let fullSystemPrompt = this.buildSystemPrompt(enriched.enrichedPrompt, language);

    // CRITICAL: If there are ANY warnings from failed experiences, DO NOT use knowledge blindly
    const hasWarnings = enriched.warnings.length > 0;

    if (hasWarnings) {
      console.log(`[LirAgent] WARNINGS present (${enriched.warnings.length}), blocking knowledge usage. Errors: ${enriched.warnings.map(w => w.error_type).join(', ')}`);
      fullSystemPrompt += `\n\n⚠️ ВНИМАНИЕ: Обнаружены негативные паттерны! НЕ используй информацию, которая приводила к ошибкам: ${enriched.warnings.map(w => w.error_type).join(', ')}. Измени подход!`;
    } else if (knowledgeResult.bestScore >= 0.6 && knowledgeResult.content) {
      // Medium confidence: strict prompt with knowledge only if NO warnings
      console.log(`[LirAgent] Medium confidence knowledge (${knowledgeResult.bestScore.toFixed(3)}), using strict prompt`);
      fullSystemPrompt += `\n\nYou are Лирь. Answer the question using ONLY the following information (do not add your own explanations):\n${knowledgeResult.content}\n\nEnd of knowledge.`;
    }

    // Append patient's recent code to context
    const patientProfile = this.session.agentId || 'default';
    const recentCode = await this.patientKB.findRecentCode(patientProfile, 3);
    if (recentCode.length > 0) {
      const codeBlock = recentCode.map(c => `\`\`\`${c.language || ''}\n${c.content}\n\`\`\``).join('\n\n');
      fullSystemPrompt += `\n\n## Recent code from this patient\n${codeBlock}`;
    }

    this.session.conversationHistory.push({ role: 'user', content: userInput });

    const messages: ChatMessage[] = [
      { role: 'system', content: fullSystemPrompt },
      ...this.session.conversationHistory.slice(-10),
    ];

    let response = '';
    try {
      response = await this.llmClient.chat(messages, this.llmModel);
    } catch (error) {
      console.error('LLM generation failed:', error);
      response = this.generateFallbackResponse(userInput, enriched);
    }

    this.session.lastAgentResponse = response;
    this.session.conversationHistory.push({ role: 'assistant', content: response });

    await this.recordExperiencePending(userInput, response, enriched.warnings, language);

    this.session.waitingForFeedback = true;

      return {
        response: response + '\n\n---\n**Я справился? (да/нет/отмена)**',
        fullPrompt: fullSystemPrompt,
        warnings: enriched.warnings,
        action: 'waiting_feedback',
      };
  }

  private async handleCommandInFeedbackMode(userInput: string): Promise<any> {
    // Handle commands while waiting for feedback
    // Returns an object with exitsFeedbackMode flag
    const lowerInput = userInput.toLowerCase().trim();

    // /exit - exit chat, clear feedback mode
    if (lowerInput === '/exit' || lowerInput === '/quit') {
      return {
        ...this.createResponse('До свидания!'),
        exitsFeedbackMode: true,
      };
    }

    // /learn - save last Q&A as knowledge, but STAY in feedback mode
    if (lowerInput === '/learn') {
      if (!this.session.lastUserInput || !this.session.lastAgentResponse) {
        return {
          ...this.createResponse('❌ Нет предыдущего ответа для сохранения.'),
          exitsFeedbackMode: false,
        };
      }

      try {
        const task = this.session.lastUserInput.slice(0, 100);
        const content = this.session.lastAgentResponse.slice(0, 2000);

        await this.memory.recordExperience({
          id: `knowledge-learned-${Date.now()}`,
          task,
          outcome: 'success',
          content,
          domain: 'knowledge',
          error_type: 'none',
          confidence: 0.95,
          metadata: {
            language: this.session.lastDetectedLanguage || 'general',
            is_skill: true,
            created_from_dialog: true,
            user_input: this.session.lastUserInput,
          },
        });

        console.log(`[LirAgent] Saved knowledge from dialog: "${task}"`);
        return {
          ...this.createResponse('✅ Знание сохранено! В будущем я смогу опираться на этот ответ.'),
          exitsFeedbackMode: false, // Stay in feedback mode
        };
      } catch (error: any) {
        console.error('[LirAgent] Error saving knowledge:', error.message);
        return {
          ...this.createResponse(`❌ Ошибка сохранения: ${error.message}`),
          exitsFeedbackMode: false,
        };
      }
    }

    // /stats - show stats, stay in feedback mode
    if (lowerInput === '/stats' || lowerInput === '/statistics') {
      const stats = await this.getStats();
      return {
        ...stats,
        exitsFeedbackMode: false,
      };
    }

    // /tools - show tools, stay in feedback mode
    if (lowerInput === '/tools' || lowerInput === '/help') {
      const knowledgeResult = await this.searchKnowledge('список всех инструментов и команд');
      if (knowledgeResult.content) {
        const messages: ChatMessage[] = [
          { role: 'system', content: `Ответь на вопрос пользователя, используя ТОЛЬКО следующую информацию, без добавлений:\n\n${knowledgeResult.content}\n\nКонец информации.` },
          { role: 'user', content: userInput }
        ];
        const llmResponse = await this.llmClient.chat(messages, this.llmModel);
        return {
          response: llmResponse,
          fullPrompt: '',
          warnings: [],
          action: 'respond',
          exitsFeedbackMode: false,
        };
      }
      return {
        ...this.createResponse('Для просмотра инструментов используйте команды напрямую, начиная с /.'),
        exitsFeedbackMode: false,
      };
    }

    // For other commands that change context - EXIT feedback mode
    const contextChangingCommands = ['/load-config', '/search-code', '/load-measurements', '/build-graph', '/compare-config', '/extract-my-code', '/explain', '/diff-module', '/changed-objects', '/callers', '/callees', '/cycles', '/graph-viz', '/explain-slow', '/top-slow', '/semantic-search', '/comparison-summary'];
    const isContextChanging = contextChangingCommands.some(cmd => userInput.startsWith(cmd));
    
    if (isContextChanging) {
      // Ask user if they want to cancel feedback
      return {
        ...this.createResponse('Вы хотите отменить оценку предыдущего ответа и перейти к новой команде? (да/нет)'),
        exitsFeedbackMode: false,
        askCancelFeedback: true,
      };
    }

    // Unknown command in feedback mode
    return {
      ...this.createResponse(`❌ Неизвестная команда "${userInput}" в режиме ожидания оценки. Доступные команды: /learn, /stats, /tools, /help, /exit`),
      exitsFeedbackMode: false,
    };
  }

  private async handleLearn(): Promise<any> {
    // Save last successful Q&A as knowledge
    if (!this.session.lastUserInput || !this.session.lastAgentResponse) {
      return this.createResponse('❌ Нет предыдущего ответа для сохранения.');
    }

    try {
      const task = this.session.lastUserInput.slice(0, 100);
      const content = this.session.lastAgentResponse.slice(0, 2000); // Limit content size

      await this.memory.recordExperience({
        id: `knowledge-learned-${Date.now()}`,
        task,
        outcome: 'success',
        content,
        domain: 'knowledge',
        error_type: 'none',
        confidence: 0.95,
        metadata: {
          language: this.session.lastDetectedLanguage || 'general',
          is_skill: true,
          created_from_dialog: true,
          user_input: this.session.lastUserInput,
        },
      });

      console.log(`[LirAgent] Saved knowledge from dialog: "${task}"`);
      return this.createResponse('✅ Знание сохранено! В будущем я смогу опираться на этот ответ.');
    } catch (error: any) {
      console.error('[LirAgent] Error saving knowledge:', error.message);
      return this.createResponse(`❌ Ошибка сохранения: ${error.message}`);
    }
  }

  private async processFeedback(userInput: string): Promise<{
    response: string;
    fullPrompt: string;
    warnings: ErrorWarning[];
    action: 'record_success' | 'learn_error' | 'ask_error_type' | 'respond';
    errorOptions?: string;
  }> {
    const lower = userInput.toLowerCase().trim();
    
    // Вариант "отмена" - не сохраняем в базу
    if (lower.match(/^(отмена|cancel|отменить)$/i)) {
      this.session.waitingForFeedback = false;
      this.session.waitingForErrorType = false;
      return {
        response: 'Ок, не сохраняем.',
        fullPrompt: '',
        warnings: [],
        action: 'respond',
      };
    }
    
    if (lower.match(/^(да|yes|\+|👍|хорошо|верно|правильно|отлично|супер)$/i)) {
      return this.handleSuccessFeedback();
    }
    
    if (lower.match(/^(нет|no|-|👎|неправильно|неверно|плохо|ошибка)$/i)) {
      return {
        response: '',
        fullPrompt: '',
        warnings: [],
        action: 'ask_error_type',
        errorOptions: this.getErrorTypeOptions(),
      };
    }
    
    return {
      response: 'Я не понял. Вы довольны ответом? (да/нет/отмена)',
      fullPrompt: '',
      warnings: [],
      action: 'ask_error_type',
    };
  }

  private parsePraiseCommand(input: string): boolean {
    const lower = input.toLowerCase().trim();
    return /^(молодец|хорошо|отлично|супер|ок|да|верно|правильно)$/i.test(lower);
  }

  private parseErrorCommand(input: string): { errorType: string; description?: string } | null {
    const lower = input.toLowerCase().trim();
    // Pattern: "нет, <описание>" or "неправильно <описание>" etc.
    const match = lower.match(/^(нет|no|-|👎|неправильно|неверно|плохо|ошибка)[,\s]+(.+)/i);
    if (match && match[2]) {
      return { errorType: 'none', description: match[2].trim() };
    }
    // Pattern: just error type without description
    const typeMatch = lower.match(/^стоп[,\s]+(эхолалия|парафазия|контаминация|галлюцинация)/i);
    if (typeMatch && typeMatch[1]) {
      return { errorType: typeMatch[1] };
    }
    return null;
  }

  private async handleSuccessFeedback(): Promise<{
    response: string;
    fullPrompt: string;
    warnings: ErrorWarning[];
    action: 'record_success';
  }> {
    // Update dialogue record if exists
    if (this.session.lastDialogueId) {
      try {
        await this.memory.updateDialogueOutcome(this.session.lastDialogueId, 'success');
        console.log(`[LirAgent] Updated dialogue success: ${this.session.lastDialogueId}`);
      } catch (err: any) {
        console.error('[LirAgent] Error updating dialogue:', err.message);
      }
    }

    // Also update experience if exists (for consecutive_successes)
    if (this.session.lastExperienceId) {
      const feedback = await this.memory.recordFeedback(this.session.lastExperienceId, true);
      
      const response = feedback.promoted
        ? `★ Отлично! Этот паттерн стал навыком (${feedback.consecutive}/3). Спасибо за оценку!`
        : `✅ Спасибо! Успешных применений подряд: ${feedback.consecutive}/3.`;
      
      return {
        response,
        fullPrompt: '',
        warnings: [],
        action: 'record_success',
      };
    }

    return {
      response: '✅ Спасибо! Успешных применений подряд: 1/3.',
      fullPrompt: '',
      warnings: [],
      action: 'record_success',
    };
  }

  private async handleErrorFeedback(errorType: string, description?: string): Promise<{
    response: string;
    fullPrompt: string;
    warnings: ErrorWarning[];
    action: 'learn_error';
  }> {
    // Update dialogue record if exists
    if (this.session.lastDialogueId) {
      try {
        await this.memory.updateDialogueOutcome(this.session.lastDialogueId, 'failure', errorType);
        console.log(`[LirAgent] Updated dialogue failure: ${this.session.lastDialogueId}`);
      } catch (err: any) {
        console.error('[LirAgent] Error updating dialogue:', err.message);
      }
    }

    await this.memory.learnFromFeedback(
      errorType as ErrorType,
      this.session.lastUserInput,
      this.session.lastAgentResponse,
      description
    );

    const responseText = description 
      ? `⚠️ Записана ошибка: ${errorType}. Причина: "${description}". Спасибо за пояснение, я запомню!`
      : `⚠️ Записана ошибка: ${errorType}. Спасибо за исправление, я запомню правильный синтаксис!`;

    return {
      response: responseText,
      fullPrompt: '',
      warnings: [],
      action: 'learn_error',
    };
  }

  private async recordExperiencePending(
    userInput: string,
    agentResponse: string,
    warnings: ErrorWarning[],
    language: Language
  ): Promise<void> {
    const task = this.inferTask(userInput);
    const domain = this.inferDomain(userInput);
    const hadWarnings = warnings.length > 0;
    const firstWarning = warnings[0];

    // Save as 'dialogue' domain for future learning
    const dialogueId = `dialogue-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const actualId = await this.memory.recordExperience({
      id: dialogueId,
      task: userInput.slice(0, 200), // short task description
      outcome: 'pending', // will be updated after feedback
      content: agentResponse.slice(0, 1000), // agent's response
      domain: 'dialogue',
      error_type: 'none',
      confidence: 0.5,
      user_input: userInput,
      metadata: {
        agent: this.session.agentId,
        language,
        timestamp: new Date().toISOString(),
        pending: true,
      },
    });

    this.session.lastDialogueId = actualId; // Use actual ID (may be merged with similar)
    this.session.lastExperienceId = actualId; // Set for recordFeedback!
    console.log(`[LirAgent] Saved dialogue (pending): ${actualId} (requested: ${dialogueId}), lastExperienceId set to: ${actualId}`);
  }

  async handleLanguageChoice(choice: string): Promise<{
    response: string;
    action: 'language_set';
    detectedLanguage: Language;
  }> {
    const trimmed = choice.trim().toLowerCase();
    
    const languageMap: Record<string, Language> = {
      '1': '1С (BSL)',
      '1с': '1С (BSL)',
      '1c': '1С (BSL)',
      'bsl': '1С (BSL)',
      '2': 'JavaScript',
      'javascript': 'JavaScript',
      'js': 'JavaScript',
      '3': 'TypeScript',
      'typescript': 'TypeScript',
      'ts': 'TypeScript',
      '4': 'Python',
      'python': 'Python',
      'py': 'Python',
      '5': 'Go',
      'go': 'Go',
      'golang': 'Go',
      '6': 'general',
      'общий': 'general',
      'general': 'general',
    };
    
    const selectedLanguage = languageMap[trimmed];
    
    if (!selectedLanguage) {
      return {
        response: `Я не понял "${choice}". ${this.getLanguageOptions()}`,
        action: 'language_set',
        detectedLanguage: 'general',
      };
    }
    
    this.session.lastDetectedLanguage = selectedLanguage;
    
    const langEmoji = {
      '1С (BSL)': '📦',
      'JavaScript': '🟨',
      'TypeScript': '💙',
      'Python': '🐍',
      'Go': '🔵',
      'general': '📄',
    }[selectedLanguage];
    
    return {
      response: `${langEmoji} Отлично! Буду отвечать на вопросы по языку ${selectedLanguage}. Что вы хотите спросить?`,
      action: 'language_set',
      detectedLanguage: selectedLanguage,
    };
  }

  private getLanguageOptions(): string {
    return `Выберите язык:\n1. 📦 1С (BSL)\n2. 🟨 JavaScript\n3. 💙 TypeScript\n4. 🐍 Python\n5. 🔵 Go\n6. 📄 Общий`;
  }

  private extractCodeBlocks(text: string): { code: string; language?: string }[] {
    const regex = /```(\w*)\n([\s\S]*?)```/g;
    const blocks: { code: string; language?: string }[] = [];
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const lang = match[1] || undefined;
      const code = match[2]!.trim();
      if (code) blocks.push({ code, language: lang });
    }
    return blocks;
  }

  private buildSystemPrompt(memoryBlock: string, language: Language): string {
    let langInstruction = '';
    if (language === '1С (BSL)') {
      langInstruction = `\n\nКРИТИЧЕСКИ ВАЖНО ДЛЯ 1С:
- В 1С НЕТ функций СоздатьТранзакцию(), Транзакция.Запустить(), Транзакция.Завершить(), Транзакция.Отменить()
- В 1С есть ТОЛЬКО: НачатьТранзакцию(), ЗафиксироватьТранзакцию(), ОтменитьТранзакцию(), ВызватьИсключение()
- Используй ТОЛЬКО эти команды. Следуй загруженному навыку из SKILL.md!`;
    } else if (language !== 'general') {
      langInstruction = `\n\nВАЖНО: Отвечай на языке программирования ${language}. Используй синтаксис и конструкции именно этого языка.`;
    }
    return `${this.systemPrompt}${langInstruction}\n\n${memoryBlock}`;
  }

  private generateFallbackResponse(userInput: string, enriched: any): string {
    if (enriched.warnings && enriched.warnings.length > 0) {
      const w = enriched.warnings[0];
      return `(Учитывая предупреждение о ${w.error_type}) ${w.advice}`;
    }
    return `Я Лирь. Чем могу помочь? (ваш запрос: ${userInput})`;
  }

  private inferTask(input: string): string {
    if (input.includes('?') || input.startsWith('что') || input.startsWith('как')) return 'question-answering';
    if (input.startsWith('привет')) return 'greeting';
    if (input.includes('код')) return 'code-review';
    return 'general-conversation';
  }

  private inferDomain(input: string): string {
    if (input.includes('код')) return 'code-review';
    if (input.includes('что') || input.includes('как')) return 'education';
    return 'communication';
  }

  async getStats() {
    return this.memory.getStats();
  }

  getCurrentModel(): string {
    return this.llmModel;
  }

  async switchModel(newModel: string): Promise<{
    success: boolean;
    message: string;
    available?: string[];
  }> {
    try {
      const models = await this.llmClient.listModels();
      const available = models.map(m => m.name);
      const modelExists = available.some(m => m === newModel);

      if (!modelExists && available.length > 0) {
        return {
          success: false,
          message: `Модель "${newModel}" не найдена. Доступные модели: ${available.join(', ')}`,
          available,
        };
      }

      const ok = await this.llmClient.ping(newModel);
      if (!ok) {
        return {
          success: false,
          message: `Модель "${newModel}" не отвечает. Проверьте её доступность.`,
        };
      }

      this.llmModel = newModel;
      return {
        success: true,
        message: `✅ Модель переключена на "${newModel}".`,
      };
    } catch (error: any) {
      return {
        success: false,
        message: `Ошибка при переключении модели: ${error.message}`,
      };
    }
  }

  async getAvailableModels(): Promise<ModelInfo[]> {
    try {
      return await this.llmClient.listModels();
    } catch (error: any) {
      console.error('Failed to list models:', error.message);
      return [];
    }
  }

  async close() {
    await this.memory.close();
    if (this.configStorage) {
      this.configStorage.close();
    }
  }

  private createResponse(message: string): {
    response: string;
    fullPrompt: string;
    warnings: ErrorWarning[];
    action: 'respond';
  } {
    return {
      response: message,
      fullPrompt: '',
      warnings: [],
      action: 'respond',
    };
  }

  private async handleLoadConfig(targetPath: string) {
    try {
      await this.fsReader.ensureAllowed(targetPath);
      if (!this.configStorage) {
        this.configStorage = new ConfigStorage(this.dbPath);
        this.configLoader = new ConfigLoader(this.memory, this.configStorage, this.fsReader);
      }
      this.loadConfigInBackground(targetPath);
      return this.createResponse(`🔄 Начинаю анализ конфигурации в ${targetPath}. Это может занять несколько минут. Результат будет сообщён.`);
    } catch (err: any) {
      return this.createResponse(`❌ Ошибка: ${err.message}`);
    }
  }

  private async loadConfigInBackground(dirPath: string) {
    try {
      const result = await this.configLoader!.loadDirectory(dirPath);
      console.log(`[Agent] Загрузка конфигурации завершена: обработано ${result.processed} файлов, ошибок ${result.errors.length}`);
    } catch (err: any) {
      console.error(`[Agent] Ошибка при загрузке конфигурации: ${err.message}`);
    }
  }

  private async handleSearchCode(query: string) {
    if (!this.configStorage) {
      return this.createResponse('Конфигурация ещё не загружена. Используйте /load-config <путь> сначала.');
    }
    const results = await this.configStorage.searchByFTS(query);
    if (results.length === 0) {
      return this.createResponse('Ничего не найдено.');
    }
    const lines = results.slice(0, 10).map(r => `• ${r.name}: ${r.snippet.slice(0, 150)}...`);
    const response = `Найдено ${results.length} объектов:\n${lines.join('\n')}`;
    return this.createResponse(response);
  }

  private async handleSemanticSearch(query: string) {
    const results = await this.memory.retrieve(query, {
      domain: 'config-code',
      language: '1С (BSL)',
      k: 10,
    });
    if (results.length === 0) {
      return this.createResponse('Ничего не найдено.');
    }
    const lines = results.map((r: any) => {
      const exp = r.experience;
      const task = exp.task || 'Unknown';
      const content = (exp.content || '').slice(0, 150);
      return `• ${task}: ${content}... (score: ${r.score?.toFixed(2)})`;
    });
    const response = `Семантический поиск нашёл ${results.length} объектов:\n${lines.join('\n')}`;
    return this.createResponse(response);
  }

  private async handleLoadMeasurements(dirPath: string) {
    try {
      if (!this.perfStorage) {
        this.perfStorage = new PerformanceStorage(this.dbPath);
        this.perfLoader = new PerformanceLoader(this.perfStorage);
      }
      const result = await this.perfLoader!.loadDirectory(dirPath);
      return this.createResponse(
        `📊 Загрузка замеров завершена:\n` +
        `Файлов: ${result.totalFiles}\n` +
        `Загружено записей: ${result.loaded}\n` +
        `Ошибок: ${result.errors.length}\n` +
        `Время: ${(result.durationMs / 1000).toFixed(2)}с`
      );
    } catch (err: any) {
      return this.createResponse(`❌ Ошибка: ${err.message}`);
    }
  }

  private async handleTopSlow(limit: number, objectName?: string | null) {
    if (!this.perfStorage) {
      return this.createResponse('Замеры не загружены. Используйте /load-measurements <путь>.');
    }
    if (objectName) {
      const stats = await this.perfStorage.getObjectStats(objectName);
      if (!stats || stats.measurement_count === 0) {
        return this.createResponse(`Нет данных по объекту "${objectName}".`);
      }
      return this.createResponse(
        `📈 Статистика по "${objectName}":\n` +
        `Замеров: ${stats.measurement_count}\n` +
        `Среднее время: ${stats.avg_duration?.toFixed(2)}мс\n` +
        `Минимум: ${stats.min_duration?.toFixed(2)}мс\n` +
        `Максимум: ${stats.max_duration?.toFixed(2)}мс\n` +
        `Всего вызовов: ${stats.total_calls}`
      );
    } else {
      const topObjects = await this.perfStorage.getTopSlowObjects(limit);
      if (topObjects.length === 0) {
        return this.createResponse('Нет данных о замерах.');
      }
      const lines = topObjects.map((o: any) =>
        `• ${o.object_name}: среднее ${o.avg_duration?.toFixed(2)}мс, вызовов ${o.total_calls}`
      );
      return this.createResponse(`🐢 Топ-${limit} медленных объектов:\n${lines.join('\n')}`);
    }
  }

  private async handleExplainSlow(objectName: string) {
    if (!this.perfStorage) {
      return this.createResponse('Замеры не загружены. Используйте /load-measurements <путь>.');
    }
    const stats = await this.perfStorage.getObjectStats(objectName);
    if (!stats || stats.measurement_count === 0) {
      return this.createResponse(`Нет данных по объекту "${objectName}".`);
    }
    const response = 
      `📊 Анализ объекта "${objectName}":\n\n` +
      `• Среднее время: ${stats.avg_duration?.toFixed(2)}мс\n` +
      `• Минимум: ${stats.min_duration?.toFixed(2)}мс\n` +
      `• Максимум: ${stats.max_duration?.toFixed(2)}мс\n` +
      `• Всего замеров: ${stats.measurement_count}\n` +
      `• Всего вызовов: ${stats.total_calls}\n\n` +
      `💡 Рекомендация: проверьте код модуля через /search-code ${objectName}`;
    return this.createResponse(response);
  }

  private async handleBuildGraph(): Promise<{ response: string; fullPrompt: string; warnings: any[]; action: 'respond' }> {
    try {
      if (!this.configStorage) {
        return this.createResponse('Конфигурация не загружена. Сначала выполните /load-config.');
      }
      if (!this.depGraph) {
        this.depGraph = new DependencyGraph(this.dbPath);
        this.depParser = new DependencyParser(this.configStorage!, this.depGraph);
      }
      
      const result = await this.depParser!.buildGraphFromConfig();
      return this.createResponse(
        `📊 Граф зависимостей построен:\n` +
        `Обработано модулей: ${result.processed}\n` +
        `Рёбер (вызовов): ${result.edges}\n` +
        `Ошибок: ${result.errors.length}`
      );
    } catch (err: any) {
      return this.createResponse(`❌ Ошибка: ${err.message}`);
    }
  }

  private async handleCallers(objectName: string, methodName?: string | null): Promise<{ response: string; fullPrompt: string; warnings: any[]; action: 'respond' }> {
    if (!this.depGraph) {
      return this.createResponse('Граф не построен. Выполните /build-graph.');
    }
    const callers = await this.depGraph.getCallers(objectName, methodName || undefined);
    if (callers.length === 0) {
      return this.createResponse(`Никто не вызывает ${methodName ? `${objectName}.${methodName}` : objectName}.`);
    }
    const lines = callers.map((c: any) => {
      const source = c.source_method ? `${c.source_object}.${c.source_method}` : c.source_object;
      return `• ${source} (${c.call_type})`;
    });
    return this.createResponse(`📞 Вызывают ${objectName}${methodName ? `.${methodName}` : ''}:\n${lines.join('\n')}`);
  }

  private async handleCallees(objectName: string, methodName?: string | null): Promise<{ response: string; fullPrompt: string; warnings: any[]; action: 'respond' }> {
    if (!this.depGraph) {
      return this.createResponse('Граф не построен. Выполните /build-graph.');
    }
    const callees = await this.depGraph.getCallees(objectName, methodName || undefined);
    if (callees.length === 0) {
      return this.createResponse(`${methodName ? `${objectName}.${methodName}` : objectName} никого не вызывает.`);
    }
    const lines = callees.map((c: any) => {
      const target = c.target_method ? `${c.target_object}.${c.target_method}` : c.target_object;
      return `• ${target} (${c.call_type})`;
    });
    return this.createResponse(`📟 ${objectName}${methodName ? `.${methodName}` : ''} вызывает:\n${lines.join('\n')}`);
  }

  private async handleFindCycles(): Promise<{ response: string; fullPrompt: string; warnings: any[]; action: 'respond' }> {
    if (!this.depParser) {
      return this.createResponse('Граф не построен. Выполните /build-graph.');
    }
    const cycles = await this.depParser.findCycles();
    if (cycles.length === 0) {
      return this.createResponse('🎉 Циклических зависимостей не найдено!');
    }
    const lines = cycles.map((cycle, idx) => {
      return `${idx + 1}. ${cycle.join(' → ')}`;
    });
    return this.createResponse(`⚠️ Найдены циклические зависимости:\n${lines.join('\n')}`);
  }

  private async handleGraphViz(objectName?: string | null): Promise<{ response: string; fullPrompt: string; warnings: any[]; action: 'respond' }> {
    if (!this.depGraph) {
      return this.createResponse('Граф не построен. Выполните /build-graph.');
    }
    try {
      const graphML = await this.depGraph.buildGraphML(objectName || undefined);
      const fileName = objectName ? `graph_${objectName.replace(/[^a-zA-Z0-9]/g, '_')}.graphml` : 'graph_all.graphml';
      const filePath = `C:\\reasoning-bank-poc\\${fileName}`;
      const fsSync = await import('fs');
      fsSync.writeFileSync(filePath, graphML, 'utf8');
      
      return this.createResponse(
        `📈 Граф экспортирован в GraphML:\n${filePath}\n\n` +
        `Откройте в yEd, Gephi или другом инструменте визуализации.`
      );
    } catch (err: any) {
      return this.createResponse(`❌ Ошибка экспорта: ${err.message}`);
    }
  }

  private async handleCompareConfig(oldPath: string, newPath: string): Promise<{ response: string; fullPrompt: string; warnings: any[]; action: 'respond' }> {
    try {
      if (!this.compStorage) {
        this.compStorage = new ComparisonStorage(this.dbPath);
      }
      if (!this.comparator) {
        this.comparator = new ConfigComparator('', '', this.dbPath);
      }

      const result = await this.comparator.compareConfigs(oldPath, newPath);
      
      return this.createResponse(
        `📊 Сравнение завершено:\n` +
        `Сравнение ID: ${result.comparisonId}\n` +
        `Добавлено: ${result.added}\n` +
        `Удалено: ${result.removed}\n` +
        `Изменено: ${result.modified}\n` +
        `Без изменений: ${result.unchanged}`
      );
    } catch (err: any) {
      return this.createResponse(`❌ Ошибка: ${err.message}`);
    }
  }

  private async handleComparisonSummary(): Promise<{ response: string; fullPrompt: string; warnings: any[]; action: 'respond' }> {
    if (!this.compStorage) {
      return this.createResponse('Сравнение не выполнялось. Используйте /compare-config <old> <new>.');
    }
    const details = await this.compStorage.getChangedObjects();
    if (details.length === 0) {
      return this.createResponse('Нет данных о сравнении.');
    }
    const lines = details.map((d: any) => {
      const status = d.status === 'added' ? '➕' : d.status === 'removed' ? '➖' : '📝';
      return `${status} ${d.object_name} (${d.object_type})`;
    });
    return this.createResponse(`📋 Сводка изменений:\n${lines.join('\n')}`);
  }

  private async handleDiffModule(objectName: string): Promise<{ response: string; fullPrompt: string; warnings: any[]; action: 'respond' }> {
    if (!this.comparator) {
      return this.createResponse('Сравнение не выполнялось. Используйте /compare-config <old> <new>.');
    }
    const diff = await this.comparator.compareModule(objectName);
    if (!diff.hasDiff) {
      return this.createResponse(`Модуль "${objectName}" не изменился.`);
    }
    return this.createResponse(`📝 Сравнение модуля "${objectName}":\n${diff.diff}\n\n${diff.summary}`);
  }

  private async handleChangedObjects(type?: string | null): Promise<{ response: string; fullPrompt: string; warnings: any[]; action: 'respond' }> {
    if (!this.compStorage) {
      return this.createResponse('Сравнение не выполнялось. Используйте /compare-config <old> <new>.');
    }
    const objects = await this.compStorage.getChangedObjects(type || undefined);
    if (objects.length === 0) {
      return this.createResponse('Нет изменённых объектов.');
    }
    const lines = objects.map((o: any) => {
      return `• ${o.object_name} (${o.object_type}) — ${o.status}`;
    });
    const typeStr = type ? ` типа "${type}"` : '';
    return this.createResponse(`📋 Изменённые объекты${typeStr}:\n${lines.join('\n')}`);
  }

  private async handleExplain(fullName: string): Promise<{
    response: string;
    fullPrompt: string;
    warnings: any[];
    action: 'respond';
  }> {
    if (!this.codeAnalyzer) {
      return this.createResponse('Анализатор кода не инициализирован. Сначала загрузите конфигурацию командой /load-config');
    }
    const lastDot = fullName.lastIndexOf('.');
    if (lastDot === -1) {
      return this.createResponse('Используйте формат: /explain Объект.Метод (например, Документ.Заказ.ПередЗаписью)');
    }
    const objectName = fullName.substring(0, lastDot);
    const methodName = fullName.substring(lastDot + 1);
    if (!objectName || !methodName) {
      return this.createResponse('Укажите и объект, и метод. Пример: /explain Документ.Заказ.ПередЗаписью');
    }
    try {
      const explanation = await this.codeAnalyzer.explainMethod(objectName, methodName);
      return this.createResponse(`📖 **Объяснение метода ${objectName}.${methodName}:**\n\n${explanation}`);
    } catch (err: any) {
      return this.createResponse(`❌ Ошибка: ${err.message}`);
    }
  }

  private async runExtractMyCode(inputFile: string, outputFile: string): Promise<{
    response: string;
    fullPrompt: string;
    warnings: ErrorWarning[];
    action: 'respond';
  }> {
    const scriptPath = path.join(process.cwd(), 'tools', 'extract_my_code.py');
    try {
      await fs.access(scriptPath);
    } catch {
      return this.createResponse(`❌ Скрипт не найден: ${scriptPath}. Убедитесь, что файл tools/extract_my_code.py существует.`);
    }

    return new Promise((resolve) => {
      const python = spawn('python', [scriptPath, '--input', inputFile, '--output', outputFile]);
      let stdout = '';
      let stderr = '';

      python.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
      python.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

      python.on('close', (code: number) => {
        if (code === 0) {
          const summary = stdout.trim() || stderr.trim();
          resolve(this.createResponse(`✅ ${summary}\nРезультат сохранён в: ${outputFile}`));
        } else {
          resolve(this.createResponse(`❌ Ошибка при выполнении скрипта (код ${code}):\n${stderr}`));
        }
      });

      python.on('error', (err) => {
        resolve(this.createResponse(`❌ Не удалось запустить python: ${err.message}`));
      });
    });
  }

  /**
   * Seed tool records into memory if they don't exist
   */
  async seedTools(): Promise<void> {
    try {
      await this.memory.ensureInitialized();
      
      const tools = await this.memory.getToolsByDomain('tool');
      if (tools.length > 0) {
        console.log(`✅ Tools already seeded: ${tools.length}`);
        return;
      }

      console.log('🌱 Seeding tools into DB...');
      
      const toolsToSeed = [
        {
          id: 'tool-ping',
          task: 'ping',
          content: 'Simple ping tool. Use when user asks to ping or test connectivity.',
          domain: 'tool',
          metadata: {
            tool: {
              type: 'node',
              path: 'tools/ping.js',
              args_template: '',
              confirm: true,
              timeout_sec: 10,
            }
          },
        },
        {
          id: 'tool-extract-my-code',
          task: 'extract-my-code',
          content: 'Extract code from 1C module with markers. Use when user says: extract code, извлечь код, выдели код, найди процедуры, extract my code, get procedures from file, separate code from configuration. Works with 1C .txt files with AVS and Kosmachev markers.',
          domain: 'tool',
          metadata: {
            tool: {
              type: 'python',
              path: 'tools/extract_my_code.py',
              args_template: '--input {input} --output {output}',
              param_patterns: {
                input: '(\\S+\\.\\w+)',  // matches filename with extension
                output: '(\\S+\\.\\w+)?',  // optional output file
              },
              confirm: true,
              timeout_sec: 60,
            }
          },
        },
      ];

      for (const tool of toolsToSeed) {
        try {
          await this.memory.recordExperience({
            id: tool.id,
            task: tool.task,
            outcome: 'success',
            content: tool.content,
            domain: 'tool',
            error_type: 'none',
            confidence: 0.95,
            metadata: tool.metadata,
          });
          console.log(`  ✓ Seeded: ${tool.task}`);
        } catch (err: any) {
          console.log(`  ✗ Error seeding ${tool.task}:`, err.message);
        }
      }

      console.log('✅ Tools seeded successfully');

      // Seed knowledge base
      const knowledgeFiles = await this.getKnowledgeFiles();
      if (knowledgeFiles.length > 0) {
        console.log('🌱 Seeding knowledge base...');
        for (const file of knowledgeFiles) {
          await this.seedKnowledgeFile(file);
        }
        console.log('✅ Knowledge seeded successfully');
      }
    } catch (err: any) {
      console.log('⚠️ Seed warning:', err.message);
    }
  }

  private async getKnowledgeFiles(): Promise<string[]> {
    const fs = await import('fs');
    const path = await import('path');
    const knowledgeDir = './knowledge';
    
    if (!fs.existsSync(knowledgeDir)) {
      return [];
    }

    return fs.readdirSync(knowledgeDir)
      .filter(f => f.endsWith('.md'))
      .map(f => path.join(knowledgeDir, f));
  }

  private async seedKnowledgeFile(filePath: string): Promise<void> {
    const fs = await import('fs');

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const { data, body } = this.parseFrontmatter(content);

      if (data.domain !== 'knowledge') {
        return;
      }

      const keywords = (data.keywords || '').split(',').map((k: string) => k.trim()).filter((k: string) => k);

      // Seed main entry
      await this.memory.recordExperience({
        id: `knowledge-${data.name}`,
        task: data.name,
        outcome: 'success',
        content: body.trim(),
        domain: 'knowledge',
        error_type: 'none',
        confidence: 0.95,
        metadata: {
          language: data.language || 'general',
          is_skill: true,
          description: data.description,
        },
      });

      // Seed keyword entries for better matching
      for (const keyword of keywords) {
        try {
          await this.memory.recordExperience({
            id: `knowledge-${data.name}-${Buffer.from(keyword).toString('base64').slice(0, 8)}`,
            task: keyword,
            outcome: 'success',
            content: body.trim(),
            domain: 'knowledge',
            error_type: 'none',
            confidence: 0.95,
            metadata: {
              language: data.language || 'general',
              is_skill: true,
              description: data.description,
              is_keyword: true,
              parent: `knowledge-${data.name}`,
            },
          });
        } catch (err: any) {
          // Ignore duplicates
        }
      }

      console.log(`  ✓ Seeded knowledge: ${data.name} (${keywords.length} keywords)`);
    } catch (err: any) {
      console.log(`  ✗ Error seeding knowledge ${filePath}:`, err.message);
    }
  }

  private parseFrontmatter(content: string): { data: any; body: string } {
    const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match || match[1] === undefined) {
      throw new Error('No frontmatter found');
    }

    const fm: any = {};
    const lines = match[1].split('\n');
    for (const line of lines) {
      const colonIndex = line.indexOf(':');
      if (colonIndex > 0) {
        const key = line.slice(0, colonIndex).trim();
        let value: any = line.slice(colonIndex + 1).trim();
        
        if ((value.startsWith('"') && value.endsWith('"')) || 
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        
        fm[key] = value;
      }
    }

    return { data: fm, body: match ? (match[2] || '') : '' };
  }

  /**
   * Get memory instance (for external access)
   */
  getMemory(): ReasoningBankSemantic {
    return this.memory;
  }

  /**
   * Initialize tool integration (call after seeding)
   */
  async initializeTools(): Promise<void> {
    if (this.toolIntegration) {
      await this.toolIntegration.initialize();
      console.log('✅ Tool integration initialized');
    }
  }
}
