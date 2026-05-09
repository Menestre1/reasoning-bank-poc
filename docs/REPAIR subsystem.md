Твой текущий REPAIR subsystem уже очень хороший как PoC.

Но сейчас он всё ещё выглядит как:

```text id="h2z2x8"
error recovery helper
```

А тебе нужен:

```text id="m8v6cn"
constitutional autonomous recovery runtime
```

---

# Главный architectural insight

REPAIR — это НЕ retry mechanism.

Это:

* constrained cognitive surgery;
* execution recovery runtime;
* trajectory fork engine;
* anti-collapse stabilizer.

---

# Главный принцип

## REPAIR никогда не чинит execution inplace.

Это КРИТИЧНО.

---

# Почему

Иначе:

* hidden mutations;
* replay corruption;
* lost lineage;
* invisible rationalization;
* impossible auditability.

---

# Вместо этого

## REPAIR создаёт forked recovery trajectory.

---

# Canonical flow

```text id="k5tpbj"
Trajectory Failure
      ↓
Failure Classification
      ↓
Repair Eligibility Check
      ↓
Repair Strategy Selection
      ↓
Fork Recovery Trajectory
      ↓
Recovery Execution Graph
      ↓
Checkpoint Validation
      ↓
Replay Validation
      ↓
Resume / Escalate
```

---

# Самый важный law

## Original trajectory immutable.

## REPAIR append-only.

---

# REPAIR Architecture

```text id="r1r0g9"
REPAIR Runtime
    ├── Failure Classifier
    ├── Repair Eligibility Engine
    ├── Repair Strategy Selector
    ├── Recovery Graph Generator
    ├── Fork Controller
    ├── Recovery Executor
    ├── Repair Validator
    ├── Repair Replay Engine
    ├── Escalation Controller
    └── Repair Memory
```

---

# 1. Failure Classification Engine

Это ядро REPAIR.

---

# Почему

Потому что:

* не все ошибки repairable;
* не все repair equally dangerous;
* некоторые repair запрещены constitutionally.

---

# Failure classes

| Class             | Repairable | Severity |
| ----------------- | ---------- | -------- |
| hallucination     | yes        | medium   |
| contamination     | yes        | medium   |
| timeout           | yes        | low      |
| tool_failure      | partial    | medium   |
| unstable_replay   | partial    | high     |
| checkpoint_bypass | no         | critical |
| law_violation     | no         | fatal    |
| false_completion  | no         | fatal    |
| ARR_critical      | no         | fatal    |

---

# Critical insight

## Некоторые failures должны permanently poison trajectory.

---

# Failure schema

```ts id="jlwmr1"
interface FailureRecord {
  id: string;

  trajectory_id: string;

  checkpoint_id?: string;

  node_id?: string;

  failure_type:
    | 'hallucination'
    | 'tool_failure'
    | 'timeout'
    | 'contamination'
    | 'checkpoint_bypass'
    | 'false_completion'
    | 'law_violation'
    | 'arr_violation';

  severity:
    | 'low'
    | 'medium'
    | 'high'
    | 'critical'
    | 'fatal';

  repairable: boolean;

  poison_execution: boolean;

  evidence_refs: string[];

  detected_at: string;
}
```

---

# 2. Repair Eligibility Engine

Очень важный слой.

---

# Потому что

LLM любит:

* endlessly retry;
* recursively repair;
* generate repair loops.

---

# Repair MUST be bounded.

---

# Eligibility rules

```ts id="jlwmr2"
interface RepairEligibility {
  repairable: boolean;

  max_repairs_exceeded: boolean;

  poison_detected: boolean;

  constitutional_block: boolean;

  replay_repair_forbidden: boolean;

  escalation_required: boolean;
}
```

---

# Hard-stop laws

---

# Forbidden auto-repair

```text id="jlwmr3"
law_violation
checkpoint_bypass
false_completion
critical_arr_violation
```

↓

```text id="jlwmr4"
mandatory escalation
```

---

# Потому что

