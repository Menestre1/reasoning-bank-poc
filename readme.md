Проект разработан в рамках публикации на ![Логотип Инфостарт](https://infostart.ru/bitrix/templates/sandbox_empty/assets/tpl/abo/img/logo.svg)

Ссылка на публикацию 
[https://infostart.ru/1c/reports/2508153/](https://infostart.ru/1c/articles/2683130/)
 
 # ReasoningBank PoC — Семантическая память для Lir Agent

Система памяти для LLM-агента «Лирь», которая позволяет запоминать опыт, избегать повторения ошибок и автоматически закреплять успешные паттерны как навыки.

---

## Быстрый старт

### Установка
```bash
# Node.js 20+ (через fnm или напрямую)
fnm install 20
fnm use 20

# Зависимости
npm install

# Опционально: TypeScript компилятор для продакшена
npm install -D typescript
```

### Запуск интерактивного чата
```bash
npx tsx chat.ts
```

### Папка scratch
Для временных файлов (тесты, бэкапы, диагностика, old data) используется папка `scratch/`. Она в `.gitignore` — файлы там не пушатся, но сохраняются локано на случай, если понадобится вспомнить результат прошлого теста.

### Правило работы с помойкой
**Никогда не удалять файлы — только помещать в `scratch/`.**

Это правило действует всегда и для всех файлов:
- Тесты (`test-*.ts`, `test-*.mjs`)
- Бэкапы и `.backup`
- Диагностические файлы (`.d.ts.map`, логи)
- Старые тестовые данные
- Скомпилированные файлы, которые не нужны в репозитории

Если файл не должен пушиться — он перемещается в `scratch/`, а не удаляется. Это позволяет сохранить историю и контекст на случай, если понадобится вспомнить результат прошлого теста или отключённой диагностики.

При старте агент:
1. Показывает список доступных моделей Ollama
2. Автоматически выбирает `gemma4:26b-a4b-it-q4_K_M` (если доступна)
3. Сеидит инструменты и базу знаний

---

## Команды

### Основные команды чата
| Команда | Действие |
|---------|----------|
| `/help` | Показать справку |
| `/models` | Список всех доступных моделей Ollama |
| `/model <имя>` | Сменить модель (например: `/model llama3.2:latest`) |
| `/tools` | Список всех инструментов (через базу знаний) |
| `/stats` | Статистика памяти |
| `/lang` | Выбрать язык программирования |
| `/learn` | Сохранить последний диалог как знание (навык) |
| `/exit` | Выход |

### Команды обратной связи (в ответ на вопрос "Я справился?")
| Команда | Действие |
|---------|----------|
| `да`, `молодец`, `хорошо` | Положительный фидбек (+1 к счётчику) |
| `нет, <описание>` | **Новое!** Отрицательный фидбек с пояснением в одной строке |
| `нет` | Отрицательный фидбек (покажет список типов ошибок) |
| `1`-`4` или название | Выбор типа ошибки (эхолалия, парафазия, контаминация, галлюцинация) |

### Пример новой фичи: фидбек с пояснением
```
💬 Вы: как начать транзакцию в 1С?
🤖 Лирь: Используйте НачатьТранзакцию()...

💬 Вы: нет, неправильный синтаксис, надо НачатьТранзакцию
🤖 ⚠️ Записана ошибка: none. Причина: "неправильный синтаксис, надо НачатьТранзакцию". Спасибо за пояснение, я запомню!
```

---

## Архитектура

```
Пользователь → LirAgent.processMessage()
   │
   ├─ Проверка: "нет, <описание>" → parseErrorCommand() → handleErrorFeedback(description)
   │
   ├─ Проверка: waitingForFeedback → processFeedback()
   │      ├─ "да" → recordFeedback(success) → promotion в навык (3 подряд)
   │      └─ "нет" → ask_error_type → выбор типа ошибки
   │
   ├─ Сохранение диалога (domain='dialogue', outcome='pending')
   │
   └─ recommendWithWarnings() → LLM генерация
          ├─ HNSWBackend.search() → k ближайших соседей (O(log N))
          ├─ LRUCache.get() → кэш повторяющихся запросов (TTL 60s)
          ├─ enrichedPrompt → OllamaClient.chat() → ответ LLM
```

### Компоненты

| Компонент | Файл | Назначение |
|-----------|------|------------|
| `ReasoningBankSemantic` | `src/ReasoningBankSemantic.ts` | Ядро памяти: запись, поиск, предотвращение ошибок, feedback, TTL |
| `HNSWBackend` | `src/HNSWBackend.ts` | HNSW-индекс для приближённого поиска ближайших соседей |
| `LRUCache` | `src/LRUCache.ts` | LRU-кэш результатов поиска с TTL |
| `OllamaClient` | `src/OllamaClient.ts` | Клиент Ollama: chat, listModels, ping, chatStream |
| `LirAgent` | `src/LirAgent.ts` | Агент с памятью, выбором языка, feedback и переключением моделей |
| `IntentAnalyzer` | `src/tools/IntentAnalyzer.ts` | Семантический анализ: предложение инструментов |

---

## Модель данных

### Experience (опыт)

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | `string` | Уникальный идентификатор |
| `task` | `string` | Описание задачи |
| `outcome` | `'success' \| 'failure'` | Результат |
| `content` | `string` | Содержимое опыта (стратегия, описание ошибки) |
| `domain` | `string` | Область: `tool`, `knowledge`, `dialogue`, `general` |
| `error_type` | `ErrorType` | Тип ошибки: `парафазия`, `эхолалия`, `контаминация`, `галлюцинация`, `none` |
| `confidence` | `number` | Уверенность (0–1) |
| `usage_count` | `number` | Сколько раз использовался |
| `consecutive_successes` | `number` | Последовательных успехов подряд |
| `is_skill` | `boolean` | Закреплён как навык |
| `user_input` | `string?` | Ввод пользователя |
| `metadata.feedback_description` | `string?` | **Новое!** Пояснение при отрицательном фидбеке |
| `metadata.agent_response` | `string?` | Ответ агента |
| `created_at` | `string` | ISO-дата создания |
| `expires_at` | `string?` | ISO-дата истечения (NULL для навыков) |
| `embedding` | `Float32Array` | 384-мерный вектор (BLOB в SQLite) |

### ErrorType (типы ошибок)

| Тип | Описание | Совет |
|-----|----------|-------|
| `эхолалия` | Повторение фразы пользователя | Не повторяй фразу. Дай содержательный ответ |
| `парафазия` | Искажение терминов/смысла | Проверяй термины перед использованием |
| `контаминация` | Смешивание контекстов | Отвечай на один вопрос за раз |
| `галлюцинация` | Выдуманные факты | Если не знаешь — скажи прямо |

---

## Семантический поиск

### Алгоритм scoring
```
score = 0.5 * similarity + 0.2 * recency + 0.3 * confidence + skillBonus

similarity  — косинусное сходство query ↔ experience (0–1)
recency     — константа 0.8 (можно заменить на exp-decay)
confidence  — уверенность в опыте (0–1)
skillBonus  — +0.2 если is_skill = true
```

### HNSW vs линейный поиск

| N записей | Линейный (avg) | HNSW (avg) | Ускорение |
|-----------|---------------|------------|-----------|
| 10 | 1.03 ms | 1.12 ms | 0.9x |
| 100 | 2.72 ms | 1.33 ms | 2.0x |
| 1 000 | 18.16 ms | 1.50 ms | 12.1x |
| 5 000 | 91.12 ms | 1.65 ms | **55.2x** |

HNSW параметры (по умолчанию): `M=16`, `efConstruction=200`, `efSearch=50`.

Индекс сохраняется в JSON-файл (`agentdb_hnsw.json`) и восстанавливается при перезапуске.

### LRU-кэш
- Размер: 256 записей (настраивается через `cacheSize`)
- TTL: 60 секунд (настраивается через `cacheTTL`)
- Ключ: `JSON.stringify({ query, k, domain, error_type, only_skills })`
- Полная инвалидация при `recordExperience()` (добавление нового опыта)

---

## Команды обратной связи

### Правило «3 успеха → навык»
После 3 последовательных подтверждений (`да`, `молодец`, `хорошо`) опыт автоматически помечается как `is_skill = true` и получает:
- Бессрочное хранение (`expires_at = NULL`)
- Бонус +0.2 к scoring
- Приоритет в результатах поиска

### Новая фича: фидбек с пояснением
Теперь пользователь может написать в одной строке:
```
нет, неправильная команда, надо /search-code
```
Агент:
1. Распознаёт паттерн `нет, <описание>`
2. Сохраняет пояснение в `metadata.feedback_description`
3. Не требует выбора типа ошибки (пропускает этот шаг)
4. Записывает ошибку с тегом `error_type='none'`

В базе данных появится запись с:
- `outcome='failure'`
- `metadata.feedback_description = "неправильная команда, надо /search-code"`
- `metadata.user_feedback = "стоп, неправильная команда, надо /search-code"`

---

## TTL и очистка

| Тип записи | TTL | Поведение |
|------------|-----|-----------|
| Обычный опыт | 90 дней | Удаляется при `cleanupExpired()` |
| Навык (`is_skill = 1`) | ∞ (NULL) | Никогда не удаляется |

```typescript
// Ручная очистка
const { deleted } = await memory.cleanupExpired();

// Мониторинг
const stats = await memory.getTTLStats();
// { total: 100, expired: 5, expiringSoon24h: 3, skills: 10, noExpiry: 10 }
```

---

## Выбор модели Ollama

При запуске `chat.ts` агент:
1. Показывает список всех доступных моделей
2. Автоматически выбирает `gemma4:26b-a4b-it-q4_K_M` (если доступна)
3. Если не удалось — использует первую доступную

### Команды в диалоге
| Команда | Действие |
|---------|----------|
| `/model` | Сменить модель (запросит имя вручную) |
| `/models` | Показать список всех доступных моделей |

### Конфигурация `.env`
```env
# Ollama Cloud
OLLAMA_API_KEY=your_cloud_key
OLLAMA_BASE_URL=https://ollama.com
OLLAMA_MODEL=gpt-oss:20b-cloud

# Или локальный Ollama:
# OLLAMA_BASE_URL=http://localhost:11434
# OLLAMA_API_KEY=
# OLLAMA_MODEL=llama3.2:latest

# Параметры генерации
OLLAMA_TEMPERATURE=0.7
OLLAMA_CONTEXT_LENGTH=4096
```

### Локальный Ollama
1. Установите и запустите: `ollama serve`
2. Скачайте модель: `ollama pull llama3.2`
3. В `.env` укажите `OLLAMA_BASE_URL=http://localhost:11434`

---

## API Reference

### ReasoningBankSemantic

```typescript
class ReasoningBankSemantic {
  constructor(config: {
    dbPath: string;
    dimension?: number;        // default: 384
    namespace?: string;        // default: 'agent:lir'
    hnswEnabled?: boolean;     // default: true
    cacheSize?: number;        // default: 256
    cacheTTL?: number;         // default: 60000 (ms)
  });

  // Запись опыта
  recordExperience(exp: Experience): Promise<string>;

  // Семантический поиск
  retrieve(query: string, options?: {
    k?: number;               // default: 5
    domain?: string;
    error_type?: string;
    only_skills?: boolean;
  }): Promise<RetrievedExperience[]>;

  // Предотвращение ошибок
  preventError(userInput: string, options?: {
    k?: number;               // default: 5
    threshold?: number;       // default: 0.4
  }): Promise<ErrorWarning[]>;

  // Автозапись ошибки из feedback
  learnFromFeedback(
    errorType: ErrorType,
    userInput: string,
    agentResponse: string,
    description?: string        // НОВОЕ! Пояснение пользователя
  ): Promise<string>;

  // Рекомендации + предупреждения (объединённый метод)
  recommendWithWarnings(query: string, userInput?: string): Promise<{
    strategy: string;
    priority: 'high' | 'normal';
    warnings: ErrorWarning[];
    enrichedPrompt: string;
  }>;

  // Feedback → promotion
  recordFeedback(expId: string, success: boolean): Promise<{
    consecutive: number;
    promoted: boolean;
  }>;

  // Рекомендации (без предупреждений)
  recommendStrategy(query: string, context?: {
    text?: string;
    error_type?: string;
  }): Promise<{ strategy: string; priority: 'high' | 'normal'; experiences: RetrievedExperience[] }>;

  // Статистика
  getStats(): Promise<{
    totalExperiences: number;
    skills: number;
    byOutcome: Record<string, number>;
    byErrorType: Record<string, number>;
    withUserInput: number;
    byLanguage: Record<string, number>;
  }>;

  // TTL
  cleanupExpired(): Promise<{ deleted: number }>;
  getTTLStats(): Promise<{
    total: number;
    expired: number;
    expiringSoon24h: number;
    skills: number;
    noExpiry: number;
  }>;

  // HNSW
  rebuildIndex(): Promise<void>;

  // Lifecycle
  close(): Promise<void>;
}
```

### LirAgent

```typescript
class LirAgent {
  constructor(options: {
    dbPath: string;
    agentId?: string;
    systemPrompt?: string;
    llmModel?: string;        // default: OLLAMA_MODEL env or 'gpt-oss:20b-cloud'
    temperature?: number;     // default: OLLAMA_TEMPERATURE env or 0.7
    contextLength?: number;   // default: OLLAMA_CONTEXT_LENGTH env or 4096
  });

  processMessage(userInput: string): Promise<{
    response: string;
    fullPrompt: string;
    warnings: ErrorWarning[];
    action: 'respond' | 'learn_error' | 'record_success' | 'ask_language' | 'waiting_feedback';
    languageQuestion?: string;
  }>;

  // Переключение модели Ollama
  switchModel(newModel: string): Promise<{
    success: boolean;
    message: string;
    available?: string[];
  }>;

  getCurrentModel(): string;
  getAvailableModels(): Promise<ModelInfo[]>;

  getStats(): Promise<any>;
  close(): Promise<void>;
}
```

### OllamaClient

```typescript
class OllamaClient {
  constructor(options?: {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    temperature?: number;     // default: 0.7
    contextLength?: number;   // default: 4096
  });

  listModels(): Promise<ModelInfo[]>;
  chat(messages: ChatMessage[], model?: string): Promise<string>;
  chatStream(messages: ChatMessage[], onChunk: (chunk: string) => void, model?: string): Promise<void>;
  ping(model?: string): Promise<boolean>;
}
```

---

## Рекомендации по развитию

1. **Streaming-ответы** — использовать `chatStream()` для потоковой генерации ответов.
2. **Мониторинг** — добавить метрики (latency поиска, hit rate кэша, количество ошибок) через Prometheus.
3. **Автоклассификация ошибок** — классификатор на основе эмбеддингов для автоматического определения типа ошибки.
4. **Масштабирование** — протестировать на 50k–100k записей; при необходимости перейти на `sqlite-vec` или `ruvector`.
5. **Docker** — этап 6 для воспроизводимых деплоев (отложен).

---

## Документация

| Файл | Описание |
|------|----------|
| `docs/LirAgent-Technical-Documentation.md` | Полная тех. документация LirAgent: архитектура, память, feedback loop, promotion, анти-паттерны |
| `docs/MainArchitecture21.md` | 44 правила архитектуры LirAgent 2.0 — генетический код системы памяти |
| `docs/Formal_NORA_constitution.md` | Конституция NORA v1.0 — принципы, cognition, memory, retrieval, reasoning, governance |
| `docs/NORA_Router_Engine_Architecture.md` | Архитектура Router Engine — когнитивный маршрутизатор для LirAgent |
| `docs/nora_skill_dsl_specification.md` | Skill DSL — формальный язык описания навыков для NORA/LirAgent |
| `docs/nora_trajectory_schema_architecture.md` | Trajectory Schema — модель жизненного цикла reasoning-path |
| `docs/production-grade_system_prompt.md` | System Prompt продакшен-уровня для LirAgent |
| `docs/Prolog_laws.md` | Конституционные законы NORA в формате Prolog для валидации |

---

## Лицензия

ISC

---

## Статистика проекта

- ✅ **TypeScript compilation**: passes
- ✅ **SQL memory leak**: fixed (proper handling of prepared statements)
- ✅ **Model selection**: working with `/model` and `/models` commands
- ✅ **Negative feedback with description**: implemented (new feature)
- ✅ **Repository cleanup**: 108 test/compiled files removed
- ✅ **Tests**: comprehensive test suite passes
- 📦 **Documentation**: updated (this file)

### Commit History
- `5dfa9d5` - Add documentation index table to README
- `1f4f43e` - Add scratch folder and 'never delete, only scratch' rule
- `f965869` - Rename Architecture21.md to MainArchitecture21.md
- `60d1974` - Add NORA architecture documentation suite
- `fef0b9b` - Extend waitingForFeedback state to accept commands
- `eb206de` - Update readme.md
- `435dc61` - Update README: add /learn to command table, preserve Infostart link
