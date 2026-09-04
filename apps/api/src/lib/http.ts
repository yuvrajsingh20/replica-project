import type { FastifyReply, FastifyRequest } from 'fastify';

export type ProblemDetails = {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  path?: string;
  issues?: Array<{ path: Array<string | number>; message: string }>;
};

export function sendProblem(
  reply: FastifyReply,
  status: number,
  title: string,
  detail?: string,
  extra?: Partial<ProblemDetails>,
): FastifyReply {
  const body: ProblemDetails = {
    type: `https://httpstatuses.com/${status}`,
    title,
    status,
    ...(detail !== undefined ? { detail } : {}),
    ...extra,
  };
  return reply.status(status).type('application/problem+json').send(body);
}

export function workspaceIdFromRequest(request: FastifyRequest): string | null {
  const header = request.headers['x-workspace-id'];
  if (typeof header === 'string' && header.trim() !== '') return header.trim();
  return null;
}

export function requireWorkspaceId(
  request: FastifyRequest,
  reply: FastifyReply,
): string | null {
  const id = workspaceIdFromRequest(request);
  if (!id) {
    sendProblem(
      reply,
      401,
      'Unauthorized',
      'Missing X-Workspace-Id header (Phase 2 stand-in for JWT; Phase 3 replaces this)',
    );
    return null;
  }
  return id;
}
