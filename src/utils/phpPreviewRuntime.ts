import type { VirtualProjectFile } from './artifactStreamParser';

export interface PhpExecutionOptions {
  files: VirtualProjectFile[];
  entryPath: string;
  routeUrl?: string;
  method?: 'GET' | 'POST';
  formData?: Record<string, string>;
  darkMode?: boolean;
}

export interface PhpExecutionResult {
  html: string;
  rawOutput: string;
  statusCode: number;
  routes: string[];
  error?: string;
}

type PhpVal = string | number | boolean | null | PhpArray | PhpCallable;
interface PhpArray {
  __isPhpArray: true;
  entries: Map<string | number, PhpVal>;
}
interface PhpCallable {
  __isPhpCallable: true;
  params: string[];
  body: string;
}

function makePhpArray(init?: Array<[string | number, PhpVal]>): PhpArray {
  return { __isPhpArray: true, entries: new Map(init || []) };
}

function isPhpArray(v: unknown): v is PhpArray {
  return Boolean(v && typeof v === 'object' && '__isPhpArray' in (v as object));
}

function isPhpCallable(v: unknown): v is PhpCallable {
  return Boolean(v && typeof v === 'object' && '__isPhpCallable' in (v as object));
}

function toPhpBool(v: PhpVal): boolean {
  if (v === null || v === false || v === 0 || v === '' || v === '0') return false;
  if (isPhpArray(v)) return v.entries.size > 0;
  return Boolean(v);
}

function toPhpString(v: PhpVal): string {
  if (v === null || v === false) return '';
  if (v === true) return '1';
  if (isPhpArray(v)) return 'Array';
  if (isPhpCallable(v)) return 'Closure';
  return String(v);
}

function toPhpNumber(v: PhpVal): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') {
    const parsed = parseFloat(v);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function isPhpNumericString(v: string): boolean {
  return /^\s*[+-]?(\d+(\.\d+)?|\.\d+)\s*$/.test(v);
}

function phpLooseEqual(a: PhpVal, b: PhpVal): boolean {
  if (a === b) return true;
  if (typeof a === 'boolean' || typeof b === 'boolean') {
    return toPhpBool(a) === toPhpBool(b);
  }
  if (a === null) {
    return b === '' || (isPhpArray(b) && b.entries.size === 0);
  }
  if (b === null) {
    return a === '' || (isPhpArray(a) && a.entries.size === 0);
  }
  if (typeof a === 'number' && typeof b === 'string' && isPhpNumericString(b)) {
    return a === Number(b);
  }
  if (typeof b === 'number' && typeof a === 'string' && isPhpNumericString(a)) {
    return Number(a) === b;
  }
  if (
    typeof a === 'string' &&
    typeof b === 'string' &&
    isPhpNumericString(a) &&
    isPhpNumericString(b)
  ) {
    return Number(a) === Number(b);
  }
  return false;
}

function phpToJsJson(v: PhpVal): unknown {
  if (v === null || typeof v !== 'object') return v;
  if (isPhpArray(v)) {
    const keys = Array.from(v.entries.keys());
    const isSeq = keys.every((k, idx) => k === idx);
    if (isSeq) {
      return Array.from(v.entries.values()).map(phpToJsJson);
    }
    const obj: Record<string, unknown> = {};
    for (const [k, val] of v.entries.entries()) {
      obj[String(k)] = phpToJsJson(val);
    }
    return obj;
  }
  return null;
}

function jsJsonToPhp(v: unknown): PhpVal {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  if (Array.isArray(v)) {
    return makePhpArray(v.map((item, idx) => [idx, jsJsonToPhp(item)]));
  }
  if (typeof v === 'object') {
    return makePhpArray(
      Object.entries(v as Record<string, unknown>).map(([k, val]) => [k, jsJsonToPhp(val)])
    );
  }
  return String(v);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function unescapeHtml(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function normalizePath(p: string): string {
  const parts: string[] = [];
  for (const seg of p.replace(/\\/g, '/').replace(/^\/+/, '').split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      parts.pop();
    } else {
      parts.push(seg);
    }
  }
  return parts.join('/');
}

function resolveRelativeFilePath(baseFile: string, target: string): string {
  const cleanTarget = target.trim().replace(/^['"]|['"]$/g, '');
  if (!cleanTarget) return '';
  if (cleanTarget.startsWith('/')) return normalizePath(cleanTarget);
  const dir = baseFile.includes('/') ? baseFile.slice(0, baseFile.lastIndexOf('/')) : '';
  return normalizePath(dir ? `${dir}/${cleanTarget}` : cleanTarget);
}

interface ExecState {
  vars: Record<string, PhpVal>;
  constants: Record<string, PhpVal>;
  functions: Record<string, PhpCallable>;
  output: string;
  statusCode: number;
  includedFiles: Set<string>;
  fileMap: Map<string, VirtualProjectFile>;
  steps: number;
  htmlChunks: string[];
}

const MAX_EXEC_STEPS = 4000;

interface ReturnSignal {
  __return: true;
  value: PhpVal;
}
function isReturnSignal(x: unknown): x is ReturnSignal {
  return Boolean(x && typeof x === 'object' && '__return' in (x as object));
}

function stripOuterParens(expr: string): string {
  let s = expr.trim();
  while (s.startsWith('(') && s.endsWith(')')) {
    let depth = 0;
    let inStr: string | null = null;
    let matchesOuter = true;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (inStr) {
        if (ch === '\\') {
          i++;
          continue;
        }
        if (ch === inStr) inStr = null;
      } else {
        if (ch === '"' || ch === "'") inStr = ch;
        else if (ch === '(') depth++;
        else if (ch === ')') {
          depth--;
          if (depth === 0 && i < s.length - 1) {
            matchesOuter = false;
            break;
          }
        }
      }
    }
    if (matchesOuter) {
      s = s.slice(1, -1).trim();
    } else {
      break;
    }
  }
  return s;
}

function splitTopLevel(input: string, sepChar: string): string[] {
  const out: string[] = [];
  let depthParen = 0;
  let depthBracket = 0;
  let depthBrace = 0;
  let inStr: string | null = null;
  let start = 0;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inStr) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = ch;
    } else if (ch === '(') depthParen++;
    else if (ch === ')') depthParen--;
    else if (ch === '[') depthBracket++;
    else if (ch === ']') depthBracket--;
    else if (ch === '{') depthBrace++;
    else if (ch === '}') depthBrace--;
    else if (
      depthParen === 0 &&
      depthBracket === 0 &&
      depthBrace === 0 &&
      input.slice(i, i + sepChar.length) === sepChar
    ) {
      out.push(input.slice(start, i));
      start = i + sepChar.length;
      i += sepChar.length - 1;
    }
  }
  out.push(input.slice(start));
  return out;
}

