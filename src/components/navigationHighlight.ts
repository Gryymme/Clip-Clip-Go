export function trackNavigationHighlight(nav:HTMLElement,bar:HTMLElement){
    let placed=false;
    const measure=()=>{
      const item=nav.querySelector<HTMLElement>('[aria-current="page"]');if(!item)return;
      const outer=nav.getBoundingClientRect(),rect=item.getBoundingClientRect();
      const previous=bar.getBoundingClientRect();bar.getAnimations().forEach(a=>a.cancel());
      const top=rect.top-outer.top+nav.scrollTop,left=rect.left-outer.left;
      Object.assign(bar.style,{top:`${top}px`,left:`${left}px`,width:`${rect.width}px`,height:`${rect.height}px`,visibility:'visible'});
      if(placed&&!matchMedia('(prefers-reduced-motion: reduce)').matches)bar.animate([{transform:`translate(${previous.left-rect.left}px,${previous.top-rect.top}px) scale(${previous.width/rect.width},${previous.height/rect.height})`},{transform:'none'}],{duration:220,easing:'ease-in-out'});
      placed=true;
    };
    measure();const resize=new ResizeObserver(()=>{placed=false;measure();});resize.observe(nav);nav.querySelectorAll('button').forEach(el=>resize.observe(el));
    const changes=new MutationObserver(measure);changes.observe(nav,{subtree:true,attributes:true,attributeFilter:['aria-current']});
    return()=>{resize.disconnect();changes.disconnect();bar.getAnimations().forEach(a=>a.cancel());};
}
