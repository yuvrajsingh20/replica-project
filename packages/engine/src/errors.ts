export class CompileError extends Error {
  readonly path: string;

  constructor(message: string, path: string) {
    super(message);
    this.name = 'CompileError';
    this.path = path;
  }
}
