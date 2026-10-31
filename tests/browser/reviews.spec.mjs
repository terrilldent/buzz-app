import { test, expect } from "./source-fixture.mjs";

// Real IndexedDB commits/reopen and rendered link geometry need a browser, not jsdom.
test("review queue survives reload, reconciles on refresh, and isolates GitHub accounts", async ({
  page,
}) => {
  let account = { id: "user-a", login: "alex" };
  let offline = false;
  const pr = (number, title) => ({
    id: `pr-${number}`,
    number,
    title,
    url: `https://github.com/sample/project/pull/${number}`,
    updatedAt: "2026-10-31T12:00:00Z",
    isDraft: false,
    repository: { nameWithOwner: "sample/project" },
    author: { login: "sam" },
  });
  let nodes = [
    pr(1, "Keep release notes easy to scan"),
    pr(2, "Fix startup recovery"),
  ];
  await page.route("**/reviews-fixture", async (route) => {
    const { query } = route.request().postDataJSON();
    if (query.includes("search(")) {
      if (offline) return route.fulfill({ status: 503, body: "Offline" });
      return route.fulfill({
        json: {
          viewer: account,
          search: {
            nodes,
            issueCount: nodes.length,
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      });
    }
    return route.fulfill({ json: { viewer: account } });
  });
  await page.goto("/tests/fixtures/reviews.html");
  const first = page.getByRole("link", { name: /Keep release notes/ });
  await expect(first).toHaveAttribute(
    "href",
    "https://github.com/sample/project/pull/1",
  );
  await expect(page.getByText(/Last synced/)).toBeVisible();
  // A completed failed search is the barrier proving persisted rows were restored.
  offline = true;
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("Showing saved reviews");
  await expect(first).toBeVisible();
  offline = false;
  nodes = [
    pr(2, "Fix startup recovery after reconnecting"),
    pr(
      3,
      "Handle a very long repository and pull request title without clipping keyboard focus",
    ),
  ];
  const refresh = page.getByRole("button", { name: "Refresh reviews" });
  await refresh.click();
  await expect(
    page.getByRole("link", { name: /after reconnecting/ }),
  ).toBeVisible();
  await expect(first).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
  for (const theme of ["light", "dark"]) {
    for (const [width, scale] of [
      [1100, 1],
      [390, 2],
    ]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(
        ({ theme, scale }) => {
          document.documentElement.dataset.colorMode = theme;
          document.documentElement.style.fontSize = `${16 * scale}px`;
        },
        { theme, scale },
      );
      await page.evaluate(() => document.fonts.ready);
      const row = page.getByRole("link", { name: /very long repository/ });
      await row.focus();
      await expect(row).toBeFocused();
      const bounds = await row.boundingBox();
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
  }
  account = { id: "user-b", login: "blair" };
  nodes = [];
  await refresh.click();
  await expect(page.getByText("No outstanding reviews")).toBeVisible();
  await expect(page.getByRole("link")).toHaveCount(0);
  account = { id: "user-a", login: "alex" };
  offline = true;
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("Showing saved reviews");
  await expect(
    page.getByRole("link", { name: /after reconnecting/ }),
  ).toBeVisible();
});
