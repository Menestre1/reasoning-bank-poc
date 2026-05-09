# NORA Skill DSL

## Purpose

Skill DSL — формальный язык описания навыков для NORA/LirAgent.

DSL нужен для:

- declarative skill definition;
- reusable reasoning patterns;
- tool orchestration;
- routing integration;
- law validation;
- repair planning;
- memory integration;
- trajectory execution;
- deterministic automation.

Skill DSL должен быть:

- human-readable;
- machine-executable;
- composable;
- auditable;
- deterministic;
- versioned.

---

# Core Philosophy

Skill ≠ prompt.

Skill = executable cognitive procedure.

Навык описывает:

- когда применять;
- что делать;
- какие законы проверять;
- какие memory retrieval использовать;
- какие tool chains запускать;
- как repair происходить;
- как измерять success.

---

# High-Level Structure

```text
SKILL
 ├── metadata
 ├── triggers
 ├── constraints
 ├── memory
 ├── routing
 ├── execution
 ├── validation
 ├── repair
 ├── scoring
 └── promotion
```

---

# Canonical Skill Structure

```dsl
skill diagnose_posting_v1 {

  meta {
    version: "1.0.0"
    author: "NORA"
    domain: "1c"
    category: "diagnostics"
    priority: high
    deterministic: true
  }

  trigger {
    semantic: [
      "posting error",
      "проведение документа",
      "ошибка движения"
    ]

    threshold: 0.72
  }

  constraints {
    max_steps: 12
    timeout_ms: 30000

    forbid: [
      hallucination,
      destructive_actions
    ]
  }

  memory {
    retrieve {
      domains: [knowledge, dialogue, repair]
      top_k: 5
      min_score: 0.65
    }

    avoid_failures: true
  }

  execution {

    step analyze_problem {
      type: reasoning

      goal: "Determine source of posting failure"

      output: diagnosis
    }

    step inspect_movements {
      type: tool

      tool: "/diagnose-posting"

      args {
        mode: "full"
      }

      output: movement_analysis
    }

    step validate_result {
      type: validation

      requires: [
        diagnosis,
        movement_analysis
      ]
    }
  }

  validation {

    require confidence >= 0.70

    forbid contradictions

    forbid hallucinations

    require laws_passed >= 0.95
  }

  repair {

    on tool_failure => retry

    on hallucination => abort

    on low_confidence => retrieve_more_memory
  }

  scoring {
    success_weight: 0.4
    confidence_weight: 0.3
    user_feedback_weight: 0.3
  }

  promotion {
    min_successes: 3
    min_confidence: 0.80
  }
}
```

---

# DSL Grammar

## Top Level

```ebnf
skill_definition ::= "skill" identifier "{" sections "}"

sections ::=
    meta_section
  | trigger_section
  | constraints_section
  | memory_section
  | routing_section
  | execution_section
  | validation_section
  | repair_section
  | scoring_section
  | promotion_section
```

---

# Meta Section

Defines immutable skill metadata.

```dsl
meta {
  version: "1.0.0"
  domain: "coding"
  category: "analysis"
  priority: high
  deterministic: true
}
```

---

# Trigger Section

Defines when skill activates.

## Semantic Trigger

```dsl
trigger {
  semantic: [
    "dependency graph",
    "call graph",
    "find cycles"
  ]

  threshold: 0.75
}
```

---

## Regex Trigger

```dsl
trigger {
  regex: [
    "/find-cycles",
    "/callers"
  ]
}
```

---

## Intent Trigger

```dsl
trigger {
  intents: [
    code_analysis,
    diagnostics
  ]
}
```

---

# Constraints Section

Controls execution boundaries.

```dsl
constraints {
  max_steps: 15

  timeout_ms: 60000

  max_tool_calls: 5

  require_confirmation: true

  forbid: [
    hallucination,
    filesystem_write,
    unsafe_shell
  ]
}
```

---

# Memory Section

Defines retrieval behavior.

```dsl
memory {

  retrieve {
    domains: [
      knowledge,
      dialogue,
      procedural
    ]

    top_k: 8

    min_score: 0.60

    only_skills: true
  }

  avoid_failures: true

  inject_warnings: true
}
```

---

# Routing Section

Controls router behavior.

```dsl
routing {
  planner: hierarchical

  strategy: tool_first

  fallback: semantic_reasoning

  reflection: conditional
}
```

---

# Execution Section

Execution is composed of ordered steps.

---

## Reasoning Step

```dsl
step analyze_context {
  type: reasoning

  goal: "Understand user objective"

  output: context_analysis
}
```

---

## Tool Step

```dsl
step build_graph {
  type: tool

  tool: "/build-graph"

  args {
    mode: "incremental"
  }

  output: graph_result
}
```

---

## Retrieval Step

```dsl
step retrieve_examples {
  type: retrieval

  query: "similar successful fixes"

  top_k: 3
}
```

---

## Reflection Step

```dsl
step reflect {
  type: reflection

  when confidence < 0.5
}
```

---

## Validation Step

