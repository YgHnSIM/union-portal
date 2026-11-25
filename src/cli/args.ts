export interface ParsedArgs {
  positionals: string[];
  flags: Map<string, string[]>;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags = new Map<string, string[]>();

  const pushFlag = (key: string, value: string): void => {
    const arr = flags.get(key) ?? [];
    arr.push(value);
    flags.set(key, arr);
  };

  for (let i = 0; i < argv.length; i += 1) {
    const tok = argv[i]!;
    if (tok.startsWith('--')) {
      const body = tok.slice(2);
      const eqIdx = body.indexOf('=');
      if (eqIdx > 0) {
        const key = body.slice(0, eqIdx);
        const val = body.slice(eqIdx + 1);
        pushFlag(key, val);
        continue;
      }
      const key = body;
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        pushFlag(key, next);
        i += 1;
      } else {
        pushFlag(key, 'true');
      }
    } else {
      positionals.push(tok);
    }
  }
  return { positionals, flags };
}

export function flagOne(parsed: ParsedArgs, name: string): string | undefined {
  return parsed.flags.get(name)?.[0];
}

export function flagAll(parsed: ParsedArgs, name: string): string[] {
  return parsed.flags.get(name) ?? [];
}

export function requireFlag(parsed: ParsedArgs, name: string): string {
  const val = flagOne(parsed, name);
  if (!val) {
    throw new Error(`필수 옵션이 누락되었습니다: --${name}`);
  }
  return val;
}
