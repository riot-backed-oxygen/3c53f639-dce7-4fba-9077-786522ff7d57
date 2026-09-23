'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { createAnalyticsStore, createVisitTracker, createAnalyticsRouter, configureTrustProxy, dayRange, normalizeIp } = require('../analytics');

async function site(t, { proxy = '', render = false, record, summary } = {}) {
  const records = [], errors = [];
  const store = {
    record: record || (async value => { records.push(value); }),
    summary: summary || (async () => ({ totalVisits: records.length, todayVisits: records.length,
      uniqueIps: new Set(records.map(item => item.ip)).size, todayIps: new Set(records.map(item => item.ip)).size,
      date: '2026-09-24', timeZone: 'Asia/Shanghai' })),
  };
  const app = express();
  configureTrustProxy(app, proxy, { isRender: render });
  const tracker = createVisitTracker({ store, onError: error => errors.push(error) });
  app.use(tracker.middleware);
  app.use('/api/analytics', createAnalyticsRouter({ store, tracker, onError: error => errors.push(error) }));
  app.get('/api/data', (req, res) => res.json({ ok: true }));
  app.get('/health', (req, res) => res.json({ ok: true }));
  app.get('/redirect', (req, res) => res.redirect('/'));
  app.get('/error', (req, res) => res.status(500).send('<p>Error</p>'));
  app.use(express.static(path.join(__dirname, '../public')));
  app.get('*', (req, res) => res.send('<!doctype html><p>Page</p>'));
  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  function request(url, { method = 'GET', headers = {} } = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path: url, method, headers }, res => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
      });
      req.on('error', reject);
      req.end();
    });
  }
  return { records, errors, request, tracker };
}

test('records HTML once per load and ignores APIs, assets, HEAD, errors and redirects', async t => {
  const { records, request, tracker } = await site(t);
  const first = await request('/?secret=not-recorded', { headers: { 'User-Agent': 'Browser/1.0' } });
  assert.equal(first.status, 200);
  await tracker.flush();
  assert.equal(records.length, 1);
  assert.equal(records[0].pathname, '/');
  assert.equal(records[0].userAgent, 'Browser/1.0');
  assert.ok(records[0].visitedAt instanceof Date);
  for (const url of ['/styles.css', '/app.js', '/visit-count.js', '/favicon.ico', '/missing.js', '/api/data', '/api/missing', '/health', '/redirect', '/error']) {
    await request(url);
  }
  await request('/', { method: 'HEAD' });
  await tracker.flush();
  assert.equal(records.length, 1);
  await request('/');
  await request('/index.html');
  await tracker.flush();
  assert.equal(records.length, 3);
});

test('304 HTML revalidation counts but JSON revalidation does not', async t => {
  const { records, request, tracker } = await site(t);
  const page = await request('/');
  const cached = await request('/', { headers: { 'If-None-Match': page.headers.etag } });
  assert.equal(cached.status, 304);
  assert.equal(cached.headers['content-type'], undefined);
  const health = await request('/health');
  assert.equal((await request('/health', { headers: { 'If-None-Match': health.headers.etag } })).status, 304);
  await tracker.flush();
  assert.equal(records.length, 2);
});

test('default IP source ignores forged forwarding headers', async t => {
  const { records, request, tracker } = await site(t);
  await request('/', { headers: { 'X-Forwarded-For': '198.51.100.4', 'X-Real-IP': '203.0.113.7' } });
  await tracker.flush();
  assert.equal(records[0].ip, '127.0.0.1');
});

test('trusted proxy uses the nearest untrusted hop, not an arbitrary first address', async t => {
  const { records, request, tracker } = await site(t, { proxy: 'loopback' });
  await request('/', { headers: { 'X-Forwarded-For': '203.0.113.88, 198.51.100.4' } });
  await request('/', { headers: { 'X-Forwarded-For': 'not-an-ip' } });
  await tracker.flush();
  assert.equal(records[0].ip, '198.51.100.4');
  assert.equal(records[1].ip, '127.0.0.1');
});

test('untrusted immediate peers cannot supply the visitor IP', async t => {
  const { records, request, tracker } = await site(t, { proxy: '192.0.2.0/24' });
  await request('/', { headers: { 'X-Forwarded-For': '198.51.100.4' } });
  await tracker.flush();
  assert.equal(records[0].ip, '127.0.0.1');
});

