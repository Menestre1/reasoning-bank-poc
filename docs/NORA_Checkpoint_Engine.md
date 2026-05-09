Твой `Checkpoint Engine` — это не просто validator.

Это:

* механический позвоночник runtime;
* enforcement system;
* execution constitution executor;
* физическая реализация law 40–42. 

Без него:

* ARR не сможет останавливать выполнение;
* trajectory не станет детерминированной;
* skill DSL останется декларативным;
* LLM всё ещё сможет “проскочить” шаг.

---

# Главная идея

## Checkpoint Engine

Это runtime-система, которая:

* разбивает trajectory на обязательные checkpoint;
* требует artifact;
* валидирует переходы;
* запрещает skip;
* запускает repair;
* блокирует premature success;
* обеспечивает deterministic execution.

---

# Архитектурная позиция

```text id="7m3xpa"
L0 Core Laws
L1 Execution Constitution
L2 Router
L3 Memory
L4 Skills
L5 Tool Runtime
L5.5 Anti-Rationalization Runtime
L5.7 Checkpoint Engine
L6 Validation
L7 Interaction
```

---

# Почему отдельный слой

Потому что checkpoint engine:

* не routing;
* не validation;
* не memory;
* не tools.

Он:

* управляет execution-state machine.

---

# Главный принцип

## Trajectory не может двигаться дальше,

если checkpoint не passed.

Не:

* “LLM считает completed”
* “response looks good”
* “probably fixed”

А только:

```text id="66fjeq"
checkpoint.status === PASSED
```

---

# Core Architecture

```text id="m5k8yl"
Trajectory Runtime
    │
    ├── Step Executor
    ├── Tool Runtime
    ├── Claim Interceptor
    ├── Artifact Store
    ├── Checkpoint Engine
    │       ├── Checkpoint FSM
    │       ├── Artifact Validator
    │       ├── Transition Guard
    │       ├── Repair Trigger
    │       ├── Replay Controller
    │       └── Protocol Enforcer
    │
    ├── Rationalization Detector
    └── Validation Layer
```

---

# Главная сущность

## Checkpoint

```ts id="zc8e7v"
interface Checkpoint {
  id: string;

  trajectory_id: string;

  step_index: number;

  name: string;

  type:
    | 'tool_execution'
    | 'validation'
    | 'artifact'
    | 'reasoning'
    | 'safety'
    | 'approval'
    | 'compile'
    | 'test';

  state:
    | 'pending'
    | 'running'
    | 'artifact_pending'
    | 'verifying'
    | 'passed'
    | 'failed'
    | 'blocked'
    | 'repair_required';

  required_artifacts: ArtifactRequirement[];

  verification_rules: VerificationRule[];

  timeout_ms?: number;

  retry_policy?: RetryPolicy;

  repair_policy?: RepairPolicy;

  blocking: boolean;

  created_at: string;

  passed_at?: string;

  metadata?: Record<string, any>;
}
```

---

# Второе ядро

## Checkpoint FSM

---

# Allowed transitions

```text id="s0r8l8"
PENDING
   ↓
RUNNING
   ↓
ARTIFACT_PENDING
   ↓
VERIFYING
   ↓
PASSED
```

или:

```text id="yu0p4w"
VERIFYING
   ↓
FAILED
   ↓
REPAIR_REQUIRED
   ↓
RUNNING
```

---

# Важно

НЕЛЬЗЯ:

```text id="zv9yql"
RUNNING → PASSED
```

без verification.

---

# Transition Guard

Это главный anti-skip механизм.

---

## Example

```ts id="5t7f8n"
class TransitionGuard {
  canTransition(
    from: CheckpointState,
    to: CheckpointState,
    context: RuntimeContext
  ): boolean {

    if (
      from === 'running' &&
      to === 'passed'
    ) {
      return false;
    }

    if (
      to === 'passed' &&
      !context.artifactsVerified
    ) {
      return false;
    }

    return true;
  }
}
```

---

# Artifact-first architecture

Checkpoint НЕ доверяет:

* reasoning;
* text;
* explanations.

Только artifact.

---

# Artifact requirements

```ts id="n4vg81"
interface ArtifactRequirement {
  artifact_type:
    | 'tool_output'
    | 'compiler_log'
    | 'test_log'
    | 'diff'
    | 'snapshot'
    | 'validation_report';

  required: boolean;

  validator: string;

  min_confidence?: number;
}
```

---

# Example

```ts id="g8b13n"
{
  checkpoint: "typescript_compile",

  required_artifacts: [
    {
      artifact_type: "compiler_log",
      validator: "tsc_exit_code_zero"
    }
  ]
}
```

---

# Verification Rules

Checkpoint проходит НЕ по наличию artifact.

А по rules.

---

## Example

