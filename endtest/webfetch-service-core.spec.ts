import { describe, it, expect } from 'vitest';

// --- 内联实现: 对齐 packages/server/src/modules/execution/webfetch/webfetch-service.ts ---

type WebFetchFormat = 'text' | 'markdown' | 'html';

const DEFAULT_TIMEOUT_SECONDS = 30;
const MAX_TIMEOUT_SECONDS = 120;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const WEBFETCH_USER_AGENT = 'garlic-claw-webfetch';

function normalizeFetchUrl(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error('webfetch url 不能为空');
  }
  if (!/^https?:\/\//u.test(normalized)) {
    throw new Error('webfetch url 必须以 http:// 或 https:// 开头');
  }
  return normalized;
}

function normalizeTimeoutMs(timeout?: number): number {
  if (timeout === undefined) {
    return DEFAULT_TIMEOUT_SECONDS * 1000;
  }
  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw new Error(`非法的 webfetch timeout: ${timeout}`);
  }
  return Math.min(Math.floor(timeout), MAX_TIMEOUT_SECONDS) * 1000;
}

function buildRequestHeaders(format: WebFetchFormat): Record<string, string> {
  return {
    Accept: format === 'html'
      ? 'text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.1'
      : format === 'text'
        ? 'text/plain,text/html;q=0.9,text/markdown;q=0.8,*/*;q=0.1'
        : 'text/markdown,text/plain;q=0.9,text/html;q=0.8,*/*;q=0.1',
    'User-Agent': WEBFETCH_USER_AGENT,
  };
}

function normalizeContentType(value: string | null): string {
  return value?.split(';')[0]?.trim().toLowerCase() ?? '';
}

function isSupportedContentType(contentType: string): boolean {
  return !contentType
    || contentType.startsWith('text/')
    || ['application/json', 'application/text', 'application/xml', 'application/xhtml+xml'].includes(contentType);
}

function renderFetchOutput(content: string, contentType: string, format: WebFetchFormat): string {
  if (!contentType.includes('html') && !contentType.includes('xhtml')) {
    return content.trim();
  }
  if (format === 'html') {
    return content.trim();
  }
  return (format === 'text' ? htmlToText(content) : htmlToMarkdown(content)).trim();
}

function readDocumentTitle(content: string): string | null {
  const title = content.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return title ? decodeHtmlEntities(stripTags(title)).trim() || null : null;
}

function htmlToText(content: string): string {
  return decodeHtmlEntities(normalizeWhitespace(stripTags(
    stripHtmlNoise(content)
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|section|article|header|footer|main|aside|li|ul|ol|h1|h2|h3|h4|h5|h6|pre|blockquote)>/gi, '\n'),
  )));
}

function htmlToMarkdown(content: string): string {
  return normalizeWhitespace(decodeHtmlEntities(stripTags(
    stripHtmlNoise(content)
      .replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, (_m: string, code: string) => `\n\`\`\`\n${decodeHtmlEntities(code).trim()}\n\`\`\`\n`)
      .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_m: string, code: string) => `\`${decodeHtmlEntities(stripTags(code)).trim()}\``)
      .replace(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_m: string, href: string, text: string) => `[${decodeHtmlEntities(stripTags(text)).trim() || href}](${href})`)
      .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m: string, level: string, text: string) => `\n${'#'.repeat(Number(level))} ${decodeHtmlEntities(stripTags(text)).trim()}\n`)
      .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m: string, text: string) => `\n- ${decodeHtmlEntities(stripTags(text)).trim()}`)
      .replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_m: string, text: string) => `\n> ${decodeHtmlEntities(stripTags(text)).trim()}\n`)
      .replace(/<(p|div|section|article|header|footer|main|aside)[^>]*>([\s\S]*?)<\/\1>/gi, (_m: string, _tag: string, text: string) => `\n${decodeHtmlEntities(stripTags(text)).trim()}\n`)
      .replace(/<br\s*\/?>/gi, '\n'),
  )));
}

