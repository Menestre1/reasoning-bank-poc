#!/usr/bin/env npx tsx
import { LirAgent } from './src/LirAgent.js';
import { ask } from './src/tools/ToolExecutor.js';
import * as readline from 'readline';
import * as fs from 'fs';

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

  📋 Ввод:
  • одна строка — Enter отправляет сразу (для команд /...)
  • много строк — вводите текст построчно, затем отправьте сигналом
  • сигнал отправки: \`Пуск!\`, /send или !go отдельной строкой
  • отмена: /cancel или \`отмена\` отдельной строкой
  • вставка из буфера обмена работает для многострочного текста

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
  const useStreaming = process.argv.includes('--stream');

  console.log('==================================================');
  console.log(`🤖 Агент Лирь — с авто-опросом после ответа${useStreaming ? ' (streaming)' : ''}`);
  console.log('==================================================\n');

  let systemPrompt: string;
  try {
    systemPrompt = fs.readFileSync('docs/production-grade_system_prompt.md', 'utf8');
  } catch {
    console.error('\n❌ Файл docs/production-grade_system_prompt.md не найден.');
    console.error('   Убедитесь, что репозиторий клонирован полностью или файл существует.');
    process.exit(1);
  }
  console.log(`📄 System prompt loaded (${systemPrompt.length} bytes)`);

  const agent = new LirAgent({
    dbPath: './agentdb.db',
    agentId: 'lir',
    systemPrompt,
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

  console.log('🎮 Начинаем диалог... (Пуск! /send !go — отправить, /cancel отмена)\n');

  // Multi-line input via readline
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const SEND_SIGNALS = ['пуск!', '/send', '!go'];
  const CANCEL_SIGNALS = ['/cancel', 'отмена'];

  const getMultilineInput = (prompt: string): Promise<string> => {
    return new Promise((resolve) => {
      const lines: string[] = [];
      process.stdout.write(prompt);

      const handler = (line: string) => {
        const trimmed = line.trim();
        const lower = trimmed.toLowerCase();

        // Commands: send immediately on first line only
        if (lines.length === 0 && line.startsWith('/') && !SEND_SIGNALS.includes(lower) && !CANCEL_SIGNALS.includes(lower)) {
          rl.off('line', handler);
          resolve(line);
          return;
        }

        // Cancel: discard buffer and return empty
        if (CANCEL_SIGNALS.includes(lower) && lines.length > 0) {
          rl.off('line', handler);
          console.log('  (отменено)');
          resolve('');
          return;
        }

        // Send signals: flush buffer (excluding the signal itself)
        if (SEND_SIGNALS.includes(lower)) {
          rl.off('line', handler);
          resolve(lines.join('\n'));
          return;
        }

        lines.push(line);
        if (lines.length === 1) {
          console.log('  (multi-line, type Пуск! to send)');
        }
        process.stdout.write('  > ');
      };

      rl.on('line', handler);
    });
  };

  while (true) {
    const input = await getMultilineInput('\n💬 Вы:\n  > ');
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
      let result;

      if (useStreaming) {
        console.log('\n' + '='.repeat(45));
        process.stdout.write('🤖 Лирь: ⏳');
        let isFirstChunk = true;
        result = await agent.processMessageStream(trimmed, (chunk) => {
          if (isFirstChunk) {
            process.stdout.write('\b \b'); // clear the ⏳
            isFirstChunk = false;
          }
          process.stdout.write(chunk);
        });
        if (isFirstChunk) {
          process.stdout.write('\b \b'); // clear the ⏳ (no streaming output)
        }
        process.stdout.write('\n');
      } else {
        result = await agent.processMessage(trimmed);
      }

      if (result.action === 'ask_language') {
        console.log(`\n🤖 Лирь: ${result.languageQuestion}`);
        continue;
      }

      if (result.action === 'waiting_feedback') {
        // LLM response was streamed; the question was appended via onChunk
        if (!useStreaming) {
          console.log(`\n🤖 Лирь: ${result.response}`);
        }
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

      // Normal response — already printed in streaming mode
      if (!useStreaming) {
        console.log(`\n🤖 Лирь: ${result.response}`);
      } else if (result.action === 'respond' && result.response) {
        console.log(`🤖 Лирь: ${result.response}`);
      }

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

  rl.close();
  await agent.close();
  console.log('\nДо свидания!');
  process.exit(0);
}

main().catch(err => {
  console.error('Фатальная ошибка:', err);
  process.exit(1);
});
