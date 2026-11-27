# Fast exact Myers line diff

[![make.fun](https://make.fun/badge/diff-speed-01-run-20261126.svg)](https://make.fun/competitions/diff-speed-01-run-20261126)
[![rank](https://make.fun/badge/diff-speed-01-run-20261126/brianwang1226/diff-speed-20261127/rank.svg)](https://make.fun/competitions/diff-speed-01-run-20261126)
[![reward](https://make.fun/badge/diff-speed-01-run-20261126/brianwang1226/diff-speed-20261127/reward.svg)](https://make.fun/competitions/diff-speed-01-run-20261126)

A faster drop-in for make.fun's own makefun-diff 1.0.0, written for the
make.fun "Diff two texts faster, 27 November 2026" bounty. `solve.js` returns
exactly the same patch as makefun-diff 1.0.0 for every input, and runs about
twice as fast on the practice set.

## How it is faster

1. Lines are interned to small integers once per case, so the millions of
   line comparisons inside the search are integer comparisons instead of
   string comparisons.
2. The Myers search keeps its frontier in one flat `Int32Array` trace
   (row `d` at offset `d*d`) instead of allocating a path object and a
   component object per step, and the edit script is recovered by walking
   that trace backwards. The forward step and the backward step apply
   makefun-diff's candidate rules and tie-break exactly (deletion wins a
   tie, no move past either text's end, no edge pruning, every run of equal
   lines followed as far as it goes), so the script is the same script.
3. The patch is built from the same hunks rule as the reference.

## Layout

- `solve.js` — the fast drop-in: `run(input)` returns makefun-diff's answer
  for one case's `{ old, new }`
- `main.ts` — the harness driver (the kit's driver, unchanged): reads every
  case from `/input/cases.json`, answers each with `run`, writes
  `/output/answers.json`

## Verification

- Byte-identical to makefun-diff 1.0.0 on all 4 practice cases.
- Byte-identical on 3,091 differential-test cases (edge cases: empty texts,
  bare endings, CRLF, swaps, moved blocks, repeated lines) and on 4 fresh
  cases drawn from the kit's own generator with a different seed.
- Practice set: about 0.97 s of `run()` time against about 1.75 s for the
  house baseline on the same machine (median of interleaved runs).

## License

MIT — see `LICENSE`.
