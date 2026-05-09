NORA Router Engine Architecture
Cognitive Routing Layer for LirAgent / NORA
Router Engine — это не просто:
intent classifier
А:
cognitive traffic controller
Его задача:


решать КАК агент должен думать;


какую память использовать;


какие tools разрешить;


какой reasoning mode включить;


насколько доверять retrieval;


нужен ли conservative mode;


нужно ли anti-hallucination усиление;


когда memory опасна;


когда нужен decomposition;


когда нужен direct answer.



1. Архитектурная цель
Router Engine должен:


предотвращать contamination;


уменьшать hallucinations;


выбирать reasoning trajectory;


контролировать memory injection;


управлять tool policy;


управлять prompt composition;


стабилизировать поведение агента.



2. High-Level Architecture
User Input    │    ▼┌──────────────────────┐│ Preprocessor         ││ - normalization      ││ - language detect    ││ - syntax signals     │└──────────┬───────────┘           │           ▼┌──────────────────────┐│ Cognitive Router     ││                      ││ - domain routing     ││ - risk analysis      ││ - memory policy      ││ - tool policy        ││ - reasoning mode     ││ - anti-pattern check │└──────────┬───────────┘           │           ▼┌──────────────────────┐│ Route Plan           ││                      ││ memory_mode          ││ tool_mode            ││ reasoning_depth      ││ retrieval_policy     ││ hallucination_guard  ││ execution_strategy   │└──────────┬───────────┘           │           ▼┌──────────────────────┐│ Execution Pipeline   ││                      ││ retrieval            ││ tool orchestration   ││ prompt builder       ││ LLM execution        │└──────────────────────┘

3. Core Design Principle
Router НЕ должен отвечать.
Router:


управляет cognition;


выбирает trajectories;


настраивает execution pipeline.



4. Core Routing Dimensions

A. Domain Router
Определяет:


BSL


TypeScript


SQL


infra


architecture


debugging


config-analysis


conversation


tool-operation


Output
domain: 'bsl'confidence: 0.91

B. Complexity Router
Определяет:


simple QA


deep reasoning


decomposition required


multi-step planning


retrieval-heavy task


tool-heavy task


Output
reasoningDepth: 'minimal' | 'normal' | 'deep'

C. Risk Router
Определяет риск:


hallucination


contamination


syntax corruption


unsafe tool execution


weak retrieval


conflicting memory


Output
riskLevel: 'low' | 'medium' | 'high'

D. Memory Router
Решает:


inject retrieval?


inject failures?


inject skills?


suppress noisy memory?


rerank failures?


use conservative memory mode?



E. Tool Router
Решает:


tools forbidden


tools optional


tools required


autonomous execution allowed?


confirmation required?



F. Reasoning Router
Выбирает cognitive mode.
Например:
ModePurposedirectбыстрый ответretrievalmemory-heavyreflectiveself-checkdecompositionmulti-steprepairисправлениеconservativeanti-hallucinationtool-driventool orchestration

5. RoutePlan (главный объект)
interface RoutePlan {  domain: Domain;  reasoningMode:    | 'direct'    | 'retrieval'    | 'reflective'    | 'decomposition'    | 'repair'    | 'conservative'    | 'tool-driven';  reasoningDepth:    | 'minimal'    | 'normal'    | 'deep';  memoryPolicy: {    injectSkills: boolean;    injectFailures: boolean;    injectKnowledge: boolean;    suppressWeakMemories: boolean;    retrievalThreshold: number;    maxMemories: number;  };  toolPolicy: {    allowTools: boolean;    requireConfirmation: boolean;    autonomousExecution: boolean;    allowedTools: string[];  };  safetyPolicy: {    hallucinationGuard: boolean;    contaminationGuard: boolean;    syntaxStrictMode: boolean;    uncertaintyDisclosure: boolean;  };  executionPolicy: {    streamResponse: boolean;    selfCheck: boolean;    retryOnConflict: boolean;    validateCode: boolean;  };  warnings: string[];  confidence: number;}

6. Routing Pipeline
Stage 1 — Input Analysis
analyzeInput()
Извлекает:


language


entities


syntax signals


risk signals


urgency