function stripHtmlNoise(content: string): string {
  return content
    .replace(/<head[\s\S]*?<\/head>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ');
}

function stripTags(content: string): string {
  return content.replace(/<[^>]+>/g, ' ');
}

function normalizeWhitespace(content: string): string {
  return content
    .replace(/\r/g, '')
    .replace(/\t/g, ' ')
    .replace(/[ \u00a0]+/g, ' ')
    .replace(/ ([.,!?;:])/g, '$1')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decodeHtmlEntities(content: string): string {
  return content
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, '\'');
}

// --- 测试 ---

describe('normalizeFetchUrl', () => {
  it('返回已 trim 的有效 URL', () => {
    expect(normalizeFetchUrl('  https://example.com  ')).toBe('https://example.com');
  });

  it('接受 http:// 前缀', () => {
    expect(normalizeFetchUrl('http://example.com')).toBe('http://example.com');
  });

  it('接受 https:// 前缀', () => {
    expect(normalizeFetchUrl('https://example.com')).toBe('https://example.com');
  });

  it('拒绝空字符串', () => {
    expect(() => normalizeFetchUrl('')).toThrow('webfetch url 不能为空');
  });

  it('拒绝空白字符串', () => {
    expect(() => normalizeFetchUrl('   ')).toThrow('webfetch url 不能为空');
  });

  it('拒绝 ftp:// 协议', () => {
    expect(() => normalizeFetchUrl('ftp://example.com')).toThrow('必须以 http:// 或 https:// 开头');
  });

  it('拒绝 file:// 协议', () => {
    expect(() => normalizeFetchUrl('file:///tmp/test.txt')).toThrow('必须以 http:// 或 https:// 开头');
  });

  it('拒绝无协议 URL', () => {
    expect(() => normalizeFetchUrl('example.com')).toThrow('必须以 http:// 或 https:// 开头');
  });
});

describe('normalizeTimeoutMs', () => {
  it('undefined 返回默认 30 秒', () => {
    expect(normalizeTimeoutMs()).toBe(30000);
  });

  it('合法整数返回毫秒', () => {
    expect(normalizeTimeoutMs(15)).toBe(15000);
  });

  it('上限钳制到 120 秒', () => {
    expect(normalizeTimeoutMs(200)).toBe(120000);
  });

  it('地板取整', () => {
    expect(normalizeTimeoutMs(15.7)).toBe(15000);
  });

  it('拒绝 0', () => {
    expect(() => normalizeTimeoutMs(0)).toThrow('非法的 webfetch timeout');
  });

  it('拒绝负数', () => {
    expect(() => normalizeTimeoutMs(-1)).toThrow('非法的 webfetch timeout');
  });

  it('拒绝 NaN', () => {
    expect(() => normalizeTimeoutMs(NaN)).toThrow('非法的 webfetch timeout');
  });

  it('拒绝 Infinity', () => {
    expect(() => normalizeTimeoutMs(Infinity)).toThrow('非法的 webfetch timeout');
  });
});

describe('buildRequestHeaders', () => {
  it('markdown 格式优先请求 markdown', () => {
    const headers = buildRequestHeaders('markdown');
    expect(headers.Accept).toContain('text/markdown');
    expect(headers['User-Agent']).toBe('garlic-claw-webfetch');
  });

  it('text 格式优先请求 text/plain', () => {
    const headers = buildRequestHeaders('text');
    expect(headers.Accept).toContain('text/plain');
  });

  it('html 格式优先请求 text/html', () => {
    const headers = buildRequestHeaders('html');
    expect(headers.Accept).toContain('text/html');
  });

  it('始终包含 User-Agent', () => {
    const headers = buildRequestHeaders('markdown');
    expect(headers['User-Agent']).toBe('garlic-claw-webfetch');
  });

  it('三种格式的 User-Agent 一致', () => {
    const md = buildRequestHeaders('markdown');
    const txt = buildRequestHeaders('text');
    const html = buildRequestHeaders('html');
    expect(md['User-Agent']).toBe(txt['User-Agent']);
    expect(txt['User-Agent']).toBe(html['User-Agent']);
  });
});

describe('normalizeContentType', () => {
  it('去除 charset 后缀', () => {
    expect(normalizeContentType('text/html; charset=utf-8')).toBe('text/html');
  });

  it('转小写', () => {
    expect(normalizeContentType('TEXT/HTML')).toBe('text/html');
  });

  it('trim 前后空白', () => {
    expect(normalizeContentType('  text/plain  ')).toBe('text/plain');
  });

  it('null 返回空字符串', () => {
    expect(normalizeContentType(null)).toBe('');
  });

  it('无分号完整保留', () => {
    expect(normalizeContentType('application/json')).toBe('application/json');
  });
});

describe('isSupportedContentType', () => {
  it('空字符串返回 true', () => {
    expect(isSupportedContentType('')).toBe(true);
  });

  it('text/* 类型返回 true', () => {
    expect(isSupportedContentType('text/html')).toBe(true);
    expect(isSupportedContentType('text/plain')).toBe(true);
    expect(isSupportedContentType('text/markdown')).toBe(true);
    expect(isSupportedContentType('text/css')).toBe(true);
  });

  it('application/json 返回 true', () => {
    expect(isSupportedContentType('application/json')).toBe(true);
  });

  it('application/text 返回 true', () => {
    expect(isSupportedContentType('application/text')).toBe(true);
  });

  it('application/xml 返回 true', () => {
    expect(isSupportedContentType('application/xml')).toBe(true);
  });

  it('application/xhtml+xml 返回 true', () => {
    expect(isSupportedContentType('application/xhtml+xml')).toBe(true);
  });

  it('image/* 返回 false', () => {
    expect(isSupportedContentType('image/png')).toBe(false);
    expect(isSupportedContentType('image/jpeg')).toBe(false);
  });

  it('application/octet-stream 返回 false', () => {
    expect(isSupportedContentType('application/octet-stream')).toBe(false);
  });

  it('application/pdf 返回 false', () => {
    expect(isSupportedContentType('application/pdf')).toBe(false);
  });
});

describe('readDocumentTitle', () => {
  it('提取标准 title 标签', () => {
    const html = '<html><head><title>My Page</title></head><body></body></html>';
    expect(readDocumentTitle(html)).toBe('My Page');
  });

  it('trim 标题前后空白', () => {
    const html = '<title>  Hello World  </title>';
    expect(readDocumentTitle(html)).toBe('Hello World');
  });

  it('解码 HTML 实体', () => {
    const html = '<title>Foo &amp; Bar</title>';
    expect(readDocumentTitle(html)).toBe('Foo & Bar');
  });

  it('strip 内部标签', () => {
    const html = '<title><b>Bold</b> Title</title>';
    expect(readDocumentTitle(html)).toBe('Bold Title');
  });

  it('无 title 标签返回 null', () => {
    expect(readDocumentTitle('<html><body></body></html>')).toBeNull();
  });

  it('空标题返回 null', () => {
    const html = '<title>  </title>';
    expect(readDocumentTitle(html)).toBeNull();
  });

  it('大小写不敏感', () => {
    const html = '<TITLE>Case Insensitive</TITLE>';
    expect(readDocumentTitle(html)).toBe('Case Insensitive');
  });
});

describe('htmlToText', () => {
  it('将 HTML 转换为纯文本', () => {
    const html = '<html><body><h1>Title</h1><p>Hello <strong>World</strong>.</p></body></html>';
    const result = htmlToText(html);
    expect(result).not.toContain('<');
    expect(result).toContain('Title');
    expect(result).toContain('Hello World.');
  });

  it('block 元素后插入换行', () => {
    const html = '<p>Para1</p><p>Para2</p>';
    const result = htmlToText(html);
    expect(result).toMatch(/Para1\n+Para2/);
  });

  it('br 转换为换行', () => {
    const html = 'Line1<br>Line2<br/>Line3';
    const result = htmlToText(html);
    expect(result).toContain('Line1\nLine2\nLine3');
  });

  it('去除 head/script/style', () => {
    const html = '<html><head><title>Hidden</title></head><body><script>alert(1)</script><style>.cls{}</style><p>Visible</p></body></html>';
    const result = htmlToText(html);
    expect(result).not.toContain('Hidden');
    expect(result).not.toContain('alert');
    expect(result).not.toContain('.cls');
    expect(result).toContain('Visible');
  });

  it('解码 HTML 实体', () => {
    const html = '<p>&amp; &lt; &gt; &quot; &#39;</p>';
    const result = htmlToText(html);
    expect(result).toContain('& < > " \'');
  });

  it('空白归一化', () => {
    const html = '<p>Hello    World</p>';
    const result = htmlToText(html);
    expect(result).toContain('Hello World');
  });

  it('空 HTML 返回空字符串', () => {
    expect(htmlToText('')).toBe('');
  });

  it('无 tag 纯文本保持不变', () => {
    expect(htmlToText('Hello World')).toBe('Hello World');
  });
});

describe('htmlToMarkdown', () => {
  it('h1-h6 转为 # 标题', () => {
    const html = '<h1>H1</h1><h2>H2</h2><h3>H3</h3>';
    const result = htmlToMarkdown(html);
    expect(result).toContain('# H1');
    expect(result).toContain('## H2');
    expect(result).toContain('### H3');
  });

  it('链接转为 markdown 格式', () => {
    const html = '<a href="https://example.com">Example</a>';
    const result = htmlToMarkdown(html);
    expect(result).toContain('[Example](https://example.com)');
  });

  it('链接无文本时使用 href', () => {
    const html = '<a href="https://example.com"></a>';
    const result = htmlToMarkdown(html);
    expect(result).toContain('[](https://example.com)');
  });

  it('列表项转为 - 前缀', () => {
    const html = '<ul><li>Item 1</li><li>Item 2</li></ul>';
    const result = htmlToMarkdown(html);
    expect(result).toContain('- Item 1');
    expect(result).toContain('- Item 2');
  });

  it('blockquote 转为 > 前缀', () => {
    const html = '<blockquote>Quote text</blockquote>';
    const result = htmlToMarkdown(html);
    expect(result).toContain('> Quote text');
  });

  it('pre>code 转为代码块', () => {
    const html = '<pre><code>const x = 1;</code></pre>';
    const result = htmlToMarkdown(html);
    expect(result).toContain('```');
    expect(result).toContain('const x = 1;');
  });

  it('inline code 转为反引号', () => {
    const html = '<p>Use <code>fetch()</code> API</p>';
    const result = htmlToMarkdown(html);
    expect(result).toContain('`fetch()`');
  });

  it('去除 head/script/style', () => {
    const html = '<html><head><title>Hidden</title></head><body><script>let x=1</script><style>body{}</style><p>Visible</p></body></html>';
    const result = htmlToMarkdown(html);
    expect(result).not.toContain('Hidden');
    expect(result).not.toContain('let x=1');
    expect(result).not.toContain('body{}');
    expect(result).toContain('Visible');
  });

  it('空 HTML 返回空字符串', () => {
    expect(htmlToMarkdown('')).toBe('');
  });
});

describe('renderFetchOutput', () => {
  it('非 HTML 内容直接返回 trim 结果', () => {
    expect(renderFetchOutput('  Hello  ', 'text/plain', 'markdown')).toBe('Hello');
  });

  it('HTML 内容 format=html 返回原始 HTML', () => {
    const html = '<p>Test</p>';
    expect(renderFetchOutput(html, 'text/html', 'html')).toBe(html);
  });

  it('HTML 内容 format=text 调用 htmlToText', () => {
    const html = '<h1>Title</h1><p>Content</p>';
    const result = renderFetchOutput(html, 'text/html', 'text');
    expect(result).not.toContain('<');
    expect(result).toContain('Title');
    expect(result).toContain('Content');
  });

  it('HTML 内容 format=markdown 调用 htmlToMarkdown', () => {
    const html = '<h1>Title</h1><p>Content</p>';
    const result = renderFetchOutput(html, 'text/html', 'markdown');
    expect(result).toContain('# Title');
    expect(result).toContain('Content');
  });

  it('xhtml 也被视为 HTML', () => {
    const html = '<h1>Title</h1>';
    const result = renderFetchOutput(html, 'application/xhtml+xml', 'text');
    expect(result).toContain('Title');
  });
});

describe('stripHtmlNoise', () => {
  it('移除 head 内容', () => {
    expect(stripHtmlNoise('<head><title>Title</title></head><body>Content</body>')).not.toContain('Title');
  });

  it('移除 script 内容', () => {
    const html = '<script>alert("xss")</script><p>Safe</p>';
    const result = stripHtmlNoise(html);
    expect(result).not.toContain('alert');
    expect(result).toContain('Safe');
  });

  it('移除 style 内容', () => {
    const html = '<style>.cls{color:red}</style><p>Styled</p>';
    const result = stripHtmlNoise(html);
    expect(result).not.toContain('color:red');
    expect(result).toContain('Styled');
  });

  it('大小写不敏感', () => {
    const html = '<SCRIPT>alert(1)</SCRIPT><p>OK</p>';
    const result = stripHtmlNoise(html);
    expect(result).not.toContain('alert');
    expect(result).toContain('OK');
  });

  it('无 noise 内容不变', () => {
    expect(stripHtmlNoise('<p>Hello</p>')).toBe('<p>Hello</p>');
  });
});

describe('stripTags', () => {
  it('移除所有标签', () => {
    expect(stripTags('<p>Hello <b>World</b></p>')).toBe(' Hello  World ');
  });

  it('自闭合标签处理', () => {
    expect(stripTags('Line1<br/>Line2')).toBe('Line1 Line2');
  });

  it('无标签不变', () => {
    expect(stripTags('Hello World')).toBe('Hello World');
  });

  it('空字符串返回空', () => {
    expect(stripTags('')).toBe('');
  });

  it('属性被移除', () => {
    expect(stripTags('<a href="link">text</a>')).toBe(' text ');
  });
});

describe('normalizeWhitespace', () => {
  it('CR 被移除', () => {
    expect(normalizeWhitespace('line1\r\nline2')).toBe('line1\nline2');
  });

  it('tab 转为空格', () => {
    expect(normalizeWhitespace('hello\tworld')).toBe('hello world');
  });

  it('连续空格合并', () => {
    expect(normalizeWhitespace('hello    world')).toBe('hello world');
  });

  it('标点前空格移除', () => {
    expect(normalizeWhitespace('hello , world .')).toBe('hello, world.');
  });

  it('行尾空白移除', () => {
    expect(normalizeWhitespace('hello  \nworld')).toBe('hello\nworld');
  });

  it('连续空行合并为最多两个', () => {
    expect(normalizeWhitespace('a\n\n\n\nb')).toBe('a\n\nb');
  });

  it('前后 trim', () => {
    expect(normalizeWhitespace('  hello  ')).toBe('hello');
  });

  it('非断空格被合并', () => {
    expect(normalizeWhitespace('hello\u00a0world')).toBe('hello world');
  });
});

describe('decodeHtmlEntities', () => {
  it('&nbsp; 转为空格', () => {
    expect(decodeHtmlEntities('a&nbsp;b')).toBe('a b');
  });

  it('&amp; 转为 &', () => {
    expect(decodeHtmlEntities('&amp;')).toBe('&');
  });

  it('&lt; 转为 <', () => {
    expect(decodeHtmlEntities('&lt;')).toBe('<');
  });

  it('&gt; 转为 >', () => {
    expect(decodeHtmlEntities('&gt;')).toBe('>');
  });

  it('&quot; 转为 "', () => {
    expect(decodeHtmlEntities('&quot;')).toBe('"');
  });

  it('&#39; 转为 \'', () => {
    expect(decodeHtmlEntities('&#39;')).toBe("'");
  });

  it('无实体不变', () => {
    expect(decodeHtmlEntities('Hello World')).toBe('Hello World');
  });

  it('大小写不敏感', () => {
    expect(decodeHtmlEntities('&AMP;')).toBe('&');
  });

  it('组合实体', () => {
    expect(decodeHtmlEntities('&lt;div&gt;&quot;Hello&quot;&lt;/div&gt;')).toBe('<div>"Hello"</div>');
  });
});
