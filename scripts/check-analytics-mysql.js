'use strict';

// All writes use a connection-local TEMPORARY table, never the live access log.
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
      dateStrings: true,
    });
    // Shadow the real table only on this connection and exercise an old schema.
    await connection.query(`CREATE TEMPORARY TABLE site_visits (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      visited_at DATETIME(3) NOT NULL,
      ip VARCHAR(45) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      path VARCHAR(1024) NOT NULL,
      user_agent VARCHAR(512) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    const pool = { query: (sql, args) => connection.query(
      sql.replace(/^CREATE TABLE IF NOT EXISTS site_visits/, 'CREATE TEMPORARY TABLE IF NOT EXISTS site_visits'), args,
    ) };
    await connection.query(`INSERT INTO site_visits (visited_at, ip, path, user_agent) VALUES
      ('2026-09-23 15:59:59.999', '::1', '/legacy', 'Test'),
      ('2026-09-23 16:00:00.000', '198.51.100.40', '/legacy', 'Test')`);
    const fixedNow = () => new Date('2026-09-24T04:00:00Z');
    const store = createAnalyticsStore({ pool, now: fixedNow });
    assert.equal((await store.initialize()).convertedVisits, 2);
    const snapshotSql = "SELECT ip, DATE_FORMAT(visited_at, '%Y-%m-%d %H:%i:%s.%f') AS storedTime, utc_offset_minutes AS offset FROM site_visits ORDER BY id";
    const [converted] = await connection.query(snapshotSql);
    assert.deepEqual(converted.map(row => [row.storedTime, row.offset]), [
      ['2026-09-23 23:59:59.999000', 480], ['2026-09-24 00:00:00.000000', 480],
    ]);
    assert.deepEqual(converted.map(row => row.ip), ['::1', '198.51.100.40']);
    const restarted = createAnalyticsStore({ pool, now: fixedNow });
    assert.equal((await restarted.initialize()).convertedVisits, 0);
    const [repeated] = await connection.query(snapshotSql);
    assert.deepEqual(repeated, converted);

    await connection.beginTransaction();
    transaction = true;
    const before = await store.summary();
    assert.equal(before.totalVisits, 2);
    assert.equal(before.todayVisits, 1);
    const [start, end] = dayRange('2026-09-24');
    assert.equal(start, '2026-09-24 00:00:00.000');
    assert.equal(end, '2026-09-25 00:00:00.000');
    const pathname = '/__analytics_verify_' + randomUUID();
    const fixture = { pathname, userAgent: 'Test/' + '\u{1f600}'.repeat(600) };
    for (const [timestamp, ip] of [
      ['2026-09-23T15:59:59.999Z', '::ffff:192.0.2.123'],
      ['2026-09-23T16:00:00.000Z', '192.0.2.123'],
      ['2026-09-24T15:59:59.999Z', '192.0.2.123'],
      ['2026-09-24T16:00:00.000Z', '2001:0db8:0:0:0:0:0:123'],
    ]) await store.record({ ...fixture, ip, visitedAt: new Date(timestamp) });
    const after = await store.summary();
    assert.equal(after.totalVisits, before.totalVisits + 4);
    assert.equal(after.todayVisits, before.todayVisits + 2);
    assert.equal(after.uniqueIps, before.uniqueIps + 2);
    assert.equal(after.todayIps, before.todayIps + 1);
    const [rows] = await connection.query(`SELECT ip, path, CHAR_LENGTH(user_agent) AS uaLength,
      DATE_FORMAT(visited_at, '%Y-%m-%d %H:%i:%s.%f') AS storedTime,
      utc_offset_minutes AS offset FROM site_visits WHERE path = ? ORDER BY id`, [pathname]);
    assert.equal(rows.length, 4);
    assert.ok(rows.every(row => row.uaLength === 512 && row.offset === 480));
    assert.deepEqual(rows.map(row => row.ip), ['192.0.2.123', '192.0.2.123', '192.0.2.123', '2001:db8::123']);
    assert.deepEqual(rows.map(row => row.storedTime), [
      '2026-09-23 23:59:59.999000', '2026-09-24 00:00:00.000000',
      '2026-09-24 23:59:59.999000', '2026-09-25 00:00:00.000000',
    ]);
    // A write from the old service during deployment still has offset 0.
    await connection.query(`INSERT INTO site_visits (visited_at, ip, path, user_agent)
      VALUES ('2026-09-23 16:00:00.000', '192.0.2.123', '/old-process', 'Test')`);
    const mixed = await store.summary();
    assert.equal(mixed.todayVisits, after.todayVisits + 1);
    assert.equal(mixed.todayIps, after.todayIps);
    await connection.rollback();
    transaction = false;
    console.log('PASS: old schema migration, no double time shift, UTC+8 storage/day boundaries, IPv4/IPv6, mixed-version counts. Live records unchanged.');
  } catch (error) {
    console.error('Analytics MySQL check failed:', error.code || error.name);
    if (error.code === 'ERR_ASSERTION') console.error(error.message);
    process.exitCode = 1;
  } finally {
    if (connection) {
      if (transaction) await connection.rollback();
      await connection.end(); // Drops the connection-local temporary table.
    }
  }
})();