function findTopLevelBinary(
  expr: string,
  operators: string[],
  rightToLeft = false
): { idx: number; op: string } | null {
  let depthParen = 0;
  let depthBracket = 0;
  let depthBrace = 0;
  let inStr: string | null = null;
  let lastFound: { idx: number; op: string } | null = null;

  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (inStr) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = ch;
      continue;
    }
    if (ch === '(') depthParen++;
    else if (ch === ')') depthParen--;
    else if (ch === '[') depthBracket++;
    else if (ch === ']') depthBracket--;
    else if (ch === '{') depthBrace++;
    else if (ch === '}') depthBrace--;
    else if (depthParen === 0 && depthBracket === 0 && depthBrace === 0) {
      for (const op of operators) {
        if (expr.slice(i, i + op.length) === op) {
          // Ensure '.' doesn't match decimal numbers like 3.14
          if (op === '.' && /\d/.test(expr[i - 1] || '') && /\d/.test(expr[i + 1] || '')) {
            continue;
          }
          // Ensure word operators don't split identifiers
          if (/^[a-z]+$/i.test(op)) {
            const before = expr[i - 1] || ' ';
            const after = expr[i + op.length] || ' ';
            if (/[a-z0-9_]/i.test(before) || /[a-z0-9_]/i.test(after)) continue;
          }
          // Avoid matching '==' as '=' or '===' or '=>'
          if (
            op === '=' &&
            (expr[i + 1] === '=' ||
              expr[i + 1] === '>' ||
              expr[i - 1] === '=' ||
              expr[i - 1] === '!' ||
              expr[i - 1] === '<' ||
              expr[i - 1] === '>' ||
              expr[i - 1] === '.' ||
              expr[i - 1] === '+')
          ) {
            continue;
          }
          if (op === '<' && (expr[i + 1] === '=' || expr[i + 1] === '?')) continue;
          if (op === '>' && (expr[i + 1] === '=' || expr[i - 1] === '=' || expr[i - 1] === '-'))
            continue;
          if (op === '==' && expr[i + 2] === '=') continue;
          if (op === '!=' && expr[i + 2] === '=') continue;

          if (!rightToLeft) {
            lastFound = { idx: i, op };
          } else {
            return { idx: i, op };
          }
          i += op.length - 1;
          break;
        }
      }
    }
  }
  return lastFound;
}

function interpolatePhpString(
  raw: string,
  state: ExecState,
  scope: Record<string, PhpVal>
): string {
  const unescaped = raw
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');

  return unescaped.replace(
    /\{\$([a-zA-Z_][a-zA-Z0-9_]*)(?:\[['"]?([^'"\]]+)['"]?\])?\}|\$([a-zA-Z_][a-zA-Z0-9_]*)/g,
    (_m, v1, k1, v2) => {
      const varName = v1 || v2;
      const val = varName in scope ? scope[varName] : state.vars[varName];
      if (k1 !== undefined && isPhpArray(val)) {
        const idxKey = /^\d+$/.test(k1) ? Number(k1) : k1;
        return toPhpString(val.entries.get(idxKey) ?? null);
      }
      return toPhpString(val ?? null);
    }
  );
}

