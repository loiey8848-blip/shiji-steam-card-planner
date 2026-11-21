'use strict';
(() => {
  const motion=window.matchMedia('(prefers-reduced-motion: reduce)');
  const active=new WeakMap();
  const colors=['#ff8f80','#ffd080','#fbafc3','#e0b7ff','#f6edd1','#abe7d5','#ffb896','#f7e0a4'];
  const duration=600;

  document.addEventListener('click',event=>{
    const button=event.target.closest('button[data-burst]');
    if(!button||button.disabled||motion.matches||event.defaultPrevented)return;
    active.get(button)?.();

    const rect=button.getBoundingClientRect();
    if(!rect.width||!rect.height)return;
    const layer=document.createElement('div');
    layer.className='button-burst';
    layer.setAttribute('aria-hidden','true');
    layer.style.left=rect.left+rect.width/2+'px';
    layer.style.top=rect.top+rect.height/2+'px';
    document.body.append(layer);

    const animations=[button.animate([
      {transform:'scale(1)',offset:0},
      {transform:'scale(.8)',offset:.13},
      {transform:'scale(1.2)',offset:.38},
      {transform:'scale(.98)',offset:.72},
      {transform:'scale(1)',offset:1}
    ],{duration,easing:'ease-out'})];

    colors.forEach((color,index)=>{
      const dot=document.createElement('span');
      dot.style.color=color;
      layer.append(dot);
      const angle=(index+.2)*Math.PI/4;
      const x=Math.cos(angle)*(rect.width/2+19);
      const y=Math.sin(angle)*(rect.height/2+24);
      animations.push(dot.animate([
        {transform:'translate(-50%,-50%) scale(.45)',opacity:0,offset:0,easing:'cubic-bezier(.18,.75,.35,1)'},
        {transform:'translate(calc(-50% + '+x*.77+'px),calc(-50% + '+y*.77+'px)) scale(1)',opacity:1,offset:.38,easing:'ease-in'},
        {transform:'translate(calc(-50% + '+x+'px),calc(-50% + '+y+'px)) scale(.35)',opacity:0,offset:1}
      ],{duration}));
    });

    const stop=()=>{
      for(const animation of animations)animation.cancel();
      layer.remove();
    };
    active.set(button,stop);
    Promise.allSettled(animations.map(animation=>animation.finished)).then(()=>{
      layer.remove();
      if(active.get(button)===stop)active.delete(button);
    });
  },true);
})();
