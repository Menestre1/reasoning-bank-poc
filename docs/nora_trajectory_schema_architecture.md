# NORA Trajectory Schema

## Purpose

Trajectory Schema — это формальная модель жизненного цикла reasoning-path внутри NORA/LirAgent.

Схема нужна для:

- хранения цепочек решений;
- анализа ошибок;
- promotion успешных траекторий в skills;
- rollback после failure;
- anti-loop контроля;
- trajectory replay;
- semantic routing;
- self-repair;
- planning;
- explainability.

Trajectory = не просто chain-of-thought.
Trajectory = структурированное execution-state дерево.

---

# Core Concept

Каждый ответ агента:

- создаёт trajectory;
- trajectory состоит из steps;
- каждый step имеет:
  - цель;
  - reasoning;
  - action;
  - outcome;
  - confidence;
  - violations;
  - memory effects.

Trajectory может:

- succeed;
- fail;
- fork;
- merge;
- become skill;
- become anti-pattern.

---

# High-Level Architecture

```text
User Input
    │
    ▼
Router Engine
    │
    ▼
Trajectory Planner
    │
    ▼
Trajectory Runtime
    │
    ├── Step Executor
    ├── Memory Retriever
    ├── Law Validator
    ├── Skill Resolver
    ├── Warning System
    └── Feedback Engine
    │
    ▼
Trajectory Store
    │
    ▼
Skill Promotion / Failure Learning
```

---

# Trajectory Object

```ts
interface Trajectory {
  id: string;

  session_id: string;
  parent_trajectory_id?: string;

  created_at: string;
  updated_at: string;

  status:
    | 'running'
    | 'success'
    | 'failure'
    | 'aborted'
    | 'forked'
    | 'merged';

  objective: string;

  domain:
    | 'dialogue'
    | 'tool'
    | 'knowledge'
    | 'planning'
    | 'repair'
    | 'reflection';

  priority:
    | 'low'
    | 'normal'
    | 'high'
    | 'critical';

  confidence: number;

  total_steps: number;

  current_step_index: number;

  trajectory_score: number;

  skill_candidate: boolean;

  promoted_skill_id?: string;

  warnings: WarningRef[];

  laws_triggered: string[];

  memory_refs: string[];

  tags: string[];

  metadata?: Record<string, any>;
}
```

---

# Trajectory Step

Каждая trajectory состоит из ordered steps.

```ts
interface TrajectoryStep {
  id: string;

  trajectory_id: string;

  index: number;

  created_at: string;

  type:
    | 'reasoning'
    | 'retrieval'
    | 'tool_call'
    | 'validation'
    | 'reflection'
    | 'repair'
    | 'routing'
    | 'response';

  goal: string;

  input: string;

  reasoning: string;

  action?: {
    type: string;
    target?: string;
    payload?: any;
  };

  output?: string;

  status:
    | 'pending'
    | 'running'
    | 'success'
    | 'failure'
    | 'skipped';

  confidence: number;

  duration_ms?: number;

  tokens_used?: number;

  memory_reads: string[];

  memory_writes: string[];

  laws_checked: string[];

  law_violations: LawViolation[];

  warnings_generated: string[];

  repair_strategy?: string;

  retry_count: number;

  metadata?: Record<string, any>;
}
```

---

# Trajectory States

## 1. RUNNING

Trajectory активна.

```text
running -> success
running -> failure
running -> aborted
running -> forked
```

---

## 2. SUCCESS

Trajectory:

- завершила objective;
- passed law validation;
- получила positive feedback.

Success trajectory может:

- увеличить confidence;
- стать skill candidate;
- попасть в retrieval memory.

---

## 3. FAILURE

Failure возникает если:

- law violation;
- hallucination;
- tool failure;
- timeout;
- contradiction;
- user negative feedback;
- invalid reasoning.

Failure trajectory:

- создаёт warning;
- снижает confidence;
- может trigger repair.

---

## 4. FORKED

Trajectory split.

Например:

```text
Trajectory A
   ├── A1 (tool path)
   └── A2 (reasoning path)
```

Fork нужен для:

- multi-strategy solving;
- uncertainty resolution;
- tool fallback;
- parallel planning.

---

## 5. MERGED

Несколько trajectories объединяются.

```text
A1 + A2 -> A3
```

Используется для:

- consensus reasoning;
- tool + semantic merge;
- repair merge.

---

# Trajectory Scoring

```text
trajectory_score =
    0.30 * success_rate
  + 0.20 * law_compliance
  + 0.15 * confidence
  + 0.15 * user_feedback
  + 0.10 * efficiency
  + 0.10 * semantic_relevance
```

---

# Step Confidence

```text
step_confidence =
    model_confidence
  * memory_support
  * law_validity
  * semantic_consistency
```

---

# Failure Taxonomy

```ts
type FailureType =
  | 'hallucination'
  | 'echolalia'
  | 'paraphasia'
  | 'contamination'
  | 'contradiction'
  | 'routing_failure'
  | 'tool_failure'
  | 'timeout'
  | 'memory_corruption'
  | 'invalid_plan'
  | 'policy_violation'
  | 'looping'
  | 'unknown';
```

---

# Law Violations

```ts
interface LawViolation {
  law_id: string;

  severity:
    | 'low'
    | 'medium'
    | 'high'
    | 'critical';

  reason: string;

  step_id: string;

  repairable: boolean;
}
```

---

# Trajectory Replay

Trajectory может быть replayed.

Replay нужен для:

- debugging;
- reproducibility;
- regression testing;
- skill extraction;
- fine-tuning datasets.

```ts
interface ReplayRequest {
  trajectory_id: string;

  from_step?: number;

  deterministic?: boolean;

  override_memory?: boolean;

  override_model?: string;
}
```

