// Isolated Windows runner. Only the synthetic destination is routed by the
// privileged process. The UI owns the provider configuration and its core.
import {spawn,execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {setTimeout as delay} from 'node:timers/promises'
import assert from 'node:assert/strict'
const run=promisify(execFile)
const target='192.0.2.90'
const prefix=target+'/32'
const routes=async()=>Number((await run('powershell.exe',['-NoProfile','-Command',
  `@(Get-NetRoute -DestinationPrefix '${prefix}' -ErrorAction SilentlyContinue).Count; exit 0`])).stdout.trim())

export async function checkTunPath(engine,localPort,challenge){
  assert.equal(await routes(),0,'Fixture route already exists')
  const core=spawn(engine,['run','-c','stdin'],{stdio:['pipe','ignore','inherit']})
  const exit=new Promise((resolve,reject)=>{core.once('exit',resolve);core.once('error',reject)})
  try{
    core.stdin.end(JSON.stringify({log:{level:'warn'},
      inbounds:[{type:'tun',tag:'vpn',interface_name:'PloomTest',address:['172.29.89.1/30'],
        auto_route:true,route_address:[prefix],dns_mode:'disabled',stack:'gvisor'}],
      outbounds:[{type:'socks',version:'5',tag:'ploom',server:'127.0.0.1',server_port:localPort}],
      route:{auto_detect_interface:true,final:'ploom'}}))
    for(let i=0;i<10 && !(await routes());i++){
      if(core.exitCode!==null)throw Error('TUN startup failed')
      await delay(300)
    }
    assert.ok(await routes(),'TUN route missing')
    const {stdout}=await run('curl.exe',['--fail','--silent','--show-error','--noproxy','*','--max-time','10',
      'http://'+target+':18081/'+challenge])
    assert.equal(stdout,challenge)
  }finally{
    core.kill()
    await exit
    for(let i=0;i<10 && await routes();i++)await delay(250)
    assert.equal(await routes(),0,'Route survived engine termination')
  }
}
