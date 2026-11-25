// Runs the installed verified engine on an isolated Windows runner. Only the test /32 is routed.
import {createServer} from 'node:net'
import {spawn,execFile} from 'node:child_process'
import {randomBytes} from 'node:crypto'
import {promisify} from 'node:util'
import {setTimeout as delay} from 'node:timers/promises'
import assert from 'node:assert/strict'
const run=promisify(execFile)
const challenge=randomBytes(24).toString('hex')
const target='192.0.2.200'
let passes=0
const provider=createServer(s=>{
  let pending='',tunnel=false
  s.setTimeout(5000,()=>s.destroy())
  s.on('error',()=>{})
  s.on('data',c=>{
    pending+=c.toString('ascii')
    if(pending.length>8192){s.destroy();return}
    if(!tunnel && pending.includes('\r\n\r\n')){
      if(!pending.startsWith('CONNECT '+target+':18881 HTTP/1.1\r\n')){s.destroy();return}
      tunnel=true;pending=pending.slice(pending.indexOf('\r\n\r\n')+4)
      s.write('HTTP/1.1 200 OK\r\n\r\n')
    }
    if(tunnel && pending.includes(challenge)){
      passes++;s.end('HTTP/1.1 200 OK\r\nContent-Length: '+challenge.length+'\r\nConnection: close\r\n\r\n'+challenge)
    }
  })
})
await new Promise(r=>provider.listen(0,'127.0.0.1',r))
const routes=async()=>Number((await run('powershell.exe',['-NoProfile','-Command',
  "@(Get-NetRoute -DestinationPrefix '192.0.2.200/32' -ErrorAction SilentlyContinue).Count; exit 0"])).stdout.trim())
let core
try{
  assert.equal(await routes(),0,'Fixture route already exists')
  core=spawn(process.argv[2],['run','-c','stdin'],{stdio:['pipe','ignore','inherit']})
  core.stdin.end(JSON.stringify({log:{level:'warn'},
    inbounds:[{type:'tun',tag:'vpn',interface_name:'PloomTest',address:['172.29.89.1/30'],
      auto_route:true,route_address:[target+'/32'],dns_mode:'disabled',stack:'gvisor'}],
    outbounds:[{type:'http',tag:'provider',server:'127.0.0.1',server_port:provider.address().port}],
    route:{auto_detect_interface:true,final:'provider'}}))
  for(let i=0;i<10 && !(await routes());i++){
    if(core.exitCode!==null)throw Error('TUN startup failed, exit '+core.exitCode)
    await delay(300)
  }
  assert.ok(await routes(),'TUN route missing')
  const {stdout}=await run('curl.exe',['--fail','--silent','--show-error','--noproxy','*','--max-time','10',
    'http://'+target+':18881/'+challenge])
  assert.equal(stdout,challenge);assert.equal(passes,1)
  core.kill()
  for(let i=0;i<10 && await routes();i++)await delay(250)
  assert.equal(await routes(),0,'Route survived engine termination')
}finally{core?.kill();provider.close()}