```dsl
step validate {
  type: validation

  require laws_passed >= 0.95

  forbid contradictions
}
```

---

# Conditional Execution

## If

```dsl
if confidence < 0.5 {
  retrieve_more_memory
}
```

---

## Match

```dsl
match failure_type {

  hallucination => abort

  tool_failure => retry

  timeout => fallback_reasoning
}
```

---

# Parallel Execution

```dsl
parallel {

  step semantic_analysis

  step tool_analysis

  step memory_search
}
```

---

# Fork Execution

```dsl
fork {

  branch tool_path {
    execute_tool
  }

  branch reasoning_path {
    semantic_reasoning
  }
}
```

---

# Merge Execution

```dsl
merge {
  strategy: confidence_weighted
}
```

---

# Validation Rules

## Confidence Rule

```dsl
require confidence >= 0.8
```

---

## Law Rule

```dsl
require law hallucination_prevention
```

---

## Forbidden State

```dsl
forbid contradictions
```

---

## Output Rule

```dsl
require output contains "solution"
```

---

# Repair Section

Defines recovery logic.

```dsl
repair {

  on tool_failure => retry

  on hallucination => abort

  on timeout => fallback

  on low_confidence => retrieve_more_memory

  on contradiction => reflection
}
```

---

# Scoring Section

```dsl
scoring {
  success_weight: 0.4

  confidence_weight: 0.2

  efficiency_weight: 0.2

  user_feedback_weight: 0.2
}
```

---

# Promotion Section

Controls automatic skill promotion.

```dsl
promotion {
  min_successes: 3

  min_confidence: 0.80

  max_failure_rate: 0.10

  require_determinism: true
}
```

---

# Skill Composition

Skills can call other skills.

```dsl
step run_dependency_analysis {
  type: skill

  skill: dependency_graph_analysis_v2
}
```

---

# Skill Inheritance

```dsl
skill advanced_diagnostics_v2 extends base_diagnostics_v1 {

  constraints {
    max_steps: 25
  }
}
```

---

# Law Integration

```dsl
laws {
  require: [
    no_hallucinations,
    no_context_contamination,
    safe_tool_execution
  ]
}
```

---

# Tool Permissions

```dsl
permissions {
  allow_tools: [
    "/build-graph",
    "/callers",
    "/diagnose-posting"
  ]

  deny_tools: [
    "/shell"
  ]
}
```

---

# Memory Write Rules

```dsl
memory_write {

  on success => procedural_memory

  on failure => anti_pattern_memory

  on promotion => skill_memory
}
```

---

# Runtime Model

## Compilation Flow

```text
Skill DSL
    │
    ▼
Parser
    │
    ▼
AST
    │
    ▼
Validator
    │
    ▼
Execution Plan
    │
    ▼
Trajectory Runtime
```

---

# AST Model

```ts
interface SkillAST {
  name: string;

  meta: MetaNode;

  triggers: TriggerNode[];

  constraints: ConstraintNode[];

  memory: MemoryNode;

  execution: StepNode[];

  validation: ValidationNode[];

  repair: RepairNode[];
}
```

---

# Runtime Execution Model

```text
Skill
   │
   ▼
Planner
   │
   ▼
Trajectory Builder
   │
   ▼
Step Executor
   │
   ├── Memory Engine
   ├── Tool Runtime
   ├── Law Validator
   ├── Reflection Layer
   └── Repair Engine
```

---

# Production Features

## Deterministic Skills

```dsl
meta {
  deterministic: true
}
```

Guarantees:

```text
same input
+ same memory
+ same tools
+ same laws
----------------
same execution
```

---

## Sandboxed Skills

```dsl
sandbox {
  filesystem: readonly

  network: denied

  shell: denied
}
```

---

## Auditable Skills

Every execution produces:

- trajectory log;
- law checks;
- tool audit;
- reasoning trace;
- memory accesses.

---

# Skill Registry

## Skill Metadata Table

```sql
CREATE TABLE skills (
  id TEXT PRIMARY KEY,

  name TEXT,
  version TEXT,

  domain TEXT,
  category TEXT,

  dsl_source TEXT,

  compiled_ast TEXT,

  success_rate REAL,
  avg_confidence REAL,

  executions INTEGER,

  created_at TEXT,
  updated_at TEXT
);
```

---

# Skill Execution Log

```sql
CREATE TABLE skill_executions (
  id TEXT PRIMARY KEY,

  skill_id TEXT,

  trajectory_id TEXT,

  status TEXT,

  confidence REAL,

  duration_ms INTEGER,

  violations INTEGER,

  created_at TEXT
);
```

---

# Recommended Evolution

## Phase 1

- parser;
- execution runtime;
- validation;
- tool integration.

## Phase 2

- fork/merge;
- reflection;
- self-repair;
- deterministic execution.

## Phase 3

- self-generating skills;
- automatic optimization;
- distributed skill graphs;
- recursive planning.

---

# Final Principle

Prompts are unstable.

Skills are executable cognition.

NORA should evolve:

```text
from prompting
        ↓
to trajectory execution
        ↓
to programmable cognition
```

