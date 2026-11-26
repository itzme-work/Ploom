import {create} from 'zustand'
import {persist} from 'zustand/middleware'
const choices={style:['Material','Liquid Glass','Fluent','ASCII'],mode:['System','Light','Dark'],language:['System','Русский','English'],accent:['Iris','Mint','Amber'],scale:['100%','115%','130%'],font:['System','Mono'],effects:['High','Low'],transparency:['On','Off'],motion:['On','Off'],sound:['Off','On'],volume:['25%','50%','100%'],soundset:['Soft'],channel:['Stable','Beta'],automatic:['Off','On'],minimizeToTray:['Off','On'],backgroundSubscriptions:['Off','On']} as const
export {choices}
type Preferences=Record<keyof typeof choices,string>
const defaults = {} as Preferences
for (const key of Object.keys(choices) as (keyof Preferences)[]) {
  defaults[key] = choices[key][0]
}
function clean(raw:unknown){const p={...defaults};for(const key of Object.keys(p) as (keyof Preferences)[]){const v=(raw as Partial<Preferences>|null)?.[key];if(v&&(choices[key] as readonly string[]).includes(v))p[key]=v}return p}
export const useSettings=create< {prefs:Preferences;set:(k:keyof Preferences,v:string)=>void} >()(persist(set=>({prefs:defaults,set:(k,v)=>set(s=>({prefs:clean({...s.prefs,[k]:v})}))}),{name:'ploom.preferences',version:1,partialize:s=>({prefs:s.prefs}),migrate:s=>({prefs:clean((s as {prefs?:unknown})?.prefs)}),merge:(s,c)=>({...c,prefs:clean((s as {prefs?:unknown})?.prefs)})}))
