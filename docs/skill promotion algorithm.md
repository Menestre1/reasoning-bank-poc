`Skill Promotion Algorithm` — один из самых критических компонентов всей твоей архитектуры.

Потому что именно он отвечает на главный вопрос:

> Когда trajectory перестаёт быть временным успешным опытом (Seed)
> и становится постоянным законом поведения (Skill)?

Если сделать promotion слабым:

* система будет закреплять мусор;
* случайные успехи;
* hallucinated workflows;
* unstable trajectories.

Если сделать promotion слишком жёстким:

* система не сможет учиться;
* adaptation collapse;
* no convergence.

---

# Главный architectural insight

## Skill ≠ successful answer.

Skill =

```text id="tz6kvj"
deterministically reproducible validated execution trajectory
```

---

# Главный принцип

## Promotion запрещён

без:

* replay stability;
* checkpoint integrity;
* ARR cleanliness;
* law compliance;
* multi-session convergence.

---

# Архитектурный shift

НЕ:

```text id="j7yjj6"
success → memory
```

А:

```text id="4n7ys8"
stable verified replayable execution
    ↓
constitutional validation
    ↓
skill promotion
```

---

# Full Promotion Pipeline

```text id="t1rlyr"
Trajectory Success
    ↓
Seed Creation
    ↓
Repeated Confirmed Successes
    ↓
Replay Verification
    ↓
Checkpoint Integrity Validation
    ↓
ARR Cleanliness Validation
    ↓
Determinism Analysis
    ↓
Cross-Session Consistency
    ↓
Skill Promotion Decision
    ↓
Canonical Skill Extraction
```

---

# Core principle

## Skill promotion is NOT event-based.

## It is evidence accumulation.

---

# 1. Seed Stage

Первый successful trajectory:

```text id="9u0qsa"
YES
```

↓

создаёт:

```text id="ntzj7r"
Seed
```

---

# Seed schema

```ts id="92qlr6"
interface SeedCandidate {
  id: string;

  trajectory_id: string;

  trajectory_hash: string;

  success_counter: number;

  replay_success_counter: number;

  arr_clean_runs: number;

  repair_count: number;

  deterministic_score: number;

  stability_score: number;

  checkpoint_integrity_score: number;

  law_compliance_score: number;

  created_at: string;

  expires_at: string;
}
```

---

# 2. Evidence Accumulation

Твоя rule 11 уже почти это описывает. 

Но нужно formal runtime algorithm.

---

# Promotion MUST require

Минимум:

| Requirement              | Why                             |
| ------------------------ | ------------------------------- |
| ≥3 successful runs       | eliminate random success        |
| replay success           | eliminate unstable trajectories |
| checkpoint integrity     | eliminate bypass                |
| ARR clean runs           | eliminate rationalization       |
| low repair count         | eliminate fragile workflows     |
| deterministic similarity | ensure reproducibility          |
| law compliance           | ensure constitutional safety    |

---

# Canonical promotion formula

---

# Promotion Score

```text id="uzyj66"
promotion_score =
    success_weight * 0.25
  + replay_weight * 0.20
  + determinism_weight * 0.20
  + checkpoint_weight * 0.15
  + arr_cleanliness_weight * 0.10
  + repair_stability_weight * 0.05
  + law_compliance_weight * 0.05
```

---

# Example weights

```ts id="j41i8z"
success_weight =
  min(success_counter / 5, 1.0)

replay_weight =
  replay_success_ratio

determinism_weight =
  artifact_similarity_score

checkpoint_weight =
  passed_checkpoints_ratio

arr_cleanliness_weight =
  arr_clean_runs / total_runs

repair_stability_weight =
  1 - repair_ratio

law_compliance_weight =
  law_pass_ratio
```

---

# Promotion threshold

```text id="7r0zxb"
promotion_score >= 0.85
```

---

# Но score alone НЕ достаточно

Нужны hard gates.

---

# 3. Hard Gates

Если хотя бы одно violated:

```text id="p8b0iw"
PROMOTION DENIED
```

---

# Hard gates

```ts id="z0lqq1"
interface PromotionHardGates {

  minimum_successes: 3;

  minimum_replays: 2;

  no_checkpoint_bypass: true;

  no_arr_critical_violations: true;

  law_compliance_required: true;

  max_repair_ratio: 0.3;

  minimum_determinism_score: 0.8;
}
```

---

# Самое важное

## ARR violations should heavily poison promotion.

---

# Example

```text id="n7ix8s"
premature_completion
```

↓

promotion denied forever.

---

# Почему

Потому что:

* рационализирующие trajectories extremely dangerous;
* they appear successful but are cognitively corrupted.

---

# 4. Replay Verification

Это КРИТИЧНО.

---

# Problem

LLM success может быть:

* случайным;
* context-dependent;
* unstable.

---

# Solution

```text id="jlwmz4"
deterministic replay
```

---

# Replay pipeline

