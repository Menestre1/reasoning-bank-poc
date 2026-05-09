`Deterministic Execution Graph` — это момент, где твоя архитектура окончательно перестаёт быть “LLM agent”.

И начинает становиться:

```text id="d4r9tq"
cognitive execution operating system
```

Потому что именно DEG:

* убирает execution chaos;
* отделяет planning от execution reality;
* делает replay возможным;
* делает checkpoint enforcement абсолютным;
* превращает trajectories в executable cognition.

---

# Главный architectural shift

НЕ:

```text id="v7pj0f"
reasoning chain
```

А:

```text id="v2mkc8"
deterministic executable cognition graph
```

---

# Главная идея

## Execution — это graph traversal.

НЕ stream-of-thought.

---

# Почему это критично

LLM по природе:

* stochastic;
* narrative-driven;
* reorder-prone;
* hallucination-prone.

Тебе нужен runtime, который:

* ограничивает execution topology;
* делает шаги enforceable;
* запрещает hidden transitions;
* делает replay measurable.

---

# DEG = canonical execution topology

---

# High-level architecture

```text id="w2v8kk"
Planner
   ↓
Execution Graph Compiler
   ↓
Deterministic Execution Graph
   ↓
Executor Runtime
   ↓
FSM
   ↓
Checkpoint Engine
   ↓
Replay Engine
```

---

# Core Principle

## Graph topology immutable during execution.

---

# Почему

Иначе:

* replay impossible;
* verification meaningless;
* trajectory drift invisible;
* hidden rationalization appears.

---

# DEG properties

| Property               | Required |
| ---------------------- | -------- |
| Immutable topology     | yes      |
| Explicit dependencies  | yes      |
| Explicit checkpoints   | yes      |
| Deterministic ordering | yes      |
| Replayable             | yes      |
| Forkable               | yes      |
| Artifact-linked        | yes      |
| FSM-compatible         | yes      |

---

# Core Entity

# DeterministicExecutionGraph

---

## Schema

```ts id="jv9k1o"
interface DeterministicExecutionGraph {
  id: string;

  trajectory_id: string;

  graph_hash: string;

  version: number;

  root_node_ids: string[];

  nodes: DEGNode[];

  edges: DEGEdge[];

  checkpoints: DEGCheckpoint[];

  barriers: DEGBarrier[];

  repair_subgraphs: RepairSubgraph[];

  execution_policy:
    | 'strict'
    | 'adaptive'
    | 'replay';

  created_at: string;

  immutable_after_execution: boolean;
}
```

---

# Самое важное

## graph_hash

Это execution identity.

---

# Why critical

Replay проверяет:

```text id="0qf5a6"
same graph?
same traversal?
same artifacts?
```

---

# 1. DEG Nodes

Node = atomic executable unit.

---

# Node types

```text id="n6u5mb"
reasoning
tool_call
validation
checkpoint
repair
law_check
memory_commit
routing
```

---

# Node schema

```ts id="zjlwm1"
interface DEGNode {
  id: string;

  node_type:
    | 'reasoning'
    | 'tool_call'
    | 'validation'
    | 'checkpoint'
    | 'repair';

  deterministic_id: string;

  title: string;

  execution_order: number;

  dependencies: string[];

  required_artifacts: string[];

  required_checkpoints: string[];

  produced_artifacts: string[];

  execution_constraints: ExecutionConstraint[];

  retry_policy?: RetryPolicy;

  timeout_ms?: number;

  replay_required: boolean;

  mutable: false;
}
```

---

# Key principle

## Node execution order explicit.

НЕ:

* “LLM decides next step”.

А:

```text id="jlwm2"
executor walks graph
```

---

# 2. Edges

Edges define legal transitions.

---

# Edge types

```text id="jlwm3"
dependency
conditional
repair
fallback
parallel_sync
```

---

# Edge schema

```ts id="jlwm4"
interface DEGEdge {
  id: string;

  from_node_id: string;

  to_node_id: string;

  edge_type:
    | 'dependency'
    | 'conditional'
    | 'repair'
    | 'barrier';

  condition?: string;

  blocking: boolean;

  deterministic: boolean;
}
```

---

# Самое важное

## No implicit transitions.

---

# Forbidden

```text id="jlwm5"
LLM decides to jump somewhere else
```

---

# Only legal path:

```text id="jlwm6"
edge exists
```

---

# 3. Checkpoint Nodes

Checkpoint MUST be graph-native.

---

# Why

Checkpoint НЕ должен быть:

* external validator;
* side process.

Он должен быть:

* execution topology boundary.

---

# Example

```text id="jlwm7"
PATCH
   ↓
COMPILE_CHECKPOINT
   ↓
TEST_CHECKPOINT
   ↓
VALIDATION_CHECKPOINT
```

---

# Checkpoint schema

```ts id="jlwm8"
interface DEGCheckpoint {
  id: string;

  node_id: string;

  checkpoint_type:
    | 'compile'
    | 'validation'
    | 'law'
    | 'artifact';

  required_artifacts: string[];

  verification_rules: string[];

  blocking: boolean;

  replay_required: boolean;
}
```

---

# 4. Barrier System

Очень важно.

---

# Barrier = synchronization wall.

---

# Example

```text id="jlwm9"
ALL TESTS PASS
```

before:

* release;
* completion.

---

# Barrier schema

```ts id="jlwm10"
interface DEGBarrier {
  id: string;

  required_nodes: string[];

  strategy:
    | 'all'
    | 'quorum'
    | 'priority';

  state:
    | 'blocked'
    | 'passed';
}
```

