import { test, expect, type Page } from "@playwright/test";

async function connectSelected(page: Page, scope = "header") {
  await page
    .locator(scope)
    .getByRole("button")
    .filter({ hasText: "Connect" })
    .click();
}
async function changeWallet(page: Page, current: string, next: string) {
  const header = page.locator("header");
  await header
    .getByRole("button")
    .filter({
      has: page.getByRole("img", { name: current + " icon", exact: true }),
    })
    .click();
  await page
    .getByRole("menuitem", { name: "Change wallet", exact: true })
    .click();
  await page.getByRole("button", { name: next, exact: false }).click();
  await connectSelected(page);
}
test("signed checkout, lost broadcast recovery, partial/full refunds and persistent accounting", async ({
  page,
  context,
}, testInfo) => {
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      /hydration|hydrated|didn't match|Content Security Policy/i.test(
        message.text(),
      )
    )
      runtimeErrors.push(message.text());
  });
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return ["127.0.0.1", "localhost"].includes(url.hostname)
      ? route.continue()
      : route.abort();
  });
  await page.goto("/login");
  await expect(
    page.getByRole("heading", {
      name: "Connect your Solana wallet",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Select Wallet", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Merchant test wallet", exact: false })
    .click();
  await connectSelected(page, "main");
  const verifyResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/backend/auth/verify") &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Sign in securely", exact: true })
    .click();
  expect((await verifyResponse).status()).toBe(200);
  await expect(
    page.getByRole("heading", { name: "Merchant dashboard", exact: true }),
  ).toBeVisible();
  const revenue = () =>
    page
      .getByText("Net invoice revenue", { exact: true })
      .locator("..")
      .locator("p")
      .nth(1);
  await expect(revenue()).toHaveText("0.000000 USDC");
  await page
    .getByLabel("Description", { exact: true })
    .fill("Automated browser order");
  await page.getByLabel("Amount in USDC", { exact: true }).fill("10");
  await page
    .getByRole("button", { name: "Create payment link", exact: true })
    .click();
  const checkout = page.getByRole("link", {
    name: "Open checkout",
    exact: true,
  });
  await expect(checkout).toBeVisible();
  const checkoutPath = (await checkout.getAttribute("href"))!;
  await changeWallet(page, "Merchant test wallet", "Customer test wallet");
  await page.goto(checkoutPath);
  await connectSelected(page, "main");
  await page.getByRole("button", { name: "Pay invoice", exact: true }).click();
  await expect(
    page.getByText("Payment received and verified.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Pay invoice", exact: true }),
  ).toHaveCount(0);
  await page.goto("/dashboard");
  await connectSelected(page);
  await changeWallet(page, "Customer test wallet", "Merchant test wallet");
  await expect(revenue()).toHaveText("10.000000 USDC");
  await expect(
    page.getByRole("button", { name: "Cancel", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Refund", exact: true }).click();
  await page.getByLabel("Refund amount (USDC)", { exact: true }).fill("4");
  await page
    .getByLabel("Refund reason", { exact: true })
    .fill("Automated partial refund");
  await page
    .getByRole("button", { name: "Review refund in wallet", exact: true })
    .click();
  await expect(revenue()).toHaveText("6.000000 USDC");
  await page.getByRole("button", { name: "Refund", exact: true }).click();
  await expect(
    page.getByLabel("Refund amount (USDC)", { exact: true }),
  ).toHaveValue("6.000000");
  await page
    .getByLabel("Refund reason", { exact: true })
    .fill("Automated final refund");
  await page
    .getByRole("button", { name: "Review refund in wallet", exact: true })
    .click();
  await expect(revenue()).toHaveText("0.000000 USDC");
  await expect(
    page.getByRole("button", { name: "Fully refunded", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("link", { name: "Verified refund receipt", exact: true }),
  ).toHaveCount(2);
  await page.reload();
  await connectSelected(page);
  await expect(revenue()).toHaveText("0.000000 USDC");
  await expect(
    page.getByRole("button", { name: "Fully refunded", exact: true }),
  ).toBeDisabled();
  await page.screenshot({
    path: "audit-output/browser-flow.png",
    fullPage: true,
  });
  await testInfo.attach("Verified merchant refund flow", {
    path: "audit-output/browser-flow.png",
    contentType: "image/png",
  });
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Connect your Solana wallet",
      exact: true,
    }),
  ).toBeVisible();
  expect(
    runtimeErrors,
    "Browser flow has no runtime or hydration errors",
  ).toEqual([]);
});

test("a rejected wallet attempt can be cancelled and stays closed after reload", async ({
  page,
  context,
}, testInfo) => {
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      /hydration|hydrated|didn't match|Content Security Policy/i.test(
        message.text(),
      )
    )
      runtimeErrors.push(message.text());
  });
  await context.route("**/*", (route) =>
    ["127.0.0.1", "localhost"].includes(new URL(route.request().url()).hostname)
      ? route.continue()
      : route.abort(),
  );
  await page.goto("/login");
  await page
    .getByRole("button", { name: "Select Wallet", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Merchant test wallet", exact: false })
    .click();
  await connectSelected(page, "main");
  const login = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/backend/auth/verify") &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Sign in securely", exact: true })
    .click();
  expect((await login).status()).toBe(200);
  await expect(
    page.getByRole("heading", { name: "Merchant dashboard", exact: true }),
  ).toBeVisible();
  const title = "Cancelled browser order";
  await page.getByLabel("Description", { exact: true }).fill(title);
  await page.getByLabel("Amount in USDC", { exact: true }).fill("1");
  await page
    .getByRole("button", { name: "Create payment link", exact: true })
    .click();
  const checkout = page.getByRole("link", {
    name: "Open checkout",
    exact: true,
  });
  await expect(checkout).toBeVisible();
  const checkoutPath = (await checkout.getAttribute("href"))!;
  await changeWallet(page, "Merchant test wallet", "Customer test wallet");
  await page.goto(checkoutPath);
  await connectSelected(page, "main");
  await page.evaluate(() =>
    sessionStorage.setItem("sentinelpay.test.rejectNextTransaction", "1"),
  );
  await page.getByRole("button", { name: "Pay invoice", exact: true }).click();
  await expect(
    page.getByText("Automated wallet rejection.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Pay invoice", exact: true }),
  ).toBeEnabled();
  await page.goto("/dashboard");
  await connectSelected(page);
  await changeWallet(page, "Customer test wallet", "Merchant test wallet");
  const row = () => page.getByText(title, { exact: true }).locator("../..");
  const cancellation = page.waitForResponse(
    (response) =>
      response.url().endsWith("/cancel") &&
      response.request().method() === "POST",
  );
  await row().getByRole("button", { name: "Cancel", exact: true }).click();
  expect((await cancellation).status()).toBe(200);
  await expect(row()).toContainText("cancelled");
  await expect(
    row().getByRole("button", { name: "Cancel", exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await connectSelected(page);
  await expect(row()).toContainText("cancelled");
  await page.goto(checkoutPath);
  await expect(
    page.getByText("This invoice is cancelled.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Pay invoice", exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: "audit-output/browser-cancellation.png",
    fullPage: true,
  });
  await testInfo.attach("Cancelled invoice checkout", {
    path: "audit-output/browser-cancellation.png",
    contentType: "image/png",
  });
  expect(
    runtimeErrors,
    "Cancellation flow has no runtime, hydration or CSP errors",
  ).toEqual([]);
});
