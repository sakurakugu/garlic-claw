import * as path from 'node:path';
import * as os from 'node:os';

// ─── 内联：从 tool-output-capture.service.ts 对齐 ───

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

interface ToolOutputCaptureResult {
  fullOutputPath: string;
  outputPath: string;
}

function shouldCaptureToolOutput(outputText: string, maxBytes: number): boolean {
  return maxBytes > 0 && Buffer.byteLength(outputText, 'utf8') > maxBytes;
}

function createToolOutputCaptureFileName(toolName: string, extension: string): string {
  const normalizedToolName = toolName.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'tool';
  return `${normalizedToolName}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${extension}`;
}

function readToolOutputCaptureExtension(output: unknown): 'json' | 'txt' {
  return typeof output === 'string' ? 'txt' : 'json';
}

function renderToolOutputCaptureText(output: unknown): string {
  if (typeof output === 'string') {
    return output;
  }
  return JSON.stringify(sanitizeToolOutputCaptureValue(output), null, 2);
}

function sanitizeToolOutputCaptureValue(value: unknown): JsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : String(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeToolOutputCaptureValue(entry));
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).flatMap(([key, entryValue]) => (
        entryValue === undefined ? [] : [[key, sanitizeToolOutputCaptureValue(entryValue)]]
      )),
    ) as JsonValue;
  }
  return String(value);
}

// ─── ToolOutputCaptureService（内联，带 mock 依赖） ───

const TOOL_OUTPUT_CAPTURE_DIRECTORY = '.garlic-claw/tool-output';

class ToolOutputCaptureService {
  constructor(
    private readonly deps: {
      getSessionEnvironment: (sessionId: string) => Promise<{ sessionRoot: string; visibleRoot: string }>;
      readToolOutputCaptureOptions: () => { enabled: boolean; maxBytes: number; maxFilesPerSession: number };
      joinVisiblePath: (visibleRoot: string, relativePath: string) => string;
      mkdir: (dir: string) => Promise<void>;
      readdir: (dir: string) => Promise<string[]>;
      stat: (filePath: string) => Promise<{ mtimeMs: number }>;
      rm: (filePath: string) => Promise<void>;
      writeFile: (filePath: string, content: string) => Promise<void>;
    },
  ) {}

  async captureIfNeeded(input: {
    output: unknown;
    outputText: string;
    sessionId?: string;
    toolName: string;
  }): Promise<ToolOutputCaptureResult | null> {
    const sessionId = typeof input.sessionId === 'string' ? input.sessionId.trim() : '';
    const options = this.deps.readToolOutputCaptureOptions();
    if (!options.enabled || !sessionId || !shouldCaptureToolOutput(input.outputText, options.maxBytes)) {
      return null;
    }
    const sessionEnvironment = await this.deps.getSessionEnvironment(sessionId);
    const extension = readToolOutputCaptureExtension(input.output);
    const relativePath = `${TOOL_OUTPUT_CAPTURE_DIRECTORY}/${createToolOutputCaptureFileName(input.toolName, extension)}`;
    const hostPath = path.join(
      sessionEnvironment.sessionRoot,
      ...relativePath.split('/'),
    );
    await this.deps.mkdir(path.dirname(hostPath));
    await this.deps.writeFile(hostPath, input.outputText);
    return {
      fullOutputPath: hostPath,
      outputPath: this.deps.joinVisiblePath(sessionEnvironment.visibleRoot, relativePath),
    };
  }
}

// ─── 测试 ───

describe('tool-output-capture: shouldCaptureToolOutput', () => {
  it('returns true when output exceeds maxBytes', () => {
    expect(shouldCaptureToolOutput('hello world', 5)).toBe(true);
  });

  it('returns false when output is within maxBytes', () => {
    expect(shouldCaptureToolOutput('hello', 100)).toBe(false);
  });

  it('returns false when maxBytes is 0', () => {
    expect(shouldCaptureToolOutput('hello world', 0)).toBe(false);
  });

  it('returns false when maxBytes is negative', () => {
    expect(shouldCaptureToolOutput('hello world', -1)).toBe(false);
  });

  it('handles empty string', () => {
    expect(shouldCaptureToolOutput('', 10)).toBe(false);
    expect(shouldCaptureToolOutput('', 0)).toBe(false);
  });

  it('handles multi-byte characters correctly', () => {
    const chineseText = '你好世界';
    expect(shouldCaptureToolOutput(chineseText, 10)).toBe(false);
    expect(shouldCaptureToolOutput(chineseText, 8)).toBe(true);
  });
});

