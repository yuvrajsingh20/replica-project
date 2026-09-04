# Agent instructions

This project follows the workflow and spec in [CLAUDE.md](./CLAUDE.md). Read it at the start of every session — especially **§2b (Supabase conventions)**.

Work only in the current approved phase. When that phase's Definition of Done is met, run `pnpm check`, post the phase summary, and stop until you get an explicit "approved / go".

**Architecture reminder:** management CRUD lives in Next.js + user session + RLS. Fastify is execute-only (`/v1/execute`). Never put management routes back on Fastify. Runtime DB clients must use the transaction pooler with `prepare: false`; migrations use `DIRECT_URL` only.
