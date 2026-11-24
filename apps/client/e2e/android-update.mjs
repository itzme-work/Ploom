// Runs against the debug WebView on an API 35 emulator. Only the baseline is installed via adb.
import { chromium } from 'playwright'
import { expect } from '@playwright/test'
import {execFileSync} from 'node:child_process'
import {writeFileSync} from 'node:fs'
import {setTimeout as delay} from 'node:timers/promises'
const pkg='work.itzme.ploom'
const adb=(...args)=>execFileSync('adb',args,{encoding:'utf8'}).trim()
const shell=(...args)=>adb('shell',...args)
const mode=name=>writeFileSync(process.env.RUNNER_TEMP+'/case',name)
const launch=()=>shell('am','start','-W','-n',pkg+'/.MainActivity')
async function webview(){
 for(let i=0;i<45;i++){
  try{
   const pid=shell('pidof',pkg)
   adb('forward','tcp:19223','localabstract:webview_devtools_remote_'+pid)
   const browser=await chromium.connectOverCDP('http://127.0.0.1:19223',{timeout:2000})
   const page=browser.contexts()[0].pages()[0]
   await page.getByRole('button',{name:'Settings',exact:true}).click({timeout:5000})
   return page
  }catch{await delay(1000)}
 }
 throw Error('Ploom WebView not ready')
}
async function installer(action){
 for(let i=0;i<20;i++){
  shell('uiautomator','dump','/sdcard/installer.xml')
  const xml=shell('cat','/sdcard/installer.xml')
  for(const node of xml.match(/<node\b[^>]+>/g)??[]){
   if(!node.includes('package="com.google.android.packageinstaller"')&&!node.includes('package="com.android.packageinstaller"')&&!node.includes('package="com.android.permissioncontroller"'))continue
   if(!new RegExp('text="(?:'+action+')"','i').test(node))continue
   const m=node.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/)
   shell('input','tap',String((+m[1]+ +m[3])>>1),String((+m[2]+ +m[4])>>1))
   return
  }
  await delay(500)
 }
 throw Error('Installer action unavailable: '+action)
}
mode('good')
launch()
const page=await webview()
const desired={style:'ASCII',mode:'Dark',language:'English',accent:'Mint',scale:'115%',font:'Mono',effects:'Low',transparency:'Off',motion:'Off',sound:'On',volume:'50%',soundset:'Soft',channel:'Beta',automatic:'Off'}
for(const [name,value] of Object.entries(desired)) await page.getByRole('combobox',{name,exact:true}).selectOption(value)
await page.getByRole('button',{name:'Check for updates'}).click()
const update=page.getByRole('button',{name:'Update Ploom',exact:true})
for(const [name,error] of [['offline',/network|download/i],['corrupt',/damaged|signature|failed/i],['foreign',/signature/i],['downgrade',/version/i]]){
 mode(name)
 await update.click()
 await expect(update).toBeEnabled({timeout:60000})
 await expect(page.getByRole('status')).toContainText(error)
}
mode('good')
await update.click()
await installer('Cancel')
await update.click()
await installer('Update|Install')
await expect.poll(()=>shell('dumpsys','package',pkg),{timeout:60000}).toContain('versionName=0.1.3')
launch()
const upgraded=await webview()
for(const [name,value] of Object.entries(desired)) await expect(upgraded.getByRole('combobox',{name,exact:true})).toHaveValue(value)
console.log('Android system installer upgraded the app; all preferences survived.')
process.exit(0)
