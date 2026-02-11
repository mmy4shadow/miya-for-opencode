import { test, expect } from "../fixtures"
import { openSidebar } from "../actions"

test("miya panel opens from sidebar", async ({ page, gotoSession }) => {
  await gotoSession()
  await openSidebar(page)

  await page.getByRole("button", { name: /miya|米娅/i }).click()
  await expect(page.locator('[data-component="miya-panel"]')).toBeVisible()
})

test("miya panel exposes core tabs", async ({ page, gotoSession }) => {
  await gotoSession()
  await openSidebar(page)

  await page.getByRole("button", { name: /miya|米娅/i }).click()
  await expect(page.locator('[data-component="miya-panel"]')).toBeVisible()
  await expect(page.getByRole("tab", { name: "Autopilot" })).toBeVisible()
  await expect(page.getByRole("tab", { name: "Self-Approval" })).toBeVisible()
  await expect(page.getByRole("tab", { name: "Runtime" })).toBeVisible()
  await expect(page.getByRole("tab", { name: "Jobs" })).toBeVisible()
  await expect(page.getByRole("tab", { name: "Skills" })).toBeVisible()
  await expect(page.getByRole("tab", { name: "Kill Switch" })).toBeVisible()
})

test("miya panel exposes runtime and kill switch controls", async ({ page, gotoSession }) => {
  await gotoSession()
  await openSidebar(page)

  await page.getByRole("button", { name: /miya|米娅/i }).click()
  await page.getByRole("tab", { name: "Runtime" }).click()
  await expect(page.getByText(/Nodes/i)).toBeVisible()
  await expect(page.getByRole("button", { name: "Test" }).first()).toBeVisible()

  await page.getByRole("tab", { name: "Kill Switch" }).click()
  await expect(page.getByRole("button", { name: "Activate" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Release" })).toBeVisible()
})
