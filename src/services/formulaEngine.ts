/* 公式引擎：受限表达式编译与执行（支持向量变量 B/T；也兼容旧的 rb/gb/bb/ab、rs/gs/bs/as） */

export type Engine = (v: { rb:number; gb:number; bb:number; ab:number; rs:number; gs:number; bs:number; as:number; }) => [number, number, number, number?];

const SAFE_FUNCS = {
  abs: Math.abs,
  min: Math.min,
  max: Math.max,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  sqrt: Math.sqrt,
  pow: Math.pow,
  exp: Math.exp,
  log: Math.log,
  clamp: (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x)),
  mix: (a: number, b: number, t: number) => a * (1 - t) + b * t,
  step: (edge: number, x: number) => (x < edge ? 0 : 1),
  smoothstep: (e0: number, e1: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  },
  lum: (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b,
  saturate: (x: number) => Math.min(1, Math.max(0, x)),
};

// 白名单：数字/小数、空白、运算符、括号、逗号、问号冒号、变量名、函数名、方括号
const ALLOWED_TOKENS = new RegExp(
  String.raw`^(?:[0-9]+(?:\.[0-9]+)?|\s+|[+\-*/%]|[()\[\],?:]|rb|gb|bb|ab|rs|gs|bs|as|B|T|abs|min|max|floor|ceil|round|sqrt|pow|exp|log|clamp|mix|step|smoothstep|lum|saturate)+$`
);

function sanitize(expr: string): string {
  const s = expr.trim();
  if (!s) throw new Error('公式为空');
  if (!ALLOWED_TOKENS.test(s)) {
    throw new Error('检测到不被允许的符号或标识符');
  }
  return s;
}

// 将包含向量变量 B/T 的表达式扩展为四通道数组表达式
function expandBTToChannels(expr: string): string {
  const s = expr.trim();
  if (!s) throw new Error('公式为空');
  // 如果未包含 B/T，则认为是旧语法，直接返回（由 sanitize 校验）
  if (!/\b[BT]\b/.test(s)) return s;

  const replaceFor = (ch: 'r'|'g'|'b'|'a') =>
    s.replace(/\bB\b/g, ch === 'r' ? 'rb' : ch === 'g' ? 'gb' : ch === 'b' ? 'bb' : 'ab')
     .replace(/\bT\b/g, ch === 'r' ? 'rs' : ch === 'g' ? 'gs' : ch === 'b' ? 'bs' : 'as');

  const rExpr = replaceFor('r');
  const gExpr = replaceFor('g');
  const bExpr = replaceFor('b');
  const aExpr = replaceFor('a');
  return `[${rExpr}, ${gExpr}, ${bExpr}, ${aExpr}]`;
}

export function compile(expr: string): Engine {
  // 先将 B/T 语法扩展为显式四通道数组（或保留旧语法）
  const expanded = expandBTToChannels(expr);
  const code = sanitize(expanded);
  // 使用受控 Function，传入白名单参数，屏蔽 this、global
  // eslint-disable-next-line no-new-func
  const fn = new Function(
    'rb','gb','bb','ab','rs','gs','bs','as',
    'abs','min','max','floor','ceil','round','sqrt','pow','exp','log','clamp','mix','step','smoothstep','lum','saturate',
    `"use strict";
     const res = (${code});
     return res;`
  ) as (...args: number[]) => unknown;

  const engine: Engine = (v) => {
    const out = fn(
      v.rb, v.gb, v.bb, v.ab, v.rs, v.gs, v.bs, v.as,
      SAFE_FUNCS.abs, SAFE_FUNCS.min, SAFE_FUNCS.max, SAFE_FUNCS.floor, SAFE_FUNCS.ceil, SAFE_FUNCS.round,
      SAFE_FUNCS.sqrt, SAFE_FUNCS.pow, SAFE_FUNCS.exp, SAFE_FUNCS.log,
      SAFE_FUNCS.clamp, SAFE_FUNCS.mix, SAFE_FUNCS.step, SAFE_FUNCS.smoothstep, SAFE_FUNCS.lum, SAFE_FUNCS.saturate
    );
    if (!Array.isArray(out) || (out.length !== 3 && out.length !== 4)) {
      throw new Error('公式必须返回长度为3或4的数组 [r,g,b,(a)]');
    }
    const r = Number(out[0]);
    const g = Number(out[1]);
    const b = Number(out[2]);
    const a = out.length === 4 ? Number(out[3]) : undefined;

    const clamp01 = (x: number) => (isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);
    const rr = clamp01(r);
    const gg = clamp01(g);
    const bb2 = clamp01(b);
    const aa = a !== undefined ? clamp01(a) : undefined;
    // @ts-ignore 保持签名
    return aa === undefined ? [rr, gg, bb2] : [rr, gg, bb2, aa];
  };

  return engine;
}