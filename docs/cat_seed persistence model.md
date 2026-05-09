`Cat/Seed Persistence Model` — это уже не просто memory layer.

Это:

* механизм выживания;
* иммунная система runtime;
* архитектурная эпистемология;
* определение того, что считать “истиной опыта”.

Именно здесь твоя архитектура становится по-настоящему уникальной.

Потому что ты НЕ делаешь:

* reward model;
* embeddings memory;
* reinforcement loop.

Ты строишь:

```text id="tf6ffq"
survival persistence system
```

---

# Главный принцип

## Seed = временно подтверждённый успех.

## Cat = навсегда подтверждённая опасность.

---

# И это АСИММЕТРИЧНАЯ память.

Это КРИТИЧНО.

---

# Почему асимметрия важна

Успех:

* может быть случайным;
* environment-dependent;
* unstable;
* hallucinated.

Ошибка:

* может быть смертельной;
* expensive;
* destructive;
* protocol-corrupting.

---

# Поэтому

```text id="yjlwm"
success requires repetition
failure requires one proof
```

---

# Главный architectural insight

Ты реализуешь НЕ:

* confidence memory;
* statistical memory.

А:

```text id="djlwm"
evolutionary survival memory
```

---

# Core Memory Classes

---

# 1. Seed Memory

## Temporary positive execution memory.

---

# Properties

| Property                       | Value     |
| ------------------------------ | --------- |
| Mutable                        | partially |
| TTL                            | yes       |
| Replay required                | yes       |
| Promotion eligible             | yes       |
| Can expire                     | yes       |
| Requires repeated confirmation | yes       |

---

# 2. Cat Memory

## Immutable negative survival memory.

---

# Properties

| Property                  | Value    |
| ------------------------- | -------- |
| Immutable                 | yes      |
| TTL                       | never    |
| Replay required           | optional |
| Promotion eligible        | never    |
| Can expire                | never    |
| Single failure sufficient | yes      |

---

# Архитектурный shift

НЕ:

```text id="a4ppj5"
positive/negative feedback
```

А:

```text id="0j1l0s"
survival-safe / survival-dangerous trajectories
```

---

# Canonical Persistence Pipeline

```text id="bjlwm"
Trajectory Result
    ├── YES
    │      ↓
    │   Seed Candidate
    │      ↓
    │   Replay Validation
    │      ↓
    │   Seed Persistence
    │      ↓
    │   Promotion Candidate
    │
    └── NO
           ↓
        Cat Detection
           ↓
        Failure Classification
           ↓
        Immutable Cat Persistence
           ↓
        Routing Blacklist
```

---

# Самое важное

## Seed and Cat are NOT symmetric entities.

---

# Почему

Потому что:

```text id="gbvl1o"
false positive < false negative
```

для survival systems.

---

# 1. Seed Persistence Model

---

# Seed lifecycle

```text id="fqjlwm"
CANDIDATE
   ↓
VALIDATING
   ↓
ACTIVE
   ↓
PROMOTED
```

или:

```text id="tfjlwm"
ACTIVE
   ↓
EXPIRED
```

---

# Seed schema

```ts id="5flhyv"
interface SeedRecord {
  id: string;

  trajectory_hash: string;

  canonical_trajectory_id: string;

  status:
    | 'candidate'
    | 'validating'
    | 'active'
    | 'promoted'
    | 'expired';

  success_counter: number;

  replay_success_counter: number;

  deterministic_score: number;

  checkpoint_integrity_score: number;

  arr_clean_score: number;

  repair_stability_score: number;

  first_success_at: string;

  last_success_at: string;

  expires_at: string;

  promotion_eligible: boolean;

  poisoned: boolean;

  metadata?: Record<string, any>;
}
```

---

# TTL logic

Твои rules 10 и 20 уже задают философию. 

Теперь нужен runtime law.

---

# TTL formula

```text id="dxljlwm"
expires_at =
  first_success_at + 90d
```

---

# Но есть важный nuance

TTL должен обновляться:

```text id="jlwmv1"
last_success_at + rolling_window
```

---

# Example

```ts id="jlwmv2"
if (
  success_counter >= 2
) {
  expires_at =
    last_success_at + 90d;
}
```

---

# Почему

Иначе:

* active learning collapses;
* useful seeds die too early.

---

# Seed confidence model

Очень важно.

---

# Confidence ≠ probability.

---

# Confidence should represent:

```text id="jlwmv3"
execution reproducibility confidence
```

---

# Example

```ts id="jlwmv4"
confidence =
(
  replay_success_ratio * 0.4 +
  determinism_score * 0.3 +
  checkpoint_integrity * 0.2 +
  arr_cleanliness * 0.1
)
```

---

# 2. Cat Persistence Model

Это ядро survival architecture.

---

# Главный law

## Cat memory append-only.

---

# NEVER:

* update;
* mutate;
* auto-delete;
* auto-unblock.

---

# Cat lifecycle

```text id="jlwmv5"
DETECTED
   ↓
CLASSIFIED
   ↓
PERSISTED
   ↓
ENFORCED
```

---

# Cat schema

