/**
 * Universal SoloHost Feedback Hub server module.
 * IMPORTANT: token never leaves this server.
 */
'use strict';
const DEFAULTS={
  hubId:'SHFH-CANNOI-0905428801',
  baseUrl:'http://14.176.78.46:8090',
  ingestToken:''
};
function getKnowledgeConfig(opts={}){
  const hubId=String(opts.hubId||process.env.SHFH_HUB_ID||DEFAULTS.hubId).slice(0,128);
  const baseUrl=String(opts.baseUrl||process.env.SHFH_HUB_URL||DEFAULTS.baseUrl);
  const tokenConfigured=String(opts.ingestToken??process.env.SHFH_INGEST_TOKEN??'').length>0;
  let safeBaseUrl='(invalid Hub URL)';
  let https=false;
  try{
    const url=new URL(baseUrl);
    https=url.protocol==='https:';
    safeBaseUrl=(url.origin+url.pathname.replace(/\/$/,'')).slice(0,300);
  }catch{}
  return {
    hubId,
    baseUrl:safeBaseUrl,
    ingestEnabled:tokenConfigured&&https,
    ingestStatus:tokenConfigured
      ?(https?'HTTPS transport configured; Hub API acceptance is not verified':'disabled: HTTPS required')
      :'disabled: server deployment secret is not configured'
  };
}
function createFeedbackService(opts={}){
  const cfg={...DEFAULTS,...opts,ingestToken:String(opts.ingestToken ?? process.env.SHFH_INGEST_TOKEN ?? '')};
  const appId=opts.appId||process.env.SHFH_APP_ID||'app';
  const appName=opts.appName||process.env.SHFH_APP_NAME||'Application';
  const version=opts.version||process.env.SHFH_APP_VERSION||'1.0.0';
  const base=String(cfg.baseUrl).replace(/\/$/,'');
  const secureBase=(()=>{try{return new URL(base).protocol==='https:';}catch{return false;}})();
  async function request(method,path,body){
    const headers={'Accept':'application/json'};
    if(method!=='GET') headers['Content-Type']='application/json';
    if(path==='/api/feedback'){
      if(!cfg.ingestToken) throw new Error('Feedback Hub ingest token is not configured');
      if(!secureBase) throw new Error('Feedback Hub ingestion requires HTTPS');
      headers.Authorization='Bearer '+cfg.ingestToken;
    }
    const r=await fetch(base+path,{method,headers,body:body?JSON.stringify(body):undefined,redirect:path==='/api/feedback'?'error':'follow',signal:AbortSignal.timeout(12000)});
    const j=await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(j.error||`Feedback Hub HTTP ${r.status}`);
    return j;
  }
  function publicConfig(){return {enabled:!!cfg.ingestToken&&secureBase,hubId:cfg.hubId,appId,appName,version};}
  async function sync(anonymousId){
    const q=`?app_id=${encodeURIComponent(appId)}&version=${encodeURIComponent(version)}`;
    const nq=`?app_id=${encodeURIComponent(appId)}&anonymous_id=${encodeURIComponent(anonymousId||'')}`;
    const [policy,notices]=await Promise.all([
      request('GET','/api/client-policy'+q),
      request('GET','/api/notices'+nq)
    ]);
    return {ok:true,policy,notices:notices.items||[],donate:policy.donate||null};
  }
  async function send(payload){ return request('POST','/api/feedback',payload); }
  async function markRead(id){ return request('POST','/api/notices/'+encodeURIComponent(id)+'/read',{}); }
  return {publicConfig,sync,send,markRead,appId,appName,version};
}
function mountFeedbackRoutes(router,fb){
  router.get('/api/feedback/config',(_req,res)=>res.json(fb.publicConfig()));
  router.get('/api/feedback/sync',async(req,res)=>{
    try{res.json(await fb.sync(String(req.query.anonymous_id||'')));}
    catch(e){res.status(502).json({ok:false,error:'Feedback Hub unavailable'});}
  });
  router.post('/api/feedback',async(req,res)=>{
    try{
      const b=req.body||{};
      const types=new Set(['improvement','bug','question','praise']);
      const rating=Number(b.rating);
      const safe={
        event:'feedback',
        type:types.has(String(b.type))?String(b.type):'improvement',
        rating:Number.isInteger(rating)&&rating>=0&&rating<=5?rating:0,
        message:String(b.message||'').slice(0,2000),
        anonymous_id:String(b.anonymous_id||'').slice(0,128),
        locale:String(b.locale||'').slice(0,35),
        app_id:fb.appId,
        app_name:fb.appName,
        version:fb.version
      };
      res.json(await fb.send(safe));
    }catch(e){
      const reason=/not configured|requires HTTPS/.test(String(e.message))?e.message:'Feedback Hub unavailable';
      res.status(502).json({ok:false,error:reason});
    }
  });
  router.post('/api/feedback/read/:id',async(req,res)=>{
    try{res.json(await fb.markRead(req.params.id));}catch{res.status(502).json({ok:false});}
  });
}
module.exports={createFeedbackService,mountFeedbackRoutes,DEFAULTS,getKnowledgeConfig};
