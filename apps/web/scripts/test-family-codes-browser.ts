import assert from "node:assert/strict";
import { chromium } from "playwright";
import { getDb, getPool, schema } from "../lib/db";
import { loginWithPin } from "../lib/auth";

async function main() {
  const base = process.env.E2E_BASE_URL!;
  const artifacts = process.env.E2E_ARTIFACTS!;
  assert.ok(base && artifacts);
  const database = new URL(process.env.DATABASE_URL ?? "");
  assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));
  assert.match(database.pathname, /^\/liendo_codes_web_test_\d+$/);
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
    const noah = (await getDb().select().from(schema.people)).find((person) => person.slug === "noah")!;
    const legacy = await loginWithPin(noah.id, "1234", { kind: "browser", label: "Before family-code setup" });
    await context.addCookies([{ name: "lp_session", value: legacy.token, url: base, httpOnly: true }]);
    const page = await context.newPage();
    const oldSnapshot = page.waitForResponse((response) => response.url().includes("/api/snapshot?") && response.ok());
    await page.goto(`${base}/family`);
    await page.getByRole("heading", { name: "Set up Liendo Plaza" }).waitFor();
    const prior = await (await oldSnapshot).json();
    assert.ok(prior.chores.length > 0 && prior.chores.every((chore: { personId: string }) => chore.personId === noah.id));
    await page.screenshot({ path: `${artifacts}/web-setup.png`, fullPage: true });
    await page.getByLabel("Parent code (6+ digits)", { exact: true }).fill("123456");
    await page.getByLabel("Enter parent code again").fill("123456");
    await page.getByLabel("Jess code (optional, 6+ digits)").fill("234567");
    await page.getByLabel("Noah code (optional)").fill("1234");
    await page.getByRole("button", { name: "Set up and sign in" }).click();
    await page.getByRole("link", { name: "Manage", exact: true }).waitFor();
    await page.getByTestId("chore-Make your bed").waitFor();
    await page.locator(".phone-who").filter({ hasText: "Focus" }).waitFor();
    assert.ok((await context.cookies()).some((cookie) => cookie.name === "lp_session" && cookie.httpOnly));
    assert.equal((await getDb().select().from(schema.familyCodes)).length, 4);
    console.log("PASS browser setup -> API -> hashed codes and HTTP-only session -> parent home");
    console.log("PASS setup replaces legacy kid identity and cached chores with the parent snapshot without reload");

    await page.goto(`${base}/family/pins`);
    await page.getByRole("heading", { name: "Family codes", exact: true }).waitFor();
    await page.getByLabel("New parent code (6+ digits)", { exact: true }).fill("654321");
    await page.getByLabel("Enter parent code again").fill("654321");
    await page.getByRole("button", { name: "Save code", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "Code saved." }).waitFor();
    await page.screenshot({ path: `${artifacts}/web-code-settings.png`, fullPage: true });
    console.log("PASS parent changes their own code through Family settings");

    const parentContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const parentPage = await parentContext.newPage();
    await parentPage.goto(`${base}/family`);
    await parentPage.getByLabel("Enter your code", { exact: true }).fill("9999");
    await parentPage.getByRole("button", { name: "Open", exact: true }).click();
    await parentPage.getByRole("alert").filter({ hasText: "That code is not recognized." }).waitFor();
    await parentPage.getByLabel("Enter your code", { exact: true }).fill("234567");
    await parentPage.getByRole("button", { name: "Open", exact: true }).click();
    await parentPage.getByRole("link", { name: "Manage", exact: true }).waitFor();
    await parentPage.locator(".phone-who").filter({ hasText: "Jess" }).waitFor();
    assert.ok((await parentContext.cookies()).some((cookie) => cookie.name === "lp_session"));
    console.log("PASS wrong code error and individual parent code -> direct parent session");
    await parentPage.goto(`${base}/family/pins`);
    await parentPage.getByLabel("Who", { exact: true }).selectOption({ label: "Focus" });
    await parentPage.getByLabel("New parent code (6+ digits)", { exact: true }).fill("765432");
    await parentPage.getByLabel("Enter parent code again").fill("765432");
    await parentPage.getByRole("button", { name: "Save code", exact: true }).click();
    await parentPage.getByRole("status").filter({ hasText: "Code saved." }).waitFor();
    console.log("PASS a signed-in parent resets the other parent's code");

    const kidContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const kidPage = await kidContext.newPage();
    await kidPage.goto(`${base}/family`);
    await kidPage.getByLabel("Enter your code", { exact: true }).fill("1234");
    await kidPage.getByRole("button", { name: "Open", exact: true }).click();
    await kidPage.getByRole("heading", { name: "Today", exact: true }).waitFor();
    await kidPage.locator(".phone-who").filter({ hasText: "Noah" }).waitFor();
    assert.equal(await kidPage.getByRole("link", { name: "Manage", exact: true }).count(), 0);
    assert.equal(await kidPage.getByRole("heading", { name: "Who are you?" }).count(), 0);
    await kidPage.screenshot({ path: `${artifacts}/web-kid-home.png`, fullPage: true });
    const denied = await kidContext.request.post(`${base}/api/auth/codes`, { data: { code: "111111", confirmation: "111111" } });
    assert.equal(denied.status(), 403);
    console.log("PASS kid code -> direct kid home; parent code-management API rejects kid session");
  } finally { await browser.close(); await getPool().end(); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
