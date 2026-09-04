export type RuleLifecycleStatus = 'draft' | 'tested' | 'published';
export type LifecycleAction = 'edit' | 'test' | 'publish' | 'rollback';

const TRANSITIONS: Record<
  RuleLifecycleStatus,
  Partial<Record<LifecycleAction, RuleLifecycleStatus>>
> = {
  draft: { edit: 'draft', test: 'tested' },
  tested: { edit: 'draft', test: 'tested', publish: 'published' },
  published: {
    edit: 'draft',
    test: 'tested',
    publish: 'published',
    rollback: 'published',
  },
};

export class LifecycleError extends Error {
  readonly statusCode = 409 as const;
  readonly title = 'Conflict';

  constructor(
    readonly current: RuleLifecycleStatus,
    readonly action: LifecycleAction,
  ) {
    super(`Cannot ${action} a rule in status '${current}'`);
    this.name = 'LifecycleError';
  }
}

export function can(status: RuleLifecycleStatus, action: LifecycleAction): boolean {
  return TRANSITIONS[status][action] !== undefined;
}

export function next(status: RuleLifecycleStatus, action: LifecycleAction): RuleLifecycleStatus {
  const to = TRANSITIONS[status][action];
  if (to === undefined) {
    throw new LifecycleError(status, action);
  }
  return to;
}

export { TRANSITIONS };