function callBuiltinFunction(
  fnName: string,
  args: PhpVal[],
  state: ExecState
): { handled: boolean; value: PhpVal } {
  const name = fnName.toLowerCase();
  const s0 = toPhpString(args[0] ?? null);
  const s1 = toPhpString(args[1] ?? null);
  const s2 = toPhpString(args[2] ?? null);

  switch (name) {
    case '__raw_chunk': {
      const idx = Math.trunc(toPhpNumber(args[0] ?? 0));
      state.output += state.htmlChunks[idx] || '';
      return { handled: true, value: null };
    }
    case 'strlen':
      return { handled: true, value: s0.length };
    case 'trim':
      return { handled: true, value: s0.trim() };
    case 'ltrim':
      return { handled: true, value: s0.replace(/^\s+/, '') };
    case 'rtrim':
      return { handled: true, value: s0.replace(/\s+$/, '') };
    case 'strtolower':
      return { handled: true, value: s0.toLowerCase() };
    case 'strtoupper':
      return { handled: true, value: s0.toUpperCase() };
    case 'ucfirst':
      return { handled: true, value: s0 ? s0[0].toUpperCase() + s0.slice(1) : '' };
    case 'ucwords':
      return { handled: true, value: s0.replace(/\b\w/g, (c) => c.toUpperCase()) };
    case 'htmlspecialchars':
    case 'htmlentities':
      return { handled: true, value: escapeHtml(s0) };
    case 'htmlspecialchars_decode':
      return { handled: true, value: unescapeHtml(s0) };
    case 'nl2br':
      return { handled: true, value: s0.replace(/\r?\n/g, '<br />\n') };
    case 'str_replace':
      return { handled: true, value: s0 ? s2.split(s0).join(s1) : s2 };
    case 'str_contains':
      return { handled: true, value: s0.includes(s1) };
    case 'str_starts_with':
      return { handled: true, value: s0.startsWith(s1) };
    case 'str_ends_with':
      return { handled: true, value: s0.endsWith(s1) };
    case 'strpos': {
      const idx = s0.indexOf(s1);
      return { handled: true, value: idx >= 0 ? idx : false };
    }
    case 'substr': {
      const start = toPhpNumber(args[1] ?? 0);
      const len = args[2] !== undefined ? toPhpNumber(args[2]) : undefined;
      return { handled: true, value: len !== undefined ? s0.substr(start, len) : s0.slice(start) };
    }
    case 'explode': {
      const parts = s0 ? s1.split(s0) : [s1];
      return { handled: true, value: makePhpArray(parts.map((p, i) => [i, p])) };
    }
    case 'implode':
    case 'join': {
      const arr = isPhpArray(args[1]) ? args[1] : isPhpArray(args[0]) ? args[0] : null;
      const glue = isPhpArray(args[1]) ? s0 : isPhpArray(args[0]) ? '' : s0;
      if (!arr) return { handled: true, value: '' };
      return {
        handled: true,
        value: Array.from(arr.entries.values()).map(toPhpString).join(glue),
      };
    }
    case 'count':
    case 'sizeof':
      return {
        handled: true,
        value: isPhpArray(args[0]) ? args[0].entries.size : args[0] === null ? 0 : 1,
      };
    case 'empty':
      return { handled: true, value: !toPhpBool(args[0] ?? null) };
    case 'isset':
      return { handled: true, value: args.every((a) => a !== null && a !== undefined) };
    case 'is_array':
      return { handled: true, value: isPhpArray(args[0]) };
    case 'is_string':
      return { handled: true, value: typeof args[0] === 'string' };
    case 'is_numeric':
    case 'is_int':
      return {
        handled: true,
        value:
          typeof args[0] === 'number' ||
          (typeof args[0] === 'string' && /^-?\d+(\.\d+)?$/.test(args[0])),
      };
    case 'in_array': {
      const hay = isPhpArray(args[1]) ? args[1] : null;
      if (!hay) return { handled: true, value: false };
      const strict = toPhpBool(args[2] ?? false);
      for (const val of hay.entries.values()) {
        if (strict ? val === args[0] : phpLooseEqual(val, args[0] ?? null)) {
          return { handled: true, value: true };
        }
      }
      return { handled: true, value: false };
    }
    case 'array_keys':
      return {
        handled: true,
        value: isPhpArray(args[0])
          ? makePhpArray(Array.from(args[0].entries.keys()).map((k, i) => [i, k]))
          : makePhpArray(),
      };
    case 'array_values':
      return {
        handled: true,
        value: isPhpArray(args[0])
          ? makePhpArray(Array.from(args[0].entries.values()).map((v, i) => [i, v]))
          : makePhpArray(),
      };
    case 'array_merge': {
      const merged = makePhpArray();
      let seqIdx = 0;
      for (const a of args) {
        if (!isPhpArray(a)) continue;
        for (const [k, v] of a.entries.entries()) {
          if (typeof k === 'number') merged.entries.set(seqIdx++, v);
          else merged.entries.set(k, v);
        }
      }
      return { handled: true, value: merged };
    }
    case 'json_encode':
      return {
        handled: true,
        value: JSON.stringify(phpToJsJson(args[0] ?? null), null, 2) || 'null',
      };
    case 'json_decode': {
      try {
        return { handled: true, value: jsJsonToPhp(JSON.parse(s0)) };
      } catch {
        return { handled: true, value: null };
      }
    }
    case 'sprintf': {
      let i = 1;
      const formatted = s0.replace(/%[sdfo]/g, (spec) => {
        const val = args[i++] ?? '';
        if (spec === '%d') return String(Math.trunc(toPhpNumber(val)));
        if (spec === '%f') return String(toPhpNumber(val));
        return toPhpString(val);
      });
      return { handled: true, value: formatted };
    }
    case 'printf': {
      const res = callBuiltinFunction('sprintf', args, state);
      state.output += toPhpString(res.value);
      return { handled: true, value: toPhpString(res.value).length };
    }
    case 'number_format': {
      const num = toPhpNumber(args[0] ?? 0);
      const dec = args[1] !== undefined ? Math.max(0, Math.trunc(toPhpNumber(args[1]))) : 0;
      return {
        handled: true,
        value: num.toLocaleString('en-US', {
          minimumFractionDigits: dec,
          maximumFractionDigits: dec,
        }),
      };
    }
    case 'round': {
      const num = toPhpNumber(args[0] ?? 0);
      const p = args[1] !== undefined ? Math.trunc(toPhpNumber(args[1])) : 0;
      const mult = Math.pow(10, p);
      return { handled: true, value: Math.round(num * mult) / mult };
    }
    case 'intval':
      return { handled: true, value: Math.trunc(toPhpNumber(args[0] ?? 0)) };
    case 'floatval':
      return { handled: true, value: toPhpNumber(args[0] ?? 0) };
    case 'strval':
      return { handled: true, value: s0 };
    case 'date': {
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const out = s0
        .replace(/Y/g, String(now.getFullYear()))
        .replace(/m/g, pad(now.getMonth() + 1))
        .replace(/d/g, pad(now.getDate()))
        .replace(/H/g, pad(now.getHours()))
        .replace(/i/g, pad(now.getMinutes()))
        .replace(/s/g, pad(now.getSeconds()))
        .replace(/M/g, now.toLocaleString('en-US', { month: 'short' }))
        .replace(/F/g, now.toLocaleString('en-US', { month: 'long' }));
      return { handled: true, value: out };
    }
    case 'time':
      return { handled: true, value: Math.floor(Date.now() / 1000) };
    case 'http_response_code':
      if (args[0] !== undefined) state.statusCode = toPhpNumber(args[0]) || 200;
      return { handled: true, value: state.statusCode };
    case 'header':
      return { handled: true, value: null };
    case 'define':
      if (s0) state.constants[s0] = args[1] ?? null;
      return { handled: true, value: true };
    case 'defined':
      return { handled: true, value: s0 in state.constants };
    case 'urlencode':
      return { handled: true, value: encodeURIComponent(s0) };
    case 'urldecode':
      return { handled: true, value: decodeURIComponent(s0) };
    case 'parse_url': {
      try {
        const u = new URL(s0, 'https://preview.local');
        const component = args[1] !== undefined ? toPhpNumber(args[1]) : -1;
        if (component === 5) return { handled: true, value: u.pathname };
        return {
          handled: true,
          value: makePhpArray([
            ['scheme', u.protocol.replace(':', '')],
            ['host', u.hostname],
            ['path', u.pathname],
            ['query', u.search.replace(/^\?/, '')],
          ]),
        };
      } catch {
        return { handled: true, value: false };
      }
    }
    case 'var_dump':
    case 'print_r': {
      const dumped = JSON.stringify(phpToJsJson(args[0] ?? null), null, 2);
      if (args[1] === true) return { handled: true, value: dumped };
      state.output += dumped + '\n';
      return { handled: true, value: true };
    }
    default:
      return { handled: false, value: null };
  }
}

