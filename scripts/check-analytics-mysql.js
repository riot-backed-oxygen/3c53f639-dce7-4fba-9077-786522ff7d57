'use strict';

// Creates the analytics table if needed; all synthetic visits are rolled back.
require('dotenv').config();
const assert = require('node:assert/strict');
const mysql = require('mysql2/promise');
const { randomUUID } = require('node:crypto');
const { createAnalyticsStore, dayRange } = require('../analytics');

(async () => {
  let connection, transaction = false;
  try {
    connection = await mysql.createConnection({
      host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'actresses', charset: 'utf8mb4', connectTimeout: 5000,
    });
    const store = createAnalyticsStore({ pool: connection, now: () => new Date('2026-09-24T04:00:00Z') });
    await store.initialize();
    await connection.beginTransaction();
    transaction = true;
    const before = await store.summary();
    const [start, end] = dayRange('2026-09-24');
    const [[existing]] = await connection.query(`SELECT COUNT(DISTINCT ip) AS allIps,
      COUNT(DISTINCT CASE WHEN ip = ? AND visited_at >= ? AND visited_at < ? THEN ip END) AS todayIps
      FROM site_visits WHERE ip IN (?, ?)`, ['192.0.2.123', start, end, '192.0.2.123', '2001:db8::123']);
    const pathname = '/__analytics_verify_' + randomUUID();
    const fixture = { ip: '192.0.2.123', pathname, userAgent: 'Test/' + '\u{1f600}'.repeat(600) };
    for (const [timestamp, ip] of [
      ['2026-09-23T15:59:59.999Z', fixture.ip],
      ['2026-09-23T16:00:00.000Z', fixture.ip],
      ['2026-09-24T15:59:59.999Z', fixture.ip],
      ['2026-09-24T16:00:00.000Z', '2001:db8::123'],
    ]) await store.record({ ...fixture, ip, visitedAt: new Date(timestamp) });
    const after = await store.summary();
    assert.equal(after.totalVisits, before.totalVisits + 4);
    assert.equal(after.todayVisits, before.todayVisits + 2);
    assert.equal(after.uniqueIps, before.uniqueIps + 2 - Number(existing.allIps));
    assert.equal(after.todayIps, before.todayIps + 1 - Number(existing.todayIps));
    const [rows] = await connection.query('SELECT ip, path, CHAR_LENGTH(user_agent) AS uaLength FROM site_visits WHERE path = ?', [pathname]);
    assert.equal(rows.length, 4);
    assert.ok(rows.every(row => row.uaLength === 512));
    await connection.rollback();
    transaction = false;
    const [[remaining]] = await connection.query('SELECT COUNT(*) AS total FROM site_visits WHERE path = ?', [pathname]);
    assert.equal(Number(remaining.total), 0);
    console.log('PASS: MySQL schema, stored visits, distinct IPs, UTC+8 boundaries, UTF-8 limits; fixtures rolled back.');
  } catch (error) {
    console.error('Analytics MySQL check failed:', error.code || error.name);
    process.exitCode = 1;
  } finally {
    if (connection) {
      if (transaction) await connection.rollback();
      await connection.end();
    }
  }
})();
