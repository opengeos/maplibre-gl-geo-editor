import { describe, it, expect } from "vitest";
import type { Feature, Polygon } from "geojson";
import { GeoEditor } from "../../src/lib/core/GeoEditor";
import type {
  GeoEditorPopup,
  GeoEditorPopupOptions,
} from "../../src/lib/core/types";

const square: Feature<Polygon> = {
  type: "Feature",
  properties: { name: "square" },
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        [0, 0],
        [0, 2],
        [2, 2],
        [2, 0],
        [0, 0],
      ],
    ],
  },
};

/**
 * A popup that records what the editor did to it, standing in for the popup
 * class of an engine other than MapLibre (mapbox-gl's has the same surface).
 */
class FakePopup implements GeoEditorPopup {
  lngLat: unknown = null;
  content: Node | string | null = null;
  map: unknown = null;
  removed = false;
  constructor(public readonly options: GeoEditorPopupOptions) {}
  setLngLat(lngLat: [number, number] | { lng: number; lat: number }) {
    this.lngLat = lngLat;
    return this;
  }
  setDOMContent(node: Node) {
    this.content = node;
    return this;
  }
  setHTML(html: string) {
    this.content = html;
    return this;
  }
  addTo(map: unknown) {
    this.map = map;
    return this;
  }
  remove() {
    this.removed = true;
    return this;
  }
}

function makeEditor(options: ConstructorParameters<typeof GeoEditor>[0]) {
  const popups: FakePopup[] = [];
  const editor = new GeoEditor({
    ...options,
    createPopup: (popupOptions) => {
      const popup = new FakePopup(popupOptions);
      popups.push(popup);
      return popup;
    },
  });
  const map = { id: "fake-map" };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (editor as any).map = map;
  return { editor, popups, map };
}

describe("createPopup", () => {
  it("builds the feature-properties popup through the supplied factory", () => {
    const { editor, popups, map } = makeEditor({
      showFeatureProperties: true,
      enableAttributeEditing: false,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (editor as any).showFeaturePropertiesPopup(square);

    expect(popups).toHaveLength(1);
    const [popup] = popups;
    expect(popup.options).toMatchObject({
      closeButton: true,
      closeOnClick: false,
      className: "geo-editor-properties-popup",
    });
    // Anchored at the feature's centroid and added to the editor's map.
    expect(popup.lngLat).toEqual([1, 1]);
    expect(popup.map).toBe(map);
    expect(String(popup.content)).toContain("square");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (editor as any).hideFeaturePropertiesPopup();
    expect(popup.removed).toBe(true);
  });

  it("builds the numerical-rotation popup through the supplied factory", () => {
    const { editor, popups, map } = makeEditor({});

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (editor as any).openRotatePopup({ lng: 0.5, lat: 0.5 }, square, {
      id: "f1",
    });

    expect(popups).toHaveLength(1);
    const [popup] = popups;
    expect(popup.options.className).toBe("geo-editor-rotate-popup");
    expect(popup.lngLat).toEqual({ lng: 0.5, lat: 0.5 });
    expect(popup.map).toBe(map);
    expect(popup.content).toBeInstanceOf(HTMLElement);

    // Opening a second one closes the first.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (editor as any).openRotatePopup({ lng: 1, lat: 1 }, square, { id: "f1" });
    expect(popup.removed).toBe(true);
    expect(popups).toHaveLength(2);
  });
});
