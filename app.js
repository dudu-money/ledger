// 記帳本 — 主程式
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup,
  createUserWithEmailAndPassword, signInWithEmailAndPassword, sendEmailVerification,
  sendPasswordResetEmail, signOut, connectAuthEmulator
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  getFirestore, collection, doc, addDoc, updateDoc, deleteDoc, getDocs, query, where,
  onSnapshot, writeBatch, serverTimestamp, connectFirestoreEmulator
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

/* ================= 常數 ================= */
const COLORS = ["#1d6b52","#2f5fa8","#b0651a","#b23a5a","#6b4fa8","#4f6470"];
const TEMPLATES = {
  "個人": { out:["餐飲","交通","購物","娛樂","美容保養","進修","醫療","人情","其他"], in:["薪資","獎金","投資","兼職","其他收入"] },
  "家庭": { out:["房租房貸","水電瓦斯","網路電話","日常採買","家庭餐費","居家修繕","保險","交通","寵物","孝親","其他"], in:["家用基金","補助","其他收入"] },
  "孕期": { out:["產檢","自費檢查","營養品","孕婦裝","孕婦用品","待產包","生產住院","月子中心","月子餐","媽媽教室","交通","其他"], in:["生育補助","保險理賠","紅包","其他收入"] },
  "寶寶": { out:["奶粉","尿布","副食品","衣物","用品","看診疫苗","玩具繪本","托育保母","其他"], in:["育兒津貼","紅包","其他收入"] },
  "空白": { out:["其他"], in:["其他收入"] }
};
const WK = ["日","一","二","三","四","五","六"];

/* ================= 小工具 ================= */
const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2,"0");
const fmt = n => Math.round(n).toLocaleString("zh-TW");
const money = n => (n<0?"−":"") + "NT$ " + fmt(Math.abs(n));
const todayStr = () => { const d=new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; };
const rid = () => Math.random().toString(36).slice(2,10);
const el = (tag, cls, text) => { const e=document.createElement(tag); if(cls) e.className=cls; if(text!=null) e.textContent=text; return e; };
function msg(id, text, kind){ const m=$(id); m.textContent=text||""; m.className="msg"+(kind?" "+kind:""); }
let toastTimer;
function toast(text){ const t=$("toast"); t.textContent=text; t.hidden=false; clearTimeout(toastTimer); toastTimer=setTimeout(()=>t.hidden=true,2400); }
const errText = e => {
  const c = e && e.code || "";
  const map = {
    "auth/invalid-credential":"Email 或密碼不正確。", "auth/wrong-password":"Email 或密碼不正確。",
    "auth/user-not-found":"找不到這個帳號，請先註冊。", "auth/email-already-in-use":"這個 Email 已經註冊過了，請直接登入。",
    "auth/weak-password":"密碼至少要 6 個字元。", "auth/invalid-email":"Email 格式不正確。",
    "auth/popup-closed-by-user":"登入視窗被關掉了，請再試一次。", "auth/popup-blocked":"瀏覽器擋住了登入視窗，請允許彈出視窗後再試。",
    "auth/too-many-requests":"嘗試太多次了，請稍後再試。", "auth/network-request-failed":"網路連線有問題，請確認後再試。",
    "permission-denied":"沒有權限做這個動作。", "unavailable":"目前連不上伺服器，請確認網路。"
  };
  return map[c] || (e && e.message) || "發生錯誤，請再試一次。";
};

/* ================= Firebase ================= */
const configured = firebaseConfig && firebaseConfig.apiKey && !String(firebaseConfig.apiKey).includes("請貼上");
let auth, db;
if(configured){
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app); auth.languageCode = "zh-TW";
  db = getFirestore(app);
  // 本機測試：網址加上 ?emulator 會連到 Firebase 模擬器
  if(["localhost","127.0.0.1"].includes(location.hostname) && new URLSearchParams(location.search).has("emulator")){
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings:true });
    connectFirestoreEmulator(db, "127.0.0.1", 8080);
  }
}

/* ================= 狀態 ================= */
const S = {
  user:null, email:"",
  ledgers:new Map(), unsubLedgers:null,
  lid:null, period:{ mode:"month", y:new Date().getFullYear(), m:new Date().getMonth()+1 },
  entries:[], unsubEntries:null, entriesReady:false,
  catView:"out", catFilter:null,
  // 表單
  eType:"out", eCat:null, editing:null,
  newTpl:"個人", newColor:COLORS[0], newCats:{out:[],in:[]}, newCatType:"out",
  sColor:COLORS[0], sCatType:"out"
};
const L = () => S.ledgers.get(S.lid);
const isOwner = l => l && S.user && l.ownerUid === S.user.uid;
const canEdit = l => l && (isOwner(l) || (l.editors||[]).includes(S.email));
const roleText = l => isOwner(l) ? "擁有者" : canEdit(l) ? "可編輯" : "僅檢視";

/* ================= 畫面切換 ================= */
const VIEWS = ["viewSetup","viewLoading","viewLogin","viewVerify","viewHome","viewLedger"];
function show(v){ VIEWS.forEach(id=>$(id).hidden = id!==v); }

if(!configured){ show("viewSetup"); }
else {
  onAuthStateChanged(auth, async user => {
    stopLedgers(); stopEntries();
    S.user = user; S.email = user && user.email ? user.email.toLowerCase() : "";
    if(!user){ show("viewLogin"); return; }
    if(!user.emailVerified){ $("verifyEmail").textContent=user.email; show("viewVerify"); return; }
    $("whoEmail").textContent = user.email;
    watchLedgers();
    route();
  });
}
window.addEventListener("hashchange", ()=>{ if(S.user && S.user.emailVerified) route(); });

