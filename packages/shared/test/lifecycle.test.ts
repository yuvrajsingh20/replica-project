import { describe, expect, it } from 'vitest';
import {
  can,
  LifecycleError,
  next,
  TRANSITIONS,
  type LifecycleAction,
  type RuleLifecycleStatus,
} from '../src/lifecycle.js';

const STATUSES: RuleLifecycleStatus[] = ['draft', 'tested', 'published'];
const ACTIONS: LifecycleAction[] = ['edit', 'test', 'publish', 'rollback'];

describe('lifecycle state machine', () => {
  it('pins the full transition matrix', () => {
    expect(TRANSITIONS).toEqual({
      draft: { edit: 'draft', test: 'tested' },
      tested: { edit: 'draft', test: 'tested', publish: 'published' },
      published: {
        edit: 'draft',
        test: 'tested',
        publish: 'published',
        rollback: 'published',
      },
    });
  });

  for (const status of STATUSES) {
    for (const action of ACTIONS) {
      const allowed = TRANSITIONS[status][action] !== undefined;
      it(`${status} + ${action} → ${allowed ? TRANSITIONS[status][action] : 'illegal'}`, () => {
        expect(can(status, action)).toBe(allowed);
        if (allowed) {
          expect(next(status, action)).toBe(TRANSITIONS[status][action]);
        } else {
          expect(() => next(status, action)).toThrow(LifecycleError);
        }
      });
    }
  }

  it('editing published returns draft without claiming env pointer changes', () => {
    expect(next('published', 'edit')).toBe('draft');
  });

  it('publish from draft is illegal (409)', () => {
    expect(can('draft', 'publish')).toBe(false);
    try {
      next('draft', 'publish');
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(LifecycleError);
      expect((err as LifecycleError).statusCode).toBe(409);
    }
  });

  it('test is allowed from any status and lands on tested', () => {
    expect(next('draft', 'test')).toBe('tested');
    expect(next('tested', 'test')).toBe('tested');
    expect(next('published', 'test')).toBe('tested');
  });
});
