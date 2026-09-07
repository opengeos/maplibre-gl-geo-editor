# Browser checks with playwright-cli

Requires `playwright-cli` and its Chromium browser. From the repository root,
start the development server in one terminal:

```bash
npm run dev -- --host 127.0.0.1 --port 5173
```

Run the snap integration checks in another:

```bash
playwright-cli -s=geo-editor open about:blank
playwright-cli -s=geo-editor run-code --filename=tests/browser/snapping.playwright.js
```

The fixture uses a local blank basemap and known feature metadata. The script
checks vertex/segment identity, version properties, unsnapping, committed drawing
coordinates, undo/redo, snapping toggle lifecycle, and dragging a vertex onto a
segment. It uses the real MapLibre worker, Geoman helper, and mouse interactions.

To test the production examples, build and start the preview server:

```bash
npm run build:examples
npx vite preview --config vite.examples.config.ts --host 127.0.0.1 --port 4173
```

Then run:

```bash
playwright-cli -s=geo-editor run-code --filename=tests/browser/examples.playwright.js
playwright-cli -s=geo-editor close
```

Both production examples must load their worker successfully, complete a drawn
line, and enable undo without application errors. The React example must update
its feature count from two to three. Screenshots are saved to `.playwright-cli/`.
The examples use OpenStreetMap raster tiles; the snapping fixture needs no
external basemap requests. A missing example favicon is ignored by the smoke test.
