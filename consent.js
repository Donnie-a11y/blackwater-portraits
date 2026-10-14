/* Blackwater consent: nothing tracks until the visitor accepts.
   Choice is stored for 12 months in the first-party cookie bw_consent (accepted / declined).
   Global Privacy Control is treated as Decline. */
(function(){
  var KEY='bw_consent', GA_ID='G-15W37TRF25', YEAR=31536000;
  var GPC = navigator.globalPrivacyControl === true;
  var loaded = false, banner = null, lastFocus = null;

  function getChoice(){
    var m = document.cookie.match(/(?:^|;\s*)bw_consent=(accepted|declined)/);
    return m ? m[1] : null;
  }
  function setChoice(v){
    document.cookie = KEY+'='+v+'; Max-Age='+YEAR+'; Path=/; SameSite=Lax'+(location.protocol==='https:'?'; Secure':'');
  }
  function addScript(src){
    var s=document.createElement('script'); s.async=true; s.src=src;
    (document.head||document.documentElement).appendChild(s);
  }
  // Pages queue their GA4 and Pixel calls in stubs; the real libraries load only here.
  function loadTrackers(){
    if (loaded || GPC) return;
    loaded = true;
    if (window.dataLayer) addScript('https://www.googletagmanager.com/gtag/js?id='+GA_ID);
    if (window.fbq) addScript('https://connect.facebook.net/en_US/fbevents.js');
  }
  // Remove analytics and advertising cookies on every domain level they may have been set on.
  function purge(){
    var host = location.hostname, parts = host.split('.'), domains = ['', host, '.'+host];
    for (var i=1;i<parts.length-1;i++){ var d=parts.slice(i).join('.'); domains.push(d,'.'+d); }
    document.cookie.split(';').forEach(function(c){
      var name = c.split('=')[0].trim();
      if (!/^(_ga|_ga_.+|_gid|_gat.*|_fbp|_fbc)$/.test(name)) return;
      domains.forEach(function(d){
        document.cookie = name+'=; Max-Age=0; Path=/'+(d?'; Domain='+d:'');
      });
    });
  }

  var CSS = ''+
  '.bw-cb{position:fixed;left:0;right:0;bottom:0;z-index:2000;background:#FBF8F1;color:#463A30;border-top:2px solid #C2A76A;box-shadow:0 -10px 30px rgba(40,31,24,.14);font-family:"Montserrat",-apple-system,Arial,sans-serif}'+
  '.bw-cb[hidden]{display:none}'+
  '.bw-cb-in{max-width:1200px;margin:0 auto;padding:16px 28px;display:flex;align-items:center;gap:28px}'+
  '.bw-cb-txt{flex:1 1 auto;min-width:0}'+
  '.bw-cb-h{font-family:"Cormorant Garamond",Georgia,serif;font-size:21px;font-weight:500;line-height:1.15;color:#281F18;margin:0 0 3px}'+
  '.bw-cb-p{font-size:13px;line-height:1.55;margin:0;color:#463A30}'+
  '.bw-cb-p a{color:#7A6230;text-decoration:underline;text-underline-offset:2px}'+
  '.bw-cb-gpc{font-size:12px;line-height:1.5;margin:4px 0 0;color:#6B5C4A}'+
  '.bw-cb-btns{flex:0 0 auto;display:flex;gap:12px}'+
  '.bw-cb-b{width:132px;min-height:46px;padding:0 16px;border:1px solid #281F18;background:#281F18;color:#FBF8F1;font-family:"Montserrat",-apple-system,Arial,sans-serif;font-size:12px;font-weight:600;letter-spacing:.18em;text-transform:uppercase;cursor:pointer;border-radius:0}'+
  '.bw-cb-b:hover{background:#463A30;border-color:#463A30}'+
  '.bw-cb-b:focus-visible,.bw-cb-p a:focus-visible{outline:2px solid #7A6230;outline-offset:3px}'+
  '@media(max-width:760px){.bw-cb-in{flex-direction:column;align-items:stretch;gap:10px;padding:12px 16px calc(12px + env(safe-area-inset-bottom))}'+
  '.bw-cb-h{font-size:18px;margin-bottom:2px}.bw-cb-p{font-size:12px;line-height:1.5}.bw-cb-btns{gap:10px}.bw-cb-b{flex:1 1 0;width:auto;min-height:44px}}'+
  'button.cookie-settings{background:none;border:0;padding:0;font:inherit;letter-spacing:inherit;text-transform:inherit;color:inherit;cursor:pointer;text-decoration:underline;text-underline-offset:2px}';

  // Keep page content and sticky booking bars clear of the banner.
  function makeRoom(){
    var h = (banner && !banner.hidden) ? banner.offsetHeight : 0;
    document.body.style.paddingBottom = h ? h+'px' : '';
    document.querySelectorAll('.ab-sticky,.woc-sticky').forEach(function(el){ el.style.bottom = h ? h+'px' : ''; });
  }

  function build(){
    var st=document.createElement('style'); st.textContent=CSS; document.head.appendChild(st);
    banner=document.createElement('div');
    banner.className='bw-cb'; banner.hidden=true;
    banner.setAttribute('role','region'); banner.setAttribute('aria-label','Cookie choices');
    banner.innerHTML=
      '<div class="bw-cb-in"><div class="bw-cb-txt">'+
      '<p class="bw-cb-h">Your privacy</p>'+
      '<p class="bw-cb-p">We use cookies to understand how visitors use our site and to measure our ads. You can accept or decline. See our <a href="/privacy">Privacy Policy</a>.</p>'+
      (GPC?'<p class="bw-cb-gpc">Your browser sends a Global Privacy Control signal, so tracking stays off on this device.</p>':'')+
      '</div><div class="bw-cb-btns">'+
      '<button type="button" class="bw-cb-b" data-choice="accepted">Accept</button>'+
      '<button type="button" class="bw-cb-b" data-choice="declined">Decline</button>'+
      '</div></div>';
    document.body.appendChild(banner);
    banner.addEventListener('click',function(e){
      var b=e.target.closest('[data-choice]'); if(!b) return;
      choose(b.getAttribute('data-choice'));
    });
    window.addEventListener('resize',makeRoom);
  }
  function show(focus){
    if(!banner) build();
    banner.hidden=false; makeRoom();
    if(focus){ var b=banner.querySelector('.bw-cb-b'); if(b) b.focus(); }
  }
  function hide(){
    if(!banner) return;
    banner.hidden=true; makeRoom();
    if(lastFocus && document.contains(lastFocus)) { lastFocus.focus(); lastFocus=null; }
  }
  function choose(v){
    setChoice(v); hide();
    if (v==='accepted') { loadTrackers(); }
    else {
      purge();
      // Scripts already running on this page cannot be unloaded, so start the page fresh without them.
      if (loaded) location.reload();
    }
  }

  function init(){
    var c=getChoice();
    if (c==='accepted' && !GPC) loadTrackers();
    else if (c || GPC) purge();
    else show(false);
    document.addEventListener('click',function(e){
      var t=e.target.closest('[data-cookie-settings]'); if(!t) return;
      e.preventDefault(); lastFocus=t; show(true);
    });
  }
  window.bwConsent={open:function(){show(true);},choice:getChoice};
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',init); else init();
})();
