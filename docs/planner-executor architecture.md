Отсутствует главный мост между:

* routing,
* trajectory,
* FSM,
* tools,
* checkpoints,
* execution.

Это:

# Planner / Executor Architecture

---

# Главная проблема современных AI agents

Большинство систем делают:

```text id="p6z3u7"
LLM → giant plan → execute blindly
```

Из-за этого:

* план галлюцинируется;
* execution drift;
* hidden assumptions;
* no checkpoint control;
* rationalization;
* no repair lineage;
* planner ≈ narrator.

---

# Тебе нужен другой принцип

## Planner НЕ управляет execution.

Planner:

* предлагает trajectory candidates;
* строит constrained execution graph;
* определяет checkpoints;
* определяет dependencies.

Executor:

* единственный authority исполнения.

---

# Главный architectural shift

НЕ:

```text id="ij0wdf"
reasoning-driven execution
```

А:

```text id="6z8jcv"
protocol-driven constrained execution
```

---

# High-Level Architecture

```text id="mr31ht"
User Input
    ↓
Router Engine
    ↓
Planner
    ↓
Execution Plan
    ↓
Executor Runtime
    ↓
Checkpoint Engine
    ↓
ARR
    ↓
FSM
    ↓
Validation
    ↓
Memory Engine
```

---

# Самый важный принцип

## Planner generates possibilities.

## Executor controls reality.

---

# Planner responsibilities

Planner НЕ должен:

* исполнять;
* валидировать;
* менять FSM state;
* объявлять success.

Planner должен:

* decomposing goals;
* selecting candidate skills;
* generating execution graph;
* assigning checkpoints;
* estimating dependencies;
* defining repair branches.

---

# Executor responsibilities

Executor:

* executes steps;
* invokes tools;
* collects artifacts;
* requests checkpoint validation;
* triggers repair;
* advances FSM;
* stores runtime evidence.

---

# Разделение критически важно

Без этого:

* LLM начинает “воображать выполнение”;
* plan = hallucinated reality.

---

# Planner Architecture

---

# Core planner pipeline

```text id="mj9o5n"
Goal Analysis
    ↓
Constraint Extraction
    ↓
Skill Retrieval
    ↓
Trajectory Search
    ↓
Plan Synthesis
    ↓
Checkpoint Injection
    ↓
Repair Branch Generation
    ↓
Execution Graph Output
```

---

# Planner output

Planner НЕ должен генерировать prose.

Он должен генерировать:

```text id="2a8yzv"
ExecutionGraph
```

---

# ExecutionGraph

Это canonical runtime object.

---

## Schema

```ts id="gt11ka"
interface ExecutionGraph {
  id: string;

  trajectory_id: string;

  goal: string;

  root_nodes: string[];

  nodes: ExecutionNode[];

  edges: ExecutionEdge[];

  checkpoints: PlannedCheckpoint[];

  repair_branches: RepairBranch[];

  estimated_complexity:
    | 'low'
    | 'medium'
    | 'high';

  routing_mode:
    | 'short_path'
    | 'adapt_path'
    | 'long_path';

  created_at: string;
}
```

---

# Execution Node

---

## Node schema

```ts id="h1bgv7"
interface ExecutionNode {
  id: string;

  node_type:
    | 'reasoning'
    | 'tool_call'
    | 'validation'
    | 'checkpoint'
    | 'repair'
    | 'law_check';

  title: string;

  description: string;

  required_inputs: string[];

  expected_outputs: string[];

  required_artifacts: string[];

  required_checkpoints: string[];

  tool_policy?: ToolPolicy;

  execution_policy:
    | 'serial'
    | 'parallel'
    | 'conditional';

  retryable: boolean;

  timeout_ms?: number;

  status:
    | 'planned'
    | 'ready'
    | 'running'
    | 'completed'
    | 'failed';
}
```

---

# Execution edges

```ts id="9v7jso"
interface ExecutionEdge {
  from_node_id: string;

  to_node_id: string;

  edge_type:
    | 'dependency'
    | 'conditional'
    | 'repair'
    | 'fallback';

  condition?: string;
}
```

---

# Самое важное

## Planner generates graph.

## Executor walks graph.

---

# Executor Architecture

---

# Core runtime

```text id="m4h9h4"
Executor Runtime
    ├── Graph Walker
    ├── FSM Runtime
    ├── Tool Orchestrator
    ├── Checkpoint Runtime
    ├── ARR Enforcement
    ├── Artifact Collector
    ├── Validation Runtime
    ├── Repair Controller
    └── Memory Committer
```

---

# Executor loop

---

# Canonical flow

```text id="zt6bjt"
LOAD_NEXT_NODE
    ↓
CHECK_DEPENDENCIES
    ↓
REQUEST_EXECUTION_TOKEN
    ↓
EXECUTE_NODE
    ↓
COLLECT_ARTIFACTS
    ↓
RUN_CHECKPOINTS
    ↓
VALIDATE
    ↓
ADVANCE_FSM
    ↓
COMMIT_MEMORY
    ↓
NEXT_NODE
```

---

# Ключевой insight

Executor НЕ доверяет planner.

