import { describe, it, expect, vi } from 'vitest';

// --- 内联实现: 对齐 packages/server/src/modules/execution/webfetch/webfetch-tool.service.ts ---

interface WebFetchResult {
  contentType: string;
  format: 'text' | 'markdown' | 'html';
  output: string;
  status: number;
  title: string;
  url: string;
}

interface WebFetchInput {
  url: string;
  format?: 'text' | 'markdown' | 'html';
  timeout?: number;
}

class WebFetchServiceMock {
  async fetch(input: WebFetchInput): Promise<WebFetchResult> {
    return {
      contentType: 'text/html',
      format: input.format ?? 'markdown',
      output: '<h1>Mock Output</h1>',
      status: 200,
      title: 'Mock Title',
      url: input.url,
    };
  }
}

const WEBFETCH_TOOL_PARAMETERS = {
  url: {
    description: '要抓取的 http 或 https 地址。',
    required: true,
    type: 'string',
  },
  format: {
    description: '返回格式，可选 text / markdown / html，默认 markdown。',
    required: false,
    type: 'string',
  },
  timeout: {
    description: '可选超时时间，单位秒，最大 120。',
    required: false,
    type: 'number',
  },
};

class WebFetchToolService {
  constructor(private readonly webFetchService: WebFetchServiceMock) {}

  getToolName(): string {
    return 'webfetch';
  }

  buildToolDescription(): string {
    return [
      '抓取远端页面或文本资源，并把内容转换成稳定文本返回。',
      '默认输出 markdown，可选 text 或 html。',
      '只支持 http / https。',
      '当前大小限制为 5MB，默认超时 30 秒。',
    ].join('\n');
  }

  getToolParameters() {
    return WEBFETCH_TOOL_PARAMETERS;
  }

  async fetch(input: WebFetchInput): Promise<WebFetchResult> {
    return this.webFetchService.fetch(input);
  }

  toModelOutput(output: unknown) {
    return {
      type: 'text',
      value: renderWebFetchModelOutput(output as WebFetchResult),
    };
  }
}

function renderWebFetchModelOutput(result: WebFetchResult): string {
  return [
    '<webfetch_result>',
    `URL: ${result.url}`,
    `Title: ${result.title}`,
    `Status: ${result.status}`,
    `Content-Type: ${result.contentType || 'unknown'}`,
    `Format: ${result.format}`,
    '',
    result.output,
    '</webfetch_result>',
  ].join('\n');
}

// --- 测试 ---

