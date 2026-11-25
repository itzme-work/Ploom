// Run with Node 24+ from the repository root. Each size gets a fresh process.
import {execFileSync} from 'node:child_process'
import {parseSubscription} from '../apps/client/src/subscriptions/parser.ts'
import {reconcile} from '../apps/client/src/subscriptions/library.ts'
if (!process.argv[2]) {
 for(const n of [100,1000,10000]) process.stdout.write(execFileSync(process.execPath,[process.argv[1],String(n)]))
} else {
 const n=Number(process.argv[2]),input=Array.from({length:n},(_,i)=>'trojan://fixture@host'+i+'.example.invalid:443#Server'+i).join('\n')
 const before=process.memoryUsage().heapUsed,start=performance.now()
 const preview=parseSubscription(input),entries=reconcile([],preview.servers)
 if(entries.length!==n)throw Error('count')
 console.log(JSON.stringify({rows:n,ms:Number((performance.now()-start).toFixed(2)),heapDeltaMiB:Number(((process.memoryUsage().heapUsed-before)/1048576).toFixed(2)),processPeakRssMiB:Number((process.resourceUsage().maxRSS/1024).toFixed(2))}))
}
