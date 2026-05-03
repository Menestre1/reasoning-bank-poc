#!/usr/bin/env npx tsx
import { LirAgent } from './src/LirAgent.js';
import { ask } from './src/tools/ToolExecutor.js';

const PROMPTS = {
  help: `
🤖 Агент Лирь — с авто-опросом после ответа
==================================================

📋 Как это работает:
  1. Вы задаёте вопрос
  2. Агент отвечает и спрашивает: "Я справился? (да/нет)"
  3. Если "да" — счётчик успехов +1
  4. Если "нет" — выбираете тип ошибки:
     1 — эхолалия (повторение)
     2 — парафазия (искажение терминов)
     3 — контаминация (смешивание)
     4 — галлюцинация (выдумки)

📋 Дополнительные команды:
  • /tools             — список всех инструментов
  • /stats             — показать статистику памяти
  • /model             — сменить модель Ollama
  • /models            — список доступных моделей
  • /lang              — выбрать язык программирования
  • /exit или Ctrl+C   — выход`,

  langChoice: `
1. 📦 1С (BSL)
2. 🟨 JavaScript
3. 💙 TypeScript
4. 🐍 Python
5. 🔵 Go
6. 📄 Общий`,
};

async function main() {
  console.log('==================================================');
  console.log('🤖 Агент Лирь — с авто-опросом после ответа');
  console.log('==================================================\n');

  const agent = new LirAgent({
    dbPath: './agentdb.db',
    agentId: 'lir',
    systemPrompt: `Ты — агент Лирь, специалист по 1С:Предприятие.
Ты помогаешь анализировать конфигурации 1С, искать проблемы в коде и оптимизировать работу.
Отвечай кратко, по делу, на русском языке.`,
  });

  await agent.seedTools();

  // Model selection
  const availableModels = await agent.getAvailableModels();
  if (availableModels.length >0) {
    console.log('\n📋 Доступные модели Ollama:');
    availableModels.forEach((m, i) => {
      const current = m.name === agent.getCurrentModel() ? ' (текущая)' : '';
      console.log(`  ${i + 1}. ${m.name}${current}`);
    });

    // Auto-select or ask user
    const defaultModel = 'gemma4:26b-a4b-it-q4_K_M';
    let selectedModel = availableModels.find(m => m.name === defaultModel) ? defaultModel : availableModels[0].name;
    
    // Try to switch to default model
    try {
      await agent.setModel(selectedModel);
      console.log(`\n🤖 Выбрана модель: ${selectedModel}`);
    } catch (err: any) {
      console.log(`\n⚠️ Не удалось установить модель ${selectedModel}, используем текущую: ${agent.getCurrentModel()}`);
    }
  } else {
    console.log('\n⚠️ Нет доступных моделей Ollama');
  }

  console.log('🎮 Начинаем диалог...\n');

  // Get user input function
  const getInput = async (): Promise<string> => {
    return new Promise((resolve) => {
      process.stdin.once('data', (data) => {
        resolve(data.toString().trim());
      });
    });
  };

  while (true) {
    process.stdout.write('\n💬 Вы: ');
    const input = await getInput();
    const trimmed = input.trim();

    if (!trimmed) continue;
    if (trimmed === '/exit') break;

    if (trimmed === '/help') {
      console.log(PROMPTS.help);
      continue;
    }

    if (trimmed === '/models') {
      const models = await agent.getAvailableModels();
      console.log('\n📋 Доступные модели:');
      models.forEach((m, i) => {
        const current = m.name === agent.getCurrentModel() ? ' (текущая)' : '';
        console.log(`  ${i + 1}. ${m.name}${current}`);
      });
      continue;
    }

    if (trimmed.startsWith('/model ')) {
      const modelName = trimmed.slice(7).trim();
      try {
        await agent.setModel(modelName);
        console.log(`\n✅ Модель изменена на: ${modelName}`);
      } catch (err: any) {
        console.error(`\n❌ Ошибка: ${err.message}`);
      }
      continue;
    }

    try {
      const result = await agent.processMessage(trimmed);
      
      if (result.action === 'ask_language') {
        console.log(`\n🤖 Лирь: ${result.languageQuestion}`);
        continue;
      }

      if (result.action === 'waiting_feedback') {
        console.log(`\n🤖 Лирь: ${result.response}`);
        continue;
      }

      if (result.action === 'record_success') {
        console.log(`\n🤖 Лирь: ${result.response}`);
        continue;
      }

      if (result.action === 'learn_error') {
        console.log(`\n⚠️ ${result.response}`);
        continue;
      }

      // Normal response
      console.log(`\n🤖 Лирь: ${result.response}`);

      if (result.warnings && result.warnings.length > 0) {
        console.log('\n⚠️ ПРЕДУПРЕЖДЕНИЯ:');
        for (const w of result.warnings) {
          console.log(`  • ${w.error_type}: ${w.advice}`);
        }
      }
    } catch (err: any) {
      console.error('Ошибка:', err.message);
    }
  }

  await agent.close();
  console.log('\nДо свидания!');
  process.exit(0);
}

main().catch(err => {
  console.error('Фатальная ошибка:', err);
  process.exit(1);
});