function evalExpr(
  rawExpr: string,
  state: ExecState,
  scope: Record<string, PhpVal>,
  currentFile: string
): PhpVal {
  const expr = stripOuterParens(rawExpr);
  if (!expr) return null;

  if (expr === 'true' || expr === 'TRUE') return true;
  if (expr === 'false' || expr === 'FALSE') return false;
  if (expr === 'null' || expr === 'NULL') return null;
  if (/^-?\d+(\.\d+)?$/.test(expr)) return Number(expr);

  // Single-quoted string
  if (expr.startsWith("'") && expr.endsWith("'") && expr.length >= 2) {
    const inner = expr.slice(1, -1);
    if (!inner.includes("'") || /\\'/.test(inner)) {
      return inner.replace(/\\'/g, "'").replace(/\\\\/g, '\\');
    }
  }
  // Double-quoted string
  if (expr.startsWith('"') && expr.endsWith('"') && expr.length >= 2) {
    let closedEarly = false;
    for (let i = 1; i < expr.length - 1; i++) {
      if (expr[i] === '\\') {
        i++;
        continue;
      }
      if (expr[i] === '"') {
        closedEarly = true;
        break;
      }
    }
    if (!closedEarly) {
      return interpolatePhpString(expr.slice(1, -1), state, scope);
    }
  }

  // Assignment: $a = expr, $a .= expr, $a += expr, $arr[] = expr, $arr['k'] = expr
  const assignCompoundMatch = expr.match(/^\$([a-zA-Z_][a-zA-Z0-9_]*)\s*(\.=|\+=|-=)\s*([\s\S]+)$/);
  if (assignCompoundMatch) {
    const [, varName, op, rhsRaw] = assignCompoundMatch;
    const rhs = evalExpr(rhsRaw, state, scope, currentFile);
    const cur = varName in scope ? scope[varName] : (state.vars[varName] ?? null);
    const next =
      op === '.='
        ? toPhpString(cur) + toPhpString(rhs)
        : op === '+='
          ? toPhpNumber(cur) + toPhpNumber(rhs)
          : toPhpNumber(cur) - toPhpNumber(rhs);
    if (varName in scope) scope[varName] = next;
    else state.vars[varName] = next;
    return next;
  }

  const eqSplit = findTopLevelBinary(expr, ['='], true);
  if (eqSplit) {
    const lhs = expr.slice(0, eqSplit.idx).trim();
    const rhs = evalExpr(expr.slice(eqSplit.idx + 1), state, scope, currentFile);
    const simpleVar = lhs.match(/^\$([a-zA-Z_][a-zA-Z0-9_]*)$/);
    if (simpleVar) {
      const name = simpleVar[1];
      if (scope !== state.vars && name in scope) scope[name] = rhs;
      else if (scope !== state.vars) scope[name] = rhs;
      else state.vars[name] = rhs;
      return rhs;
    }
    const pushArr = lhs.match(/^\$([a-zA-Z_][a-zA-Z0-9_]*)\[\s*\]$/);
    if (pushArr) {
      const name = pushArr[1];
      const existing = name in scope ? scope[name] : state.vars[name];
      const arr = isPhpArray(existing) ? existing : makePhpArray();
      let maxNum = -1;
      for (const k of arr.entries.keys()) {
        if (typeof k === 'number' && k > maxNum) maxNum = k;
      }
      arr.entries.set(maxNum + 1, rhs);
      if (scope !== state.vars) scope[name] = arr;
      else state.vars[name] = arr;
      return rhs;
    }
    const keyArr = lhs.match(/^\$([a-zA-Z_][a-zA-Z0-9_]*)\[([^\]]+)\]$/);
    if (keyArr) {
      const [, name, rawKey] = keyArr;
      const existing = name in scope ? scope[name] : state.vars[name];
      const arr = isPhpArray(existing) ? existing : makePhpArray();
      const kVal = evalExpr(rawKey, state, scope, currentFile);
      const mapKey = typeof kVal === 'number' ? kVal : toPhpString(kVal);
      arr.entries.set(mapKey, rhs);
      if (scope !== state.vars) scope[name] = arr;
      else state.vars[name] = arr;
      return rhs;
    }
  }

  // Null coalescing ??
  const coalSplit = findTopLevelBinary(expr, ['??'], false);
  if (coalSplit) {
    const left = evalExpr(expr.slice(0, coalSplit.idx), state, scope, currentFile);
    return left !== null && left !== undefined
      ? left
      : evalExpr(expr.slice(coalSplit.idx + 2), state, scope, currentFile);
  }

  // Ternary ? :
  const qSplit = findTopLevelBinary(expr, ['?'], false);
  if (qSplit) {
    const cond = evalExpr(expr.slice(0, qSplit.idx), state, scope, currentFile);
    const rest = expr.slice(qSplit.idx + 1);
    const colonSplit = findTopLevelBinary(rest, [':'], true);
    if (colonSplit) {
      return toPhpBool(cond)
        ? evalExpr(rest.slice(0, colonSplit.idx), state, scope, currentFile)
        : evalExpr(rest.slice(colonSplit.idx + 1), state, scope, currentFile);
    }
  }

  // Logical OR / AND
  const orSplit = findTopLevelBinary(expr, ['||', 'or'], false);
  if (orSplit) {
    const left = evalExpr(expr.slice(0, orSplit.idx), state, scope, currentFile);
    if (toPhpBool(left)) return true;
    return toPhpBool(
      evalExpr(expr.slice(orSplit.idx + orSplit.op.length), state, scope, currentFile)
    );
  }
  const andSplit = findTopLevelBinary(expr, ['&&', 'and'], false);
  if (andSplit) {
    const left = evalExpr(expr.slice(0, andSplit.idx), state, scope, currentFile);
    if (!toPhpBool(left)) return false;
    return toPhpBool(
      evalExpr(expr.slice(andSplit.idx + andSplit.op.length), state, scope, currentFile)
    );
  }

  // Comparisons
  const cmpSplit = findTopLevelBinary(
    expr,
    ['===', '!==', '==', '!=', '<=', '>=', '<', '>'],
    false
  );
  if (cmpSplit) {
    const l = evalExpr(expr.slice(0, cmpSplit.idx), state, scope, currentFile);
    const r = evalExpr(expr.slice(cmpSplit.idx + cmpSplit.op.length), state, scope, currentFile);
    switch (cmpSplit.op) {
      case '===':
        return l === r;
      case '!==':
        return l !== r;
      case '==':
        return phpLooseEqual(l, r);
      case '!=':
        return !phpLooseEqual(l, r);
      case '<=':
        return toPhpNumber(l) <= toPhpNumber(r);
      case '>=':
        return toPhpNumber(l) >= toPhpNumber(r);
      case '<':
        return toPhpNumber(l) < toPhpNumber(r);
      case '>':
        return toPhpNumber(l) > toPhpNumber(r);
    }
  }

  // Concatenation & Addition/Subtraction
  const addConcatSplit = findTopLevelBinary(expr, ['.', '+', '-'], false);
  if (addConcatSplit && addConcatSplit.idx > 0) {
    const l = evalExpr(expr.slice(0, addConcatSplit.idx), state, scope, currentFile);
    const r = evalExpr(expr.slice(addConcatSplit.idx + 1), state, scope, currentFile);
    if (addConcatSplit.op === '.') return toPhpString(l) + toPhpString(r);
    if (addConcatSplit.op === '+') return toPhpNumber(l) + toPhpNumber(r);
    return toPhpNumber(l) - toPhpNumber(r);
  }

  // Multiplication / Division / Modulo
  const mulSplit = findTopLevelBinary(expr, ['*', '/', '%'], false);
  if (mulSplit) {
    const l = toPhpNumber(evalExpr(expr.slice(0, mulSplit.idx), state, scope, currentFile));
    const r = toPhpNumber(evalExpr(expr.slice(mulSplit.idx + 1), state, scope, currentFile));
    if (mulSplit.op === '*') return l * r;
    if (mulSplit.op === '/') return r === 0 ? 0 : l / r;
    return r === 0 ? 0 : l % r;
  }

  // Unary negation !
  if (expr.startsWith('!')) {
    return !toPhpBool(evalExpr(expr.slice(1), state, scope, currentFile));
  }

  // PHP Array literal [...] or array(...)
  if (
    (expr.startsWith('[') && expr.endsWith(']')) ||
    (/^array\s*\(/i.test(expr) && expr.endsWith(')'))
  ) {
    const inner = expr.startsWith('[')
      ? expr.slice(1, -1).trim()
      : expr.slice(expr.indexOf('(') + 1, -1).trim();
    const arr = makePhpArray();
    if (!inner) return arr;
    let nextSeq = 0;
    for (const itemRaw of splitTopLevel(inner, ',')) {
      const item = itemRaw.trim();
      if (!item) continue;
      const arrowSplit = findTopLevelBinary(item, ['=>'], true);
      if (arrowSplit) {
        const k = evalExpr(item.slice(0, arrowSplit.idx), state, scope, currentFile);
        const v = evalExpr(item.slice(arrowSplit.idx + 2), state, scope, currentFile);
        const keyNormalized = typeof k === 'number' ? k : toPhpString(k);
        arr.entries.set(keyNormalized, v);
      } else {
        arr.entries.set(nextSeq++, evalExpr(item, state, scope, currentFile));
      }
    }
    return arr;
  }

  // Variable & chained array indexing: $var['a']['b']
  if (expr.startsWith('$')) {
    const varMatch = expr.match(/^\$([a-zA-Z_][a-zA-Z0-9_]*)([\s\S]*)$/);
    if (varMatch) {
      const [, name, rest] = varMatch;
      let val: PhpVal = name in scope ? scope[name] : name in state.vars ? state.vars[name] : null;
      let cursor = rest.trim();
      while (cursor.startsWith('[')) {
        let depth = 0;
        let endIdx = -1;
        let inStr: string | null = null;
        for (let i = 0; i < cursor.length; i++) {
          const ch = cursor[i];
          if (inStr) {
            if (ch === '\\') {
              i++;
              continue;
            }
            if (ch === inStr) inStr = null;
          } else {
            if (ch === '"' || ch === "'") inStr = ch;
            else if (ch === '[') depth++;
            else if (ch === ']') {
              depth--;
              if (depth === 0) {
                endIdx = i;
                break;
              }
            }
          }
        }
        if (endIdx < 0) break;
        const keyExpr = cursor.slice(1, endIdx);
        const keyVal = evalExpr(keyExpr, state, scope, currentFile);
        if (isPhpArray(val)) {
          const k = typeof keyVal === 'number' ? keyVal : toPhpString(keyVal);
          val = val.entries.get(k) ?? null;
        } else if (typeof val === 'string') {
          val = val[toPhpNumber(keyVal)] ?? '';
        } else {
          val = null;
        }
        cursor = cursor.slice(endIdx + 1).trim();
      }
      if (!cursor) return val;
    }
  }

  // Function calls: fn(arg1, arg2) and special constructs empty($x), isset($x)
  const callMatch = expr.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([\s\S]*)\)$/);
  if (callMatch) {
    const [, fnName, argsRaw] = callMatch;
    const rawArgs = argsRaw.trim() ? splitTopLevel(argsRaw, ',') : [];
    const evalArgs = rawArgs.map((a) => evalExpr(a, state, scope, currentFile));

    const userFn = state.functions[fnName.toLowerCase()];
    if (userFn) {
      const localScope: Record<string, PhpVal> = {};
      userFn.params.forEach((paramName, idx) => {
        localScope[paramName] = evalArgs[idx] ?? null;
      });
      const res = executePhpStatements(userFn.body, state, localScope, currentFile);
      return isReturnSignal(res) ? res.value : null;
    }

    const builtin = callBuiltinFunction(fnName, evalArgs, state);
    if (builtin.handled) return builtin.value;
  }

  // Defined constant
  if (/^[A-Z_][A-Z0-9_]*$/.test(expr) && expr in state.constants) {
    return state.constants[expr];
  }

  return null;
}

