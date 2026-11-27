// Fast exact drop-in for makefun-diff 1.0.0 (make.fun's own line diff).
//
// run(input) returns exactly what makefun-diff 1.0.0's diffPatch returns for
// every input { old, new }: the same patch string, code unit for code unit.
// The rule it implements is the one stated in makefun-diff's own header:
// lines cut after every "\n", common prefix then common suffix kept, Myers's
// greedy search between them (deletion wins a tie, no move past either end,
// no edge pruning, every run of equal lines followed as far as it goes),
// then hunks of up to 3 kept lines around each change run.
//
// Speed comes from three changes over the reference, none of which changes
// the answer:
//   1. Lines are interned to small integers once per case (one Map lookup
//      per line), so the millions of line comparisons inside the search are
//      integer comparisons on Int32Arrays instead of string comparisons.
//   2. The search keeps its frontier in one flat Int32Array trace
//      (row d at offset d*d, 0 where a diagonal has no path, a cell holding
//      the furthest x reached plus one) instead of allocating a path object
//      and a component object per step, and the edit script is recovered by
//      walking that trace backwards. The forward step and the backward step
//      apply the reference's candidate rules and tie-break exactly, so the
//      script is the same script.
//   3. The patch is built from the same hunks rule as the reference,
//      with the same output lines, from the same line strings.

/** The patch's first word. */
const FORMAT = 'makefun-diff/1';

/** The kept lines a hunk shows before and after each change run. */
const CONTEXT = 3;

/** The op of a kept, a deleted and an inserted line, as the patch writes them. */
const KEEP = '=';
const DELETE = '-';
const INSERT = '+';

/** Run kinds in the edit script: kept, deleted, inserted. */
const K_KEEP = 0;
const K_DELETE = 1;
const K_INSERT = 2;

/** A text's lines, each with its "\n" (the last one without, when the text does not end in one). */
function tokenize(text) {
  const parts = text.split('\n');
  const lines = [];
  const last = parts.length - 1;
  for (let i = 0; i < last; i++) lines.push(`${parts[i]}\n`);
  if (parts[last] !== '') lines.push(parts[last]);
  return lines;
}

/**
 * The runs of the edit script of the middle section (a[0..n) into b[0..m)),
 * as [{ kind, count }] in order, with the reference's exact tie-breaks.
 * a and b hold interned line ids; kinds are K_KEEP / K_DELETE / K_INSERT.
 */
function editRuns(a, n, b, m) {
  if (n === 0 && m === 0) return [];
  // The trace: row d at offset d*d, length 2d+1, indexed by k+d. A cell
  // holds the furthest x reached on that diagonal plus one, so 0 means the
  // diagonal holds no path and a fresh Int32Array needs no filling. It
  // grows by doubling; offsets are d*d, so a grown copy keeps every row
  // where it was.
  let cap = 1024;
  let trace = new Int32Array(cap * cap);
  const ensure = (d) => {
    if ((d + 1) * (d + 1) <= trace.length) return;
    while ((d + 1) * (d + 1) > cap * cap) cap *= 2;
    const next = new Int32Array(cap * cap);
    next.set(trace);
    trace = next;
  };
  // One forward step's candidates from the previous row, exactly the
  // reference's: a deletion from diagonal k-1 is a candidate while its path
  // exists and has not consumed the old text; an insertion from diagonal
  // k+1 is a candidate while its path exists and has not consumed the new
  // text. The deletion's post-step x is the stored value itself (x+1), the
  // insertion's is one less; the deletion wins when its x reaches at
  // least as far. A stored 0 means no candidate.
  let foundD = -1;
  // d = 0: the snake from (0, 0).
  let x = 0;
  let y = 0;
  while (x < n && y < m && a[x] === b[y]) { x++; y++; }
  trace[0] = x + 1;
  if (x === n && y === m) {
    foundD = 0;
  } else {
    for (let d = 1; foundD < 0; d++) {
      ensure(d);
      const row = d * d;
      const prev = (d - 1) * (d - 1);
      const prevOff = prev + (d - 1);
      for (let k = -d; k <= d; k += 2) {
        let candDel = -1;
        let candIns = -1;
        if (k - 1 >= -(d - 1) && k - 1 <= d - 1) {
          const s = trace[prevOff + (k - 1)];
          if (s > 0 && s <= n) candDel = s;
        }
        if (k + 1 >= -(d - 1) && k + 1 <= d - 1) {
          const s = trace[prevOff + (k + 1)];
          if (s > 0 && s - k - 2 < m) candIns = s - 1;
        }
        if (candDel < 0 && candIns < 0) {
          trace[row + k + d] = 0;
          continue;
        }
        let xx = candDel >= candIns ? candDel : candIns;
        let yy = xx - k;
        while (xx < n && yy < m && a[xx] === b[yy]) { xx++; yy++; }
        trace[row + k + d] = xx + 1;
        if (xx === n && yy === m) { foundD = d; break; }
      }
    }
  }

  // Walk the trace backwards from (foundD, n-m, n, m). At each step the
  // same candidate rule names the step the forward search took; the snake
  // back to that step's end is kept lines, then the step itself.
  const ops = [];
  let d = foundD;
  let k = n - m;
  x = n;
  y = m;
  while (d > 0) {
    const prev = (d - 1) * (d - 1);
    const prevOff = prev + (d - 1);
    let del;
    if (k === -d) del = false;
    else if (k === d) del = true;
    else {
      let candDel = -1;
      let candIns = -1;
      const sDel = trace[prevOff + (k - 1)];
      if (sDel > 0 && sDel <= n) candDel = sDel;
      const sIns = trace[prevOff + (k + 1)];
      if (sIns > 0 && sIns - k - 2 < m) candIns = sIns - 1;
      del = candDel >= candIns;
    }
    const pk = del ? k - 1 : k + 1;
    const xp = trace[prevOff + pk] - 1;
    const yp = xp - pk;
    const xs = del ? xp + 1 : xp;
    const ys = del ? yp : yp + 1;
    while (x > xs && y > ys) { ops.push(K_KEEP); x--; y--; }
    if (del) { ops.push(K_DELETE); x--; } else { ops.push(K_INSERT); y--; }
    d--;
    k = pk;
  }
  while (x > 0 && y > 0) { ops.push(K_KEEP); x--; y--; }

  const runs = [];
  for (let i = ops.length - 1; i >= 0; i--) {
    const kind = ops[i];
    const last = runs.at(-1);
    if (last !== undefined && last.kind === kind) last.count++;
    else runs.push({ kind, count: 1 });
  }
  return runs;
}

