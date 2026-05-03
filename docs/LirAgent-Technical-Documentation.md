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
6. [Feedback Loop](#feedback-loop)
7. [Experience-to-Skill Promotion](#experience-to-skill-promotion)
8. [Anti-Pattern System (Warnings)](#anti-pattern-system-warnings)
9. [Tool System](#tool-system)
10. [Knowledge Base](#knowledge-base)
11. [Data Models](#data-models)
12. [Key Algorithms](#key-algorithms)

---

## Executive Summary

LirAgent (codenamed "Лирь") is an intelligent conversational agent that learns from interactions through a sophisticated memory system. It combines LLM-powered conversations with a semantic memory system that:
- Records experiences (dialogues, tool usage, knowledge)
- Learns from positive/negative feedback ("да"/"нет")
- Promotes repeated successful patterns to "skills"
- Detects and avoids anti-patterns (эхолалия, парафазия, контаминация, галлюцинация)
- Integrates with 1С configuration analysis tools

**Key Innovation**: The agent uses a `consecutive_successes` counter that must reach 3 for an experience to become a "skill", preventing premature promotion of unproven patterns.

---

## Architecture Overview

### System Components

```
┌─────────────────────────────────────────────────────────────────┐
│                         User Interface                          │
│                    (chat.ts - entry point)                     │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                     LirAgent (Main Orchestrator)               │
│  - Conversation flow management                                │
│  - Feedback processing (да/нет/отмена)                        │
│  - Language detection                                         │
│  - Session state management                                   │
└────────────┬────────────────────┬──────────────────┬───────────┘
             │                    │                  │
             ▼                    ▼                  ▼
┌─────────────────────┐  ┌──────────────┐  ┌─────────────────┐
│ ReasoningBank       │  │ OllamaClient │  │ ToolIntegration │
│ Semantic            │  │ (LLM API)    │  │ (Tool Layer)    │
│ - Vector search     │  │              │  │ - Tool registry │
│ - Experience store  │  └──────────────┘  │ - Intent analysis│
│ - Feedback handling │                    │ - Execution      │
└─────────────────────┘                    └─────────────────┘
```

### File Structure

| Component | File Path | Purpose |
|-----------|-----------|---------|
| Main Agent | `src/LirAgent.ts` | Core orchestration logic (1645 lines) |
| Memory System | `src/ReasoningBankSemantic.ts` | Experience storage and retrieval (596 lines) |
| LLM Client | `src/OllamaClient.ts` | Ollama API integration |
| Tool System | `src/tools/` | Tool registry, intent analysis, execution |
| Config Analysis | `src/Config*.ts`, `src/Dependency*.ts` | 1С configuration processing |

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
- `processMessage(userInput)` - Main entry point for user input
- `processFeedback(userInput)` - Handle "да"/"нет" responses
- `handleSuccessFeedback()` - Process positive feedback
- `handleErrorFeedback(errorType)` - Process negative feedback
- `processWithLanguage(userInput, language)` - Generate response with language context

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

The system prompt is constructed with three components:

1. **Base system prompt** - Agent identity and instructions
2. **Language instruction** - Specific syntax rules for 1С/JS/TS/Python/Go
3. **Memory block** - Contains:
   - Warnings from failed experiences (BLOCKS knowledge if present)
   - Knowledge base content (ONLY if no warnings)

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

## Knowledge Base

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

### ConfigLoader (`src/ConfigLoader.ts`)
- Parses 1C configuration XML export
- Indexes module texts into `config_objects` table
- Extracts object names, types, and parent relationships

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

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `config_objects` | 1С configuration objects | `name`, `type`, `parent`, `module_text` |
| `measurements` | Performance data | `object_name`, `method_name`, `duration_ms` |
| `dependencies` | Object call graph | `caller`, `callee`, `call_type` |
| `comparisons` | Config version diffs | `old_version`, `new_version`, `diff_summary` |

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

**Document Version**: 1.1  
**Last Updated**: 2026-05-03  
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
- `/load-config <path>` - Load 1C configuration XML export
- `/build-graph` - Build object call graph
- `/callers <object>` - Find who calls an object/method
- `/callees <object>` - Find what an object/method calls
- `/find-cycles` - Detect cycles in call graph
- `/graph-viz [object]` - Generate graph visualization
- `/compare-config <old> <new>` - Compare two configurations
- `/diff-module <object>` - Show module diff between versions
- `/changed-objects [type]` - List changed objects
- `/comparison-summary` - Summary of last comparison

### Tool Management
- `/tools` - List available tools
- Auto-suggestion: When user input matches tool pattern (threshold >= 0.6)

### System
- `/help` - Show available commands
- `/stats` - Show agent statistics (experiences, skills, errors)