function route(){
  const m = location.hash.match(/^#l\/([A-Za-z0-9_-]+)/);
  if(m){ openLedger(m[1]); } else { S.lid=null; stopEntries(); document.title="記帳本"; show("viewHome"); renderHome(); }
}

/* ================= 登入 ================= */
$("btnGoogle").onclick = async () => {
  msg("loginMsg","");
  try{ await signInWithPopup(auth, new GoogleAuthProvider()); }
  catch(e){ msg("loginMsg", errText(e), "err"); }
};
$("formEmail").addEventListener("submit", async e => {
  e.preventDefault(); msg("loginMsg","");
  try{ await signInWithEmailAndPassword(auth, $("inEmail").value.trim(), $("inPass").value); }
  catch(err){ msg("loginMsg", errText(err), "err"); }
});
$("btnSignup").onclick = async () => {
  msg("loginMsg","");
  const em=$("inEmail").value.trim(), pw=$("inPass").value;
  if(!em || pw.length<6){ msg("loginMsg","請填 Email，密碼至少 6 個字元。","err"); return; }
  try{ const cred=await createUserWithEmailAndPassword(auth, em, pw); await sendEmailVerification(cred.user); }
  catch(err){ msg("loginMsg", errText(err), "err"); }
};
$("btnForgot").onclick = async () => {
  const em=$("inEmail").value.trim();
  if(!em){ msg("loginMsg","請先在上面填入 Email。","err"); return; }
  try{ await sendPasswordResetEmail(auth, em); msg("loginMsg","已寄出重設密碼信，請到信箱查看。","ok"); }
  catch(err){ msg("loginMsg", errText(err), "err"); }
};
$("btnVerified").onclick = async () => {
  await auth.currentUser.reload();
  if(auth.currentUser.emailVerified){
    await auth.currentUser.getIdToken(true);
    S.user = auth.currentUser; S.email = S.user.email.toLowerCase();
    $("whoEmail").textContent = S.user.email; watchLedgers(); route();
  } else msg("verifyMsg","還沒收到驗證，請點信裡的連結後再按一次。","err");
};
$("btnResend").onclick = async () => {
  try{ await sendEmailVerification(auth.currentUser); msg("verifyMsg","已重新寄出驗證信。","ok"); }
  catch(e){ msg("verifyMsg", errText(e), "err"); }
};
$("btnLogout").onclick = $("btnLogout2").onclick = () => { location.hash=""; signOut(auth); };

/* ================= 帳本列表 ================= */
function watchLedgers(){
  stopLedgers();
  const q = query(collection(db,"ledgers"), where("members","array-contains", S.email));
  S.ledgersReady = false;
  S.unsubLedgers = onSnapshot(q, snap => {
    S.ledgers = new Map(snap.docs.map(d=>[d.id, {id:d.id, ...d.data()}]));
    S.ledgersReady = true;
    if(S.lid){
      if(!S.ledgers.has(S.lid)){ toast("你已經看不到這本帳了"); S.lid=null; stopEntries(); location.hash=""; return; }
      renderLedgerHead(); renderAll();
      if($("dlgSettings").open) renderSettings(false);
    } else renderHome();
  }, e => msg("homeMsg", "讀取帳本失敗：" + errText(e), "err"));
}
function stopLedgers(){ if(S.unsubLedgers){ S.unsubLedgers(); S.unsubLedgers=null; } S.ledgers=new Map(); }

function renderHome(){
  const mine=[], shared=[];
  [...S.ledgers.values()].sort((a,b)=>a.name.localeCompare(b.name,"zh-Hant")).forEach(l => (isOwner(l)?mine:shared).push(l));
  const box=$("myLedgers"); box.textContent="";
  if(!S.ledgersReady){ box.appendChild(el("div","empty","讀取中…")); }
  else if(!mine.length){
    const e=el("div","empty"); e.appendChild(el("strong",null,"還沒有帳本"));
    e.appendChild(document.createTextNode("按「新增帳本」，可以從個人、家庭、孕期、寶寶範本開始，也可以建一本空白的自己設計分類。"));
    box.appendChild(e);
  }
  mine.forEach(l=>box.appendChild(ledgerCard(l)));
  $("sharedWrap").hidden = !shared.length;
  const sb=$("sharedLedgers"); sb.textContent="";
  shared.forEach(l=>sb.appendChild(ledgerCard(l)));
}
function ledgerCard(l){
  const b=el("button","lcard"); b.type="button"; b.onclick=()=>{ location.hash="#l/"+l.id; };
  const n=el("div","name"); const d=el("span","dot"); d.style.background=l.color||COLORS[0]; n.append(d, document.createTextNode(l.name));
  const others=(l.members||[]).length-1;
  const meta=el("div","meta", isOwner(l) ? (others>0?`與 ${others} 人共用`:"只有你看得到") : `${l.ownerEmail} 分享・${roleText(l)}`);
  const cats=el("div","meta", `${(l.categories||[]).length} 個分類` + (l.budget?`・每月預算 ${money(l.budget)}`:""));
  b.append(n, meta, cats); return b;
}

/* ================= 新增帳本 ================= */
function renderNewCats(){
  $("ncOut").setAttribute("aria-pressed", S.newCatType==="out"); $("ncIn").setAttribute("aria-pressed", S.newCatType==="in");
  const box=$("nCatList"); box.textContent="";
  const list=S.newCats[S.newCatType];
  if(!list.length) box.appendChild(el("span","small muted", S.newCatType==="out"?"還沒有支出分類，請在下面新增。":"還沒有收入分類，請在下面新增。"));
  list.forEach((n,i)=>{ const b=el("button","chip rm"); b.type="button"; b.title="移除「"+n+"」";
    b.append(document.createTextNode(n), el("span","x","✕"));
    b.onclick=()=>{ list.splice(i,1); renderNewCats(); }; box.appendChild(b); });
}
function addNewCat(){
  const n=$("nNewCat").value.trim(); if(!n) return;
  const list=S.newCats[S.newCatType];
  if(list.includes(n)){ msg("nMsg","已經有「"+n+"」了。","err"); return; }
  if(S.newCats.out.length+S.newCats.in.length>=200){ msg("nMsg","分類最多 200 個。","err"); return; }
  list.push(n); $("nNewCat").value=""; msg("nMsg",""); renderNewCats(); $("nNewCat").focus();
}
$("ncOut").onclick=()=>{ S.newCatType="out"; renderNewCats(); };
$("ncIn").onclick=()=>{ S.newCatType="in"; renderNewCats(); };
$("nAddCat").onclick=addNewCat;
$("nNewCat").addEventListener("keydown", e=>{ if(e.key==="Enter"){ e.preventDefault(); addNewCat(); } });
function renderNewDialog(){
  const t=$("nTemplates"); t.textContent="";
  Object.keys(TEMPLATES).forEach(k=>{
    const c=el("button","chip",k); c.type="button"; c.setAttribute("aria-pressed", k===S.newTpl);
    c.onclick=()=>{ const prevAuto = !$("nName").value || Object.keys(TEMPLATES).some(x=>$("nName").value===x+"開銷");
      S.newTpl=k; S.newCats={ out:[...TEMPLATES[k].out], in:[...TEMPLATES[k].in] }; if(prevAuto) $("nName").value = k==="空白" ? "" : k+"開銷"; renderNewDialog(); };
    t.appendChild(c);
  });
  renderNewCats();
  swatches("nColors", S.newColor, c=>{ S.newColor=c; renderNewDialog(); });
}
function swatches(boxId, current, onPick, disabled){
  const box=$(boxId); box.textContent="";
  COLORS.forEach(c=>{ const s=el("button","swatch"); s.type="button"; s.style.background=c; s.setAttribute("aria-label","顏色 "+c);
    s.setAttribute("aria-pressed", c===current); s.disabled=!!disabled; s.onclick=()=>onPick(c); box.appendChild(s); });
}
$("btnNewLedger").onclick = () => {
  S.newTpl="個人"; S.newCats={ out:[...TEMPLATES["個人"].out], in:[...TEMPLATES["個人"].in] }; S.newCatType="out"; $("nNewCat").value=""; S.newColor=COLORS[S.ledgers.size % COLORS.length]; $("nName").value="個人開銷"; msg("nMsg","");
  renderNewDialog(); $("dlgNew").showModal();
};
$("formNew").addEventListener("submit", async e => {
  if(e.submitter && e.submitter.value==="cancel") return;
  e.preventDefault();
  const name=$("nName").value.trim();
  if(!name){ msg("nMsg","請輸入帳本名稱。","err"); return; }
  if(!S.newCats.out.length && !S.newCats.in.length){ msg("nMsg","請至少保留一個分類。","err"); return; }
  const categories=[...S.newCats.out.map(n=>({id:rid(),name:n,type:"out"})), ...S.newCats.in.map(n=>({id:rid(),name:n,type:"in"}))];
  $("nCreate").disabled=true;
  try{
    const ref=await addDoc(collection(db,"ledgers"), {
      name, color:S.newColor, ownerUid:S.user.uid, ownerEmail:S.email,
      editors:[], viewers:[], members:[S.email], categories, budget:0,
      createdAt:serverTimestamp(), updatedAt:serverTimestamp()
    });
    $("dlgNew").close(); location.hash="#l/"+ref.id;
  }catch(err){ msg("nMsg","建立失敗："+errText(err),"err"); }
  finally{ $("nCreate").disabled=false; }
});

/* ================= 帳本頁 ================= */
function openLedger(id){
  const changed = S.lid !== id;
  S.lid=id; show("viewLedger");
  if(changed){ S.catFilter=null; $("search").value=""; const d=new Date(); S.period={mode:"month",y:d.getFullYear(),m:d.getMonth()+1}; }
  if(!S.ledgers.has(id)){
    if(S.ledgersReady){ toast("找不到這本帳，或你沒有權限"); location.hash=""; }
    return; // 等帳本列表載入後會再呼叫
  }
  if(changed) stopEntries();
  renderLedgerHead(); // 沒有訂閱時會開始讀取紀錄
}
function renderLedgerHead(){
  const l=L(); if(!l) return;
  $("lName").textContent=l.name; $("lDot").style.background=l.color||COLORS[0];
  $("lRole").textContent=roleText(l); document.title=l.name+"｜記帳本";
  $("btnAdd").hidden=!canEdit(l);
  if(!S.unsubEntries) watchEntries();
}
$("btnBack").onclick=()=>{ location.hash=""; };

function periodRange(){
  const {mode,y,m}=S.period;
  if(mode==="year") return [`${y}-01-01`,`${y}-12-31`];
  const dim=new Date(y,m,0).getDate(); return [`${y}-${pad(m)}-01`,`${y}-${pad(m)}-${pad(dim)}`];
}
function watchEntries(){
  stopEntries();
  if(!S.lid || !S.ledgers.has(S.lid)) return;
  const [a,b]=periodRange();
  S.entriesReady=false; renderAll();
  const q=query(collection(db,"ledgers",S.lid,"entries"), where("date",">=",a), where("date","<=",b));
  const token = S.entriesToken = {}; // 切換期間後，忽略舊的回呼
  S.unsubEntries=onSnapshot(q, snap=>{
    if(token!==S.entriesToken) return;
    S.entries=snap.docs.map(d=>({id:d.id, ...d.data()})); S.entriesReady=true; renderAll();
  }, e=>{ if(token!==S.entriesToken) return; S.entriesReady=true; renderAll(); toast("讀取紀錄失敗："+errText(e)); });
}
function stopEntries(){ S.entriesToken=null; if(S.unsubEntries){ S.unsubEntries(); S.unsubEntries=null; } S.entries=[]; }

/* 期間切換 */
function setMode(m){ S.period.mode=m; S.catFilter=null; watchEntries(); }
$("pMonth").onclick=()=>setMode("month");
$("pYear").onclick=()=>setMode("year");
$("pPrev").onclick=()=>shiftPeriod(-1);
$("pNext").onclick=()=>shiftPeriod(1);
$("pNow").onclick=()=>{ const d=new Date(); S.period={mode:"month",y:d.getFullYear(),m:d.getMonth()+1}; S.catFilter=null; watchEntries(); };
function shiftPeriod(d){
  const p=S.period;
  if(p.mode==="year") p.y+=d;
  else { p.m+=d; if(p.m<1){p.m=12;p.y--;} if(p.m>12){p.m=1;p.y++;} }
  S.catFilter=null; watchEntries();
}
$("cOut").onclick=()=>{ S.catView="out"; S.catFilter=null; renderAll(); };
$("cIn").onclick=()=>{ S.catView="in"; S.catFilter=null; renderAll(); };
$("search").addEventListener("input", renderList);
$("filterClear").onclick=()=>{ S.catFilter=null; renderAll(); };

const catName = (l, e) => { const c=(l.categories||[]).find(c=>c.id===e.categoryId); return c ? c.name : (e.categoryName||"未分類"); };

function renderAll(){
  const l=L(); if(!l) return;
  const {mode,y,m}=S.period;
  const isYear = mode==="year";
  $("pMonth").setAttribute("aria-pressed", !isYear); $("pYear").setAttribute("aria-pressed", isYear);
  $("pTitle").textContent = isYear ? `${y} 年` : `${y} 年 ${m} 月`;
  const now=new Date(); const isNow = isYear ? y===now.getFullYear() : (y===now.getFullYear() && m===now.getMonth()+1);
  $("pNow").hidden = isNow && !isYear;
  $("pNow").textContent = "回到本月";
  $("cOut").setAttribute("aria-pressed", S.catView==="out"); $("cIn").setAttribute("aria-pressed", S.catView==="in");
  renderTotals(l); renderCats(l); renderTrend(l);
  $("listPanel").hidden = isYear; $("yearPanel").hidden = !isYear;
  if(isYear) renderYearTable(); else renderList();
}

function renderTotals(l){
  let o=0,i=0; S.entries.forEach(e=>{ if(e.type==="in") i+=e.amount; else o+=e.amount; });
  const isYear=S.period.mode==="year";
  $("balLabel").textContent = isYear ? "全年結餘" : "本月結餘";
  $("tBal").textContent = S.entriesReady ? money(i-o) : "…";
  $("tBal").className = "num big" + (i-o<0?" c-out":"");
  $("tOut").textContent=fmt(o); $("tIn").textContent=fmt(i);
  const budget = (l.budget||0) * (isYear?12:1);
  $("bLabel").textContent = isYear ? "全年預算（每月 × 12）" : "每月預算";
  $("bVal").textContent = budget ? money(budget) : "未設定";
  const meter=$("bMeter"), bar=meter.firstElementChild;
  if(budget>0){
    const r=o/budget; bar.style.width=Math.min(100,r*100)+"%";
    meter.className="meter"+(r>1?" over":r>.85?" warn":"");
    const left=budget-o;
    $("bLeft").textContent = left>=0 ? `還剩 ${money(left)}` : `已超支 ${money(-left)}`;
    const now=new Date(), {y,m}=S.period;
    if(!isYear && y===now.getFullYear() && m===now.getMonth()+1 && left>0){
      const rest=new Date(y,m,0).getDate()-now.getDate()+1; $("bExtra").textContent=`每天可花 ${fmt(left/rest)}`;
    } else $("bExtra").textContent=`已用 ${Math.round(r*100)}%`;
  } else {
    bar.style.width="0"; meter.className="meter";
    $("bLeft").textContent = canEdit(l) ? "可在「設定」裡設定每月預算" : ""; $("bExtra").textContent="";
  }
}

function renderCats(l){
  const box=$("catList"); box.textContent="";
  const sums=new Map(); let tot=0;
  S.entries.filter(e=>e.type===S.catView).forEach(e=>{
    const k=e.categoryId; const cur=sums.get(k)||{name:catName(l,e),v:0}; cur.v+=e.amount; sums.set(k,cur); tot+=e.amount; });
  const rows=[...sums.entries()].sort((a,b)=>b[1].v-a[1].v);
  if(!rows.length){ box.appendChild(el("p","small muted", S.entriesReady ? (S.catView==="out"?"這段期間還沒有支出。":"這段期間還沒有收入。") : "讀取中…")); return; }
  const max=rows[0][1].v, isMonth=S.period.mode==="month";
  rows.forEach(([id,{name,v}])=>{
    const r=el(isMonth?"button":"div","cat-row"); if(isMonth){ r.type="button"; r.setAttribute("aria-pressed", S.catFilter===id); r.title="只看這個分類的明細";
      r.onclick=()=>{ S.catFilter = S.catFilter===id ? null : id; renderCats(l); renderList(); }; }
    const bar=el("div","cat-bar"+(S.catView==="in"?" in":"")); const i=el("i"); i.style.width=(v/max*100)+"%"; bar.appendChild(i);
    const n=el("span","num",fmt(v)); n.appendChild(el("span","pct",Math.round(v/tot*100)+"%"));
    r.append(el("span","nm",name), bar, n); box.appendChild(r);
  });
  const t=el("div","between small muted"); t.style.padding="6px 6px 0"; t.append(el("span",null,"合計"), el("span","num",money(tot))); box.appendChild(t);
}

function niceMax(v){ if(v<=0) return 100; const p=Math.pow(10,Math.floor(Math.log10(v))); for(const k of [1,2,2.5,5,10]) if(k*p>=v) return k*p; return 10*p; }
const tick = v => v>=10000 ? (v/10000)+"萬" : v>=1000 ? (v/1000)+"k" : String(v);
function renderTrend(){
  const {mode,y,m}=S.period, W=Math.max(320,Math.min(640,$("trend").clientWidth||640)), H=Math.round(W*.36)+20, Lp=42,R=6,T=12,B=26;
  let s=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${mode==="year"?"每月收支長條圖":"每日支出長條圖"}">`;
  const grid = mx => { for(let k=0;k<=4;k++){ const v=mx*k/4, yy=T+(H-T-B)*(1-k/4);
    s+=`<line x1="${Lp}" x2="${W-R}" y1="${yy}" y2="${yy}" stroke="var(--rule)" stroke-width="1"/>`;
    s+=`<text x="${Lp-6}" y="${yy+4}" text-anchor="end" font-size="11" fill="var(--muted)" font-family="var(--f-num)">${tick(v)}</text>`; } };
  if(mode==="month"){
    $("trendTitle").textContent="每日支出";
    const dim=new Date(y,m,0).getDate(), d=new Array(dim).fill(0);
    S.entries.forEach(e=>{ if(e.type==="out"){ const k=Number(e.date.slice(8,10))-1; if(k>=0&&k<dim) d[k]+=e.amount; } });
    const tot=d.reduce((a,b)=>a+b,0), now=new Date(), isCur=now.getFullYear()===y&&now.getMonth()+1===m;
    $("trendNote").textContent = tot ? `日均 ${money(tot/(isCur?now.getDate():dim))}` : "";
    const mx=niceMax(Math.max(...d)), cw=(W-Lp-R)/dim, yv=v=>T+(H-T-B)*(1-v/mx);
    grid(mx);
    d.forEach((v,k)=>{ const today=isCur&&k===now.getDate()-1;
      if(v>0) s+=`<rect x="${Lp+k*cw+cw*.18}" y="${yv(v)}" width="${cw*.64}" height="${yv(0)-yv(v)}" rx="1.5" fill="${today?"var(--accent)":"var(--out)"}" opacity="${today?1:.82}"><title>${m}/${k+1}：${money(v)}</title></rect>`;
      if(k===0||(k+1)%5===0) s+=`<text x="${Lp+k*cw+cw/2}" y="${H-9}" text-anchor="middle" font-size="11" fill="var(--muted)" font-family="var(--f-num)">${k+1}</text>`; });
  } else {
    $("trendTitle").textContent="每月收支";
    const o=new Array(12).fill(0), i=new Array(12).fill(0);
    S.entries.forEach(e=>{ const k=Number(e.date.slice(5,7))-1; (e.type==="in"?i:o)[k]+=e.amount; });
    const months=o.filter(v=>v>0).length;
    $("trendNote").innerHTML = `<span class="legend"><span><i style="background:var(--out)"></i>支出</span><span><i style="background:var(--in)"></i>收入</span>${months?`<span>月均支出 ${money(o.reduce((a,b)=>a+b,0)/months)}</span>`:""}</span>`;
    const mx=niceMax(Math.max(...o,...i)), cw=(W-Lp-R)/12, yv=v=>T+(H-T-B)*(1-v/mx), bw=cw*.32;
    grid(mx);
    for(let k=0;k<12;k++){ const x=Lp+k*cw+cw*.16;
      if(o[k]>0) s+=`<rect x="${x}" y="${yv(o[k])}" width="${bw}" height="${yv(0)-yv(o[k])}" rx="1.5" fill="var(--out)" opacity=".85"><title>${k+1} 月支出：${money(o[k])}</title></rect>`;
      if(i[k]>0) s+=`<rect x="${x+bw+2}" y="${yv(i[k])}" width="${bw}" height="${yv(0)-yv(i[k])}" rx="1.5" fill="var(--in)" opacity=".85"><title>${k+1} 月收入：${money(i[k])}</title></rect>`;
      s+=`<text x="${Lp+k*cw+cw/2}" y="${H-9}" text-anchor="middle" font-size="11" fill="var(--muted)" font-family="var(--f-num)">${k+1}月</text>`; }
  }
  $("trend").innerHTML=s+"</svg>";
}

function renderList(){
  const l=L(); if(!l) return;
  const box=$("list"); box.textContent="";
  const q=$("search").value.trim().toLowerCase();
  let list=S.entries.slice().sort((a,b)=> b.date.localeCompare(a.date) || ((b.createdAt?.seconds||9e9)-(a.createdAt?.seconds||9e9)));
  if(S.catFilter) list=list.filter(e=>e.categoryId===S.catFilter);
  if(q) list=list.filter(e=>((e.note||"")+" "+catName(l,e)+" "+(e.pay||"")).toLowerCase().includes(q));
  $("countNote").textContent = S.entries.length ? `${S.entries.length} 筆` : "";
  $("filterBar").hidden = !S.catFilter;
  if(S.catFilter){ const c=(l.categories||[]).find(c=>c.id===S.catFilter); const e=S.entries.find(e=>e.categoryId===S.catFilter);
    $("filterText").textContent = "只顯示：" + (c?c.name:(e?e.categoryName:"")); }
  if(!list.length){
    const e=el("div","empty");
    if(!S.entriesReady) e.textContent="讀取中…";
    else if(q||S.catFilter) e.textContent="找不到符合的紀錄。";
    else { e.appendChild(el("strong",null,"這個月還沒有紀錄")); e.appendChild(document.createTextNode(canEdit(l)?"按右下角「＋ 記一筆」開始記帳。":"擁有者或可編輯的人記帳後，會顯示在這裡。")); }
    box.appendChild(e); return;
  }
  const shared=(l.members||[]).length>1, editable=canEdit(l);
  const groups=new Map(); list.forEach(e=>{ if(!groups.has(e.date)) groups.set(e.date,[]); groups.get(e.date).push(e); });
  groups.forEach((g,date)=>{
    const dt=new Date(date+"T00:00"); const out=g.filter(e=>e.type==="out").reduce((a,e)=>a+e.amount,0);
    const day=el("div","day"); const h=el("div","day-head");
    h.append(el("span",null,`${dt.getMonth()+1} 月 ${dt.getDate()} 日（${WK[dt.getDay()]}）`), el("span","num",out?"支出 "+fmt(out):""));
    day.appendChild(h);
    g.forEach(e=>{
      const row=el("button","entry"); row.type="button"; row.disabled=!editable; if(editable) row.onclick=()=>openEntry(e);
      const main=el("div"); main.appendChild(el("div","note", e.note || catName(l,e)));
      const meta=[e.pay]; if(shared && e.createdByEmail) meta.push(e.createdByEmail===S.email?"我記的":e.createdByEmail.split("@")[0]+" 記的");
      main.appendChild(el("div","meta", meta.filter(Boolean).join("・")));
      row.append(el("span","tag"+(e.type==="in"?" in":""), catName(l,e)), main,
        el("span","num "+(e.type==="in"?"c-in":"c-out"), (e.type==="in"?"+":"−")+fmt(e.amount)));
      day.appendChild(row);
    });
    box.appendChild(day);
  });
}

function renderYearTable(){
  const o=new Array(12).fill(0), i=new Array(12).fill(0), n=new Array(12).fill(0);
  S.entries.forEach(e=>{ const k=Number(e.date.slice(5,7))-1; (e.type==="in"?i:o)[k]+=e.amount; n[k]++; });
  const t=$("ytable"); t.textContent="";
  const th=el("thead"), hr=el("tr"); ["月份","筆數","支出","收入","結餘"].forEach(x=>hr.appendChild(el("th",null,x))); th.appendChild(hr);
  const tb=el("tbody");
  for(let k=0;k<12;k++){
    const r=el("tr"); r.title="查看這個月"; r.tabIndex=0;
    const go=()=>{ S.period={mode:"month",y:S.period.y,m:k+1}; S.catFilter=null; watchEntries(); };
    r.onclick=go; r.onkeydown=ev=>{ if(ev.key==="Enter") go(); };
    r.append(el("td",null,`${k+1} 月`), el("td","num",n[k]||"—"), el("td","num c-out",o[k]?fmt(o[k]):"—"), el("td","num c-in",i[k]?fmt(i[k]):"—"),
      el("td","num"+(i[k]-o[k]<0?" c-out":""), (o[k]||i[k])?fmt(i[k]-o[k]):"—"));
    tb.appendChild(r);
  }
  const tf=el("tfoot"), fr=el("tr"); const so=o.reduce((a,b)=>a+b,0), si=i.reduce((a,b)=>a+b,0);
  fr.append(el("td",null,"合計"), el("td","num",n.reduce((a,b)=>a+b,0)), el("td","num c-out",fmt(so)), el("td","num c-in",fmt(si)), el("td","num"+(si-so<0?" c-out":""),fmt(si-so)));
  tf.appendChild(fr); t.append(th,tb,tf);
}

/* CSV 匯出 */
function exportCsv(){
  const l=L(); if(!l || !S.entries.length){ toast("這段期間沒有紀錄可以匯出"); return; }
  const esc=v=>{ v=String(v??""); return /[",\n]/.test(v) ? '"'+v.replace(/"/g,'""')+'"' : v; };
  const rows=[["日期","類型","分類","金額","付款方式","備註","記錄者"]].concat(
    S.entries.slice().sort((a,b)=>a.date.localeCompare(b.date)).map(e=>[e.date, e.type==="in"?"收入":"支出", catName(l,e), e.amount, e.pay, e.note, e.createdByEmail]));
  const csv="﻿"+rows.map(r=>r.map(esc).join(",")).join("\r\n");
  const {mode,y,m}=S.period;
  const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));
  a.download=`${l.name}_${mode==="year"?y:`${y}-${pad(m)}`}.csv`; document.body.appendChild(a); a.click();
  setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
$("btnExport").onclick=exportCsv; $("btnExportY").onclick=exportCsv;

/* ================= 記一筆 ================= */
function renderEntryCats(){
  const l=L(); const box=$("eCats"); box.textContent="";
  const list=(l.categories||[]).filter(c=>c.type===S.eType);
  if(S.editing && S.eCat && !list.some(c=>c.id===S.eCat.id)) list.push(S.eCat); // 已刪除的舊分類
  if(!S.eCat || !list.some(c=>c.id===S.eCat.id)) S.eCat=list[0]||null;
  if(!list.length){ box.appendChild(el("span","small muted","還沒有分類，請到「設定」新增。")); return; }
  list.forEach(c=>{ const b=el("button","chip",c.name); b.type="button"; b.setAttribute("aria-pressed", S.eCat&&c.id===S.eCat.id);
    b.onclick=()=>{ S.eCat=c; renderEntryCats(); }; box.appendChild(b); });
}
function setEType(t){ S.eType=t; $("eOut").setAttribute("aria-pressed",t==="out"); $("eIn").setAttribute("aria-pressed",t==="in"); renderEntryCats(); }
$("eOut").onclick=()=>setEType("out"); $("eIn").onclick=()=>setEType("in");

function defaultDate(){
  const {mode,y,m}=S.period, now=new Date();
  if(mode==="month" && !(y===now.getFullYear() && m===now.getMonth()+1)) return `${y}-${pad(m)}-01`;
  return todayStr();
}
function openEntry(e){
  const l=L(); if(!canEdit(l)) return;
  S.editing=e||null; msg("eMsg","");
  $("eTitle").textContent = e ? "編輯紀錄" : "記一筆";
  $("eDelete").hidden=!e; $("eDelete").textContent="刪除"; $("eDelete").dataset.armed="";
  S.eCat = e ? ((l.categories||[]).find(c=>c.id===e.categoryId) || {id:e.categoryId,name:e.categoryName,type:e.type}) : null;
  setEType(e ? e.type : "out");
  $("eAmount").value = e ? e.amount : "";
  $("eDate").value = e ? e.date : defaultDate();
  $("ePay").value = e ? (e.pay||"現金") : ($("ePay").dataset.last||"現金");
  $("eNote").value = e ? (e.note||"") : "";
  $("eBy").hidden = !(e && e.createdByEmail && (l.members||[]).length>1);
  if(e && e.createdByEmail) $("eBy").textContent = "由 " + e.createdByEmail + " 記錄";
  $("dlgEntry").showModal();
  setTimeout(()=>$("eAmount").focus(), 50);
}
$("btnAdd").onclick=()=>openEntry(null);

$("formEntry").addEventListener("submit", async ev=>{
  if(ev.submitter && ev.submitter.value==="cancel") return;
  ev.preventDefault();
  const l=L(); const amt=Math.round(Number($("eAmount").value));
  if(!amt || amt<=0){ msg("eMsg","請輸入大於 0 的金額。","err"); $("eAmount").focus(); return; }
  if(!S.eCat){ msg("eMsg","請先選一個分類。","err"); return; }
  const date=$("eDate").value; if(!/^\d{4}-\d{2}-\d{2}$/.test(date)){ msg("eMsg","請選擇日期。","err"); return; }
  const data={ type:S.eType, amount:amt, categoryId:S.eCat.id, categoryName:S.eCat.name, date,
    note:$("eNote").value.trim().slice(0,100), pay:$("ePay").value, updatedAt:serverTimestamp() };
  $("ePay").dataset.last=data.pay;
  $("eSave").disabled=true;
  try{
    if(S.editing){ await updateDoc(doc(db,"ledgers",l.id,"entries",S.editing.id), data); toast("已更新"); }
    else { await addDoc(collection(db,"ledgers",l.id,"entries"), {...data, createdBy:S.user.uid, createdByEmail:S.email, createdAt:serverTimestamp()});
      const [a,b]=periodRange(); toast(`已記下：${S.eCat.name} ${money(amt)}` + (date<a||date>b ? `（記在 ${date.slice(0,7).replace("-"," 年 ")} 月）`:"")); }
    $("dlgEntry").close();
  }catch(err){ msg("eMsg","儲存失敗："+errText(err),"err"); }
  finally{ $("eSave").disabled=false; }
});
$("eDelete").onclick=async()=>{
  const b=$("eDelete");
  if(!b.dataset.armed){ b.dataset.armed="1"; b.textContent="確定刪除？"; return; }
  try{ await deleteDoc(doc(db,"ledgers",S.lid,"entries",S.editing.id)); $("dlgEntry").close(); toast("已刪除"); }
  catch(err){ msg("eMsg","刪除失敗："+errText(err),"err"); }
};

/* ================= 設定 ================= */
$("btnSettings").onclick=()=>{ renderSettings(true); $("dlgSettings").showModal(); };
$("sClose").onclick=()=>$("dlgSettings").close();
function renderSettings(resetInputs){
  const l=L(); if(!l) return;
  const owner=isOwner(l), editor=canEdit(l);
  if(resetInputs){
    $("sName").value=l.name; $("sBudget").value=l.budget||0; S.sColor=l.color||COLORS[0];
    ["sBasicMsg","sCatMsg","sShareMsg","sDangerMsg"].forEach(id=>msg(id,"")); $("sDelConfirm").value=""; $("sEmail").value="";
  }
  $("sName").disabled=!owner; $("sBudget").disabled=!editor; $("sSaveBasic").hidden=!editor;
  swatches("sColors", S.sColor, c=>{ S.sColor=c; renderSettings(false); }, !owner);
  // 分類
  $("sCats").hidden=!editor;
  $("scOut").setAttribute("aria-pressed", S.sCatType==="out"); $("scIn").setAttribute("aria-pressed", S.sCatType==="in");
  const box=$("sCatList"); box.textContent="";
  (l.categories||[]).filter(c=>c.type===S.sCatType).forEach(c=>{
    const r=el("div","row"); const inp=el("input"); inp.type="text"; inp.maxLength=40; inp.value=c.name; inp.setAttribute("aria-label","分類名稱");
    inp.onchange=()=>saveCats(cs=>cs.map(x=>x.id===c.id?{...x,name:inp.value.trim()||x.name}:x), "已改名");
    const del=el("button","btn","刪除"); del.type="button";
    del.onclick=()=>{ if(!del.dataset.armed){ del.dataset.armed="1"; del.textContent="確定？"; del.classList.add("danger"); return; }
      saveCats(cs=>cs.filter(x=>x.id!==c.id), "已刪除分類"); };
    r.append(inp,del); box.appendChild(r);
  });
  // 分享
  $("sShare").hidden=!owner;
  if(owner){
    const mb=$("sMembers"); mb.textContent="";
    const me=el("div","member"); me.append(el("span","em",l.ownerEmail+"（你）"), el("span","badge","擁有者")); mb.appendChild(me);
    [...(l.editors||[]).map(e=>[e,"editor"]), ...(l.viewers||[]).map(e=>[e,"viewer"])].forEach(([em,role])=>{
      const r=el("div","member"); const sel=el("select"); sel.setAttribute("aria-label",em+" 的權限");
      [["editor","可編輯"],["viewer","僅檢視"]].forEach(([v,t])=>{ const o=el("option",null,t); o.value=v; o.selected=v===role; sel.appendChild(o); });
      sel.onchange=()=>setMember(em, sel.value);
      const rm=el("button","btn","移除"); rm.type="button";
      rm.onclick=()=>{ if(!rm.dataset.armed){ rm.dataset.armed="1"; rm.textContent="確定移除？"; rm.classList.add("danger"); return; } setMember(em,null); };
      r.append(el("span","em",em), sel, rm); mb.appendChild(r);
    });
    if(!(l.editors||[]).length && !(l.viewers||[]).length) mb.appendChild(el("p","small muted","目前只有你看得到這本帳。"));
  }
  $("sDeleteBox").hidden=!owner; $("sLeaveBox").hidden=owner;
}
$("scOut").onclick=()=>{ S.sCatType="out"; renderSettings(false); };
$("scIn").onclick=()=>{ S.sCatType="in"; renderSettings(false); };

$("sSaveBasic").onclick=async()=>{
  const l=L(); const upd={ updatedAt:serverTimestamp() };
  const budget=Math.max(0,Math.round(Number($("sBudget").value)||0)); upd.budget=budget;
  if(isOwner(l)){ const n=$("sName").value.trim(); if(!n){ msg("sBasicMsg","帳本名稱不能空白。","err"); return; } upd.name=n; upd.color=S.sColor; }
  try{ await updateDoc(doc(db,"ledgers",l.id), upd); msg("sBasicMsg","已儲存。","ok"); }
  catch(e){ msg("sBasicMsg","儲存失敗："+errText(e),"err"); }
};
async function saveCats(fn, okText){
  const l=L();
  try{ await updateDoc(doc(db,"ledgers",l.id), { categories: fn(l.categories||[]), updatedAt:serverTimestamp() }); msg("sCatMsg", okText, "ok"); }
  catch(e){ msg("sCatMsg","儲存失敗："+errText(e),"err"); }
}
$("sAddCat").onclick=()=>{
  const n=$("sNewCat").value.trim(); if(!n){ msg("sCatMsg","請輸入分類名稱。","err"); return; }
  const l=L(); if((l.categories||[]).some(c=>c.type===S.sCatType && c.name===n)){ msg("sCatMsg","已經有這個分類了。","err"); return; }
  $("sNewCat").value=""; saveCats(cs=>[...cs,{id:rid(),name:n,type:S.sCatType}], `已新增「${n}」`);
};
$("sNewCat").addEventListener("keydown", e=>{ if(e.key==="Enter"){ e.preventDefault(); $("sAddCat").click(); } });

async function setMember(email, role){
  const l=L();
  const editors=(l.editors||[]).filter(x=>x!==email), viewers=(l.viewers||[]).filter(x=>x!==email);
  if(role==="editor") editors.push(email); if(role==="viewer") viewers.push(email);
  const members=[l.ownerEmail, ...editors, ...viewers];
  try{ await updateDoc(doc(db,"ledgers",l.id), { editors, viewers, members, updatedAt:serverTimestamp() });
    msg("sShareMsg", role ? `已分享給 ${email}（${role==="editor"?"可編輯":"僅檢視"}）` : `已移除 ${email}`, "ok"); }
  catch(e){ msg("sShareMsg","更新失敗："+errText(e),"err"); }
}
$("sInvite").onclick=()=>{
  const em=$("sEmail").value.trim().toLowerCase(); const l=L();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)){ msg("sShareMsg","請輸入正確的 Email。","err"); return; }
  if(em===l.ownerEmail){ msg("sShareMsg","這是你自己的 Email。","err"); return; }
  if((l.members||[]).length>=51){ msg("sShareMsg","一本帳最多分享給 50 人。","err"); return; }
  $("sEmail").value=""; setMember(em, $("sRole").value);
};
$("sEmail").addEventListener("keydown", e=>{ if(e.key==="Enter"){ e.preventDefault(); $("sInvite").click(); } });

