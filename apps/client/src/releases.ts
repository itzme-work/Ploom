import semver from 'semver'
import appConfig from '../src-tauri/tauri.conf.json'
export const current=appConfig.version
export async function checkRelease(beta:boolean){
 const versions:{version:string;notes:string}[]=[]
 for(let page=1;page<=10;page++){
  const response=await fetch('https://api.github.com/repos/itzme-work/Ploom/releases?per_page=100&page='+page,{credentials:'omit',redirect:'error',signal:AbortSignal.timeout(15000)})
  if(!response.ok) throw Error('HTTP '+response.status)
  const rows:unknown=await response.json()
  if(!Array.isArray(rows)) throw Error('Invalid response')
  for(const row of rows){
   if(typeof row?.draft!=='boolean'||typeof row.prerelease!=='boolean'||typeof row.tag_name!=='string'||(row.body!==null&&typeof row.body!=='string')) throw Error('Invalid release')
   const version=semver.valid(row.tag_name)
   if(!version||row.draft||(!beta&&(row.prerelease||semver.prerelease(version))))continue
   versions.push({version,notes:row.body??''})
  }
  if(rows.length<100)return versions.sort((a,b)=>semver.rcompare(a.version,b.version))[0]??null
 }
 throw Error('Release limit')
}
