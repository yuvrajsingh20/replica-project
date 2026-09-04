/**
 * Gemini swarm helper.
 *
 * Independent prompts fan out with Promise.all (bounded concurrency).
 * Same prompt N times = best-of-n. Billing is not a reason to skip a call.
 *
 *   pnpm llm:swarm "prompt a" "prompt b"
 *   pnpm llm:swarm --best-of 3 "rewrite this fixture"
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';

loadEnv();

const DEFAULT_MODEL = 'gemini-2.5-flash';
const DEFAULT_CONCURRENCY = 8;

export type GeminiTextResult = {
  index: number;
  prompt: string;
  text: string;
  model: string;
};

function loadEnv(): void {
  const cwd = process.cwd();
  applyEnvFile(resolve(cwd, '.env'), false);
  applyEnvFile(resolve(cwd, '.env.local'), true);
}

function applyEnvFile(path: string, override: boolean): void {
  const parsed = config({ path, override: false }).parsed;
  if (!parsed) return;
  for (const [name, value] of Object.entries(parsed)) {
    if (value.trim() === '') continue;
    if (!override && process.env[name] !== undefined && process.env[name] !== '') continue;
    process.env[name] = value;
  }
}

function apiKey(): string {
  let key = (process.env['GEMINI_API_KEY'] ?? process.env['GOOGLE_GENERATIVE_AI_API_KEY'] ?? '')
    .trim()
    .replace(/^['"]|['"]$/g, '');
  if (!key) {
    throw new Error('GEMINI_API_KEY is missing. Set it in .env (or .env.local).');
  }
  // Google API keys are AIzaSy + 33 chars (39 total). A longer value is almost always
  // a screenshot/OCR paste with trailing garbage — Gemini then returns API_KEY_INVALID.
  if (key.startsWith('AIzaSy') && key.length > 39) {
    key = key.slice(0, 39);
  }
  return key;
}

function modelName(): string {
  return process.env['GEMINI_MODEL'] ?? DEFAULT_MODEL;
}

export async function generateGemini(
  prompt: string,
  opts?: { temperature?: number; model?: string },
): Promise<string> {
  const model = opts?.model ?? modelName();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const body: Record<string, unknown> = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
  };
  if (opts?.temperature !== undefined) {
    body['generationConfig'] = { temperature: opts.temperature };
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey(),
    },
    body: JSON.stringify(body),
  });
  const json: unknown = await res.json();
  if (!res.ok) {
    throw new Error(`Gemini ${res.status}: ${JSON.stringify(json)}`);
  }
  return extractText(json);
}

/** Fan-out: every prompt in parallel (swarm). */
export async function generateSwarm(
  prompts: string[],
  opts?: { concurrency?: number; temperature?: number; model?: string },
): Promise<GeminiTextResult[]> {
  const concurrency = opts?.concurrency ?? DEFAULT_CONCURRENCY;
  const model = opts?.model ?? modelName();
  const results = await mapPool(prompts, concurrency, async (prompt, index) => {
    const text = await generateGemini(prompt, {
      ...(opts?.temperature !== undefined ? { temperature: opts.temperature } : {}),
      model,
    });
    return { index, prompt, text, model };
  });
  return results;
}

/** Same prompt N times in parallel; returns all candidates (caller picks). */
export async function generateBestOf(
  prompt: string,
  n: number,
  opts?: { concurrency?: number; temperature?: number; model?: string },
): Promise<GeminiTextResult[]> {
  return generateSwarm(Array.from({ length: n }, () => prompt), opts);
}

async function mapPool<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      const item = items[index];
      if (item === undefined) return;
      out[index] = await fn(item, index);
    }
  });
  await Promise.all(workers);
  return out;
}

function extractText(json: unknown): string {
  if (typeof json !== 'object' || json === null) {
    throw new Error('Gemini returned a non-object body');
  }
  const candidates = (json as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || candidates[0] === undefined) {
    throw new Error(`Gemini returned no candidates: ${JSON.stringify(json)}`);
  }
  const content = (candidates[0] as { content?: { parts?: { text?: string }[] } }).content;
  const parts = content?.parts ?? [];
  const text = parts
    .map((p) => p.text ?? '')
    .join('')
    .trim();
  if (!text) {
    throw new Error(`Gemini returned empty text: ${JSON.stringify(json)}`);
  }
  return text;
}

function parseArgs(argv: string[]): { bestOf: number; prompts: string[] } {
  let bestOf = 1;
  const prompts: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--best-of') {
      const raw = argv[i + 1];
      if (raw === undefined) throw new Error('--best-of needs a number');
      bestOf = Number(raw);
      i += 1;
      continue;
    }
    if (arg !== undefined) prompts.push(arg);
  }
  return { bestOf, prompts };
}

const SMOKE_PROMPTS = [
  'Reply with exactly: swarm-ok-1',
  'Reply with exactly: swarm-ok-2',
  'Reply with exactly: swarm-ok-3',
];

async function main(): Promise<void> {
  const { bestOf, prompts } = parseArgs(process.argv.slice(2));
  const smoke = prompts.length === 0;
  if (smoke) {
    process.stdout.write('No prompts given — running a 3-call parallel smoke test.\n');
  }
  const results =
    bestOf > 1
      ? await generateBestOf(prompts[0] ?? SMOKE_PROMPTS[0] ?? '', bestOf)
      : await generateSwarm(smoke ? SMOKE_PROMPTS : prompts);
  for (const r of results) {
    process.stdout.write(`--- [${r.index}] ${r.model} ---\n${r.text}\n\n`);
  }
}

const isCli = import.meta.url === `file://${process.argv[1]}`;
if (isCli) {
  main().catch((err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
}
