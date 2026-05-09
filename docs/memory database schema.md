Твоя текущая архитектура уже требует НЕ “chat memory”.

Тебе нужна:

```text id="jlr8ek"
survival-grade cognitive memory database
```

Потому что у тебя:

* trajectory-based cognition;
* immutable failures;
* checkpoint lineage;
* replay verification;
* skill promotion;
* anti-rationalization evidence;
* protocol execution history.

Обычная:

* vector DB,
* chat history,
* embeddings memory

тут уже недостаточны.

---

# Главная идея

## Память у тебя НЕ semantic.

Она:

* executional;
* survival-oriented;
* protocol-centric;
* lineage-aware.

---

# Архитектурный принцип

Тебе нужны 5 типов памяти:

| Type    | Purpose                           |
| ------- | --------------------------------- |
| Laws    | immutable constitutional memory   |
| Skills  | permanent validated trajectories  |
| Seeds   | temporary successful trajectories |
| Cats    | immutable blocked trajectories    |
| Runtime | execution artifacts + FSM history |

---

# Полная memory architecture

```text id="t1m4zi"
Memory Engine
    ├── Constitutional Memory
    ├── Skill Memory
    ├── Seed Memory
    ├── Cat Memory
    ├── Trajectory Store
    ├── Artifact Store
    ├── Checkpoint Store
    ├── Replay Store
    ├── Runtime Event Log
    ├── Routing Heatmap
    └── Lineage Graph
```

---

# Самый важный architectural shift

НЕ:

```text id="r5x3rq"
conversation memory
```

А:

```text id="yw8e1k"
trajectory memory
```

---

# Core principle

## Memory stores execution truth,

not conversational narration.

---

# Главная сущность

# 1. Trajectory

Это центральная сущность ВСЕЙ системы.

---

## Trajectory schema

```ts id="dglp3q"
interface Trajectory {
  id: string;

  trajectory_hash: string;

  parent_trajectory_id?: string;

  forked_from_step_id?: string;

  session_id: string;

  user_goal: string;

  problem_type: string;

  patient_profile: string;

  language: string;

  routing_mode:
    | 'short_path'
    | 'adapt_path'
    | 'long_path';

  status:
    | 'running'
    | 'completed'
    | 'failed'
    | 'blocked'
    | 'aborted';

  execution_state: ExecutionFSMState;

  current_checkpoint_id?: string;

  skill_candidate: boolean;

  replay_verified: boolean;

  law_verified: boolean;

  arr_violations: number;

  repair_count: number;

  total_steps: number;

  created_at: string;

  updated_at: string;

  completed_at?: string;

  metadata?: Record<string, any>;
}
```

---

# Почему trajectory — ядро

Потому что:

* skill = validated trajectory;
* seed = temporary trajectory;
* cat = blocked trajectory;
* replay = trajectory rerun;
* routing = trajectory selection.

---

# 2. Trajectory Step

---

## Step schema

```ts id="rj5r6g"
interface TrajectoryStep {
  id: string;

  trajectory_id: string;

  step_index: number;

  step_type:
    | 'reasoning'
    | 'tool_call'
    | 'validation'
    | 'checkpoint'
    | 'repair'
    | 'routing'
    | 'law_check';

  state:
    | 'pending'
    | 'running'
    | 'passed'
    | 'failed';

  input_summary: string;

  output_summary?: string;

  tool_name?: string;

  checkpoint_id?: string;

  artifact_refs: string[];

  verification_refs: string[];

  runtime_events: string[];

  execution_token?: string;

  started_at?: string;

  completed_at?: string;
}
```

---

# 3. Checkpoint Store

---

## Checkpoint table

```ts id="k7c07n"
interface CheckpointRecord {
  id: string;

  trajectory_id: string;

  step_id: string;

  checkpoint_type:
    | 'compile'
    | 'test'
    | 'validation'
    | 'law'
    | 'artifact'
    | 'safety';

  state:
    | 'pending'
    | 'passed'
    | 'failed'
    | 'blocked';

  required_artifacts: string[];

  verified_artifacts: string[];

  verification_rule_refs: string[];

  arr_flags: string[];

  retry_count: number;

  created_at: string;

  passed_at?: string;

  failed_at?: string;
}
```

---

# 4. Artifact Store

Это КРИТИЧЕСКАЯ таблица.

Потому что:

* execution truth lives here.

---

## Artifact schema

```ts id="0k4sbq"
interface ExecutionArtifact {
  id: string;

  trajectory_id: string;

  step_id: string;

  checkpoint_id?: string;

  artifact_type:
    | 'tool_output'
    | 'compiler_log'
    | 'test_report'
    | 'patch_diff'
    | 'runtime_snapshot'
    | 'validation_report'
    | 'law_report';

  content_hash: string;

  storage_uri: string;

  verified: boolean;

  verification_method?: string;

  created_by:
    | 'tool'
    | 'runtime'
    | 'validator';

  created_at: string;
}
```

---

# Очень важно

## Artifact immutable.

НИКОГДА:

* update;
* overwrite.

Только append-only.

---

# 5. Seed Memory

Временные successful trajectories.

---

## Seed schema

