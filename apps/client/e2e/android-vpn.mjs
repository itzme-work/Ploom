// Installed Android 15 emulator APK. This fixture only accepts CONNECT to one synthetic destination.
import { _android as android, expect } from '@playwright/test'
import { createInterface } from "node:readline"
import { fileURLToPath } from "node:url"
import { execFile, execFileSync, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { startShadowsocks } from './windows-datagrams.mjs'
import { createSocket } from 'node:dgram'
import { promisify } from 'node:util'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
const run=promisify(execFile)
const pkg='work.itzme.ploom'
const shell=(...args)=>execFileSync('adb',['shell',...args],{encoding:'utf8',timeout:20000}).trim()
let nonce
const publicHttp=()=>shell("printf 'HEAD / HTTP/1.0\\r\\nHost: github.com\\r\\n\\r\\n' | toybox nc -w 8 github.com 80").split('\n')[0]
function currentNetworks(){
  const dump=shell('dumpsys','connectivity')
  const current=dump.match(/Current Networks:([\s\S]*?)(?:Status for known UIDs:|Network Requests:)/)
  if(!current) throw Error('Cannot read current Android network records')
  return current[1]
}
function tunnels(){
  return [...new Set(Array.from(currentNetworks().matchAll(/InterfaceName:\s*(tun\d+)\b/g),m=>m[1]))].sort()
}
let traversals=0
const provider=createServer(socket=>{
  socket.setTimeout(8000,()=>socket.destroy())
  let buffer='',connected=false
  socket.on('error',()=>{})
  socket.on('data',chunk=>{
    buffer+=chunk.toString('ascii')
    if(buffer.length>4096){socket.destroy();return}
    if(!connected && buffer.includes('\r\n\r\n')){
      if(!buffer.startsWith('CONNECT 192.0.2.90:18081 HTTP/1.1\r\n')){socket.destroy();return}
      buffer=buffer.slice(buffer.indexOf('\r\n\r\n')+4)
      socket.write('HTTP/1.1 200 OK\r\n\r\n')
      connected=true
    }
    if(connected && buffer.includes(nonce)){traversals++;socket.end('received-'+nonce+'\n')}
  })
})
await new Promise(resolve=>provider.listen(18483,'127.0.0.1',resolve))
const answers=[]
let shadowsocks
if(process.env.PLOOM_SS_TEST_CORE){
  const rules=[]
  for(const [family,ip,target] of [['udp4','127.0.0.1','192.0.2.53'],['udp6','::1','2001:db8::53']]){
    const server=createSocket(family)
    server.bind(0,ip)
    await once(server,'listening')
    answers.push({server,target})
    rules.push({ip_cidr:[target+(family==='udp4'?'/32':'/128')],port:[18053],action:'route',
      outbound:'target',override_address:ip,override_port:server.address().port})
  }
  shadowsocks=await startShadowsocks(process.env.PLOOM_SS_TEST_CORE,'127.0.0.1','10.0.2.2',rules)
}

async function exchangeDns({server,target}){
  const id=randomBytes(2).toString('hex')
  const question='076669787475726507696e76616c69640000010001'
  const query=id+'01000001000000000000'+question
  const answer=id+'81800001000100000000'+question+'c00c000100010000003c0004c0000201'
  const receiver=once(server,'message',{signal:AbortSignal.timeout(10000)}).then(([data,peer])=>{
    expect(data.toString('hex')).toBe(query)
    server.send(Buffer.from(answer,'hex'),peer.port,peer.address)
  })
  const family=target.includes(':')?'udp6':'udp4'
  const [reply]=await Promise.all([run('adb',['shell','/data/local/tmp/ploom-test-probe',family,'18053',query],{timeout:12000}),receiver])
  expect(reply.stdout.replace(/\s/g,'')).toBe(answer)
}
let device, reality, realityProcess
try {
  if(process.env.PLOOM_REALITY_TEST_CORE){
    const script=fileURLToPath(new URL('../../../scripts/engine-lab/reality-provider.py',import.meta.url))
    realityProcess=spawn('python3',[script,process.env.PLOOM_REALITY_TEST_CORE,'127.0.0.1','--emulator'],{stdio:['pipe','pipe','inherit']})
    const lines=createInterface({input:realityProcess.stdout})
    const first=await lines[Symbol.asyncIterator]().next()
    if(first.done)throw Error('REALITY provider did not start')
    reality=JSON.parse(first.value)
    lines.close()
  }
  shell('am','start','-W','-n',pkg+'/.MainActivity')
  if(process.env.PLOOM_EXPECT_ARM32){
    const pid=shell('pidof',pkg)
    if(!/^\d+$/.test(pid)) throw Error('Missing installed ARMv7 process')
    const maps=shell('run-as',pkg,'cat','/proc/'+pid+'/maps')
    if(!maps.includes('/app_process32')) throw Error('Expected live 32-bit Android process')
  }
  console.log('Activity started; attaching to debug WebView')
  ;[device]=await android.devices()
  device.setDefaultTimeout(20000)
  const page=await (await device.webView({pkg},{timeout:30000})).page()
  page.setDefaultTimeout(20000)
  console.log('WebView attached',await page.evaluate(()=>navigator.userAgent))
  const button=name=>({selector:'button',name})
  // Only use standard DOM APIs here. Playwright's injected selector engine
  // calls Element.checkVisibility even during locator.evaluate on Chrome 83.
  function inspect(control,operation){
    return page.evaluate(({control,operation})=>{
      const el=Array.from(document.querySelectorAll(control.selector)).find(node=>
        !control.name || node.getAttribute('aria-label')===control.name || node.textContent.trim()===control.name)
      if(!el) return null
      if(operation==='selected') return el.getAttribute('aria-pressed')
      el.scrollIntoView({block:'center'})
      const r=el.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2
      return !el.disabled && r.width && r.height && el.contains(document.elementFromPoint(x,y)) ? {x,y}:null
    },{control,operation})
  }
  async function tap(control){
    let point
    await expect.poll(async()=>Boolean(point=await inspect(control,'point')),{timeout:20000}).toBe(true)
    await page.mouse.click(point.x,point.y)
  }
  function hasText(pattern){
    return page.evaluate(source=>Array.from(document.querySelectorAll('body *')).some(el=>
      el.children.length===0 && new RegExp(source,'i').test(el.textContent.trim()) &&
      el.getBoundingClientRect().height>0 && getComputedStyle(el).visibility==='visible'),pattern.source)
  }
  async function visible(pattern){
    await expect.poll(()=>hasText(pattern),{timeout:20000}).toBe(true)
  }
  await tap(button('Subscriptions'))
  await tap({selector:'textarea[aria-label="Configurations"]'})
  await page.keyboard.insertText(reality?.uri ?? shadowsocks?.uri ?? 'http://10.0.2.2:18483#Android-fixture')
  await tap(button('Preview'))
  await tap(button('Import (1)'))
  await tap(button('Servers'))
  await tap(button('Select'))
  await expect.poll(()=>inspect(button('Select'),'selected')).toBe('true')
  await tap(button('Home'))
  await visible(reality?/fixture · vless/i:shadowsocks?/fixture · (ss|shadowsocks)/i:/fixture · http/i)
  console.log('Synthetic configuration imported and selected')
  const initialTunnels=tunnels()
  expect(publicHttp()).toMatch(/^HTTP\/1\.[01] [23]\d\d/)
  for(let session=1;session<=2;session++){
    nonce=randomBytes(24).toString('hex')
    await tap(button('Connect'))
    await tap(button('Confirm'))
    console.log('Endpoint consent accepted for session',session)
    for(let i=0;session===1 && i<20;i++){
      if(await hasText(/TUN open · connectivity unverified/)) break
      try { shell('uiautomator','dump','/sdcard/ploom-consent.xml') } catch { await delay(300); continue }
      const xml=shell('cat','/sdcard/ploom-consent.xml')
      const lanAllow=(xml.match(/<node\b[^>]+>/g)||[]).find(n=>n.includes('permissioncontroller') && n.includes(':id/permission_allow_button"'))
      if(lanAllow && Number(shell('getprop','ro.build.version.sdk'))>=37){
        const [,a,b,c,d]=lanAllow.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/)
        shell('input','tap',String((+a + +c)>>1),String((+b + +d)>>1))
        continue
      }
      const positive=(xml.match(/<node\b[^>]+>/g)||[]).find(n=>n.includes('com.android.vpndialogs')&&n.includes('android:id/button1'))
      if(positive){
        const [,a,b,c,d]=positive.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/)
        shell('input','tap',String((+a + +c)>>1),String((+b + +d)>>1))
        break
      }
      await delay(300)
    }
    await visible(/TUN open · connectivity unverified/)
    shell('input','keyevent','KEYCODE_HOME')
    // The server runs on this event loop, so the adb request must remain asynchronous.
    expect(tunnels().some(name=>!initialTunnels.includes(name))).toBe(true)
    if(reality){
      const {stdout}=await run('adb',['shell','/data/local/tmp/ploom-test-probe','http',String(reality.port),reality.token],{timeout:12000})
      expect(stdout.split(/\r?\n\r?\n/).at(-1)).toBe(reality.token)
      console.log('Installed Android VPN passed VLESS REALITY/Vision challenge.')
    }else if(shadowsocks){
      for(const fixture of answers) await exchangeDns(fixture)
      console.log('Android VpnService relayed verified IPv4 and IPv6 DNS datagrams over Shadowsocks.')
    }else{
      async function challenge(expectedVisits){
        nonce=randomBytes(24).toString('hex')
        const response=await new Promise((resolve,reject)=>execFile('adb',['shell',`printf '%s\\n' '${nonce}' | toybox nc -w 8 192.0.2.90 18081`],
          {timeout:12000},(error,stdout)=>error?reject(error):resolve(stdout.trim())))
        expect(response).toBe('received-'+nonce)
        expect(traversals).toBe(expectedVisits)
      }
      await challenge(traversals+1)
      if(session===2){
        // Reopen UI only to read the physical transport libbox selected. Each
        // challenge still traverses the OS TUN, independently of this status.
        shell('am','start','-W','-n',pkg+'/.MainActivity')
        const physical=()=>page.evaluate(async()=>(await window.__TAURI_INTERNALS__.invoke('tunnel_state')).network)
        await expect.poll(physical,{timeout:20000}).toBe('wifi')
        try{
          shell('svc','wifi','disable')
          await expect.poll(physical,{timeout:30000}).not.toBe('wifi')
          // Determine the available path independently of Ploom's report.
          if (/Transports:\s*CELLULAR\b/.test(currentNetworks())){
            await expect.poll(physical,{timeout:30000}).toBe('cellular')
            await challenge(traversals+1)
          }else{
            await expect.poll(physical).toBe('offline')
            console.log('Emulator has no cellular network; testing recovery from offline to Wi-Fi.')
          }
        }finally{
          shell('svc','wifi','enable')
        }
        await expect.poll(physical,{timeout:30000}).toBe('wifi')
        await challenge(traversals+1)
      }
      console.log('Background TCP challenge crossed the installed VpnService and controlled provider.')
    }
    shell('am','start','-W','-n',pkg+'/.MainActivity')
    await tap(button('Disconnect'))
    await visible(/^Disconnected$/)
    await expect.poll(tunnels,{timeout:20000}).toEqual(initialTunnels)
    await expect.poll(()=>shell('dumpsys','activity','services',pkg).split('\n').some(line=>line.includes('ServiceRecord{') && line.includes('PloomVpnService')),{timeout:20000}).toBe(false)
    expect(publicHttp()).toMatch(/^HTTP\/1\.[01] [23]\d\d/)
    console.log('Session',session,'closed: TUN and service removed; direct Internet request passed.')
  }
} catch(error){
  console.error('Installed scenario failed before cleanup:',error.name,error.message)
  throw error
} finally {
  if(device) await device.close()
  realityProcess?.stdin.end()
  provider.close()
  shadowsocks?.close()
  for(const {server} of answers)server.close()
}
