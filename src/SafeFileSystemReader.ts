import * as fs from 'fs/promises';
import * as path from 'path';

export class SafeFileSystemReader {
  private allowedRoots: string[];

  constructor(allowedRoots: string[] = [process.cwd()]) {
    this.allowedRoots = allowedRoots.map(r => path.resolve(r));
  }

  private isPathAllowed(targetPath: string): boolean {
    const resolved = path.resolve(targetPath);
    return this.allowedRoots.some(root => resolved.startsWith(root));
  }

  async ensureAllowed(targetPath: string): Promise<void> {
    if (!this.isPathAllowed(targetPath)) {
      throw new Error(`Access denied: ${targetPath} is not within allowed roots (${this.allowedRoots.join(', ')})`);
    }
  }

  async readFile(filePath: string, encoding: BufferEncoding = 'utf8'): Promise<string> {
    await this.ensureAllowed(filePath);
    return fs.readFile(filePath, encoding);
  }

  async readDirectory(dirPath: string): Promise<{ name: string; isDirectory: boolean; fullPath: string }[]> {
    await this.ensureAllowed(dirPath);
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries.map(entry => ({
      name: entry.name,
      isDirectory: entry.isDirectory(),
      fullPath: path.join(dirPath, entry.name),
    }));
  }

  async exists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async walkXmlFiles(rootDir: string): Promise<string[]> {
    await this.ensureAllowed(rootDir);
    const xmlFiles: string[] = [];
    const stack = [rootDir];
    while (stack.length) {
      const current = stack.pop()!;
      const entries = await this.readDirectory(current);
      for (const entry of entries) {
        if (entry.isDirectory) {
          stack.push(entry.fullPath);
        } else if (entry.name.endsWith('.xml') && !entry.name.includes('Form')) {
          xmlFiles.push(entry.fullPath);
        }
      }
    }
    return xmlFiles;
  }
}
