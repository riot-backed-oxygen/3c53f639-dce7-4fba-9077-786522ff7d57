'use strict';

const express = require('express');

class TranslationError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

// MyMemory accepts at most 500 UTF-8 bytes per query, not 500 characters.
function splitText(text, maxBytes = 450) {
  const chunks = [];
  let chunk = '', bytes = 0;
  for (const character of text) {
    const size = Buffer.byteLength(character, 'utf8');
    if (bytes + size > maxBytes && chunk) {
      chunks.push(chunk);
      chunk = '';
      bytes = 0;
    }
    chunk += character;
    bytes += size;
    if (/[。！？\n]/u.test(character)) {
      chunks.push(chunk);
      chunk = '';
      bytes = 0;
    }
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}

function createTranslationService({ fetchImpl = globalThis.fetch, email = '', provider = 'auto',
  deeplApiKey = '', now = Date.now,
  timeoutMs = 12000, totalTimeoutMs = 45000, cacheTtlMs = 86400000, cacheLimit = 500 } = {}) {
  deeplApiKey = deeplApiKey.trim();
  provider = provider.trim().toLowerCase() || 'auto';
  const selectedProvider = provider === 'auto' ? (deeplApiKey ? 'deepl' : 'mymemory') : provider;
  const cache = new Map(), pending = new Map();
  let active = 0;

  async function remember(key, operation) {
    const saved = cache.get(key);
    if (saved && saved.expires > now()) {
      cache.delete(key);
      cache.set(key, saved);
      return saved.value;
    }
    cache.delete(key);
    if (pending.has(key)) return pending.get(key);
    const promise = Promise.resolve().then(operation);
    pending.set(key, promise);
    try {
      const value = await promise;
      cache.set(key, { value, expires: now() + cacheTtlMs });
      while (cache.size > cacheLimit) cache.delete(cache.keys().next().value);
      return value;
    } finally {
      pending.delete(key);
    }
  }

  async function translateChunk(text, deadline) {
    if (!text.trim()) return text;
    const translated = await remember('chunk:' + text.trim(), async () => {
      const url = new URL('https://api.mymemory.translated.net/get');
      url.search = new URLSearchParams({ q: text.trim(), langpair: 'ja|zh-CN' });
      if (email.trim()) url.searchParams.set('de', email.trim());
      const signal = AbortSignal.timeout(Math.min(timeoutMs, Math.max(1, deadline - Date.now())));
      try {
        const response = await fetchImpl(url, {
          signal,
          headers: { Accept: 'application/json' },
        });
        if (response.status === 429) throw new TranslationError('免费翻译额度已用完或请求过于频繁，请稍后再试。', 429);
        if (!response.ok) throw new TranslationError('翻译服务暂时不可用，请稍后重试。');
        const result = await response.json();
        if (result.quotaFinished || Number(result.responseStatus) === 429 ||
            /MYMEMORY WARNING|QUOTA|USED ALL AVAILABLE FREE/i.test(result.responseDetails || result.responseData?.translatedText || '')) {
          throw new TranslationError('免费翻译额度已用完，请稍后再试。', 429);
        }
        const output = result.responseData?.translatedText;
        if (Number(result.responseStatus) !== 200 || typeof output !== 'string' || !output.trim()) {
          throw new TranslationError('翻译服务未返回有效译文，请稍后重试。');
        }
        return output.trim();
      } catch (error) {
        if (error instanceof TranslationError) throw error;
        if (signal.aborted || error.name === 'TimeoutError' || error.name === 'AbortError') {
          throw new TranslationError('翻译请求超时，请稍后重试。', 504);
        }
        throw new TranslationError('无法连接翻译服务，请检查网络后重试。');
      }
    });
    return text.match(/^\s*/u)[0] + translated + text.match(/\s*$/u)[0];
  }

  async function translateDeepL(text, deadline) {
    // API Free keys end in :fx; keep credentials in the server-side header only.
    const endpoint = deeplApiKey.endsWith(':fx') ? 'https://api-free.deepl.com/v2/translate' :
      'https://api.deepl.com/v2/translate';
    const signal = AbortSignal.timeout(Math.min(timeoutMs, Math.max(1, deadline - Date.now())));
    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          Authorization: 'DeepL-Auth-Key ' + deeplApiKey,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        // Send the whole text to preserve context; the local 6000-byte limit fits DeepL's request limit.
        body: JSON.stringify({ text: [text], source_lang: 'JA', target_lang: 'ZH-HANS', preserve_formatting: true }),
        signal,
      });
      if (response.status === 401 || response.status === 403) {
        throw new TranslationError('DeepL 身份验证失败，请管理员检查 API Key 和账户权限。', 503);
      }
      if (response.status === 429) throw new TranslationError('DeepL 请求过于频繁，请稍后重试。', 429);
      if (response.status === 456) throw new TranslationError('DeepL 翻译额度已用完，请管理员检查账户额度。', 429);
      if (!response.ok) throw new TranslationError('DeepL 翻译服务暂时不可用，请稍后重试。');
      const result = await response.json();
      const translations = result?.translations;
      const output = translations?.[0]?.text;
      if (!Array.isArray(translations) || translations.length !== 1 || typeof output !== 'string' || !output.trim()) {
        throw new TranslationError('DeepL 未返回有效译文，请稍后重试。');
      }
      return output.trim();
    } catch (error) {
      if (error instanceof TranslationError) throw error;
      if (signal.aborted || error.name === 'TimeoutError' || error.name === 'AbortError') {
        throw new TranslationError('DeepL 翻译请求超时，请稍后重试。', 504);
      }
      throw new TranslationError('无法连接 DeepL 翻译服务，请稍后重试。');
    }
  }

  return async function translate(text) {
    if (typeof text !== 'string' || !text.trim()) throw new TranslationError('请提供需要翻译的文本。', 400);
    text = text.trim();
    if (Buffer.byteLength(text, 'utf8') > 6000) throw new TranslationError('文本过长，请缩短到 6000 字节以内再翻译。', 400);
    if (!['deepl', 'mymemory'].includes(selectedProvider)) {
      throw new TranslationError('翻译服务配置无效，请管理员检查 TRANSLATION_PROVIDER。', 503);
    }
    if (selectedProvider === 'deepl' && !deeplApiKey) {
      throw new TranslationError('DeepL 尚未配置，请管理员设置 DEEPL_API_KEY。', 503);
    }
    const translatedText = await remember('text:' + text, async () => {
      if (active >= 4) throw new TranslationError('翻译请求较多，请稍后重试。', 429);
      active++;
      const deadline = Date.now() + totalTimeoutMs;
      try {
        if (selectedProvider === 'deepl') return await translateDeepL(text, deadline);
        const results = [];
        for (const chunk of splitText(text)) {
          if (Date.now() >= deadline) throw new TranslationError('翻译请求超时，请稍后重试。', 504);
          results.push(await translateChunk(chunk, deadline));
        }
        return results.join('');
      } finally {
        active--;
      }
    });
    return { translatedText, source: 'ja', target: 'zh-CN', provider: selectedProvider === 'deepl' ? 'DeepL' : 'MyMemory' };
  };
}

function createTranslationRouter(options = {}) {
  const router = express.Router();
  const translate = createTranslationService(options);
  router.post('/', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      res.json(await translate(req.body?.text));
    } catch (error) {
      res.status(error instanceof TranslationError ? error.status : 500).json({
        error: error instanceof TranslationError ? error.message : '翻译失败，请稍后重试。',
      });
    }
  });
  return router;
}

module.exports = { createTranslationService, createTranslationRouter, splitText };