ambiguity



Stage 2 — Memory Risk Scan
scanFailureMemories()
Ищет:


похожие ошибки;


contamination history;


hallucination clusters;


unstable skills.



Stage 3 — Domain Resolution
resolveDomain()

Stage 4 — Route Synthesis
Главная логика.
buildRoutePlan()

7. Cognitive Modes

DIRECT MODE
Для:


простых вопросов;


high confidence;


no retrieval needed.


Минимальный prompt.

RETRIEVAL MODE
Для:


knowledge-heavy tasks;


similar successful memories.


Включает:


semantic memory;


skills;


retrieval reranking.



REFLECTIVE MODE
Для:


high hallucination risk;


architecture;


dangerous synthesis.


Добавляет:


self-check;


contradiction check;


consistency validation.



DECOMPOSITION MODE
Для:


сложных задач;


multi-step planning;


refactoring;


architecture design.


Pipeline:
problem→ subproblems→ solve→ recombine→ verify

REPAIR MODE
Для:


debugging;


fixing;


patch generation.


Фокус:


diff reasoning;


root cause analysis.



CONSERVATIVE MODE
Для:


low confidence;


weak retrieval;


uncertainty.


Поведение:


меньше генерации;


больше disclaimers;


больше verification;


меньше speculation.



TOOL-DRIVEN MODE
Для:


config analysis;


filesystem;


execution;


graph operations.



8. Memory Injection Strategy
Ключевой момент.
НЕ:
dump retrieval into prompt
А:
controlled cognitive injection

Skill Injection
Preferred successful strategies:- ...

Failure Injection
Avoid these failure patterns:- hallucination- contamination

Weak Memory Suppression
Если similarity низкий:


memory НЕ inject.



Conflict Resolver
Если:


success vs failure conflict


то:


reflective mode


reranking


confidence reduction



9. Hallucination Guard Layer
Отдельный subsystem.

Detects


invented API risk


syntax uncertainty


unsupported claims


low evidence generation



Actions
hallucinationGuard = true
→ prompt hardening

10. Router Laws

Law 1
Высокий риск → меньше creativity.

Law 2
Высокая uncertainty → больше disclosure.

Law 3
Failure memory важнее weak retrieval.

Law 4
Domain consistency обязательна.

Law 5
Tool execution требует stronger validation.

11. Suggested File Structure
src/router/├── RouterEngine.ts├── RoutePlan.ts├── DomainRouter.ts├── RiskRouter.ts├── MemoryRouter.ts├── ToolRouter.ts├── ReasoningRouter.ts├── HallucinationGuard.ts├── ContextAnalyzer.ts├── ConflictResolver.ts├── policies/│   ├── MemoryPolicy.ts│   ├── ToolPolicy.ts│   ├── SafetyPolicy.ts│   └── ExecutionPolicy.ts└── modes/    ├── DirectMode.ts    ├── ReflectiveMode.ts    ├── DecompositionMode.ts    ├── ConservativeMode.ts    └── ToolDrivenMode.ts

12. Core Router Algorithm
routeScore=domainConfidence+retrievalConfidence−hallucinationRisk−contaminationRiskrouteScore = domainConfidence + retrievalConfidence - hallucinationRisk - contaminationRiskrouteScore=domainConfidence+retrievalConfidence−hallucinationRisk−contaminationRisk

13. Production-Grade Extension
Следующий уровень:

A. Dynamic Cognitive Budget
Router решает:


сколько context tokens тратить;


сколько retrieval memories inject;


нужен ли expensive reasoning.



B. Adaptive Retrieval
Разные retrieval strategies:


skills-first


failures-first


recent-first


domain-local



C. Multi-Agent Routing
Router может делегировать:


debugger-agent


planner-agent


tool-agent


retrieval-agent



D. Constitutional Enforcement
Router применяет:


NORA Constitution;


anti-pattern laws;


safety constraints.



14. Самая важная идея
Router — это НЕ:
intent classifier
Router — это:
cognitive operating system
Он управляет:


memory,


reasoning,


tools,


safety,


uncertainty,


cognition trajectories.


Именно Router делает из:
LLM + vector DB
→
agent architecture