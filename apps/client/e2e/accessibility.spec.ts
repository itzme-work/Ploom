import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

for (const style of ['Material', 'Liquid Glass', 'Fluent', 'ASCII']) {
  test(style + ' accessibility and reflow', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 })
    await page.goto('/')
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.getByRole('combobox', { name: 'style', exact: true }).selectOption(style)
    await page.getByRole('combobox', { name: 'scale', exact: true }).selectOption('130%')
    for (const mode of ['Dark', 'Light']) {
      await page.getByRole('combobox', { name: 'mode', exact: true }).selectOption(mode)
      for (const screen of ['Home', 'Subscriptions', 'Servers', 'Settings']) {
        await page.getByRole('navigation').getByRole('button', { name: screen, exact: true }).click()
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
        const audit = await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze()
        expect(audit.violations.map(v => [v.id, v.nodes.map(n => n.target)])).toEqual([])
      }
    }
  })
}
