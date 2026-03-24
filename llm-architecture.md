# llm architecture notes

this file is a compact map for ai/llm edits in this project.

## project shape

- root gallery page: `index.html`
- single-canvas pages:
  - `first/index.html`
  - `second/index.html`
  - `third/index.html`
- shared styles: `styles.css` and `css-reset.css`
- scripts folder: `scripts/`

## runtime entrypoints

- gallery boot:
  - `index.html` loads `scripts/main.js`
  - `scripts/main.js` calls `bootstrapGalleryPage()` from `scripts/loader.js`
- single-canvas boot:
  - each page under `first/`, `second/`, `third/` loads `scripts/single-page.js`
  - `scripts/single-page.js` reads `body[data-canvas-id]` and calls `bootstrapSingleCanvasPage(canvasId)` from `scripts/loader.js`

## orchestration model

`scripts/loader.js` is the manager and should stay framework-agnostic.

it owns:
- active canvas id
- frozen/unfrozen behavior
- controls panel render
- controls panel collapse/expand

gallery default behavior:
- preload all registered canvas modules
- freeze all canvases on first load
- click one canvas to activate only that one

## canvas module contract

each canvas module in `scripts/first.js`, `scripts/second.js`, `scripts/third.js` exports one object with:

- `id` (must match `<canvas id="...">`)
- `label`
- `init({ canvas })`
- `createControls({ currentState, onStateChange })` returns `HTMLElement`
- `getState()`
- `setState(nextState)`
- `setFrozen(isFrozen)`
- `setActive(isActive)`

## adding a new canvas module

1. create `scripts/<name>.js` with the same contract.
2. add a matching `<canvas id="<name>">` in the target page.
3. import and register the module in `scripts/loader.js`.
4. if needed, create a dedicated page `<name>/index.html` with `body[data-canvas-id="<name>"]`.
5. add/update corresponding navigation link on `index.html`.

## edit boundaries for llms

- use `scripts/loader.js` for orchestration and shared page behavior.
- keep canvas-specific logic and controls in each module file.
- avoid cross-module state mutations; communicate through module methods.
- avoid putting manager logic in `scripts/main.js` or `scripts/single-page.js`; those are entry shims.