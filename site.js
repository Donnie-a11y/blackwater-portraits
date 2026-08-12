// Blackwater Fine Art Portraits - shared behaviour
(function(){
  var nav=document.getElementById('topnav');
  if(nav){
    var solidAt=nav.getAttribute('data-solid-at')==='top'?60:(window.innerHeight*0.72);
    var onScroll=function(){nav.classList.toggle('solid',window.scrollY>solidAt);};
    window.addEventListener('scroll',onScroll,{passive:true});onScroll();
  }
  var mm=document.getElementById('mobileMenu');
  var burger=document.getElementById('hamburger');
  var close=document.getElementById('mmClose');
  function openMenu(){if(!mm)return;mm.classList.add('open');document.body.style.overflow='hidden';if(burger)burger.setAttribute('aria-expanded','true');if(close)close.focus();}
  function closeMenu(){if(!mm)return;mm.classList.remove('open');document.body.style.overflow='';if(burger){burger.setAttribute('aria-expanded','false');}}
  if(burger&&mm){burger.setAttribute('aria-expanded','false');burger.addEventListener('click',openMenu);}
  if(close&&mm){close.addEventListener('click',closeMenu);}
  document.querySelectorAll('.mm-link').forEach(function(a){a.addEventListener('click',closeMenu);});
  document.addEventListener('keydown',function(e){if(e.key==='Escape'&&mm&&mm.classList.contains('open'))closeMenu();});
  if('IntersectionObserver' in window){
    var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target);}});},{rootMargin:'-6% 0px -6% 0px'});
    document.querySelectorAll('.reveal').forEach(function(el){io.observe(el);});
  }else{document.querySelectorAll('.reveal').forEach(function(el){el.classList.add('in');});}
  document.querySelectorAll('.faq .q').forEach(function(q){
    q.addEventListener('click',function(){
      var item=q.parentElement, wasOpen=item.classList.contains('open');
      var scope=item.closest('.faq-wrap')||document;
      scope.querySelectorAll('.faq').forEach(function(f){f.classList.remove('open');});
      if(!wasOpen)item.classList.add('open');
    });
  });
  var chips=document.querySelectorAll('.chip[data-filter]');
  if(chips.length){
    chips.forEach(function(c){c.addEventListener('click',function(){
      chips.forEach(function(x){x.classList.remove('on');});c.classList.add('on');
      var f=c.getAttribute('data-filter');
      document.querySelectorAll('.article[data-cat]').forEach(function(a){
        a.style.display=(f==='all'||a.getAttribute('data-cat')===f)?'':'none';
      });
    });});
  }
  (function(){
    var laz=[].slice.call(document.querySelectorAll('img[loading="lazy"]'));
    laz.forEach(function(i){i.setAttribute('decoding','async');});
    function eager(i){ if(i.getAttribute('loading')==='lazy'){ i.setAttribute('loading','eager'); } }
    if(window.innerWidth<=900){ laz.forEach(eager); return; }
    laz.forEach(function(i){
      var t=i.getBoundingClientRect().top;
      if(t < window.innerHeight*1.4){ eager(i); }
    });
    if('IntersectionObserver' in window){
      var io2=new IntersectionObserver(function(es){
        es.forEach(function(e){ if(e.isIntersecting){ eager(e.target); io2.unobserve(e.target); } });
      },{rootMargin:'800px 0px 800px 0px'});
      laz.forEach(function(i){ if(i.getAttribute('loading')==='lazy') io2.observe(i); });
    }else{
      laz.forEach(eager);
    }
  })();
})();

// Studio phone number - single source of truth.
(function(){
  var NEW_DIGITS='7403914921', NEW_DISPLAY='(740) 391-4921', NEW_DASH='740-391-4921';
  var OLD_DIGITS=['7402069039','7403913921'];
  var OLD_DISPLAY=['(740) 206-9039','(740) 391-3921'];
  var OLD_DASH=['740-206-9039','740-391-3921'];
  var TEST=/206-9039|391-3921|7402069039|7403913921/;
  function repl(s){
    OLD_DISPLAY.forEach(function(o){s=s.split(o).join(NEW_DISPLAY);});
    OLD_DASH.forEach(function(o){s=s.split(o).join(NEW_DASH);});
    OLD_DIGITS.forEach(function(o){s=s.split(o).join(NEW_DIGITS);});
    return s;
  }
  function fix(){
    document.querySelectorAll('a[href^="tel:"]').forEach(function(a){
      var h=a.getAttribute('href'); if(!TEST.test(h)) return;
      OLD_DIGITS.forEach(function(o){h=h.split(o).join(NEW_DIGITS);});
      a.setAttribute('href', h);
    });
    var w=document.createTreeWalker(document.documentElement,NodeFilter.SHOW_TEXT,null),n,list=[];
    while(n=w.nextNode()){ if(n.nodeValue && TEST.test(n.nodeValue)) list.push(n); }
    list.forEach(function(nd){ nd.nodeValue=repl(nd.nodeValue); });
  }
  if(document.readyState!=='loading')fix();else document.addEventListener('DOMContentLoaded',fix);
})();

// Photography protection: block easy save/drag on images. Text stays selectable.
(function(){
  var st=document.createElement('style');
  st.textContent='img{-webkit-user-drag:none;-khtml-user-drag:none;-moz-user-drag:none;-o-user-drag:none;user-drag:none;-webkit-touch-callout:none;-webkit-user-select:none;-moz-user-select:none;-ms-user-select:none;user-select:none}';
  (document.head||document.documentElement).appendChild(st);
  function isImg(t){ return t && t.tagName==='IMG'; }
  document.addEventListener('contextmenu',function(e){ if(isImg(e.target)) e.preventDefault(); },true);
  document.addEventListener('dragstart',function(e){ if(isImg(e.target)) e.preventDefault(); },true);
})();

// Footer legal links (Privacy Policy / Terms) injected site-wide.
(function(){
  function addLegal(){
    var fl=document.querySelector('.foot-legal2');
    if(!fl) return;
    if(fl.querySelector('a[href="privacy"]')) return;
    var s=document.createElement('span');
    s.innerHTML='<a href="privacy">Privacy Policy</a>&nbsp;&middot;&nbsp;<a href="terms">Terms &amp; Conditions</a>';
    var first=fl.querySelector('span');
    if(first&&first.nextSibling){fl.insertBefore(s,first.nextSibling);}else{fl.appendChild(s);}
  }
  if(document.readyState!=='loading')addLegal();else document.addEventListener('DOMContentLoaded',addLegal);
})();
