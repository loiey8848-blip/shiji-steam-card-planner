'use strict';
const inventoryPageSize=12;
const inventoryQuoteMinutes=5;
const inventoryQuotes=new Map();
let inventoryAccount=null;

function inventoryRows(){
  if(inventoryAccount!==S.account){
    inventoryQuotes.clear();
    inventoryAccount=S.account;
  }
  if(!inventoryAccount)return [];
  const query=$('inventoryQuery').value.trim();
  const idQuery=searchAppId(query),textQuery=query.toLowerCase();
  const now=Date.now(),rows=[];
  for(const [key,cards] of Object.entries(inventoryAccount.byGame)){
    const id=Number(key),meta=S.meta.get(id);
    if(!Number.isSafeInteger(id)||id<1||id===753)continue;
    const names=[inventoryAccount.gameNames?.[id],meta?.name].filter(Boolean);
    if(idQuery?idQuery!==id:textQuery&&!names.some(name=>name.toLowerCase().includes(textQuery)))continue;
    const owned=Object.keys(cards).length;
    const total=meta?.size>=owned?meta.size:null;
    const missing=total===null?null:total-owned;
    const maxed=(inventoryAccount.levels[id]||0)>=5;
    let priced=inventoryQuotes.get(id);
    if(priced&&now-priced.time>=inventoryQuoteMinutes*60_000){
      inventoryQuotes.delete(id);
      priced=null;
    }
    const game=priced?.game;
    const ask=game?Engine.evaluate(game,1,'ask',inventoryAccount.owned,S.bids,inventoryAccount.pending):null;
    const bid=game?Engine.evaluate(game,1,'bid',inventoryAccount.owned,S.bids,inventoryAccount.pending):null;
    const waiting=game?.cards.filter(card=>!inventoryAccount.owned[card.hash]&&inventoryAccount.pending?.[card.hash]>0).length||0;
    rows.push({id,name:names[0]||'AppID '+id,owned,total,missing,maxed,priced,ask,bid,waiting});
  }
  const distance=row=>row.missing??Infinity;
  const rank=row=>row.maxed?3:row.missing===0?0:row.ask?1:2;
  return rows.sort((a,b)=>rank(a)-rank(b)||
    (a.ask?.cost??Infinity)-(b.ask?.cost??Infinity)||
    distance(a)-distance(b)||b.owned-a.owned||a.name.localeCompare(b.name,'zh-CN'));
}

function renderInventory(){
  const rows=inventoryRows(),summary=$('inventorySummary'),results=$('inventoryResults');
  const candidates=rows.filter(row=>!row.maxed&&row.missing!==0);
  const unpriced=candidates.filter(row=>!row.priced);
  const priced=candidates.filter(row=>row.priced?.game);
  const button=$('priceInventory');
  button.disabled=S.busy||candidates.length===0;
  button.textContent=unpriced.length?'核价 '+Math.min(unpriced.length,inventoryPageSize)+' 款':
    candidates.length?'重新核价 '+Math.min(candidates.length,inventoryPageSize)+' 款':'比较补齐费用';
  if(!rows.length){
    summary.textContent='';
    results.className='empty';
    results.textContent=!S.account?'同步 Steam 账号后，这里会显示你已有普通卡牌的游戏。':
      Object.keys(S.account.byGame).some(id=>id!=='753')?'库存中没有匹配的游戏。':'库存里还没有可用于普通游戏徽章的卡牌。';
    return;
  }
  const errors=candidates.filter(row=>row.priced?.error).length;
  summary.textContent='找到 '+rows.length+' 款 · 已核价 '+priced.length+' / '+candidates.length+' 款'+
    (errors?' · '+errors+' 款未能核价':'')+
    (S.session&&(S.account.pending==null||S.account.pendingIncomplete)?' · 在途求购未完整读取':'');
  const quote=(row,mode)=>{
    if(row.maxed)return '—';
    if(row.missing===0)return money(0);
    if(row[mode])return money(row[mode].cost);
    if(row.priced?.game)return mode==='ask'?'卖单不足':'缺参考价';
    return row.priced?.error?'未能核价':'待核价';
  };
  const list=rows.map(row=>{
    const owned=row.owned+(row.total!==null?' / '+row.total:'')+' 种';
    const state=row.maxed?'徽章已满':row.missing===0?'已齐套':row.missing===null?'待核实':
      '缺 '+row.missing+' 种'+(row.waiting?' · '+row.waiting+' 种在途':'');
    const details=row.maxed?'':('<button data-busy data-inventory-game="'+row.id+'"'+
      (S.busy?' disabled':'')+'>查价与明细</button>');
    const reason=row.priced?.error?' title="'+esc(row.priced.error)+'"':'';
    const shortage=row.missing>0&&!row.maxed?' class="inventory-missing"':'';
    return '<tr'+reason+'><td>'+esc(row.name)+'</td><td>'+owned+'</td><td'+shortage+'>'+state+'</td><td>'+quote(row,'ask')+'</td><td>'+quote(row,'bid')+'</td><td>'+details+'</td></tr>';
  });
  results.className='wrap';
  setHTML('inventoryResults','<table class="gridtable"><thead><tr><th scope="col">游戏</th><th scope="col">已持有</th>'+
    '<th scope="col">下一套</th><th scope="col">即时买齐</th><th scope="col">求购上限</th><th scope="col">明细</th></tr></thead><tbody>'+list.join('')+'</tbody></table>');
}

async function inventoryGame(id,name){
  const known=S.meta.get(id);
  if(known)return known;
  const size=await SteamData.badgeSize(id,S.account,S.session);
  if(!size)throw Error('Steam 徽章页没有返回可核实的普通卡组。');
  const game={id,name,size,guide:Infinity,stock:false};
  S.meta.set(id,game);
  return game;
}

async function priceInventory(){
  if(!S.account)throw Error('请先同步 Steam 账号。');
  const rows=inventoryRows().filter(row=>!row.maxed&&row.missing!==0);
  const unpriced=rows.filter(row=>!row.priced);
  const refresh=unpriced.length===0;
  const batch=(refresh?rows.sort((a,b)=>a.priced.time-b.priced.time):unpriced).slice(0,inventoryPageSize);
  if(!batch.length)return;
  const stop=$('stopInventory');
  stop.hidden=false;
  let done=0;
  try{
    for(const row of batch){
      if(S.stop)break;
      note('正在核价 '+(done+1)+' / '+batch.length+' · '+row.name);
      try{
        const game=await inventoryGame(row.id,row.name);
        const priced=await loadGame(game,refresh,true);
        inventoryQuotes.set(row.id,{time:Date.now(),game:priced});
      }catch(error){
        if(S.stop||/429|币种|已停止|超时|timed out|网络|连接|SSL|HTTP 50[0234]/i.test(error.message))throw error;
        inventoryQuotes.set(row.id,{time:Date.now(),error:access(error)});
      }
      done++;
      renderInventory();
    }
  }finally{stop.hidden=true;}
  note(S.stop?'已停止库存核价。':'已完成本轮库存核价 · '+now());
}
