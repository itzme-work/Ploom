// Executed on a disposable Windows runner with the two signed NSIS bundles.
import { chromium } from 'playwright'
import { expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'

const [exe, version, baseVersion = '0.1.0'] = process.argv.slice(2)
const baseline = version === baseVersion
const prefs = {
 style:'ASCII', mode:'Dark', accent:'Amber', scale:'115%', font:'Mono',
 effects:'Low', transparency:'Off', motion:'Off', sound:'On', volume:'50%',
 soundset:'Soft', channel:'Beta', automatic:'Off', language:'English'
}
const child = spawn(exe, [], {env:{...process.env,
 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port=19222 --remote-debugging-address=127.0.0.1'}})
const exited = once(child,'exit')
try {
 let browser
 for (let i=0; i<60 && !browser; i++) {
  if (child.exitCode !== null) throw Error('Ploom exited before WebView2 was ready')
  try { browser = await chromium.connectOverCDP('http://127.0.0.1:19222',{timeout:1000}) }
  catch { await delay(1000) }
 }
 if (!browser) throw Error('WebView2 did not become ready')
 const ctx=browser.contexts()[0]
 const page=ctx.pages()[0] ?? await ctx.waitForEvent('page')
 await page.getByRole('button',{name:'Settings',exact:true}).click()
 await expect(page.getByText('Ploom '+version+' ·',{exact:false})).toBeVisible()
 for(const [name,value] of Object.entries(prefs)){
  const field=page.getByRole('combobox',{name,exact:true})
  if(baseline) await field.selectOption(value)
  await expect(field).toHaveValue(value)
 }
 if (!baseline) {
  // Offer only the older release to the installed 0.1.1 client.
  await page.route('https://api.github.com/**',route=>route.fulfill({json:[
   {tag_name:'v'+baseVersion,body:'baseline',draft:false,prerelease:false}
  ]}))
  await page.getByRole('button',{name:'Check for updates'}).click()
  await expect(page.getByRole('status')).toContainText('Ploom is up to date')
  await expect(page.getByRole('button',{name:'Update Ploom',exact:true})).toHaveCount(0)
 }
 await browser.close()
} finally {
 if (child.exitCode === null) child.kill()
 await exited
}
