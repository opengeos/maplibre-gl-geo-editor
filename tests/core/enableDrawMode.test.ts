import { describe, it, expect } from "vitest";
import { GeoEditor } from "../../src/lib/core/GeoEditor";
import type { DrawMode } from "../../src/lib/core/types";

/**
 * Build a GeoEditor whose map-dependent side effects are stubbed out and whose
 * `disableAllModes` returns a caller-controlled promise, so we can observe when
 * `geoman.enableDraw` fires relative to that teardown settling.
 */
function makeEditor() {
  const editor = new GeoEditor();
  const enableDrawCalls: DrawMode[] = [];
  let resolveTeardown!: () => void;
  const teardown = new Promise<void>((resolve) => {
    resolveTeardown = resolve;
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyEditor = editor as any;
  anyEditor.disableAllModes = () => teardown;
  anyEditor.geoman = {
    enableDraw: (mode: DrawMode) => enableDrawCalls.push(mode),
  };
  anyEditor.updateToolbarState = () => {};
  anyEditor.applyVertexMarkerStyles = () => {};

  return { editor, enableDrawCalls, resolveTeardown };
}

describe("enableDrawMode draw-tool-switch sequencing (#889)", () => {
  it("defers geoman.enableDraw until disableAllModes has settled", async () => {
    const { editor, enableDrawCalls, resolveTeardown } = makeEditor();

    editor.enableDrawMode("circle" as DrawMode);

    // The mode state is set synchronously, but the new draw mode must NOT be
    // enabled yet: doing so lets geoman's still-in-flight teardown swallow the
    // first canvas click (the "dead click" from issue #889).
    expect(enableDrawCalls).toEqual([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((editor as any).state.activeDrawMode).toBe("circle");

    resolveTeardown();
    await teardownFlush();

    expect(enableDrawCalls).toEqual(["circle"]);
  });

  it("skips the stale enable when a newer mode supersedes it mid-teardown", async () => {
    const { editor, enableDrawCalls, resolveTeardown } = makeEditor();

    editor.enableDrawMode("circle" as DrawMode);
    // A newer tool selection lands before the first teardown resolves.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (editor as any).state.activeDrawMode = "line";

    resolveTeardown();
    await teardownFlush();

    // The stale 'circle' enable is dropped; only the current mode should win.
    expect(enableDrawCalls).toEqual([]);
  });
});

/** Flush the resolved teardown promise plus the follow-up .then microtask. */
async function teardownFlush() {
  await Promise.resolve();
  await Promise.resolve();
}