function splitPhpStatements(code: string): string[] {
  const stmts: string[] = [];
  let buf = '';
  let depthParen = 0;
  let depthBrace = 0;
  let inStr: string | null = null;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    const next = code[i + 1] || '';

    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (inStr) {
      buf += ch;
      if (ch === '\\' && next) {
        buf += next;
        i++;
      } else if (ch === inStr) {
        inStr = null;
      }
      continue;
    }

    if ((ch === '/' && next === '/') || ch === '#') {
      inLineComment = true;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i++;
      continue;
    }

    if (ch === '"' || ch === "'") {
      inStr = ch;
      buf += ch;
      continue;
    }
    if (ch === '(') depthParen++;
    else if (ch === ')') depthParen--;
    else if (ch === '{') {
      depthBrace++;
      buf += ch;
      continue;
    } else if (ch === '}') {
      depthBrace--;
      buf += ch;
      if (depthBrace === 0 && depthParen === 0) {
        // Keep trailing elseif / else attached to same compound statement
        const lookahead = code.slice(i + 1).trimStart();
        if (/^(?:elseif|else)\b/i.test(lookahead)) {
          continue;
        }
        stmts.push(buf.trim());
        buf = '';
      }
      continue;
    } else if (ch === ';' && depthParen === 0 && depthBrace === 0) {
      if (buf.trim()) stmts.push(buf.trim());
      buf = '';
      continue;
    }
    buf += ch;
  }

  if (buf.trim()) stmts.push(buf.trim());
  return stmts.filter(Boolean);
}

function findMatchingDelim(str: string, openIdx: number, openCh: string, closeCh: string): number {
  let depth = 0;
  let inStr: string | null = null;
  for (let i = openIdx; i < str.length; i++) {
    const ch = str[i];
    if (inStr) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === inStr) inStr = null;
    } else {
      if (ch === '"' || ch === "'") inStr = ch;
      else if (ch === openCh) depth++;
      else if (ch === closeCh) {
        depth--;
        if (depth === 0) return i;
      }
    }
  }
  return -1;
}

