# tickread

A swipe-based market intuition test. You are shown an anonymised candlestick and
volume chart and swipe **up for up**, **down for down**. Ten questions, then a
report covering where you are actually good and how you tend to decide.

Static site. No backend, no API keys at runtime, no hosting cost — the question bank
is built offline and committed as JSON.

---

## Run it locally

```bash
npm install -g typescript      # the only build tool; the app itself has no dependencies
tsc -p .
python -m http.server 8000
# open http://localhost:8000
```

**A static server is required.** Opening `index.html` from the filesystem does not
work: browsers block ES module loading and `fetch` over `file://`. On GitHub Pages
the site is served over HTTP, so this only affects local work.

## Tests

```bash
tsc -p .
node dist/tests/run.js          # 107 unit tests, no server needed
```

The same tests also run in a browser at `tests/index.html`.

Python pipeline:

```bash
cd scripts
python -m unittest test_pipeline    # 47 tests, no network
```

End-to-end against the real question bank, with a server running:

```bash
python -m http.server 8765 --bind 127.0.0.1
node dist/tests/integration.js
```

That one is worth running before any deploy. It checks the relative paths resolve,
that `index.html` still satisfies the element contract in `app.ts`, and that a full
round can actually be drawn and scored from the shipped data.

## Rebuilding the question bank

```bash
cd scripts
python fetch_yahoo.py       # ~2 minutes, no API key
python build_deck.py        # writes ../data/
```

Yahoo Finance covers every timeframe and asset class, so this is all that is needed.
Bars are cached under `scripts/.cache/` (gitignored); delete a file to refetch it.

Optionally, with a Polygon key, minute history deepens from Yahoo's seven days to
two years:

```bash
export POLYGON_API_KEY=...
python fetch_polygon.py     # rate limited to 5 req/min, so hours; resumable
python build_deck.py
```

The key is only ever used here, on your machine. It is never committed and never
reaches the browser.

## Layout

```
src/         eight modules; only app.ts touches the DOM
tests/       hand-rolled harness, unit tests, integration check
scripts/     Python data pipeline (standard library only)
data/        the shipped question bank — 1,340 questions, 1.24 MB gzipped
```

`stats`, `persona`, `deck` and `session` are pure and DOM-free. That is where the
real logic risk lives — interval maths, metric edge cases, stratified sampling — and
it is what the unit tests cover.

## Deploying

Pushing to `master` builds and publishes to GitHub Pages via
`.github/workflows/deploy-tickread.yml`. Compiled output is not committed; the
workflow runs `tsc`, runs the tests, and publishes `project/tickread/code`.

---

Historical market data, shown for practice. Not trading advice.
