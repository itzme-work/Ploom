import {libraryFixture} from './native-library.mjs'
// Runs against the debug WebView on an API 35 emulator. Only the baseline is installed via adb.
import { _android as android } from 'playwright'
import { expect } from '@playwright/test'
import {execFileSync} from 'node:child_process'
import {writeFileSync} from 'node:fs'
import {setTimeout as delay} from 'node:timers/promises'
const pkg='work.itzme.ploom'
const adb=(...args)=>execFileSync('adb',args,{encoding:'utf8'}).trim()
const shell=(...args)=>adb('shell',...args)
const mode=name=>writeFileSync(process.env.RUNNER_TEMP+'/case',name)
const launch=()=>shell('am','start','-W','-n',pkg+'/.MainActivity')
async function webview(openSettings=true){
 const [device]=await android.devices()
 const view=await device.webView({pkg},{timeout:60000})
 const page=await view.page()
 if(openSettings) await page.getByRole('button',{name:'Settings',exact:true}).click()
 return page
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
if(Number(shell('getprop','ro.build.version.sdk'))<28){
 // Call the production updater command from the installed debug WebView. This
 // tests the old PackageManager and installer independently of Playwright's
 // accessibility selectors. API 35 additionally exercises the Settings UI.
 const page=await webview(false)
 const marker='legacy-updater-'+Date.now()
 await page.evaluate(value=>localStorage.setItem('ploom-test-marker',value),marker)
 const install=()=>page.evaluate(async()=>{
   const ipc=window.__TAURI_INTERNALS__
   const callback=ipc.transformCallback(()=>{})
   try{
     await ipc.invoke('install_update',{expected:'0.1.3',channel:'Beta',progress:'__CHANNEL__:'+callback})
     return 'installer opened'
   }catch(error){return String(error)}
   finally{ipc.unregisterCallback(callback)}
 })
 for(const [fixture,reason] of [['foreign',/signer rejected/i],['corrupt',/damaged|signature|apk|end of central directory/i],['downgrade',/version/i]]){
   mode(fixture)
   const result=await install()
   expect(result).not.toBe('installer opened')
   expect(result).toMatch(reason)
   expect(shell('dumpsys','package',pkg)).toContain('versionName=0.1.2')
 }
 mode('good')
 expect(await install()).toBe('installer opened')
 await installer('Update|Install')
 await expect.poll(()=>shell('dumpsys','package',pkg),{timeout:60000}).toContain('versionName=0.1.3')
 shell('am','force-stop',pkg)
 launch()
 const upgraded=await webview(false)
 expect(await upgraded.evaluate(()=>localStorage.getItem('ploom-test-marker'))).toBe(marker)
 console.log('Legacy APK update verified: foreign signer, corruption and downgrade rejected; confirmed in-place installation preserved local data.')
 process.exit(0)
}
const page=await webview()
await libraryFixture(page,true)
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
mode('slow')
await update.click()
await page.getByRole('button',{name:'Cancel download'}).click()
await expect(page.getByRole('status')).toContainText('Download canceled',{timeout:60000})
mode('good')
await update.click()
await installer('Cancel')
await update.click()
await installer('Update|Install')
await expect.poll(()=>shell('dumpsys','package',pkg),{timeout:60000}).toContain('versionName=0.1.3')
// PackageManager can expose the new version before the old WebView finishes exiting.
await expect.poll(()=>page.isClosed(),{timeout:60000}).toBe(true)
shell('am','force-stop',pkg)
let upgraded
await expect(async()=>{
 launch()
 upgraded=await webview()
 await expect(upgraded.getByText('Ploom 0.1.3 · Beta',{exact:true})).toBeVisible()
}).toPass({timeout:90000})
for(const [name,value] of Object.entries(desired)) await expect(upgraded.getByRole('combobox',{name,exact:true})).toHaveValue(value)
await libraryFixture(upgraded,false)
console.log('Android system installer upgraded the app; all preferences survived.')
process.exit(0)
