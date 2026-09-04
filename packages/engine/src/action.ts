import type { Action } from '@rule-engine/shared';
import type { ExecEnv } from './env.js';
import { compileFormula } from './formula.js';
import { compileOperand } from './operand.js';
import { compilePathGetter } from './path.js';

export type CompiledAction = (env: ExecEnv) => void;

const TOKEN_RE = /\{\{\s*([^}]+?)\s*\}\}/g;

type TemplatePart =
  | { kind: 'lit'; text: string }
  | { kind: 'ref'; source: 'attr' | 'global' | 'output'; path: string; get?: (obj: Record<string, unknown>) => unknown }
  | { kind: 'unknown'; token: string };

function compileTemplateParts(text: string): TemplatePart[] {
  const parts: TemplatePart[] = [];
  let last = 0;
  for (const match of text.matchAll(TOKEN_RE)) {
    const index = match.index ?? 0;
    if (index > last) {
      parts.push({ kind: 'lit', text: text.slice(last, index) });
    }
    const token = (match[1] ?? '').trim();
    const m = /^(attr|global|output)\.(.+)$/.exec(token);
    if (!m) {
      parts.push({ kind: 'unknown', token });
    } else {
      const source = m[1] as 'attr' | 'global' | 'output';
      const path = m[2]!;
      if (source === 'output') {
        parts.push({ kind: 'ref', source, path });
      } else {
        parts.push({ kind: 'ref', source, path, get: compilePathGetter(path) });
      }
    }
    last = index + match[0].length;
  }
  if (last < text.length) {
    parts.push({ kind: 'lit', text: text.slice(last) });
  }
  return parts;
}

function renderValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

export function compileTemplate(text: string): (env: ExecEnv) => string {
  const parts = compileTemplateParts(text);
  return (env) => {
    let out = '';
    for (const part of parts) {
      if (part.kind === 'lit') {
        out += part.text;
        continue;
      }
      if (part.kind === 'unknown') {
        env.unknownTokens.push(part.token);
        continue;
      }
      if (part.source === 'attr') {
        out += renderValue(part.get!(env.input));
      } else if (part.source === 'global') {
        out += renderValue(part.get!(env.globals));
      } else {
        out += renderValue(env.output[part.path]);
      }
    }
    return out;
  };
}

export function compileAction(action: Action, path: string): CompiledAction {
  if (action.kind === 'set') {
    const value = compileOperand(action.value, `${path}.value`);
    return (env) => {
      env.output[action.key] = value(env);
    };
  }
  if (action.kind === 'template') {
    const render = compileTemplate(action.text);
    return (env) => {
      env.output[action.key] = render(env);
    };
  }
  const expr = compileFormula(action.expr, `${path}.expr`);
  return (env) => {
    env.output[action.key] = expr(env);
  };
}

export function compileActions(actions: Action[], path: string): CompiledAction[] {
  return actions.map((a, i) => compileAction(a, `${path}.${i}`));
}

export function applyActions(actions: CompiledAction[], env: ExecEnv): Record<string, unknown> {
  for (const action of actions) {
    action(env);
  }
  return env.output;
}
