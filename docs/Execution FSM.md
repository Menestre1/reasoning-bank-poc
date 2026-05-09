Execution FSM — это сердце всей твоей архитектуры.

Не router.
Не memory.
Не skills.

Именно FSM превращает:

* trajectory,
  в
* принудительно управляемое выполнение.

Без FSM:

* laws остаются декларациями;
* checkpoints — просто metadata;
* ARR — advisory system;
* trajectory — лог событий.

FSM делает систему:

* детерминированной;
* enforceable;
* protocol-driven.

---

# Главная идея

## Execution FSM

Это:

* machine-controlled cognition protocol;
* runtime constitution executor;
* anti-chaos scheduler;
* deterministic state controller.

---

# Главный принцип

## LLM НЕ управляет execution.

LLM:

* предлагает действия;
* генерирует candidate reasoning;
* предлагает repair.

НО:

только FSM:

* меняет state;
* разрешает execution;
* открывает checkpoints;
* блокирует trajectory;
* завершает execution.

---

# Главный architectural shift

Сейчас у тебя:

```text id="e8pvqy"
LLM → reasoning → response
```

Должно стать:

```text id="bf06xy"
LLM → proposal
FSM → execution authority
```

---

# Основная архитектура

```text id="p8zw41"
User Input
    ↓
Router Engine
    ↓
Trajectory Planner
    ↓
Execution FSM
    ├── State Machine
    ├── Transition Guard
    ├── Checkpoint Controller
    ├── Artifact Gate
    ├── Repair Runtime
    ├── ARR Enforcement
    ├── Replay Controller
    └── Validation Runtime
    ↓
Final Response
```

---

# FSM Core States

Тебе нужна многоуровневая FSM.

---

# Level 1 — Trajectory Lifecycle

```text id="bwd02d"
CREATED
    ↓
PLANNED
    ↓
READY
    ↓
EXECUTING
    ↓
VERIFYING
    ↓
COMPLETED
```

или:

```text id="yl4q3j"
EXECUTING
    ↓
FAILED
    ↓
REPAIRING
    ↓
RETRYING
```

или:

```text id="69n4q8"
FAILED
    ↓
BLOCKED
```

---

# Полная canonical FSM

```text id="r7x9n0"
CREATED
PLANNED
ROUTED
READY

EXECUTING
STEP_RUNNING
TOOL_RUNNING
ARTIFACT_PENDING

VERIFYING
CHECKPOINT_VERIFYING
LAW_VERIFYING
REPLAY_VERIFYING

PASSED
FAILED
BLOCKED

REPAIR_REQUIRED
REPAIRING
RETRYING

ABORTED
COMPLETED
ARCHIVED
```

---

# Самое важное правило

## FSM states immutable by LLM

LLM НЕ МОЖЕТ:

```text id="pbql4k"
setState(COMPLETED)
```

НИКОГДА.

---

# State ownership

| State     | Owner             |
| --------- | ----------------- |
| CREATED   | runtime           |
| ROUTED    | router            |
| EXECUTING | FSM               |
| VERIFYING | validator         |
| PASSED    | checkpoint engine |
| FAILED    | runtime           |
| BLOCKED   | ARR               |
| COMPLETED | FSM only          |

---

# Core object

```ts id="ud9yjc"
interface ExecutionState {
  trajectory_id: string;

  current_state: ExecutionFSMState;

  previous_state?: ExecutionFSMState;

  entered_at: string;

  entered_by:
    | 'runtime'
    | 'router'
    | 'checkpoint_engine'
    | 'validator'
    | 'arr';

  transition_reason?: string;

  active_step_id?: string;

  active_checkpoint_id?: string;

  retry_count: number;

  blocked_reason?: string;

  metadata?: Record<string, any>;
}
```

---

# Transition Engine

Это ядро FSM.

---

# Transition contract

```ts id="vjlwmx"
interface TransitionRequest {
  trajectory_id: string;

  from: ExecutionFSMState;

  to: ExecutionFSMState;

  requested_by:
    | 'runtime'
    | 'validator'
    | 'checkpoint_engine'
    | 'arr';

  reason: string;

  evidence_refs: string[];

  checkpoint_refs: string[];
}
```

---

# Главное

Transition НЕ происходит автоматически.

---

# Transition Pipeline

```text id="m0j3wl"
Transition Request
      ↓
Transition Guard
      ↓
Law Validation
      ↓
Checkpoint Validation
      ↓
Artifact Validation
      ↓
ARR Scan
      ↓
Transition Commit
```

---

# Transition Guard

Самый важный компонент.

---

# Example

```ts id="mg56o3"
class TransitionGuard {

  canTransition(
    request: TransitionRequest,
    context: RuntimeContext
  ): TransitionResult {

    if (
      request.to === 'COMPLETED' &&
      !context.allCheckpointsPassed
    ) {
      return deny(
        'incomplete_checkpoints'
      );
    }

    if (
      request.to === 'PASSED' &&
      !context.artifactsVerified
    ) {
      return deny(
        'artifacts_missing'
      );
    }

    if (
      context.arrFlags.includes(
        'premature_completion'
      )
    ) {
      return deny(
        'rationalization_detected'
      );
    }

    return allow();
  }
}
```

---

# State Categories

