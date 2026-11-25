import {expect} from '@playwright/test'
export async function libraryFixture(page,create){
 await page.getByRole('button',{name:'Subscriptions',exact:true}).click()
 await expect(page.getByRole('button',{name:'Unlock',exact:true})).toHaveCount(0,{timeout:15000})
 if(create){
  await page.getByLabel('Name',{exact:true}).fill('Native fixture')
  await page.getByLabel('Configurations',{exact:true}).fill('trojan://test-fixture@node.example.invalid:443#Native')
  // Only this synthetic fixture is loaded in the isolated CI profile.
  page.on('pageerror', error => console.error('WebView error:', error.message.slice(0,240)))
  await page.evaluate(() => {
    window.__ploomDiagnostics = []
    document.addEventListener('securitypolicyviolation', event => {
      window.__ploomDiagnostics.push([event.effectiveDirective, event.blockedURI.split(':')[0]])
    })
  })
  await page.getByRole('button',{name:'Preview',exact:true}).click()
  try {
    await expect(page.getByText(/1 valid · 0 invalid/)).toBeVisible({timeout:20000})
  } catch (error) {
    console.error('Synthetic preview:', await page.locator('main').innerText())
    console.error('CSP directives:', await page.evaluate(() => window.__ploomDiagnostics))
    throw error
  }
  await page.getByRole('button',{name:'Import (1)',exact:true}).click()
 }
 await expect(page.getByRole('heading',{name:'Native fixture'})).toBeVisible()
 await page.getByRole('button',{name:'Servers',exact:true}).click()
 const selected=page.getByRole('button',{name:'Select',exact:true})
 if(create)await selected.click()
 await expect(selected).toHaveAttribute('aria-pressed','true')
 const persisted=await page.evaluate(()=>JSON.stringify(localStorage))
 expect(persisted).not.toContain('node.example.invalid')
 await page.getByRole('button',{name:'Settings',exact:true}).click()
}
