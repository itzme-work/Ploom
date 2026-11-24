import {afterEach,expect,it,vi} from 'vitest'
import {checkRelease} from '../src/releases'
import {UnsupportedVpnEngine} from '../../../packages/shared/src'
afterEach(()=>vi.unstubAllGlobals())
it('never opens a tunnel',async()=>{const engine=new UnsupportedVpnEngine();await expect(engine.prepare()).rejects.toThrow();expect(engine.getStatus()).toBe('unsupported')})
it('excludes prereleases on stable and compares numerically',async()=>{vi.stubGlobal('fetch',async()=>Response.json(['2.0.0-beta.1','1.10.0','1.9.0'].map(tag_name=>({tag_name,draft:false,prerelease:tag_name.includes('-'),body:''}))));expect((await checkRelease(false))?.version).toBe('1.10.0');expect((await checkRelease(true))?.version).toBe('2.0.0-beta.1')})
it('distinguishes HTTP errors from no update',async()=>{vi.stubGlobal('fetch',async()=>new Response(null,{status:503}));await expect(checkRelease(false)).rejects.toThrow('503')})
it('rejects malformed metadata',async()=>{vi.stubGlobal('fetch',async()=>Response.json([{}]));await expect(checkRelease(false)).rejects.toThrow()})
