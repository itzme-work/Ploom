import {it,expect} from 'vitest'
import {parseSubscription} from '../src/subscriptions/parser'
import {reconcile,usage,empty} from '../src/subscriptions/library'
import {seal,open} from '../src/subscriptions/crypto'
const id='00000000-0000-4000-8000-000000000001'
const host='origin.example.invalid'
const uri='vless://'+id+'@'+host+':443?type=ws&security=tls#Fixture'
const table=[
 ['vless',uri],['vmess','vmess://'+btoa(JSON.stringify({id,add:host,port:443,ps:'vm'}))],
 ['trojan','trojan://fixture@'+host+':443'],['ss','ss://'+btoa('aes-256-gcm:fixture')+'@'+host+':443'],
 ['ss','ss://'+btoa('aes-256-gcm:fixture@'+host+':443')],['socks5','socks5://'+host+':1080'],
 ['http','http://'+host+':8080'],['https','https://'+host],['hysteria2','hy2://fixture@'+host],
 ['tuic','tuic://'+id+':fixture@'+host+':443'],['wireguard','[Interface]\nPrivateKey = '+btoa('0'.repeat(32))+'\n[Peer]\nPublicKey = '+btoa('1'.repeat(32))+'\nEndpoint = '+host+':51820'],
 ['vless',JSON.stringify({outbounds:[{protocol:'vless',settings:{vnext:[{address:host,port:443,users:[{id}]}]}}]})],
 ['trojan',JSON.stringify({outbounds:[{type:'trojan',server:host,server_port:443,password:'fixture'}]})],
 ['ss','proxies:\n  - {name: ss, type: ss, server: '+host+', port: 443, cipher: aes-256-gcm, password: fixture}'],
 ['vless',btoa(uri)]
]
it.each(table)('recognizes %s endpoint', (protocol,input)=>{const p=parseSubscription(input);expect(p.invalid).toBe(0);expect(p.servers[0]).toMatchObject({protocol,host})})
it('counts bad rows and duplicates independently',()=>{const p=parseSubscription([uri,uri.replace('Fixture','Alias'),'vless://bad','no URI'].join('\n'));expect([p.servers.length,p.invalid,p.duplicates]).toEqual([1,2,1])})
it('rejects deep JSON, aliases and oversize input',()=>{
 for(const text of ['['.repeat(100)+'0'+']'.repeat(100),'proxies: [&one {name: a}, *one]','x'.repeat(4194305)])expect(()=>parseSubscription(text)).toThrow()
})
it('keeps edits, stable ids, hides and favorites when provider credentials change',()=>{
 const [entry]=parseSubscription(uri).servers
 const [old]=reconcile([],[entry]); old.favorite=true;old.alias='Mine';old.hidden=true
 const [next]=reconcile([old],[{...entry,raw:uri.replace(id,'00000000-0000-4000-8000-000000000002')}])
 expect(next).toMatchObject({id:old.id,alias:'Mine',hidden:true,favorite:true})
})
it('does not invent quota or expiry',()=>{expect(usage('').remaining).toBeUndefined();expect(usage('upload=20; download=10; total=100; expire=123')).toMatchObject({used:30,total:100,remaining:70,expire:123})})
it('roundtrips encrypted backups and rejects the wrong password or invalid format',async()=>{
 const box=await seal(empty(),'test fixture password')
 expect(JSON.stringify(box)).not.toContain('subscriptions');expect(await open(box,'test fixture password')).toEqual(empty())
 await expect(open(box,'wrong')).rejects.toThrow();await expect(open({...box,v:2} as never,'test fixture password')).rejects.toThrow()
})
it('does not transfer personal edits to another endpoint with the same display name',()=>{
 const [original]=parseSubscription(uri).servers
 const [old]=reconcile([],[original])
 old.note='private fixture';old.favorite=true
 const moved=parseSubscription(uri.replace(host,'other.example.invalid')).servers
 const [next]=reconcile([old],moved)
 expect(next.id).not.toBe(old.id)
 expect(next.note).toBeUndefined()
 expect(next.favorite).toBeUndefined()
 expect(reconcile([old],[original])[0].note).toBe(old.note)
})