describe('tool-output-capture: readToolOutputCaptureExtension', () => {
  it('returns txt for string output', () => {
    expect(readToolOutputCaptureExtension('some text')).toBe('txt');
  });

  it('returns json for non-string output', () => {
    expect(readToolOutputCaptureExtension({ key: 'value' })).toBe('json');
    expect(readToolOutputCaptureExtension(42)).toBe('json');
    expect(readToolOutputCaptureExtension(null)).toBe('json');
    expect(readToolOutputCaptureExtension([1, 2, 3])).toBe('json');
    expect(readToolOutputCaptureExtension(true)).toBe('json');
    expect(readToolOutputCaptureExtension(undefined)).toBe('json');
  });
});

describe('tool-output-capture: sanitizeToolOutputCaptureValue', () => {
  it('passes through null, boolean, string', () => {
    expect(sanitizeToolOutputCaptureValue(null)).toBe(null);
    expect(sanitizeToolOutputCaptureValue(true)).toBe(true);
    expect(sanitizeToolOutputCaptureValue(false)).toBe(false);
    expect(sanitizeToolOutputCaptureValue('text')).toBe('text');
  });

  it('passes through finite numbers, converts non-finite to string', () => {
    expect(sanitizeToolOutputCaptureValue(42)).toBe(42);
    expect(sanitizeToolOutputCaptureValue(0)).toBe(0);
    expect(sanitizeToolOutputCaptureValue(-1.5)).toBe(-1.5);
    expect(sanitizeToolOutputCaptureValue(NaN)).toBe('NaN');
    expect(sanitizeToolOutputCaptureValue(Infinity)).toBe('Infinity');
    expect(sanitizeToolOutputCaptureValue(-Infinity)).toBe('-Infinity');
  });

  it('recursively sanitizes arrays', () => {
    expect(sanitizeToolOutputCaptureValue([1, 'two', true, null])).toEqual([1, 'two', true, null]);
  });

  it('removes undefined values from objects', () => {
    const result = sanitizeToolOutputCaptureValue({ a: 1, b: undefined, c: 'hello' });
    expect(result).toEqual({ a: 1, c: 'hello' });
    expect('b' in (result as Record<string, unknown>)).toBe(false);
  });

  it('recursively sanitizes nested objects', () => {
    const input = { outer: { inner: { value: 42, bad: null }, list: [1, NaN, 'x'] } };
    const expected = { outer: { inner: { value: 42, bad: null }, list: [1, 'NaN', 'x'] } };
    expect(sanitizeToolOutputCaptureValue(input)).toEqual(expected);
  });

  it('converts non-standard types to string', () => {
    expect(sanitizeToolOutputCaptureValue(new Date(0))).toContain('1970');
    expect(sanitizeToolOutputCaptureValue(Symbol('sym'))).toBe('Symbol(sym)');
  });
});

describe('tool-output-capture: renderToolOutputCaptureText', () => {
  it('returns string as-is', () => {
    expect(renderToolOutputCaptureText('hello')).toBe('hello');
  });

  it('pretty-prints JSON for non-string values', () => {
    const result = renderToolOutputCaptureText({ a: 1, b: [2, 3] });
    expect(result).toBe('{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ]\n}');
  });

  it('handles null', () => {
    expect(renderToolOutputCaptureText(null)).toBe('null');
  });
});

describe('tool-output-capture: createToolOutputCaptureFileName', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-14T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('generates file name with tool name and extension', () => {
    const name = createToolOutputCaptureFileName('read_file', 'txt');
    expect(name).toMatch(/^read_file-\d+-[a-z0-9]{8}\.txt$/);
    expect(name).toContain('1749898800000');
  });

  it('normalizes invalid characters in tool name', () => {
    const name = createToolOutputCaptureFileName('my tool@name!', 'json');
    expect(name).toMatch(/^my-tool-name-\d+-[a-z0-9]{8}\.json$/);
  });

  it('collapses multiple dashes', () => {
    const name = createToolOutputCaptureFileName('a---b___c', 'txt');
    expect(name).toMatch(/^a-b___c-\d+-[a-z0-9]{8}\.txt$/);
  });

  it('uses fallback name when tool name is empty after sanitization', () => {
    const name = createToolOutputCaptureFileName('!!!', 'txt');
    expect(name).toMatch(/^tool-\d+-[a-z0-9]{8}\.txt$/);
  });

  it('trims tool name', () => {
    const name = createToolOutputCaptureFileName('  grep  ', 'txt');
    expect(name).toMatch(/^grep-\d+-[a-z0-9]{8}\.txt$/);
  });

  it('strips leading and trailing dashes', () => {
    const name = createToolOutputCaptureFileName('-tool-', 'json');
    expect(name).toMatch(/^tool-\d+-[a-z0-9]{8}\.json$/);
  });
});

