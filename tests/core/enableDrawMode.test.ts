import { describe, it, expect } from "vitest";
import { GeoEditor } from "../../src/lib/core/GeoEditor";
import type { DrawMode } from "../../src/lib/core/types";

/**
 * Build a GeoEditor whose map-dependent side effects are stubbed out and whose
 * `disableAllModes` hands back a fresh, caller-controlled promise on every call.
 * The `teardowns` array collects the resolver for each call in order, so a test
 * can settle an older teardown before a newer one and observe which tool
 * `geoman.enableDraw` (or the freehand path) actually arms.
 */
function makeEditor() {
  const editor = new GeoEditor();
  const enableDrawCalls: DrawMode[] = [];
  const freehandCalls: number[] = [];
  const teardowns: Array<() => void> = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyEditor = editor as any;
  anyEditor.disableAllModes = () =>
    new Promise<void>((resolve) => {
      teardowns.push(resolve);
    });
  anyEditor.geoman = {
    enableDraw: (mode: DrawMode) => enableDrawCalls.push(mode),
  };
  anyEditor.enableFreehandMode = () => freehandCalls.push(1);
  anyEditor.updateToolbarState = () => {};
  anyEditor.applyVertexMarkerStyles = () => {};

  return { editor, enableDrawCalls, freehandCalls, teardowns };
}

/** Flush the resolved teardown promise plus the follow-up .then microtask. */
async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("enableDrawMode draw-tool-switch sequencing (#889)", () => {
  it("defers geoman.enableDraw until disableAllModes has settled", async () => {
    const { editor, enableDrawCalls, teardowns } = makeEditor();

    editor.enableDrawMode("circle" as DrawMode);

    // The mode state is set synchronously, but the new draw mode must NOT be
    // armed yet: doing so lets geoman's still-in-flight teardown swallow the
    // first canvas click (the "dead click" from issue #889).
    expect(enableDrawCalls).toEqual([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((editor as any).state.activeDrawMode).toBe("circle");

    teardowns[0]();
    await flush();

    expect(enableDrawCalls).toEqual(["circle"]);
  });

  it("drops the stale enable when a newer tool supersedes it mid-teardown", async () => {
    const { editor, enableDrawCalls, teardowns } = makeEditor();

    editor.enableDrawMode("circle" as DrawMode);
    editor.enableDrawMode("line" as DrawMode);

    // Settle the older (circle) teardown first: its enable must be dropped.
    teardowns[0]();
    await flush();
    expect(enableDrawCalls).toEqual([]);

    // Only the latest selection arms, once its own teardown settles.
    teardowns[1]();
    await flush();
    expect(enableDrawCalls).toEqual(["line"]);
  });

  it("drops a stale same-mode reselect (circle -> line -> circle)", async () => {
    const { editor, enableDrawCalls, teardowns } = makeEditor();

    editor.enableDrawMode("circle" as DrawMode);
    editor.enableDrawMode("line" as DrawMode);
    editor.enableDrawMode("circle" as DrawMode);

    // The first circle's teardown settles: a mode-value guard would wrongly let
    // it arm because the active mode is "circle" again, but the request token
    // must drop it.
    teardowns[0]();
    await flush();
    expect(enableDrawCalls).toEqual([]);

    teardowns[1]();
    await flush();
    expect(enableDrawCalls).toEqual([]);

    // Only the most recent request arms.
    teardowns[2]();
    await flush();
    expect(enableDrawCalls).toEqual(["circle"]);
  });

  it("also sequences the freehand tool after the teardown", async () => {
    const { editor, freehandCalls, teardowns } = makeEditor();

    editor.enableDrawMode("freehand" as DrawMode);
    expect(freehandCalls).toEqual([]);

    teardowns[0]();
    await flush();
    expect(freehandCalls).toEqual([1]);
  });
});
