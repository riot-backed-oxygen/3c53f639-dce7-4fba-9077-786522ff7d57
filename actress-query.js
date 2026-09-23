'use strict';

const LIST_COLUMNS = 'actress_id,name,name_kana,birthday,birthplace,height_cm,bust_cm,waist_cm,hip_cm,cup_size,image_url,gallery_url,profile_url,activity_from,activity_to,profile_text,listing_data';

function ageParameter(query, key) {
  if (query[key] === undefined || query[key] === '') return null;
  const value = Number(query[key]);
  if (!Number.isSafeInteger(value) || value < 0 || value > 200) {
    throw new RangeError(key + ' must be an integer between 0 and 200');
  }
  return value;
}

function buildActressQueries(query) {
  const page = Math.max(1, Math.trunc(Number(query.page)) || 1);
  const limit = Math.min(48, Math.max(6, Math.trunc(Number(query.limit)) || 12));
  const offset = (page - 1) * limit;
  if (!Number.isSafeInteger(offset)) throw new RangeError('Invalid page');
  const search = String(query.search || '').trim();
  const sort = ['name', 'birthday', 'last_seen_at'].includes(query.sort) ? query.sort : 'last_seen_at';
  const direction = query.direction === 'asc' ? 'ASC' : 'DESC';
  const clauses = [], args = [];
  if (search) {
    clauses.push('(name LIKE ? OR name_kana LIKE ?)');
    args.push('%' + search + '%', '%' + search + '%');
  }

  const minAge = ageParameter(query, 'age_min');
  const maxAge = ageParameter(query, 'age_max');
  if (minAge !== null && maxAge !== null && minAge > maxAge) {
    throw new RangeError('age_min must not exceed age_max');
  }
  if (minAge === 0) {
    // Preserve TIMESTAMPDIFF's zero result for future dates less than a year away.
    clauses.push('TIMESTAMPDIFF(YEAR, birthday, CURDATE()) >= 0');
  } else if (minAge !== null) {
    clauses.push('birthday <= DATE_SUB(CURDATE(), INTERVAL ? YEAR)');
    args.push(minAge);
  }
  if (maxAge !== null) {
    // Age <= N includes everyone who has not reached their (N + 1)th birthday.
    clauses.push('birthday > DATE_SUB(CURDATE(), INTERVAL ? YEAR)');
    args.push(maxAge + 1);
  }
  for (const [lo, hi, column] of [
    ['bust_min', 'bust_max', 'bust_cm'],
    ['waist_min', 'waist_max', 'waist_cm'],
    ['hip_min', 'hip_max', 'hip_cm'],
  ]) {
    for (const [key, operator] of [[lo, '>='], [hi, '<=']]) {
      if (query[key] !== undefined && query[key] !== '') {
        const value = Number(query[key]);
        if (!Number.isFinite(value) || value < 0) throw new RangeError('Invalid ' + key);
        clauses.push(column + ' ' + operator + ' ?');
        args.push(value);
      }
    }
  }
  if (query.cup) {
    // Keep substring matching: for example, searching A also matches AA.
    clauses.push('cup_size LIKE ?');
    args.push('%' + String(query.cup).trim() + '%');
  }
  const where = clauses.length ? ' WHERE ' + clauses.join(' AND ') : '';
  return {
    page, limit,
    countSql: 'SELECT COUNT(*) total FROM actresses' + where,
    countArgs: args,
    rowsSql: 'SELECT ' + LIST_COLUMNS + ' FROM actresses' + where +
      ' ORDER BY ' + sort + ' ' + direction + ', actress_id ' + direction + ' LIMIT ? OFFSET ?',
    rowsArgs: [...args, limit, offset],
  };
}

module.exports = { buildActressQueries };
