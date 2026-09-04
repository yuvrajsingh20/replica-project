export type Getter = (input: Record<string, unknown>) => unknown;

export function compilePathGetter(path: string): Getter {
  const parts = path.split('.');
  return (input) => {
    let cur: unknown = input;
    for (const part of parts) {
      if (cur === null || cur === undefined) return undefined;
      if (typeof cur !== 'object') return undefined;
      cur = (cur as Record<string, unknown>)[part];
    }
    return cur;
  };
}
