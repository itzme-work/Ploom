// Installed Android 15 emulator APK. This fixture only accepts CONNECT to one synthetic destination.
import { _android as android, expect } from '@playwright/test'
import { execFile, execFileSync } from 'node:child_process'
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
function tunnels(){
  const dump=shell('dumpsys','connectivity')
  const current=dump.match(/Current Networks:([\s\S]*?)Status for known UIDs:/)
  if(!current) throw Error('Cannot read current Android network records')
  return [...new Set(Array.from(current[1].matchAll(/InterfaceName:\s*(tun\d+)\b/g),m=>m[1]))].sort()
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
  // Keep stdin open briefly so toybox can receive the UDP reply before EOF.
  const command=`(printf '%s' '${query}' | toybox xxd -r -p; sleep 2) | toybox nc -u -w 5 ${target} 18053 | toybox xxd -p`
  const [reply]=await Promise.all([run('adb',['shell',command],{timeout:10000}),receiver])
  expect(reply.stdout.replace(/\s/g,'')).toBe(answer)
}
let device
try {
  shell('am','start','-W','-n',pkg+'/.MainActivity')
  ;[device]=await android.devices()
  const page=await (await device.webView({pkg},{timeout:60000})).page()
  page.setDefaultTimeout(20000)
  await page.getByRole('button',{name:'Subscriptions',exact:true}).click()
  await page.getByLabel('Configurations',{exact:true}).fill(shadowsocks?.uri ?? 'http://10.0.2.2:18483#Android-fixture')
  await page.getByRole('button',{name:'Preview',exact:true}).click()
  await page.getByRole('button',{name:'Import (1)',exact:true}).click()
  await page.getByRole('button',{name:'Servers',exact:true}).click()
  await page.getByRole('button',{name:'Select',exact:true}).click()
  await expect(page.getByRole('button',{name:'Select',exact:true})).toHaveAttribute('aria-pressed','true')
  await page.getByRole('button',{name:'Home',exact:true}).click()
  await expect(page.getByText(shadowsocks?/fixture · (ss|shadowsocks)/i:/fixture · http/i)).toBeVisible()
  const initialTunnels=tunnels()
  expect(publicHttp()).toMatch(/^HTTP\/1\.[01] [23]\d\d/)
  for(let session=1;session<=2;session++){
    nonce=randomBytes(24).toString('hex')
    await page.getByRole('button',{name:'Connect',exact:true}).click()
    const confirm=page.getByRole('button',{name:'Confirm',exact:true})
    try {await expect(confirm).toBeVisible({timeout:10000})} catch(error){
      console.error('Synthetic profile, native state:',await page.evaluate(async()=>{
        try {return await window.__TAURI_INTERNALS__.invoke('tunnel_state')}catch(e){return String(e)}
      }),'UI:',await page.locator('main').innerText());throw error
    }
    await confirm.click()
    for(let i=0;session===1 && i<20;i++){
      shell('uiautomator','dump','/sdcard/ploom-consent.xml')
      const xml=shell('cat','/sdcard/ploom-consent.xml')
      const positive=(xml.match(/<node\b[^>]+>/g)||[]).find(n=>n.includes('com.android.vpndialogs')&&n.includes('android:id/button1'))
      if(positive){
        const [,a,b,c,d]=positive.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/)
        shell('input','tap',String((+a + +c)>>1),String((+b + +d)>>1))
        break
      }
      await delay(300)
    }
    await expect(page.getByText('TUN open · connectivity unverified')).toBeVisible({timeout:20000})
    shell('input','keyevent','KEYCODE_HOME')
    // The server runs on this event loop, so the adb request must remain asynchronous.
    expect(tunnels().some(name=>!initialTunnels.includes(name))).toBe(true)
    if(shadowsocks){
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
      if(session===1){
        // Reopen UI only to read the physical transport libbox selected. Each
        // challenge still traverses the OS TUN, independently of this status.
        shell('am','start','-W','-n',pkg+'/.MainActivity')
        const physical=()=>page.evaluate(async()=>(await window.__TAURI_INTERNALS__.invoke('tunnel_state')).network)
        await expect.poll(physical,{timeout:20000}).toBe('wifi')
        try{
          shell('svc','wifi','disable')
          await expect.poll(physical,{timeout:30000}).toBe('cellular')
          await challenge(traversals+1)
        }finally{
          shell('svc','wifi','enable')
        }
        await expect.poll(physical,{timeout:30000}).toBe('wifi')
        await challenge(traversals+1)
      }
      console.log('Background TCP challenge crossed the installed VpnService and controlled provider.')
    }
    shell('am','start','-W','-n',pkg+'/.MainActivity')
    await page.getByRole('button',{name:'Disconnect',exact:true}).click()
    await expect(page.getByText('Disconnected',{exact:true})).toBeVisible({timeout:20000})
    await expect.poll(tunnels,{timeout:20000}).toEqual(initialTunnels)
    await expect.poll(()=>shell('dumpsys','activity','services',pkg).split('\n').some(line=>line.includes('ServiceRecord{') && line.includes('PloomVpnService')),{timeout:20000}).toBe(false)
    expect(publicHttp()).toMatch(/^HTTP\/1\.[01] [23]\d\d/)
  }
} finally {
  if(device) await device.close()
  provider.close()
  shadowsocks?.close()
  for(const {server} of answers)server.close()
}
