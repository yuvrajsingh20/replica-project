import type { AttrType, InputSchema } from '@rule-engine/shared';

export type CoerceError = { code: string; message: string; path: string };

export type CoerceResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: CoerceError };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

type Ok<T> = { ok: true; value: T };
type Err = { ok: false; error: CoerceError };
type Result<T> = Ok<T> | Err;

function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}
function err(code: string, message: string, path: string): Err {
  return { ok: false, error: { code, message, path } };
}

function coerceNumeric(value: unknown, path: string): Result<number> {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return err('invalid_numeric', 'numeric must be a finite number', path);
    }
    return ok(value);
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (!Number.isFinite(n)) {
      return err('invalid_numeric', 'numeric must be a finite number', path);
    }
    return ok(n);
  }
  return err('invalid_numeric', 'expected numeric', path);
}

function coerceBoolean(value: unknown, path: string): Result<boolean> {
  if (typeof value === 'boolean') return ok(value);
  return err('invalid_boolean', 'expected boolean', path);
}

function coerceString(value: unknown, path: string): Result<string> {
  if (typeof value === 'string') return ok(value);
  return err('invalid_string', 'expected string', path);
}

function coerceDateLike(
  value: unknown,
  path: string,
  kind: 'date' | 'datetime',
): Result<Date> {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      return err(`invalid_${kind}`, `invalid ${kind}`, path);
    }
    return ok(value);
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) {
      return err(`invalid_${kind}`, `invalid ${kind}`, path);
    }
    return ok(d);
  }
  return err(`invalid_${kind}`, `expected ${kind}`, path);
}

function coerceList(value: unknown, path: string): Result<unknown[]> {
  if (Array.isArray(value)) return ok(value);
  return err('invalid_list', 'expected list', path);
}

function coerceAttr(value: unknown, type: AttrType, path: string): Result<unknown> {
  switch (type) {
    case 'string':
      return coerceString(value, path);
    case 'numeric':
      return coerceNumeric(value, path);
    case 'boolean':
      return coerceBoolean(value, path);
    case 'date':
      return coerceDateLike(value, path, 'date');
    case 'datetime':
      return coerceDateLike(value, path, 'datetime');
    case 'json':
      return ok(value);
    case 'list':
      return coerceList(value, path);
  }
}

export function coerceInput(input: unknown, schema: InputSchema): CoerceResult {
  if (!isPlainObject(input)) {
    return err('invalid_input', 'input must be an object', '');
  }

  const out: Record<string, unknown> = { ...input };

  for (const attr of schema.attributes) {
    const path = attr.name;
    const has = Object.prototype.hasOwnProperty.call(input, attr.name);
    const raw = input[attr.name];

    if (!has || raw === undefined) {
      if (attr.required) {
        return err('required', `missing required attribute '${attr.name}'`, path);
      }
      continue;
    }

    if (raw === null) {
      out[attr.name] = null;
      continue;
    }

    const coerced = coerceAttr(raw, attr.type, path);
    if (!coerced.ok) return coerced;
    out[attr.name] = coerced.value;
  }

  return ok(out);
}
