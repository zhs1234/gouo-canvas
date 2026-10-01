// Explicit local acceptance supplier; no external AI or procurement.
import { createServer } from 'node:http'
import { readFileSync, writeFileSync } from 'node:fs'
import sharp from 'sharp'
const path='/fixture/provider-stats.json'
let stats={chat:0,image:0,anonymousRejected:0,slow:0,unavailable:0,ambiguous:0,requests:[]}
try{stats=JSON.parse(readFileSync(path,'utf8'))}catch{}
const save=()=>writeFileSync(path,JSON.stringify(stats))
const png=await sharp(Buffer.from('<svg width="640" height="480"><rect width="640" height="480" fill="#56738e"/><text x="40" y="200" fill="white" font-size="30">LOCAL ACCEPTANCE FIXTURE</text><text x="40" y="250" fill="white" font-size="22">No real AI / procurement cost 0</text></svg>')).png().toBuffer()
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))
createServer(async(req,res)=>{
  if(req.url==='/stats'&&req.method==='GET'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(stats))}
  if(req.headers.authorization!=='Bearer fixture-provider-zero-procurement-cost'){stats.anonymousRejected++;save();res.writeHead(401);return res.end('{"error":{"message":"Explicit local fixture requires synthetic credential"}}')}
  let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>2_000_000){res.writeHead(413);return res.end()}}
  let body;try{body=JSON.parse(raw)}catch{res.writeHead(400);return res.end()}
  const kind=req.url==='/v1/chat/completions'?'chat':req.url==='/v1/images/generations'?'image':null
  if(!kind){res.writeHead(404);return res.end()}
  stats[kind]++;const id='local-fixture-'+kind+'-'+stats[kind]
  const messages=body.messages??[],last=messages.findLastIndex(row=>row.role==='user'),prompt=JSON.stringify(messages[last]?.content??body.prompt??'')
  const roleTag=/T16-[ABCD]/.exec(prompt)?.[0]??'unmarked'
  const nativeRequestId=req.headers['x-request-id']
  const request={id,kind,roleTag,stream:body.stream===true,outcome:'started',...(typeof nativeRequestId==='string'&&/^[\w-]{1,64}$/.test(nativeRequestId)?{nativeRequestId}:{})};stats.requests.push(request);save()
  if(prompt.includes('本地验收503')){stats.unavailable++;request.outcome='503';save();res.writeHead(503,{'Content-Type':'application/json'});return res.end('{"error":{"message":"Explicit local acceptance fixture 503","type":"fixture_unavailable"}}')}
  if(prompt.includes('本地验收未知')){stats.ambiguous++;request.outcome='response-lost';save();return req.socket.destroy()}
  if(kind==='image'){request.outcome='completed';save();res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({created:1,data:[{b64_json:png.toString('base64'),revised_prompt:'LOCAL ACCEPTANCE FIXTURE; no real AI; cost zero'}]}))}
  const hasTool=messages.slice(last+1).some(row=>row.role==='tool'),wantsImage=prompt.includes('本地验收生图')
  const message=wantsImage&&!hasTool?{role:'assistant',content:'',tool_calls:[{id:'local-fixture-image-tool',type:'function',function:{name:'generate_image',arguments:JSON.stringify({prompt:roleTag+' LOCAL ACCEPTANCE FIXTURE image; cost zero'})}}]}:{role:'assistant',content:hasTool?'【本地验收替身】图片工具已完成；此图是合成验收素材，采购成本为0。':'【本地验收替身】这是一条明确的本地协议测试回复，没有调用真实AI供应商。'}
  const usage={prompt_tokens:100,completion_tokens:20,total_tokens:120}
  if(!body.stream){request.outcome='completed';save();res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({id,object:'chat.completion',created:1,model:'fixture-chat',choices:[{index:0,finish_reason:message.tool_calls?'tool_calls':'stop',message}],usage}))}
  res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'})
  const emit=(delta,finish=null)=>res.write('data: '+JSON.stringify({id,object:'chat.completion.chunk',created:1,model:'fixture-chat',choices:[{index:0,delta,finish_reason:finish}]})+'\n\n')
  let finished=false;res.on('close',()=>{if(!finished){request.outcome='connection-closed';save()}})
  emit({role:'assistant',content:''})
  if(message.tool_calls)emit({tool_calls:message.tool_calls.map((tool,index)=>({index,...tool}))})
  else if(prompt.includes('本地验收慢流')){
    stats.slow++;save()
    for(let i=0;i<40&&!res.destroyed;i++){emit({content:'【本地验收慢流 '+(i+1)+'】'});await pause(750)}
  }else emit({content:message.content})
  if(res.destroyed)return
  emit({},message.tool_calls?'tool_calls':'stop')
  res.write('data: '+JSON.stringify({id,object:'chat.completion.chunk',created:1,model:'fixture-chat',choices:[],usage})+'\n\n')
  res.write('data: [DONE]\n\n');finished=true;request.outcome='completed';save();res.end()
}).listen(19000,'0.0.0.0')
