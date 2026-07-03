// Blackwater Fine Art Portraits - shared behaviour
(function(){
  // Sticky nav: transparent over hero, solid on scroll
  var nav=document.getElementById('topnav');
  if(nav){
    var solidAt=nav.getAttribute('data-solid-at')==='top'?60:(window.innerHeight*0.72);
    var onScroll=function(){nav.classList.toggle('solid',window.scrollY>solidAt);};
    window.addEventListener('scroll',onScroll,{passive:true});onScroll();
  }
  // Mobile menu
  var mm=document.getElementById('mobileMenu');
  var burger=document.getElementById('hamburger');
  var close=document.getElementById('mmClose');
  if(burger&&mm){burger.addEventListener('click',function(){mm.classList.add('open');});}
  if(close&&mm){close.addEventListener('click',function(){mm.classList.remove('open');});}
  document.querySelectorAll('.mm-link').forEach(function(a){a.addEventListener('click',function(){if(mm)mm.classList.remove('open');});});
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
})();