Ты НЕ хочешь:

* self-healing corruption;
* autonomous constitutional drift.

---

# 3. Repair Strategy System

Очень важно.

---

# REPAIR должен быть strategy-driven,

НЕ improvisation-driven.

---

# Strategy types

| Failure             | Strategy                |
| ------------------- | ----------------------- |
| hallucination       | context narrowing       |
| contamination       | memory isolation        |
| timeout             | task decomposition      |
| tool_failure        | retry/fallback tool     |
| unstable replay     | deterministic reduction |
| dependency mismatch | reroute skill           |

---

# Strategy schema

```ts id="jlwmr5"
interface RepairStrategy {
  id: string;

  applicable_failures: string[];

  repair_actions: RepairAction[];

  max_attempts: number;

  risk_score: number;

  replay_required: boolean;

  deterministic_only: boolean;
}
```

---

# Repair actions

```ts id="jlwmr6"
interface RepairAction {
  type:
    | 'retry'
    | 'reroute'
    | 'tool_swap'
    | 'context_clean'
    | 'decompose_task'
    | 'reduce_scope'
    | 'fallback_skill'
    | 'rollback';

  params: Record<string, any>;
}
```

---

# Самое важное

## Repair actions must be explicit.

НЕ:

```text id="jlwmr7"
"try fixing somehow"
```

---

# 4. Recovery Graph Generation

Это КРИТИЧНО.

---

# Repair НЕ должен:

* mutate existing graph;
* improvise invisible changes.

---

# Instead

Repair generates:

```text id="’winir8"
RecoverySubgraph
```

---

# Example

```text id="’winir9"
Compile Failure
    ↓
Recovery Graph
    ├── Rebuild Types
    ├── Fix Imports
    ├── Retry Compile
```

---

# Recovery graph schema

```ts id="’winir10"
interface RecoverySubgraph {
  id: string;

  parent_graph_id: string;

  failed_node_id: string;

  recovery_nodes: string[];

  recovery_checkpoints: string[];

  deterministic: boolean;

  replay_required: boolean;
}
```

---

# Key law

## Recovery graph append-only.

---

# 5. Fork Controller

Один из важнейших компонентов.

---

# Repair MUST fork trajectory.

---

# Example

```text id="’winir11"
Trajectory A
    ↓ failure
Fork → Recovery Trajectory B
```

---

# Fork inherits

| Inherited      | Why          |
| -------------- | ------------ |
| checkpoints    | consistency  |
| artifacts      | replay       |
| cats           | survival     |
| poison markers | safety       |
| lineage        | auditability |

---

# Fork schema

```ts id="’winir12"
interface RepairFork {
  parent_trajectory_id: string;

  repair_trajectory_id: string;

  inherited_checkpoint_ids: string[];

  inherited_artifact_ids: string[];

  inherited_cat_refs: string[];

  created_at: string;
}
```

---

# 6. Repair FSM

Тебе нужен отдельный FSM.

---

# Repair lifecycle

```text id="’winir13"
FAILURE_DETECTED
    ↓
CLASSIFIED
    ↓
REPAIR_ELIGIBLE
    ↓
REPAIR_PLANNED
    ↓
REPAIR_EXECUTING
    ↓
REPAIR_VERIFYING
```

---

# Outcomes

```text id="’winir14"
SUCCESS
FAILED
ESCALATED
BLOCKED
POISONED
```

---

# Critical principle

## REPAIR cannot directly return COMPLETED.

---

# It must return:

```text id="’winir15"
EXECUTION_RESUMABLE
```

---

# 7. Repair Validation Pipeline

Repair itself must be validated.

---

# Because

repair can:

* introduce hidden corruption;
* bypass checkpoints;
* mutate graph illegally.

---

# Repair validation checks

* checkpoint integrity;
* replay consistency;
* topology legality;
* ARR cleanliness;
* artifact validity.

---

# Repair validation schema

