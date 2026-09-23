'use strict';

const express = require('express');
const { isIP } = require('node:net');
const path = require('node:path');

const DAY_MS = 86400000;
const SHANGHAI_OFFSET_MS = 8 * 3600000;
const CREATE_TABLE_SQL = `CREATE TABLE IF NOT EXISTS site_visits (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  visited_at DATETIME(3) NOT NULL,
  ip VARCHAR(45) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  path VARCHAR(1024) NOT NULL,
  user_agent VARCHAR(512) NOT NULL,
  INDEX idx_site_visits_time (visited_at, id),
  INDEX idx_site_visits_ip_time (ip, visited_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

function sqlDate(date) {
  return date.toISOString().slice(0, 23).replace('T', ' ');
}

function dayRange(day) {
  if (typeof day !== 'string' || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(day)) {
    throw new RangeError('日期格式应为 YYYY-MM-DD。');
  }
  const midnight = new Date(day + 'T00:00:00.000Z');
  if (!Number.isFinite(midnight.getTime()) || midnight.toISOString().slice(0, 10) !== day) {
    throw new RangeError('日期无效。');
  }
  const start = midnight.getTime() - SHANGHAI_OFFSET_MS;
  return [sqlDate(new Date(start)), sqlDate(new Date(start + DAY_MS))];
}

function normalizeIp(value) {
  if (typeof value !== 'string') return '';
  if (/^::ffff:/i.test(value) && isIP(value.slice(7)) === 4) return value.slice(7);
  const version = isIP(value);
  if (version === 4) return value;
  if (version === 6) {
    // URL canonicalizes equivalent IPv6 spellings; zone IDs are local-only.
    const canonical = new URL('http://[' + value.split('%')[0] + ']/').hostname.slice(1, -1);
    const mapped = /^::ffff:([0-9a-f]+):([0-9a-f]+)$/.exec(canonical);
    if (mapped) {
      const high = parseInt(mapped[1], 16), low = parseInt(mapped[2], 16);
      return [high >> 8, high & 255, low >> 8, low & 255].join('.');
    }
    return canonical;
  }
  return '';
}

function boundedText(value, length) {
  return Array.from(String(value || '').replace(/[\u0000-\u001f\u007f]/g, '')).slice(0, length).join('');
}

function createAnalyticsStore({ pool, now = () => new Date() }) {
  let initialization;
  function initialize() {
    if (!initialization) {
      initialization = pool.query(CREATE_TABLE_SQL).catch(error => {
        initialization = undefined;
        throw error;
      });
    }
    return initialization;
  }
  return {
    initialize,
    async record({ ip, pathname, userAgent, visitedAt = now() }) {
      await initialize();
      await pool.query('INSERT INTO site_visits (visited_at, ip, path, user_agent) VALUES (?, ?, ?, ?)', [
        sqlDate(visitedAt), ip, boundedText(pathname, 1024), boundedText(userAgent, 512),
      ]);
    },
    async summary() {
      const day = new Date(now().getTime() + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10);
      const bounds = dayRange(day);
      await initialize();
      const [[row]] = await pool.query(`SELECT COUNT(*) AS totalVisits, COUNT(DISTINCT ip) AS uniqueIps,
        COALESCE(SUM(visited_at >= ? AND visited_at < ?), 0) AS todayVisits,
        COUNT(DISTINCT CASE WHEN visited_at >= ? AND visited_at < ? THEN ip END) AS todayIps
        FROM site_visits`, [...bounds, ...bounds]);
      return {
        totalVisits: Number(row.totalVisits), todayVisits: Number(row.todayVisits),
        uniqueIps: Number(row.uniqueIps), todayIps: Number(row.todayIps),
        date: day, timeZone: 'Asia/Shanghai',
      };
    },
  };
}

function createVisitTracker({ store, onError = error => console.error('[analytics] Write failed:', error.code || error.name) }) {
  const pending = new Set();
  const middleware = (req, res, next) => {
    const pathname = req.path;
    const extension = path.extname(pathname).toLowerCase();
    if (req.method !== 'GET' || /^\/api(?:\/|$)/i.test(pathname) ||
        (extension && extension !== '.html')) return next();
    const ip = normalizeIp(req.ip) || normalizeIp(req.socket.remoteAddress);
    const visitedAt = new Date();
    const userAgent = req.get('user-agent');
    // Express removes Content-Type on a 304 response; retain its original type.
    let isHtml = false;
    const setHeader = res.setHeader;
    res.setHeader = function (name, value) {
      if (name.toLowerCase() === 'content-type') isHtml = /^text\/html(?:;|$)/i.test(String(value));
      return setHeader.call(this, name, value);
    };
    res.once('finish', () => {
      if (!ip || !((res.statusCode >= 200 && res.statusCode < 300) || res.statusCode === 304) ||
          !isHtml) return;
      const task = Promise.resolve().then(() => store.record({ ip, pathname, userAgent, visitedAt }))
        .catch(onError).finally(() => pending.delete(task));
      pending.add(task);
    });
    next();
  };
  return { middleware, flush: () => Promise.all([...pending]) };
}

function configureTrustProxy(app, value = '') {
  const proxies = value.trim();
  app.set('trust proxy', proxies ? proxies.split(',').map(proxy => proxy.trim()).filter(Boolean) : false);
}

function createAnalyticsRouter({ store, tracker, onError = error => console.error('[analytics] Read failed:', error.code || error.name) }) {
  const router = express.Router();
  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  function failure(res, error) {
    onError(error);
    res.status(503).json({ error: '访问统计暂时不可用，请稍后重试。' });
  }
  router.get('/summary', async (req, res) => {
    try {
      await tracker.flush();
      res.json(await store.summary());
    } catch (error) { failure(res, error); }
  });
  router.use((req, res) => res.status(404).json({ error: 'Not found' }));
  return router;
}

module.exports = { createAnalyticsStore, createVisitTracker, createAnalyticsRouter, configureTrustProxy, dayRange, normalizeIp };
