(function fillSteamForm(order) {
  const fallback='请对照右侧清单手动核对数量和单价。';
  if(location.origin!=='https://steamcommunity.com')return fallback;
  if(location.pathname.startsWith('/market/listings/753/'))return fillBuyOrder(order);
  if(location.pathname.replace(/\/$/,'')!=='/market/multibuy')return fallback;
  if(String(window.g_steamID)!==order.account||Number(window.g_rgWalletInfo?.wallet_currency)!==order.currency)return fallback;
  const hashes=window.g_rgMarketHashNames,ids=window.g_rgItemNameIds;
  if(!Array.isArray(hashes)||!Array.isArray(ids)||hashes.length!==order.rows.length||ids.length!==hashes.length||
    new Set(hashes).size!==hashes.length||new Set(ids).size!==ids.length||window.g_rgOrders?.some?.(Boolean))return fallback;
  if(typeof window.GetPriceValueAsInt!=='function'||typeof window.v_currencyformat!=='function'||
    typeof window.GetCurrencyCode!=='function'||typeof window.UpdateOrderTotal!=='function')return fallback;
  const inputs=[];
  for(const row of order.rows) {
    const pos=hashes.indexOf(row.hash);
    if(pos<0||!Number.isSafeInteger(row.qty)||row.qty<=0||!Number.isSafeInteger(row.cap)||row.cap<=0)return fallback;
    const price=document.getElementById('buy_'+ids[pos]+'_price'),qty=document.getElementById('buy_'+ids[pos]+'_qty');
    if(!(price instanceof HTMLInputElement)||!(qty instanceof HTMLInputElement)||price.disabled||qty.disabled||price.readOnly||qty.readOnly)return fallback;
    const value=window.v_currencyformat(row.cap,window.GetCurrencyCode(order.currency));
    if(window.GetPriceValueAsInt(value)!==row.cap)return fallback;
    inputs.push({price,qty,value,count:row.qty});
  }
  for(const {price,qty,value,count} of inputs){price.value=value;qty.value=String(count);}
  window.UpdateOrderTotal();
  return '已填入清单数量和单张上限。请核对 Steam 总额后确认。';

  function fillBuyOrder({account,currency,rows}){
    const [row]=rows;
    if(rows.length!==1||!row||!Number.isSafeInteger(row.qty)||row.qty<1||
        !Number.isSafeInteger(row.cap)||row.cap<1)return fallback;
    const path='/market/listings/753/';
    if(decodeURIComponent(location.pathname.slice(path.length)).replace(/\/$/,'')!==row.hash)return fallback;

    let user;
    try{user=JSON.parse(document.getElementById('valve-ssr-data')?.textContent||'null')?.UserConfig;}catch{}
    const steamId=user?.logged_in===true?user.steamid:window.g_steamID;
    if(String(steamId)!==account||user?.logged_in===false)return 'Steam 登录账号与清单不一致，请核对账号。';
    const pageCurrency=Number(user?.wallet_currency||window.g_rgWalletInfo?.wallet_currency);

    const visible=element=>element.getClientRects().length>0&&getComputedStyle(element).visibility==='visible';
    const editable=element=>element instanceof HTMLInputElement&&!element.disabled&&!element.readOnly&&visible(element);
    const heading=/^(?:提交订购单|提交求购单|place (?:a |your )?buy order)$/i;
    const labels={
      price:/^(?:您愿意支付的价格|单件价格|price per item|price you want to pay|how much do you want to pay)[：:\s?？]*$/i,
      qty:/^(?:您想要购买的数量|购买数量|quantity|quantity to buy|how many do you want to buy)[：:\s?？]*$/i
    };
    const texts=[...document.querySelectorAll('h1,h2,h3,div,span,label')].filter(el=>visible(el)&&heading.test(el.textContent.trim()));
    const formCandidates=new Set();
    for(const title of texts){
      let panel=title.parentElement;
      for(let i=0;panel&&i<9;i++,panel=panel.parentElement){
        const fields=[...panel.querySelectorAll('input')].filter(el=>editable(el)&&['text','number','tel'].includes(el.type));
        if(fields.length===2){formCandidates.add(panel);break;}
        if(fields.length>2)break;
      }
    }
    if(formCandidates.size!==1)return '请先打开这张卡的 Steam 求购弹窗，再点「填入清单数量和价格」。';
    const [panel]=formCandidates;
    const field=(label,legacyId)=>{
      const exact=document.getElementById(legacyId);
      if(editable(exact)&&panel.contains(exact))return exact;
      const choices=new Set();
      for(const caption of panel.querySelectorAll('label,div,span')){
        if(!visible(caption)||!label.test(caption.textContent.trim()))continue;
        if(editable(caption.control)&&panel.contains(caption.control)){choices.add(caption.control);continue;}
        for(let group=caption;group&&group!==panel;group=group.parentElement){
          const peers=[...group.querySelectorAll('input')].filter(el=>editable(el)&&['text','number','tel'].includes(el.type));
          if(peers.length>1)break;
          if(peers.length===1){choices.add(peers[0]);break;}
        }
      }
      return choices.size===1?[...choices][0]:null;
    };
    const price=field(labels.price,'market_buyorder_dialog_price');
    const qty=field(labels.qty,'market_buyorder_dialog_quantity');
    if(!price||!qty||price===qty)return fallback;

    const digits=(price.value||price.placeholder).match(/^(\D*)(\d+(?:[.,\s]\d+)*)(\D*)$/u);
    if(pageCurrency>0&&pageCurrency!==currency)return 'Steam 钱包币种与清单不一致，请重新核价。';
    // The Chinese-yuan field displays ¥ and exactly two decimal places. Treat
    // other formats without a wallet currency as ambiguous.
    if(!pageCurrency&&!(currency===23&&digits&&/^[¥￥]\s*$/u.test(digits[1])&&/\.\d{2}$/.test(digits[2])))return fallback;
    if(!digits&&(price.type!=='number'||price.value))return fallback;
    const decimal=digits?.[2].match(/([.,])\d{2}$/)?.[1]||'.';
    const toMinor=value=>{
      const number=value.match(/\d(?:[\d.,\s]*\d)?/u)?.[0];
      if(!number)return NaN;
      const fraction=number.match(/([.,])(\d{2})$/);
      const whole=fraction?number.slice(0,-3):number;
      return Number(whole.replace(/[^\d]/g,''))*100+Number(fraction?.[2]||0);
    };
    const amount=(row.cap/100).toFixed(2).replace('.',decimal);
    const expected=price.type==='number'?(row.cap/100).toFixed(2):(digits[1]+amount+digits[3]);
    const oldPrice=price.value,oldQty=qty.value;
    const setValue=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
    function fill(input,value){
      setValue.call(input,value);
      input.dispatchEvent(new Event('input',{bubbles:true}));
      input.dispatchEvent(new Event('change',{bubbles:true}));
    }

    fill(price,expected);
    fill(qty,String(row.qty));
    if(!price.isConnected||!qty.isConnected||toMinor(price.value)!==row.cap||Number(qty.value)!==row.qty){
      if(price.isConnected)fill(price,oldPrice);
      if(qty.isConnected)fill(qty,oldQty);
      return fallback;
    }
    return '已填入清单数量和单张上限。请核对 Steam 总额后确认。';
  }
})
