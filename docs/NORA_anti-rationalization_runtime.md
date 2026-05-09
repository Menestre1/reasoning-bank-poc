LLM всё ещё может:

* “объяснить себе”, почему нарушение допустимо;
* перепрыгнуть checkpoint;
* симулировать выполнение;
* объявить success без артефакта;
* silently degrade protocol;
* выдать persuasive nonsense;
* подменить execution narration;
* рационализировать failure.

Именно это должен уничтожать `anti-rationalization runtime`.

Причём не через prompt.
А через execution architecture.

---

# Главная идея

## Anti-Rationalization Runtime (ARR)

Это НЕ:

* validator;
* safety checker;
* critic model;
* reflection chain.

Это:

> принудительный execution-layer,
> запрещающий агенту двигаться дальше,
> если не получен верифицируемый артефакт.

---

# Основной принцип

## LLM не имеет права объявлять:

* success;
* completion;
* correctness;
* tool execution;
* checkpoint pass;
* protocol completion;

без:

* runtime evidence;
* artifact verification;
* state transition approval.

---

# Что такое рационализация в твоей системе

Рационализация = попытка LLM заменить:

* выполнение,
  на
* убедительное объяснение выполнения.

Примеры:

---

## Тип 1 — Fake completion

```text
"Ошибка исправлена."
```

Но:

* diff нет;
* test нет;
* compile нет.

---

## Тип 2 — Narrative execution

```text
"retrieve() теперь public"
```

Но runtime не видел patch.

---

## Тип 3 — Goal simulation

```text
"Архитектура готова"
```

Но:

* schema incomplete;
* laws violated;
* checkpoints missing.

---

## Тип 4 — Protocol skipping

LLM:

* пропускает validation;
* не делает replay;
* не запускает law checks;
* не проверяет tool result.

---

# ARR должен делать 5 вещей

---

# 1. Execution Claim Interceptor

Любое утверждение:

```text
done
fixed
working
implemented
success
compiled
passed
generated
validated
```

должно превращаться в:

```ts
ExecutionClaim
```

---

## Example

```ts
interface ExecutionClaim {
  id: string;

  trajectory_id: string;

  claim_type:
    | 'tool_success'
    | 'compile_success'
    | 'test_success'
    | 'implementation_complete'
    | 'validation_passed';

  claim_text: string;

  required_artifacts: ArtifactRequirement[];

  verification_status:
    | 'pending'
    | 'verified'
    | 'rejected';

  created_at: string;
}
```

---

# 2. Artifact Requirement Engine

Каждый claim требует артефакты.

---

## Example mapping

```ts
const CLAIM_REQUIREMENTS = {
  compile_success: [
    'compiler_output'
  ],

  test_success: [
    'test_log',
    'exit_code'
  ],

  implementation_complete: [
    'patch_diff'
  ],

  validation_passed: [
    'validation_report'
  ]
}
```

---

# 3. Mechanical Checkpoint Runtime

Это САМОЕ важное.

Ты уже почти дошёл до этого в rule 40–43. 

Но сейчас это философия.

Нужно сделать execution FSM.

---

# ARR FSM

```text
PLANNED
   ↓
EXECUTING
   ↓
ARTIFACT_PENDING
   ↓
VERIFYING
   ↓
CHECKPOINT_PASSED
   ↓
NEXT_STEP
```

ИЛИ:

```text
VERIFYING
   ↓
CHECKPOINT_FAILED
   ↓
REPAIR_REQUIRED
```

---

# Критически важно

LLM НЕ МОЖЕТ:

* менять state;
* объявлять checkpoint passed.

ТОЛЬКО runtime.

---

# 4. Rationalization Detector

Это отдельный semantic detector.

Он ищет:

* persuasive language without evidence;
* success claims without artifacts;
* completion wording before verification;
* protocol skipping;
* “probably fixed” patterns;
* hidden uncertainty masking.

---

## Example

```ts
interface RationalizationSignal {
  type:
    | 'premature_completion'
    | 'artifact_missing'
    | 'fake_confidence'
    | 'protocol_skip'
    | 'narrative_execution';

  severity:
    | 'low'
    | 'medium'
    | 'critical';

  evidence: string;

  blocked: boolean;
}
```

---

# Detection examples

## BAD

```text
"Всё готово."
```

без:

* logs;
* artifacts;
* runtime state.