test('Render receives IPv4 and IPv6 from its proxy with either the Render or custom hostname', async t => {
  const { records, request, tracker } = await site(t, { render: true });
  await request('/', { headers: { Host: 'example.onrender.com', 'X-Forwarded-For': '198.51.100.20' } });
  await request('/', { headers: { Host: 'archive.example.com', 'X-Forwarded-For': '2001:db8::20' } });
  await request('/', { headers: { 'X-Forwarded-For': '203.0.113.99, 198.51.100.20' } });
  await tracker.flush();
  assert.deepEqual(records.map(record => record.ip), ['198.51.100.20', '2001:db8::20', '198.51.100.20']);
});

test('explicit proxy configuration overrides Render defaults for additional trusted hops or direct access', async t => {
  const extraProxy = await site(t, { render: true, proxy: '2' });
  await extraProxy.request('/', { headers: { 'X-Forwarded-For': '192.0.2.99, 198.51.100.20, 203.0.113.30' } });
  await extraProxy.tracker.flush();
  assert.equal(extraProxy.records[0].ip, '198.51.100.20');
  const direct = await site(t, { render: true, proxy: '0' });
  await direct.request('/', { headers: { 'X-Forwarded-For': '198.51.100.20' } });
  await direct.tracker.flush();
  assert.equal(direct.records[0].ip, '127.0.0.1');
});

test('IP normalization handles mapped IPv4 and equivalent IPv6 spellings', () => {
  assert.equal(normalizeIp('::ffff:192.0.2.1'), '192.0.2.1');
  assert.equal(normalizeIp('::ffff:c000:201'), '192.0.2.1');
  assert.equal(normalizeIp('0:0:0:0:0:ffff:c000:0201'), '192.0.2.1');
  assert.equal(normalizeIp('2001:0DB8:0000:0000:0000:0000:0000:0001'), '2001:db8::1');
  assert.equal(normalizeIp('::1'), '::1');
  assert.equal(normalizeIp('fe80::1%eth0'), 'fe80::1');
  for (const invalid of ['', undefined, [], '1.2.3.999', '192.0.2.1, 198.51.100.1']) assert.equal(normalizeIp(invalid), '');
});

test('page responses do not wait on writes; summary waits for writes already in flight', async t => {
  let release, written = 0;
  const gate = new Promise(resolve => { release = resolve; });
  t.after(() => release());
  const { request } = await site(t, {
    record: async () => { await gate; written++; }, summary: async () => ({ totalVisits: written }),
  });
  assert.equal((await request('/')).status, 200);
  assert.equal(written, 0);
  let completed = false;
  const pending = request('/api/analytics/summary').then(result => { completed = true; return result; });
  await delay(20);
  assert.equal(completed, false);
  release();
  assert.equal(JSON.parse((await pending).body).totalVisits, 1);
});

test('write failure leaves pages usable and later visits can recover', async t => {
  let attempts = 0;
  const { request, errors, tracker } = await site(t, { record: async () => {
    if (++attempts === 1) throw Object.assign(new Error('database unavailable'), { code: 'ECONNREFUSED' });
  } });
  assert.equal((await request('/')).status, 200);
  await tracker.flush();
  assert.equal((await request('/')).status, 200);
  await tracker.flush();
  assert.equal(attempts, 2);
  assert.equal(errors.length, 1);
});

test('summary is uncached, has no IP records or credentials, and reads never add visits', async t => {
  const { request, records } = await site(t);
  await request('/');
  for (let index = 0; index < 3; index++) {
    const response = await request('/api/analytics/summary');
    assert.equal(response.status, 200);
    assert.equal(response.headers['cache-control'], 'no-store');
    const data = JSON.parse(response.body);
    assert.equal(data.totalVisits, 1);
    assert.deepEqual(Object.keys(data).sort(), ['date', 'timeZone', 'todayIps', 'todayVisits', 'totalVisits', 'uniqueIps'].sort());
    assert.ok(!response.body.includes('127.0.0.1'));
  }
  assert.equal((await request('/api/analytics/visits')).status, 404);
  assert.equal((await request('/api/analytics/records')).status, 404);
  assert.equal(records.length, 1);
});

