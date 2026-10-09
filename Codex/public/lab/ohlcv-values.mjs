// Shared provider contract: never coerce JSON containers into financial values.
export function ohlcvNumber(value) {
  if (typeof value !== 'number' && typeof value !== 'string') throw new Error('Invalid OHLCV value type');
  if (typeof value === 'string' && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim())) throw new Error('Non-decimal OHLCV value');
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error('Non-numeric OHLCV value');
  return number;
}

function calendarDate(value) {
  const millis = Date.parse(value);
  if (!Number.isFinite(millis) || new Date(millis).toISOString().slice(0, 10) !== value) throw new Error('Invalid bar date');
  return value;
}

function vietnamDate(millis) {
  const date = new Date(millis + 7 * 3600000);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid timestamp');
  const session = date.toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(session)) throw new Error('Invalid bar date');
  return session;
}

export function providerSessionDate(value) {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid timestamp');
    return vietnamDate(value < 1e12 ? value * 1000 : value);
  }
  if (typeof value !== 'string') throw new Error('Invalid bar date');
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return calendarDate(value);
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(value)) {
    const [day, month, year] = value.split('/');
    return calendarDate(`${year}-${month}-${day}`);
  }
  // An instant must declare its timezone. Date-only values already name a session.
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) throw new Error('Invalid bar date');
  calendarDate(match[1]);
  if (Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4]) > 59) throw new Error('Invalid timestamp');
  if (match[5] !== 'Z' && (Number(match[5].slice(1, 3)) > 23 || Number(match[5].slice(4)) > 59)) throw new Error('Invalid timezone');
  return vietnamDate(Date.parse(value));
}
