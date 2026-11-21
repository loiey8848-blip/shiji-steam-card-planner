const assert=require('node:assert/strict');
const E=require('../app/engine.js');
assert.equal(E.threshold(10),1000);assert.equal(E.threshold(20),3000);assert.equal(E.threshold(177)-163838,1762);
assert.deepEqual(E.take([[12,1],[15,4]],4),{cap:15,cost:57});
assert.equal(E.take([[12,1]],2),null);
let seed=1;
function rand(max){seed=(seed*16807)%2147483647;return seed%max;}
for(let trial=0;trial<240;trial++){
 const gs=[],a={levels:{},owned:{}},bids={};
 for(let i=0;i<4;i++){
   a.levels[i]=rand(6);const cards=[];
   for(let j=0;j<3;j++){const h=i+'-'+j,base=1+rand(20);
     a.owned[h]=rand(6);cards.push({hash:h,name:h,asks:[[base,rand(3)+1],[base+rand(7),rand(4)+1]],bid:rand(9)});
     if(rand(3)===0)bids[h]=1+rand(7);
   }gs.push({id:i,cards});
 }
 for(const mode of ['bid','ask']){
   const target=1+rand(12);let best=new Map([[0,0]]);
   for(const g of gs){
     const next=new Map(best);
     for(let n=1;n<=5-a.levels[g.id];n++){const v=E.evaluate(g,n,mode,a.owned,bids);if(!v)break;
       for(const [cnt,cost] of best){const k=cnt+n;if(k<=target)next.set(k,Math.min(next.get(k)??Infinity,cost+v.cost));}}
     best=next;
   }
   const count=Math.max(...best.keys()), plan=E.plan(gs,target,mode,a,bids);
   assert.equal(plan.count,count);assert.equal(plan.cost,best.get(count));
   for(const p of plan.picks)assert.ok(p.n+a.levels[p.id]<=5);
 }
}
const b=E.orderBook({data:{eCurrency:1,rgCompactSellOrders:[12,1,15,4],amtMaxBuyOrder:10}});
assert.equal(b.currency,1);assert.ok(b.asks.length>1);assert.ok(b.bid>0);
console.log('480 exact-plan comparisons, depth, incomplete stock, level thresholds and order-book parsing passed.');