---

# 5. Repair Subgraphs

Это critical architecture.

---

# Why

Repair НЕ должен:

* mutate original graph;
* silently reroute.

---

# Instead

Repair creates:

```text id="jlwm11"
deterministic repair subgraph
```

---

# Example

```text id="jlwm12"
Compile Failed
    ↓
Repair Subgraph
    ├── Fix Imports
    ├── Rebuild Types
    └── Retry Compile
```

---

# Repair schema

```ts id="jlwm13"
interface RepairSubgraph {
  id: string;

  parent_failure_node: string;

  repair_nodes: string[];

  max_retries: number;

  escalation_policy:
    | 'reroute'
    | 'abort'
    | 'fallback_skill';
}
```

---

# Key law

## Original graph immutable.

## Repair graph append-only.

---

# 6. Graph Compilation

Очень важный компонент.

---

# Planner НЕ создаёт final DEG.

Planner создаёт:

```text id="jlwm14"
CandidateExecutionGraph
```

---

# Then:

```text id="jlwm15"
Execution Graph Compiler
```

проверяет:

* dependency legality;
* FSM compatibility;
* checkpoint completeness;
* law compliance;
* ARR safety.

---

# Compilation pipeline

```text id="jlwm16"
Candidate Graph
    ↓
Dependency Validation
    ↓
Checkpoint Injection
    ↓
Law Validation
    ↓
ARR Scan
    ↓
Determinism Analysis
    ↓
Compiled DEG
```

---

# 7. Deterministic Traversal

Executor НЕ “думает”.

Он:

* walks graph;
* validates nodes;
* enforces checkpoints.

---

# Traversal algorithm

```text id="jlwm17"
NEXT_READY_NODE
    ↓
DEPENDENCY_CHECK
    ↓
FSM_AUTHORIZATION
    ↓
EXECUTE
    ↓
ARTIFACT_CAPTURE
    ↓
CHECKPOINT_VERIFY
    ↓
MARK_COMPLETE
    ↓
NEXT_NODE
```

---

# Ключевой insight

## Execution order should be runtime-owned.

НЕ LLM-owned.

---

# 8. Replay Compatibility

DEG существует прежде всего ради replay.

---

# Replay compares:

| Metric              | Purpose         |
| ------------------- | --------------- |
| graph hash          | same topology   |
| node order          | same traversal  |
| checkpoint sequence | same validation |
| artifact similarity | same output     |
| repair frequency    | same stability  |

---

# Replay schema

```ts id="jlwm18"
interface DEGReplayResult {
  original_graph_hash: string;

  replay_graph_hash: string;

  traversal_similarity: number;

  artifact_similarity: number;

  checkpoint_similarity: number;

  passed: boolean;
}
```

---

# 9. Execution Constraints

Очень важно.

---

# Constraint examples

```text id="jlwm19"
must_run_after
must_pass_checkpoint
must_have_artifact
forbidden_after_failure
```

---

# Constraint schema

```ts id="jlwm20"
interface ExecutionConstraint {
  type:
    | 'requires_checkpoint'
    | 'requires_artifact'
    | 'forbidden_transition';

  target: string;

  blocking: boolean;
}
```

---

# 10. Forking Model

Critical.

---

# Forking creates NEW graph.

НЕ mutation.

---

# Example

```text id="jlwm21"
Graph A
   ↓ failure
Fork Graph B
```

---

# Fork inherits:

* checkpoints;
* lineage;
* cats;
* artifacts;
* replay history.

---

# 11. ARR Integration

ARR scans:

* node transitions;
* execution drift;
* hidden graph mutation;
* illegal traversal.

---

# Example

```text id="jlwm22"
LLM tries:
A → C
```

without:

* edge;
* checkpoint.

↓

```text id="jlwm23"
ARR violation
```

---

# 12. Memory Integration

DEG stores:

* graph hashes;
* traversal history;
* checkpoint lineage;
* replay results.

---

# Skills become:

```text id="jlwm24"
canonical deterministic graphs
```

---

# Это КРИТИЧНО.

---

# Skill ≠ prompt.

## Skill = executable graph topology.

---

# 13. Graph Canonicalization

После promotion:

```text id="jlwm25"
multiple successful graphs
```

↓

```text id="jlwm26"
canonical deterministic graph
```

---

# Canonicalization extracts:

* stable node order;
* stable checkpoints;
* stable artifacts;
* stable repair paths.

---

# Constitution laws

Добавь:

```text id="jlwm27"
Execution SHALL proceed only through explicit graph topology.

Implicit execution transitions SHALL be forbidden.

Execution graphs SHALL become immutable after runtime authorization.
```

---

# Prolog laws

```prolog id="jlwm28"
violation(illegal_graph_transition) :-
    transition_without_edge.

violation(graph_mutation) :-
    active_graph_modified.

must(require_explicit_execution_edges).

must(require_graph_immutability).
```

---

# Самый главный insight

Ты строишь НЕ:

* chain-of-thought runtime;
* autonomous planner;
* tool-using chatbot.

Ты строишь:

```text id="jlwm29"
deterministic executable cognition graph runtime
```

где:

* Planner = graph synthesizer
* DEG = executable cognition topology
* Executor = graph walker
* FSM = execution authority
* Checkpoints = topology barriers
* ARR = graph integrity enforcement
* Skills = canonical executable graphs