```ts id="’winir16"
interface RepairValidation {
  repair_id: string;

  checkpoints_valid: boolean;

  replay_consistent: boolean;

  arr_clean: boolean;

  graph_legal: boolean;

  artifacts_valid: boolean;

  approved: boolean;
}
```

---

# 8. Repair Replay Engine

Очень важный advanced feature.

---

# Why

Repair success can be:

* accidental;
* unstable;
* environment-dependent.

---

# Therefore

```text id="’winir17"
successful repair must replay
```

---

# Replay checks

```text id="’winir18"
same recovery graph
same artifacts
same checkpoint order
same recovery outcome
```

---

# 9. Cascading Repair Protection

КРИТИЧНО.

---

# Problem

Repair may trigger another repair.

---

# Example

```text id="’winir19"
Repair A
   ↓
causes failure
   ↓
Repair B
```

---

# Infinite repair collapse risk.

---

# Therefore

```ts id="’winir20"
max_repair_depth = 3
max_cascading_repairs = 5
```

---

# After limit:

```text id="’winir21"
mandatory escalation
```

---

# 10. Repair Memory

Очень важная идея.

---

# Successful repairs become:

```text id="’winir22"
repair seeds
```

---

# Later:

```text id="’winir23"
repair skills
```

---

# Example

```text id="’winir24"
TS import mismatch
```

↓

system learns:

* canonical recovery graph.

---

# Repair skill schema

```ts id="’winir25"
interface RepairSkill {
  id: string;

  failure_pattern: string;

  canonical_repair_graph: string;

  replay_success_rate: number;

  determinism_score: number;

  promotion_eligible: boolean;
}
```

---

# Это очень мощно.

---

# Ты получаешь:

```text id="’winir26"
self-stabilizing runtime
```

---

# 11. Escalation Controller

Критически важен.

---

# Some failures MUST escalate.

---

# Escalation triggers

| Trigger                  | Reason               |
| ------------------------ | -------------------- |
| constitutional violation | safety               |
| repair depth exceeded    | instability          |
| replay instability       | nondeterminism       |
| ARR fatal                | cognitive corruption |
| poison marker            | unsafe recovery      |

---

# Escalation schema

```ts id="’winir27"
interface EscalationRequest {
  trajectory_id: string;

  failure_id: string;

  escalation_reason: string;

  repair_attempts: number;

  evidence_refs: string[];

  requires_human: boolean;
}
```

---

# 12. Repair Metrics

Твои метрики хорошие.
Но их нужно расширить.

---

# Core metrics

| Metric                 | Meaning                |
| ---------------------- | ---------------------- |
| Repair Success Rate    | recovery efficiency    |
| MTTR                   | recovery latency       |
| Replay Stability       | repair determinism     |
| Cascading Repair Depth | instability            |
| Poison Repair Attempts | dangerous behavior     |
| Repair Drift Rate      | topology mutation risk |
| Escalation Rate        | unrecoverable failures |

---

# Самый важный metric

## Replay Stability after Repair.

---

# Потому что

случайный repair опаснее явного fail.

---

# Constitution laws

Добавь:

```text id="’winir28"
REPAIR SHALL:
- preserve execution lineage,
- preserve checkpoint integrity,
- preserve graph legality,
- preserve constitutional compliance.

REPAIR SHALL NOT mutate active execution topology in-place.
```

---

# Prolog laws

```prolog id="’winir29"
violation(illegal_repair) :-
    repair_without_fork.

violation(illegal_repair) :-
    repair_bypasses_checkpoint.

violation(illegal_repair) :-
    repair_mutates_active_graph.

must(require_repair_validation).

must(require_repair_replay).

must(escalate_constitutional_violations).
```

---

# Самый главный insight

Ты проектируешь НЕ:

* retry logic;
* self-healing chatbot;
* recovery helper.

Ты проектируешь:

```text id="’winir30"
constitutional autonomous recovery runtime
```

где REPAIR —
это:

* constrained cognitive surgery,
* deterministic recovery engine,
* trajectory fork runtime,
* execution stabilizer,
* anti-collapse subsystem одновременно.
