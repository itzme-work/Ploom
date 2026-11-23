import {expect,test} from '@playwright/test'
for(const width of [320,390,768,1024,1440])test('navigation and preferences at '+width,async({page})=>{
 await page.setViewportSize({width,height:800});await page.goto('/')
 await page.getByRole('button',{name:'Connect',exact:true}).click()
 await expect(page.getByText('VPN support is planned for a future release.')).toBeVisible()
 await page.getByRole('button',{name:'Subscriptions',exact:true}).first().click()
 await page.getByLabel('Subscription URL').fill('https://example.invalid/test')
 await page.getByRole('button',{name:'Servers',exact:true}).first().click()
 await expect(page.getByText('No servers yet')).toBeVisible()
 await page.getByRole('button',{name:'Settings'}).click()
 for(const style of ['Liquid Glass','Fluent','ASCII','Material']){
 await page.getByRole('combobox',{name:'style',exact:true}).selectOption(style)
 await expect(page.locator('main')).toHaveAttribute('data-style',style)}
 await page.getByRole('combobox',{name:'language',exact:true}).selectOption('Русский')
 await page.reload();await expect(page.getByRole('heading',{name:'Главная'})).toBeVisible()
})