Это ОЧЕНЬ важно.

---

# 1. Operational States

```text id="v7j9eq"
EXECUTING
STEP_RUNNING
TOOL_RUNNING
VERIFYING
```

---

# 2. Control States

```text id="yvz33d"
BLOCKED
REPAIR_REQUIRED
RETRYING
```

---

# 3. Terminal States

```text id="1m7fba"
COMPLETED
FAILED
ABORTED
ARCHIVED
```

---

# 4. Meta States

```text id="nq0n4q"
REPLAY_VERIFYING
LAW_VERIFYING
ARR_REVIEW
```

---

# Nested FSM

Тебе нужна НЕ одна FSM.

А hierarchical FSM.

---

# Level hierarchy

```text id="otbks4"
Trajectory FSM
    ├── Step FSM
    ├── Tool FSM
    ├── Checkpoint FSM
    ├── Repair FSM
    └── Validation FSM
```

---

# Example

## Trajectory FSM

```text id="z2kl9v"
EXECUTING
```

внутри:

## Step FSM

```text id="6s5wpy"
RUNNING → TOOL_RUNNING → VERIFYING
```

---

# Why hierarchical FSM critical

Иначе:

* state explosion;
* impossible transitions;
* chaotic repair logic.

---

# Repair FSM

Это отдельная подсистема.

---

# Repair lifecycle

```text id="n9sl5u"
FAILED
   ↓
REPAIR_REQUIRED
   ↓
REPAIR_PLANNING
   ↓
REPAIR_EXECUTING
   ↓
REPAIR_VERIFYING
```

---

# Repair object

```ts id="c98g6k"
interface RepairAttempt {
  id: string;

  trajectory_id: string;

  failed_checkpoint_id: string;

  repair_strategy: string;

  retry_number: number;

  result:
    | 'success'
    | 'failure';

  artifact_refs: string[];

  created_at: string;
}
```

---

# Critical principle

## Repair NEVER overwrites failure history.

Failure lineage immutable.

---

# Replay FSM

Очень важно.

---

# Replay states

```text id="ty92ha"
REPLAY_SCHEDULED
REPLAY_RUNNING
REPLAY_VERIFYING
REPLAY_PASSED
REPLAY_FAILED
```

---

# Зачем replay нужен

Потому что:

* случайный success ≠ stable skill;
* unstable trajectory dangerous.

---

# Skill Promotion integration

Trajectory НЕ может стать skill если:

```text id="vixvbh"
replay_failed
```

---

# ARR Integration

FSM — главный enforcement layer для ARR.

---

# Example

ARR signal:

```text id="b1wz9t"
premature_completion
```

↓

FSM reaction:

```text id="l1um9l"
EXECUTING → BLOCKED
```

---

# Checkpoint integration

Checkpoint FSM — nested FSM.

---

# Example

```text id="6n6sbt"
STEP_RUNNING
    ↓
CHECKPOINT_PENDING
    ↓
ARTIFACT_PENDING
    ↓
VERIFYING
    ↓
PASSED
```

---

# Protocol locks

Очень мощная идея.

---

# Protocol Lock

Некоторые states:

* mutually exclusive;
* impossible to bypass.

---

# Example

```text id="c6c08n"
COMPLETED locked until:
- all checkpoints passed
- no ARR violations
- replay stable
- law verification passed
```

---

# Add execution tokens

Это advanced feature.

---

# Idea

Execution step получает:

```text id="m61h4f"
execution_token
```

Только FSM может:

* issue token;
* revoke token;
* advance token.

---

# Это предотвращает

* rogue execution;
* skipped validation;
* unauthorized tool usage.

---

# Example

```ts id="7l7gf9"
interface ExecutionToken {
  id: string;

  trajectory_id: string;

  allowed_state: ExecutionFSMState;

  expires_at: string;

  issued_by: 'fsm';

  revoked: boolean;
}
```

---

# Timeouts

Критично.

---

# FSM must handle

```text id="5mf4t9"
TIMEOUT
```

---

# Example

```text id="1fq0zv"
TOOL_RUNNING
   ↓ timeout
FAILED
   ↓
REPAIR_REQUIRED
```

---

# Deadlock prevention

Тоже важно.

---

# Problem

FSM может зависнуть:

```text id="mzwng2"
ARTIFACT_PENDING forever
```

---

# Solution

```ts id="jlwm5x"
max_state_duration_ms
heartbeat_required
stale_execution_detector
```

---

# Constitution integration

Добавь:

```text id="t6rglv"
Execution state transitions SHALL:
- require runtime authorization;
- require protocol compliance;
- require checkpoint validation;
- reject unauthorized advancement.

LLM-generated text SHALL NOT mutate execution state.
```

---

# Prolog laws

```prolog id="vzdlfc"
violation(illegal_state_transition) :-
    state_transition_without_authorization.

violation(illegal_state_transition) :-
    transition_without_checkpoint_validation.

must(block_execution) :-
    illegal_state_transition.

must(require_fsm_authority).
```

---

# Самый главный architectural insight

Ты строишь НЕ:

* autonomous assistant;
* conversational AI;
* agent framework.

Ты строишь:

```text id="dn4dpm"
cognitive operating system
```

И FSM —
это его kernel scheduler + syscall controller + execution authority одновременно.
