[![site-generator-speed-01-run-20261122](https://make.fun/badge/site-generator-speed-01-run-20261122.svg)](https://make.fun/competitions/site-generator-speed-01-run-20261122)
[![rank](https://make.fun/badge/site-generator-speed-01-run-20261122/sularno67/site-generator-speed/rank.svg)](https://make.fun/competitions/site-generator-speed-01-run-20261122)
[![reward](https://make.fun/badge/site-generator-speed-01-run-20261122/sularno67/site-generator-speed/reward.svg)](https://make.fun/competitions/site-generator-speed-01-run-20261122)

# site-generator-speed

A fast drop-in for makefun-site 1.0.0: a dependency-free static site generator
that returns, byte for byte, the same output tree makefun-site returns for a
site — pages, index and tag pages, `build-report.txt` and static files — but
renders it faster.

How it is fast: Markdown is rendered in a single pass over the lines with an
index-range inline renderer (no token objects, no re-slicing for nested
emphasis or links); front matter is scanned without splitting the body;
slugs are cached and take an ASCII fast path; and every template is parsed
once and compiled to a small JavaScript function whose loop bindings resolve
to locals, so rendering a page is straight string building.

- `solve.js` — the whole generator, one dependency-free ES module; `run(input)` is the entry point.
- `main.ts` — the harness driver: reads `/input/cases.json`, answers each case with `run`, writes `/output/answers.json`.