$("sDelete").onclick=async()=>{
  const l=L();
  if($("sDelConfirm").value.trim()!==l.name){ msg("sDangerMsg","請輸入完整的帳本名稱來確認。","err"); return; }
  $("sDelete").disabled=true; msg("sDangerMsg","刪除中…");
  try{
    // 先刪紀錄（每批最多 400 筆），再刪帳本
    const snap=await getDocs(collection(db,"ledgers",l.id,"entries"));
    for(let i=0;i<snap.docs.length;i+=400){ const b=writeBatch(db); snap.docs.slice(i,i+400).forEach(d=>b.delete(d.ref)); await b.commit(); }
    stopEntries(); S.lid=null; // 先離開畫面，避免讀取已刪除的帳本
    await deleteDoc(doc(db,"ledgers",l.id));
    $("dlgSettings").close(); location.hash=""; toast("帳本已刪除");
  }catch(e){ msg("sDangerMsg","刪除失敗："+errText(e),"err"); if(!S.lid){ S.lid=l.id; renderLedgerHead(); } }
  finally{ $("sDelete").disabled=false; }
};
$("sLeave").onclick=async()=>{
  const b=$("sLeave");
  if(!b.dataset.armed){ b.dataset.armed="1"; b.textContent="確定要離開？"; return; }
  const l=L();
  try{
    stopEntries(); S.lid=null;
    await updateDoc(doc(db,"ledgers",l.id), { members:(l.members||[]).filter(x=>x!==S.email), editors:(l.editors||[]).filter(x=>x!==S.email),
      viewers:(l.viewers||[]).filter(x=>x!==S.email), updatedAt:serverTimestamp() });
    $("dlgSettings").close(); location.hash=""; toast("已離開這本帳");
  }catch(e){ msg("sDangerMsg","離開失敗："+errText(e),"err"); if(!S.lid){ S.lid=l.id; renderLedgerHead(); } }
};
$("dlgSettings").addEventListener("close", ()=>{ $("sLeave").dataset.armed=""; $("sLeave").textContent="離開這本帳"; });

