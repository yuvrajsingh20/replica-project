import type { Operator } from '@rule-engine/shared';
import { CompileError } from './errors.js';
import type { CompiledOperand } from './operand.js';
import { resolveRight } from './operand.js';

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

export type CompiledPredicate = (input: Record<string, unknown>) => boolean;

export function compileOperator(
  op: Operator,
  left: CompiledOperand,
  right: CompiledOperand | CompiledOperand[] | undefined,
  path: string,
): CompiledPredicate {
  if (op === 'matches') {
    if (right === undefined || Array.isArray(right)) {
      throw new CompileError('matches requires a single right operand', path);
    }
    // Probe const-only pattern at compile time when possible by evaluating empty input —
    // pattern must be a string; we compile regex lazily on first execute if attr-backed,
    // but prefer const: call right once with empty object if it's a pure const.
    const probe = right({});
    if (typeof probe === 'string') {
      let re: RegExp;
      try {
        re = new RegExp(probe);
      } catch (err) {
        throw new CompileError(
          `invalid regex: ${err instanceof Error ? err.message : String(err)}`,
          path,
        );
      }
      return (input) => {
        const l = left(input);
        if (isNullish(l)) return false;
        const s = asString(l);
        if (s === null) return false;
        return re.test(s);
      };
    }
    return (input) => {
      const l = left(input);
      const r = right(input);
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
    return (input) => {
      const l = left(input);
      const r = resolveRight(right, input);

      if (op === 'in' || op === 'not_in') {
        if (isNullish(l)) return false;
        const set = membershipSet(r);
        if (!set) {
          if (isNullish(r)) return false;
          const hit = valuesEqual(l, r);
          return op === 'in' ? hit : !hit;
        }
        let hit = false;
        for (const item of set) {
          if (valuesEqual(l, item)) {
            hit = true;
            break;
          }
        }
        return op === 'in' ? hit : !hit;
      }

      const list = asArray(l);
      if (!list) return false;
      const set = membershipSet(r);
      if (!set) return false;
      if (op === 'any_in') {
        return list.some((item) => {
          if (isNullish(item)) return false;
          for (const s of set) {
            if (valuesEqual(item, s)) return true;
          }
          return false;
        });
      }
      if (list.length === 0) return true;
      return list.every((item) => {
        if (isNullish(item)) return false;
        for (const s of set) {
          if (valuesEqual(item, s)) return true;
        }
        return false;
      });
    };
  }

  return (input) => {
    const l = left(input);
    const r = resolveRight(right, input);

    switch (op) {
      case 'is_null':
        return isNullish(l);
      case 'is_not_null':
        return !isNullish(l);
      case 'eq': {
        if (isNullish(l) && isNullish(r)) return true;
        if (isNullish(l) || isNullish(r)) {
          // eq null: one side nullish — only true when both nullish (handled above)
          // Spec: eq null is allowed; if one is null and other isn't → false
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
