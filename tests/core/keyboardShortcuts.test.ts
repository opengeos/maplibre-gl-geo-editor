import { describe, it, expect, vi, afterEach } from "vitest";
import { GeoEditor } from "../../src/lib/core/GeoEditor";

/**
 * Build a GeoEditor with its document keydown listener installed and the
 * actions the shortcuts trigger replaced by spies, so a test can dispatch a
 * key event and see which action ran and whether the default was prevented.
 */
function makeEditor() {
  const editor = new GeoEditor();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyEditor = editor as any;
  const spies = {
    undo: vi.fn(),
    redo: vi.fn(),
    copySelectedFeatures: vi.fn(),
    pasteFeatures: vi.fn(),
    deleteSelectedFeatures: vi.fn(),
    disableAllModes: vi.fn(),
    clearSelection: vi.fn(),
  };
  Object.assign(anyEditor, spies);
  anyEditor.setupKeyboardShortcuts();
  return { anyEditor, spies };
}

/** Dispatch a bubbling, cancelable keydown on `target` and return the event. */
function press(target: EventTarget, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

let current: ReturnType<typeof makeEditor> | null = null;

afterEach(() => {
  current?.anyEditor.removeKeyboardShortcuts();
  current = null;
  document.body.innerHTML = "";
});

describe("keyboard shortcuts and text fields (#50)", () => {
  const shortcuts: Array<[string, KeyboardEventInit]> = [
    ["Ctrl+C", { key: "c", ctrlKey: true }],
    ["Ctrl+V", { key: "v", ctrlKey: true }],
    ["Cmd+V", { key: "v", metaKey: true }],
    ["Ctrl+Z", { key: "z", ctrlKey: true }],
    ["Ctrl+Y", { key: "y", ctrlKey: true }],
    ["Ctrl+Shift+Z", { key: "Z", ctrlKey: true, shiftKey: true }],
    ["Backspace", { key: "Backspace" }],
    ["Escape", { key: "Escape" }],
  ];

  for (const tag of ["input", "textarea"] as const) {
    it.each(shortcuts)(`leaves %s alone in a <${tag}>`, (_name, init) => {
      current = makeEditor();
      const field = document.createElement(tag);
      document.body.appendChild(field);

      const event = press(field, init);

      expect(event.defaultPrevented).toBe(false);
      for (const spy of Object.values(current.spies)) {
        expect(spy).not.toHaveBeenCalled();
      }
    });
  }

  it("leaves Ctrl+V alone in a contenteditable element", () => {
    current = makeEditor();
    const div = document.createElement("div");
    div.contentEditable = "true";
    // jsdom does not implement isContentEditable.
    Object.defineProperty(div, "isContentEditable", { value: true });
    document.body.appendChild(div);

    const event = press(div, { key: "v", ctrlKey: true });

    expect(event.defaultPrevented).toBe(false);
    expect(current.spies.pasteFeatures).not.toHaveBeenCalled();
  });

  it("leaves Ctrl+V alone in an input inside a shadow root", () => {
    current = makeEditor();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const input = document.createElement("input");
    host.attachShadow({ mode: "open" }).appendChild(input);

    const event = press(input, { key: "v", ctrlKey: true, composed: true });

    expect(event.defaultPrevented).toBe(false);
    expect(current.spies.pasteFeatures).not.toHaveBeenCalled();
  });

  it("still handles the shortcuts outside text fields", () => {
    current = makeEditor();
    const { spies } = current;

    expect(
      press(document.body, { key: "v", ctrlKey: true }).defaultPrevented,
    ).toBe(true);
    expect(spies.pasteFeatures).toHaveBeenCalledTimes(1);

    expect(
      press(document.body, { key: "c", ctrlKey: true }).defaultPrevented,
    ).toBe(true);
    expect(spies.copySelectedFeatures).toHaveBeenCalledTimes(1);

    expect(
      press(document.body, { key: "z", ctrlKey: true }).defaultPrevented,
    ).toBe(true);
    expect(spies.undo).toHaveBeenCalledTimes(1);

    press(document.body, { key: "Delete" });
    expect(spies.deleteSelectedFeatures).toHaveBeenCalledTimes(1);

    press(document.body, { key: "Escape" });
    expect(spies.clearSelection).toHaveBeenCalledTimes(1);
  });
});