```ts id="i7kp7r"
interface VerificationRule {
  id: string;

  type:
    | 'regex'
    | 'json_schema'
    | 'exit_code'
    | 'ast_check'
    | 'semantic_check'
    | 'law_check';

  target: string;

  expected?: any;

  failure_message: string;

  blocking: boolean;
}
```

---

# Example compile checkpoint

```ts id="wqozkf"
verification_rules: [
  {
    type: 'exit_code',
    expected: 0,
    blocking: true
  },
  {
    type: 'regex',
    target: 'stderr',
    expected: '^$',
    blocking: true
  }
]
```

---

# Checkpoint Groups

Очень важно.

Тебе нужны:

* serial checkpoints;
* parallel checkpoints;
* barrier checkpoints.

---

# Example

```text id="z4c0sq"
Patch Applied
    ↓
Compile
    ↓
Tests
    ↓
Law Validation
    ↓
Release
```

---

# Barrier checkpoint

```text id="vx0f7n"
ALL TESTS MUST PASS
```

---

# Example

```ts id="2k7ed2"
interface CheckpointBarrier {
  id: string;

  checkpoints: string[];

  strategy:
    | 'all_required'
    | 'quorum'
    | 'priority';

  state:
    | 'blocked'
    | 'passed'
    | 'failed';
}
```

---

# Repair System

Checkpoint Engine должен уметь:

* не просто fail;
* а возвращать trajectory назад.

---

# Example

```text id="6chjww"
compile_failed
    ↓
repair_required
    ↓
reroute_strategy
    ↓
retry_execution
```

---

# Repair Controller

```ts id="90f3ux"
interface RepairStrategy {
  id: string;

  trigger:
    | 'artifact_missing'
    | 'validation_failed'
    | 'timeout'
    | 'law_violation';

  max_retries: number;

  reroute_allowed: boolean;

  fallback_skill?: string;
}
```

---

# Replay Engine

Очень важный компонент.

---

# Почему

LLM может:

* случайно пройти;
* случайно не упасть;
* дать unstable result.

---

# Поэтому

Checkpoint Engine должен поддерживать:

```text id="nmh3z4"
deterministic replay
```

---

# Replay flow

```text id="lv4xgf"
original_execution
    ↓
artifact_capture
    ↓
replay_execution
    ↓
artifact_compare
    ↓
stability_score
```

---

# Skill Promotion integration

Это КРИТИЧЕСКИ важно.

---

# Skill нельзя promoted если:

* checkpoint skipped;
* replay unstable;
* artifact incomplete;
* repair count high;
* verification bypassed.

---

# Добавь в Skill Promotion Law

```text id="ffuy22"
A trajectory MAY become a Skill ONLY IF:
- all checkpoints passed;
- no checkpoint bypass occurred;
- replay stability is sufficient;
- artifact verification succeeded.
```

---

# Интеграция с ARR

Checkpoint Engine = execution enforcement.

ARR = anti-illusion enforcement.

---

# ARR говорит

```text id="g04mww"
"LLM claims success suspiciously"
```

---

# Checkpoint Engine отвечает

```text id="wr7t0y"
"checkpoint denied"
```

---

# Интеграция с Trajectory Schema

Тебе нужно расширить step schema.

---

# Add

```ts id="yrwqkk"
checkpoint_refs: string[];

checkpoint_state:
  | 'pending'
  | 'passed'
  | 'failed';
```

---

# Очень важная вещь

## Checkpoint inheritance

Forked trajectory должна наследовать:

* completed checkpoints;
* verified artifacts;
* failure lineage.

---

# Example

```text id="xllk8t"
Trajectory A
  ├── CP1 PASSED
  ├── CP2 FAILED
  │
  └── Fork B
        ├── inherits CP1
        ├── retries CP2
```

---

# Главный architectural shift

Сейчас у большинства AI-agent systems:

```text id="0fm9rp"
reasoning-centric execution
```

У тебя должно стать:

```text id="xej59t"
checkpoint-centric execution
```

---

# Тогда LLM превращается:

из:

* “thinking entity”

в:

* constrained execution proposer.

---

# Самый важный law

Добавь в Constitution:

```text id="jlwmxk"
Checkpoint completion SHALL require:
- artifact verification;
- transition validation;
- protocol compliance;
- runtime approval.

LLM assertions SHALL NOT advance execution state.
```

---

# Добавь в Prolog

```prolog id="2u7qjw"
violation(checkpoint_bypass) :-
    state_advanced_without_verification.

violation(checkpoint_bypass) :-
    missing_required_artifact.

must(block_trajectory) :-
    checkpoint_bypass_detected.

must(require_checkpoint_verification).
```

---

# И самое главное

Ты проектируешь не assistant.

Ты проектируешь:

```text id="z7e2hl"
deterministic cognitive execution runtime
```

И `Checkpoint Engine` —
это его kernel scheduler.
