'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { setTimeout: delay } = require('node:timers/promises');
const { createTranslationService, createTranslationRouter } = require('../translation');

const apiKey = 'test-deepl-key:fx';
const original = '今日は晴れです。\nまた明日。';
const translated = '今天是晴天。\n明天见。';
const success = () => Response.json({ translations: [{ text: translated, detected_source_language: 'JA' }] });

test('DeepL auto-selects Free/Pro and sends complete Japanese text with server-side authentication', async () => {
  for (const [key, host] of [[apiKey, 'api-free.deepl.com'], ['test-pro-key', 'api.deepl.com']]) {
    const requests = [];
    const translate = createTranslationService({ deeplApiKey: '  ' + key + '  ', fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return success();
    } });
    const text = original + 'あ😀'.repeat(500);
    const result = await translate(text);
    assert.deepEqual(result, { translatedText: translated, source: 'ja', target: 'zh-CN', provider: 'DeepL' });
    assert.equal(requests.length, 1);
    const { url, options } = requests[0];
    assert.equal(url, 'https://' + host + '/v2/translate');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.Authorization, 'DeepL-Auth-Key ' + key);
    assert.equal(options.headers['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(options.body), {
      text: [text], source_lang: 'JA', target_lang: 'ZH-HANS', preserve_formatting: true,
    });
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(JSON.stringify(result).includes(key), false);
  }
});

test('provider selection supports explicit DeepL/MyMemory and rejects misconfiguration without upstream calls', async () => {
  for (const options of [{ provider: 'deepl' }, { provider: 'deepl', deeplApiKey: '  ' }, { provider: 'unknown', deeplApiKey: apiKey }]) {
    const translate = createTranslationService({ ...options, fetchImpl: () => assert.fail('Unexpected request') });
    await assert.rejects(translate(original), { status: 503 });
  }
  const deepl = createTranslationService({ provider: ' DeepL ', deeplApiKey: apiKey, fetchImpl: async () => success() });
  assert.equal((await deepl(original)).provider, 'DeepL');
  for (const options of [{ provider: 'mymemory', deeplApiKey: apiKey }, { deeplApiKey: '  ' }]) {
    const translate = createTranslationService({ ...options, fetchImpl: async (url, request) => {
      assert.equal(url.origin, 'https://api.mymemory.translated.net');
      assert.equal(request.headers.Authorization, undefined);
      return Response.json({ responseStatus: 200, responseData: { translatedText: '译文。' } });
    } });
    assert.equal((await translate('一。')).provider, 'MyMemory');
  }
});

test('DeepL validates text before sending billable requests and accepts the exact byte limit', async () => {
  let calls = 0;
  const translate = createTranslationService({ deeplApiKey: apiKey, fetchImpl: async () => { calls++; return success(); } });
  for (const value of [undefined, null, 1, {}, [], '', '  ', '日'.repeat(2001)]) {
    await assert.rejects(translate(value), { status: 400 });
  }
  assert.equal(calls, 0);
  await translate('日'.repeat(2000));
  assert.equal(calls, 1);
});

test('DeepL coalesces requests, caches successes, expires and evicts old entries', async () => {
  let calls = 0, time = 100;
  const translate = createTranslationService({ deeplApiKey: apiKey, now: () => time, cacheTtlMs: 10, cacheLimit: 2,
    fetchImpl: async () => { calls++; await delay(5); return success(); } });
  const results = await Promise.all([translate(original), translate(original)]);
  assert.deepEqual(results[0], results[1]);
  await translate(original);
  assert.equal(calls, 1);
  time += 11;
  await translate(original);
  assert.equal(calls, 2);
  await translate('二');
  await translate('三');
  await translate(original);
  assert.equal(calls, 5);
});

test('DeepL errors are actionable, are not cached or leaked, and never silently switch provider', async () => {
  const cases = [
    [() => Response.json({ message: apiKey }, { status: 401 }), 503, /身份验证/],
    [() => Response.json({ message: apiKey }, { status: 403 }), 503, /身份验证/],
    [() => new Response('', { status: 429 }), 429, /过于频繁/],
    [() => new Response('', { status: 456 }), 429, /额度已用完/],
    [() => new Response('', { status: 500 }), 502, /暂时不可用/],
    [() => new Response('invalid json'), 502, /DeepL/],
    [() => { throw new TypeError(apiKey); }, 502, /无法连接/],
    ...[null, {}, { translations: [] }, { translations: [null] }, { translations: [{ text: ' ' }] },
      { translations: [{ text: 1 }] }, { translations: [{ text: '一' }, { text: '二' }] },
      { translations: { 0: { text: '一' } } }].map(payload => [() => Response.json(payload), 502, /有效译文/]),
  ];
  for (const [fail, status, message] of cases) {
    let calls = 0;
    const translate = createTranslationService({ deeplApiKey: apiKey, fetchImpl: async url => {
      assert.equal(url, 'https://api-free.deepl.com/v2/translate');
      calls++;
      return calls === 1 ? fail() : success();
    } });
    await assert.rejects(translate(original), error => {
      assert.equal(error.status, status);
      assert.match(error.message, message);
      assert.equal(error.message.includes(apiKey), false);
      return true;
    });
    assert.equal((await translate(original)).translatedText, translated);
    assert.equal(calls, 2);
  }
});

test('DeepL honors both request and total timeouts and releases the failed request for retry', async () => {
  for (const limits of [{ timeoutMs: 10 }, { timeoutMs: 1000, totalTimeoutMs: 10 }]) {
    let calls = 0;
    const translate = createTranslationService({ deeplApiKey: apiKey, ...limits, fetchImpl: async (url, { signal }) => {
      if (++calls === 1) await delay(200, undefined, { signal });
      return success();
    } });
    await assert.rejects(translate(original), { status: 504 });
    assert.equal((await translate(original)).provider, 'DeepL');
  }
});

test('DeepL keeps at most four different translations active and recovers afterwards', async () => {
  const translate = createTranslationService({ deeplApiKey: apiKey, fetchImpl: async () => { await delay(20); return success(); } });
  const results = await Promise.allSettled(['一', '二', '三', '四', '五'].map(translate));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 4);
  assert.equal(results.find(result => result.status === 'rejected').reason.status, 429);
  assert.equal((await translate('五')).provider, 'DeepL');
});

test('HTTP route returns DeepL metadata and sanitized provider errors', async t => {
  let fail = false;
  const app = express();
  app.use(express.json());
  app.use('/api/translate', createTranslationRouter({ deeplApiKey: apiKey, fetchImpl: async () =>
    fail ? Response.json({ message: apiKey }, { status: 403 }) : success() }));
  app.use('/unconfigured', createTranslationRouter({ provider: 'deepl', fetchImpl: () => assert.fail('Unexpected request') }));
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port;
  const send = (path, text) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
  const response = await send('/api/translate', original);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { translatedText: translated, source: 'ja', target: 'zh-CN', provider: 'DeepL' });
  fail = true;
  const denied = await send('/api/translate', '別の文章。');
  assert.equal(denied.status, 503);
  assert.equal(denied.headers.get('cache-control'), 'no-store');
  const error = (await denied.json()).error;
  assert.match(error, /身份验证/);
  assert.equal(error.includes(apiKey), false);
  const missing = await send('/unconfigured', original);
  assert.equal(missing.status, 503);
  assert.match((await missing.json()).error, /DEEPL_API_KEY/);
});
