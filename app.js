// XAUUSD 캔들 패턴 알림 (정적 사이트)
// 데이터: Binance 공개 시세 API의 PAXGUSDT (금 현물가를 거의 그대로 추종). CORS 허용, 키 불필요.
const API = 'https://data-api.binance.vision/api/v3/klines?symbol=PAXGUSDT';
const POLL_MS = 10000;

const $ = id => document.getElementById(id);
const LS = 'xau_alert_cfg';
let timer = null, lastAlertKey = null;

// ---------- 설정 저장/복원 ----------
const fields = ['nBull','dojiR','bigK','bigR','tgTok','tgId'];
const checks = ['need1h','sound'];
function loadCfg(){
  try{
    const c = JSON.parse(localStorage.getItem(LS)||'{}');
    fields.forEach(f=>{ if(c[f]!==undefined) $(f).value=c[f]; });
    checks.forEach(f=>{ if(c[f]!==undefined) $(f).checked=c[f]; });
  }catch(e){}
}
function saveCfg(){
  try{
    const c={};
    fields.forEach(f=>c[f]=$(f).value);
    checks.forEach(f=>c[f]=$(f).checked);
    localStorage.setItem(LS,JSON.stringify(c));
  }catch(e){}
}
[...fields,...checks].forEach(f=>$(f).addEventListener('change',saveCfg));
loadCfg();

// ---------- 데이터 ----------
async function klines(interval, limit){
  const r = await fetch(`${API}&interval=${interval}&limit=${limit}`);
  if(!r.ok) throw new Error('HTTP '+r.status);
  const a = await r.json();
  return a.map(k=>({t:k[0],o:+k[1],h:+k[2],l:+k[3],c:+k[4],ct:k[6]}));
}
const body = k=>Math.abs(k.c-k.o);
const range = k=>k.h-k.l;
const bull = k=>k.c>k.o;
const bear = k=>k.c<k.o;

// ---------- 조건 판정 ----------
// ① 1시간봉: 마지막(진행중) 봉이 음봉, 그 직전 N개가 연속 양봉
function check1h(h1, n){
  if(h1.length<n+1) return false;
  const cur = h1[h1.length-1];
  if(!bear(cur)) return false;
  for(let i=2;i<=n+1;i++) if(!bull(h1[h1.length-i])) return false;
  return true;
}
// ② 15분봉: 마감된 마지막 봉 = 장대 음봉, 그 바로 앞 봉 = 음봉 도지
function check15m(m15, cfg){
  // 마지막 요소가 진행중이면 제외하고 마감봉만 사용
  const closed = m15.filter(k=>k.ct < Date.now());
  if(closed.length<16) return {ok:false};
  const big = closed[closed.length-1];
  const doji = closed[closed.length-2];
  const prev = closed.slice(-16,-2);          // 평균 몸통 계산용 14개
  const avg = prev.reduce((s,k)=>s+body(k),0)/prev.length;

  const dojiOk = bear(doji) && range(doji)>0 && body(doji)/range(doji) <= cfg.dojiR;
  const bigOk  = bear(big) && range(big)>0 && body(big) >= avg*cfg.bigK && body(big)/range(big) >= cfg.bigR;
  return {ok: dojiOk && bigOk, key: big.t, big, doji, dojiOk, bigOk, avg};
}

