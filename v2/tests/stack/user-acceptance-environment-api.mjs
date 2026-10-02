// Acceptance-only lost Native mutation response injection; not a product route.
import { readFileSync, writeFileSync } from 'node:fs'
import { createServer } from '../../apps/api/src/server.mjs'
import { loadConfig } from '../../apps/api/src/config.mjs'
const config=loadConfig(),path='/fixture/control.json'
const controlledFetch=async(url,init)=>{
  const parsed=new URL(url),method=init?.method??'GET'
  const renewalName=method==='POST'&&parsed.pathname==='/api/token/'?JSON.parse(init.body??'{}').name:undefined
  const kind=method==='PUT'&&parsed.pathname==='/api/subscription/self/preference'?'funding':typeof renewalName==='string'&&/^gouo-studio-[a-f0-9]{32}$/.test(renewalName)?'renewal':null
  if(kind){
    const control=JSON.parse(readFileSync(path,'utf8')),fault=control.fault
    if(fault?.kind===kind&&fault.remaining===1){
      const auth=new Headers(init.headers).get('authorization')
      const self=await fetch(new URL('/api/user/self',config.authOrigin),{headers:{Authorization:auth},redirect:'error',signal:AbortSignal.timeout(10000)}).then(response=>response.json())
      if(self.success===true&&self.data?.id===fault.owner&&self.data?.status===1){
        fault.remaining=0;control.events.push({kind,owner:fault.owner,method,path:parsed.pathname,stage:'native-intent',at:new Date().toISOString()});writeFileSync(path,JSON.stringify(control))
        const response=await fetch(url,init),body=await response.json().catch(()=>null)
        control.events.push({kind,owner:fault.owner,stage:'native-response-lost',status:response.status,nativeSuccess:body?.success===true,at:new Date().toISOString()});writeFileSync(path,JSON.stringify(control))
        throw new Error('Acceptance fixture intentionally lost one actual Native mutation response')
      }
    }
  }
  return fetch(url,init)
}
const server=createServer(config,{fetch:controlledFetch})
await server.listen({host:'0.0.0.0',port:3001})
