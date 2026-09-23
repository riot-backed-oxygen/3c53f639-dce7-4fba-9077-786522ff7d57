'use strict';

const express = require('express');
const { isIP } = require('node:net');
const path = require('node:path');

const DAY_MS = 86400000;
const SHANGHAI_OFFSET_MS = 8 * 3600000;
// Render forwards through private load balancers and Cloudflare. Their hop count
// can vary, so trust the proxy networks and stop at the first other address.
// Cloudflare's official ranges, checked 2026-09-24:
// https://api.cloudflare.com/client/v4/ips
const RENDER_TRUSTED_PROXIES = [
  'loopback', 'linklocal', 'uniquelocal',
  '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22',
  '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20',
  '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13',
  '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
  '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32',
  '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32',
];
const CREATE_TABLE_SQL = `CREATE TABLE IF NOT EXISTS site_visits (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  visited_at DATETIME(3) NOT NULL,
  utc_offset_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  ip VARCHAR(45) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  path VARCHAR(1024) NOT NULL,
  user_agent VARCHAR(512) NOT NULL,
  INDEX idx_site_visits_time (visited_at, id),
  INDEX idx_site_visits_ip_time (ip, visited_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

function sqlDate(date) {
  // DATETIME stores a wall-clock value, independent of Node/MySQL's local timezone.
  return new Date(date.getTime() + SHANGHAI_OFFSET_MS).toISOString().slice(0, 23).replace('T', ' ');
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

async function initializeAnalyticsSchema(pool) {
  await pool.query(CREATE_TABLE_SQL);
  const [columns] = await pool.query("SHOW COLUMNS FROM site_visits LIKE 'utc_offset_minutes'");
  if (!columns.length) {
    try {
      await pool.query('ALTER TABLE site_visits ADD COLUMN utc_offset_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 0');
    } catch (error) {
      // Another process may have added the column while this one was starting.
      if (error.code !== 'ER_DUP_FIELDNAME') throw error;
    }
  }
  // The timestamp and marker change in one atomic UPDATE, so retries never shift twice.
  // The zero default also identifies writes from an old process during deployment.
  const [result] = await pool.query(`UPDATE site_visits
    SET visited_at = DATE_ADD(visited_at, INTERVAL 8 HOUR), utc_offset_minutes = 480
    WHERE utc_offset_minutes = 0`);
  return { convertedVisits: Number(result.affectedRows) };
}

function createAnalyticsStore({ pool, now = () => new Date() }) {
  let initialization;
  function initialize() {
    if (!initialization) {
      initialization = initializeAnalyticsSchema(pool).catch(error => {
        initialization = undefined;
        throw error;
      });
    }
    return initialization;
  }
  return {
    initialize,
    async record({ ip, pathname, userAgent, visitedAt = now() }) {
      const normalizedIp = normalizeIp(ip);
      if (!normalizedIp) throw new TypeError('A valid IPv4 or IPv6 address is required');
      const storedUserAgent = boundedText(userAgent, 512);
      if (!storedUserAgent.trim()) return;
      await initialize();
      await pool.query('INSERT INTO site_visits (visited_at, ip, path, user_agent, utc_offset_minutes) VALUES (?, ?, ?, ?, 480)', [
        sqlDate(visitedAt), normalizedIp, boundedText(pathname, 1024), storedUserAgent,
      ]);
    },
    async summary() {
      const day = new Date(now().getTime() + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10);
      const bounds = dayRange(day);
      await initialize();
      // Keep counts correct if an older process writes UTC during a rolling restart.
      const localTime = 'CASE WHEN utc_offset_minutes = 0 THEN DATE_ADD(visited_at, INTERVAL 8 HOUR) ELSE visited_at END';
      const [[row]] = await pool.query(`SELECT COUNT(*) AS totalVisits, COUNT(DISTINCT ip) AS uniqueIps,
        COALESCE(SUM((${localTime}) >= ? AND (${localTime}) < ?), 0) AS todayVisits,
        COUNT(DISTINCT CASE WHEN (${localTime}) >= ? AND (${localTime}) < ? THEN ip END) AS todayIps
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

function configureTrustProxy(app, value = '', { isRender = process.env.RENDER === 'true' } = {}) {
  const proxies = value.trim();
  // Upgrade the old Render recommendation (TRUST_PROXY=1) as well, so existing
  // deployments do not keep selecting the last private load balancer in XFF.
  if (proxies === 'render' || (isRender && (!proxies || proxies === '1'))) {
    app.set('trust proxy', RENDER_TRUSTED_PROXIES);
  } else if (!proxies || proxies === 'false' || proxies === '0') {
    app.set('trust proxy', false);
  } else if (/^\d+$/.test(proxies)) {
    const hops = Number(proxies);
    if (!Number.isSafeInteger(hops)) throw new RangeError('TRUST_PROXY hop count is too large');
    app.set('trust proxy', hops);
  } else {
    app.set('trust proxy', proxies.split(',').map(proxy => proxy.trim()).filter(Boolean));
  }
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
