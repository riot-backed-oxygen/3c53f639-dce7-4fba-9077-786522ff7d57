'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildActressQueries } = require('../actress-query');

test('screenshot filters use an exclusive lower and inclusive upper birthday boundary', () => {
  const q = buildActressQueries({ age_min: '25', age_max: '35', hip_min: '95', sort: 'birthday' });
  assert.match(q.countSql, /birthday <= DATE_SUB\(CURDATE\(\), INTERVAL \? YEAR\)/);
  assert.match(q.countSql, /birthday > DATE_SUB\(CURDATE\(\), INTERVAL \? YEAR\)/);
  assert.doesNotMatch(q.countSql, /TIMESTAMPDIFF/);
  assert.deepEqual(q.countArgs, [25, 36, 95]);
  assert.deepEqual(q.rowsArgs, [25, 36, 95, 12, 0]);
});

test('every sort direction has a consistent ID tiebreaker for pagination', () => {
  for (const sort of ['name', 'birthday', 'last_seen_at']) {
    for (const direction of ['asc', 'desc']) {
      const q = buildActressQueries({ sort, direction, page: 2 });
      const dir = direction.toUpperCase();
      assert.ok(q.rowsSql.includes(`ORDER BY ${sort} ${dir}, actress_id ${dir}`));
      assert.deepEqual(q.rowsArgs, [12, 12]);
    }
  }
});

test('sort identifiers are allowlisted and substring searches remain parameterized', () => {
  const search = "a'); DROP TABLE actresses;--";
  const q = buildActressQueries({ search, cup: 'A', sort: search, direction: search });
  assert.ok(!q.rowsSql.includes(search));
  assert.match(q.rowsSql, /ORDER BY last_seen_at DESC, actress_id DESC/);
  assert.deepEqual(q.countArgs, ['%' + search + '%', '%' + search + '%', '%A%']);
});

test('empty, one-sided and zero age bounds retain their intended behavior', () => {
  assert.deepEqual(buildActressQueries({ age_min: '', age_max: '' }).countArgs, []);
  assert.deepEqual(buildActressQueries({ age_min: '25' }).countArgs, [25]);
  assert.deepEqual(buildActressQueries({ age_max: '35' }).countArgs, [36]);
  assert.match(buildActressQueries({ age_min: '0' }).countSql, /TIMESTAMPDIFF/);
});

test('bad numeric input is rejected before reaching MySQL', () => {
  for (const query of [
    { age_min: '-1' }, { age_max: '35.5' }, { age_min: 'NaN' },
    { age_min: '36', age_max: '25' }, { hip_min: 'Infinity' }, { page: 'Infinity' },
  ]) assert.throws(() => buildActressQueries(query), RangeError);
});

test('height range is inclusive and combines with age, measurements, sorting and pagination', () => {
  const q = buildActressQueries({
    age_min: '25', height_min: '160', height_max: '170', hip_min: '90',
    sort: 'birthday', direction: 'asc', page: '2', limit: '24',
  });
  assert.match(q.countSql, /height_cm >= \? AND height_cm <= \?/);
  assert.match(q.rowsSql, /height_cm >= \? AND height_cm <= \?/);
  assert.deepEqual(q.countArgs, [25, 160, 170, 90]);
  assert.deepEqual(q.rowsArgs, [25, 160, 170, 90, 24, 24]);
  assert.match(q.rowsSql, /ORDER BY birthday ASC, actress_id ASC/);
});

test('height supports omitted, empty, one-sided and equal bounds', () => {
  for (const query of [{}, { height_min: '', height_max: '' }]) {
    const q = buildActressQueries(query);
    assert.deepEqual(q.countArgs, []);
    assert.doesNotMatch(q.countSql, /height_cm/);
  }
  assert.deepEqual(buildActressQueries({ height_min: '160' }).countArgs, [160]);
  assert.deepEqual(buildActressQueries({ height_max: '170' }).countArgs, [170]);
  assert.deepEqual(buildActressQueries({ height_min: '165', height_max: '165' }).countArgs, [165, 165]);
  assert.deepEqual(buildActressQueries({ height_min: '0', height_max: '160.5' }).countArgs, [0, 160.5]);
});

test('invalid heights and reversed ranges are rejected before SQL execution', () => {
  for (const value of ['-1', 'NaN', 'Infinity', ' ', '160 OR 1=1', ['160'], {}, true, null]) {
    assert.throws(() => buildActressQueries({ height_min: value }), RangeError);
    assert.throws(() => buildActressQueries({ height_max: value }), RangeError);
  }
  assert.throws(() => buildActressQueries({ height_min: '170', height_max: '160' }), RangeError);
});
