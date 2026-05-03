import { diffLines, type Change } from 'diff';

export interface ModuleDiff {
  oldModule: string;
  newModule: string;
  changes: Change[];
  summary: string;
}

export class DiffEngine {
  constructor() {}

  compareModules(oldModule: string, newModule: string): ModuleDiff {
    const changes = diffLines(oldModule, newModule);
    
    let added = 0;
    let removed = 0;
    let unchanged = 0;

    for (const change of changes) {
      if (change.added) added += change.count || change.value.split('\n').length;
      else if (change.removed) removed += change.count || change.value.split('\n').length;
      else unchanged += change.count || change.value.split('\n').length;
    }

    const summary = `Изменения: +${added} строк, -${removed} строк, без изменений: ${unchanged}`;
    
    return {
      oldModule,
      newModule,
      changes,
      summary,
    };
  }

  formatDiffForDisplay(diff: ModuleDiff, contextLines = 3): string {
    let result = '';
    let lineOld = 0;
    let lineNew = 0;

    for (const change of diff.changes) {
      const lines = change.value.split('\n').filter(l => l !== '');

      if (change.added) {
        for (const line of lines) {
          result += `+ ${String(++lineNew).padStart(4)}: ${line}\n`;
        }
      } else if (change.removed) {
        for (const line of lines) {
          result += `- ${String(++lineOld).padStart(4)}: ${line}\n`;
        }
      } else {
        for (const line of lines) {
          lineOld++;
          lineNew++;
          result += `  ${String(lineNew).padStart(4)}: ${line}\n`;
        }
      }
    }

    return result || '(модули идентичны)';
  }
}
