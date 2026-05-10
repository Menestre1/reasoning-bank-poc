Проект разработан в рамках публикации на ![Логотип Инфостарт](https://infostart.ru/bitrix/templates/sandbox_empty/assets/tpl/abo/img/logo.svg)

Ссылка на публикацию
[https://infostart.ru/1c/reports/2508153/](https://infostart.ru/1c/articles/2683130/)

# ReasoningBank PoC — Семантическая память для Lir Agent

LLM-агент «Лирь» с семантической памятью, системой навыков, анти-паттернами и анализом 1С-конфигураций.

**Полная техническая документация**: `docs/LirAgent-Technical-Documentation.md`

---

## Быстрый старт

```bash
# Node.js 20+
npm install

# Запуск чата
npx tsx chat.ts

# Потоковый режим
npx tsx chat.ts --stream
```

---

## Основные команды

| Команда | Действие |
|---------|----------|
| `/help` | Справка |
| `/models` | Список моделей Ollama |
| `/model <имя>` | Сменить модель |
| `/stats` | Статистика памяти |
| `/learn` | Сохранить диалог как навык |
| `/load-config <путь>` | Загрузить 1С-конфигурацию |
| `/search-code <запрос>` | Поиск по объектам конфигурации |
| `/next` | Очистить память пациента |
| `/exit` | Выход |

**Фидбек**: `да` / `нет` / `нет, <пояснение>` / `отмена`

**Многострочный ввод**: `Пуск!` / `!go` — отправить, `/cancel` — отмена

---

## Ключевые возможности

- **ReasoningBank** — семантическая память (HNSW, scoring, TTL, skills)
- **Patient Knowledge Base** — код пациента сохраняется в `patient_kb.db`, доступен в контексте LLM и поиске
- **ConfigLoader** — загрузка 1С-конфигураций (XML + BSL из Ext/ и Forms/)
- **FTS5-поиск** — по загруженным конфигурациям с LIKE-fallback
- **Анти-паттерны** — эхолалия, парафазия, контаминация, галлюцинация
- **Production-grade system prompt** — загружается из `docs/production-grade_system_prompt.md`
- **Streaming** — `--stream`, многострочный ввод, визуальные разделители

---

## Архитектура

```
Пользователь → LirAgent.processMessage()
   │
   ├─ Проверка команд, фидбека, языка
   ├─ Сохранение кода в PatientKB
   ├─ recommendWithWarnings() → LLM
   └─ Ответ + "Я справился?"
```

**Компоненты**: `ReasoningBankSemantic`, `PatientKnowledgeBase`, `ConfigStorage`, `ConfigLoader`, `OllamaClient`, `HNSWBackend`, `LRUCache`, `ToolIntegration`

Подробная архитектура и модель данных — в `docs/LirAgent-Technical-Documentation.md`.

---

## Документация

| Файл | Описание |
|------|----------|
| `docs/LirAgent-Technical-Documentation.md` | **Полная техническая документация** |
| `docs/production-grade_system_prompt.md` | System Prompt агента |
| `docs/MainArchitecture21.md` | 44 правила архитектуры L0–L7 |
| `docs/Formal_NORA_constitution.md` | Конституция NORA |
| `docs/NORA_*` | NORA: Router, DSL, Trajectory, Checkpoint, ARR, REPAIR, Cat/Seed, DEG, FSM |

---

## Лицензия

ISC
