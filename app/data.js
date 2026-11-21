'use strict';
const SteamData = (() => {
  const base='https://steamcommunity.com';
  const calls=new Map(); let seq=0;
  window.chrome.webview.addEventListener('message',({data})=>{
    if(data?.event==='nextBuyOrder'){window.dispatchEvent(new CustomEvent('nextBuyOrder',{detail:data.index}));return;}
    if(data?.event==='returnedFromOrder'){window.dispatchEvent(new Event('returnedFromOrder'));return;}
    const call=calls.get(data.id); if(!call)return; calls.delete(data.id);
    data.error?call.reject(Error(data.error)):call.resolve(data.result);
  });
  function native(op, args={}) {
    return new Promise((resolve,reject)=>{const id=String(++seq);calls.set(id,{resolve,reject});window.chrome.webview.postMessage({op,id,...args});});
  }
  const dom=html=>new DOMParser().parseFromString(html,'text/html');
  const asJson=t=>JSON.parse(t.replace(/^\uFEFF/,''));
  async function get(url,session=false){
    const steam=url.startsWith(base+'/')||url.startsWith('https://store.steampowered.com/');
    const delays=[650,1500];
    for(let attempt=0;;attempt++){
      try{return await native('get',{url,session});}
      catch(error){
        if(!steam||attempt>=delays.length||!/HTTP 50[0234]\b/.test(error.message))throw error;
        await new Promise(resolve=>setTimeout(resolve,delays[attempt]));
      }
    }
  }
  const read=async(url,session)=>asJson(await get(url,session));
  const clean=s=>dom('<textarea>'+String(s).replaceAll('<','&lt;')+'</textarea>').querySelector('textarea').value;
  async function catalog() {
    let packet, cached=false;
    const key='badge-price-catalog';
    try {
      packet=await read('https://www.steamcardexchange.net/api/request.php?GetBadgePrices_Guest');
      if(!packet.data?.length)throw Error();
      try{localStorage.setItem(key,JSON.stringify(packet));}catch{}
    }catch{
      try{packet=JSON.parse(localStorage.getItem(key)||'null');}catch{}
      if(!packet?.data?.length)throw Error('暂时无法读取卡组目录。请联网后重试。');
      cached=true;
    }
    const rows=packet.data.map(([game,size,price,time,stock])=>({
      id:+game[0],name:clean(game[1]),size:+size,guide:Number(String(price).replace(/[^\d.]/g,''))||Infinity,time,stock:!!+stock
    })).filter(g=>g.id>0&&g.id!==753&&g.size>0&&!/^(?:(?:the )?steam (?:awards|summer|winter|holiday|sale)|(?:summer|winter|holiday|monster summer|exploration|summer getaway|saliens|steamville) sale)(?:\b|$)/i.test(g.name));
    return {rows,cached};
  }
  async function resolveId(input) {
    input=input.trim();
    if(/^\d{17}$/.test(input))return input;
    let m=input.match(/^https?:\/\/steamcommunity\.com\/(id|profiles)\/([\w-]+)\/?(?:[?#].*)?$/i);
    if(m?.[1]==='profiles'&&/^\d{17}$/.test(m[2]))return m[2];
    let vanity=m?.[1]==='id'?m[2]:input;
    if(!/^[\w-]{2,64}$/.test(vanity))throw Error('请输入 SteamID64 或完整的 Steam 个人资料链接。');
    let text=await get(base+'/id/'+vanity+'/?xml=1');
    let id=text.match(/<steamID64>(\d{17})<\/steamID64>/)?.[1] || text.match(/"steamid"\s*:\s*"(\d{17})"/)?.[1];
    if(!id)throw Error('无法解析个人资料链接，可改用 17 位 SteamID64。'); return id;
  }
  function badgePage(body) {
    const d=dom(body), block=d.querySelector('.profile_xp_block');
    if(!block)throw Error('Steam 没有返回可读的徽章页。请检查资料可见性，或在工具的 Steam 官方页面登录后同步。');
    const val=(selector)=>{const m=block.querySelector(selector)?.textContent.match(/[\d,]+/);if(!m)throw Error('Steam 等级或经验字段缺失');return Number(m[0].replaceAll(',',''));};
    const level=val('.friendPlayerLevelNum'), xp=val('.profile_xp_block_xp');
    if(xp<Engine.threshold(level)||xp>=Engine.threshold(level+1))throw Error('Steam 等级与总经验暂不一致，稍后重新同步。');
    const levels={};
    for(const row of d.querySelectorAll('.badge_row')){
      const href=row.querySelector('.badge_row_overlay')?.getAttribute('href')||'';
      const m=href.match(/\/gamecards\/(\d+)\//); if(!m||/[?&]border=1/.test(href)||/_\d+_1$/.test(row.id))continue;
      const desc=row.querySelector('.badge_info_description')?.textContent||'';
      const n=desc.match(/\bLevel\s+(\d+)/i);
      if(!n&&/\b[1-9][\d,]*\s*XP\b/i.test(desc))throw Error('有一枚已合成徽章无法识别等级，已暂停同步。');
      levels[m[1]]=n?Number(n[1]):0;
    }
    const pages=[...d.querySelectorAll('.pagelink,.pagebtn')].map(a=>Number((a.getAttribute('href')||'').match(/[?&]p=(\d+)/)?.[1])||0);
    return {level,xp,levels,pages:Math.max(1,...pages),name:d.querySelector('.profile_small_header_name a')?.textContent.trim()||''};
  }
  async function account(input,session,progress) {
    const id=await resolveId(input), prof=base+'/profiles/'+id;
    const page=p=>get(prof+'/badges/?l=english&p='+p,session).then(badgePage);
    progress('读取徽章和经验…');
    const data=await page(1); let end=data.pages;
    for(let n=2;n<=end;n++){progress('读取徽章第 '+n+' / '+end+' 页…'); const next=await page(n);Object.assign(data.levels,next.levels);end=Math.max(end,next.pages);}
    const owned={}, byGame={}, gameNames={}, seen=new Set(), cursors=new Set(); let cursor='';
    do {
      progress('读取卡牌库存…');
      const inv=await read(base+'/inventory/'+id+'/753/6?l=english&count=2000'+(cursor?'&start_assetid='+cursor:''),session);
      if(!inv.success||(!Array.isArray(inv.assets)&&inv.total_inventory_count!==0))throw Error('库存不可读。请检查 Steam 库存可见性或登录后重试。');
      const items=new Map((inv.descriptions||[]).map(v=>[v.classid+'_'+v.instanceid,v]));
      for(const a of inv.assets||[]){
        if(seen.has(a.assetid))continue;seen.add(a.assetid); const desc=items.get(a.classid+'_'+a.instanceid);
        if(!desc)throw Error('库存描述不完整，请重新同步。');
        const tags=new Set((desc.tags||[]).map(t=>t.internal_name));
        if(!tags.has('item_class_2')||!tags.has('cardborder_0'))continue;
        const gameTag=desc.tags.find(t=>t.category==='Game');
        const gid=Number((gameTag?.internal_name||'').replace('app_',''));
        const hash=desc.market_hash_name;const qty=Number(a.amount);
        if(!hash||!gid||!Number.isSafeInteger(qty)||qty<1)throw Error('Steam 卡牌库存字段不完整。');
        owned[hash]=(owned[hash]||0)+qty;
        (byGame[gid]||={})[hash]=desc.name||hash;
        if(gameTag?.localized_tag_name)gameNames[gid]=gameTag.localized_tag_name;
      }
      if(!inv.more_items)break;
      cursor=String(inv.last_assetid||'');if(!/^\d+$/.test(cursor)||cursors.has(cursor))throw Error('Steam 库存分页未完成，请重试。');cursors.add(cursor);
    }while(true);
    return {...data,id,owned,byGame,gameNames,synced:Date.now()};
  }
  function gameCardsFromResults(packet,game,account) {
    if(!packet?.success||!Array.isArray(packet.results)||packet.total_count>packet.results.length)throw Error('卡种清单未读全');
    const names=new Map(Object.entries(account.byGame[game.id]||{}));
    for(const r of packet.results) {
      const hash=r.hash_name||r.asset_description?.market_hash_name;
      if(hash)names.set(hash,r.name||r.asset_description?.name||hash);
    }
    if(names.size!==game.size)throw Error('已识别 '+names.size+' / '+game.size+' 种普通卡，无法确认完整卡组');
    return [...names].map(([hash,name])=>({hash,name}));
  }
  async function cardNames(g,account,session) {
    const known=account.byGame[g.id]||{};
    if(Object.keys(known).length===g.size)return Object.entries(known).map(([hash,name])=>({hash,name}));
    const params=new URLSearchParams({appid:'753',norender:'1',l:'english',start:'0',count:'100',query:'',
      'category_753_Game[]':'tag_app_'+g.id,'category_753_item_class[]':'tag_item_class_2','category_753_cardborder[]':'tag_cardborder_0'});
    return gameCardsFromResults(await read(base+'/market/search/render/?'+params,session),g,account);
  }
  async function book(hash,session) {
    const query=new URLSearchParams({q:'Load',qp:JSON.stringify([753,hash]),l:'english'});
    return Engine.orderBook(await read(base+'/market/orderbook?'+query,session));
  }
  function ssr(text) {
    const d=dom(text); const node=d.querySelector('#valve-ssr-data');
    if(!node)throw Error('Steam 未返回订单信息。请在官方页面检查当前求购单。');
    return asJson(node.textContent);
  }
  async function pending(hash,id) {
    const page=ssr(await get(base+'/market/listings/753/'+encodeURIComponent(hash)+'?l=english',true));
    if(String(page.UserConfig?.steamid)!==id||!page.UserConfig?.logged_in)throw Error('请在工具上方的 Steam 官方页面登录当前配卡账号，再核对求购单。');
    const data=page.loaderData.map(x=>typeof x==='string'?asJson(x):x).find(x=>x?.myOrders);
    if(!data||!Array.isArray(data.myOrders.rgBuyOrders))throw Error('无法核对已有求购单，请在 Steam 官方市场核对后购买。');
    let count=0;
    for(const o of data.myOrders.rgBuyOrders){
      const name=o.market_hash_name||o.strMarketHashName||o.strItemName||o.description?.market_hash_name;
      if(name&&name!==hash)continue;
      const q=Number(o.quantity_remaining??o.quantityRemaining??o.unQuantityRemaining??o.cQuantityRemaining??o.cQuantityRemainingToBuy);
      if(!Number.isSafeInteger(q)||q<0)throw Error('该卡有在途求购，剩余数量未能核实。请先在 Steam 市场检查。');
      count+=q;
    }
    return count;
  }
  async function allPending() {
    const p=await read(base+'/market/mylistings/?norender=1&start=0&count=100',true);
    if(!p.success||!Array.isArray(p.buy_orders))return null;
    const kept={};
    for(const o of p.buy_orders){
      const hash=o.description?.market_hash_name||o.market_hash_name;
      const q=Number(o.quantity_remaining??o.quantityRemaining);
      if(!hash||!Number.isSafeInteger(q)||q<0)return null;
      if(Number(o.description?.appid??o.appid)===753)kept[hash]=(kept[hash]||0)+q;
    }
    return kept;
  }
  let walletHint=0;
  async function sessionId() {
    walletHint=0;
    const raw=await get(base+'/market/?l=english',true);
    const legacy=raw.match(/g_rgWalletInfo\s*=\s*(\{[^;]+?\})\s*;/);
    if(legacy){try{walletHint=Number(asJson(legacy[1]).wallet_currency)||0;}catch{}}
    try {const user=ssr(raw).UserConfig;walletHint=Number(user?.wallet_currency)||walletHint;return user?.logged_in?String(user.steamid):'';}
    catch { return raw.match(/g_steamID\s*=\s*"(\d{17})"/)?.[1]||''; }
  }
  function paymentUrl(rows) {
    const q=new URLSearchParams({appid:'753'});
    rows.forEach(r=>{q.append('items[]',r.hash);q.append('qty[]',String(r.qty));});
    return base+'/market/multibuy?'+q;
  }
  async function storeInfo(id){
    const packet=await read('https://store.steampowered.com/api/appdetails?appids='+id+'&l=schinese&cc=cn');
    const entry=packet?.[id];
    if(entry?.success===false)return null;
    const data=entry?.data;
    if(!data?.name||Number(data.steam_appid)!==id)throw Error('Steam 商店返回的游戏资料不完整，请重试。');
    return {id,name:data.name,type:data.type,cards:Array.isArray(data.categories)?data.categories.some(c=>c.id===29):null,parent:Number(data.fullgame?.appid)||0};
  }
  async function badgeSize(id,account,session){
    const html=await get(base+'/profiles/'+account.id+'/gamecards/'+id+'/?l=english',session);
    const slots=[...dom(html).querySelectorAll('.badge_card_set_card')];
    const indices=new Set();
    for(const slot of slots){
      const match=slot.textContent.match(/\b(\d+) of (\d+),\s*Series 1\b/i);
      if(!match||Number(match[2])!==slots.length||+match[1]<1||+match[1]>slots.length)return 0;
      indices.add(+match[1]);
    }
    return indices.size===slots.length?indices.size:0;
  }
  return {native,catalog,account,cardNames,book,pending,allPending,sessionId,wallet:()=>walletHint,paymentUrl,badgePage,gameCardsFromResults,
    storeSearch:q=>read('https://store.steampowered.com/api/storesearch/?l=schinese&cc=cn&term='+encodeURIComponent(q)),
    storeInfo,badgeSize,base};
})();
