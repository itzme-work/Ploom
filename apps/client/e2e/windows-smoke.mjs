// CI-only WebView2 diagnostics. Exercise the packaged executable without Vite.
import {chromium} from 'playwright'
import {expect} from '@playwright/test'
import {spawn} from 'node:child_process'
import {setTimeout as delay} from 'node:timers/promises'
const child=spawn('src-tauri/target/debug/ploom.exe',[],{env:{...process.env,
 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port=19222 --remote-debugging-address=127.0.0.1'}})
try {
 let browser
 for(let i=0;i<60&&!browser;i++){
  if(child.exitCode!==null)throw Error('Ploom exited: '+child.exitCode)
  try{browser=await chromium.connectOverCDP('http://127.0.0.1:19222',{timeout:1000})}catch{await delay(1000)}
 }
 if(!browser)throw Error('WebView2 did not become ready')
 const ctx=browser.contexts()[0]
 const page=ctx.pages()[0]??await ctx.waitForEvent('page',{timeout:15000})
 await expect(page.getByRole('heading',{name:'Home'})).toBeVisible({timeout:30000})
 await page.getByRole('button',{name:'Connect',exact:true}).click()
 await expect(page.getByText('Disconnected',{exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Settings'}).click()
 await expect(page.getByRole('button',{name:'Check for updates'})).toBeVisible()
 const invokeFailure = (command,args) => page.evaluate(async ([cmd,payload])=>{
   try { await window.__TAURI_INTERNALS__.invoke(cmd,payload); return "unexpected success" }
   catch(e) { return String(e) }
 },[command,args])
 expect(await invokeFailure('install_update',{channel:'Stable',expected:'0.1.1-test',progress:'__CHANNEL__:10'})).toContain('Release signing is not configured')
 expect(await invokeFailure('plugin:updater|check',{})).toMatch(/not allowed|denied/i)
 await browser.close()
}finally{child.kill()}
