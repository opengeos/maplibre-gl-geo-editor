async (page) => {
  const results = [];
  const errors = [];
  const workers = [];
  const pageError = (error) => errors.push(error.message);
  const consoleError = (message) => {
    // The examples ship no favicon; every other missing asset is a real error.
    const faviconMiss =
      message.location().url.endsWith("/favicon.ico") &&
      message.text().includes("404 (Not Found)");
    if (message.type() === "error" && !faviconMiss)
      errors.push(message.text());
  };
  const response = (response) => {
    if (response.url().includes("maplibre-gl-worker"))
      workers.push({ url: response.url(), status: response.status() });
  };
  page.on("pageerror", pageError);
  page.on("console", consoleError);
  page.on("response", response);
  try {
    for (const example of ["basic", "react"]) {
      errors.length = 0;
      workers.length = 0;
      await page.goto(
        `http://127.0.0.1:4173/maplibre-gl-geo-editor/examples/${example}/`,
      );
      await page.getByRole("button", { name: "Line", exact: true }).click();
      await page
        .locator(".maplibregl-marker")
        .first()
        .waitFor({ state: "visible" });
      await page.mouse.move(350, 450);
      await page.mouse.click(350, 450);
      await page.mouse.move(750, 600, { steps: 20 });
      await page.mouse.dblclick(750, 600, { delay: 150 });
      await page.waitForFunction(
        () =>
          document.querySelector('[data-history="undo"]')?.disabled === false,
      );
      if (example === "react") {
        await page.getByText("3", { exact: true }).waitFor();
      }
      if (errors.length || !workers.some((worker) => worker.status === 200)) {
        throw new Error(JSON.stringify({ example, errors, workers }));
      }
      await page.screenshot({
        path: `.playwright-cli/production-${example}.png`,
      });
      results.push({
        example,
        drawing: "passed",
        errors: [...errors],
        workers: [...workers],
      });
    }
    return results;
  } finally {
    page.off("pageerror", pageError);
    page.off("console", consoleError);
    page.off("response", response);
  }
}