describe('tool-output-capture: ToolOutputCaptureService', () => {
  const createDeps = (overrides: Partial<ReturnType<typeof createDeps>> = {}) => {
    let files = new Map<string, { content: string; mtimeMs: number }>();
    const tmpDir = os.tmpdir();
    return {
      getSessionEnvironment: vi.fn().mockResolvedValue({ sessionRoot: tmpDir, visibleRoot: '/visible' }),
      readToolOutputCaptureOptions: vi.fn().mockReturnValue({ enabled: true, maxBytes: 10, maxFilesPerSession: 5 }),
      joinVisiblePath: vi.fn().mockImplementation((vr: string, rp: string) => `${vr}/${rp}`),
      mkdir: vi.fn().mockResolvedValue(undefined),
      readdir: vi.fn().mockResolvedValue([] as string[]),
      stat: vi.fn().mockResolvedValue({ mtimeMs: 1000 }),
      rm: vi.fn().mockResolvedValue(undefined),
      writeFile: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    };
  };

  it('returns null when capture is disabled', async () => {
    const deps = createDeps({ readToolOutputCaptureOptions: vi.fn().mockReturnValue({ enabled: false, maxBytes: 10, maxFilesPerSession: 5 }) });
    const svc = new ToolOutputCaptureService(deps);
    const result = await svc.captureIfNeeded({ output: 'hello', outputText: 'hello', sessionId: 's1', toolName: 'test' });
    expect(result).toBeNull();
    expect(deps.writeFile).not.toHaveBeenCalled();
  });

  it('returns null when sessionId is empty', async () => {
    const deps = createDeps();
    const svc = new ToolOutputCaptureService(deps);
    const result = await svc.captureIfNeeded({ output: 'hello', outputText: 'hello', sessionId: '', toolName: 'test' });
    expect(result).toBeNull();
  });

  it('returns null when output is within maxBytes', async () => {
    const deps = createDeps({ readToolOutputCaptureOptions: vi.fn().mockReturnValue({ enabled: true, maxBytes: 100, maxFilesPerSession: 5 }) });
    const svc = new ToolOutputCaptureService(deps);
    const result = await svc.captureIfNeeded({ output: 'short', outputText: 'short', sessionId: 's1', toolName: 'test' });
    expect(result).toBeNull();
  });

  it('captures large output and returns paths', async () => {
    const tmpDir = os.tmpdir();
    const deps = createDeps({ getSessionEnvironment: vi.fn().mockResolvedValue({ sessionRoot: tmpDir, visibleRoot: '/visible' }) });
    const svc = new ToolOutputCaptureService(deps);
    const result = await svc.captureIfNeeded({
      output: { data: 'x'.repeat(100) },
      outputText: JSON.stringify({ data: 'x'.repeat(100) }),
      sessionId: 's1',
      toolName: 'fetch_data',
    });
    expect(result).not.toBeNull();
    expect(result!.fullOutputPath).toContain(tmpDir);
    expect(result!.fullOutputPath).toContain('.garlic-claw/tool-output');
    expect(result!.outputPath).toContain('/visible/.garlic-claw/tool-output');
    expect(deps.mkdir).toHaveBeenCalled();
    expect(deps.writeFile).toHaveBeenCalled();
  });

  it('trims whitespace from sessionId', async () => {
    const deps = createDeps();
    const svc = new ToolOutputCaptureService(deps);
    const result = await svc.captureIfNeeded({ output: 'x'.repeat(100), outputText: 'x'.repeat(100), sessionId: '  s1  ', toolName: 'test' });
    expect(result).not.toBeNull();
  });

  it('returns null when sessionId is whitespace-only after trim', async () => {
    const deps = createDeps();
    const svc = new ToolOutputCaptureService(deps);
    const result = await svc.captureIfNeeded({ output: 'x'.repeat(100), outputText: 'x'.repeat(100), sessionId: '   ', toolName: 'test' });
    expect(result).toBeNull();
  });

  it('uses txt extension for string output', async () => {
    const deps = createDeps();
    const svc = new ToolOutputCaptureService(deps);
    const result = await svc.captureIfNeeded({ output: 'large text output', outputText: 'large text output', sessionId: 's1', toolName: 'echo' });
    expect(result!.fullOutputPath).toMatch(/\.txt$/);
  });

  it('uses json extension for object output', async () => {
    const deps = createDeps();
    const svc = new ToolOutputCaptureService(deps);
    const result = await svc.captureIfNeeded({ output: { large: true }, outputText: '{"large":true}', sessionId: 's1', toolName: 'json_tool' });
    expect(result!.fullOutputPath).toMatch(/\.json$/);
  });
});
