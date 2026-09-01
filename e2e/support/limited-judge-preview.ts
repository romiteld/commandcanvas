import { expect, type Page } from "@playwright/test";

export async function enterLimitedJudgePreview(page: Page) {
  const continueButton = page.getByRole("button", {
    name: "Enter no-signup preview",
  });
  await expect(continueButton).toBeVisible();
  await continueButton.click();
  await expect(page.getByLabel("Spatial command surface")).toBeVisible({
    timeout: 30_000,
  });
}
