import {expect} from '@playwright/test'
export async function libraryFixture(page,create){
 await page.getByRole('button',{name:'Subscriptions',exact:true}).click()
 await expect(page.getByRole('button',{name:'Unlock',exact:true})).toHaveCount(0,{timeout:15000})
 if(create){
  await page.getByLabel('Name',{exact:true}).fill('Native fixture')
  await page.getByLabel('Configurations',{exact:true}).fill('trojan://test-fixture@node.example.invalid:443#Native')
  await page.getByRole('button',{name:'Preview',exact:true}).click()
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