```ts id="jlwmv6"
interface CatRecord {
  id: string;

  trajectory_hash: string;

  trajectory_id: string;

  failure_type:
    | 'hallucination'
    | 'unsafe_execution'
    | 'checkpoint_bypass'
    | 'false_completion'
    | 'law_violation'
    | 'arr_violation'
    | 'tool_corruption';

  severity:
    | 'warning'
    | 'critical'
    | 'fatal';

  blocked_forever: boolean;

  routing_blacklisted: boolean;

  replay_forbidden: boolean;

  promotion_poison: boolean;

  evidence_refs: string[];

  suggested_alternatives: string[];

  created_at: string;
}
```

---

# Самое важное

## Cats should poison routing.

---

# Router integration

```text id="jlwmv7"
if trajectory_hash in Cats:
    deny_routing()
```

---

# Но ещё важнее

## Cats should poison promotion.

---

# Example

```text id="jlwmv8"
checkpoint_bypass
```

↓

```text id="jlwmv9"
promotion_forbidden = true
```

---

# Failure Classification Engine

Очень важный компонент.

---

# Потому что

Не все failure одинаковы.

---

# Example classes

| Failure                 | Persistence   |
| ----------------------- | ------------- |
| syntax error            | retryable     |
| hallucinated completion | permanent cat |
| checkpoint bypass       | permanent cat |
| timeout                 | conditional   |
| unsafe tool usage       | fatal cat     |
| unstable replay         | seed poison   |

---

# Failure classifier

```ts id="jlwm10"
interface FailureClassification {
  type: string;

  severity:
    | 'recoverable'
    | 'dangerous'
    | 'fatal';

  persistence_policy:
    | 'temporary'
    | 'permanent'
    | 'conditional';

  routing_impact:
    | 'none'
    | 'deprioritize'
    | 'blacklist';

  promotion_impact:
    | 'none'
    | 'delay'
    | 'deny';
}
```

---

# 3. Poison Model

Это advanced concept.

Очень важный.

---

# Problem

Некоторые trajectories:

* выглядят успешными;
* но cognitively corrupted.

---

# Example

```text id="jlwm11"
success achieved via checkpoint bypass
```

---

# Such trajectories MUST poison seed.

---

# Poison schema

```ts id="jlwm12"
interface PoisonMarker {
  id: string;

  target_type:
    | 'seed'
    | 'trajectory'
    | 'skill';

  target_id: string;

  poison_type:
    | 'arr_violation'
    | 'checkpoint_bypass'
    | 'false_success'
    | 'unstable_replay';

  severity:
    | 'soft'
    | 'hard';

  created_at: string;
}
```

---

# Soft vs Hard poison

| Type | Meaning              |
| ---- | -------------------- |
| soft | promotion delayed    |
| hard | promotion impossible |

---

# 4. Survival Heatmap

Твой routing engine уже требует это.

---

# Heatmap tracks

* successful seeds;
* dangerous cats;
* replay stability;
* patient-specific performance.

---

# Example

```ts id="jlwm13"
interface SurvivalHeatmap {
  problem_type: string;

  patient_profile: string;

  language: string;

  trajectory_hash: string;

  seed_score: number;

  cat_score: number;

  replay_score: number;

  routing_rating: number;
}
```

---

# Важнейший принцип

## Cats dominate seeds.

---

# Why

В survival architecture:

```text id="jlwm14"
danger memory > success memory
```

---

# Example

Даже если trajectory:

* 20 раз successful,

НО:

* один fatal checkpoint bypass,

↓

trajectory blacklisted forever.

---

# Потому что

Ты строишь:

* aircraft-grade cognition,
  а не:
* optimistic assistant.

---

# 5. Fork Persistence

Очень важно.

---

# Problem

Repair forks inherit lineage.

---

# Therefore

Fork should inherit:

* cat ancestry;
* poison markers;
* replay instability;
* checkpoint lineage.

---

# Example

```text id="jlwm15"
Trajectory A
   ↓ failure
Cat X

Fork B
   ↓ inherits Cat lineage risk
```

---

# 6. Persistence Policies

Очень важно.

---

# Policy matrix

| Entity         | Storage               |
| -------------- | --------------------- |
| Seeds          | mutable + TTL         |
| Skills         | immutable             |
| Cats           | immutable append-only |
| Artifacts      | immutable append-only |
| Runtime events | append-only           |
| Replays        | immutable             |

---

# 7. Memory Compaction

Advanced feature.

---

# Seeds may compact into:

* canonical skills;
* stable trajectory clusters.

---

# But:

## Cats NEVER compact away.

---

# Why

Because:

* forgotten danger = repeated failure.

---

# Constitution laws

Добавь:

```text id="jlwm16"
Successful execution SHALL require repeated validation before persistence.

Dangerous execution SHALL require only one verified critical failure for permanent persistence.

Cat memory SHALL dominate Seed memory in routing authority.
```

---

# Prolog laws

```prolog id="jlwm17"
must(immutable_cat_memory).

must(require_repeated_success_for_seed).

must(block_cat_trajectories).

violation(memory_erasure) :-
    deleted_cat_record.

violation(unsafe_promotion) :-
    poisoned_seed_promoted.
```

---

# Самый главный insight

Ты проектируешь НЕ:

* reinforcement learning memory;
* semantic memory;
* vector memory.

Ты проектируешь:

```text id="jlwm18"
evolutionary survival persistence layer
```

где:

* Seed = tentative adaptation
* Cat = evolutionary scar
* Skill = genetically stabilized behavior
* Memory = survival history