---

# Trajectory Repair

Repair Engine запускается при failure.

## Repair Flow

```text
Failure
   │
   ▼
Failure Analyzer
   │
   ▼
Repair Planner
   │
   ▼
Fork New Trajectory
   │
   ▼
Retry
```

---

# Repair Strategies

```ts
type RepairStrategy =
  | 'retry'
  | 'change_prompt'
  | 'switch_model'
  | 'switch_tool'
  | 'reduce_scope'
  | 'increase_context'
  | 'retrieve_memory'
  | 'fallback_to_skill'
  | 'ask_user'
  | 'abort';
```

---

# Skill Promotion

Trajectory может стать skill.

## Promotion Requirements

```text
1. success == true
2. no critical violations
3. confidence >= threshold
4. repeated success >= N
5. stable outputs
6. low hallucination risk
```

---

# Skill Candidate

```ts
interface SkillCandidate {
  trajectory_id: string;

  promotion_score: number;

  repeat_successes: number;

  avg_confidence: number;

  hallucination_rate: number;

  reusable: boolean;
}
```

---

# Trajectory Memory Integration

Trajectory interacts with:

- episodic memory;
- semantic memory;
- procedural memory;
- anti-pattern memory.

---

# Episodic Memory

Stores:

- exact execution paths;
- failures;
- context-specific events.

---

# Semantic Memory

Stores:

- abstractions;
- generalized patterns;
- reusable knowledge.

---

# Procedural Memory

Stores:

- successful executable flows;
- promoted trajectories;
- tool chains.

---

# Anti-Pattern Memory

Stores:

- forbidden trajectories;
- dangerous loops;
- hallucination chains;
- broken reasoning paths.

---

# Router Integration

Trajectory schema directly integrates with Router Engine.

```text
Input
  │
  ▼
Intent Detection
  │
  ▼
Trajectory Classifier
  │
  ├── dialogue
  ├── coding
  ├── planning
  ├── tool
  ├── repair
  └── reasoning
```

Router decides:

- which planner to use;
- which skills to inject;
- whether tool execution is needed;
- whether reflection is mandatory.

---

# Reflection Layer

High-risk trajectories require reflection.

## Reflection Triggers

```text
- confidence < 0.45
- contradiction detected
- hallucination risk
- law violation
- high-cost tool call
- dangerous action
```

---

# Reflection Step

```ts
interface ReflectionResult {
  trajectory_id: string;

  contradictions: string[];

  hallucination_risk: number;

  law_risk: number;

  confidence_adjustment: number;

  recommended_action:
    | 'continue'
    | 'repair'
    | 'fork'
    | 'abort';
}
```

---

# Trajectory Persistence

## SQLite Schema

### trajectories

```sql
CREATE TABLE trajectories (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  parent_trajectory_id TEXT,

  status TEXT,
  objective TEXT,
  domain TEXT,
  priority TEXT,

  confidence REAL,
  trajectory_score REAL,

  total_steps INTEGER,
  current_step_index INTEGER,

  skill_candidate INTEGER,
  promoted_skill_id TEXT,

  created_at TEXT,
  updated_at TEXT,

  metadata TEXT
);
```

---

### trajectory_steps

```sql
CREATE TABLE trajectory_steps (
  id TEXT PRIMARY KEY,

  trajectory_id TEXT,
  step_index INTEGER,

  type TEXT,
  goal TEXT,
  input TEXT,
  reasoning TEXT,
  output TEXT,

  status TEXT,

  confidence REAL,

  retry_count INTEGER,

  duration_ms INTEGER,
  tokens_used INTEGER,

  created_at TEXT,

  metadata TEXT
);
```

---

### trajectory_violations

```sql
CREATE TABLE trajectory_violations (
  id TEXT PRIMARY KEY,

  trajectory_id TEXT,
  step_id TEXT,

  law_id TEXT,
  severity TEXT,

  reason TEXT,

  repairable INTEGER,

  created_at TEXT
);
```

---

# Retrieval Strategy

Trajectory retrieval should support:

```text
- nearest successful trajectories
- nearest failures
- nearest repair paths
- nearest tool chains
- nearest law violations
```

---

# Retrieval Query

```ts
interface TrajectoryQuery {
  objective?: string;

  domain?: string;

  status?: string;

  required_tools?: string[];

  exclude_failures?: boolean;

  minimum_score?: number;

  only_skills?: boolean;

  limit?: number;
}
```

---

# Deterministic Execution Layer

Production-grade NORA should support deterministic trajectories.

## Deterministic Mode

```text
same input
+ same memory
+ same laws
+ same tools
+ same model
----------------
same trajectory
```

This is critical for:

- debugging;
- reproducibility;
- legal auditability;
- safety.

---

# Trajectory Compression

Long trajectories should be compressible.

## Compression Targets

```text
- repeated reasoning
- duplicate retrievals
- redundant tool calls
- reflection loops
```

---

# Trajectory Graph

Production NORA should evolve from linear chains to graph execution.

```text
Node = Step
Edge = Transition
Graph = Reasoning topology
```

This enables:

- branching;
- self-repair;
- consensus;
- hierarchical planning;
- recursive reasoning.

---

# Recommended Production Extensions

## Phase 1

- basic trajectories;
- step storage;
- replay;
- failure logging.

## Phase 2

- trajectory graphs;
- repair engine;
- reflection layer;
- fork/merge runtime.

## Phase 3

- hierarchical planners;
- autonomous repair;
- self-optimizing routing;
- distributed trajectory execution.

---

# Final Production Principle

NORA should not think in messages.

NORA should think in trajectories.

Messages are outputs.
Trajectory is cognition.