```ts id="sry3t9"
interface SeedRecord {
  id: string;

  trajectory_hash: string;

  trajectory_id: string;

  counter: number;

  confidence_score: number;

  replay_stability_score: number;

  promotion_eligible: boolean;

  first_success_at: string;

  last_success_at: string;

  expires_at: string;
}
```

---

# TTL law

```text id="ckwguv"
expires_at = first_success + 90d
```

согласно rules 10 и 20. 

---

# 6. Skill Memory

Это permanent validated cognition.

---

## Skill schema

```ts id="k4kqzm"
interface SkillRecord {
  id: string;

  skill_name: string;

  source_seed_id: string;

  canonical_trajectory_id: string;

  applicable_patients: string[];

  applicable_languages: string[];

  problem_types: string[];

  replay_verified: boolean;

  deterministic_score: number;

  total_successes: number;

  average_repair_count: number;

  arr_clean_runs: number;

  created_at: string;

  last_used_at?: string;
}
```

---

# 7. Cat Memory

Самая важная immutable table.

---

# Cat schema

```ts id="z8i4c8"
interface CatRecord {
  id: string;

  trajectory_hash: string;

  trajectory_id: string;

  failure_type:
    | 'unsafe'
    | 'hallucination'
    | 'protocol_violation'
    | 'arr_violation'
    | 'checkpoint_bypass'
    | 'false_completion';

  blocked_forever: boolean;

  suggested_alternative?: string;

  evidence_refs: string[];

  created_at: string;
}
```

---

# Самое важное

## Cats NEVER deleted.

---

# 8. Runtime Event Log

Это нервная система runtime.

---

## Runtime event schema

```ts id="j4w0g2"
interface RuntimeEvent {
  id: string;

  trajectory_id: string;

  step_id?: string;

  checkpoint_id?: string;

  event_type:
    | 'state_transition'
    | 'tool_started'
    | 'tool_completed'
    | 'artifact_created'
    | 'checkpoint_passed'
    | 'checkpoint_failed'
    | 'arr_detected'
    | 'repair_started'
    | 'repair_failed';

  severity:
    | 'info'
    | 'warning'
    | 'critical';

  payload: Record<string, any>;

  timestamp: string;
}
```

---

# 9. Replay Store

Очень важно.

---

## Replay schema

```ts id="ow0i5q"
interface ReplayRecord {
  id: string;

  original_trajectory_id: string;

  replay_trajectory_id: string;

  deterministic_match_score: number;

  artifact_similarity_score: number;

  passed: boolean;

  created_at: string;
}
```

---

# 10. Lineage Graph

Это advanced feature.

Но тебе ОЧЕНЬ нужен.

---

# Почему

Ты строишь:

* evolving trajectories;
* repair forks;
* skill evolution.

---

# Example

```text id="n91y3e"
Trajectory A
    ├── Repair Fork B
    ├── Repair Fork C
    │      └── Skill S1
    └── Failure Fork D
```

---

# Graph schema

```ts id="b5vj7z"
interface LineageEdge {
  parent_trajectory_id: string;

  child_trajectory_id: string;

  edge_type:
    | 'repair'
    | 'retry'
    | 'adaptation'
    | 'promotion'
    | 'replay';

  created_at: string;
}
```

---

# Routing Heatmap

Твой router требует отдельную таблицу.

---

## Heatmap schema

```ts id="mn5p6z"
interface RoutingHeatmap {
  problem_type: string;

  patient_profile: string;

  language: string;

  trajectory_hash: string;

  success_count: number;

  failure_count: number;

  last_success_at?: string;

  last_failure_at?: string;

  rating: number;
}
```

---

# Database choice

Тебе НУЖНО hybrid architecture.

---

# Recommended stack

| Purpose          | DB                     |
| ---------------- | ---------------------- |
| Runtime events   | ClickHouse             |
| Trajectories     | PostgreSQL             |
| Graph lineage    | Neo4j                  |
| Artifacts        | S3/MinIO               |
| Vector retrieval | Qdrant                 |
| Immutable cats   | PostgreSQL append-only |

---

# Почему одной DB недостаточно

Потому что у тебя:

* graph workload;
* append-only workload;
* time-series workload;
* relational execution workload;
* artifact storage workload.

---

# КРИТИЧЕСКИЙ architectural principle

## Never store “assistant messages” as truth.

Truth only:

* artifacts;
* runtime events;
* checkpoint results;
* FSM transitions;
* law validation results.

---

# Очень важный law

Добавь:

```text id="e66k73"
Memory SHALL store:
- execution evidence,
- protocol history,
- checkpoint lineage,
- artifact verification.

Narrative text SHALL NOT be treated as execution truth.
```

---

# Prolog laws

```prolog id="8vn9vl"
violation(memory_corruption) :-
    execution_claim_without_artifact.

violation(memory_corruption) :-
    mutable_failure_history.

must(immutable_cats).

must(append_only_artifacts).

must(store_execution_evidence).
```

---

# Самый главный insight

Ты строишь НЕ:

* AI memory;
* chat history;
* semantic recall.

Ты строишь:

```text id="hq3s6g"
persistent execution truth system
```

И memory DB —
это его:

* cortex,
* audit log,
* procedural memory,
* survival memory,
* execution ledger одновременно.
