import { ConfigStorage } from './ConfigStorage.js';
import { DependencyGraph } from './DependencyGraph.js';

export class DependencyParser {
  private storage: ConfigStorage;
  private graph: DependencyGraph;
  private objectName: string = '';

  constructor(storage: ConfigStorage, graph: DependencyGraph) {
    this.storage = storage;
    this.graph = graph;
  }

  async buildGraphFromConfig(): Promise<{ processed: number; edges: number; errors: string[] }> {
    const db = this.storage['db']; // Access underlying DB
    const rows = db.prepare(`
      SELECT c.id, c.object_type, c.name, c.module_full
      FROM config_objects c
      WHERE c.module_full IS NOT NULL AND c.module_full != ''
    `).all() as any[];

    let processed = 0;
    let totalEdges = 0;
    const errors: string[] = [];

    for (const row of rows) {
      try {
        this.objectName = `${row.object_type}.${row.name}`;
        const edges = this.parseModule(row.module_full || '');
        
        for (const edge of edges) {
          await this.graph.addDependency({
             sourceId: row.id,
             sourceObject: this.objectName,
             sourceMethod: edge.sourceMethod || '',
             targetObject: edge.targetObject,
             targetMethod: edge.targetMethod || '',
            callType: edge.callType,
          });
          totalEdges++;
        }
        processed++;
      } catch (err: any) {
        errors.push(`${this.objectName}: ${err.message}`);
      }
    }

    return { processed, edges: totalEdges, errors };
  }

  private parseModule(moduleText: string): {
    sourceMethod?: string;
    targetObject: string;
    targetMethod?: string;
    callType: 'procedure' | 'function' | 'unknown';
  }[] {
    const edges: any[] = [];
    const lines = moduleText.split('\n');
    let currentProcedure: string | undefined;

    // First pass: find all procedure/function definitions
    const procedureRegex = /^(Процедура|Функция)\s+(\w+)/i;
    const callRegex = /(\w+)\.(\w+)\s*\(/g;
    const simpleCallRegex = /(?:Вызвать|Call)\s+(\w+)\s*\(/gi;

    for (const line of lines) {
      const procMatch = line.match(procedureRegex);
      if (procMatch) {
        currentProcedure = procMatch[2];
        continue;
      }

      // Skip comments
      if (line.trim().startsWith('//') || line.trim().startsWith('/*')) {
        continue;
      }

      // Match ObjectName.MethodName( pattern
      let match;
      const regexCopy = new RegExp(callRegex.source, 'g');
      while ((match = regexCopy.exec(line)) !== null) {
        const targetObject = match[1];
        const targetMethod = match[2];
        
        // Skip if it's a reference to itself
        if (targetObject === this.objectName.split('.').pop()) continue;

        edges.push({
          sourceMethod: currentProcedure,
          targetObject,
          targetMethod,
          callType: 'procedure' as const,
        });
      }

      // Match simple calls
      while ((match = simpleCallRegex.exec(line)) !== null) {
        edges.push({
          sourceMethod: currentProcedure,
          targetObject: match[1],
          targetMethod: undefined,
          callType: 'procedure' as const,
        });
      }
    }

    return edges;
  }

  async findCycles(): Promise<string[][]> {
    // Simple cycle detection using DFS
    const db = this.storage['db'];
    const edges = db.prepare(`
      SELECT source_object, target_object
      FROM dependencies
      GROUP BY source_object, target_object
    `).all() as any[];

    const graph: Record<string, string[]> = {};
    for (const edge of edges) {
      const src = edge.source_object;
      const tgt = edge.target_object;
      if (!src || !tgt) continue;
      if (!graph[src]) graph[src] = [];
      graph[src].push(tgt);
    }

    const visited = new Set<string>();
    const recStack = new Set<string>();
    const cycles: string[][] = [];

    const dfs = (node: string, path: string[]): boolean => {
      visited.add(node);
      recStack.add(node);
      path.push(node);

      const neighbors = graph[node] || [];
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          if (dfs(neighbor, path)) return true;
        } else if (recStack.has(neighbor)) {
          // Found cycle
          const cycleStart = path.indexOf(neighbor);
          cycles.push(path.slice(cycleStart));
          return true;
        }
      }

      path.pop();
      recStack.delete(node);
      return false;
    };

    for (const node of Object.keys(graph)) {
      if (!visited.has(node)) {
        dfs(node, []);
      }
    }

    return cycles;
  }
}
