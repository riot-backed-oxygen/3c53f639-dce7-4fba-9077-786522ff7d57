'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { setTimeout: delay } = require('node:timers/promises');
const { createTranslationService, createTranslationRouter, splitText } = require('../translation');

function success(translatedText = '今天天气不错。') {
  return Response.json({ responseStatus: 200, responseData: { translatedText } });
}

test('rejects missing, non-string and oversized text before sending anything upstream', async () => {
  const translate = createTranslationService({ fetchImpl: () => assert.fail('Unexpected upstream request') });
  for (const value of [undefined, null, 1, {}, [], '', '  ', '日'.repeat(2001)]) {
    await assert.rejects(translate(value), { status: 400 });
  }
});

test('splits by UTF-8 bytes without losing sentences, newlines or emoji', () => {
  const text = '今日は晴れです。\n' + 'あ😀'.repeat(200) + '終わり！';
  const chunks = splitText(text);
  assert.equal(chunks.join(''), text);
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) {
    assert.ok(Buffer.byteLength(chunk) <= 450);
    assert.equal(Buffer.from(chunk).toString('utf8'), chunk);
  }
});

test('uses Japanese to simplified Chinese, optional email and preserves paragraph breaks', async () => {
  const requests = [];
  const translate = createTranslationService({ email: 'test@example.com', fetchImpl: async url => {
    requests.push(url);
    return success(url.searchParams.get('q') === '今日は晴れです。' ? '今天是晴天。' : '明天见。');
  } });
  const result = await translate('今日は晴れです。\nまた明日。');
  assert.equal(result.translatedText, '今天是晴天。\n明天见。');
  assert.equal(result.provider, 'MyMemory');
  assert.equal(requests.length, 2);
  assert.equal(requests[0].origin, 'https://api.mymemory.translated.net');
  assert.equal(requests[0].searchParams.get('langpair'), 'ja|zh-CN');
  assert.equal(requests[0].searchParams.get('de'), 'test@example.com');
});

test('coalesces simultaneous requests, reuses results and expires the cache', async () => {
  let calls = 0, time = 100;
  const translate = createTranslationService({ now: () => time, cacheTtlMs: 10, fetchImpl: async url => {
    calls++;
    assert.equal(url.searchParams.has('de'), false);
    await delay(5);
    return success();
  } });
  const results = await Promise.all([translate('今日は晴れです。'), translate('今日は晴れです。')]);
  assert.deepEqual(results[0], results[1]);
  await translate('今日は晴れです。');
  assert.equal(calls, 1);
  time += 11;
  await translate('今日は晴れです。');
  assert.equal(calls, 2);
});

test('evicts old entries when the cache reaches its size limit', async () => {
  let calls = 0;
  const translate = createTranslationService({ cacheLimit: 2, fetchImpl: async () => { calls++; return success(); } });
  await translate('一');
  await translate('二');
  await translate('一');
  assert.equal(calls, 3);
});

test('quota warnings, bad payloads, network failures and HTTP errors never become translations', async () => {
  for (const [fetchImpl, status] of [
    [async () => new Response('', { status: 429 }), 429],
    [async () => Response.json({ quotaFinished: true, responseStatus: 200 }), 429],
    [async () => Response.json({ responseStatus: '429' }), 429],
    [async () => success('MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS'), 429],
    [async () => Response.json({ responseStatus: 403, responseDetails: 'Bad pair' }), 502],
    [async () => success(''), 502],
    [async () => new Response('invalid json'), 502],
    [async () => { throw new TypeError('fetch failed'); }, 502],
    [async () => new Response('', { status: 500 }), 502],
  ]) {
    const translate = createTranslationService({ fetchImpl });
    await assert.rejects(translate('今日は晴れです。'), { status });
  }
});

test('a failed translation can be retried without wasting successful earlier chunks', async () => {
  const requests = [];
  let fail = true;
  const translate = createTranslationService({ fetchImpl: async url => {
    const q = url.searchParams.get('q');
    requests.push(q);
    if (fail && q === 'また明日。') throw new Error('offline');
    return success('译文。');
  } });
  await assert.rejects(translate('今日は晴れです。また明日。'), { status: 502 });
  fail = false;
  assert.equal((await translate('今日は晴れです。また明日。')).translatedText, '译文。译文。');
  assert.deepEqual(requests, ['今日は晴れです。', 'また明日。', 'また明日。']);
});

test('aborts a slow upstream request with a retryable timeout', async () => {
  const translate = createTranslationService({ timeoutMs: 10, fetchImpl: async (url, { signal }) => {
    await delay(100, undefined, { signal });
    return success();
  } });
  await assert.rejects(translate('今日は晴れです。'), { status: 504 });
});

test('limits total time across chunks', async () => {
  const translate = createTranslationService({ timeoutMs: 100, totalTimeoutMs: 15, fetchImpl: async (url, { signal }) => {
    await delay(10, undefined, { signal });
    return success();
  } });
  await assert.rejects(translate('一。二。三。四。'), { status: 504 });
});

test('bounds concurrent translations and recovers after they finish', async () => {
  const translate = createTranslationService({ fetchImpl: async () => { await delay(20); return success(); } });
  const outcomes = await Promise.allSettled(['一', '二', '三', '四', '五'].map(translate));
  assert.equal(outcomes.filter(x => x.status === 'fulfilled').length, 4);
  assert.equal(outcomes.find(x => x.status === 'rejected').reason.status, 429);
  assert.equal((await translate('五')).provider, 'MyMemory');
});

test('HTTP route exposes translations and client errors without needing the database', async t => {
  const app = express();
  app.use(express.json());
  app.use('/api/translate', createTranslationRouter({ fetchImpl: async () => success() }));
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const endpoint = 'http://127.0.0.1:' + server.address().port + '/api/translate';
  const send = body => fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const response = await send({ text: '今日は晴れです。' });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await response.json()).translatedText, '今天天气不错。');
  const invalid = await send({ text: ['unexpected'] });
  assert.equal(invalid.status, 400);
  assert.equal(typeof (await invalid.json()).error, 'string');
});
