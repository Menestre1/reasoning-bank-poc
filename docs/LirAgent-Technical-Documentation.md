---
name: LirAgent Technical Documentation
description: Complete technical documentation describing LirAgent architecture, memory system, feedback loop, experience-to-skill promotion, anti-pattern detection, and tool system
domain: knowledge
language: general
---

# LirAgent Technical Documentation

## Table of Contents
1. [Executive Summary](#executive-summary)
2. [Architecture Overview](#architecture-overview)
3. [Core Components](#core-components)
4. [Agent Behavior and Workflow](#agent-behavior-and-workflow)
5. [Memory System (ReasoningBank)](#memory-system-reasoningbank)
6. [Patient Knowledge Base](#patient-knowledge-base)
7. [Feedback Loop](#feedback-loop)
8. [Experience-to-Skill Promotion](#experience-to-skill-promotion)
9. [Anti-Pattern System (Warnings)](#anti-pattern-system-warnings)
10. [Tool System](#tool-system)
11. [Knowledge Base](#knowledge-base)
12. [Data Models](#data-models)
13. [Key Algorithms](#key-algorithms)
14. [1C Configuration Analysis Modules](#1c-configuration-analysis-modules)

---

## Executive Summary

LirAgent (codenamed "Лирь") is an intelligent conversational agent that learns from interactions through a sophisticated memory system. It combines LLM-powered conversations with a semantic memory system that:
- Records experiences (dialogues, tool usage, knowledge)
- Learns from positive/negative feedback ("да"/"нет")
- Promotes repeated successful patterns to "skills"
- Detects and avoids anti-patterns (эхолалия, парафазия, контаминация, галлюцинация)
- Integrates with 1С configuration analysis tools

**Key Innovation**: The agent uses a `consecutive_successes` counter that must reach 3 for an experience to become a "skill", preventing premature promotion of unproven patterns.

**Major additions since v1.0**:
- **Patient Knowledge Base** — separate SQLite database (`patient_kb.db`) that automatically saves code blocks from user messages and injects recent code into LLM context
- **1C Configuration Search** — `ConfigStorage` with FTS5 full-text search + LIKE fallback, enabling `/search-code` and `/semantic-search` commands
- **ConfigLoader improvements** — parses XML metadata and loads BSL modules from `Ext/` and `Forms/*/Ext/Form/` directories
- **Production-grade system prompt** — loaded from external file (`docs/production-grade_system_prompt.md`) with LANGUAGE CONSISTENCY POLICY and critical rules
- **Streaming mode** — `--stream` flag for token-by-token output with visual indicator
- **15 automated tests** — vitest suite covering PatientKB, code extraction, and `/next` command

---

## Architecture Overview

### System Components

```
┌──────────────────────────────────────────────────────────────────┐
│                         User Interface                           │
│                    (chat.ts - entry point)                      │
└───────────────────────────┬──────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│                     LirAgent (Main Orchestrator)                │
│  - Conversation flow management                                 │
│  - Feedback processing (да/нет/отмена)                         │
│  - Language detection                                          │
│  - Session state management                                    │
│  - extractCodeBlocks() — auto-save patient code                │
│  - PatientKB integration (saveCode + findRecentCode + search)  │
│  - ConfigLoader integration (/load-config, /search-code)       │
└──────┬─────────────┬────────────────┬────────────────┬──────────┘
       │             │                │                │
       ▼             ▼                ▼                ▼
┌──────────────┐ ┌──────────┐ ┌──────────────┐ ┌──────────────────┐
│ ReasoningBank│ │Ollama    │ │Patient       │ │ConfigStorage     │
│ Semantic     │ │Client    │ │KnowledgeBase │ │(config_objects)  │
│ - Vector     │ │(LLM API) │ │(patient_kb)  │ │ - FTS5 (unicode61)│
│   search     │ │          │ │ - saveCode   │ │ - LIKE fallback  │
│ - Experience │ │          │ │ - searchCode │ │ - getObjectCount │
│   store      │ │          │ │ - clearProfile│ │ - getSampleNames  │
│ - Feedback   │ │          │ │ - findRecent │ │                  │
│ - Promotion  │ │          │ │              │ │ ┌──────────────┐ │
└──────────────┘ └──────────┘ └──────────────┘ │ │ ConfigLoader  │ │
                                                │ │(parse 1C XML) │ │
                                                │ │ - Ext/*.bsl   │ │
                                                │ │ - Forms/*/Ext/│ │
                                                │ │   Form/Module │ │
                                                │ └──────────────┘ │
                                                └──────────────────┘
```

### File Structure

| Component | File Path | Purpose |
|-----------|-----------|---------|
| Main Agent | `src/LirAgent.ts` | Core orchestration logic (1645 lines) |
| Memory System | `src/ReasoningBankSemantic.ts` | Experience storage and retrieval (596 lines) |
| LLM Client | `src/OllamaClient.ts` | Ollama API integration |
| Tool System | `src/tools/` | Tool registry, intent analysis, execution |
| Patient Knowledge Base | `src/PatientKnowledgeBase.ts` | Separate memory for patient code blocks (auto-save, LIKE-search, `/next`) |
| Config Storage | `src/ConfigStorage.ts` | FTS5-indexed `config_objects` table for 1C configuration search |
| Config Loader | `src/ConfigLoader.ts` | Parses 1C XML metadata + loads BSL from Ext/ and Forms/ |
| Config Analysis | `src/Dependency*.ts` | 1С configuration dependency graph |
| Performance | `src/Performance*.ts` | Performance measurement loading |
| Comparison | `src/ConfigComparator.ts` | Config version comparison (diff) |

---

## Core Components

### 1. LirAgent Class (`src/LirAgent.ts`)

**Responsibilities**:
- Process user messages (`processMessage()` line 234)
- Manage conversation session state
- Handle feedback loop ("да"/"нет"/"отмена")
- Coordinate between memory, LLM, and tools

**Session State** (lines 26-45):
```typescript
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
  // Tool states
  waitingForTool: boolean;
  pendingTool: any;
  // Dialogue tracking
  lastDialogueId?: string | null;
}
```

**Key Methods**:
- `processMessage(userInput)` - Main entry point for user input (sync mode)
- `processMessageStream(userInput, onChunk)` - Streaming version (async generator)
- `processFeedback(userInput)` - Handle "да"/"нет" responses
- `handleSuccessFeedback()` - Process positive feedback
- `handleErrorFeedback(errorType)` - Process negative feedback
- `processWithLanguage(userInput, language)` - Generate response with language context
- `extractCodeBlocks(text)` - Extract fenced/indented code blocks from text, save to PatientKB
- `handleSearchCode(args)` - Search `ConfigStorage` via FTS5 with LIKE fallback
- `handleSemanticSearch(args)` - Search `ConfigStorage` via ReasoningBank + FTS
- `loadConfigInBackground(configPath)` - Load 1C configuration asynchronously
- `handleNextCommand()` - Clear patient knowledge for current profile

---

### 2. ReasoningBankSemantic Class (`src/ReasoningBankSemantic.ts`)

**Responsibilities**:
- Store experiences with vector embeddings
- Retrieve similar experiences via semantic search
- Handle feedback and promote experiences to skills
- Generate warnings from failed experiences

**Core Data Model** (lines 16-33):
```typescript
interface Experience {
  id: string;
  task: string;                    // Short description
  outcome: 'success' | 'failure' | 'pending';
  content: string;                 // Full response/code
  domain: string;                  // 'dialogue', 'knowledge', 'tool', etc.
  error_type: ErrorType;           // 'none' | 'эхолалия' | 'парафазия' | 'контаминация' | 'галлюцинация'
  confidence: number;              // 0.0 - 1.0
  consecutive_successes: number;   // Key counter for skill promotion
  is_skill: boolean;              // true when consecutive_successes >= 3
  user_input?: string;             // Original user question
  metadata?: Record<string, any>;
}
```

---

## Agent Behavior and Workflow

### Main Interaction Flow

```
User Input (e.g., "Как определить язык программирования?")
    │
    ▼
[LirAgent.processMessage()] ───────────────────────────────────┐
    │                                                          │
    ├─▶ Check slash commands (/load-config, /search-code, etc.) │
    │                                                          │
    ├─▶ Check if waiting for tool confirmation                 │
    │       │                                                  │
    │       ▼                                                  │
    │   [ToolIntegration.processConfirmation()]                 │
    │                                                          │
    ├─▶ Semantic analysis for tool suggestion                  │
    │       │                                                  │
    │       ▼                                                  │
    │   [IntentAnalyzer.analyze()] ──▶ [ReasoningBank.recommendTools()]
    │                                                          │
    ├─▶ Check if waiting for language choice                   │
    │                                                          │
    ├─▶ Check if waiting for feedback (да/нет)                 │
    │       │                                                  │
    │       ▼                                                  │
    │   [processFeedback()] ──▶ handleSuccessFeedback()        │
    │                    └──▶ handleErrorFeedback()             │
    │                                                          │
    ▼                                                          │
[processWithLanguage(userInput, language)] ◄───────────────────┘
    │
    ├─▶ Search knowledge base
    │       │
    │       ▼
    │   [ReasoningBank.retrieve()]
    │
    ├─▶ Get warnings from past failures
    │       │
    │       ▼
    │   [ReasoningBank.recommendWithWarnings()]
    │
    ├─▶ Build system prompt with memory context
    │       │
    │       ▼
    │   [buildSystemPrompt()] - includes warnings block
    │
    ├─▶ Record dialogue (pending state)
    │       │
    │       ▼
    │   [ReasoningBank.recordExperience(outcome: 'pending')]
    │
    ├─▶ Call LLM with enriched prompt
    │       │
    │       ▼
    │   [OllamaClient.chat()]
    │
    ▼
Return response + "Я справился? (да/нет/отмена)"
    │
    ▼
Set session.waitingForFeedback = true
```

### Prompt Building Logic (`src/LirAgent.ts:1025-1036`)

The system prompt is constructed from four components:

1. **Production-grade base prompt** — loaded from `docs/production-grade_system_prompt.md` at startup
2. **Language instruction** — Specific syntax rules for 1С/JS/TS/Python/Go
3. **Patient code context** — Last 3 code blocks from `PatientKnowledgeBase.findRecentCode()`
4. **Memory block** — Contains:
   - Warnings from failed experiences (BLOCKS knowledge if present)
   - Knowledge base content (ONLY if no warnings)

**Production-grade system prompt** (`docs/production-grade_system_prompt.md`, 347 lines):
- Includes LANGUAGE CONSISTENCY POLICY — the agent **must** match the user's language (Russian/English)
- Defines anti-pattern policies: эхолалия, парафазия, контаминация, галлюцинация
- Sets context priority order: warnings > skills > successful experiences > general knowledge
- Includes failure prevention checklist before every response

```typescript
// System prompt loading in chat.ts
const systemPromptFile = 'docs/production-grade_system_prompt.md';
let systemPrompt: string;
try {
  systemPrompt = fs.readFileSync(systemPromptFile, 'utf-8');
} catch (err) {
  console.error(`[ERROR] Cannot read system prompt file: ${systemPromptFile}`);
  process.exit(1);
}
```

**Critical Logic** (lines 722-731):
```typescript
const hasWarnings = enriched.warnings.length > 0;

if (hasWarnings) {
  // BLOCK knowledge usage - agent must change approach
  fullSystemPrompt += `⚠️ ВНИМАНИЕ: Обнаружены негативные паттерны! 
  НЕ используй информацию, которая приводила к ошибкам: ${errorList}`;
} else if (knowledgeResult.bestScore >= 0.6) {
  // Safe to use knowledge
  fullSystemPrompt += `Use ONLY: ${knowledgeResult.content}`;
}
```

---

## Memory System (ReasoningBank)

### Embedding Mechanism (`src/ReasoningBankSemantic.ts:72-89`)

The system uses **hash-based embeddings** (PoC replacement for ML models):
- Text is lowercased and split into tokens
- Each token is hashed with SHA-256
- Values are accumulated across tokens to create a 384-dimensional float vector
- Vector is normalized to unit length

**Note**: The project has `@xenova/transformers` and `agentdb` in dependencies, but the current `ReasoningBankSemantic.ts` implementation uses this simpler hash-based approach for PoC purposes.

```typescript
function hashEmbedding(text: string, dim: number = 384): Float32Array {
  const vector = new Float32Array(dim);
  const tokens = text.toLowerCase().split(/\s+/);
  for (const token of tokens) {
    const hash = createHash('sha256').update(token).digest();
    for (let i = 0; i < dim && i < hash.length; i++) {
      vector[i] = (vector[i] || 0) + (hash.readUInt8(i) / 255) - 0.5;
    }
  }
  // Normalize
  const norm = Math.sqrt(vector.reduce((s, v) => s + v * v, 0)) || 1;
  for (let i = 0; i < dim; i++) {
    vector[i] = (vector[i] || 0) / norm;
  }
  return vector;
}
```

**Dimension**: 384 (configurable via `SemanticMemoryConfig.dimension`, default 384)

### Vector Search (`retrieve()` method, lines 189-230)

1. Generate query embedding
2. Fetch all rows from DB (with filters: domain, error_type, only_skills)
3. Calculate cosine similarity for each row
4. Score formula:
   ```
   score =0.5 × similarity + 0.2 × recency + 0.3 × confidence + skillBonus + failurePenalty
   ```
   Where:
   - `skillBonus = 0.2` if `is_skill`
   - `failurePenalty = -0.5` if `outcome === 'failure'`

5. Sort by score, return top-k results

### Semantic Experience Update (`findSimilarExisting()`, lines 541-562)

**Purpose**: Prevent duplication by finding semantically similar successful experiences.

**Logic**:
```
When adding new experience (without explicit ID):
  1. Generate embedding for the text
  2. Search all rows in same domain
  3. Calculate cosine similarity
  4. If similarity >= threshold (0.7 for dialogues, 0.85 for others):
     - Return existing experience ID (do NOT create new)
     - Increment usage_count on existing record
  5. If no similar found: create new experience
```

**Benefit**: Accumulates usage statistics for semantically similar questions without creating duplicate records. Different phrasings of the same question map to one experience.

### Storage Schema

```sql
CREATE TABLE rb_experiences (
  id TEXT PRIMARY KEY,
  task TEXT NOT NULL,
  outcome TEXT NOT NULL,           -- 'success'|'failure'|'pending'
  content TEXT,
  domain TEXT NOT NULL,
  error_type TEXT DEFAULT 'none',
  confidence REAL DEFAULT 0.5,
  usage_count INTEGER DEFAULT 0,
  consecutive_successes INTEGER DEFAULT 0,
  is_skill INTEGER DEFAULT 0,       -- 0 or 1 (boolean)
  user_input TEXT,
  metadata TEXT,                    -- JSON string
  embedding BLOB,                   -- 384 × Float32 = 1536 bytes
  language TEXT DEFAULT 'general',
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT                    -- NULL = permanent
);
CREATE INDEX IF NOT EXISTS idx_rb_outcome ON rb_experiences(outcome);
CREATE INDEX IF NOT EXISTS idx_rb_domain ON rb_experiences(domain);
CREATE INDEX IF NOT EXISTS idx_rb_error_type ON rb_experiences(error_type);
```

**Note**: Deduplication is handled **logically** (not via SQL UNIQUE constraint):
- For dialogues: Exact `task` match check (`ReasoningBankSemantic.ts:249-257`)
- For general experiences: `findSimilarExisting()` semantic search (see below)

---

## Dialogue Lifecycle

### States and Transitions

```
User asks question
    │
    ▼
[recordExperience(outcome: 'pending')]  ← Dialogue created with pending status
    │
    │  - lastDialogueId saved in session
    │  - lastExperienceId set for recordFeedback
    │
    ▼
Agent generates response using LLM
    │
    ▼
Display response + "Я справился? (да/нет/отмена)"
    │
    ▼
User says "да" (success)
    │
    ▼
[recordFeedback(expId, true)]
    │
    ├─▶ Update outcome to 'success'
    ├─▶ Increment consecutive_successes by 1
    └─▶ If consecutive_successes >= 3: promote to skill
            Return { consecutive: N, promoted: true }

User says "нет" (failure)
    │
    ▼
[handleErrorFeedback(errorType)]
    │
    ├─▶ Update outcome to 'failure'
    ├─▶ Reset consecutive_successes to 0
    ├─▶ Record error_type (эхолалия/парафазия/контаминация/галлюцинация)
    └─▶ If text follows "нет, <description>":
            Save feedback_description in metadata
            Display: "⚠️ Записана ошибка: <type>. Спасибо за пояснение!"

User says "отмена" (cancel)
    │
    ▼
[processFeedback()]
    │
    └─▶ Do NOT update database
            Return: "Ок, не сохраняем."
```

### Important Notes

1. **Pending experiences don't affect ranking**: Until feedback is received, the experience has `outcome='pending'` and won't influence skill promotion or warnings.

2. **usage_count vs consecutive_successes**:
   - `usage_count`: Total times experience was used (incremented by `findSimilarExisting`)
   - `consecutive_successes`: Consecutive successes (reset on failure, used for skill promotion)

3. **Duplicate prevention**: For dialogues, exact `task` match prevents duplicates. For other domains, `findSimilarExisting()` with threshold 0.7-0.85 prevents semantic duplicates.

---

## Patient Knowledge Base

### Overview

**File**: `src/PatientKnowledgeBase.ts` (79 lines)

Patient Knowledge Base (`PatientKnowledgeBase`) is a **separate memory store** for code blocks that the user shares during conversations. Unlike `ReasoningBankSemantic` (which stores agent experiences), PatientKB holds **the user's own code** — code they ask about, debug, or reference.

Key differences from ReasoningBank:
| Aspect | ReasoningBank | PatientKB |
|--------|--------------|-----------|
| Database | `agentdb.db` | `patient_kb.db` |
| Table | `rb_experiences` | `patient_knowledge` |
| Stores | Agent experiences (dialogues, tools) | User's code blocks |
| Search | Vector (cosine similarity) | LIKE on content |
| Retention | TTL-based (90 days) | Permanent until `/next` |
| Memory mechanisms | TTL, cats, promotion, skills | None (simple append-only) |

### Schema

```sql
CREATE TABLE IF NOT EXISTS patient_knowledge (
  id TEXT PRIMARY KEY,
  patient_profile TEXT NOT NULL,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  language TEXT,
  source TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_pk_profile ON patient_knowledge(patient_profile);
CREATE INDEX IF NOT EXISTS idx_pk_hash ON patient_knowledge(content_hash);
```

### Core Methods

#### `saveCode(patientProfile, code, language?, source?)`

Automatically called by `LirAgent.extractCodeBlocks()` during `processMessage()` / `processMessageStream()`.

**Deduplication**: Uses SHA-256 hash of `code` — if the same code block was already saved for this profile, it is silently skipped:
```typescript
const contentHash = createHash('sha256').update(code).digest('hex');
const existing = this.db.prepare(
  'SELECT id FROM patient_knowledge WHERE patient_profile = ? AND content_hash = ?'
).get(patientProfile, contentHash);
if (existing) return;
```

#### `findRecentCode(patientProfile, limit)`

Returns the most recent `limit` code blocks for context injection. Called by `processMessage()` to inject the last 3 blocks into the LLM prompt.

#### `searchCode(patientProfile, query, limit)`

LIKE-based search that splits the query into words > 2 characters:
```typescript
const terms = query.split(/\s+/).filter(t => t.length > 2);
const conditions = terms.map(() => 'content LIKE ?');
// WHERE patient_profile = ? AND (content LIKE '%word1%' OR content LIKE '%word2%')
```

Used by the `/search-code` command to find relevant patient code.

#### `clearProfile(patientProfile)`

Called by the `/next` command — **deletes all patient knowledge** for the current profile. This is the only way to clear patient memory (no TTL).

### Integration in LirAgent

During `processMessage()` and `processMessageStream()` (in `LirAgent.ts`):

```
processMessage(userInput)
  │
  ├─▶ extractCodeBlocks(userInput) → codeBlocks[]
  │       For each block:
  │       - patientKB.saveCode(profile, code, language)
  │
  ├─▶ patientKB.findRecentCode(profile, 3)
  │       → injects last 3 code blocks into LLM context
  │
  ├─▶ (later) patientKB.searchCode(profile, query)
  │       → used by /search-code command
  │
  └─▶ /next → patientKB.clearProfile(profile)
```

### extractCodeBlocks Logic

**Location**: `LirAgent.ts` method

Extracts code blocks from user messages using regex:
```typescript
const blockRegex = /```(\w*)\n([\s\S]*?)```|(^ {4,}[^\n]+(?:\n {4,}[^\n]+)*)/gm;
```

Matches two patterns:
1. Fenced code blocks: ` ```language ... ``` `
2. Indented code blocks (4+ spaces)

Each extracted block is saved to PatientKB with its language (if detected).

---

## Feedback Loop

### Feedback Detection (`src/LirAgent.ts:796-932`)

The agent waits for feedback after EVERY response:
```
Response: "Я работаю с BSL..."
---
**Я справился? (да/нет/отмена)**
```

**Success Patterns** (line 817):
```typescript
if (lower.match(/^(да|yes|\+|👍|хорошо|верно|правильно|отлично|супер)$/i)) {
  return this.handleSuccessFeedback();
}
```

**Failure Patterns** (line 821):
```typescript
if (lower.match(/^(нет|no|-|👎|неправильно|неверно|плохо|ошибка)$/i)) {
  return { action: 'ask_error_type', errorOptions: this.getErrorTypeOptions() };
}
```

**Cancel Pattern** (line 800):
```typescript
if (lower.match(/^(отмена|cancel|отменить)$/i)) {
  // Don't save to database
  return { response: 'Ок, не сохраняем.' };
}
```

### Error Type Selection

When user says "нет", they must specify error type:

```
Выберите тип ошибки:
1. 📢 эхолалия — повторение фразы пользователя
2. 🔄 парафазия — искажение терминов, неправильный синтаксис
3. 🌀 контаминация — смешивание разных контекстов
4. 🎭 галлюцинация — выдумывание несуществующих функций
```

**Error Type Meanings**:
- **эхолалия**: Agent repeats user's question without answering
- **парафазия**: Wrong terms, incorrect syntax for the language
- **контаминация**: Mixing unrelated contexts (e.g., answering BSL question with Python code)
- **галлюцинация**: Inventing non-existent functions/commands

---

## Experience-to-Skill Promotion

### The `consecutive_successes` Counter

This is the **core learning mechanism**. An experience becomes a skill only after 3 consecutive successful uses.

### Workflow (`recordFeedback()` method, lines 274-317)

```
User says "да" (success)
    │
    ▼
[ReasoningBank.recordFeedback(expId, true)]
    │
    ├─▶ Get current consecutive_successes value
    │
    ├─▶ Increment by 1 (atomic SQL operation)
    │       SQL: UPDATE rb_experiences 
    │            SET consecutive_successes = consecutive_successes + 1 
    │            WHERE id = ?
    │
    ├─▶ Read updated value
    │
    ├─▶ IF consecutive_successes >= 3 AND is_skill == 0:
    │       │
    │       ▼
    │   PROMOTE TO SKILL:
    │   - Set is_skill = 1
    │   - Increment consecutive_successes by 1 again (for the promotion step)
    │   - Return { consecutive: 4, promoted: true }
    │   │
    │   ▼
    │   Agent displays: "★ Отлично! Этот паттерн стал навыком (3/3)"
    │
    └─▶ ELSE:
            Return { consecutive: N, promoted: false }
```

### Failure Handling

```
User says "нет" (failure)
    │
    ▼
[ReasoningBank.recordFeedback(expId, false)]
    │
    ├─▶ Reset consecutive_successes to 0
    │       SQL: UPDATE rb_experiences 
    │            SET consecutive_successes = 0 
    │            WHERE id = ?
    │
    ├─▶ Record error experience with error_type
    │       domain: 'dialogue'
    │       outcome: 'failure'
    │       error_type: 'контаминация' (etc.)
    │
    └─▶ Next time same question is asked:
            - Warning will be generated from this failure
            - Agent will be forced to change approach
```

### Skill Priority in Search

Skills get a **+0.2 score bonus** in retrieval:
```typescript
const isSkill = !!row.is_skill;
const skillBonus = isSkill ? 0.2 : 0;
const score = 0.5 * similarity + 0.2 * recency + 0.3 * confidence + skillBonus;
```

---

## Anti-Pattern System (Warnings)

### Purpose
Prevent the agent from repeating mistakes by blocking knowledge that led to failures.

### Warning Generation (`recommendWithWarnings()`, lines 319-376)

```
User asks: "Как определить язык программирования?"
    │
    ▼
[ReasoningBank.recommendWithWarnings(userInput)]
    │
    ├─▶ Step 1: Retrieve similar experiences (top 5)
    │       Filter: only_skills = false (include failures)
    │
    ├─▶ Step 2: Check for failures with similarity > threshold (0.4)
    │       For each failed experience:
    │       - Add to warnings array
    │       - Get advice from getAdviceForError()
    │
    ├─▶ Step 3: CRITICAL - Check for EXACT MATCH on user_input
    │       (Bypasses similarity - catches repeated same question)
    │       SQL: SELECT * FROM rb_experiences 
    │            WHERE user_input = ? AND outcome = 'failure'
    │
    └─▶ Return: { warnings, strategy, enrichedPrompt }
            where enrichedPrompt includes warning text
```

### Error Advice Mapping (lines 592-601)

```typescript
private getAdviceForError(errorType: ErrorType): string {
  const adviceMap: Record<ErrorType, string> = {
    'эхолалия': 'Не повторяй фразу пользователя. Дай содержательный ответ.',
    'парафазия': 'Проверяй термины перед использованием.',
    'контаминация': 'Отвечай на один вопрос за раз.',
    'галлюцинация': 'Если не знаешь — скажи прямо.',
    'none': 'Проверь корректность ответа.',
  };
  return adviceMap[errorType] || 'Проверь ответ.';
}
```

### Warning Integration in Prompt

When warnings are present, the agent is **forced to change approach**:

```
⚠️ ВНИМАНИЕ: Обнаружены негативные паттерны! 
НЕ используй информацию, которая приводила к ошибкам: контаминация. 
Измени подход!
```

This block is placed **before** knowledge content, effectively disabling the use of incorrect knowledge.

---

## Tool System

### Architecture (`src/tools/`)

```
LirAgent
    │
    ▼
ToolIntegration (facade)
    │
    ├─▶ ToolRegistry (load tools from DB)
    │       - Queries rb_experiences WHERE domain = 'tool'
    │       - Returns tools with metadata
    │
    ├─▶ IntentAnalyzer (semantic match)
    │       - Analyzes user input
    │       - Calls ReasoningBank.recommendTools()
    │       - Returns top matching tools
    │
    ├─▶ ToolOrchestrator (dialog management)
    │       - Extracts required parameters
    │       - Manages confirmation flow
    │       - Returns { confirmed: true, tool, params }
    │
    └─▶ ToolExecutor (safe execution)
            - Validates paths (sandbox)
            - Runs Python/Node/Shell scripts
            - Handles timeout and output
```

### Tool Suggestion Threshold

**TOOL_SUGGESTION_THRESHOLD** (configurable, typically 0.6):
- When `IntentAnalyzer` suggests a tool with score >= threshold: tool is offered
- If score < threshold: tool is NOT suggested, falls back to regular conversation

**Knowledge Threshold** (line 722):
- `bestScore >= 0.6`: Knowledge content is injected into prompt
- This is separate from tool threshold

### Tool Data Model (`src/tools/ToolRegistry.ts`)

```typescript
interface Tool {
  tool_id: string;
  name: string;
  content: string;           // Description
  score?: number;            // Relevance score
  metadata: {
    type: 'python' | 'node' | 'shell' | '1c';
    path: string;            // Script path
    args_template: string;   // e.g., "{inputFile} {outputFile}"
    param_patterns?: Record<string, string>;  // Regex for param extraction
    confirm?: boolean;       // Require user confirmation
    timeout_sec?: number;
    output_handling?: 'file' | 'stdout';
    auto_suggest_threshold?: number;
  };
}
```

### Tool Execution Flow

```
User: "extract my code from 1.txt"
    │
    ▼
[IntentAnalyzer.analyze()]
    │
    ├─▶ Semantic search for tools
    │       - recommendTools(userInput, { k: 3, threshold: 0.5 })
    │
    ├─▶ If best match score > threshold:
    │       Suggest tool to user:
    │       "Tool detected: extract-my-code. Run tool? (yes/no)"
    │
    ├─▶ User says "yes":
    │       │
    │       ▼
    │   [ToolOrchestrator.process()]
    │       - Extract parameters from user input
    │       - Fill args_template: "/extract-my-code 1.txt output.txt"
    │       - Confirm with user if tool.confirm == true
    │       │
    │       ▼
    │   [ToolExecutor.execute()]
    │       - Validate script path (sandbox check)
    │       - Spawn child process (python/node/shell)
    │       - Wait for output (with timeout)
    │       - Return result to agent
    │
    └─▶ Agent incorporates tool output into response
```

---

## Chat Interface Features

### Streaming Mode (`--stream`)

**File**: `chat.ts` (entry point)

When launched with `--stream` flag, the chat uses `processMessageStream()` instead of `processMessage()`:

```bash
npx tsx chat.ts --stream
```

**Indicator**: A `⏳` character is displayed while waiting for the first token. When streaming begins, `⏳` is erased and tokens are output one by one:

```
💬 Вы: как начать транзакцию в 1С?
⏳                                ← visible during LLM latency
НачатьТранзакцию()...             ← tokens arrive one by one
```

**Implementation** (simplified):
```typescript
if (args.stream) {
  process.stdout.write('\n⏳ ');  // show spinner
  let started = false;
  const result = await agent.processMessageStream(input, (chunk) => {
    if (!started) { process.stdout.write('\b \b'); started = true; }
    process.stdout.write(chunk);
  });
}
```

### Multi-Line Input

Users can paste or type multi-line input using these signals:

| Signal | Action |
|--------|--------|
| `Пуск!`, `/send`, `!go` | Send accumulated multi-line text |
| `/cancel`, `отмена` | Cancel input (clear buffer) |

When the user enters text, it's accumulated in a buffer. A blank line (Enter on empty input) prompts for more input. The accumulated text is sent only when one of the "send" signals is received.

This is particularly useful for pasting code blocks, error logs, or multi-line 1C module snippets.

### Visual Separators

| Element | Separator | Purpose |
|---------|-----------|---------|
| Before response | `=====` | Visually separates agent response from previous output |
| Before feedback | `---` | Separates the "Я справился?" question from the response |
| Input mode | Custom prompt | `💬 Вы: ` for normal input, multi-line mode has its own prompt |

### Knowledge vs. Dialogue Experiences

| Type | Domain | is_skill | consecutive_successes | Expires |
|------|--------|----------|----------------------|---------|
| **Dialogue** | `'dialogue'` | Starts 0 | Increments with feedback | 90 days |
| **Knowledge** | `'knowledge'` | Starts 1 | Set to 3 immediately | Never |
| **Tool** | `'tool'` | Starts 1 | Set to 3 immediately | Never |

### Knowledge Seeding (`chat.ts`)

At startup, the system seeds initial knowledge:
```typescript
const knowledgeItems = [
  {
    id: 'knowledge-diagnose-posting',
    task: 'diagnose posting',
    content: 'Use /diagnose-posting command...',
    domain: 'knowledge',
    is_skill: true,
  },
  // ... more items
];
```

### Learning from Dialog (`handleLearn()` and `handleCommandInFeedbackMode()` methods)

User can explicitly save successful Q&A as knowledge using `/learn` command.

#### `handleCommandInFeedbackMode()` (lines ~782-888)
Centralized command processing while in `waitingForFeedback` mode:
```
User in feedback mode: "/learn"
    │
    ▼
[handleCommandInFeedbackMode()]
    │
    ├─▶ Check if command starts with '/'
    ├─▶ For '/learn':
    │       ├─▶ Verify lastUserInput & lastAgentResponse exist
    │       ├─▶ Create experience with is_skill: true (permanent)
    │       ├─▶ exitsFeedbackMode: false (stay in feedback mode)
    │       └─▶ Return success message + "Я справился?" prompt
    │
    ├─▶ For '/exit': exitsFeedbackMode: true (end session)
    ├─▶ For '/stats', '/tools': run command, stay in feedback mode
    └─▶ For context-changing commands: ask to cancel feedback first
```

#### `handleLearn()` (lines ~890-910)
Direct learning when NOT in feedback mode:
```
User: "/learn"
    │
    ▼
[handleLearn()]
    │
    ├─▶ Check if lastUserInput and lastAgentResponse exist
    │
    ├─▶ Create new experience:
    │       id: `knowledge-learned-${Date.now()}`
    │       task: lastUserInput (truncated to 100 chars)
    │       content: lastAgentResponse (truncated to 2000 chars)
    │       domain: 'knowledge'
    │       outcome: 'success'
    │       is_skill: true (immediately)
    │       confidence: 0.95
    │
    └─▶ Next queries retrieve this as high-priority knowledge (scoring bonus +0.2)
```

**Key change:** `/learn` now works even in `waitingForFeedback` mode without resetting the state.

---

## Data Models

### Language Detection (`src/LirAgent.ts:24, 47-54`)

```typescript
type Language = '1С (BSL)' | 'JavaScript' | 'TypeScript' | 'Python' | 'Go' | 'general';

const LANGUAGE_KEYWORDS: Record<Language, string[]> = {
  '1С (BSL)': ['1с', 'транзакц', 'начатьтранзакцию', 'записьжурналарегистрации', ...],
  'JavaScript': ['function', 'console.log', 'const', 'let', '=>', ...],
  'TypeScript': [': string', 'interface', 'type', 'readonly', ...],
  'Python': ['def ', 'import ', ':', 'print(', ...],
  'Go': ['func ', 'package ', ':=', 'go ', ...],
  'general': [],
};
```

### Experience Retrieval Result

```typescript
interface RetrievedExperience {
  experience: Experience;
  similarity: number;    // 0.0 - 1.0 (cosine similarity)
  score: number;         // Combined score (similarity + recency + confidence + bonuses)
}
```

### Warning Object

```typescript
interface ErrorWarning {
  error_type: ErrorType;
  description: string;
  advice: string;        // From getAdviceForError()
  trigger_example: string;
  confidence: number;    // Same as similarity of failed experience
}
```

---

## Key Algorithms

### 1. Cosine Similarity (`src/ReasoningBankSemantic.ts:60-70`)

```typescript
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
```

### 2. HNSW Vector Search (`src/HNSWBackend.ts`)

Approximate nearest neighbor search using Hierarchical Navigable Small World graphs:
- **Build time**: O(N log N)
- **Query time**: O(log N)
- Used for fast similarity search when dataset grows beyond ~1000 items

### 3. LRU Cache with TTL (`src/LRUCache.ts`)

Caches query results to avoid recomputation:
- **Max size**: Configurable (default 256)
- **TTL**: Configurable (default 5 minutes)
- **Key**: JSON string of `{ query, k, domain, error_type, only_skills }`

### 4. Dialogue Deduplication (`recordExperience()`, lines 244-253)

```typescript
if (exp.domain === 'dialogue') {
  // Check for exact task match
  const existingRow = rows.find((r: any) => 
    r.domain === 'dialogue' && r.task === exp.task
  );
  if (existingRow) {
    // Return existing ID without changing counter
    return existingRow.id;
  }
}
```

This prevents creating duplicate dialogue entries for the same question.

---

## 1C Configuration Analysis Modules

Although LirAgent is primarily a conversational agent with memory, it includes powerful utilities for 1C configuration analysis.

### ConfigStorage (`src/ConfigStorage.ts`) — New

**Core storage** for loaded 1C configuration objects. Uses a dedicated SQLite table with FTS5 full-text search.

```sql
-- Main data table
CREATE TABLE IF NOT EXISTS config_objects (
  id TEXT PRIMARY KEY,
  object_type TEXT NOT NULL,      -- e.g. '1C.Catalog', '1C.Document'
  name TEXT NOT NULL,             -- object name (e.g. 'Номенклатура')
  synonym TEXT,                   -- human-readable synonym
  module_full TEXT,               -- full BSL module text
  file_path TEXT,
  size_bytes INTEGER,
  hash TEXT,                      -- SHA-256 of module text
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- FTS5 virtual table for full-text search
CREATE VIRTUAL TABLE IF NOT EXISTS config_objects_fts USING fts5(
  name, module_full, tokenize = 'unicode61'
);
```

**Key Methods**:
- `saveObject(record)` — Insert/update object + sync FTS index
- `searchByFTS(query, limit, exact)` — **Two-tier search**:
  1. **FTS5** with `unicode61` tokenizer (handles Cyrillic, CamelCase, underscores)
  2. **LIKE fallback** — if FTS returns 0 results: `WHERE name LIKE '%query%' OR module_full LIKE '%query%'`
- `getObjectCount()` / `getSampleNames(limit)` — Diagnostics for the user
- `getFullModuleTextForObject(objectName)` — Retrieve complete module source

The `unicode61` tokenizer is chosen over `russian` because `russian` is not a built-in SQLite tokenizer — it requires an extension that may not be available. `unicode61` handles Unicode text including Cyrillic and is always available with FTS5.

### ConfigLoader (`src/ConfigLoader.ts`) — Improved

Parses 1C configuration XML export directories and loads BSL module files.

**Supported object types** (detected by child element name under `<MetaDataObject>`):
- `Catalog` — справочники
- `Document` — документы
- `DataProcessor` — обработки
- `CommonModule` — общие модули
- `Enum` — перечисления
- `InformationRegister` — регистры сведений
- `ChartOfCharacteristicTypes` — ПВХ
- `EventSubscription` — подписки на события

**XML Parsing Strategy** (critical for correctness):

The 1C XML structure is:
```xml
<MetaDataObject>
  <Catalog>
    <Properties>
      <Name>Номенклатура</Name>
      <Synonym>Номенклатура</Synonym>
    </Properties>
  </Catalog>
</MetaDataObject>
```

NOT this (which would be typical in other formats):
```xml
<MetaDataObject type="Catalog">
  <Property Name="Name">Номенклатура</Property>
</MetaDataObject>
```

The loader uses `fast-xml-parser` with `ignoreAttributes: false` and reads properties by tag name, not attribute.

**BSL Module Loading** — Loads from multiple locations:

1. **Ext/ directory** (object-level modules):
   - `Ext/ObjectModule.bsl` — Object module
   - `Ext/ManagerModule.bsl` — Manager module
   - `Ext/Module.bsl` — Generic module (common modules)
   - `Ext/RecordSetModule.bsl` — Record set module (registers)

2. **Forms/ directory** (form modules):
   - `Forms/<FormName>/Ext/Form/Module.bsl` — Form event handlers

```typescript
// Object-level modules
const bslFiles = ['ObjectModule.bsl', 'ManagerModule.bsl', 'Module.bsl', 'RecordSetModule.bsl'];
for (const bslName of bslFiles) {
  const bslPath = extDir + '/' + bslName;
  const bslContent = await this.fsReader.readFile(bslPath);
  // Append to moduleText
}

// Form modules
const formsDir = objDir + '/Forms';
for (const entry of formEntries) {
  const formBsl = formsDir + '/' + entry.name + '/Ext/Form/Module.bsl';
  const bslContent = await this.fsReader.readFile(formBsl);
  // Append with "// Form: <FormName>" header
}
```

**Loading flow** (`loadDirectory()`, line 32):
```
loadDirectory(rootPath)
  │
  ├─▶ walkXmlFiles(rootPath) → list of .xml files
  │
  ├─▶ for each file (concurrent, concurrency = 10):
  │     │
  │     ▼
  │   [processFile(filePath, rootPath)]
  │     │
  │     ├─▶ Parse XML with fast-xml-parser
  │     ├─▶ Find object-type child (Catalog, Document, etc.)
  │     ├─▶ Extract Name, Synonym from Properties
  │     ├─▶ Load BSL from Ext/ (ObjectModule.bsl, ManagerModule.bsl, Module.bsl, RecordSetModule.bsl)
  │     ├─▶ Load BSL from Forms/*/Ext/Form/Module.bsl
  │     ├─▶ recordExperience() in ReasoningBank (for semantic search)
  │     └─▶ saveObject() in ConfigStorage (for FTS search)
  │
  └─▶ Return { totalFiles, processed, errors, durationMs }
```

**Diagnostic output** during load:
```
[ConfigLoader] Loaded module for Номенклатура (1234 chars)
[ConfigLoader] Progress: 100/200
[ConfigLoader] Completed. Processed 200 files, 0 errors in 3200ms
```

**After load**, `/search-code` displays diagnostics:
```
[Search] DB has 200 config objects. Examples: Номенклатура, Документы, Обработки
```

### Search Code Command (`/search-code`)

**Flow**:
```
/search-code <query>
  │
  ├─▶ ConfigStorage.searchByFTS(query)  ← FTS5 first
  │     │
  │     ├─▶ If results found → return { id, name, snippet, rank }
  │     │
  │     └─▶ If 0 results → LIKE fallback
  │           WHERE name LIKE '%query%' OR module_full LIKE '%query%'
  │
  └─▶ For /semantic-search: also queries ReasoningBank semantic search
```

### DependencyGraph + DependencyParser (`src/DependencyGraph.ts`, `src/DependencyParser.ts`)
- **DependencyGraph**: Stores and queries object call dependencies in SQLite
- **DependencyParser**: Parses 1C modules (BSL code) to extract method call edges
- **Usage**: Builds call graph, finds cycles, identifies callers/callees
- **Commands**: `/build-graph`, `/callers`, `/callees`, `/find-cycles`, `/graph-viz`

### PerformanceLoader + PerformanceStorage (`src/PerformanceLoader.ts`, `src/PerformanceStorage.ts`)
- Loads performance measurement JSON files
- Calculates metrics (average duration, call counts)
- Stores in `measurements` table

### ConfigComparator + ComparisonStorage (`src/ConfigComparator.ts`, `src/ComparisonStorage.ts`)
- Compares two 1C configurations
- Uses `DiffEngine` for line-by-line module comparison
- Stores results in `comparisons` and `comparison_details` tables
- **Commands**: `/compare-config`, `/diff-module`, `/changed-objects`, `/comparison-summary`

---

## Security and Sandbox

### SafeFileSystemReader (`src/SafeFileSystemReader.ts`)
- Restricts file access to allowed roots (`ALLOWED_CONFIG_ROOTS`)
- Validates paths before any file operation
- Prevents directory traversal attacks

### ToolExecutor Sandbox (`src/tools/ToolExecutor.ts`)
- Scripts can ONLY be executed from `tools/` folder
- Path validation before spawning child processes
- **Timeout handling**: SIGKILL after `timeout_sec` (default 30s)
- **Output handling**: File-based or stdout capture

---

## Ollama Model Management

### Commands
- `/models` - List available Ollama models
- `/model <name>` - Switch to specific model

### Environment Variables
- `OLLAMA_TEMPERATURE` - LLM temperature (default: from constructor)
- `OLLAMA_CONTEXT_LENGTH` - Max context window (default: from constructor)

### Model Info in Chat Startup
At startup, agent displays available models:
```
📋 Доступные модели Ollama:
  1. gemma4:26b
  2. gemma4:26b-a4b-it-q4_K_M (текущая)
  ...
⚠️ Не удалось установить модель X, используем текущую: Y
```

---

## Example Usage Scenarios

### Scenario 1: Tool Suggestion and Learning

```
User: "извлеки код из 1.txt"
Agent: "Tool detected: extract-my-code. Run tool? (yes/no)"

User: "yes"
[ToolExecutor runs extract-my-code script]
Agent: "Code extracted to output.txt. Found 3 modules..."

Agent: "Я справился? (да/нет/отмена)"
User: "да"

[recordFeedback] consecutive_successes: 0 → 1
Agent: "Спасибо! (1/3)"

[Next time same question]
User: "извлеки код из 1.txt"
Agent: "Tool detected: extract-my-code..."

User: "да" (x3 total)
Agent: "★ Отлично! Этот паттерн стал навыком (3/3)"
[is_skill = 1, consecutive_successes = 3]
```

### Scenario 2: Anti-Pattern Detection

```
User: "Как определить язык программирования?"
Agent: "Я работаю с BSL..."

User: "нет, контаминация"
[recordFeedback] outcome='failure', error_type='контаминация'
[recordExperience] New failure experience recorded

[Next time same question]
User: "Как определить язык программирования?"
[recommendWithWarnings] FINDS FAILURE!
Agent: "⚠️ ВНИМАНИЕ: Обнаружены негативные паттерны! 
         НЕ используй информацию, которая приводила к ошибкам: контаминация. 
         Измени подход!"

[Knowledge blocked - agent must change approach]
```

---

## Appendix A: Configuration Options

### ReasoningBank Constructor Options

```typescript
new ReasoningBankSemantic({
  dbPath: string;              // Path to SQLite database
  namespace: string;           // Agent identifier (e.g., 'agent:lir')
  hnswEnabled: boolean;        // Enable HNSW vector index (default: true)
  cacheSize: number;           // LRU cache size (default: 256)
})
```

### LirAgent Constructor Options

```typescript
new LirAgent({
  dbPath: string;
  agentId?: string;
  systemPrompt?: string;       // Override default system prompt
  llmModel?: string;           // Ollama model name
  temperature?: number;        // LLM temperature (0.0 - 1.0)
  contextLength?: number;      // Max context window
})
```

---

## Appendix B: Database Tables

### Main Table: `rb_experiences`
(See schema in [Memory System](#memory-system-reasoningbank) section)

### Other Tables (1С Configuration Analysis)

| Table | Database File | Purpose | Key Columns |
|-------|---------------|---------|-------------|
| `rb_experiences` | `agentdb.db` | Agent experiences (dialogues, skills, errors) | `task`, `outcome`, `content`, `domain`, `error_type`, `embedding` |
| `patient_knowledge` | `patient_kb.db` | Patient code blocks (saved from user messages) | `patient_profile`, `content`, `content_hash`, `language` |
| `config_objects` | `agentdb.db` | 1С configuration objects | `name`, `object_type`, `module_full`, `file_path` |
| `config_objects_fts` | `agentdb.db` | FTS5 index for config search | `name`, `module_full` (virtual FTS) |
| `measurements` | `agentdb.db` | Performance data | `object_name`, `method_name`, `duration_ms` |
| `dependencies` | `agentdb.db` | Object call graph | `caller`, `callee`, `call_type` |
| `comparisons` | `agentdb.db` | Config version diffs | `old_version`, `new_version`, `diff_summary` |

---

## Appendix C: Glossary

| Term | Definition |
|------|------------|
| **Experience** | A recorded interaction (dialogue, tool usage, or knowledge) |
| **Skill** | An experience with `is_skill = 1` (proven by 3+ consecutive successes) |
| **Dialogue** | A conversation turn (user input + agent response) |
| **Outcome** | Result of experience: 'success', 'failure', or 'pending' |
| **Consecutive Successes** | Counter incremented on "да", reset on "нет" |
| **Anti-Pattern** | A failure pattern (эхолалия, парафазия, контаминация, галлюцинация) |
| **Warning** | A message generated from past failures to prevent repetition |
| **Embedding** | Vector representation of text (384-dim hash-based, SHA-256 per token) |
| **HNSW** | Hierarchical Navigable Small World (fast vector search algorithm) |
| **Patient Knowledge Base** | Separate memory for user's code blocks (`patient_kb.db`, LIKE-search, cleared via `/next`) |
| **ConfigStorage** | FTS5-indexed storage for 1C configuration objects with LIKE fallback |
| **FTS5** | SQLite Full-Text Search engine (version 5), using `unicode61` tokenizer |
| **LIKE fallback** | Fallback search using `WHERE name LIKE '%query%'` when FTS5 returns no results |

---

## Appendix D: Reading Paths

### For Developers (New to Codebase)
1. Start with `chat.ts` (entry point)
2. Read `LirAgent.ts:processMessage()` to understand main flow
3. Read `ReasoningBankSemantic.ts:recordExperience()` and `recordFeedback()`
4. Understand the feedback loop in `LirAgent.ts:processFeedback()`

### For Architects (System Design)
1. Read Architecture Overview section
2. Study Memory System and scoring algorithm
3. Understand Experience-to-Skill promotion logic
4. Review Anti-Pattern system design
5. Review 1C Configuration Analysis Modules

### For Operations (Deployment)
1. Review configuration options
2. Understand database schema and migrations
3. Check tool execution security (sandbox)
4. Monitor `consecutive_successes` and `is_skill` promotion rates

---

**Document Version**: 1.2  
**Last Updated**: 2026-05-10  
**Maintainer**: LirAgent Development Team

---

## Complete Agent Command List

### Conversation Commands
- `да` / `yes` / `👍` - Positive feedback (triggers `handleSuccessFeedback()`)
- `нет` / `no` / `👎` - Negative feedback (triggers error type selection)
- `отмена` / `cancel` - Cancel feedback (does NOT save to database)
- `/learn` - Save last Q&A as permanent knowledge

### Model Management
- `/models` - List available Ollama models
- `/model <name>` - Switch to specific model (e.g., `/model gemma4:26b`)

### 1C Configuration Analysis
- `/load-config <path>` - Load 1C configuration XML export (parses XML + loads BSL from Ext/ and Forms/)
- `/search-code <query>` - Search loaded config objects (FTS5 + LIKE fallback)
- `/semantic-search <query>` - Search via LLM + ReasoningBank semantic search
- `/build-graph` - Build object call graph
- `/callers <object>` - Find who calls an object/method
- `/callees <object>` - Find what an object/method calls
- `/find-cycles` - Detect cycles in call graph
- `/graph-viz [object]` - Generate graph visualization
- `/compare-config <old> <new>` - Compare two configurations
- `/diff-module <object>` - Show module diff between versions
- `/changed-objects [type]` - List changed objects
- `/comparison-summary` - Summary of last comparison

### Patient Knowledge Base
- `/next` - Clear patient code memory (deletes all `patient_knowledge` for current profile)
- Code blocks are extracted and saved **automatically** from every user message

### Tool Management
- `/tools` - List available tools
- Auto-suggestion: When user input matches tool pattern (threshold >= 0.6)

### System
- `/help` - Show available commands
- `/stats` - Show agent statistics (experiences, skills, errors)
