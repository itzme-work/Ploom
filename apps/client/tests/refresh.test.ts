import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {parseSubscription} from '../src/subscriptions/parser'
import {empty,type Subscription,reconcile} from '../src/subscriptions/library'
const {request}=vi.hoisted(()=>({request:vi.fn()}))
vi.mock('@tauri-apps/api/core',()=>({invoke:request,isTauri:()=>false}))
vi.mock('../src/subscriptions/vault',()=>({load:async()=>({rev:0,data:empty()}),save:async()=>{}}))
import {change,refresh,unlock,useLibrary} from '../src/subscriptions/manager'
const previous='trojan://fixture@node.example.invalid:443#One'
let sub:Subscription
beforeEach(async()=>{
 vi.stubGlobal('Worker',class {
  onmessage?:(e:{data:ReturnType<typeof parseSubscription>})=>void
  postMessage(s:string){this.onmessage?.({data:parseSubscription(s)})}
  terminate(){}
 })
 request.mockReset()
 await unlock('temporary fixture password')
 sub={id:'fixture',name:'Fixture',url:'https://feed.example.invalid/token',traffic:'',site:'',updated:1,interval:0,enabled:true,entries:reconcile([],parseSubscription(previous).servers)}
 sub.entries[0].favorite=true;sub.entries[0].alias='My node'
 await change(d=>{d.subscriptions=[sub];d.selected=sub.entries[0].id})
})
afterEach(()=>vi.unstubAllGlobals())
it('commits new settings and metadata as one snapshot, retaining user edits',async()=>{
 request.mockResolvedValue({text:previous.replace('fixture@','rotated@')+'\nhttp://new.example.invalid:80',traffic:'total=12;expire=1',site:'',title:'Changed'})
 await refresh(sub)
 const lib=useLibrary.getState().data
 expect(lib.subscriptions[0].entries).toHaveLength(2)
 expect(lib.subscriptions[0].entries[0]).toMatchObject({favorite:true,alias:'My node',id:lib.selected})
 expect(lib.subscriptions[0].traffic).toBe('total=12;expire=1')
})
it('retains previous data after a network error or partial feed',async()=>{
 const before=structuredClone(useLibrary.getState().data)
 request.mockRejectedValueOnce(Error('network'))
 await expect(refresh(sub)).rejects.toThrow()
 request.mockResolvedValueOnce({text:previous+'\nbad row',traffic:'',site:'',title:''})
 await expect(refresh(sub)).rejects.toThrow()
 expect(useLibrary.getState().data).toEqual(before)
})
it('retains the snapshot and updates its check timestamp on HTTP 304',async()=>{
 sub.etag='"fixture"'
 request.mockResolvedValue({unchanged:true})
 await refresh(sub)
 expect(request).toHaveBeenCalledWith('subscription_fetch',{url:sub.url,etag:sub.etag,modified:undefined})
 const current=useLibrary.getState().data.subscriptions[0]
 expect(current.entries).toEqual(sub.entries)
 expect(current.updated).toBeGreaterThan(sub.updated)
})
it('preserves the last full profile when the provider changes format',async()=>{
 await change(d=>{d.subscriptions[0].profile={format:'sing-box JSON',source:'{"outbounds":[]}'}})
 const current=useLibrary.getState().data.subscriptions[0]
 request.mockResolvedValue({text:previous,traffic:'',site:'',title:''})
 await expect(refresh(current)).rejects.toThrow('profile format changed')
 expect(useLibrary.getState().data.subscriptions[0].profile).toEqual(current.profile)
})
