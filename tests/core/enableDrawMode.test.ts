import { describe, it, expect, vi } from "vitest";
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

  it("uses Geoman's polygon tool for building massing", async () => {
    const { editor, enableDrawCalls, teardowns } = makeEditor();

    editor.enableDrawMode("massing");
    teardowns[0]();
    await flush();

    expect(enableDrawCalls).toEqual(["polygon"]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((editor as any).state.activeDrawMode).toBe("massing");
  });
});

describe("massing feature creation", () => {
  it("commits the configured height through Geoman before creation callback", () => {
    const onFeatureCreate = vi.fn();
    const updateProperties = vi.fn();
    const editor = new GeoEditor({
      massingHeightProperty: "building_height",
      massingDefaultHeight: 18,
      onFeatureCreate,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyEditor = editor as any;
    let listener: ((event: unknown) => void) | undefined;
    anyEditor.geoman = {
      setGlobalEventsListener: (callback: (event: unknown) => void) => {
        listener = callback;
      },
    };
    anyEditor.state.activeDrawMode = "massing";
    anyEditor.findGeomanDataForFeature = () => ({ updateProperties });
    anyEditor.recordCreateOperation = () => {};
    anyEditor.setupGeomanEvents();

    const feature = {
      type: "Feature" as const,
      properties: {},
      geometry: {
        type: "Polygon" as const,
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 0],
          ],
        ],
      },
    };
    listener?.({ type: "gm:create", feature });

    expect(updateProperties).toHaveBeenCalledWith({ building_height: 18 });
    expect(onFeatureCreate).toHaveBeenCalledWith(
      expect.objectContaining({ properties: { building_height: 18 } }),
    );
  });
});
