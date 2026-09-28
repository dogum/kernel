# Contributing

Thanks for helping. The bar: KERNEL stays a notebook you can open as one HTML file, with no server and no account, and the agent never does anything the person can't see, stop, or undo.

## Layout

- `src/` is the source of the two agent pages. `scripts/build.mjs` builds them into `docs/kernel-agent.html` and `docs/kernel-agent-mobile.html`, so never edit those two by hand. [`src/README.md`](src/README.md) maps the tree: which folder holds the notebook, the agent, the Python harness, the CSS, and the shared markup.
- `docs/` is the GitHub Pages site. `kernel.html` (the notebook without the agent), `index.html`, the service worker, and the icons are edited directly.
- `skill/` is the `kernel-notebooks` Claude skill; `kernel-notebooks.skill` is the same folder zipped, and CI checks that they match.
- `tests/verify_*.mjs` are static and fixture checks. `tests/e2e/` drives both builds in Chromium against a mock model provider. `tests/lib/source.mjs` has the helpers for reading the app's code.
- `examples/` holds curated agent runs, checked by `tests/verify_examples.mjs`.
- `AGENT-V24-SPEC.md` is the agent's current contract, on top of the earlier specs.

## Before you open a PR

```bash
npm ci
npm run format        # formats src/ with Prettier and rebuilds docs/
npm run check         # docs/ matches src/ and src/ is formatted (CI runs this)
npm test              # static and fixture checks
npx playwright install chromium   # once
npm run test:e2e      # both builds in a real browser, a few minutes
```

Then look at your change in a browser: `python3 -m http.server -d docs` and open `http://localhost:8000/kernel-agent.html`. Check a phone width too (the mobile build is `kernel-agent-mobile.html`). For anything visible, put a before and after screenshot in the PR.

## Writing tests

- Test behavior, not text. Pull the functions you need out of a built page with `declarations(page, ...names)` or `functionSource(page, name)`, give them small stubs, and call them. `tests/verify_agent_v24.mjs` has many examples.
- When all you can check is that some code exists, use `has(page, snippet)`. It matches JavaScript tokens, so formatting never breaks it.
- UI behavior goes in `tests/e2e/ui.mjs`, which runs on both builds. Agent behavior goes in `tests/e2e/agent-loop.mjs`, against the mock provider in `tests/e2e/mock-provider.mjs`.

## Rules of thumb

- **One file, no server.** A built page loads only from the CDNs it already uses (Pyodide, KaTeX, Mermaid, fonts). Adding a runtime dependency needs a strong reason.
- **Keys stay in the browser** and go only to the API base the person chose. Exports and diagnostics never include them, and tests check this.
- **Desktop and mobile share code.** Shared behavior goes in `src/agent/js/` or `src/agent/markup/`; only phone-specific layout goes in `mobile.css` or `js/mobile/`.
- **Keep the agent's contracts.** Durable runs, checkpoints, the completion check, and context exclusions are specified in the `AGENT-V*-SPEC.md` files. If a change alters one, update the current spec in the same PR.
- **Plain language in the UI.** Say what happened and what to do next. Offer Undo rather than a confirmation dialog when the action can be undone.

## Releasing

1. Bump `version` in `package.json` and run `npm run build`. The titles, the brand, and export metadata pick it up.
2. If the mobile app shell changed, bump the cache name in `docs/kernel-agent-sw.js` and the test that checks it.
3. Add a section to `CHANGELOG.md`.
4. Tag `vX.Y.Z` and push the tag, or run the Release workflow. It checks that the tag matches `package.json`, runs the checks, and publishes a GitHub Release. The release uses the changelog section as notes and attaches the single-file pages and the skill.