// ---------- 알림 ----------
function beep(){
  try{
    const ctx = new (window.AudioContext||window.webkitAudioContext)();
    [0,0.25,0.5].forEach(d=>{
      const o=ctx.createOscillator(), g=ctx.createGain();
      o.frequency.value=880; o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.3,ctx.currentTime+d);
      g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+d+0.2);
      o.start(ctx.currentTime+d); o.stop(ctx.currentTime+d+0.22);
    });
  }catch(e){}
}
let flashT=null;
function flashTitle(msg){
  clearInterval(flashT);
  const orig='XAUUSD 캔들 알림'; let on=false, n=0;
  flashT=setInterval(()=>{ document.title=on?orig:msg; on=!on; if(++n>20){clearInterval(flashT);document.title=orig;} },800);
}
async function telegram(text){
  const tok=$('tgTok').value.trim(), id=$('tgId').value.trim();
  if(!tok||!id) return;
  try{
    await fetch(`https://api.telegram.org/bot${tok}/sendMessage`,{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({chat_id:id,text})
    });
  }catch(e){ console.warn('telegram fail',e); }
}
function notify(title, text){
  if('Notification' in window && Notification.permission==='granted'){
    try{ new Notification(title,{body:text}); }catch(e){}
  }
  if($('sound').checked) beep();
  flashTitle('🔔 '+title);
  telegram(title+'\n'+text);
}
function addLog(text, hit){
  const box=$('log');
  if(box.querySelector('small')) box.innerHTML='';
  const d=document.createElement('div');
  if(hit) d.className='hit';
  d.textContent = new Date().toLocaleString('ko-KR')+'  '+text;
  box.prepend(d);
}

// ---------- 메인 루프 ----------
function getCfg(){
  return {
    nBull:Math.max(1,parseInt($('nBull').value)||1),
    dojiR:parseFloat($('dojiR').value)||0.3,
    bigK:parseFloat($('bigK').value)||1.5,
    bigR:parseFloat($('bigR').value)||0.6,
  };
}
function setC(id, ok, txtOk='충족', txtNo='미충족'){
  const e=$(id); e.textContent=ok?txtOk:txtNo; e.className=ok?'ok':'no';
}
function spark(m15){
  const s=$('spark'); s.innerHTML='';
  const arr=m15.slice(-24);
  const hi=Math.max(...arr.map(k=>k.h)), lo=Math.min(...arr.map(k=>k.l));
  arr.forEach(k=>{
    const i=document.createElement('i');
    i.style.height=Math.max(3,(body(k)/(hi-lo||1))*60*4)+'px';
    i.style.background=bull(k)?'var(--up)':'var(--dn)';
    s.appendChild(i);
  });
}

async function tick(){
  try{
    const [h1,m15] = await Promise.all([klines('1h',10), klines('15m',40)]);
    const cfg=getCfg();
    const cur=m15[m15.length-1];
    $('price').textContent=cur.c.toFixed(2);
    $('upd').textContent=new Date().toLocaleTimeString('ko-KR');
    spark(m15);

    const c1=check1h(h1,cfg.nBull);
    const r=check15m(m15,cfg);
    setC('c1',c1,'충족 (진행중)');
    setC('c2',r.ok,'충족 (방금 마감)');
    const both=c1&&r.ok;
    setC('c3',both,'🔔 동시 충족');

    const need1h=$('need1h').checked;
    const fire = r.ok && (!need1h || c1);
    if(fire && r.key!==lastAlertKey){
      lastAlertKey=r.key;
      const t=new Date(r.big.t).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'});
      const msg=`15분봉 음봉도지 → 장대음봉 마감 (${t} 봉, 종가 ${r.big.c.toFixed(2)})`+(c1?' / 1시간봉 음봉 진행중':'');
      notify('XAUUSD 패턴 발생',msg);
      addLog(msg,true);
    }
  }catch(e){
    addLog('데이터 오류: '+e.message,false);
  }
}

function start(){
  if('Notification' in window && Notification.permission==='default') Notification.requestPermission();
  if(timer) return;
  saveCfg();
  tick(); timer=setInterval(tick,POLL_MS);
  $('state').textContent='감시중'; $('state').className='badge on';
  $('start').textContent='■ 중지';
}
function stop(){
  clearInterval(timer); timer=null;
  $('state').textContent='중지됨'; $('state').className='badge off';
  $('start').textContent='▶ 감시 시작 / 알림 허용';
}
$('start').addEventListener('click',()=>timer?stop():start());
$('test').addEventListener('click',()=>{
  if('Notification' in window && Notification.permission==='default') Notification.requestPermission();
  notify('알림 테스트','이 알림이 보이면 정상입니다.');
});
setInterval(()=>{ $('clock').textContent=new Date().toLocaleTimeString('ko-KR'); },1000);