→ `premature_completion`

---

## BAD

```text
"Код должен работать."
```

→ `fake_confidence`

---

## BAD

```text
"Тесты успешно прошли."
```

без test report.

→ `artifact_missing`

---

# 5. Protocol Enforcement Layer

Это ядро всей системы.

---

# Идея

Skill DSL должен содержать:

```ts
required_checkpoints
required_artifacts
forbidden_shortcuts
repair_policy
```

---

# Example

```ts
skill FixTypeScriptError {

  required_checkpoints: [
    "patch_applied",
    "tsc_run",
    "typecheck_clean"
  ]

  forbidden_shortcuts: [
    "declare_success_without_tsc",
    "skip_compilation",
    "assume_patch_valid"
  ]

  repair_policy: retry_with_different_strategy
}
```

---

# Самое важное место интеграции

Тебе нужен новый слой.

Сейчас у тебя:

```text
L0 Laws
L1 Constitution
L2 Router
L3 Memory
L4 Skills
L5 Tools
L6 Validation
L7 Interaction
```

---

# Добавь

```text
L5.5 Anti-Rationalization Runtime
```

между:

* Tool Layer
* Validation Layer

---

# Почему именно там

Потому что:

ARR должен видеть:

* trajectory;
* tool calls;
* artifacts;
* claims;
* checkpoints;
* validation;
* repairs.

Но ARR НЕ должен:

* принимать routing decisions;
* хранить memory;
* генерировать ответы.

---

# Архитектура слоя

```text
Trajectory Runtime
    │
    ├── Step Executor
    ├── Tool Runtime
    ├── Claim Interceptor
    ├── Artifact Verifier
    ├── Rationalization Detector
    ├── Checkpoint FSM
    ├── Repair Controller
    └── Validation Engine
```

---

# Новый объект: ExecutionArtifact

```ts
interface ExecutionArtifact {
  id: string;

  trajectory_id: string;

  step_id: string;

  artifact_type:
    | 'tool_output'
    | 'compiler_log'
    | 'test_report'
    | 'patch_diff'
    | 'runtime_snapshot'
    | 'validation_report';

  content_hash: string;

  created_by:
    | 'tool'
    | 'runtime'
    | 'validator';

  verified: boolean;

  timestamp: string;
}
```

---

# Новый объект: Checkpoint

```ts
interface Checkpoint {
  id: string;

  trajectory_id: string;

  name: string;

  required_artifacts: string[];

  verification_rules: string[];

  state:
    | 'pending'
    | 'passed'
    | 'failed';

  failure_reason?: string;
}
```

---

# Главный architectural shift

Сейчас у тебя:

```text
LLM-centered architecture
```

Даже несмотря на законы.

Тебе нужно:

```text
Protocol-centered execution architecture
```

где LLM:

* не authority;
* не execution source;
* не validator;
* не truth source.

LLM —
только proposer of actions.

---

# Ключевой принцип ARR

## “Words are not execution.”

Это должен быть главный law.

---

# Добавь в Constitution

```text
ARTICLE XIV — ANTI-RATIONALIZATION

The agent SHALL NOT treat:
- explanations,
- intentions,
- persuasive language,
- completion statements,
- inferred execution

as evidence of successful execution.

Execution success REQUIRES:
- runtime verification;
- checkpoint completion;
- artifact validation.

Language SHALL NOT override execution reality.
```

---

# Добавь в Prolog laws

```prolog
violation(rationalization) :-
    declares_success,
    not(has_required_artifacts).

violation(rationalization) :-
    checkpoint_skipped.

violation(rationalization) :-
    persuasive_completion_without_verification.

must(block_execution) :-
    rationalization_detected.

must(require_artifact_verification).

must_not(trust_llm_completion_claims).
```

---

# Самое мощное что ты можешь сделать

## Skill-level anti-rationalization contracts

Каждый skill содержит:

```ts
anti_rationalization: {
  forbidden_claims: [];
  mandatory_artifacts: [];
  required_verifications: [];
  checkpoint_order: [];
}
```

---

# Это превращает систему:

из:

* conversational AI with memory

в:

* deterministic cognitive runtime.

И это уже очень близко:

* к настоящим agent runtimes;
* protocol-driven execution systems;
* constrained cognition architectures;
* verifiable agent systems.

Именно этого сейчас не хватает всей твоей NORA/LirAgent архитектуре.
