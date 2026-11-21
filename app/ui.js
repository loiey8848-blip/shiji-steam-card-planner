'use strict';
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const note=s=>$('progress').textContent=s;
const S={account:null,catalog:[],meta:new Map(),games:new Map(),bids:{},currency:null,session:false,
  busy:false,stop:false,attempted:new Set(),errors:new Map(),plans:{},mode:'ask',game:null,gameMode:'ask',n:1,batch:[],runAt:0};
const currencies={1:'USD',2:'GBP',3:'EUR',4:'CHF',9:'NOK',11:'MYR',12:'PHP',13:'SGD',14:'THB',18:'UAH',19:'MXN',20:'CAD',21:'AUD',22:'NZD',23:'CNY',24:'INR',26:'PEN',28:'ZAR',29:'HKD',30:'TWD',31:'SAR',32:'AED',35:'ILS'};
const money=n=>n==null?'—':n===0&&!S.currency?'0':new Intl.NumberFormat('zh-CN',{style:'currency',currency:currencies[S.currency]||'USD',currencyDisplay:S.currency===23?'narrowSymbol':'code'}).format(n/100);
const need=()=>S.account?Math.max(0,Math.ceil((Engine.threshold(+$('target').value)-S.account.xp)/100)):0;
const open=url=>SteamData.native('open',{url});
const now=()=>new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const setHTML=(id,html)=>{$(id).innerHTML=html;};
let directory, directoryChanged=false, quoteCache=new Map(), namesCache=new Map();
function targetValid(){const t=+$('target').value;return Number.isInteger(t)&&t>S.account?.level&&t<=9999;}
function access(e){return /429|Too Many Requests/.test(String(e))?'Steam 限制了请求频率，请稍后再试。':String(e.message||e);}
async function purchaseRead(label,read){
  try{return await read();}
  catch(error){
    const status=error.message.match(/HTTP 50[0234]\b/)?.[0];
    if(!status)throw error;
    throw Error(label+'失败，Steam 返回 '+status+'。购买清单未生成，也未提交订单。可稍后重试。');
  }
}
function clearCart(){S.batch=[];S.opened=new Set();S.retry=null;$('checkout').hidden=true;$('checkout').replaceChildren();$('resumeBatch').hidden=!S.account||!!currentProgress||!localStorage.getItem('lastBatch:'+S.account.id);}
function disable(b) {
  S.busy=b; for(const id of ['sync','scan','lookup','query','profile','target','scope','more'])$(id).disabled=b;
  $('cart').disabled=b||!S.plans[S.mode]?.picks?.length||S.plans[S.mode]?.count!==need();
  document.querySelectorAll('[data-busy]').forEach(el=>el.disabled=b);
  $('inventoryQuery').disabled=b;
  if(!$('inventory').hidden)renderInventory();
}
async function job(fn,button=null,message='正在处理…'){
  if(S.busy)return;
  disable(true);S.stop=false;
  if(message){
    note(message);
    $('progress').setAttribute('data-loading','');
    button?.setAttribute('data-loading','');
    button?.setAttribute('aria-busy','true');
  }
  try{await fn();}
  catch(e){note(access(e));$('progress').scrollIntoView({block:'nearest'});}
  finally{
    $('progress').removeAttribute('data-loading');
    button?.removeAttribute('data-loading');
    button?.removeAttribute('aria-busy');
    if(message&&$('progress').textContent===message)note('');
    disable(false);
    $('stop').hidden=true;
    if(S.returnPending)handleSteamReturn();
  }
}
function handleSteamReturn(){
  if(S.busy){S.returnPending=true;return;}
  S.returnPending=false;
  if(currentProgress&&currentProgress.account===S.account?.id)job(()=>continuePlan(true),$('continuePlan'),'正在核对购买进度…');
  else if(S.account&&localStorage.getItem('lastBatch:'+S.account.id))job(()=>resumeBatch(true),$('resumeBatch'),'正在核对上一批购买进度…');
}
window.addEventListener('returnedFromOrder',handleSteamReturn);
window.addEventListener('nextBuyOrder',({detail})=>job(()=>continueBuyQueue(detail),document.querySelector('[data-buy-queue]'),'正在复核下一种卡…'));
function accountStatus(){
  const a=S.account;
  $('persona').textContent=a.name||a.id;$('lv').textContent=a.level;$('xp').textContent=a.xp.toLocaleString();
  $('gap').textContent=(Engine.threshold(a.level+1)-a.xp).toLocaleString()+' XP';
  $('owned').textContent=Object.values(a.owned).reduce((x,y)=>x+y,0)+' 张';
  $('xpbar').style.width=(100*(a.xp-Engine.threshold(a.level))/(Engine.threshold(a.level+1)-Engine.threshold(a.level)))+'%';
  $('accountNote').textContent=(S.session?'已登录 · 使用钱包币种报价':'公开账号 · 登录可读取本人钱包价')+'\n同步于 '+new Date(a.synced).toLocaleTimeString('zh-CN');
}
async function sync(){
  clearCart();S.account=null;S.game=null;S.games.clear();S.currency=null;S.attempted.clear();S.errors.clear();S.plans={};S.runAt=0;
  $('resumeBatch').hidden=true;currentProgress=null;$('savedPlan').hidden=true;
  $('planningTools').open=true;
  quoteCache.clear();namesCache.clear(); $('result').className='results empty';$('result').textContent='正在同步账号…';
  for(const id of ['lv','xp','gap','owned','askCost','bidCost'])$(id).textContent='—';
  $('persona').textContent='我的 Steam 等级';$('xpbar').style.width='0';$('accountNote').textContent='正在同步';$('details').textContent='请选择游戏';$('coverage').textContent='';errorsView();
  try{
    const id=$('profile').value.trim();let sessionId='';
    try{sessionId=await SteamData.sessionId();}catch{}
    const a=await SteamData.account(id,!!sessionId,note);
    S.account=a; S.session=sessionId===a.id;a.pending=S.session?await SteamData.allPending().catch(()=>null):null;
    SteamData.native('clearOrder').catch(()=>{});$('profile').value=a.id; localStorage.setItem('profile',a.id);
    $('target').min=a.level+1;$('target').value=a.level+1;S.bids={};accountStatus();
    registerOwned(); render();await restorePurchasePlans();
    if(currentProgress&&!(currentProgress.target&&a.level>=currentProgress.target)&&currentProgress.games.some(g=>gameBalance(g,a).remaining))$('planningTools').open=false;
    note(currentProgress?'已同步库存和徽章 · '+now():'账号已同步。选择目标后点击「寻找升级方案」。');
  }catch(e){$('accountNote').textContent='账号同步未完成';$('result').textContent='完整读取徽章和库存后可开始配卡。';throw e;}
}
function registerOwned(){
  for(const [gid,items] of Object.entries(S.account.byGame)){
    const g=S.meta.get(+gid);
    if(g&&!S.games.has(g.id)&&Object.keys(items).length===g.size&&(S.account.levels[gid]||0)<5)
      S.games.set(g.id,{...g,cards:Object.entries(items).map(([hash,name])=>({hash,name,asks:[],bid:0})),priced:false});
  }
}
function candidates(){
  const a=S.account, eligible=S.catalog.filter(g=>(a.levels[g.id]||0)<5);
  const rank=(g)=>Object.keys(a.byGame[g.id]||{}).length/g.size;
  // Mix inventory-heavy games with the cheapest full sets so either source can win.
  const mine=eligible.filter(g=>rank(g)>0).sort((a,b)=>rank(b)-rank(a)||a.guide-b.guide);
  const market=eligible.slice().sort((a,b)=>Number(b.stock)-Number(a.stock)||a.guide-b.guide||a.id-b.id);
  const seen=new Set(), out=[];
  for(let i=0;i<Math.max(mine.length,market.length);i++)for(const g of [mine[i],market[i]])if(g&&!seen.has(g.id)){seen.add(g.id);out.push(g);}
  return out;
}
function setCurrency(code) {
  if(S.session&&SteamData.wallet()&&SteamData.wallet()!==code)throw Error('订单簿币种与 Steam 钱包不一致，请重新登录并同步。');
  if(!currencies[code])throw Error('当前钱包币种尚不支持（Steam 编号 '+code+'）。');
  if(S.currency&&S.currency!==code)throw Error('Steam 返回的币种已改变，请重新同步账号再核价。');
  if(!S.currency){S.currency=code;try{S.bids=JSON.parse(localStorage.getItem('bids:'+S.account.id+':'+code)||'{}');}catch{S.bids={};}}
}
async function loadGame(g,fresh=false,nextSetOnly=false) {
  let names=namesCache.get(g.id);
  if(!names){names=await SteamData.cardNames(g,S.account,S.session);namesCache.set(g.id,names);}
  const game={...g,cards:names.map(n=>({...n,asks:[],bid:0})),priced:false};
  for(const c of game.cards){
    if(S.stop)throw Error('已停止核价');
    if(nextSetOnly&&(S.account.owned[c.hash]>0||S.account.pending?.[c.hash]>0))continue;
    let q=quoteCache.get(c.hash);
    if(fresh||!q||Date.now()-q.time>300000){
      q={...await SteamData.book(c.hash,S.session),time:Date.now()};quoteCache.set(c.hash,q);
      await wait(160);
    }
    setCurrency(q.currency);Object.assign(c,q);
  }
  if(nextSetOnly)return game;
  game.priced=true;S.games.set(g.id,game);S.errors.delete(g.id);return game;
}
function errorsView(){
  $('exceptions').hidden=!S.errors.size;
  $('errors').textContent=[...S.errors.values()].join('　/　');
}
async function scan(more=false){
  if(!S.account)throw Error('请先同步 Steam 账号。');
  if(!targetValid())throw Error('目标等级应高于当前等级，且不超过 9999。');
  clearCart();await loadDirectory();
  const all=candidates(), limit=+$('scope').value||all.length;
  if(!more){S.attempted.clear();S.errors.clear();S.games.clear();registerOwned();}
  let batch=all.filter(g=>!S.attempted.has(g.id)).slice(0,limit);
  $('stop').hidden=false;S.runAt=Date.now();
  let done=0,lastPaint=0;
  for(const g of batch){
    if(S.stop)break;
    note('正在核价 '+(done+1)+' / '+batch.length+'　'+g.name+'；可随时停止并查看已完成的方案。');
    try{await loadGame(g);S.attempted.add(g.id);}
    catch(e){S.errors.set(g.id,g.name+' · '+access(e));if(/429|币种|已停止|超时|timed out|网络|连接|host is known|SSL|HTTP 50[0234]/i.test(e.message)){S.stop=true;}else S.attempted.add(g.id);}
    done++;if(done<=12||Date.now()-lastPaint>8000||S.stop){render();lastPaint=Date.now();}
    if(S.stop)break;
  }
  render();$('more').hidden=S.attempted.size>=all.length;
  note((S.stop?'本轮核价已停止。':'本轮核价完成。')+' 方案覆盖已核价的普通游戏；扩大搜索可继续比较。'+(S.errors.size?' 未报价原因见下方。':''));
}
function getBids(){return S.bids;}
function cartRows(plan){return plan.picks.flatMap(p=>p.rows.filter(r=>r.qty).map(r=>({...r,game:p.name,gid:p.id})));}
async function checkedPending(hash,id,snapshot){
  let count;
  try{count=await SteamData.pending(hash,id);}
  catch(e){if(!(snapshot?.[hash]>0)||/登录/.test(e.message))throw e;count=snapshot[hash];}
  count=Math.max(count,snapshot?.[hash]||0);
  if(!Number.isSafeInteger(count)||count<0)throw Error('在途求购数量未能核实，请稍后重试。');
  return count;
}
function rowsHTML(rows,mode,edit=true){
  return '<div class="wrap"><table class="gridtable"><thead><tr><th>卡牌</th><th>已有</th><th>需买</th><th>'+(mode==='bid'?'单张求购上限':'最高一档单价')+'</th><th>小计</th></tr></thead><tbody>'+
    rows.map(r=>'<tr><td><button class="textbtn" data-listing="'+esc(r.hash)+'">'+esc(r.name)+' ↗</button>'+(S.account?.pending?.[r.hash]?' <small>已挂 '+S.account.pending[r.hash]+' 张</small>':'')+'</td><td>'+r.have+'</td><td>'+r.qty+'</td><td>'+(mode==='bid'&&edit&&r.qty?'<input data-busy type="number" step=".01" min=".01" aria-label="单张求购上限" placeholder="输入限价" data-bid="'+esc(r.hash)+'" value="'+(r.cap?(r.cap/100).toFixed(2):'')+'">':r.qty?money(r.cap):'—')+'</td><td>'+money(r.cost)+'</td></tr>').join('')+'</tbody></table></div>';
}
function gameHTML(p,mode){
  return '<details class="game"><summary><span><span class="tag">'+p.n+' 套</span>　<h3>'+esc(p.name)+'</h3>　<small>徽章 '+(S.account.levels[p.id]||0)+' → '+((S.account.levels[p.id]||0)+p.n)+' 级</small></span><b>'+money(p.cost)+'　⌄</b></summary>'+rowsHTML(p.rows,mode)+'<button class="textbtn" data-badge="'+p.id+'">打开 Steam 徽章页 ↗</button></details>';
}
function render(bids=S.bids){
  if(!S.account)return;
  const target=+$('target').value, valid=targetValid(), needed=valid?need():0;clearCart();
  $('goal').textContent=valid?'还差 '+(Engine.threshold(target)-S.account.xp).toLocaleString()+' XP，需 '+needed+' 套':'请设定更高的目标等级';
  for(const mode of ['ask','bid']){
    const p=Engine.plan(S.games.values(),needed,mode,S.account,bids);S.plans[mode]=p;
    $(mode+'Cost').textContent=!p.count?'—':money(p.cost);
    const waiting=p.picks.some(g=>g.rows.some(r=>r.pending&&r.missing));
    $(mode+'Meta').textContent=p.count?(p.count===needed?'共 '+p.count+' 套':'已覆盖 '+p.count+' / '+needed+' 套')+' · 新购均价 '+money(p.cost/p.count)+'/套 · '+p.free+' 套无需新购'+(waiting?' · 含待到账卡':mode==='bid'?' · 待成交':''):(mode==='ask'?'按实际在售数量计价':'按每张卡的求购上限估算');
    $('choose-'+mode).classList.toggle('selected',S.mode===mode);
    $('choose-'+mode).setAttribute('aria-pressed',String(S.mode===mode));
  }
  const p=S.plans[S.mode],complete=p.count===needed&&needed>0, full=[...S.games.values()].filter(g=>g.priced);
  const ask=S.plans.ask,bid=S.plans.bid;
  $('comparison').textContent=needed&&ask.count===needed&&bid.count===needed?
    (ask.cost>=bid.cost?'按当前求购上限全部成交，预计比现在买齐少付 '+money(ask.cost-bid.cost)+'。':'当前买齐报价比求购上限低 '+money(bid.cost-ask.cost)+'。'):'';
  $('coverage').textContent='已完整核价 '+full.length+' 款 · 普通徽章目录 '+S.catalog.length.toLocaleString()+' 款'+(S.runAt?' · 本轮开始于 '+new Date(S.runAt).toLocaleTimeString('zh-CN'):'')+(S.currency?' · '+currencies[S.currency]:'')+
    (p.count&&!complete?' · 当前组合还差 '+(needed-p.count)+' 套':'');
  $('result').className=p.count?'results':'results empty';
  setHTML('result',p.count?p.picks.map(x=>gameHTML(x,S.mode)).join(''):'暂无可用组合。开始核价或扩大搜索范围。');
    $('cart').disabled=S.busy||!complete;$('cart').textContent=p.count&&!p.cost?'查看收货与合成进度':'核价并准备购买单';
  errorsView();
}
function searchAppId(raw){
  const m=raw.match(/^(\d+)$/)||raw.match(/^(?:https?:\/\/)?store\.steampowered\.com\/app\/(\d+)(?:[/?#]|$)/i);
  const id=Number(m?.[1]);return Number.isSafeInteger(id)&&id>0?id:0;
}
function showMatches(games){
  setHTML('matches',games.map(g=>'<button data-busy data-game="'+g.id+'">'+esc(g.name)+' <small>· '+g.id+'</small></button>').join(''));
}
function localMatches(raw){
  const id=searchAppId(raw),q=raw.toLowerCase();
  if(id)return S.meta.has(id)?[S.meta.get(id)]:[];
  if(!q)return [];
  return S.catalog.filter(g=>g.name.toLowerCase().includes(q)).sort((a,b)=>
    Number(b.name.toLowerCase()===q)-Number(a.name.toLowerCase()===q)).slice(0,12);
}
function searchMessage(message,game){
  const title=game?'<h2>'+esc(game.name)+'</h2><small>AppID '+game.id+'</small>':'';
  const store=game?'<button class="textbtn" data-store="'+game.id+'">查看 Steam 商店页 ↗</button>':'';
  $('details').className=game?'specificBox':'empty';
  setHTML('details',title+'<p>'+esc(message)+'</p>'+store+(game?.parent?'　<button data-busy data-game="'+game.parent+'">查询本体卡组</button>':''));
}
function matches(){
  clearCart();S.game=null;S.specificQuote=null;note('');
  const raw=$('query').value.trim();showMatches(localMatches(raw));
  searchMessage(raw?'选择匹配项，或点击「查询卡组」搜索 Steam 商店。':'输入游戏名称、AppID 或商店链接。');
}
async function lookup(id){
  clearCart();S.game=null;S.specificQuote=null;
  const raw=$('query').value.trim();
  let selected=null,storeError='';
  try{
    id=id||searchAppId(raw);
    if(!id){
      if(!raw){matches();return;}
      const local=localMatches(raw),q=raw.toLowerCase();
      let results=local;
      if(!local.some(g=>g.name.toLowerCase()===q)){
        searchMessage('正在搜索 Steam 商店…');
        try{
          const packet=await SteamData.storeSearch(raw);
          if(!Array.isArray(packet?.items))throw Error('Steam 商店的搜索响应不完整。');
          const merged=new Map();
          for(const item of packet.items){
            const key=Number(item.id);
            if(item.type==='app'&&Number.isSafeInteger(key)&&key>0&&item.name)merged.set(key,{id:key,name:item.name});
          }
          for(const g of local)if(!merged.has(g.id))merged.set(g.id,g);
          results=[...merged.values()];
        }catch(e){storeError='Steam 商店搜索暂不可用。'+access(e);}
      }
      showMatches(results);
      const exact=results.filter(g=>g.name.toLowerCase()===q);
      selected=exact.length===1?exact[0]:results.length===1?results[0]:null;
      if(!selected){
        searchMessage(storeError||(results.length?'请选择上方要查卡组的游戏。':(S.catalog.length?'Steam 商店和卡组目录均未找到匹配项，可改用 AppID 或商店链接。':'Steam 商店未找到匹配项，可改用 AppID 或商店链接。')));return;
      }
      id=selected.id;
    }else if(id===searchAppId(raw))showMatches([]);
    if(id===753){searchMessage('Steam 社区物品不属于可按五级核算的普通游戏卡组。');return;}
    let g=S.meta.get(id);
    if(!g){
      searchMessage('正在核对 Steam 商店功能…',selected);
      selected=await SteamData.storeInfo(id);
      if(!selected){searchMessage('Steam 商店未返回 AppID '+id+' 的资料，可能已下架或在当前地区不可用。');return;}
      if(selected.type==='dlc'&&selected.cards!==true){searchMessage('这是追加内容（DLC）。当前商店资料未列出独立的集换式卡组。',selected);return;}
      if(S.catalog.length&&selected.cards===false&&!S.account?.byGame[id]&&!S.account?.levels[id]){
        searchMessage('Steam 商店当前未标注“Steam 集换式卡牌”，卡组目录也未收录，暂无普通徽章可报价。',selected);return;
      }
      if(!S.account){searchMessage('请先同步账号，以便核对徽章和卡牌库存。',selected);return;}
      const size=await SteamData.badgeSize(id,S.account,S.session);
      if(!size){searchMessage('暂未能从 Steam 徽章页核实完整卡组，请稍后重试。',selected);return;}
      g={id,name:selected.name,size,guide:Infinity,stock:false};S.meta.set(id,g);
    }
    if(!S.account){searchMessage('该游戏有 '+g.size+' 种普通卡。同步账号后可查询补卡费用。',g);return;}
    if(selected?.name)g={...g,name:selected.name};
    searchMessage('已找到 '+g.size+' 种普通卡，正在逐张核价…',g);
    await loadGame(g);S.game=g;S.n=1;render();renderGame();
    note((storeError?storeError+' 已使用本地目录。 ':'')+'已按当前库存和订单簿核价 · '+now());
  }catch(e){searchMessage('本次查询未完成。'+access(e),selected||S.meta.get(id));}
}
function renderGame(bids=S.bids){
  if(!S.game)return;
  const g=S.games.get(S.game.id);if(!g){S.game=null;$('details').textContent='请重新查询该游戏。';return;}
  const level=S.account.levels[g.id]||0, left=Math.max(0,5-level), n=Math.min(left,S.n), mode=S.gameMode;
  const q=n=>Engine.evaluate(g,n,mode,S.account.owned,bids,S.account.pending);
  const one=Engine.evaluate(g,1,mode,{},bids),next=left?q(1):null,full=q(left),pick=q(n);
  S.specificQuote=pick;
  const missing=g.cards.map(c=>{const have=S.account.owned[c.hash]||0,qty=Math.max(0,n-have-(S.account.pending?.[c.hash]||0)),cap=S.bids[c.hash]??c.bid;return {...c,have,qty,cap,cost:qty&&cap===0?null:qty*cap};});
  $('details').className='specificBox';
  setHTML('details','<h2>'+esc(g.name)+'</h2><p class="sub">'+g.size+' 种普通卡 · 徽章 '+level+' 级 · 还能合成 '+left+' 次</p><div class="links"><button data-gmode="ask" class="'+(mode==='ask'?'primary':'')+'">现在买齐</button><button data-gmode="bid" class="'+(mode==='bid'?'primary':'')+'">限价求购</button></div><div class="prices">'+
    [['从零买一套',one],['补下一套',next],['从当前升满',full]].map(([s,v])=>'<div><small>'+s+'</small><b>'+(v?money(v.cost):left?'缺报价':'—')+'</b></div>').join('')+'</div>'+
    (left?'<label>合成次数　<select data-busy id="specificN">'+Array.from({length:left},(_,i)=>'<option '+(i+1===n?'selected':'')+'>'+(i+1)+'</option>').join('')+'</select></label>　<b>'+(pick?money(pick.cost):'当前无法报价')+'</b>':'<p>普通徽章已满级。</p>')+
    (pick&&n?rowsHTML(pick.rows,mode)+'<button data-busy id="singleCart" class="primary">核价并准备此游戏购买单</button>':n&&mode==='bid'?'<p class="sub">部分卡牌没有参考买价，填写单张限价后即可重新计算。</p>'+rowsHTML(missing,mode):'')+' <button data-badge="'+g.id+'">打开徽章页 ↗</button>');
}
function bidChange(el){
  const value=el.value.trim();
  const [whole,fraction='']=value.split('.');
  const v=Number(whole)*100+Number(fraction.padEnd(2,'0'));
  if(!/^(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/.test(value)||!Number.isSafeInteger(v)||v<1||v>100000000){
    el.value=el.defaultValue;
    note('限价必须为正数，最多两位小数。已恢复原限价。');
    return;
  }
  S.bids[el.dataset.bid]=v;localStorage.setItem('bids:'+S.account.id+':'+S.currency,JSON.stringify(S.bids));render();renderGame();note('已按新限价重新计算。');
}
function showCart(picks,rows,mode,original=picks,saveTarget=undefined){
  const goals=new Map(picks.map(p=>[p.id,(S.account.levels[p.id]||0)+p.n]));
  const actionable=rows.filter(r=>r.qty>0).map(r=>({...r,goal:goals.get(r.gid)})),chunks=[];let batch=[];
  for(const r of actionable){if((mode==='bid'&&batch.length)||batch.length>=12||SteamData.paymentUrl([...batch,r]).length>1500){if(batch.length)chunks.push(batch);batch=[];}batch.push(r);}
  if(batch.length)chunks.push(batch);
  S.batch=chunks;S.cartMode=mode;S.opened=new Set();S.retry=null;S.bidCursor=0;$('resumeBatch').hidden=true;
  const inTransit=rows.reduce((n,r)=>n+Math.min(r.missing,r.pending),0),qty=actionable.reduce((s,r)=>s+r.qty,0);
  const upper=actionable.reduce((s,r)=>s+r.cap*r.qty,0);
  const estimate=actionable.some(r=>r.cost==null)?null:actionable.reduce((s,r)=>s+r.cost,0);
  const before=original.reduce((s,p)=>s+p.cost,0),after=picks.reduce((s,p)=>s+p.cost,0);
  const prior=new Map(cartRows({picks:original}).map(r=>[r.hash,r]));
  const priorSets=new Map(original.map(p=>[p.id,p.n]));
  const switched=picks.length!==original.length||picks.some(p=>priorSets.get(p.id)!==p.n);
  const prices=rows.filter(r=>r.qty&&prior.has(r.hash)&&r.cap!==prior.get(r.hash).cap);
  const changed=before!==after||switched||prices.length>0;
  const changes=changed?'<div class="notice"><b>报价已更新</b>　'+(saveTarget===false?'补买前请核对最新单价。':'原方案 '+money(before)+' → 复核后 '+money(after)+'（'+(after===before?'总额持平':(after>before?'增加 ':'减少 ')+money(Math.abs(after-before)))+'）')+
    (switched?'<div>更新后的组合：'+picks.map(p=>esc(p.name)+' × '+p.n+' 套').join('、')+'。</div>':'')+
    (prices.length?'<details><summary>查看 '+prices.length+' 种卡的单张上限变化</summary>'+prices.map(r=>esc(r.name)+'　'+money(prior.get(r.hash).cap)+' → '+money(r.cap)).join('<br>')+'</details>':'')+'</div>':'';
  if(saveTarget!==false)savePurchasePlan(picks,mode,saveTarget===undefined?Number($('target').value):saveTarget);
  const balance=new Map(rows.map(r=>[r.hash,r]));
  const detail=picks.map(p=>{
    const cards=p.rows.map(c=>{
      const r=balance.get(c.hash)||{...c,missing:0,pending:0,qty:0};
      const price=r.qty?'<button class="textbtn" data-copy="'+(r.cap/100).toFixed(2)+'">'+money(r.cap)+'</button>':'—';
      return '<tr><td><button class="textbtn" data-listing="'+esc(c.hash)+'">'+esc(c.name)+' ↗</button></td><td>'+c.have+'</td><td>'+r.pending+'</td><td><b>'+r.qty+'</b></td><td>'+price+'</td></tr>';
    });
    return '<tr class="group-row"><th colspan="5">'+esc(p.name)+' · 还需合成 '+p.n+' 套</th></tr>'+cards.join('');
  }).join('');
  const batchAction=(b,i)=>{
    const count=b.reduce((n,r)=>n+r.qty,0),max=b.reduce((n,r)=>n+r.qty*r.cap,0);
    const label=mode==='bid'?'挂求购 · '+esc(b[0].name):'去 Steam 购买';
    return '<button data-busy data-batch="'+i+'" class="'+(i===0?'primary':'')+'">'+label+' · '+count+' 张 · 最高 '+money(max)+' ↗</button>';
  };
  const queued=mode==='bid'&&chunks.length>1;
  const first=queued?'<button data-busy data-buy-queue class="primary">开始连续求购 · '+chunks.length+' 种卡 ↗</button>':qty?batchAction(chunks[0],0):'';
  const extra=queued?chunks:chunks.slice(1);
  const next=qty?'<div class="batch-actions">'+first+(chunks.length>1?'<details><summary>'+(queued?'按卡牌打开':'其余 '+(chunks.length-1)+' 批')+'</summary><div class="links">'+extra.map((b,i)=>batchAction(b,queued?i:i+1)).join('')+'</div></details>':'')+'</div>':'';
  const title=qty?(saveTarget===false?'剩余补卡清单':'购买清单'):(inTransit?'等待求购到账':'可直接合成');
  const figures='<div class="cart-figures"><div><small>还需新购</small><strong>'+qty+' <em>张</em></strong></div><div><small>在途抵扣</small><strong>'+inTransit+' <em>张</em></strong></div>'+
    (qty&&mode==='ask'?'<div><small>预计还需支付</small><strong>'+(estimate==null?'卖单不足':money(estimate))+'</strong></div>':'')+
    (qty?'<div><small>剩余下单上限</small><strong>'+money(upper)+'</strong></div>':'')+'</div>';
  const back=S.returnReview?'在 Steam 确认后，点「返回并核对进度」查看剩余缺卡。':'在 Steam 确认后，回到「配卡工作台」核对余量。';
  const actions=qty?'<p class="sub">'+(queued?'Steam 侧栏可填入数量和价格，并切换到下一种卡。':'按当前缺口分为 '+chunks.length+' 批。'+back)+'</p>':
    '<p class="sub">'+(inTransit?'已有求购覆盖剩余缺口，到账后刷新即可合成。':'卡牌已在库存，可前往 Steam 合成徽章。')+'</p>';
  const craft=picks.map(p=>({p,ready:Math.min(p.n,...p.rows.map(r=>r.have))})).filter(x=>x.ready>0);
  const craftLinks=craft.map(({p,ready})=>'<button data-busy data-plan-badge="'+p.id+'">'+esc(p.name)+' · 去合成 '+ready+' 套 ↗</button>').join('');
  $('checkout').hidden=false;
  $('planningTools').open=false;
  setHTML('checkout','<div class="cart-title"><h2>'+title+'</h2><small>'+now()+' 核对</small></div>'+figures+
    (saveTarget===false?lastBatchSummary(currentProgress):'')+changes+next+actions+
    (craftLinks?'<div class="links">'+craftLinks+'</div>':'')+
    '<div id="batchReview" aria-live="polite"></div><details class="card-detail"><summary>逐卡明细 · '+picks.length+' 款游戏</summary><div class="wrap" tabindex="0" role="region" aria-label="逐卡购买明细"><table class="gridtable"><thead><tr><th>卡牌</th><th>库存</th><th>在途</th><th>还需新购</th><th>单张上限</th></tr></thead><tbody>'+detail+'</tbody></table></div></details>');
  $('checkout').scrollIntoView({behavior:'smooth',block:'start'});
}
async function openBatch(index,rows){
  const bid=S.cartMode==='bid';
  const url=bid?SteamData.base+'/market/listings/753/'+encodeURIComponent(rows[0].hash):SteamData.paymentUrl(rows);
  const count=rows.reduce((n,r)=>n+r.qty,0),upper=rows.reduce((n,r)=>n+r.qty*r.cap,0);
  const position=bid&&S.batch.length>1?'第 '+(index+1)+' / '+S.batch.length+' 种 · ':'本批 ';
  const nextBidIndex=bid&&index+1<S.batch.length?index+1:null;
  await SteamData.native('checkout',{url,account:S.account.id,currency:S.currency,nextBidIndex,summary:position+count+' 张 · 最高 '+money(upper),rows:rows.map(r=>({
    hash:r.hash,name:r.name,qty:r.qty,cap:r.cap,formatted:money(r.cap),value:(r.cap/100).toFixed(2)
  }))});
  S.opened.add(index);S.retry=null;
  for(const r of rows){
    const original=S.batch[index].find(o=>o.hash===r.hash);
    if(original)original.cap=r.cap;
  }
  localStorage.setItem('lastBatch:'+S.account.id,JSON.stringify({mode:S.cartMode,currency:S.currency,rows:S.batch[index],openedRows:rows,plan:currentProgress&&signature(currentProgress)}));
  const button=document.querySelector('[data-batch="'+index+'"]');
  if(button)button.textContent='第 '+(index+1)+' 批 · 核对余量并重开 ↗';
}
async function reviewBatch(index,inspectOnly=false,verify=false){
  const original=S.batch[index],id=S.account.id;
  if(!original?.length)return;
  S.retry=null;$('batchReview').replaceChildren();
  if(!verify&&!S.opened.has(index)){await openBatch(index,original);return;}
  note('正在核对这一批的库存、已合成次数和在途求购…');
  if(await SteamData.sessionId()!==id)throw Error('请登录这张购买单对应的 Steam 账号，再重开本批。');
  if(SteamData.wallet()&&SteamData.wallet()!==S.currency)throw Error('钱包币种已变化，请重新核价。');
  const pending=new Map(),otherOrders=await SteamData.allPending().catch(()=>null);
  for(const r of original){
    pending.set(r.hash,await checkedPending(r.hash,id,otherOrders));
  }
  const fresh=await SteamData.account(id,true,note);
  const status=[],remaining=[];
  let raised=false,short=false;
  for(const r of original){
    const outstanding=pending.get(r.hash);
    if(!Number.isSafeInteger(outstanding)||outstanding<0)throw Error('在途数量未知，请稍后重新核对本批。');
    const have=fresh.owned[r.hash]||0,sets=Math.max(0,r.goal-(fresh.levels[r.gid]||0));
    const qty=Math.max(0,sets-have-outstanding);
    let cap=r.cap,atCap=null;
    if(qty&&S.cartMode==='ask'){
      const book=await SteamData.book(r.hash,true);setCurrency(book.currency);
      atCap=Math.min(qty,book.asks.filter(([p])=>p<=r.cap).reduce((s,t)=>s+t[1],0));
      const quote=Engine.take(book.asks,qty);
      if(quote)cap=quote.cap;else short=true;
      if(cap>r.cap||qty>r.qty)raised=true;
    }
    const next={...r,have,qty,missing:Math.max(0,sets-have),pending:outstanding,cap,atCap};
    status.push(next);if(qty)remaining.push(next);
  }
  const table='<div class="wrap"><table class="gridtable"><thead><tr><th>卡牌</th><th>现持有</th><th>在途</th><th>还需下单</th><th>原限价可买</th></tr></thead><tbody>'+
    status.map(r=>'<tr><td>'+esc(r.name)+'</td><td>'+r.have+'</td><td>'+r.pending+'</td><td>'+r.qty+'</td><td>'+(r.atCap??'—')+'</td></tr>').join('')+'</tbody></table></div>';
  const count=remaining.reduce((s,r)=>s+r.qty,0);
  setHTML('batchReview','<h3>第 '+(index+1)+' 批 · 还需下单 '+count+' 张</h3>'+table);
  if(!count){note('这批卡已由库存、已合成徽章或在途求购覆盖。');return 'covered';}
  const old=remaining.map(r=>({...r,cap:original.find(x=>x.hash===r.hash).cap}));
  const total=arr=>money(arr.reduce((sum,r)=>sum+r.qty*r.cap,0));
  if(inspectOnly||raised||short||remaining.some(r=>r.qty>original.find(x=>x.hash===r.hash).qty)){
    S.retry={index,old,latest:short?null:remaining};
    $('batchReview').insertAdjacentHTML('beforeend','<p class="sub">'+(short?'当前卖单数量不足，可按原限价尝试或稍后核对。':'请核对补买数量和价格。')+'</p><div class="links"><button data-busy data-retry="old">按原单价上限打开 · 最多 '+total(old)+'</button>'+
      (!short&&raised?'<button data-busy data-retry="latest">按最新卖价打开 · 最多 '+total(remaining)+'</button>':'')+'</div>');
    $('batchReview').scrollIntoView({block:'nearest'});note('已列出剩余缺卡，可选择价格后进入 Steam。');return;
  }
  await openBatch(index,remaining);note('已按最新库存和在途求购打开余量清单，共 '+count+' 张。');
}
async function continueBuyQueue(start){
  if(S.cartMode!=='bid'||!Number.isSafeInteger(start)||start<0||start>=S.batch.length)return;
  const button=document.querySelector('[data-buy-queue]');
  for(let index=start;index<S.batch.length;index++){
    S.bidCursor=index;
    if(button)button.textContent='继续求购 · 第 '+(index+1)+' / '+S.batch.length+' 种卡 ↗';
    if(await reviewBatch(index,false,true)!=='covered')return;
  }
  if(button)button.hidden=true;
  note('后续卡牌已由库存或在途求购覆盖。');
}
async function resumeBatch(inspectOnly=false){
  if(!S.account||!S.session)throw Error('请在 Steam 官方页面登录当前账号并同步，再核对上次购买批次。');
  const saved=JSON.parse(localStorage.getItem('lastBatch:'+S.account.id)||'null');
  if(!saved?.rows?.length||!['ask','bid'].includes(saved.mode))throw Error('此账号还没有保存的购买批次。');
  if(await SteamData.sessionId()!==S.account.id)throw Error('Steam 登录账号与这批清单不一致。');
  const book=await SteamData.book(saved.rows[0].hash,true);
  setCurrency(book.currency);if(book.currency!==saved.currency)throw Error('这批清单的币种与当前钱包不同，请重新核价。');
  clearCart();S.batch=[saved.rows];S.opened.add(0);S.cartMode=saved.mode;
  $('resumeBatch').hidden=true;$('checkout').hidden=false;
  setHTML('checkout','<h2>上次打开的购买批次</h2><button data-busy data-batch="0">再核对本批余量 ↗</button><div id="batchReview" aria-live="polite"></div>');
  await reviewBatch(0,inspectOnly);
}
async function checkout(single=false){
  clearCart();const mode=single?S.gameMode:S.mode;
  const g=single&&S.games.get(S.game?.id);
  if(single&&(!g||S.specificQuote?.id!==g.id))throw Error('请先查询该游戏的完整卡组。');
  const orig=single?{picks:[S.specificQuote]}:S.plans[mode];
  if(!orig?.picks?.length||orig.picks.some(p=>!p))throw Error('当前组合不可购买，请先重新核价。');
  if(!single&&orig.count!==need())throw Error('当前组合尚未达到目标，请扩大搜索。');
  note('正在重查 Steam 库存、徽章与价格…');
  const id=S.account.id, logged=await purchaseRead('核对 Steam 登录状态',()=>SteamData.sessionId()), member=logged===id;
  if(member!==S.session){await sync();throw Error('Steam 登录状态已改变，请用当前钱包重新查询价格。');}
  const openOrders=member?await SteamData.allPending().catch(()=>null):null;
  const orders={...(openOrders||S.account.pending)};
  let fresh;
  async function refreshAccount(){
    fresh=await purchaseRead('复核徽章与库存',()=>SteamData.account(id,member,note));
    fresh.pending=orders;
    fresh.pendingIncomplete=member&&openOrders==null;
    S.account=fresh;accountStatus();registerOwned();
  }
  await refreshAccount();
  const originalBids=new Map();
  if(mode==='bid')for(const r of cartRows(orig))originalBids.set(r.hash,r.cap);
  const bids={...S.bids},verified=new Set(),ordersChecked=new Set(),shortages=new Set();
  for(const [hash,cap] of originalBids)if(bids[hash]==null)bids[hash]=cap;
  const msg=(game,sets)=>{
    for(const c of game.cards){
      const qty=Math.max(0,sets-(fresh.owned[c.hash]||0)-(fresh.pending[c.hash]||0));
      const stock=c.asks.reduce((sum,t)=>sum+t[1],0);
      if(mode==='ask'&&qty>stock)shortages.add(game.name+' · '+c.name+' 需 '+qty+' 张，在售 '+stock+' 张');
      if(mode==='bid'&&qty&&!(bids[c.hash]??c.bid))shortages.add(game.name+' · '+c.name+' 缺少求购限价');
    }
  };
  let updated;
  while(true){
    const required=single?orig.picks[0].n:need();
    if(!required){render();renderGame();note('当前经验已经达到目标等级。');return;}
    if(single&&required>5-(fresh.levels[g.id]||0)){render();renderGame();throw Error('徽章等级已更新，请选择剩余可合成的次数。');}
    const current=single?Engine.evaluate(S.games.get(g.id),required,mode,fresh.owned,bids,fresh.pending):null;
    const plan=single?{picks:current?[current]:[],count:current?required:0}:Engine.plan(S.games.values(),required,mode,fresh,bids);
    const unchecked=plan.picks.flatMap(p=>p.rows.filter(r=>r.missing&&!ordersChecked.has(r.hash)));
    if(unchecked.length){
      if(!member)throw Error('请在「Steam 官方页面」登录当前账号，再同步并准备购买单。');
      for(const r of unchecked){
        note('核对在途求购 · '+r.name);
        orders[r.hash]=await purchaseRead('核对在途求购「'+r.name+'」',()=>checkedPending(r.hash,id,openOrders));
        ordersChecked.add(r.hash);
      }
      await refreshAccount();
      continue;
    }
    const missing=plan.picks.filter(p=>p.rows.some(r=>r.qty)&&!verified.has(p.id));
    if(!missing.length){
      if(plan.count<required){
        render(bids);renderGame(bids);
        const detail=[...shortages].slice(0,3).join('；');
        throw Error((single?'该游戏当前凑不齐所选套数。':'已核价的游戏可凑 '+plan.count+' / '+required+' 套，还差 '+(required-plan.count)+' 套。可点「扩大搜索」。')+(detail?' '+detail:''));
      }
      updated=plan.picks;break;
    }
    if(!member)throw Error('请在「Steam 官方页面」登录当前账号，再同步并按钱包报价准备购买单。');
    for(const p of missing){
      note('复核订单簿 · '+p.name);
      const priced=await purchaseRead('复核「'+p.name+'」的订单簿',()=>loadGame(S.meta.get(p.id),true));
      if(mode==='bid')for(const c of priced.cards){
        if(originalBids.has(c.hash)&&S.bids[c.hash]==null){
          const cap=originalBids.get(c.hash);bids[c.hash]=c.bid?Math.min(c.bid,cap):cap;
        }
      }
      verified.add(p.id);msg(priced,p.n);
    }
  }
  render(bids);renderGame(bids);
  const rows=updated.flatMap(p=>p.rows.map(r=>({...r,gid:p.id,game:p.name})));
  showCart(updated,rows,mode,orig.picks,single?null:Number($('target').value));note('已核对库存、徽章与在途求购 · '+now());
}
function tab(which){
  $('planner').hidden=which!=='plan';$('specific').hidden=which!=='game';$('inventory').hidden=which!=='inventory';clearCart();
  if(which==='inventory')renderInventory();
  for(const s of ['plan','game','inventory']){
    $('tab-'+s).classList.toggle('active',which===s);
    $('tab-'+s).setAttribute('aria-pressed',String(which===s));
  }
}
$('sync').onclick=()=>job(sync,$('sync'),'正在同步 Steam 账号…');
$('scan').onclick=()=>job(()=>scan(),$('scan'),'正在准备升级核价…');
$('more').onclick=()=>job(()=>scan(true),$('more'),'正在核价更多游戏…');
$('stop').onclick=()=>{S.stop=true;note('将在当前请求结束后停止。');};
$('target').oninput=()=>render();$('query').oninput=matches;
$('lookup').onclick=()=>job(()=>lookup(),$('lookup'),'正在查询游戏卡组…');
$('query').onkeydown=e=>{if(e.key==='Enter')$('lookup').click();};
$('cart').onclick=()=>job(()=>checkout(),$('cart'),'正在复核购买清单…');
$('login').onclick=()=>open(SteamData.base+'/market/?l=english');
$('resumeBatch').onclick=()=>job(resumeBatch,$('resumeBatch'),'正在复核上次购买的卡牌…');
for(const m of ['ask','bid'])$('choose-'+m).onclick=()=>{if(S.busy)return;S.mode=m;render();};
for(const t of ['plan','game','inventory'])$('tab-'+t).onclick=()=>{if(!S.busy)tab(t);};
$('inventoryQuery').oninput=renderInventory;
$('priceInventory').onclick=()=>job(priceInventory,$('priceInventory'),'正在核对库存补齐费用…');
$('stopInventory').onclick=()=>{S.stop=true;note('将在当前请求结束后停止。');};
document.addEventListener('change',e=>{if(e.target.dataset.bid&&!S.busy)bidChange(e.target);if(e.target.id==='specificN'){S.n=+e.target.value;clearCart();renderGame();}});
document.addEventListener('click',e=>{
  const b=e.target.closest('button');if(!b)return;const d=b.dataset;
  if(d.badge&&S.account)open(SteamData.base+'/profiles/'+S.account.id+'/gamecards/'+Number(d.badge)+'/');
  if(d.planBadge&&S.account&&!S.busy)job(()=>SteamData.native('open',{url:SteamData.base+'/profiles/'+S.account.id+'/gamecards/'+Number(d.planBadge)+'/',reconcile:true}),b,'正在打开 Steam 徽章页…');
  if(d.listing)open(SteamData.base+'/market/listings/753/'+encodeURIComponent(d.listing));
  if(d.copy)navigator.clipboard.writeText(d.copy).then(()=>note('已复制单张上限 '+d.copy)).catch(()=>note('请手动复制单价 '+d.copy));
  if(d.game)job(()=>lookup(+d.game),b,'正在查询游戏卡组…');
  if(d.inventoryGame&&!S.busy){
    const selected=inventoryRows().find(row=>row.id===Number(d.inventoryGame));
    if(!selected)return;
    tab('game');
    $('query').value=d.inventoryGame;
    job(async()=>{
      try{await inventoryGame(selected.id,selected.name);}
      catch(error){searchMessage('本次查询未完成。'+access(error),selected);return;}
      await lookup(selected.id);
    },$('lookup'),'正在查询库存游戏卡组…');
  }
  if(d.store)open('https://store.steampowered.com/app/'+Number(d.store)+'/');
  if(d.gmode&&!S.busy){S.gameMode=d.gmode;clearCart();renderGame();}
  if(b.id==='singleCart')job(()=>checkout(true),b,'正在复核购买清单…');
  if(d.buyQueue!==undefined)job(()=>continueBuyQueue(S.bidCursor),b,'正在复核求购队列…');
  if(d.batch!==undefined&&S.batch[+d.batch])job(()=>reviewBatch(+d.batch),b,'正在准备 Steam 购买清单…');
  if(d.retry&&S.retry?.[d.retry])job(async()=>{const retry=S.retry;await openBatch(retry.index,retry[d.retry]);$('batchReview').querySelector('.links')?.remove();},b,'正在打开 Steam 购买页…');
});
function loadDirectory(){
  if(directory)return directory;
  $('sourceInfo').textContent='正在读取卡组目录…';
  $('sourceInfo').setAttribute('data-loading','');
  directory=SteamData.catalog().then(({rows,cached})=>{
    S.catalog=rows;
    for(const game of rows)S.meta.set(game.id,game);
    if(S.account){
      registerOwned();
      directoryChanged=true;
      if(!S.busy&&checkout.hidden)render();
    }
    $('sourceInfo').textContent=(cached?'本机目录缓存':'Steam Card Exchange 目录')+' · '+rows.length.toLocaleString()+' 款';
    if(!$('inventory').hidden)renderInventory();
  }).catch(error=>{
    directory=null;
    $('sourceInfo').textContent='卡组目录暂不可用。寻找升级方案时会重试。';
    throw error;
  }).finally(()=>$('sourceInfo').removeAttribute('data-loading'));
  return directory;
}
async function start(){
  SteamData.native('features').then(v=>{S.returnReview=v?.returnReview===true;}).catch(()=>{});
  loadDirectory().catch(()=>{});
  const id=localStorage.getItem('profile')||await SteamData.native('initial');
  if(id){$('profile').value=id;note('已填入 Steam 账号，点击「同步」读取库存与徽章。');}
  else note('输入 SteamID64 或个人资料链接后点击同步。');
}
start().catch(e=>note(access(e)));