test('database read failures produce a retryable response without leaking database details', async t => {
  const { request, errors } = await site(t, { summary: async () => { throw new Error('private connection details'); } });
  const response = await request('/api/analytics/summary');
  assert.equal(response.status, 503);
  assert.equal(typeof JSON.parse(response.body).error, 'string');
  assert.ok(!response.body.includes('private connection details'));
  assert.equal(errors.length, 1);
});

test('Shanghai day boundaries are UTC+8 including month and leap-year transitions', () => {
  assert.deepEqual(dayRange('2026-09-24'), ['2026-09-24 00:00:00.000', '2026-09-25 00:00:00.000']);
  assert.deepEqual(dayRange('2024-02-29'), ['2024-02-29 00:00:00.000', '2024-03-01 00:00:00.000']);
  assert.deepEqual(dayRange('2026-12-31'), ['2026-12-31 00:00:00.000', '2027-01-01 00:00:00.000']);
  for (const day of ['2026-02-29', '2026-13-01', 'bad', [], '2026-9-24']) assert.throws(() => dayRange(day), RangeError);
});

test('schema failures retry, concurrent initialization is shared and inserts remain parameterized', async () => {
  let ddlCalls = 0;
  const inserts = [];
  const pool = { query: async (sql, args) => {
    if (sql.startsWith('CREATE TABLE')) {
      if (++ddlCalls === 1) throw new Error('temporarily offline');
      await delay(5);
      return [];
    }
    if (sql.startsWith('SHOW COLUMNS')) return [[{ Field: 'utc_offset_minutes' }]];
    if (sql.startsWith('UPDATE site_visits')) return [{ affectedRows: 0 }];
    inserts.push({ sql, args });
    return [];
  } };
  const store = createAnalyticsStore({ pool, now: () => new Date('2026-09-23T16:00:00.123Z') });
  await assert.rejects(store.initialize());
  const attack = "x'); DROP TABLE site_visits;--";
  const visit = { ip: '192.0.2.1', pathname: '/' + 'x'.repeat(1100), userAgent: attack + '\n' + '\u{1f600}'.repeat(600) };
  await Promise.all(Array.from({ length: 8 }, () => store.record(visit)));
  assert.equal(ddlCalls, 2);
  assert.equal(inserts.length, 8);
  const { sql, args } = inserts[0];
  assert.ok(!sql.includes(attack));
  assert.equal(args[0], '2026-09-24 00:00:00.123');
  assert.equal(args[2].length, 1024);
  assert.equal(Array.from(args[3]).length, 512);
  assert.ok(args[3].startsWith(attack));
  assert.ok(!args[3].includes('\n'));
  assert.equal(Buffer.from(args[3]).toString('utf8'), args[3]);
});

test('summary converts MySQL counters and rolls the day over at Shanghai midnight', async () => {
  let clock = new Date('2026-09-23T15:59:59.999Z');
  const ranges = [];
  const pool = { query: async (sql, args) => {
    if (sql.startsWith('CREATE TABLE')) return [];
    if (sql.startsWith('SHOW COLUMNS')) return [[{ Field: 'utc_offset_minutes' }]];
    if (sql.startsWith('UPDATE site_visits')) return [{ affectedRows: 0 }];
    ranges.push(args);
    return [[{ totalVisits: '8', uniqueIps: '3', todayVisits: '0', todayIps: '0' }]];
  } };
  const store = createAnalyticsStore({ pool, now: () => clock });
  const before = await store.summary();
  assert.equal(before.date, '2026-09-23');
  assert.equal(before.todayVisits, 0);
  assert.equal(before.totalVisits, 8);
  clock = new Date('2026-09-23T16:00:00.000Z');
  assert.equal((await store.summary()).date, '2026-09-24');
  assert.deepEqual(ranges[1], ['2026-09-24 00:00:00.000', '2026-09-25 00:00:00.000', '2026-09-24 00:00:00.000', '2026-09-25 00:00:00.000']);
});

test('storage rejects invalid IP values before accessing the database', async () => {
  const store = createAnalyticsStore({ pool: { query: () => assert.fail('Invalid IP reached the database') } });
  for (const ip of [undefined, 'unknown', '1.2.3.999', '198.51.100.20, 203.0.113.30']) {
    await assert.rejects(store.record({ ip, pathname: '/' }), TypeError);
  }
});