function executePhpStatements(
  code: string,
  state: ExecState,
  scope: Record<string, PhpVal>,
  currentFile: string
): ReturnSignal | void {
  const stmts = splitPhpStatements(code);

  for (const stmt of stmts) {
    if (++state.steps > MAX_EXEC_STEPS) return;
    const s = stmt.trim();
    if (!s) continue;

    // return statement
    const returnMatch = s.match(/^return(?:\s+([\s\S]+))?$/i);
    if (returnMatch) {
      return {
        __return: true,
        value: returnMatch[1] ? evalExpr(returnMatch[1], state, scope, currentFile) : null,
      };
    }

    // echo / print
    const echoMatch = s.match(/^(?:echo|print)\s+([\s\S]+)$/i);
    if (echoMatch) {
      const parts = splitTopLevel(echoMatch[1], ',');
      for (const p of parts) {
        state.output += toPhpString(evalExpr(p, state, scope, currentFile));
      }
      continue;
    }

    // require / require_once / include / include_once
    const incMatch = s.match(
      /^(require_once|require|include_once|include)\s*\(?\s*([\s\S]+?)\s*\)?$/i
    );
    if (incMatch) {
      const kind = incMatch[1].toLowerCase();
      const targetVal = toPhpString(evalExpr(incMatch[2], state, scope, currentFile));
      const resolved = resolveRelativeFilePath(currentFile, targetVal);
      if (resolved) {
        const isOnce = kind.endsWith('_once');
        if (!isOnce || !state.includedFiles.has(resolved)) {
          state.includedFiles.add(resolved);
          const targetFile =
            state.fileMap.get(resolved) || state.fileMap.get(resolved.replace(/^public\//, ''));
          if (targetFile) {
            executePhpFile(targetFile.content, targetFile.path, state, scope);
          }
        }
      }
      continue;
    }

    // function definition
    const fnDefMatch = s.match(
      /^function\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([^)]*)\)\s*\{([\s\S]*)\}$/i
    );
    if (fnDefMatch) {
      const [, fnName, paramsRaw, body] = fnDefMatch;
      const params = paramsRaw
        .split(',')
        .map((p) => p.trim().replace(/^&?\$/, '').split('=')[0].trim())
        .filter(Boolean);
      state.functions[fnName.toLowerCase()] = {
        __isPhpCallable: true,
        params,
        body,
      };
      continue;
    }

    // foreach ($arr as $val) or foreach ($arr as $key => $val)
    if (/^foreach\s*\(/i.test(s)) {
      const pOpen = s.indexOf('(');
      const pClose = findMatchingDelim(s, pOpen, '(', ')');
      const bOpen = s.indexOf('{', pClose);
      const bClose = findMatchingDelim(s, bOpen, '{', '}');
      if (pOpen >= 0 && pClose > pOpen && bOpen > pClose && bClose > bOpen) {
        const header = s.slice(pOpen + 1, pClose);
        const body = s.slice(bOpen + 1, bClose);
        const asMatch = header.match(
          /^([\s\S]+?)\s+as\s+(?:\$([a-zA-Z_][a-zA-Z0-9_]*)\s*=>\s*)?\$([a-zA-Z_][a-zA-Z0-9_]*)$/i
        );
        if (asMatch) {
          const [, arrExpr, keyVar, valVar] = asMatch;
          const arrVal = evalExpr(arrExpr, state, scope, currentFile);
          if (isPhpArray(arrVal)) {
            for (const [k, v] of arrVal.entries.entries()) {
              if (++state.steps > MAX_EXEC_STEPS) break;
              if (keyVar) scope[keyVar] = k;
              scope[valVar] = v;
              const ret = executePhpStatements(body, state, scope, currentFile);
              if (isReturnSignal(ret)) return ret;
            }
          }
        }
      }
      continue;
    }

    // for ($i = 0; $i < n; $i++)
    if (/^for\s*\(/i.test(s)) {
      const pOpen = s.indexOf('(');
      const pClose = findMatchingDelim(s, pOpen, '(', ')');
      const bOpen = s.indexOf('{', pClose);
      const bClose = findMatchingDelim(s, bOpen, '{', '}');
      if (pOpen >= 0 && pClose > pOpen && bOpen > pClose && bClose > bOpen) {
        const [init, cond, step] = splitTopLevel(s.slice(pOpen + 1, pClose), ';');
        const body = s.slice(bOpen + 1, bClose);
        if (init?.trim()) evalExpr(init, state, scope, currentFile);
        let guard = 0;
        while (
          guard++ < 250 &&
          (!cond?.trim() || toPhpBool(evalExpr(cond, state, scope, currentFile)))
        ) {
          const ret = executePhpStatements(body, state, scope, currentFile);
          if (isReturnSignal(ret)) return ret;
          if (step?.trim()) {
            const incMatch = step.trim().match(/^\$([a-zA-Z_][a-zA-Z0-9_]*)(\+\+|--)$/);
            if (incMatch) {
              const cur = toPhpNumber(scope[incMatch[1]] ?? state.vars[incMatch[1]] ?? 0);
              scope[incMatch[1]] = incMatch[2] === '++' ? cur + 1 : cur - 1;
            } else {
              evalExpr(step, state, scope, currentFile);
            }
          }
        }
      }
      continue;
    }

    // if / elseif / else
    if (/^if\s*\(/i.test(s)) {
      let cursor = s;
      while (cursor) {
        const isElseOnly = /^else\s*\{/i.test(cursor);
        if (isElseOnly) {
          const bOpen = cursor.indexOf('{');
          const bClose = findMatchingDelim(cursor, bOpen, '{', '}');
          if (bOpen >= 0 && bClose > bOpen) {
            const ret = executePhpStatements(
              cursor.slice(bOpen + 1, bClose),
              state,
              scope,
              currentFile
            );
            if (isReturnSignal(ret)) return ret;
          }
          break;
        }
        const condMatch = cursor.match(/^(?:if|elseif)\s*\(/i);
        if (!condMatch) break;
        const pOpen = cursor.indexOf('(');
        const pClose = findMatchingDelim(cursor, pOpen, '(', ')');
        const bOpen = cursor.indexOf('{', pClose);
        const bClose = findMatchingDelim(cursor, bOpen, '{', '}');
        if (pOpen < 0 || pClose < 0 || bOpen < 0 || bClose < 0) break;

        const condExpr = cursor.slice(pOpen + 1, pClose);
        const body = cursor.slice(bOpen + 1, bClose);
        if (toPhpBool(evalExpr(condExpr, state, scope, currentFile))) {
          const ret = executePhpStatements(body, state, scope, currentFile);
          if (isReturnSignal(ret)) return ret;
          break;
        }
        cursor = cursor.slice(bClose + 1).trimStart();
      }
      continue;
    }

    // $i++ / $i--
    const incDec = s.match(/^\$([a-zA-Z_][a-zA-Z0-9_]*)(\+\+|--)$/);
    if (incDec) {
      const cur = toPhpNumber(scope[incDec[1]] ?? state.vars[incDec[1]] ?? 0);
      const next = incDec[2] === '++' ? cur + 1 : cur - 1;
      if (scope !== state.vars) scope[incDec[1]] = next;
      else state.vars[incDec[1]] = next;
      continue;
    }

    evalExpr(s, state, scope, currentFile);
  }
}

function normalizePhpAltSyntax(body: string): string {
  let out = '';
  let i = 0;
  let inStr: string | null = null;
  let inLineComment = false;
  let inBlockComment = false;

  while (i < body.length) {
    const ch = body[i];
    const next = body[i + 1] || '';

    if (inLineComment) {
      out += ch;
      if (ch === '\n') inLineComment = false;
      i++;
      continue;
    }
    if (inBlockComment) {
      out += ch;
      if (ch === '*' && next === '/') {
        out += '/';
        inBlockComment = false;
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    if (inStr) {
      out += ch;
      if (ch === '\\' && next) {
        out += next;
        i += 2;
        continue;
      }
      if (ch === inStr) inStr = null;
      i++;
      continue;
    }

    if ((ch === '/' && next === '/') || ch === '#') {
      inLineComment = true;
      out += ch;
      i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      out += '/*';
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = ch;
      out += ch;
      i++;
      continue;
    }

    // Check word boundary keywords
    const prev = i > 0 ? body[i - 1] : ' ';
    if (!/[a-zA-Z0-9_$]/.test(prev)) {
      const rest = body.slice(i);
      const endMatch = rest.match(/^(endif|endforeach|endfor|endwhile)\b\s*;?/i);
      if (endMatch) {
        out += '}';
        i += endMatch[0].length;
        continue;
      }
      const elseColon = rest.match(/^else\s*:/i);
      if (elseColon) {
        out += '} else {';
        i += elseColon[0].length;
        continue;
      }
      const hdrMatch = rest.match(/^(elseif|if|foreach|for|while)\s*\(/i);
      if (hdrMatch) {
        const kw = hdrMatch[1].toLowerCase();
        const parenOpen = i + hdrMatch[0].length - 1;
        const parenClose = findMatchingDelim(body, parenOpen, '(', ')');
        if (parenClose > parenOpen) {
          let after = parenClose + 1;
          while (after < body.length && /\s/.test(body[after])) after++;
          if (body[after] === ':') {
            const prefix = kw === 'elseif' ? '} ' : '';
            out += prefix + body.slice(i, parenClose + 1) + ' {';
            i = after + 1;
            continue;
          }
        }
      }
    }

    out += ch;
    i++;
  }

  return out;
}

function executePhpFile(
  rawSource: string,
  filePath: string,
  state: ExecState,
  scope: Record<string, PhpVal>
): void {
  // Compile mixed HTML + <?php ... ?> + <?= ... ?> template into a unified PHP stream
  // so foreach/if/else blocks spanning multiple HTML chunks execute seamlessly.
  const tokenRegex = /<\?(?:php\b|=)([\s\S]*?)(?:\?>|$)/gi;
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  let compiledPhp = '';

  while ((match = tokenRegex.exec(rawSource)) !== null) {
    const htmlChunk = rawSource.slice(lastIdx, match.index);
    if (htmlChunk) {
      const idx = state.htmlChunks.push(htmlChunk) - 1;
      compiledPhp += `__raw_chunk(${idx});\n`;
    }

    const fullTag = match[0];
    const body = match[1] || '';
    if (fullTag.startsWith('<?=')) {
      const expr = body.trim().replace(/;$/, '');
      if (expr) {
        compiledPhp += `echo (${expr});\n`;
      }
    } else {
      const normalized = normalizePhpAltSyntax(body).trim();
      if (normalized) {
        compiledPhp += `${normalized}\n`;
      }
    }
    lastIdx = tokenRegex.lastIndex;
  }

  const tail = rawSource.slice(lastIdx);
  if (tail) {
    const idx = state.htmlChunks.push(tail) - 1;
    compiledPhp += `__raw_chunk(${idx});\n`;
  }

  if (compiledPhp.trim()) {
    executePhpStatements(compiledPhp, state, scope, filePath);
  }
}

function discoverPhpRoutes(files: VirtualProjectFile[]): string[] {
  const routes = new Set<string>(['/']);
  for (const f of files) {
    const content = f.content;
    const hrefMatches = content.matchAll(/href\s*=\s*["']([^"'#]+)["']/gi);
    for (const m of hrefMatches) {
      const href = (m[1] || '').trim();
      if (!href || /^https?:|^mailto:|^tel:|^\?/i.test(href)) {
        if (href.startsWith('?')) routes.add(`/${href}`);
        continue;
      }
      if (!/\.(?:css|js|png|jpg|jpeg|svg|webp|ico)$/i.test(href)) {
        routes.add(href.startsWith('/') ? href : `/${href}`);
      }
    }
  }
  return Array.from(routes).slice(0, 8);
}

function inlineLocalAssets(html: string, files: VirtualProjectFile[]): string {
  const byPath = new Map<string, VirtualProjectFile>();
  for (const f of files) {
    byPath.set(normalizePath(f.path).toLowerCase(), f);
  }

  let processed = html.replace(
    /<link\b[^>]*rel\s*=\s*["']stylesheet["'][^>]*href\s*=\s*["']([^"']+)["'][^>]*\/?>/gi,
    (full, href: string) => {
      if (/^https?:|^\/\//i.test(href)) return full;
      const key = normalizePath(href.split('?')[0]).toLowerCase();
      const matched = byPath.get(key) || byPath.get(`public/${key}`);
      return matched ? `<style>\n${matched.content}\n</style>` : full;
    }
  );

  processed = processed.replace(
    /<script\b[^>]*src\s*=\s*["']([^"']+)["'][^>]*>\s*<\/script>/gi,
    (full, src: string) => {
      if (/^https?:|^\/\//i.test(src)) return full;
      const key = normalizePath(src.split('?')[0]).toLowerCase();
      const matched = byPath.get(key) || byPath.get(`public/${key}`);
      return matched ? `<script>\n${matched.content}\n</script>` : full;
    }
  );

  return processed;
}

const PHP_INTERACTION_BRIDGE_SCRIPT = `<script>
(function(){
  document.addEventListener('click', function(ev) {
    var link = ev.target && ev.target.closest ? ev.target.closest('a[href]') : null;
    if (!link) return;
    var href = link.getAttribute('href') || '';
    if (!href || href.startsWith('#') || /^https?:\\/\\//i.test(href) || /^mailto:|^tel:|^javascript:/i.test(href)) return;
    ev.preventDefault();
    try {
      window.parent.postMessage({ channel: 'supremeai-preview', type: 'php-navigate', route: href, method: 'GET' }, '*');
    } catch (_) { /* cross-origin frame may be torn down; nothing actionable */ }
  }, true);

  document.addEventListener('submit', function(ev) {
    var form = ev.target;
    if (!form || form.tagName !== 'FORM') return;
    ev.preventDefault();
    var action = form.getAttribute('action') || '';
    var method = (form.getAttribute('method') || 'GET').toUpperCase();
    var fd = new FormData(form);
    var payload = {};
    fd.forEach(function(v, k) { payload[k] = String(v); });
    try {
      window.parent.postMessage({
        channel: 'supremeai-preview',
        type: 'php-navigate',
        route: action || '/',
        method: method === 'POST' ? 'POST' : 'GET',
        formData: payload
      }, '*');
    } catch (_) { /* cross-origin frame may be torn down; nothing actionable */ }
  }, true);
})();
</script>`;

export function executeVirtualPhpProject(options: PhpExecutionOptions): PhpExecutionResult {
  const {
    files,
    entryPath,
    routeUrl = '/',
    method = 'GET',
    formData = {},
    darkMode = true,
  } = options;

  const fileMap = new Map<string, VirtualProjectFile>();
  for (const f of files) {
    fileMap.set(normalizePath(f.path), f);
  }

  // Parse virtual routeUrl & resolve matching PHP file if route points to another .php file
  const parsedUrl = new URL(
    routeUrl.startsWith('/') ? routeUrl : `/${routeUrl}`,
    'https://php.local'
  );
  const queryEntries: Array<[string, PhpVal]> = [];
  parsedUrl.searchParams.forEach((v, k) => queryEntries.push([k, v]));
  if (method === 'GET') {
    for (const [k, v] of Object.entries(formData)) {
      queryEntries.push([k, v]);
    }
  }

  const routePath = normalizePath(parsedUrl.pathname);
  const targetEntry =
    (routePath && fileMap.get(routePath)) ||
    fileMap.get(normalizePath(entryPath)) ||
    files.find((f) => /\.php$/i.test(f.path)) ||
    files[0];

  if (!targetEntry) {
    return {
      html: '<div style="padding:20px;font-family:sans-serif">No PHP entry file found.</div>',
      rawOutput: '',
      statusCode: 404,
      routes: ['/'],
    };
  }

  const getArray = makePhpArray(queryEntries);
  const postArray = makePhpArray(
    method === 'POST' ? Object.entries(formData).map(([k, v]) => [k, v]) : []
  );
  const requestArray = makePhpArray([
    ...getArray.entries.entries(),
    ...postArray.entries.entries(),
  ]);
  const serverArray = makePhpArray([
    ['REQUEST_METHOD', method],
    ['REQUEST_URI', `${parsedUrl.pathname}${parsedUrl.search}`],
    ['SCRIPT_NAME', `/${targetEntry.path}`],
    ['HTTP_HOST', 'preview.supremeai.local'],
  ]);

  const state: ExecState = {
    vars: {
      _GET: getArray,
      _POST: postArray,
      _REQUEST: requestArray,
      _SERVER: serverArray,
      _SESSION: makePhpArray(),
    },
    constants: {
      __DIR__: targetEntry.path.includes('/')
        ? targetEntry.path.slice(0, targetEntry.path.lastIndexOf('/'))
        : '.',
    },
    functions: {},
    output: '',
    statusCode: 200,
    includedFiles: new Set([normalizePath(targetEntry.path)]),
    fileMap,
    steps: 0,
    htmlChunks: [],
  };

  executePhpFile(targetEntry.content, targetEntry.path, state, state.vars);

  const rawOutput = state.output.trim();
  const routes = discoverPhpRoutes(files);
  const looksLikeHtmlDoc =
    /<!doctype\s+html|<html[\s>]|<head[\s>]|<body[\s>]|<div[\s>]|<h[1-6][\s>]|<section[\s>]|<main[\s>]|<form[\s>]|<table[\s>]/i.test(
      rawOutput
    );

  if (looksLikeHtmlDoc) {
    let rendered = inlineLocalAssets(rawOutput, files);
    if (!/^<!doctype\s+html/i.test(rendered) && !/^<html[\s>]/i.test(rendered)) {
      const cssFiles = files
        .filter((f) => f.lang === 'css')
        .map((f) => `<style>${f.content}</style>`)
        .join('\n');
      rendered = `<!DOCTYPE html><html class="${darkMode ? 'dark' : ''}"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><script src="https://cdn.tailwindcss.com"></script>${cssFiles}</head><body class="${
        darkMode ? 'bg-[#080b11] text-slate-100' : 'bg-slate-50 text-slate-900'
      } min-h-screen antialiased">${rendered}</body></html>`;
    }
    if (/<\/body>/i.test(rendered)) {
      rendered = rendered.replace(/<\/body>/i, `${PHP_INTERACTION_BRIDGE_SCRIPT}</body>`);
    } else {
      rendered += PHP_INTERACTION_BRIDGE_SCRIPT;
    }
    return {
      html: rendered,
      rawOutput,
      statusCode: state.statusCode,
      routes,
    };
  }

  // CLI / plain stdout PHP script view
  const bg = darkMode ? '#080b11' : '#f8fafc';
  const card = darkMode ? '#0b101b' : '#ffffff';
  const border = darkMode ? '#1e293b' : '#cbd5e1';
  const text = darkMode ? '#e2e8f0' : '#0f172a';
  const cliHtml = `<!DOCTYPE html>
<html class="${darkMode ? 'dark' : ''}">
<head>
  <meta charset="UTF-8" />
  <style>
    body { margin: 0; padding: 20px; font-family: system-ui, sans-serif; background: ${bg}; color: ${text}; }
    .card { border-radius: 14px; border: 1px solid ${border}; background: ${card}; overflow: hidden; }
    .bar { display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; border-bottom: 1px solid ${border}; font-family: ui-monospace, monospace; font-size: 11px; }
    .badge { color: #38bdf8; font-weight: 700; }
    .out { padding: 16px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; line-height: 1.65; white-space: pre-wrap; color: ${
      darkMode ? '#6ee7b7' : '#047857'
    }; }
  </style>
</head>
<body>
  <div class="card">
    <div class="bar">
      <span class="badge">PHP VIRTUAL RUNTIME · ${escapeHtml(targetEntry.path)}</span>
      <span>HTTP ${state.statusCode}</span>
    </div>
    <div class="out">${escapeHtml(rawOutput || '(PHP script executed cleanly with empty output)')}</div>
  </div>
  ${PHP_INTERACTION_BRIDGE_SCRIPT}
</body>
</html>`;

  return {
    html: cliHtml,
    rawOutput,
    statusCode: state.statusCode,
    routes,
  };
}
