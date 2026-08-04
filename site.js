// Blackwater Fine Art Portraits - shared behaviour
(function(){
  // Sticky nav: transparent over hero, solid on scroll
  var nav=document.getElementById('topnav');
  if(nav){
    var solidAt=nav.getAttribute('data-solid-at')==='top'?60:(window.innerHeight*0.72);
    var onScroll=function(){nav.classList.toggle('solid',window.scrollY>solidAt);};
    window.addEventListener('scroll',onScroll,{passive:true});onScroll();
  }
  // Mobile menu (with scroll lock, aria state, Escape + click-out close)
  var mm=document.getElementById('mobileMenu');
  var burger=document.getElementById('hamburger');
  var close=document.getElementById('mmClose');
  function openMenu(){if(!mm)return;mm.classList.add('open');document.body.style.overflow='hidden';if(burger)burger.setAttribute('aria-expanded','true');if(close)close.focus();}
  function closeMenu(){if(!mm)return;mm.classList.remove('open');document.body.style.overflow='';if(burger){burger.setAttribute('aria-expanded','false');}}
  if(burger&&mm){burger.setAttribute('aria-expanded','false');burger.addEventListener('click',openMenu);}
  if(close&&mm){close.addEventListener('click',closeMenu);}
  document.querySelectorAll('.mm-link').forEach(function(a){a.addEventListener('click',closeMenu);});
  document.addEventListener('keydown',function(e){if(e.key==='Escape'&&mm&&mm.classList.contains('open'))closeMenu();});
  // Scroll reveal
  if('IntersectionObserver' in window){
    var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target);}});},{rootMargin:'-6% 0px -6% 0px'});
    document.querySelectorAll('.reveal').forEach(function(el){io.observe(el);});
  }else{document.querySelectorAll('.reveal').forEach(function(el){el.classList.add('in');});}
  // FAQ accordion
  document.querySelectorAll('.faq .q').forEach(function(q){
    q.addEventListener('click',function(){
      var item=q.parentElement, wasOpen=item.classList.contains('open');
      var scope=item.closest('.faq-wrap')||document;
      scope.querySelectorAll('.faq').forEach(function(f){f.classList.remove('open');});
      if(!wasOpen)item.classList.add('open');
    });
  });
  // Stories category filter (optional, if present)
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

  // ----------------------------------------------------------
  // Reliable image loading.
  // Native loading="lazy" can stall on some mobile browsers and over
  // slow connections, which is why photographs appeared blank on the
  // phone. This upgrades every lazy image to load a little BEFORE it
  // reaches the viewport (rootMargin) so it is ready when scrolled to,
  // while still deferring images that are far down the page. decoding
  // is set to async so paint is never blocked.
  // ----------------------------------------------------------
  (function(){
    var laz=[].slice.call(document.querySelectorAll('img[loading="lazy"]'));
    laz.forEach(function(i){i.setAttribute('decoding','async');});
    function eager(i){ if(i.getAttribute('loading')==='lazy'){ i.setAttribute('loading','eager'); } }
    // On phones, load every photograph up front so nothing ever shows as a
    // blank frame while scrolling on a slower connection.
    if(window.innerWidth<=900){ laz.forEach(eager); return; }
    // Desktop: anything in or just below the first screen loads now.
    laz.forEach(function(i){
      var t=i.getBoundingClientRect().top;
      if(t < window.innerHeight*1.4){ eager(i); }
    });
    // The rest: load ~800px before they scroll into view.
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

// ----------------------------------------------------------
// Studio phone number — single source of truth.
// The number appears on every page (nav, footer, calls to action, tel:
// links, and structured data). This normalises the old number to the
// current one everywhere, so changing it only has to be done here.
// To update in future: set NEW_DIGITS / the display + dashed forms below.
// ----------------------------------------------------------
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
    // Clickable tel: links (covers tel:7402069039 / tel:+1... and the interim number)
    document.querySelectorAll('a[href^="tel:"]').forEach(function(a){
      var h=a.getAttribute('href'); if(!TEST.test(h)) return;
      OLD_DIGITS.forEach(function(o){h=h.split(o).join(NEW_DIGITS);});
      a.setAttribute('href', h);
    });
    // Visible text nodes + JSON-LD structured data
    var w=document.createTreeWalker(document.documentElement,NodeFilter.SHOW_TEXT,null),n,list=[];
    while(n=w.nextNode()){ if(n.nodeValue && TEST.test(n.nodeValue)) list.push(n); }
    list.forEach(function(nd){ nd.nodeValue=repl(nd.nodeValue); });
  }
  if(document.readyState!=='loading')fix();else document.addEventListener('DOMContentLoaded',fix);
})();

// Footer legal links (Privacy Policy / Terms) — injected site-wide so every
// page's footer links to the legal pages without editing each page.
(function(){
  function addLegal(){
    var fl=document.querySelector('.foot-legal2');
    if(!fl) return;
    if(fl.querySelector('a[href="privacy.html"]')) return; // already present
    var s=document.createElement('span');
    s.innerHTML='<a href="privacy.html">Privacy Policy</a>&nbsp;&middot;&nbsp;<a href="terms.html">Terms &amp; Conditions</a>';
    var first=fl.querySelector('span');
    if(first&&first.nextSibling){fl.insertBefore(s,first.nextSibling);}else{fl.appendChild(s);}
  }
  if(document.readyState!=='loading')addLegal();else document.addEventListener('DOMContentLoaded',addLegal);
})();