let resizeT; window.addEventListener("resize", ()=>{ clearTimeout(resizeT); resizeT=setTimeout(()=>{ if(S.lid && L()) renderTrend(); }, 150); });

/* ================= 外觀 ================= */
const ACCENTS=[["green","綠","#1d6b52"],["blue","藍","#2f5fa8"],["pink","粉","#b0406a"],["purple","紫","#6b4fa8"],["orange","橘","#a55a12"],["ink","墨","#33403b"]];
const store={ get:k=>{ try{return localStorage.getItem(k);}catch(e){return null;} }, set:(k,v)=>{ try{localStorage.setItem(k,v);}catch(e){} } };
/* 自訂顏色：保留色相，自動調整亮度讓文字清楚（對比 ≥ 4.5:1） */
const hex2rgb=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));
const rgb2hex=c=>"#"+c.map(v=>Math.round(Math.max(0,Math.min(255,v))).toString(16).padStart(2,"0")).join("");
const lum=c=>{ const f=v=>{ v/=255; return v<=.03928? v/12.92 : Math.pow((v+.055)/1.055,2.4); }; const [r,g,b]=c.map(f); return .2126*r+.7152*g+.0722*b; };
const contrast=(a,b)=>{ const x=lum(a), y=lum(b); return (Math.max(x,y)+.05)/(Math.min(x,y)+.05); };
const mix=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t);
function customVars(hex){
  const base=hex2rgb(hex), white=[255,255,255], black=[0,0,0], darkBg=[23,32,25], darkText=[10,21,16];
  let light=base; for(let t=0;t<=1 && contrast(light,white)<4.5;t+=.04) light=mix(base,black,t);   // 淺色模式：白字要清楚
  let dark=base;  for(let t=0;t<=1 && (contrast(dark,darkText)<4.5||contrast(dark,darkBg)<3);t+=.04) dark=mix(base,white,t); // 深色模式：夠亮
  return { "--cl-accent":rgb2hex(light), "--cl-soft":rgb2hex(mix(light,white,.88)),
           "--cd-accent":rgb2hex(dark),  "--cd-soft":rgb2hex(mix(darkBg,dark,.22)) };
}
function applyLook(){
  const t=store.get("ledger.theme")||"system", a=store.get("ledger.accent")||"green", root=document.documentElement;
  if(t==="system") delete root.dataset.theme; else root.dataset.theme=t;
  if(a==="green") delete root.dataset.accent; else root.dataset.accent=a;
  let vars={}; try{ vars=JSON.parse(store.get("ledger.accentVars")||"{}"); }catch(e){}
  ["--cl-accent","--cl-soft","--cd-accent","--cd-soft"].forEach(k=>{ if(a==="custom"&&vars[k]) root.style.setProperty(k,vars[k]); else root.style.removeProperty(k); });
  const bg=getComputedStyle(root).getPropertyValue("--sheet").trim();
  document.querySelectorAll('meta[name="theme-color"]').forEach(m=>m.setAttribute("content", bg||"#1d6b52"));
  if(S.lid && L()) renderTrend();
}
function renderLook(){
  const t=store.get("ledger.theme")||"system", a=store.get("ledger.accent")||"green";
  document.querySelectorAll("#lkTheme button").forEach(b=>{ b.setAttribute("aria-pressed", b.dataset.v===t);
    b.onclick=()=>{ store.set("ledger.theme",b.dataset.v); applyLook(); renderLook(); }; });
  const box=$("lkAccent"); box.textContent="";
  ACCENTS.forEach(([k,name,col])=>{ const b=el("button","accent-opt"); b.type="button"; b.setAttribute("aria-pressed",k===a);
    const s=el("span","swatch"); s.style.background=col; b.append(s, document.createTextNode(name));
    b.onclick=()=>{ store.set("ledger.accent",k); applyLook(); renderLook(); }; box.appendChild(b); });
  const picked=store.get("ledger.accentCustom");
  if(picked) $("lkPicker").value=picked;
  const isCustom=a==="custom";
  $("lkPickerNote").textContent = isCustom ? "目前使用自訂顏色" : "點色塊挑選任何顏色";
  $("lkPreview").hidden=!isCustom;
  if(isCustom){ let v={}; try{ v=JSON.parse(store.get("ledger.accentVars")||"{}"); }catch(e){}
    const pl=$("pvLight"), pd=$("pvDark");
    pl.textContent="淺色"; pl.style.cssText=`background:${v["--cl-accent"]};color:#fff`;
    pd.textContent="深色"; pd.style.cssText=`background:${v["--cd-accent"]};color:#0a1510`; }
}
$("lkPicker").addEventListener("input", e=>{
  const hex=e.target.value; store.set("ledger.accentCustom",hex); store.set("ledger.accentVars",JSON.stringify(customVars(hex)));
  store.set("ledger.accent","custom"); applyLook(); renderLook();
});
document.querySelectorAll("[data-look]").forEach(b=>b.addEventListener("click",()=>{ renderLook(); $("dlgLook").showModal(); }));
$("lkClose").onclick=()=>$("dlgLook").close();
applyLook();
