// Exercise the installed NSIS package, its real child process and its job lifetime.
import { chromium } from 'playwright'
import { expect } from '@playwright/test'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomBytes } from 'node:crypto'
import { createServer, connect } from 'node:net'
import { networkInterfaces } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
const run=promisify(execFile)
const host=Object.values(networkInterfaces()).flat().find(n=>n.family==='IPv4' && !n.internal &&
  /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(n.address))?.address
if(!host) throw Error('Runner has no private interface for the fixture')
const token=randomBytes(24).toString('hex')
let visits=0
const provider=createServer(s=>{
  let buf='',accepted=false
  s.on('error',()=>{})
  s.setTimeout(5000,()=>s.destroy())
  s.on('data',c=>{
    buf+=c.toString('ascii')
    if(buf.length>8192){s.destroy();return}
    if(!accepted && buf.includes('\r\n\r\n')){
      if(!buf.startsWith('CONNECT 192.0.2.90:18081 HTTP/1.1\r\n')){s.destroy();return}
      accepted=true;buf=buf.slice(buf.indexOf('\r\n\r\n')+4);s.write('HTTP/1.1 200 OK\r\n\r\n')
    }
    if(accepted && buf.includes(token)){
      visits++
      s.end('HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Length: '+token.length+'\r\n\r\n'+token)
    }
  })
})
await new Promise(resolve=>provider.listen(0,host,resolve))
const system=process.argv[3]==="system"
const systemSettings=async()=>JSON.parse((await run("powershell.exe",["-NoProfile","-Command",
  "$v=Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'; ConvertTo-Json -Compress -InputObject @($v.ProxyEnable,$v.ProxyServer)"
])).stdout)
const baseline=system?await systemSettings():null
const exe=process.argv[2]
const app=spawn(exe,[],{env:{...process.env,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port=19222 --remote-debugging-address=127.0.0.1'}})
let browser
try {
  for(let i=0;i<60&&!browser;i++){
    if(app.exitCode!==null)throw Error('Installed application exited')
    try{browser=await chromium.connectOverCDP('http://127.0.0.1:19222',{timeout:1000})}catch{await delay(500)}
  }
  if(!browser)throw Error('Missing WebView2')
  const ctx=browser.contexts()[0],page=ctx.pages()[0]??await ctx.waitForEvent('page')
  await page.getByRole('button',{name:'Subscriptions',exact:true}).click()
  await page.getByLabel('Configurations',{exact:true}).fill('http://'+host+':'+provider.address().port+'#fixture')
  await page.getByRole('button',{name:'Preview',exact:true}).click()
  await page.getByRole('button',{name:'Import (1)',exact:true}).click()
  await page.getByRole('button',{name:'Servers',exact:true}).click()
  await page.getByRole('button',{name:'Select',exact:true}).click()
  await expect(page.getByRole('button',{name:'Select',exact:true})).toHaveAttribute('aria-pressed','true')
  await page.getByRole('button',{name:'Home',exact:true}).click()
  await expect(page.getByText(/fixture · http/i)).toBeVisible()
  if(system)await page.getByRole('combobox',{name:'Windows mode'}).selectOption('system')
  await page.getByRole('button',{name:'Connect',exact:true}).click()
  const confirm=page.getByRole('button',{name:'Confirm',exact:true})
  try {await expect(confirm).toBeVisible({timeout:10000})} catch(error){
    console.error('Synthetic profile, native state:',await page.evaluate(async()=>{
      try {return await window.__TAURI_INTERNALS__.invoke('proxy_state')}catch(e){return String(e)}
    }),'UI:',await page.locator('main').innerText());throw error
  }
  await confirm.click()
  const heading=page.getByRole('heading',{name:/Local proxy.*127\.0\.0\.1/})
  await expect(heading).toBeVisible()
  const port=Number((await heading.innerText()).split(':').at(-1))
  const {stdout}=await run('curl.exe',['--silent','--show-error','--fail','--socks5','127.0.0.1:'+port,
    '--noproxy','','--max-time','8','http://192.0.2.90:18081/'+token])
  expect(stdout).toBe(token);expect(visits).toBe(1)
  if(system){
    expect(await systemSettings()).toEqual([1,'127.0.0.1:'+port])
    const cmd="$r=(New-Object Net.WebClient).DownloadString('http://192.0.2.90:18081/"+token+"'); Write-Output $r"
    expect((await run('powershell.exe',['-NoProfile','-Command',cmd],{timeout:15000})).stdout.trim()).toBe(token)
    expect(visits).toBe(2)
  }
  app.kill()
  await expect.poll(()=>new Promise(resolve=>{
    const s=connect(port,'127.0.0.1',()=>{s.destroy();resolve(true)})
    s.on('error',()=>resolve(false))
  })).toBe(false)
  if(system)await expect.poll(systemSettings,{timeout:10000}).toEqual(baseline)
} finally {
  app.kill();provider.close()
  if(browser)await browser.close().catch(()=>{})
}
