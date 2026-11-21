'use strict';
let currentProgress=null;
const planKey=id=>'purchasePlans:'+id;
const signature=p=>[p.mode,p.currency,p.target||0,...p.games.map(g=>g.id+'-'+g.goal).sort()].join('|');
const removedKey=id=>'removedPurchasePlans:'+id;
function storedPlans(id){try{return JSON.parse(localStorage.getItem(planKey(id))||'[]');}catch{return [];}}
function removedPlans(id){try{return JSON.parse(localStorage.getItem(removedKey(id))||'[]');}catch{return [];}}
function rememberPlan(plan){
  const all=storedPlans(plan.account),key=signature(plan),index=all.findIndex(p=>signature(p)===key);
  let saved=plan;
  if(index<0)all.unshift(plan);
  else{
    const existing=all[index];
    const games=new Map(plan.games.map(game=>[String(game.id),game.cards]));
    saved={...existing,games:existing.games.map(game=>{
      const prices=new Map((games.get(String(game.id))||[]).filter(card=>Number.isSafeInteger(card.cap)&&card.cap>0)
        .map(card=>[card.hash,card.cap]));
      return {...game,cards:game.cards.map(card=>({...card,cap:prices.get(card.hash)??card.cap}))};
    })};
    all[index]=saved;
  }
  localStorage.setItem(planKey(plan.account),JSON.stringify(all));
  currentProgress=saved;
  localStorage.setItem('activePlan:'+plan.account,key);
}
function savePurchasePlan(picks,mode,target){
  if(!S.account||!picks.length)return;
  const games=picks.map(p=>({id:p.id,name:p.name,start:S.account.levels[p.id]||0,goal:(S.account.levels[p.id]||0)+p.n,
    cards:p.rows.map(r=>({name:r.name,hash:r.hash,cap:r.cap}))}));
  rememberPlan({account:S.account.id,target,mode,currency:S.currency||SteamData.wallet()||0,created:Date.now(),games});
  displayProgress();
}
async function restorePurchasePlans(){
  const id=S.account.id;
  const all=storedPlans(id),selected=localStorage.getItem('activePlan:'+id);
  currentProgress=all.find(p=>signature(p)===selected)||all[0]||null;
  try{
    const response=await fetch('progress-import.json',{cache:'no-store'});
    if(response.ok){const legacy=await response.json();
      if(legacy.account===id&&Array.isArray(legacy.games)&&legacy.games.length&&!removedPlans(id).includes(signature(legacy))&&!all.some(p=>signature(p)===signature(legacy))){
        if(!currentProgress)rememberPlan(legacy);
        else localStorage.setItem(planKey(id),JSON.stringify([...all,legacy]));
      }}
  }catch{}
  displayProgress();
}
function gameBalance(g,a){
  const level=a.levels[g.id]||0,remaining=Math.max(0,g.goal-level);
  const rows=g.cards.map(c=>{const have=a.owned[c.hash]||0;return {...c,have,missing:Math.max(0,remaining-have)};});
  return {remaining,rows,done:Math.max(0,Math.min(level,g.goal)-g.start),ready:Math.min(remaining,...rows.map(r=>r.have))};
}
function deletePurchasePlan(plan){
  const account=S.account;
  if(!account||plan.account!==account.id)return;
  const key=signature(plan),id=account.id;
  const saved=storedPlans(id);
  if(!saved.some(p=>signature(p)===key))return;
  const unfinished=plan.games.some(game=>gameBalance(game,account).remaining>0);
  const message=unfinished?'删除这条进行中的计划？这只会删除本机记录，Steam 上的求购单会继续有效。':
    '删除这条已完成的计划？这只会删除本机的计划记录。';
  if(!window.confirm(message))return;
  const remaining=saved.filter(p=>signature(p)!==key);
  localStorage.setItem(removedKey(id),JSON.stringify([...new Set([...removedPlans(id),key])]));
  localStorage.setItem(planKey(id),JSON.stringify(remaining));
  let lastBatch;
  try{lastBatch=JSON.parse(localStorage.getItem('lastBatch:'+id)||'null');}catch{}
  if(lastBatch?.plan===key)localStorage.removeItem('lastBatch:'+id);
  currentProgress=remaining[0]||null;
  if(currentProgress)localStorage.setItem('activePlan:'+id,signature(currentProgress));
  else{
    localStorage.removeItem('activePlan:'+id);
    $('planningTools').open=true;
  }
  clearCart();displayProgress();note('已删除该计划。');
}
function lastBatchSummary(plan){
  if(!plan)return '';
  let saved;
  try{saved=JSON.parse(localStorage.getItem('lastBatch:'+plan.account));}catch{return '';}
  if(saved?.plan!==signature(plan)||!saved.openedRows?.length)return '';
  const account=S.account;
  let opened=0,toBuy=0,inTransit=0;
  const lines=[];
  for(const row of saved.openedRows){
    const need=Math.max(0,row.goal-(account.levels[row.gid]||0)),have=account.owned[row.hash]||0;
    const missing=Math.max(0,need-have),pending=Math.min(missing,account.pending?.[row.hash]||0),buy=missing-pending;
    opened+=row.qty;toBuy+=buy;inTransit+=pending;
    if(missing)lines.push('<li><b>'+esc(row.name)+'</b>　合成需要 '+need+' 张 · 库存 '+have+' · 在途 '+pending+' · 再补 '+buy+'</li>');
  }
  const result=toBuy?'还要补 '+toBuy+' 张':inTransit?'等 '+inTransit+' 张到账':'已由库存或已合成徽章覆盖';
  const details=lines.length>1?'<details><summary>查看这批仍缺的 '+lines.length+' 种卡</summary><ul>'+lines.join('')+'</ul></details>':lines.length?'<ul>'+lines[0]+'</ul>':'';
  return '<div class="receipt"><b>上次打开的 '+opened+' 张</b>　'+result+details+'</div>';
}
function displayProgress(){
  const panel=$('savedPlan'),a=S.account,p=currentProgress;
  if(!p||!a||p.account!==a.id){panel.hidden=true;return;}
  $('resumeBatch').hidden=true;
  const plans=storedPlans(a.id),key=signature(p);
  const options=plans.map((v,i)=>'<option value="'+i+'" '+(signature(v)===key?'selected':'')+'>'+esc(v.target?'升到 '+v.target+' 级':v.games[0].name)+' · '+v.games.length+' 款 · '+new Date(v.created).toLocaleString('zh-CN')+'</option>').join('');
  let done=0,total=0,ready=0,missing=0;
  const craft=[];
  const games=p.games.map(g=>{
    const b=gameBalance(g,a),n=b.rows.reduce((s,r)=>s+r.missing,0);done+=b.done;total+=g.goal-g.start;ready+=b.ready;missing+=n;
    if(b.ready)craft.push('<button data-busy data-plan-badge="'+g.id+'">'+esc(g.name)+' · 去合成 '+b.ready+' 套 ↗</button>');
    return '<tr><td>'+esc(g.name)+'</td><td>'+b.done+' / '+(g.goal-g.start)+'</td><td>'+b.ready+'</td><td>'+n+'</td></tr>';
  }).join('');
  const complete=done===total,reached=p.target&&a.level>=p.target;
  panel.hidden=false;panel.innerHTML='<div class="workhead"><h2>'+(complete?'原计划已完成':reached?'已达到目标等级':missing?'继续原购买计划':'卡牌已齐，去合成徽章')+' · '+(p.target?'目标 '+p.target+' 级':esc(p.games[0].name))+'</h2>'+
    '<div class="links"><button id="continuePlan" class="'+(missing&&!reached?'primary':'')+'" data-busy>'+(missing?(reached?'查看原定徽章缺口':'核对余量并继续购买'):'刷新进度')+'</button>'+
    '<button id="deletePlan" data-busy>删除计划</button></div></div>'+
    (plans.length>1?'<label>已保存的计划　<select id="planChoice" data-busy>'+options+'</select></label>':'')+
    '<div class="plan-numbers"><span>已合成 <b>'+done+' / '+total+' 套</b></span><span>可立即合成 <b>'+ready+' 套</b></span>'+
    (missing?'<span>库存缺口 <b>'+missing+' 张</b>（含在途）</span>':'')+'</div>'+
    (craft.length?'<div class="links">'+craft.join('')+'</div>':'')+
    '<details><summary>查看 '+p.games.length+' 款游戏的进度</summary><table class="gridtable"><tr><th>原计划游戏</th><th>已合成 / 原定</th><th>可直接合成</th><th>库存缺卡</th></tr>'+games+'</table></details>';
  if($('planChoice'))$('planChoice').onchange=e=>{currentProgress=plans[+e.target.value];localStorage.setItem('activePlan:'+a.id,signature(currentProgress));clearCart();displayProgress();note('已切换计划。');};
  $('continuePlan').onclick=event=>job(continuePlan,event.currentTarget,'正在核对计划进度…');$('continuePlan').disabled=S.busy;
  $('deletePlan').onclick=()=>job(()=>deletePurchasePlan(p),null,'');
  $('deletePlan').disabled=S.busy;
}
async function continuePlan(fromSteam=false){
  const p=currentProgress;
  if(!p||p.account!==S.account?.id)throw Error('请同步原计划对应的 Steam 账号。');
  clearCart();note('正在核对原计划的库存与在途求购…');$('progress').scrollIntoView({block:'nearest'});
  if(await SteamData.sessionId()!==p.account)throw Error('请在 Steam 官方页面登录原计划对应的账号。');
  // Read outstanding orders before the inventory so a fill between the two
  // observations cannot turn into an extra buy.
  const snapshot=await SteamData.allPending().catch(()=>null),pendingByHash=new Map();
  async function checkOrders(account){
    let added=0;
    for(const g of p.games)for(const row of gameBalance(g,account).rows){
      if(!row.missing||pendingByHash.has(row.hash))continue;
      note('核对在途求购 · '+g.name+' · '+row.name);
      pendingByHash.set(row.hash,await checkedPending(row.hash,p.account,snapshot));added++;
    }
    return added;
  }
  await checkOrders(S.account);
  let a=await SteamData.account(p.account,true,note);
  if(await checkOrders(a))a=await SteamData.account(p.account,true,note);
  a.pending={...snapshot,...Object.fromEntries(pendingByHash)};
  a.pendingIncomplete=snapshot==null;
  S.account=a;S.session=true;accountStatus();registerOwned();render();renderGame();displayProgress();
  if(fromSteam&&p.target&&a.level>=p.target){note('已升到 '+a.level+' 级，当前升级目标已完成。');$('savedPlan').scrollIntoView({block:'nearest'});return;}
  const picks=[],checked=[],gaps=[];let verifiedCurrency=false;
  for(const g of p.games){
    const b=gameBalance(g,a);if(!b.remaining)continue;
    const detail=[];let cost=0;
    for(const row of b.rows){
      const {hash,name,have,missing}=row,pending=pendingByHash.get(hash)||0;let cap=row.cap,subtotal=0;
      if(missing&&!pendingByHash.has(hash))throw Error('库存刚发生变化，请再核对一次余量。');
      const qty=Math.max(0,missing-pending);
      if(qty){
        note('核对剩余 '+qty+' 张的价格 · '+name);
        const book=await SteamData.book(hash,true);if(p.currency&&book.currency!==p.currency)throw Error('原计划和当前订单簿币种不同，请核对钱包。');
        setCurrency(book.currency);verifiedCurrency=true;
        if(p.mode==='ask'){
          const quote=Engine.take(book.asks,qty);
          if(quote){cap=quote.cap;subtotal=quote.cost;}else{if(!cap)cap=book.asks.at(-1)?.[0]||0;subtotal=null;gaps.push(name);}
        }else{cap=cap||book.bid;subtotal=qty*cap;}
        if(!cap)throw Error('这张缺卡暂无可用单价，请稍后继续原计划：'+name);
      }
      detail.push({hash,name,have,qty:missing,cap:row.cap,cost:missing*row.cap});cost+=missing*row.cap;
      checked.push({hash,name,have,missing,pending,qty,cap:qty?cap:0,cost:subtotal,gid:g.id,game:g.name});
    }
    picks.push({id:g.id,name:g.name,n:b.remaining,cost,rows:detail});
  }
  if(!picks.length){note('原计划已完成，所有目标徽章均已合成。');$('savedPlan').scrollIntoView({block:'nearest'});return;}
  if(!verifiedCurrency&&!S.currency)S.currency=p.currency;
  showCart(picks,checked,p.mode,picks,false);
  note(gaps.length?'有 '+gaps.length+' 种卡当前卖单不足，按所示上限可能仅部分成交。':'已核对库存、徽章和在途求购 · '+now());
}
