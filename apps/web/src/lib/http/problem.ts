import { problem } from '../session.js';
import { SessionError } from '../session.js';
import { LifecycleError } from '@rule-engine/shared';
import { ZodError } from 'zod';
import { CompileError } from '@rule-engine/engine';

export class NotFoundError extends Error {
  readonly status = 404 as const;
  readonly title = 'Not Found';
  constructor(detail = 'Not found') {
    super(detail);
  }
}

export class ForbiddenError extends Error {
  readonly status = 403 as const;
  readonly title = 'Forbidden';
  constructor(detail = 'Forbidden') {
    super(detail);
  }
}

/** Map domain errors to RFC 7807 problem+json. */
export function toProblem(err: unknown): Response {
  if (err instanceof LifecycleError) {
    return problem(409, err.title, err.message);
  }
  if (err instanceof ZodError) {
    const firstPath = err.issues[0]?.path.join('.');
    return problem(422, 'Validation Error', 'Request failed Zod validation', {
      issues: err.issues.map((i) => ({
        path: i.path as Array<string | number>,
        message: i.message,
      })),
      ...(firstPath ? { path: firstPath } : {}),
    });
  }
  if (err instanceof CompileError) {
    return problem(422, 'Compile Error', err.message, {
      ...(err.path ? { path: err.path } : {}),
    });
  }
  if (err instanceof NotFoundError) {
    return problem(404, err.title, err.message);
  }
  if (err instanceof ForbiddenError || err instanceof SessionError) {
    return problem(
      'status' in err ? err.status : 403,
      'title' in err ? String(err.title) : 'Forbidden',
      err.message,
    );
  }
  throw err;
}
