import type { Operand, Operator } from '@rule-engine/shared';
import type { ExecEnv } from './env.js';
import { CompileError } from './errors.js';
import {
  constRightValues,
  isConstRight,
  resolveRight,
  type CompiledOperand,
} from './operand.js';

function isNullish(v: unknown): boolean {
  return v === null || v === undefined;
}

function toComparableNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (v instanceof Date) {
    const t = v.getTime();
    return Number.isNaN(t) ? null : t;
  }
  if (typeof v === 'string' && v.trim() !== '') {
    const asNum = Number(v);
    if (Number.isFinite(asNum) && !/^\d{4}-\d{2}-\d{2}/.test(v)) return asNum;
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d.getTime();
    if (Number.isFinite(asNum)) return asNum;
  }
  return null;
}

function asString(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function asArray(v: unknown): unknown[] | null {
  return Array.isArray(v) ? v : null;
}

function lengthOf(v: unknown): number | null {
  if (typeof v === 'string' || Array.isArray(v)) return v.length;
  return null;
}

function membershipSet(right: unknown): Set<unknown> | null {
  if (Array.isArray(right)) return new Set(right);
  return null;
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return Object.is(a, b);
}

function setHas(set: Set<unknown>, value: unknown): boolean {
  for (const item of set) {
    if (valuesEqual(value, item)) return true;
  }
  return false;
}

export type CompiledPredicate = (env: ExecEnv) => boolean;

export function compileOperator(
  op: Operator,
  left: CompiledOperand,
  right: CompiledOperand | CompiledOperand[] | undefined,
  path: string,
  rightSource?: Operand | Operand[],
): CompiledPredicate {
  if (op === 'matches') {
    if (right === undefined || Array.isArray(right)) {
      throw new CompileError('matches requires a single right operand', path);
    }
    if (
      rightSource !== undefined &&
      !Array.isArray(rightSource) &&
      rightSource.kind === 'const' &&
      typeof rightSource.value === 'string'
    ) {
      let re: RegExp;
      try {
        re = new RegExp(rightSource.value);
      } catch (err) {
        throw new CompileError(
          `invalid regex: ${err instanceof Error ? err.message : String(err)}`,
          path,
        );
      }
      return (env) => {
        const l = left(env);
        if (isNullish(l)) return false;
        const s = asString(l);
        if (s === null) return false;
        return re.test(s);
      };
    }
    return (env) => {
      const l = left(env);
      const r = right(env);
      if (isNullish(l) || isNullish(r)) return false;
      const s = asString(l);
      const pattern = asString(r);
      if (s === null || pattern === null) return false;
      try {
        return new RegExp(pattern).test(s);
      } catch {
        return false;
      }
    };
  }

  if (op === 'in' || op === 'not_in' || op === 'any_in' || op === 'all_in') {
    const prebuilt =
      rightSource !== undefined &&
      Array.isArray(rightSource) &&
      isConstRight(rightSource)
        ? new Set(constRightValues(rightSource))
        : undefined;

    return (env) => {
      const l = left(env);
      const r = prebuilt ?? resolveRight(right, env);
      const set = r instanceof Set ? r : membershipSet(r);

      if (op === 'in' || op === 'not_in') {
        if (isNullish(l)) return false;
        if (!set) {
          if (isNullish(r)) return false;
          const hit = valuesEqual(l, r);
          return op === 'in' ? hit : !hit;
        }
        const hit = setHas(set, l);
        return op === 'in' ? hit : !hit;
      }

      const list = asArray(l);
      if (!list) return false;
      if (!set) return false;
      if (op === 'any_in') {
        return list.some((item) => {
          if (isNullish(item)) return false;
          return setHas(set, item);
        });
      }
      if (list.length === 0) return true;
      return list.every((item) => {
        if (isNullish(item)) return false;
        return setHas(set, item);
      });
    };
  }

  return (env) => {
    const l = left(env);
    const r = resolveRight(right, env);

    switch (op) {
      case 'is_null':
        return isNullish(l);
      case 'is_not_null':
        return !isNullish(l);
      case 'eq': {
        if (isNullish(l) && isNullish(r)) return true;
        if (isNullish(l) || isNullish(r)) {
          return false;
        }
        return valuesEqual(l, r);
      }
      case 'neq': {
        if (isNullish(l) || isNullish(r)) return false;
        return !valuesEqual(l, r);
      }
      case 'gt':
      case 'gte':
      case 'lt':
      case 'lte': {
        if (isNullish(l) || isNullish(r)) return false;
        const ln = toComparableNumber(l);
        const rn = toComparableNumber(r);
        if (ln === null || rn === null) return false;
        if (op === 'gt') return ln > rn;
        if (op === 'gte') return ln >= rn;
        if (op === 'lt') return ln < rn;
        return ln <= rn;
      }
      case 'between': {
        if (isNullish(l)) return false;
        if (!Array.isArray(r) || r.length !== 2) return false;
        const [lo, hi] = r;
        if (isNullish(lo) || isNullish(hi)) return false;
        const ln = toComparableNumber(l);
        const lon = toComparableNumber(lo);
        const hin = toComparableNumber(hi);
        if (ln === null || lon === null || hin === null) return false;
        return ln >= lon && ln <= hin;
      }
      case 'contains':
      case 'not_contains': {
        if (isNullish(l) || isNullish(r)) return false;
        const s = asString(l);
        const needle = asString(r);
        if (s === null || needle === null) return false;
        const hit = s.includes(needle);
        return op === 'contains' ? hit : !hit;
      }
      case 'starts_with': {
        if (isNullish(l) || isNullish(r)) return false;
        const s = asString(l);
        const prefix = asString(r);
        if (s === null || prefix === null) return false;
        return s.startsWith(prefix);
      }
      case 'ends_with': {
        if (isNullish(l) || isNullish(r)) return false;
        const s = asString(l);
        const suffix = asString(r);
        if (s === null || suffix === null) return false;
        return s.endsWith(suffix);
      }
      case 'length_eq':
      case 'length_gt':
      case 'length_lt': {
        if (isNullish(l) || isNullish(r)) return false;
        const len = lengthOf(l);
        const rn = toComparableNumber(r);
        if (len === null || rn === null) return false;
        if (op === 'length_eq') return len === rn;
        if (op === 'length_gt') return len > rn;
        return len < rn;
      }
      default:
        return false;
    }
  };
}