describe('WebFetchToolService', () => {
  let mockService: WebFetchServiceMock;

  beforeEach(() => {
    mockService = new WebFetchServiceMock();
  });

  describe('getToolName', () => {
    it('返回 webfetch', () => {
      const service = new WebFetchToolService(mockService);
      expect(service.getToolName()).toBe('webfetch');
    });
  });

  describe('buildToolDescription', () => {
    it('返回包含关键信息的字串', () => {
      const service = new WebFetchToolService(mockService);
      const desc = service.buildToolDescription();
      expect(typeof desc).toBe('string');
      expect(desc).toContain('抓取远端页面');
      expect(desc).toContain('markdown');
      expect(desc).toContain('5MB');
      expect(desc).toContain('30 秒');
      expect(desc).toContain('http / https');
    });

    it('描述按换行符分隔为 4 行', () => {
      const service = new WebFetchToolService(mockService);
      expect(service.buildToolDescription().split('\n')).toHaveLength(4);
    });
  });

  describe('getToolParameters', () => {
    it('返回包含 url/format/timeout 三个参数', () => {
      const service = new WebFetchToolService(mockService);
      const params = service.getToolParameters();
      expect(Object.keys(params)).toEqual(['url', 'format', 'timeout']);
    });

    it('url 为必需字符串', () => {
      const service = new WebFetchToolService(mockService);
      const params = service.getToolParameters();
      expect(params.url).toEqual({
        description: expect.any(String),
        required: true,
        type: 'string',
      });
    });

    it('format 为可选字符串', () => {
      const service = new WebFetchToolService(mockService);
      const params = service.getToolParameters();
      expect(params.format.required).toBe(false);
      expect(params.format.type).toBe('string');
    });

    it('timeout 为可选数字', () => {
      const service = new WebFetchToolService(mockService);
      const params = service.getToolParameters();
      expect(params.timeout.required).toBe(false);
      expect(params.timeout.type).toBe('number');
    });

    it('参数描述均为中文', () => {
      const service = new WebFetchToolService(mockService);
      const params = service.getToolParameters();
      for (const key of Object.keys(params)) {
        expect(params[key].description).toMatch(/[\u4e00-\u9fff]/);
      }
    });
  });

  describe('fetch', () => {
    it('委托到 WebFetchService.fetch', async () => {
      const spy = vi.spyOn(mockService, 'fetch');
      const service = new WebFetchToolService(mockService);
      const result = await service.fetch({ url: 'https://example.com' });

      expect(spy).toHaveBeenCalledWith({ url: 'https://example.com' });
      expect(result.url).toBe('https://example.com');
    });

    it('透传 format 参数', async () => {
      const spy = vi.spyOn(mockService, 'fetch');
      const service = new WebFetchToolService(mockService);
      await service.fetch({ url: 'https://example.com', format: 'text' });

      expect(spy).toHaveBeenCalledWith({ url: 'https://example.com', format: 'text' });
    });

    it('透传 timeout 参数', async () => {
      const spy = vi.spyOn(mockService, 'fetch');
      const service = new WebFetchToolService(mockService);
      await service.fetch({ url: 'https://example.com', timeout: 15 });

      expect(spy).toHaveBeenCalledWith({ url: 'https://example.com', timeout: 15 });
    });

    it('返回 WebFetchResult 结构完整', async () => {
      const service = new WebFetchToolService(mockService);
      const result = await service.fetch({ url: 'https://example.com' });

      expect(result).toMatchObject({
        contentType: expect.any(String),
        format: expect.any(String),
        output: expect.any(String),
        status: expect.any(Number),
        title: expect.any(String),
        url: expect.any(String),
      });
    });

    it('传播 WebFetchService 的异常', async () => {
      mockService.fetch = vi.fn().mockRejectedValue(new Error('webfetch 请求失败: 500'));
      const service = new WebFetchToolService(mockService);

      await expect(service.fetch({ url: 'https://example.com' })).rejects.toThrow('webfetch 请求失败: 500');
    });
  });

  describe('toModelOutput', () => {
    it('返回 { type: "text", value: string } 结构', () => {
      const service = new WebFetchToolService(mockService);
      const result: WebFetchResult = {
        contentType: 'text/html',
        format: 'markdown',
        output: '# Hello',
        status: 200,
        title: 'Test Page',
        url: 'https://example.com',
      };
      const output = service.toModelOutput(result);

      expect(output).toEqual({
        type: 'text',
        value: expect.any(String),
      });
    });

    it('渲染输出包含 webfetch_result 标签', () => {
      const service = new WebFetchToolService(mockService);
      const result: WebFetchResult = {
        contentType: 'text/html',
        format: 'markdown',
        output: '# Hello',
        status: 200,
        title: 'Test Page',
        url: 'https://example.com',
      };
      const output = service.toModelOutput(result);

      expect(output.value).toContain('<webfetch_result>');
      expect(output.value).toContain('</webfetch_result>');
    });

    it('渲染输出包含 URL/Title/Status/Content-Type/Format', () => {
      const service = new WebFetchToolService(mockService);
      const result: WebFetchResult = {
        contentType: 'application/json',
        format: 'text',
        output: '{"key": "value"}',
        status: 200,
        title: 'JSON API',
        url: 'https://api.example.com/data',
      };
      const output = service.toModelOutput(result);

      expect(output.value).toContain('URL: https://api.example.com/data');
      expect(output.value).toContain('Title: JSON API');
      expect(output.value).toContain('Status: 200');
      expect(output.value).toContain('Content-Type: application/json');
      expect(output.value).toContain('Format: text');
    });

    it('contentType 为空时显示 unknown', () => {
      const service = new WebFetchToolService(mockService);
      const result: WebFetchResult = {
        contentType: '',
        format: 'markdown',
        output: 'content',
        status: 200,
        title: 'No Content-Type',
        url: 'https://example.com',
      };
      const output = service.toModelOutput(result);

      expect(output.value).toContain('Content-Type: unknown');
    });

    it('渲染输出包含原始 output 内容', () => {
      const service = new WebFetchToolService(mockService);
      const result: WebFetchResult = {
        contentType: 'text/plain',
        format: 'text',
        output: 'Hello World',
        status: 200,
        title: 'Plain',
        url: 'https://example.com',
      };
      const output = service.toModelOutput(result);

      expect(output.value).toContain('Hello World');
    });
  });
});

describe('renderWebFetchModelOutput', () => {
  it('格式化为标准 webfetch 模型输出', () => {
    const result: WebFetchResult = {
      contentType: 'text/html',
      format: 'markdown',
      output: '# Title\nContent',
      status: 200,
      title: 'Page Title',
      url: 'https://example.com/page',
    };
    const output = renderWebFetchModelOutput(result);

    const lines = output.split('\n');
    expect(lines[0]).toBe('<webfetch_result>');
    expect(lines[1]).toBe('URL: https://example.com/page');
    expect(lines[2]).toBe('Title: Page Title');
    expect(lines[3]).toBe('Status: 200');
    expect(lines[4]).toBe('Content-Type: text/html');
    expect(lines[5]).toBe('Format: markdown');
    expect(lines[6]).toBe('');
    expect(lines[7]).toBe('# Title');
    expect(lines[8]).toBe('Content');
    expect(lines[9]).toBe('</webfetch_result>');
  });

  it('output 包含多行内容', () => {
    const result: WebFetchResult = {
      contentType: 'text/plain',
      format: 'text',
      output: 'line1\nline2\nline3',
      status: 200,
      title: 'Multi-line',
      url: 'https://example.com',
    };
    const output = renderWebFetchModelOutput(result);

    expect(output).toContain('line1\nline2\nline3');
  });
});