---

# Почему

Planner:

* speculative;
* probabilistic;
* generative.

Executor:

* deterministic;
* enforceable;
* artifact-driven.

---

# Dependency Engine

Очень важный компонент.

---

# Problem

LLM любит:

* пропускать prerequisites;
* делать invalid order;
* invent dependencies.

---

# Solution

```ts id="4xh8aq"
interface DependencyResolver {
  canExecute(
    node: ExecutionNode,
    graph: ExecutionGraph,
    runtime: RuntimeState
  ): boolean;
}
```

---

# Example

```text id="iq34gx"
Run Tests
```

НЕ может стартовать пока:

* compile checkpoint not passed.

---

# Checkpoint Injection

Planner ОБЯЗАН вставлять checkpoints автоматически.

---

# Example

```text id="7i2hts"
Patch
   ↓
Compile Checkpoint
   ↓
Test Checkpoint
   ↓
Validation Checkpoint
```

---

# Rule

## No execution segment without checkpoint boundary.

---

# Repair Branches

Это advanced feature.

Очень важно.

---

# Planner должен заранее строить:

```text id="2mkx2m"
failure recovery graph
```

---

# Example

```text id="p8bnfe"
Compile Failed
    ├── Repair TS Imports
    ├── Repair Typings
    └── Rollback Patch
```

---

# RepairBranch schema

```ts id="66c0fb"
interface RepairBranch {
  id: string;

  trigger_checkpoint: string;

  failure_patterns: string[];

  recovery_nodes: string[];

  max_retries: number;

  escalation_policy:
    | 'reroute'
    | 'fallback_skill'
    | 'human_review';
}
```

---

# Executor Scheduling

Тебе нужен runtime scheduler.

---

# Scheduling modes

```text id="b69dj5"
SERIAL
PARALLEL
CONDITIONAL
PRIORITY
```

---

# Example

```text id="zglsmj"
Run Tests
    ├── Unit Tests
    ├── Integration Tests
    └── Law Validation
```

parallel.

---

# Execution Token System

Очень мощная идея.

---

# Why

Чтобы:

* executor authority was absolute;
* no rogue node execution;
* no checkpoint bypass.

---

# Execution token

```ts id="6z3jkh"
interface ExecutionToken {
  id: string;

  graph_id: string;

  node_id: string;

  allowed_actions: string[];

  expires_at: string;

  issued_by: 'executor';

  revoked: boolean;
}
```

---

# Planner Safety Constraints

Planner НЕ может:

* schedule forbidden tools;
* bypass checkpoints;
* create illegal transitions;
* violate laws.

---

# Поэтому planner output проходит:

```text id="8ztjlwm"
Plan Validation Pipeline
```

---

# Validation pipeline

```text id="2c0qj8"
Plan Generated
    ↓
Law Validation
    ↓
Checkpoint Validation
    ↓
ARR Scan
    ↓
Dependency Validation
    ↓
FSM Compatibility Check
    ↓
Execution Approval
```

---

# Meta-planning

Advanced layer.

---

# Idea

Planner может:

* revise plan;
* shrink graph;
* optimize execution.

НО:

* только ДО execution;
* или через repair process.

---

# Нельзя

```text id="3ywzj2"
mutate active execution graph silently
```

---

# Graph immutability principle

После начала execution:

```text id="f2wqgw"
ExecutionGraph immutable.
```

Изменения:

* только через fork;
* repair branch;
* reroute.

---

# Memory integration

Planner использует:

* skills;
* seeds;
* cats;
* replay history;
* heatmap.

---

# Executor пишет:

* artifacts;
* checkpoints;
* runtime events;
* failures;
* replay evidence.

---

# Очень важный insight

Planner работает:

* на вероятностях;
* на retrieval;
* на synthesis.

Executor работает:

* на laws;
* на FSM;
* на checkpoints;
* на artifacts.

---

# ARR integration

Planner может галлюцинировать.

Executor не должен позволять hallucination become execution.

---

# Example

Planner:

```text id="3zkxgu"
"probably compile unnecessary"
```

Executor:

```text id="e0k7jm"
compile checkpoint mandatory
```

---

# Конституционный law

Добавь:

```text id="u1ss6l"
Planner SHALL propose execution candidates.

Executor SHALL control execution authority.

Execution SHALL require:
- checkpoint validation,
- artifact verification,
- FSM authorization,
- protocol compliance.
```

---

# Prolog laws

```prolog id="m8h6s6"
violation(planner_overreach) :-
    planner_mutates_execution_state.

violation(planner_overreach) :-
    planner_bypasses_checkpoint.

must(require_executor_authority).

must(require_execution_validation).
```

---

# Самый главный insight

Большинство AI-agent frameworks —
это:

```text id="jj7a8z"
LLM with tools
```

Ты идёшь к:

```text id="48e4j0"
deterministic cognitive operating runtime
```

И:

* Planner = compiler
* Executor = kernel
* FSM = scheduler
* Checkpoints = syscalls
* ARR = execution integrity layer
* Memory = execution ledger
* Skills = validated programs
* Laws = constitution/kernel policy
