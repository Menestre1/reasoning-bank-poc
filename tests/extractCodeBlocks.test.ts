import { describe, it, expect } from 'vitest';

// extractCodeBlocks is private in LirAgent; test the logic directly
function extractCodeBlocks(text: string): { code: string; language?: string }[] {
  const regex = /```(\w*)\n([\s\S]*?)```/g;
  const blocks: { code: string; language?: string }[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const lang = match[1] || undefined;
    const code = match[2]!.trim();
    if (code) blocks.push({ code, language: lang });
  }
  return blocks;
}

describe('extractCodeBlocks', () => {
  it('should extract a single code block with language', () => {
    const text = 'Some text\n```javascript\nconsole.log("hello");\n```\nmore text';
    const blocks = extractCodeBlocks(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].code).toBe('console.log("hello");');
    expect(blocks[0].language).toBe('javascript');
  });

  it('should extract a code block without language', () => {
    const text = '```\nplain code here\n```';
    const blocks = extractCodeBlocks(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].code).toBe('plain code here');
    expect(blocks[0].language).toBeUndefined();
  });

  it('should extract multiple code blocks', () => {
    const text = '```python\nprint(1)\n```\n...\n```ts\nconst x = 1;\n```';
    const blocks = extractCodeBlocks(text);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].language).toBe('python');
    expect(blocks[1].language).toBe('ts');
  });

  it('should skip empty code blocks', () => {
    const text = '```\n\n```';
    const blocks = extractCodeBlocks(text);
    expect(blocks).toHaveLength(0);
  });

  it('should return empty array if no code blocks', () => {
    const text = 'Just some text without code blocks';
    const blocks = extractCodeBlocks(text);
    expect(blocks).toHaveLength(0);
  });
});
