async (page) => {
  const check = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  await page.setViewportSize({ width: 1100, height: 760 });
  await page.goto("http://127.0.0.1:5173/tests/browser/snapping.html");
  await page.waitForFunction(() =>
    window.snapTest?.map
      .queryRenderedFeatures()
      .some((f) => f.id === "target-way"),
  );
  await page.getByRole("button", { name: "Line", exact: true }).click();
  await page.waitForFunction(
    () =>
      window.snapTest.editor.isSnapTrackingAvailable() &&
      window.snapTest.gm.actionInstances.draw__line &&
      window.snapTest.gm.markerPointer.marker,
  );

  await page.mouse.move(405, 302);
  await page.waitForFunction(
    () => window.snapTest.editor.getSnapTarget()?.target.kind === "vertex",
  );
  const vertex = await page.evaluate(() =>
    window.snapTest.editor.getSnapTarget(),
  );
  check(
    vertex.target.featureId === "target-way",
    "Wrong vertex target feature",
  );
  check(
    vertex.target.feature.properties.osm_version === 7,
    "Version metadata missing",
  );
  check(
    JSON.stringify(vertex.target.coordinatePath) ===
      '["geometry","coordinates",0]',
    "Wrong vertex path",
  );

  await page.mouse.move(550, 305);
  await page.waitForFunction(
    () => window.snapTest.editor.getSnapTarget()?.target.kind === "segment",
  );
  const segment = await page.evaluate(() =>
    window.snapTest.editor.getSnapTarget(),
  );
  check(
    segment.target.featureId === "target-way",
    "Wrong segment target feature",
  );
  check(
    JSON.stringify(segment.target.segmentPaths) ===
      '[["geometry","coordinates",0],["geometry","coordinates",1]]',
    "Wrong segment paths",
  );

  await page.mouse.move(850, 550);
  await page.waitForFunction(
    () => window.snapTest.editor.getSnapTarget() === null,
  );
  check(
    await page.evaluate(() =>
      window.snapTest.events.some((e) => e.name === "gm:unsnap"),
    ),
    "Missing unsnap event",
  );

  await page.mouse.move(405, 302);
  await page.waitForFunction(
    () => window.snapTest.editor.getSnapTarget()?.target.kind === "vertex",
  );
  await page.mouse.click(405, 302);
  await page.mouse.move(800, 500, { steps: 8 });
  await page.mouse.dblclick(800, 500, { delay: 150 });
  await page.waitForFunction(() => window.snapTest.created.length === 1);
  const created = await page.evaluate(() => ({
    feature: window.snapTest.created[0],
    endpoint: window.snapTest.endpoints[0],
  }));
  check(
    JSON.stringify(created.feature.geometry.coordinates[0]) ===
      JSON.stringify(created.endpoint),
    "Committed vertex did not use snapped coordinate",
  );

  await page
    .getByRole("button", { name: "Undo (Ctrl+Z)", exact: true })
    .click();
  await page.waitForFunction(
    () => window.snapTest.gm.features.exportGeoJson().features.length === 1,
  );
  await page
    .getByRole("button", { name: "Redo (Ctrl+Y)", exact: true })
    .click();
  await page.waitForFunction(
    () => window.snapTest.gm.features.exportGeoJson().features.length === 2,
  );

  await page
    .getByRole("button", {
      name: "Clear selection and disable tools",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "Line", exact: true }).click();
  await page.waitForFunction(
    () =>
      window.snapTest.editor.isSnapTrackingAvailable() &&
      window.snapTest.gm.actionInstances.draw__line,
  );
  await page.mouse.move(705, 303);
  await page.waitForFunction(
    () => window.snapTest.editor.getSnapTarget()?.target.kind === "vertex",
  );
  await page
    .getByRole("button", { name: "Toggle Snapping", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      !window.snapTest.editor.isSnapTrackingAvailable() &&
      !window.snapTest.editor.getSnapTarget(),
  );
  await page
    .getByRole("button", { name: "Toggle Snapping", exact: true })
    .click();
  await page.waitForFunction(() =>
    window.snapTest.editor.isSnapTrackingAvailable(),
  );
  await page.mouse.move(704, 304);
  await page.waitForFunction(
    () => window.snapTest.editor.getSnapTarget()?.target.kind === "vertex",
  );

  await page.getByRole("button", { name: "Edit", exact: true }).click();
  // Wait for rendered handles, not just the mode flag: Geoman creates them asynchronously.
  await page.waitForFunction(() =>
    window.snapTest.map
      .queryRenderedFeatures([800, 500])
      .some((f) => f.properties.__gm_shape === "vertex_marker"),
  );
  await page.mouse.move(800, 500);
  await page.mouse.down();
  await page.waitForFunction(
    () =>
      !!window.snapTest.gm.actionInstances.helper__shape_markers.activeMarker,
  );
  await page.mouse.move(550, 305, { steps: 20 });
  await page.waitForFunction(
    () => window.snapTest.editor.getSnapTarget()?.target.kind === "segment",
  );
  const dragSnap = await page.evaluate(() =>
    window.snapTest.editor.getSnapTarget(),
  );
  check(
    dragSnap.target.featureId === "target-way",
    "Drag snapped to the wrong feature",
  );
  await page.mouse.up();
  await page.waitForFunction((coordinate) => {
    const edited = window.snapTest.gm.features
      .exportGeoJson()
      .features.find((f) => f.id !== "target-way");
    return (
      JSON.stringify(edited.geometry.coordinates[1]) ===
      JSON.stringify(coordinate)
    );
  }, dragSnap.coordinate);

  const result = await page.evaluate(() => ({
    errors: window.snapTest.errors,
    snapEvents: window.snapTest.events.filter((e) => e.name === "gm:snap")
      .length,
    unsnapEvents: window.snapTest.events.filter((e) => e.name === "gm:unsnap")
      .length,
    featureCount: window.snapTest.gm.features.exportGeoJson().features.length,
  }));
  check(result.errors.length === 0, JSON.stringify(result.errors));
  check(result.snapEvents > 0, "Missing snap event");
  check(result.unsnapEvents > 0, "Missing unsnap event");
  await page.screenshot({ path: ".playwright-cli/snapping-verified.png" });
  return {
    passed: [
      "vertex identity and version",
      "segment identity and paths",
      "unsnap",
      "draw commits snapped coordinate",
      "undo/redo",
      "helper recreation after snapping toggle",
      "vertex drag commits segment snap",
    ],
    ...result,
  };
}