```text id="vz8r5l"
Original Trajectory
    ↓
Replay Execution
    ↓
Artifact Comparison
    ↓
Checkpoint Comparison
    ↓
Output Stability Analysis
    ↓
Replay Verdict
```

---

# Replay schema

```ts id="0nr4f5"
interface ReplayVerification {
  original_trajectory_id: string;

  replay_trajectory_id: string;

  artifact_similarity_score: number;

  checkpoint_similarity_score: number;

  execution_order_similarity: number;

  arr_clean: boolean;

  passed: boolean;
}
```

---

# Determinism Analysis

Очень важный компонент.

---

# Skill НЕ должен быть:

```text id="y7k9nf"
prompt-lottery success
```

---

# Нужно мерить:

* artifact similarity;
* execution order stability;
* checkpoint consistency;
* repair frequency;
* runtime variance.

---

# Example

```ts id="hh2q0g"
determinism_score =
(
  artifact_similarity * 0.4 +
  checkpoint_similarity * 0.3 +
  execution_order_similarity * 0.3
)
```

---

# 5. Canonical Trajectory Extraction

Очень мощная идея.

---

# После promotion

Тебе нужно:

* НЕ хранить raw runs;
* а extract canonical execution path.

---

# Example

Из:

```text id="ul4zw5"
Run A
Run B
Run C
```

↓

получаем:

```text id="fjlwm8"
Canonical Skill Trajectory
```

---

# Canonicalization

```text id="n34tdr"
common stable steps
+ stable checkpoints
+ stable artifacts
+ stable repair branches
```

---

# Skill schema

```ts id="jlwm8q"
interface CanonicalSkill {
  id: string;

  canonical_trajectory_id: string;

  stable_steps: string[];

  required_checkpoints: string[];

  stable_artifact_patterns: string[];

  repair_patterns: string[];

  forbidden_patterns: string[];

  replay_verified: boolean;

  determinism_score: number;

  created_at: string;
}
```

---

# 6. Anti-Promotion Rules

Это очень важно.

---

# Promotion MUST fail if:

| Condition              | Why                    |
| ---------------------- | ---------------------- |
| checkpoint bypass      | protocol corruption    |
| ARR violation          | rationalization        |
| unstable replay        | nondeterministic       |
| excessive repair       | fragile skill          |
| conflicting failures   | unsafe generalization  |
| inconsistent artifacts | hallucinated execution |

---

# Poison Memory

Очень мощная идея.

---

# Some failures should poison promotion forever

---

# Example

```text id="1kv9ls"
false_compile_success
```

↓

```text id="dkig8u"
promotion_blacklisted = true
```

---

# 7. Skill Aging

Advanced feature.

---

# Important

Навык вечный.
Но confidence может деградировать.

---

# Example

```ts id="zv8o0d"
interface SkillHealth {
  skill_id: string;

  recent_failures: number;

  replay_drift_score: number;

  environment_change_detected: boolean;

  health_state:
    | 'healthy'
    | 'degrading'
    | 'unstable';
}
```

---

# Important distinction

## Skill immutable.

## Skill health mutable.

---

# 8. Promotion Review FSM

Тебе нужен отдельный FSM.

---

# Promotion FSM

```text id="7z6h2v"
SEED
   ↓
CANDIDATE
   ↓
REPLAY_PENDING
   ↓
VERIFYING
   ↓
PROMOTED
```

или:

```text id="n9vl5y"
VERIFYING
   ↓
DENIED
```

---

# 9. Multi-Patient Validation

КРИТИЧНО.

---

# Problem

Trajectory may only work for:

* one language;
* one patient profile;
* one environment.

---

# Therefore

Promotion MUST track:

```text id="pcjlwm"
applicable_patients
applicable_languages
environment_constraints
```

---

# Example

```text id="26qx9y"
works for:
- TS
- Node 22
- React
```

НО:

* NOT universal skill.

---

# 10. Human Override Layer

Очень важно.

---

# User may:

* approve promotion;
* deny promotion;
* freeze promotion;
* require more evidence.

---

# Example

```text id="kr39i5"
human_review_required = true
```

---

# Constitution laws

Добавь:

```text id="jlwm2x"
A Skill SHALL represent:
- stable,
- replayable,
- constitutionally validated execution behavior.

Single successful execution SHALL NOT constitute a Skill.
```

---

# Prolog laws

```prolog id="n2ewtm"
violation(illegal_skill_promotion) :-
    insufficient_replay_verification.

violation(illegal_skill_promotion) :-
    checkpoint_bypass_detected.

violation(illegal_skill_promotion) :-
    arr_violation_detected.

must(require_deterministic_replay).

must(require_checkpoint_integrity).

must(require_multi_success_validation).
```

---

# Самый главный insight

Ты строишь НЕ:

* reinforcement learning;
* embeddings memory;
* autonomous adaptation.

Ты строишь:

```text id="xjlwm"
constitutional procedural learning system
```

где skill —
это:

* validated law-abiding execution program,
  а не “что-то что однажды сработало”.
