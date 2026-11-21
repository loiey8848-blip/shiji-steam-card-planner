'use strict';
const Engine = (() => {
  function threshold(level) {
    const decades = Math.floor(level / 10);
    return 500 * decades * (decades + 1) + 100 * (decades + 1) * (level % 10);
  }
  function take(book, quantity) {
    let cost = 0, cap = 0, left = quantity;
    for (const [price, stock] of book || []) {
      if (!left) break;
      const n = Math.min(left, stock);
      cost += n * price; left -= n; cap = price;
    }
    return left ? null : {cost, cap};
  }
  function evaluate(game, n, mode, owned, bids, orders) {
    let cost = 0;
    const rows = [];
    for (const card of game.cards) {
      const have = owned[card.hash] || 0;
      const missing = Math.max(0, n - have);
      const pending = orders?.[card.hash] || 0;
      const qty = Math.max(0, missing - pending);
      let quote = {cost:0,cap:0};
      if (qty && mode === 'ask') quote = take(card.asks, qty);
      if (qty && mode === 'bid') {
        const cap = bids[card.hash] ?? card.bid;
        quote = cap > 0 ? {cost:qty * cap,cap} : null;
      }
      if (!quote) return null;
      cost += quote.cost;
      rows.push({hash:card.hash, name:card.name, have, missing, pending, qty, ...quote});
    }
    return {id:game.id,name:game.name,n,cost,rows};
  }
  function plan(games, needed, mode, account, bids) {
    // For each game the next copy consumes inventory or a sell tier at a nondecreasing cost.
    const options = [], curves = new Map();
    for (const g of games) {
      let previous = 0;
      const curve = [];
      for (let n = 1; n <= 5 - (account.levels[g.id] || 0); n++) {
        const q = evaluate(g, n, mode, account.owned, bids, account.pending);
        if (!q) break;
        options.push({id:g.id,n,extra:q.cost - previous});
        curve.push(q); previous=q.cost;
      }
      curves.set(g.id,curve);
    }
    options.sort((a,b)=>a.extra-b.extra || a.id-b.id || a.n-b.n);
    const chosen = new Map();
    for (const step of options.slice(0,needed)) chosen.set(step.id,step.n);
    const picks = Array.from(chosen,([id,n])=>curves.get(id)[n-1]);
    return {picks, count:Math.min(options.length,needed), cost:picks.reduce((s,p)=>s+p.cost,0),
      free:Math.min(needed,options.filter(x=>x.extra===0).length),needed};
  }
  function orderBook(packet) {
    const obj=packet?.data?.data ?? packet?.data;
    if (!obj || !Number.isInteger(obj.eCurrency) || !Array.isArray(obj.rgCompactSellOrders ?? []) || (!('cSellOrders' in obj)&&!('rgCompactSellOrders' in obj))) throw Error('Steam 订单簿字段异常');
    const flat=obj.rgCompactSellOrders||[], asks=[];
    if(flat.length%2)throw Error('Steam 在售数量不完整');
    for(let i=0;i<flat.length;i+=2) {
      if(!Number.isSafeInteger(flat[i])||flat[i]<=0||!Number.isSafeInteger(flat[i+1])||flat[i+1]<=0)throw Error('Steam 价格数据无效');
      asks.push([flat[i],flat[i+1]]);
    }
    asks.sort((a,b)=>a[0]-b[0]);
    const depth=[];let covered=0;
    for(const tier of asks){depth.push(tier);covered+=tier[1];if(covered>=5)break;}
    return {currency:obj.eCurrency, asks:depth, bid:Number(obj.amtMaxBuyOrder)||0};
  }
  return {threshold,take,evaluate,plan,orderBook};
})();
if(typeof module!=='undefined')module.exports=Engine;