/** A line as the patch writes it: its op, the line, a newline, and "%" on a line of its own when it had none. */
function written(op, line) {
  return line.endsWith('\n') ? `${op}${line}` : `${op}${line}\n%\n`;
}

/** makefun-diff 1.0.0's answer for one case's input. */
export function run(input) {
  if (input === null || typeof input !== 'object' || typeof input.old !== 'string' || typeof input.new !== 'string') {
    throw new TypeError('makefun-diff: the input is { old, new }, two strings');
  }
  const aStr = tokenize(input.old);
  const bStr = tokenize(input.new);
  const n = aStr.length;
  const m = bStr.length;

  // Intern the lines once: the search tests one line pair per diagonal it
  // visits (millions of them), and an integer comparison there is far
  // cheaper than a string comparison, so the Map lookups pay for
  // themselves many times over.
  const ids = new Map();
  let nextId = 0;
  const a = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const s = aStr[i];
    let id = ids.get(s);
    if (id === undefined) { id = nextId++; ids.set(s, id); }
    a[i] = id;
  }
  const b = new Int32Array(m);
  for (let i = 0; i < m; i++) {
    const s = bStr[i];
    let id = ids.get(s);
    if (id === undefined) { id = nextId++; ids.set(s, id); }
    b[i] = id;
  }

  // The common prefix, then the common suffix of what is left.
  let prefix = 0;
  while (prefix < n && prefix < m && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (suffix < n - prefix && suffix < m - prefix && a[n - 1 - suffix] === b[m - 1 - suffix]) suffix++;
  const runs = [];
  if (prefix > 0) runs.push({ kind: K_KEEP, count: prefix });
  runs.push(...editRuns(a.subarray(prefix, n - suffix), n - prefix - suffix, b.subarray(prefix, m - suffix), m - prefix - suffix));
  if (suffix > 0) runs.push({ kind: K_KEEP, count: suffix });

  // The change runs: each a stretch of deletions and insertions between two kept lines, at old line o and new line p.
  const changes = [];
  let o = 0;
  let p = 0;
  let deleted = 0;
  let inserted = 0;
  for (const r of runs) {
    if (r.kind === K_KEEP) {
      o += r.count;
      p += r.count;
      continue;
    }
    let c = changes.at(-1);
    if (c === undefined || c.o + c.dels !== o || c.p + c.ins !== p) {
      c = { o, p, dels: 0, ins: 0 };
      changes.push(c);
    }
    if (r.kind === K_DELETE) {
      c.dels += r.count;
      o += r.count;
      deleted += r.count;
    } else {
      c.ins += r.count;
      p += r.count;
      inserted += r.count;
    }
  }

  // The hunks: change runs at most 2 * CONTEXT kept lines apart share one.
  const hunks = [];
  for (const c of changes) {
    const h = hunks.at(-1);
    const prev = h?.at(-1);
    if (prev !== undefined && c.o - (prev.o + prev.dels) <= 2 * CONTEXT) h.push(c);
    else hunks.push([c]);
  }
  const out = [`${FORMAT} old=${n} new=${m} hunks=${hunks.length} deleted=${deleted} inserted=${inserted}\n`];
  for (const h of hunks) {
    const first = h[0];
    const last = h.at(-1);
    const oldStart = Math.max(0, first.o - CONTEXT);
    const newStart = first.p - (first.o - oldStart);
    const after = Math.min(CONTEXT, n - (last.o + last.dels));
    const oldEnd = last.o + last.dels + after;
    const newEnd = last.p + last.ins + after;
    out.push(`@ ${oldStart + 1} ${oldEnd - oldStart} ${newStart + 1} ${newEnd - newStart}\n`);
    let at = oldStart;
    for (const c of h) {
      for (; at < c.o; at++) out.push(written(KEEP, aStr[at]));
      for (let i = 0; i < c.dels; i++) out.push(written(DELETE, aStr[c.o + i]));
      for (let i = 0; i < c.ins; i++) out.push(written(INSERT, bStr[c.p + i]));
      at = c.o + c.dels;
    }
    for (; at < oldEnd; at++) out.push(written(KEEP, aStr[at]));
  }
  return out.join('');
}
