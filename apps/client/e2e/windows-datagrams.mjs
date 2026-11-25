// Controlled Shadowsocks provider and DNS responder for the installed Windows client.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createSocket } from 'node:dgram'
import { once } from 'node:events'
import { createServer, createConnection } from 'node:net'
import { join, dirname } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { finished } from 'node:stream/promises'

export async function startShadowsocks(executable, host) {
  const reservation=createServer()
  reservation.listen(0,host)
  await once(reservation,'listening')
  const port=reservation.address().port
  await new Promise(resolve=>reservation.close(resolve))
  const password=randomBytes(24).toString('hex')
  const method='aes-256-gcm'
  const proc=spawn(join(dirname(executable),'engine','sing-box.exe'),['run','-c','stdin'],{stdio:['pipe','ignore','inherit']})
  proc.stdin.end(JSON.stringify({log:{disabled:true},inbounds:[{type:'shadowsocks',listen:host,listen_port:port,method,password}],outbounds:[{type:'direct'}]}))
  await finished(proc.stdin)
  for(let i=0;i<80;i++){
    if(proc.exitCode!==null) throw Error('Shadowsocks fixture exited')
    const ready=await new Promise(resolve=>{
      const socket=createConnection(port,host,()=>{socket.destroy();resolve(true)})
      socket.on('error',()=>resolve(false))
    })
    if(ready) return {uri:'ss://'+Buffer.from(method+':'+password).toString('base64url')+'@'+host+':'+port+'#Datagram-fixture',close:()=>proc.kill()}
    await delay(100)
  }
  proc.kill()
  throw Error('Shadowsocks fixture unavailable')
}

export async function checkDatagrams(port) {
  for(const ipv6 of [false,true]){
    const dns=createSocket(ipv6?'udp6':'udp4'),client=createSocket('udp4')
    const control=createConnection(port,'127.0.0.1')
    const timer=setTimeout(()=>control.destroy(Error('SOCKS control timeout')),10000)
    try {
      dns.bind(0,ipv6?'::1':'127.0.0.1')
      await once(dns,'listening')
      const stream=control[Symbol.asyncIterator]()
      let buffered=Buffer.alloc(0)
      async function read(size){
        while(buffered.length<size){
          const {value,done}=await stream.next()
          if(done) throw Error('Truncated SOCKS reply')
          buffered=Buffer.concat([buffered,value])
        }
        const head=buffered.subarray(0,size)
        buffered=buffered.subarray(size)
        return head
      }
      control.write(Buffer.from([5,1,0]))
      assert.deepEqual([...await read(2)],[5,0])
      control.write(Buffer.from([5,3,0,1,0,0,0,0,0,0]))
      const reply=await read(10)
      assert.deepEqual([...reply.subarray(0,4)],[5,0,0,1])
      const header=Buffer.alloc(ipv6?22:10)
      header[3]=ipv6?4:1
      if(ipv6)header[19]=1
      else header.set([127,0,0,1],4)
      header.writeUInt16BE(dns.address().port,header.length-2)
      const question=Buffer.from('076669787475726507696e76616c69640000010001','hex')
      const tx=randomBytes(2)
      const query=Buffer.concat([tx,Buffer.from('01000001000000000000','hex'),question])
      const answer=Buffer.concat([tx,Buffer.from('81800001000100000000','hex'),question,Buffer.from('c00c000100010000003c0004c0000201','hex')])
      const timeout=AbortSignal.timeout(8000)
      const atProvider=once(dns,'message',{signal:timeout})
      client.send(Buffer.concat([header,query]),reply.readUInt16BE(8),'127.0.0.1')
      const [received,peer]=await atProvider
      assert.deepEqual(received,query)
      const atClient=once(client,'message',{signal:timeout})
      dns.send(answer,peer.port,peer.address)
      const [result]=await atClient
      assert.deepEqual(result,Buffer.concat([header,answer]))
      console.log('Installed Windows client exchanged DNS datagrams over Shadowsocks with '+(ipv6?'IPv6':'IPv4')+' destination')
    } finally {
      clearTimeout(timer)
      control.destroy();dns.close();client.close()
    }
  }
}
