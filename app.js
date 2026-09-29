// 記帳本 — 主程式
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup,
  createUserWithEmailAndPassword, signInWithEmailAndPassword, sendEmailVerification,
  sendPasswordResetEmail, signOut, connectAuthEmulator
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  getFirestore, collection, doc, addDoc, setDoc, updateDoc, deleteDoc, getDocs, query, where,
  onSnapshot, writeBatch, serverTimestamp, connectFirestoreEmulator
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

/* ================= 常數 ================= */
const COLORS = ["#1d6b52","#2f5fa8","#b0651a","#b23a5a","#6b4fa8","#4f6470"];
const TEMPLATES = {
  "個人": { out:["餐飲","交通","購物","娛樂","美容保養","進修","醫療","人情","其他"], in:["薪資","獎金","投資","兼職","其他收入"] },
  "家庭": { out:["房租房貸","水電瓦斯","網路電話","日常採買","家庭餐費","居家修繕","保險","交通","寵物","孝親","其他"], in:["家用基金","補助","其他收入"] },
  "孕期": { out:["產檢","自費檢查","保健品","產期不適","孕婦用品","寶寶用品","待產包","生產/月子","媽媽教室","交通","其他"], in:["生育補助","保險理賠","紅包","其他收入"], project:true },
  "寶寶": { out:["奶粉","尿布","副食品","衣物","用品","看診疫苗","玩具繪本","托育保母","其他"], in:["育兒津貼","紅包","其他收入"] },
  "搬家": { out:["看屋/簽約","搬家前","搬家當日","搬家後","家具家電","寶寶空間","其他"], in:["其他收入"], project:true },
  "空白": { out:["其他"], in:["其他收入"] }
};
const WK = ["日","一","二","三","四","五","六"];

/* ================= 小工具 ================= */
const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2,"0");
const fmt = n => Math.round(n).toLocaleString("zh-TW");
const money = n => (n<0?"−":"") + "NT$ " + fmt(Math.abs(n));
const todayStr = () => { const d=new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; };
const thisYM = () => todayStr().slice(0,7);
const rid = () => Math.random().toString(36).slice(2,10);
const el = (tag, cls, text) => { const e=document.createElement(tag); if(cls) e.className=cls; if(text!=null) e.textContent=text; return e; };
const addMonths = (ym, k) => { let [y,m]=ym.split("-").map(Number); m+=k; y+=Math.floor((m-1)/12); m=((m-1)%12+12)%12+1; return `${y}-${pad(m)}`; };
const dim = ym => { const [y,m]=ym.split("-").map(Number); return new Date(y,m,0).getDate(); };
const ymLabel = ym => { const [y,m]=ym.split("-").map(Number); return `${y} 年 ${m} 月`; };
function msg(id, text, kind){ const m=$(id); m.textContent=text||""; m.className="msg"+(kind?" "+kind:""); }
let toastTimer;
function toast(text){ const t=$("toast"); t.textContent=text; t.hidden=false; clearTimeout(toastTimer); toastTimer=setTimeout(()=>t.hidden=true,2600); }
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
  if(["localhost","127.0.0.1"].includes(location.hostname) && new URLSearchParams(location.search).has("emulator")){
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings:true });
    connectFirestoreEmulator(db, "127.0.0.1", 8080);
  }
}

/* ================= 狀態 ================= */
const S = {
  user:null, email:"",
  ledgers:new Map(), unsubLedgers:null, ledgersReady:false,
  lid:null, period:{ mode:"month", y:new Date().getFullYear(), m:new Date().getMonth()+1 },
  entries:[], unsubEntries:null, entriesReady:false,
  catView:"out", catFilter:null, stFilter:"all",
  eType:"out", eCat:null, editing:null, eStatus:"paid",
  newTpl:"個人", newColor:COLORS[0], newCats:{out:[],in:[]}, newCatType:"out",
  sColor:COLORS[0], sCatType:"out",
  loans:[], unsubLoans:null, loansReady:false, rYM:thisYM(), editingLoan:null, payLoan:null,
  prefs:null, unsubPrefs:null, startApplied:false
};
const DEFAULT_PAYS=["現金","信用卡","悠遊卡","行動支付","轉帳","其他"];
const P = () => { const p=S.prefs||{}; return { defaultPay:p.defaultPay||"", defaultPayer:p.defaultPayer||"", defaultCard:p.defaultCard||"", startPage:p.startPage||"",
  payers:p.payers||[], cards:p.cards||[], pays:(p.pays&&p.pays.length?p.pays:DEFAULT_PAYS) }; };
const L = () => S.ledgers.get(S.lid);
const isOwner = l => l && S.user && l.ownerUid === S.user.uid;
const canEdit = l => l && (isOwner(l) || (l.editors||[]).includes(S.email));
const roleText = l => isOwner(l) ? "擁有者" : canEdit(l) ? "可編輯" : "僅檢視";
const isProj = l => l && l.mode === "project";
const stLabels = l => isProj(l) ? {paid:"完成", pending:"未完成"} : {paid:"已付款", pending:"未付款"};
const isPending = e => e.status === "pending";
/* 專案用：同一組分期算一個項目（金額加總，預算只算一次） */
function projItems(entries){
  const m=new Map();
  entries.filter(e=>e.type==="out").forEach(e=>{
    const k=e.inst ? "g:"+e.inst.g : e.id;
    const it=m.get(k)||{categoryId:e.categoryId, categoryName:e.categoryName, amount:0, budget:0, pending:isPending(e)};
    it.amount+=e.amount; it.budget=Math.max(it.budget, e.budget||0); m.set(k,it);
  });
  return [...m.values()];
}

/* ================= 畫面切換 ================= */
const VIEWS = ["viewSetup","viewLoading","viewLogin","viewVerify","viewHome","viewRepay","viewSettings","viewLedger"];
function show(v){ VIEWS.forEach(id=>$(id).hidden = id!==v); }

if(!configured){ show("viewSetup"); }
else {
  onAuthStateChanged(auth, async user => {
    stopLedgers(); stopEntries(); stopLoans(); stopPrefs();
    S.user = user; S.email = user && user.email ? user.email.toLowerCase() : "";
    if(!user){ show("viewLogin"); return; }
    if(!user.emailVerified){ $("verifyEmail").textContent=user.email; show("viewVerify"); return; }
    signedInStart();
  });
}
function signedInStart(){
  document.querySelectorAll(".who-email").forEach(s=>s.textContent=S.user.email);
  S.startApplied = !!location.hash; // 網址已經指定頁面時，不套用「直接進入」
  watchLedgers(); watchLoans(); watchPrefs(); route();
}
window.addEventListener("hashchange", ()=>{ if(S.user && S.user.emailVerified) route(); });

function route(){
  const m = location.hash.match(/^#l\/([A-Za-z0-9_-]+)/);
  if(m){ openLedger(m[1]); return; }
  S.lid=null; S.viewInitFor=null; stopEntries(); document.title="記帳本";
  if(location.hash==="#repay"){ show("viewRepay"); renderRepay(); return; }
  if(location.hash==="#settings"){ show("viewSettings"); renderGlobalSettings(); return; }
  show("viewHome"); renderHome();
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
    S.user = auth.currentUser; S.email = S.user.email.toLowerCase(); signedInStart();
  } else msg("verifyMsg","還沒收到驗證，請點信裡的連結後再按一次。","err");
};
$("btnResend").onclick = async () => {
  try{ await sendEmailVerification(auth.currentUser); msg("verifyMsg","已重新寄出驗證信。","ok"); }
  catch(e){ msg("verifyMsg", errText(e), "err"); }
};
document.querySelectorAll("[data-logout]").forEach(b=>b.onclick=()=>{ location.hash=""; signOut(auth); });
$("btnLogout2").onclick = () => { location.hash=""; signOut(auth); };

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
    } else if(location.hash==="#repay") renderRepay();
    else renderHome();
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
    e.appendChild(document.createTextNode("按「新增帳本」，可以從個人、家庭、孕期、寶寶、搬家範本開始，也可以建一本空白的自己設計分類。"));
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
  if(isProj(l)) n.appendChild(el("span","badge","專案"));
  const others=(l.members||[]).length-1;
  const meta=el("div","meta", isOwner(l) ? (others>0?`與 ${others} 人共用`:"只有你看得到") : `${l.ownerEmail} 分享・${roleText(l)}`);
  const extra = isProj(l) ? (l.projectBudget?`總預算 ${money(l.projectBudget)}`:"專案模式") : (l.budget?`每月預算 ${money(l.budget)}`:"");
  const cats=el("div","meta", `${(l.categories||[]).length} 個分類` + (extra?`・${extra}`:""));
  b.append(n, meta, cats); return b;
}

/* ================= 顏色選擇（預設色＋自訂） ================= */
function swatches(boxId, current, onPick, disabled){
  const box=$(boxId); box.textContent="";
  COLORS.forEach(c=>{ const s=el("button","swatch"); s.type="button"; s.style.background=c; s.setAttribute("aria-label","顏色 "+c);
    s.setAttribute("aria-pressed", c===current); s.disabled=!!disabled; s.onclick=()=>onPick(c); box.appendChild(s); });
  const custom = current && !COLORS.includes(current);
  const w=el("label","swatch-pick"); w.title="自訂顏色"; w.setAttribute("aria-pressed", custom);
  if(custom) w.style.background=current;
  const inp=el("input"); inp.type="color"; inp.value=custom?current:"#888888"; inp.disabled=!!disabled; inp.setAttribute("aria-label","自訂顏色");
  inp.addEventListener("input", ()=>onPick(inp.value));
  w.appendChild(inp); box.appendChild(w);
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
function pickTemplate(k){
  const prevAuto = !$("nName").value || Object.keys(TEMPLATES).some(x=>$("nName").value===x+"開銷"||$("nName").value===x+"專案");
  S.newTpl=k; S.newCats={ out:[...TEMPLATES[k].out], in:[...TEMPLATES[k].in] };
  $("nProject").checked = !!TEMPLATES[k].project;
  if(prevAuto) $("nName").value = k==="空白" ? "" : k+(TEMPLATES[k].project?"專案":"開銷");
}
function renderNewDialog(){
  const t=$("nTemplates"); t.textContent="";
  Object.keys(TEMPLATES).forEach(k=>{
    const c=el("button","chip",k); c.type="button"; c.setAttribute("aria-pressed", k===S.newTpl);
    c.onclick=()=>{ pickTemplate(k); renderNewDialog(); };
    t.appendChild(c);
  });
  renderNewCats();
  swatches("nColors", S.newColor, c=>{ S.newColor=c; renderNewDialog(); });
}
$("btnNewLedger").onclick = () => {
  S.newCatType="out"; $("nNewCat").value=""; S.newColor=COLORS[S.ledgers.size % COLORS.length]; $("nName").value=""; msg("nMsg","");
  pickTemplate("個人"); renderNewDialog(); $("dlgNew").showModal();
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
      mode: $("nProject").checked ? "project" : "normal", projectBudget:0, weekStart:"",
      createdAt:serverTimestamp(), updatedAt:serverTimestamp()
    });
    $("dlgNew").close(); location.hash="#l/"+ref.id;
  }catch(err){ msg("nMsg","建立失敗："+errText(err),"err"); }
  finally{ $("nCreate").disabled=false; }
});

/* ================= 帳本頁 ================= */
function openLedger(id){
  S.lid=id; show("viewLedger");
  if(!S.ledgers.has(id)){
    if(S.ledgersReady){ toast("找不到這本帳，或你沒有權限"); location.hash=""; }
    return; // 等帳本列表載入後會再呼叫 renderLedgerHead
  }
  renderLedgerHead();
}
function initLedgerView(){
  if(S.viewInitFor===S.lid) return;
  S.viewInitFor=S.lid; stopEntries();
  S.catFilter=null; S.stFilter="all"; S.catView="out"; $("search").value="";
  const d=new Date(); S.period={mode: isProj(L()) ? "all" : "month", y:d.getFullYear(), m:d.getMonth()+1};
}
function renderLedgerHead(){
  const l=L(); if(!l) return;
  initLedgerView();
  $("lName").textContent=l.name; $("lDot").style.background=l.color||COLORS[0];
  $("lRole").textContent=roleText(l); document.title=l.name+"｜記帳本";
  $("btnAdd").hidden=!canEdit(l);
  const lb=stLabels(l); $("stPendBtn").textContent=lb.pending; $("stDoneBtn").textContent=lb.paid;
  if(!S.unsubEntries) watchEntries();
}
$("btnBack").onclick=()=>{ location.hash=""; };

function periodRange(){
  const {mode,y,m}=S.period;
  if(mode==="all") return null;
  if(mode==="year") return [`${y}-01-01`,`${y}-12-31`];
  const d=new Date(y,m,0).getDate(); return [`${y}-${pad(m)}-01`,`${y}-${pad(m)}-${pad(d)}`];
}
function watchEntries(){
  stopEntries();
  if(!S.lid || !S.ledgers.has(S.lid)) return;
  const r=periodRange();
  S.entriesReady=false; renderAll();
  const col=collection(db,"ledgers",S.lid,"entries");
  const q= r ? query(col, where("date",">=",r[0]), where("date","<=",r[1])) : query(col);
  const token = S.entriesToken = {};
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
$("pAll").onclick=()=>setMode("all");
$("pPrev").onclick=()=>shiftPeriod(-1);
$("pNext").onclick=()=>shiftPeriod(1);
$("pNow").onclick=()=>{ const d=new Date(); S.period={mode:"month",y:d.getFullYear(),m:d.getMonth()+1}; S.catFilter=null; watchEntries(); };
function shiftPeriod(d){
  const p=S.period;
  if(p.mode==="year") p.y+=d;
  else if(p.mode==="month"){ p.m+=d; if(p.m<1){p.m=12;p.y--;} if(p.m>12){p.m=1;p.y++;} }
  S.catFilter=null; watchEntries();
}
$("cOut").onclick=()=>{ S.catView="out"; S.catFilter=null; renderAll(); };
$("cIn").onclick=()=>{ S.catView="in"; S.catFilter=null; renderAll(); };
$("cPayer").onclick=()=>{ S.catView="payer"; S.catFilter=null; renderAll(); };
$("search").addEventListener("input", renderList);
$("filterClear").onclick=()=>{ S.catFilter=null; renderAll(); };
document.querySelectorAll("#stFilter button").forEach(b=>b.onclick=()=>{ S.stFilter=b.dataset.st; renderList(); });

const catName = (l, e) => { const c=(l.categories||[]).find(c=>c.id===e.categoryId); return c ? c.name : (e.categoryName||"未分類"); };
const weekOf = (l, date) => { if(!l.weekStart || !date) return null; const d=(new Date(date+"T00:00")-new Date(l.weekStart+"T00:00"))/864e5; return d>=0 ? Math.floor(d/7) : null; };

function renderAll(){
  const l=L(); if(!l) return;
  const {mode,y,m}=S.period;
  $("pMonth").setAttribute("aria-pressed", mode==="month"); $("pYear").setAttribute("aria-pressed", mode==="year"); $("pAll").setAttribute("aria-pressed", mode==="all");
  $("pTitle").textContent = mode==="all" ? "全部紀錄" : mode==="year" ? `${y} 年` : `${y} 年 ${m} 月`;
  $("pPrev").hidden = $("pNext").hidden = mode==="all";
  const now=new Date(); const isNow = mode==="month" && y===now.getFullYear() && m===now.getMonth()+1;
  $("pNow").hidden = isNow;
  $("cOut").setAttribute("aria-pressed", S.catView==="out"); $("cIn").setAttribute("aria-pressed", S.catView==="in"); $("cPayer").setAttribute("aria-pressed", S.catView==="payer");
  renderTotals(l); renderCats(l); renderTrend();
  const table = mode!=="month";
  $("listPanel").hidden = table && !isProj(l); $("yearPanel").hidden = !table;
  if(table) renderYearTable();
  if(!$("listPanel").hidden) renderList();
}

function renderTotals(l){
  let o=0,i=0,pn=0,pa=0; S.entries.forEach(e=>{ if(e.type==="in") i+=e.amount; else o+=e.amount; if(isPending(e)){ pn++; pa+=e.amount; } });
  const mode=S.period.mode, proj=isProj(l);
  if(proj){
    $("balLabel").textContent = mode==="all" ? "專案已支出" : mode==="year" ? "今年已支出" : "本月已支出";
    $("tBal").textContent = S.entriesReady ? money(o) : "…"; $("tBal").className="num big";
  } else {
    $("balLabel").textContent = mode==="all" ? "全部結餘" : mode==="year" ? "全年結餘" : "本月結餘";
    $("tBal").textContent = S.entriesReady ? money(i-o) : "…";
    $("tBal").className = "num big" + (i-o<0?" c-out":"");
  }
  $("tOut").textContent=fmt(o); $("tIn").textContent=fmt(i);
  const lb=stLabels(l);
  if(proj){ const its=projItems(S.entries).filter(x=>x.pending); pn=its.length; pa=its.reduce((s,x)=>s+x.amount,0); }
  $("pendNote").hidden = !pn;
  $("pendNote").textContent = `其中${lb.pending} ${pn} 筆` + (pa?`，共 ${money(pa)}`:"");

  // 專案
  $("projBox").hidden = !proj;
  if(proj){
    const items=projItems(S.entries);
    const need=items.reduce((a,e)=>a+Math.max(e.budget-e.amount,0),0);
    const done=items.filter(e=>!e.pending).length;
    const pb=l.projectBudget||0;
    $("pjBudget").textContent = pb ? money(pb) : "未設定";
    $("pjLeft").textContent = pb ? money(pb-o) : "—"; $("pjLeft").className="num mid"+(pb&&pb-o<0?" c-out":"");
    $("pjNeed").textContent = fmt(need);
    $("pjDone").textContent = `${done} / ${items.length}`;
    const bar=$("pjMeter").firstElementChild; bar.style.width = items.length ? (done/items.length*100)+"%" : "0";
    $("pjNote").textContent = pb ? `已用總預算 ${Math.round(o/pb*100)}%` + (mode!=="all"?"（目前只算這段期間，切到「全部」看整個專案）":"") : (canEdit(l)?"可在「設定」裡設定專案總預算":"");
  }
  // 每月預算（專案模式不顯示）
  $("budgetBox").hidden = proj || mode==="all";
  if(proj || mode==="all") return;
  const budget = (l.budget||0) * (mode==="year"?12:1);
  $("bLabel").textContent = mode==="year" ? "全年預算（每月 × 12）" : "每月預算";
  $("bVal").textContent = budget ? money(budget) : "未設定";
  const meter=$("bMeter"), bar=meter.firstElementChild;
  if(budget>0){
    const r=o/budget; bar.style.width=Math.min(100,r*100)+"%";
    meter.className="meter"+(r>1?" over":r>.85?" warn":"");
    const left=budget-o;
    $("bLeft").textContent = left>=0 ? `還剩 ${money(left)}` : `已超支 ${money(-left)}`;
    const now=new Date(), {y,m}=S.period;
    if(mode==="month" && y===now.getFullYear() && m===now.getMonth()+1 && left>0){
      const rest=new Date(y,m,0).getDate()-now.getDate()+1; $("bExtra").textContent=`每天可花 ${fmt(left/rest)}`;
    } else $("bExtra").textContent=`已用 ${Math.round(r*100)}%`;
  } else {
    bar.style.width="0"; meter.className="meter";
    $("bLeft").textContent = canEdit(l) ? "可在「設定」裡設定每月預算" : ""; $("bExtra").textContent="";
  }
}

function renderCats(l){
  const box=$("catList"); box.textContent="";
  const proj=isProj(l);
  $("catTitle").textContent = proj && S.catView==="out" ? "分類進度" : S.catView==="payer" ? "誰付的" : "分類統計";
  if(!S.entriesReady){ box.appendChild(el("p","small muted","讀取中…")); return; }
  // 專案：分類進度表
  if(proj && S.catView==="out"){
    const rows=new Map();
    projItems(S.entries).forEach(e=>{ const r=rows.get(e.categoryId)||{name:catName(l,e),n:0,d:0,b:0,a:0};
      r.n++; if(!e.pending) r.d++; r.b+=e.budget; r.a+=e.amount; rows.set(e.categoryId,r); });
    if(!rows.size){ box.appendChild(el("p","small muted","還沒有項目。按「＋ 記一筆」新增，可以只填預算、之後再補實際金額。")); return; }
    const t=el("table","ptable"), th=el("thead"), hr=el("tr");
    ["分類","完成","預算","實際","差額"].forEach(x=>hr.appendChild(el("th",null,x))); th.appendChild(hr);
    const tb=el("tbody"); let B=0,A=0,N=0,D=0;
    [...rows.entries()].forEach(([id,r])=>{ B+=r.b;A+=r.a;N+=r.n;D+=r.d;
      const tr=el("tr"); tr.setAttribute("aria-selected", S.catFilter===id); tr.title="只看這個分類";
      tr.onclick=()=>{ S.catFilter=S.catFilter===id?null:id; renderCats(l); renderList(); };
      const c1=el("td"); c1.appendChild(document.createTextNode(r.name)); const mm=el("div","mini-meter"); const mi=el("i"); mi.style.width=(r.d/r.n*100)+"%"; mm.appendChild(mi); c1.appendChild(mm);
      tr.append(c1, el("td","num",`${r.d}/${r.n}`), el("td","num",r.b?fmt(r.b):"—"), el("td","num",fmt(r.a)), el("td","num"+(r.b&&r.b-r.a<0?" c-out":""), r.b?fmt(r.b-r.a):"—"));
      tb.appendChild(tr); });
    const tf=el("tfoot"), fr=el("tr"); fr.append(el("td",null,"合計"), el("td","num",`${D}/${N}`), el("td","num",fmt(B)), el("td","num",fmt(A)), el("td","num"+(B-A<0?" c-out":""),fmt(B-A)));
    tf.appendChild(fr); t.append(th,tb,tf); box.appendChild(t); return;
  }
  const sums=new Map(); let tot=0;
  const src = S.catView==="payer" ? S.entries.filter(e=>e.type==="out") : S.entries.filter(e=>e.type===S.catView);
  src.forEach(e=>{
    const k = S.catView==="payer" ? "p:"+(e.payer||"") : e.categoryId;
    const name = S.catView==="payer" ? (e.payer||"未填付款人") : catName(l,e);
    const cur=sums.get(k)||{name,v:0}; cur.v+=e.amount; sums.set(k,cur); tot+=e.amount; });
  const rows=[...sums.entries()].sort((a,b)=>b[1].v-a[1].v);
  if(!rows.length){ box.appendChild(el("p","small muted", S.catView==="in"?"這段期間還沒有收入。":"這段期間還沒有支出。")); return; }
  const max=rows[0][1].v, clickable=S.catView!=="payer";
  rows.forEach(([id,{name,v}])=>{
    const r=el(clickable?"button":"div","cat-row"); if(clickable){ r.type="button"; r.setAttribute("aria-pressed", S.catFilter===id); r.title="只看這個分類的明細";
      r.onclick=()=>{ S.catFilter = S.catFilter===id ? null : id; renderCats(l); renderList(); if($("listPanel").hidden){ /* 年檢視沒有明細 */ } }; }
    const bar=el("div","cat-bar"+(S.catView==="in"?" in":"")); const i=el("i"); i.style.width=(v/max*100)+"%"; bar.appendChild(i);
    const n=el("span","num",fmt(v)); n.appendChild(el("span","pct",Math.round(v/tot*100)+"%"));
    r.append(el("span","nm",name), bar, n); box.appendChild(r);
  });
  const t=el("div","between small muted"); t.style.padding="6px 6px 0"; t.append(el("span",null,"合計"), el("span","num",money(tot))); box.appendChild(t);
}

function niceMax(v){ if(v<=0) return 100; const p=Math.pow(10,Math.floor(Math.log10(v))); for(const k of [1,2,2.5,5,10]) if(k*p>=v) return k*p; return 10*p; }
const tick = v => v>=10000 ? (v/10000)+"萬" : v>=1000 ? (v/1000)+"k" : String(v);
function monthsSpan(){
  const ms=[...new Set(S.entries.map(e=>e.date.slice(0,7)))].sort();
  if(!ms.length) return [thisYM()];
  const out=[]; for(let k=ms[0]; k<=ms[ms.length-1]; k=addMonths(k,1)) out.push(k); return out;
}
function renderTrend(){
  if(!L()) return;
  const {mode,y,m}=S.period, W=Math.max(320,Math.min(640,$("trend").clientWidth||640)), H=Math.round(W*.36)+20, Lp=42,R=6,T=12,B=26;
  let s=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${mode==="month"?"每日支出長條圖":"每月收支長條圖"}">`;
  const grid = mx => { for(let k=0;k<=4;k++){ const v=mx*k/4, yy=T+(H-T-B)*(1-k/4);
    s+=`<line x1="${Lp}" x2="${W-R}" y1="${yy}" y2="${yy}" stroke="var(--rule)" stroke-width="1"/>`;
    s+=`<text x="${Lp-6}" y="${yy+4}" text-anchor="end" font-size="11" fill="var(--muted)" font-family="var(--f-num)">${tick(v)}</text>`; } };
  if(mode==="month"){
    $("trendTitle").textContent="每日支出";
    const dm=new Date(y,m,0).getDate(), d=new Array(dm).fill(0);
    S.entries.forEach(e=>{ if(e.type==="out"){ const k=Number(e.date.slice(8,10))-1; if(k>=0&&k<dm) d[k]+=e.amount; } });
    const tot=d.reduce((a,b)=>a+b,0), now=new Date(), isCur=now.getFullYear()===y&&now.getMonth()+1===m;
    $("trendNote").textContent = tot ? `日均 ${money(tot/(isCur?now.getDate():dm))}` : "";
    const mx=niceMax(Math.max(...d)), cw=(W-Lp-R)/dm, yv=v=>T+(H-T-B)*(1-v/mx);
    grid(mx);
    d.forEach((v,k)=>{ const today=isCur&&k===now.getDate()-1;
      if(v>0) s+=`<rect x="${Lp+k*cw+cw*.18}" y="${yv(v)}" width="${cw*.64}" height="${yv(0)-yv(v)}" rx="1.5" fill="${today?"var(--accent)":"var(--out)"}" opacity="${today?1:.82}"><title>${m}/${k+1}：${money(v)}</title></rect>`;
      if(k===0||(k+1)%5===0) s+=`<text x="${Lp+k*cw+cw/2}" y="${H-9}" text-anchor="middle" font-size="11" fill="var(--muted)" font-family="var(--f-num)">${k+1}</text>`; });
  } else {
    $("trendTitle").textContent="每月收支";
    const keys = mode==="year" ? Array.from({length:12},(_,k)=>`${y}-${pad(k+1)}`) : monthsSpan();
    const idx=new Map(keys.map((k,i)=>[k,i])), o=new Array(keys.length).fill(0), i=new Array(keys.length).fill(0);
    S.entries.forEach(e=>{ const k=idx.get(e.date.slice(0,7)); if(k!=null) (e.type==="in"?i:o)[k]+=e.amount; });
    const months=o.filter(v=>v>0).length;
    $("trendNote").innerHTML = `<span class="legend"><span><i style="background:var(--out)"></i>支出</span><span><i style="background:var(--in)"></i>收入</span>${months?`<span>月均支出 ${money(o.reduce((a,b)=>a+b,0)/months)}</span>`:""}</span>`;
    const n=keys.length, mx=niceMax(Math.max(...o,...i)), cw=(W-Lp-R)/n, yv=v=>T+(H-T-B)*(1-v/mx), bw=cw*.32;
    const every = Math.ceil(n/12);
    grid(mx);
    keys.forEach((key,k)=>{ const x=Lp+k*cw+cw*.16, mo=Number(key.slice(5,7));
      if(o[k]>0) s+=`<rect x="${x}" y="${yv(o[k])}" width="${bw}" height="${yv(0)-yv(o[k])}" rx="1.5" fill="var(--out)" opacity=".85"><title>${ymLabel(key)}支出：${money(o[k])}</title></rect>`;
      if(i[k]>0) s+=`<rect x="${x+bw+2}" y="${yv(i[k])}" width="${bw}" height="${yv(0)-yv(i[k])}" rx="1.5" fill="var(--in)" opacity=".85"><title>${ymLabel(key)}收入：${money(i[k])}</title></rect>`;
      if(k%every===0) s+=`<text x="${Lp+k*cw+cw/2}" y="${H-9}" text-anchor="middle" font-size="11" fill="var(--muted)" font-family="var(--f-num)">${mode==="all"&&(k===0||mo===1)?key.slice(2,4)+"/":""}${mo}月</text>`; });
  }
  $("trend").innerHTML=s+"</svg>";
}

function statusChip(l, e, editable){
  const lb=stLabels(l), p=isPending(e);
  const b=el("button","st "+(p?"pending":"done"), p?lb.pending:lb.paid); b.type="button";
  if(!editable){ b.disabled=true; return b; }
  b.title="點一下切換狀態";
  b.onclick=async ev=>{ ev.stopPropagation();
    try{ await updateEntries(l, e, { status: p ? "paid" : "pending" }); }catch(err){ toast("更新失敗："+errText(err)); } };
  return b;
}
function renderList(){
  const l=L(); if(!l) return;
  const box=$("list"); box.textContent="";
  const q=$("search").value.trim().toLowerCase();
  document.querySelectorAll("#stFilter button").forEach(b=>b.setAttribute("aria-pressed", b.dataset.st===S.stFilter));
  let list=S.entries.slice();
  if(S.period.mode!=="month"){ // 分期整組合成一列
    const seen=new Map(), out=[];
    list.forEach(e=>{ if(!e.inst){ out.push(e); return; }
      const g=seen.get(e.inst.g);
      if(g){ g.amount+=e.amount; if(e.inst.k===1) g._first=e; return; }
      const row={...e, date:e.inst.purchase, _group:true, _first:e.inst.k===1?e:null}; seen.set(e.inst.g,row); out.push(row); });
    seen.forEach(g=>{ if(g._first) Object.assign(g,{id:g._first.id}); });
    list=out;
  }
  list=list.sort((a,b)=> b.date.localeCompare(a.date) || ((b.createdAt?.seconds||9e9)-(a.createdAt?.seconds||9e9)));
  if(S.catFilter) list=list.filter(e=>e.categoryId===S.catFilter);
  if(S.stFilter==="pending") list=list.filter(isPending); else if(S.stFilter==="paid") list=list.filter(e=>!isPending(e));
  if(q) list=list.filter(e=>[e.note,catName(l,e),e.pay,e.payer,e.card].join(" ").toLowerCase().includes(q));
  $("countNote").textContent = S.entries.length ? `${S.entries.length} 筆` : "";
  $("filterBar").hidden = !S.catFilter;
  if(S.catFilter){ const c=(l.categories||[]).find(c=>c.id===S.catFilter); const e=S.entries.find(e=>e.categoryId===S.catFilter);
    $("filterText").textContent = "只顯示：" + (c?c.name:(e?e.categoryName:"")); }
  if(!list.length){
    const e=el("div","empty");
    if(!S.entriesReady) e.textContent="讀取中…";
    else if(q||S.catFilter||S.stFilter!=="all") e.textContent="找不到符合的紀錄。";
    else { e.appendChild(el("strong",null,S.period.mode==="month"?"這個月還沒有紀錄":"還沒有紀錄")); e.appendChild(document.createTextNode(canEdit(l)?"按右下角「＋ 記一筆」開始記帳。":"擁有者或可編輯的人記帳後，會顯示在這裡。")); }
    box.appendChild(e); return;
  }
  const shared=(l.members||[]).length>1, editable=canEdit(l), proj=isProj(l);
  const groups=new Map(); list.forEach(e=>{ if(!groups.has(e.date)) groups.set(e.date,[]); groups.get(e.date).push(e); });
  groups.forEach((g,date)=>{
    const dt=new Date(date+"T00:00"); const out=g.filter(e=>e.type==="out").reduce((a,e)=>a+e.amount,0);
    const wk=weekOf(l,date);
    const day=el("div","day"); const h=el("div","day-head");
    h.append(el("span",null,`${S.period.mode!=="month"?dt.getFullYear()+" 年 ":""}${dt.getMonth()+1} 月 ${dt.getDate()} 日（${WK[dt.getDay()]}）${wk!=null?`・${wk} 週`:""}`), el("span","num",out?"支出 "+fmt(out):""));
    day.appendChild(h);
    g.forEach(e=>{
      const row=el("div","entry"+(editable?"":" ro"));
      if(editable){ row.tabIndex=0; row.setAttribute("role","button"); row.onclick=()=>openEntry(e); row.onkeydown=ev=>{ if(ev.key==="Enter") openEntry(e); }; }
      const main=el("div"); const note=el("div","note", e.note || catName(l,e));
      if(e.priority){ note.appendChild(el("span","prio"+(e.priority==="中"?" m":e.priority==="低"?" l":""), e.priority)); }
      main.appendChild(note);
      const meta=[];
      if(e._group) meta.push(`${e.card||"信用卡"} 分 ${e.inst.n} 期・每期約 ${fmt(Math.floor(e.inst.total/e.inst.n))}`);
      else if(e.inst) meta.push(`${e.card||"信用卡"} 分期 ${e.inst.k}/${e.inst.n}`); else if(e.card) meta.push(`${e.pay}・${e.card}`); else if(e.pay) meta.push(e.pay);
      if(e.payer) meta.push(e.payer+" 付");
      if(shared && e.createdByEmail) meta.push(e.createdByEmail===S.email?"我記的":e.createdByEmail.split("@")[0]+" 記的");
      main.appendChild(el("div","meta", meta.join("・")));
      const right=el("div","entry-right");
      right.appendChild(e.amount ? el("span","num "+(e.type==="in"?"c-in":"c-out"), (e.type==="in"?"+":"−")+fmt(e.amount)) : el("span","num muted","未填"));
      if(proj && e.budget) right.appendChild(el("span","sub",`預算 ${fmt(e.budget)}`));
      if(proj || isPending(e)) right.appendChild(statusChip(l,e,editable));
      row.append(el("span","tag"+(e.type==="in"?" in":""), catName(l,e)), main, right);
      day.appendChild(row);
    });
    box.appendChild(day);
  });
}

function renderYearTable(){
  const mode=S.period.mode;
  const keys = mode==="year" ? Array.from({length:12},(_,k)=>`${S.period.y}-${pad(k+1)}`) : monthsSpan();
  const idx=new Map(keys.map((k,i)=>[k,i])), o=keys.map(()=>0), i=keys.map(()=>0), n=keys.map(()=>0);
  S.entries.forEach(e=>{ const k=idx.get(e.date.slice(0,7)); if(k==null) return; (e.type==="in"?i:o)[k]+=e.amount; n[k]++; });
  $("ytTitle").textContent = mode==="year" ? "每月明細" : "每月現金流";
  const t=$("ytable"); t.textContent="";
  const th=el("thead"), hr=el("tr"); ["月份","筆數","支出","收入","當月結餘","累計結餘"].forEach(x=>hr.appendChild(el("th",null,x))); th.appendChild(hr);
  const tb=el("tbody"); let cum=0;
  keys.forEach((key,k)=>{
    cum+=i[k]-o[k];
    const r=el("tr"); r.title="查看這個月"; r.tabIndex=0;
    const go=()=>{ const [yy,mm]=key.split("-").map(Number); S.period={mode:"month",y:yy,m:mm}; S.catFilter=null; watchEntries(); };
    r.onclick=go; r.onkeydown=ev=>{ if(ev.key==="Enter") go(); };
    const has=o[k]||i[k];
    r.append(el("td",null, mode==="year"?`${Number(key.slice(5))} 月`:ymLabel(key)), el("td","num",n[k]||"—"), el("td","num c-out",o[k]?fmt(o[k]):"—"), el("td","num c-in",i[k]?fmt(i[k]):"—"),
      el("td","num"+(i[k]-o[k]<0?" c-out":""), has?fmt(i[k]-o[k]):"—"), el("td","num"+(cum<0?" c-out":""), fmt(cum)));
    tb.appendChild(r);
  });
  const tf=el("tfoot"), fr=el("tr"); const so=o.reduce((a,b)=>a+b,0), si=i.reduce((a,b)=>a+b,0);
  fr.append(el("td",null,"合計"), el("td","num",n.reduce((a,b)=>a+b,0)), el("td","num c-out",fmt(so)), el("td","num c-in",fmt(si)), el("td","num"+(si-so<0?" c-out":""),fmt(si-so)), el("td"));
  tf.appendChild(fr); t.append(th,tb,tf);
}

/* CSV 匯出 */
function exportCsv(){
  const l=L(); if(!l || !S.entries.length){ toast("這段期間沒有紀錄可以匯出"); return; }
  const esc=v=>{ v=String(v??""); return /[",\n]/.test(v) ? '"'+v.replace(/"/g,'""')+'"' : v; };
  const lb=stLabels(l);
  const rows=[["日期","類型","分類","金額","預算","狀態","優先度","付款方式","卡片","分期","付款人","備註","記錄者"]].concat(
    S.entries.slice().sort((a,b)=>a.date.localeCompare(b.date)).map(e=>[e.date, e.type==="in"?"收入":"支出", catName(l,e), e.amount, e.budget||"",
      isPending(e)?lb.pending:lb.paid, e.priority||"", e.pay, e.card||"", e.inst?`${e.inst.k}/${e.inst.n}`:"", e.payer||"", e.note, e.createdByEmail]));
  const csv="﻿"+rows.map(r=>r.map(esc).join(",")).join("\r\n");
  const {mode,y,m}=S.period;
  const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));
  a.download=`${l.name}_${mode==="all"?"全部":mode==="year"?y:`${y}-${pad(m)}`}.csv`; document.body.appendChild(a); a.click();
  setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
$("btnExport").onclick=exportCsv; $("btnExportY").onclick=exportCsv;

/* ================= 記一筆 ================= */
function renderEntryCats(){
  const l=L(); const box=$("eCats"); box.textContent="";
  const list=(l.categories||[]).filter(c=>c.type===S.eType);
  if(S.editing && S.eCat && !list.some(c=>c.id===S.eCat.id)) list.push(S.eCat);
  if(!S.eCat || !list.some(c=>c.id===S.eCat.id)) S.eCat=list[0]||null;
  if(!list.length){ box.appendChild(el("span","small muted","還沒有分類，請到「設定」新增。")); return; }
  list.forEach(c=>{ const b=el("button","chip",c.name); b.type="button"; b.setAttribute("aria-pressed", S.eCat&&c.id===S.eCat.id);
    b.onclick=()=>{ S.eCat=c; renderEntryCats(); }; box.appendChild(b); });
}
function setEType(t){ S.eType=t; $("eOut").setAttribute("aria-pressed",t==="out"); $("eIn").setAttribute("aria-pressed",t==="in"); renderEntryCats(); }
$("eOut").onclick=()=>setEType("out"); $("eIn").onclick=()=>setEType("in");
function setEStatus(s){ S.eStatus=s; $("eStPaid").setAttribute("aria-pressed",s==="paid"); $("eStPend").setAttribute("aria-pressed",s==="pending"); }
$("eStPaid").onclick=()=>setEStatus("paid"); $("eStPend").onclick=()=>setEStatus("pending");

function syncCardUI(){
  const isCard=$("ePay").value==="信用卡";
  $("eCardWrap").hidden=!isCard;
  const on=isCard && $("eInstOn").checked;
  $("eInstBox").hidden=!on; $("eInstNote").hidden=!on;
  $("eAmtLabel").textContent = on ? "總金額" : "";
  if(on){
    const amt=Math.round(Number($("eAmount").value)||0), n=Math.round(Number($("eInstN").value)||0);
    if(amt>0 && n>=2){ const base=Math.floor(amt/n), last=amt-base*(n-1);
      $("eInstNote").textContent = `每期 ${money(base)}` + (last!==base?`，最後一期 ${money(last)}`:"") + `，會自動記到 ${ymLabel($("eInstStart").value||thisYM())} 起的每個月。`; }
    else $("eInstNote").textContent="輸入總金額和期數（2～60 期）。";
  }
}
["ePay","eInstOn","eInstN","eInstStart","eAmount"].forEach(id=>$(id).addEventListener("input",syncCardUI));
$("ePay").addEventListener("change",syncCardUI);
$("eDate").addEventListener("input",()=>{ const l=L(); const w=weekOf(l,$("eDate").value); $("eWeek").textContent = w!=null?`（${w} 週）`:""; });

function fillPayOptions(selId, current){
  const sel=$(selId); sel.textContent="";
  const pays=[...P().pays]; if(!pays.includes("信用卡")) pays.splice(1,0,"信用卡");
  if(current && !pays.includes(current)) pays.push(current);
  pays.forEach(p=>{ const o=el("option",null,p); o.value=p; sel.appendChild(o); });
  if(current) sel.value=current;
}
function fillDatalists(){
  const payers=new Set(P().payers), cards=new Set(P().cards);
  S.entries.forEach(e=>{ if(e.payer) payers.add(e.payer); if(e.card) cards.add(e.card); });
  const fill=(id,set)=>{ const d=$(id); d.textContent=""; [...set].slice(0,30).forEach(v=>{ const o=el("option"); o.value=v; d.appendChild(o); }); };
  fill("dlPayers",payers); fill("dlCards",cards);
}
/* 記帳時輸入新的付款人／卡片，自動加進常用清單 */
function rememberLists(payer, card){
  const p=P(), patch={};
  if(payer && !p.payers.includes(payer) && p.payers.length<50) patch.payers=[...p.payers, payer];
  if(card && !p.cards.includes(card) && p.cards.length<50) patch.cards=[...p.cards, card];
  if(Object.keys(patch).length) savePrefs(patch).catch(()=>{});
}

function defaultDate(){
  const {mode,y,m}=S.period, now=new Date();
  if(mode==="month" && !(y===now.getFullYear() && m===now.getMonth()+1)) return `${y}-${pad(m)}-01`;
  return todayStr();
}
function openEntry(e){
  const l=L(); if(!canEdit(l)) return;
  S.editing=e||null; msg("eMsg","");
  const proj=isProj(l), lb=stLabels(l);
  $("eTitle").textContent = e ? (e.inst?`編輯分期（第 ${e.inst.k}/${e.inst.n} 期）`:"編輯紀錄") : "記一筆";
  $("eDelete").hidden=!e; $("eDelete").textContent = e&&e.inst ? `刪除整組 ${e.inst.n} 期` : "刪除"; $("eDelete").dataset.armed="";
  S.eCat = e ? ((l.categories||[]).find(c=>c.id===e.categoryId) || {id:e.categoryId,name:e.categoryName,type:e.type}) : null;
  setEType(e ? e.type : "out");
  $("eAmount").value = e ? (e.inst ? e.inst.total : e.amount) || "" : "";
  $("eDate").value = e ? (e.inst ? e.inst.purchase : e.date) : defaultDate();
  fillPayOptions("ePay", e ? (e.pay||"現金") : (P().defaultPay || $("ePay").dataset.last || "現金"));
  $("eCard").value = e ? (e.card||"") : (P().defaultCard || $("eCard").dataset.last || "");
  $("eInstOn").checked = !!(e && e.inst);
  $("eInstN").value = e && e.inst ? e.inst.n : 12;
  $("eInstStart").value = e && e.inst ? e.inst.start : ($("eDate").value||todayStr()).slice(0,7);
  $("eNote").value = e ? (e.note||"") : "";
  $("ePayer").value = e ? (e.payer||"") : P().defaultPayer;
  $("eBudget").value = e && e.budget ? e.budget : "";
  $("ePriority").value = e ? (e.priority||"") : "";
  $("eStPaid").textContent=lb.paid; $("eStPend").textContent=lb.pending;
  setEStatus(e ? (e.status||"paid") : "paid");
  $("eProjBox").hidden=!proj; $("eMoreProj").hidden=!proj;
  $("eMore").open = proj || !!(e && (e.payer || isPending(e)));
  $("eBy").hidden = !(e && e.createdByEmail && (l.members||[]).length>1);
  if(e && e.createdByEmail) $("eBy").textContent = "由 " + e.createdByEmail + " 記錄";
  const w=weekOf(l,$("eDate").value); $("eWeek").textContent = w!=null?`（${w} 週）`:"";
  $("eAmount").min = proj ? "0" : "1";
  fillDatalists(); syncCardUI();
  $("dlgEntry").showModal();
  setTimeout(()=>$("eAmount").focus(), 50);
}
$("btnAdd").onclick=()=>openEntry(null);

/* 同一組分期的所有紀錄 */
async function groupDocs(l, g){
  const snap=await getDocs(query(collection(db,"ledgers",l.id,"entries"), where("inst.g","==",g)));
  return snap.docs;
}
/* 更新一筆（分期則整組一起改） */
async function updateEntries(l, e, patch){
  patch={...patch, updatedAt:serverTimestamp()};
  if(!e.inst){ await updateDoc(doc(db,"ledgers",l.id,"entries",e.id), patch); return; }
  const docs=await groupDocs(l, e.inst.g); const b=writeBatch(db);
  docs.forEach(d=>b.update(d.ref, patch)); await b.commit();
}
function buildInstallments(total, n, start, purchase){
  const g=rid()+rid(), base=Math.floor(total/n), day=Number(purchase.slice(8,10))||1, out=[];
  for(let k=1;k<=n;k++){
    const ym=addMonths(start,k-1);
    out.push({ amount: k<n ? base : total-base*(n-1), date:`${ym}-${pad(Math.min(day,dim(ym)))}`,
      inst:{ g, k, n, total, start, purchase } });
  }
  return out;
}

$("formEntry").addEventListener("submit", async ev=>{
  if(ev.submitter && ev.submitter.value==="cancel") return;
  ev.preventDefault();
  const l=L(), proj=isProj(l); const amt=Math.round(Number($("eAmount").value)||0);
  const budget=Math.max(0,Math.round(Number($("eBudget").value)||0));
  if(amt<0 || (!proj && amt<=0) || (proj && amt<=0 && !budget)){ msg("eMsg", proj?"請輸入金額或預算。":"請輸入大於 0 的金額。","err"); $("eAmount").focus(); return; }
  if(!S.eCat){ msg("eMsg","請先選一個分類。","err"); return; }
  const date=$("eDate").value; if(!/^\d{4}-\d{2}-\d{2}$/.test(date)){ msg("eMsg","請選擇日期。","err"); return; }
  const pay=$("ePay").value, isCard=pay==="信用卡";
  const inst = isCard && $("eInstOn").checked;
  const n=Math.round(Number($("eInstN").value)||0), start=$("eInstStart").value || date.slice(0,7);
  if(inst && (n<2 || n>60)){ msg("eMsg","分期期數要在 2～60 期之間。","err"); return; }
  if(inst && amt<n){ msg("eMsg","分期總金額太小。","err"); return; }
  const common={ type:S.eType, categoryId:S.eCat.id, categoryName:S.eCat.name,
    note:$("eNote").value.trim().slice(0,100), pay, card: isCard ? ($("eCard").value.trim() || (S.editing&&S.editing.card) || "").slice(0,20) : "",
    payer:$("ePayer").value.trim().slice(0,20), status:S.eStatus, updatedAt:serverTimestamp() };
  if(proj){ common.budget=budget; common.priority=$("ePriority").value; }
  $("ePay").dataset.last=pay; if(isCard) $("eCard").dataset.last=common.card;
  rememberLists(common.payer, common.card);
  $("eSave").disabled=true;
  try{
    const col=collection(db,"ledgers",l.id,"entries");
    const creator={ createdBy:S.user.uid, createdByEmail:S.email, createdAt:serverTimestamp() };
    const old=S.editing;
    // 舊的分期整組先刪掉（改期數、金額時重建最簡單也最不會出錯）
    const b=writeBatch(db);
    if(old && old.inst){ (await groupDocs(l, old.inst.g)).forEach(d=>b.delete(d.ref)); }
    else if(old && inst){ b.delete(doc(db,"ledgers",l.id,"entries",old.id)); }
    if(inst){
      buildInstallments(amt, n, start, date).forEach(p=>b.set(doc(col), {...common, ...creator, ...p}));
      await b.commit();
      toast(`已記下分期：${S.eCat.name} ${money(amt)}，分 ${n} 期`);
    } else if(old && !old.inst){
      await b.commit();
      await updateDoc(doc(db,"ledgers",l.id,"entries",old.id), {...common, amount:amt, date});
      toast("已更新");
    } else {
      b.set(doc(col), {...common, ...creator, amount:amt, date});
      await b.commit();
      const r=periodRange(); toast(`已記下：${S.eCat.name} ${money(amt)}` + (r && (date<r[0]||date>r[1]) ? `（記在 ${ymLabel(date.slice(0,7))}）`:""));
    }
    $("dlgEntry").close();
  }catch(err){ msg("eMsg","儲存失敗："+errText(err),"err"); }
  finally{ $("eSave").disabled=false; }
});
$("eDelete").onclick=async()=>{
  const b=$("eDelete");
  if(!b.dataset.armed){ b.dataset.armed="1"; b.textContent = S.editing.inst ? `確定刪除 ${S.editing.inst.n} 期？` : "確定刪除？"; return; }
  const l=L();
  try{
    if(S.editing.inst){ const bt=writeBatch(db); (await groupDocs(l, S.editing.inst.g)).forEach(d=>bt.delete(d.ref)); await bt.commit(); }
    else await deleteDoc(doc(db,"ledgers",S.lid,"entries",S.editing.id));
    $("dlgEntry").close(); toast("已刪除");
  }catch(err){ msg("eMsg","刪除失敗："+errText(err),"err"); }
};

/* ================= 設定 ================= */
$("btnSettings").onclick=()=>{ renderSettings(true); $("dlgSettings").showModal(); };
$("sClose").onclick=()=>$("dlgSettings").close();
function renderSettings(resetInputs){
  const l=L(); if(!l) return;
  const owner=isOwner(l), editor=canEdit(l);
  if(resetInputs){
    $("sName").value=l.name; $("sBudget").value=l.budget||0; S.sColor=l.color||COLORS[0];
    $("sProject").checked=isProj(l); $("sPBudget").value=l.projectBudget||0; $("sWeek").value=l.weekStart||"";
    ["sBasicMsg","sCatMsg","sShareMsg","sDangerMsg"].forEach(id=>msg(id,"")); $("sDelConfirm").value=""; $("sEmail").value="";
  }
  $("sName").disabled=!owner; $("sBudget").disabled=!editor; $("sSaveBasic").hidden=!editor;
  $("sProject").disabled=!owner; $("sWeek").disabled=!owner; $("sPBudget").disabled=!editor;
  $("sProjBox").hidden=!$("sProject").checked;
  swatches("sColors", S.sColor, c=>{ S.sColor=c; renderSettings(false); }, !owner);
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
$("sProject").addEventListener("change",()=>{ $("sProjBox").hidden=!$("sProject").checked; });
$("scOut").onclick=()=>{ S.sCatType="out"; renderSettings(false); };
$("scIn").onclick=()=>{ S.sCatType="in"; renderSettings(false); };

$("sSaveBasic").onclick=async()=>{
  const l=L(); const upd={ updatedAt:serverTimestamp() };
  upd.budget=Math.max(0,Math.round(Number($("sBudget").value)||0));
  upd.projectBudget=Math.max(0,Math.round(Number($("sPBudget").value)||0));
  if(isOwner(l)){ const n=$("sName").value.trim(); if(!n){ msg("sBasicMsg","帳本名稱不能空白。","err"); return; }
    upd.name=n; upd.color=S.sColor; upd.mode=$("sProject").checked?"project":"normal"; upd.weekStart=$("sWeek").value||""; }
  try{ await updateDoc(doc(db,"ledgers",l.id), upd); msg("sBasicMsg","已儲存。","ok");
    if(isOwner(l) && (upd.mode==="project")!==isProj(l)){ S.period.mode = upd.mode==="project" ? "all" : "month"; S.catFilter=null; watchEntries(); } }
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
    const snap=await getDocs(collection(db,"ledgers",l.id,"entries"));
    for(let i=0;i<snap.docs.length;i+=400){ const b=writeBatch(db); snap.docs.slice(i,i+400).forEach(d=>b.delete(d.ref)); await b.commit(); }
    stopEntries(); S.lid=null;
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

/* ================= 還款與分期 ================= */
function watchLoans(){
  stopLoans();
  S.loansReady=false;
  S.unsubLoans=onSnapshot(query(collection(db,"loans"), where("ownerUid","==",S.user.uid)), snap=>{
    S.loans=snap.docs.map(d=>({id:d.id, ...d.data()})); S.loansReady=true;
    if(location.hash==="#repay") renderRepay(false);
  }, e=>msg("repayMsg","讀取還款資料失敗："+errText(e),"err"));
}
function stopLoans(){ if(S.unsubLoans){ S.unsubLoans(); S.unsubLoans=null; } S.loans=[]; }

const loanStats = lo => {
  const pays=Object.values(lo.payments||{});
  const repaid=(lo.paidBase||0)+pays.reduce((a,p)=>a+(p.a||0),0);
  const periods=(lo.periodsBase||0)+pays.length;
  const remain=Math.max((lo.principal||0)-repaid,0);
  const leftPeriods = lo.totalPeriods ? Math.max(lo.totalPeriods-periods,0) : null;
  return { repaid, periods, remain, leftPeriods, done: remain<=0 };
};
$("rPrev").onclick=()=>{ S.rYM=addMonths(S.rYM,-1); renderRepay(); };
$("rNext").onclick=()=>{ S.rYM=addMonths(S.rYM,1); renderRepay(); };
$("rNow").onclick=()=>{ S.rYM=thisYM(); renderRepay(); };

let billToken=null;
function renderRepay(reloadBill=true){
  const ym=S.rYM;
  $("rTitle").textContent=ymLabel(ym); $("rNow").hidden = ym===thisYM();
  const active=[], done=[];
  S.loans.slice().sort((a,b)=>(a.type+a.name).localeCompare(b.type+b.name,"zh-Hant")).forEach(lo=>{
    const st=loanStats(lo); const paidThis=(lo.payments||{})[ym];
    (st.done && !paidThis ? done : active).push(lo); });
  let paid=0, unpaid=0, left=0;
  active.forEach(lo=>{ const p=(lo.payments||{})[ym]; if(p) paid+=p.a||0; else if(!loanStats(lo).done) unpaid+=lo.monthly||0; });
  S.loans.forEach(lo=>left+=loanStats(lo).remain);
  $("rPaid").textContent=fmt(paid); $("rUnpaid").textContent=fmt(unpaid); $("rLeft").textContent=fmt(left);
  const lb=$("loanList"); lb.textContent="";
  if(!S.loansReady) lb.appendChild(el("p","small muted","讀取中…"));
  else if(!active.length){ const e=el("div","empty"); e.appendChild(el("strong",null,"還沒有貸款或分期還款"));
    e.appendChild(document.createTextNode("按「＋ 新增」加入學貸、信貸、信用卡協商等。每個月按一下「標記已繳」，就會自動算剩幾期、剩多少，並記到你選的帳本。")); lb.appendChild(e); }
  active.forEach(lo=>lb.appendChild(loanCard(lo, ym)));
  $("loanDoneWrap").hidden=!done.length; $("loanDoneCount").textContent=done.length?`${done.length} 筆`:"";
  const db2=$("loanDone"); db2.textContent=""; done.forEach(lo=>db2.appendChild(loanCard(lo, ym)));
  S.rCardTotal = S.rCardTotal||0;
  $("rDue").textContent = money(paid+unpaid+(S.rCardTotal||0));
  if(reloadBill) loadCardBill(ym);
}
function loanCard(lo, ym){
  const st=loanStats(lo), p=(lo.payments||{})[ym];
  const c=el("div","loan");
  const h=el("div","loan-head"); const nm=el("div","loan-name"); nm.append(el("span","t",lo.type||"貸款"), document.createTextNode([lo.bank,lo.name].filter(Boolean).join(" ")||"未命名"));
  const edit=el("button","link","編輯"); edit.type="button"; edit.onclick=()=>openLoan(lo);
  h.append(nm, edit); c.appendChild(h);
  const meter=el("div","meter"); const bi=el("i"); bi.style.width = lo.principal ? Math.min(100,st.repaid/lo.principal*100)+"%" : "0"; meter.appendChild(bi); c.appendChild(meter);
  const nums=el("div","loan-nums");
  nums.append(el("span",null,`剩 ${money(st.remain)}`), el("span","muted",`原貸 ${fmt(lo.principal||0)}・已還 ${fmt(st.repaid)}`));
  c.appendChild(nums);
  const meta=[]; if(lo.monthly) meta.push(`月繳 ${fmt(lo.monthly)}`); if(lo.day) meta.push(`每月 ${lo.day} 號`);
  meta.push(lo.totalPeriods ? `已繳 ${st.periods}/${lo.totalPeriods} 期・剩 ${st.leftPeriods} 期` : `已繳 ${st.periods} 期`);
  if(lo.note) meta.push(lo.note);
  c.appendChild(el("div","loan-meta",meta.join("・")));
  const row=el("div","row");
  const ld=lo.ledgerId && S.ledgers.get(lo.ledgerId);
  row.appendChild(el("span","small muted", ld ? `已繳會記到「${ld.name}」` : "不會自動記帳"));
  if(p){ const b=el("button","paid-btn",`✓ ${Number(ym.slice(5))} 月已繳 ${fmt(p.a)}`); b.type="button"; b.title="再按一次可以取消";
    b.onclick=()=>{ if(!b.dataset.armed){ b.dataset.armed="1"; b.textContent="取消這個月的已繳？"; return; } unmarkPaid(lo, ym); };
    row.appendChild(b); }
  else if(!st.done){ const b=el("button","pay-btn", lo.monthly ? `標記已繳 ${fmt(lo.monthly)}` : "標記已繳"); b.type="button"; b.onclick=()=>openPay(lo, ym); row.appendChild(b); }
  c.appendChild(row);
  return c;
}

/* 標記已繳 */
function openPay(lo, ym){
  S.payLoan={lo, ym}; msg("pyMsg","");
  $("pyWhat").textContent=`${[lo.type,lo.bank,lo.name].filter(Boolean).join(" ")}・${ymLabel(ym)}`;
  $("pyAmount").value=lo.monthly||"";
  const ld=lo.ledgerId && S.ledgers.get(lo.ledgerId);
  $("pyNote").textContent = ld ? `會同時在「${ld.name}」記一筆支出。` : "沒有設定自動記帳（可在「編輯」裡設定）。";
  $("dlgPay").showModal(); setTimeout(()=>$("pyAmount").select(),50);
}
$("formPay").addEventListener("submit", async ev=>{
  if(ev.submitter && ev.submitter.value==="cancel") return;
  ev.preventDefault();
  const amt=Math.round(Number($("pyAmount").value)||0); if(amt<=0){ msg("pyMsg","請輸入金額。","err"); return; }
  $("pySave").disabled=true;
  try{ await markPaid(S.payLoan.lo, S.payLoan.ym, amt); $("dlgPay").close(); }
  catch(e){ msg("pyMsg","儲存失敗："+errText(e),"err"); }
  finally{ $("pySave").disabled=false; }
});
async function markPaid(lo, ym, amt){
  const rec={a:amt, l:"", e:""};
  const ld=lo.ledgerId && S.ledgers.get(lo.ledgerId);
  if(ld && canEdit(ld)){
    const cat=(ld.categories||[]).find(c=>c.id===lo.categoryId) || (ld.categories||[]).find(c=>c.type==="out");
    const st=loanStats(lo);
    const today=todayStr(); const day = ym===today.slice(0,7) ? Number(today.slice(8)) : (lo.day||1);
    const ref=doc(collection(db,"ledgers",ld.id,"entries"));
    await setDoc(ref, { type:"out", amount:amt, categoryId:cat?cat.id:"loan", categoryName:cat?cat.name:(lo.categoryName||"還款"),
      date:`${ym}-${pad(Math.min(day,dim(ym)))}`, note:`${[lo.type,lo.bank,lo.name].filter(Boolean).join(" ")} 第 ${st.periods+1} 期`.slice(0,100),
      pay:"轉帳", card:"", payer:"", status:"paid",
      createdBy:S.user.uid, createdByEmail:S.email, createdAt:serverTimestamp(), updatedAt:serverTimestamp() });
    rec.l=ld.id; rec.e=ref.id;
  }
  await updateDoc(doc(db,"loans",lo.id), { payments:{...(lo.payments||{}), [ym]:rec}, updatedAt:serverTimestamp() });
  toast(`已標記 ${ymLabel(ym)} 已繳 ${money(amt)}` + (rec.e?`，並記到「${ld.name}」`:""));
}
async function unmarkPaid(lo, ym){
  const p=(lo.payments||{})[ym]; if(!p) return;
  try{
    if(p.l && p.e){ try{ await deleteDoc(doc(db,"ledgers",p.l,"entries",p.e)); }catch(e){ /* 帳本沒權限或已刪，略過 */ } }
    const pays={...(lo.payments||{})}; delete pays[ym];
    await updateDoc(doc(db,"loans",lo.id), { payments:pays, updatedAt:serverTimestamp() });
    toast("已取消這個月的已繳");
  }catch(e){ toast("取消失敗："+errText(e)); }
}

/* 新增／編輯貸款 */
function fillLoanLedgers(selId, catId){
  const sel=$("loLedger"); sel.textContent="";
  const none=el("option",null,"不自動記帳"); none.value=""; sel.appendChild(none);
  [...S.ledgers.values()].filter(canEdit).forEach(l=>{ const o=el("option",null,l.name); o.value=l.id; o.selected=l.id===selId; sel.appendChild(o); });
  fillLoanCats(catId);
}
function fillLoanCats(catId){
  const l=S.ledgers.get($("loLedger").value), sel=$("loCat"); sel.textContent=""; sel.disabled=!l;
  if(!l){ sel.appendChild(el("option",null,"—")); return; }
  (l.categories||[]).filter(c=>c.type==="out").forEach(c=>{ const o=el("option",null,c.name); o.value=c.id; o.selected=c.id===catId; sel.appendChild(o); });
}
$("loLedger").addEventListener("change",()=>fillLoanCats(""));
function openLoan(lo){
  S.editingLoan=lo||null; msg("loMsg","");
  $("loTitle").textContent = lo ? "編輯貸款" : "新增貸款";
  const v=(id,x)=>$(id).value = x==null ? "" : x;
  v("loType",lo?lo.type:""); v("loName",lo?lo.name:""); v("loBank",lo?lo.bank:""); v("loDay",lo&&lo.day?lo.day:"");
  v("loPrincipal",lo?lo.principal:""); v("loMonthly",lo&&lo.monthly?lo.monthly:""); v("loTotal",lo&&lo.totalPeriods?lo.totalPeriods:"");
  v("loPeriodsBase",lo?lo.periodsBase||0:0); v("loPaidBase",lo?lo.paidBase||0:0); v("loNote",lo?lo.note:"");
  fillLoanLedgers(lo?lo.ledgerId:"", lo?lo.categoryId:"");
  $("loDelete").hidden=!lo; $("loDelete").textContent="刪除"; $("loDelete").dataset.armed="";
  // 還款紀錄（最近 12 個月＋有繳的月份）
  $("loHistory").hidden=!lo;
  if(lo){ const g=$("loGrid"); g.textContent="";
    const months=new Set(Object.keys(lo.payments||{})); for(let k=-11;k<=0;k++) months.add(addMonths(thisYM(),k));
    [...months].sort().forEach(ym=>{ const p=(lo.payments||{})[ym]; const c=el("div","pay-cell"+(p?"":" empty"));
      c.append(document.createTextNode(`${ym.slice(2,4)}/${ym.slice(5)}`), el("b",null,p?fmt(p.a):"—")); g.appendChild(c); }); }
  $("dlgLoan").showModal();
}
$("btnNewLoan").onclick=()=>openLoan(null);
$("formLoan").addEventListener("submit", async ev=>{
  if(ev.submitter && ev.submitter.value==="cancel") return;
  ev.preventDefault();
  const num=id=>Math.max(0,Math.round(Number($(id).value)||0));
  const type=$("loType").value.trim();
  if(!type){ msg("loMsg","請填品項，例如學貸、信貸。","err"); return; }
  if(!num("loPrincipal")){ msg("loMsg","請填原貸金額。","err"); return; }
  const ledgerId=$("loLedger").value, ld=S.ledgers.get(ledgerId), cat=ld && (ld.categories||[]).find(c=>c.id===$("loCat").value);
  const data={ type:type.slice(0,20), name:$("loName").value.trim().slice(0,30), bank:$("loBank").value.trim().slice(0,20),
    day:Math.min(num("loDay"),31), principal:num("loPrincipal"), monthly:num("loMonthly"), totalPeriods:num("loTotal"),
    periodsBase:num("loPeriodsBase"), paidBase:num("loPaidBase"), note:$("loNote").value.trim().slice(0,100),
    ledgerId: ld ? ledgerId : "", categoryId: cat ? cat.id : "", categoryName: cat ? cat.name : "", updatedAt:serverTimestamp() };
  $("loSave").disabled=true;
  try{
    if(S.editingLoan) await updateDoc(doc(db,"loans",S.editingLoan.id), data);
    else await addDoc(collection(db,"loans"), {...data, ownerUid:S.user.uid, payments:{}, createdAt:serverTimestamp()});
    $("dlgLoan").close(); toast(S.editingLoan?"已更新":"已新增");
  }catch(e){ msg("loMsg","儲存失敗："+errText(e),"err"); }
  finally{ $("loSave").disabled=false; }
});
$("loDelete").onclick=async()=>{
  const b=$("loDelete");
  if(!b.dataset.armed){ b.dataset.armed="1"; b.textContent="確定刪除？（已記到帳本的紀錄會保留）"; return; }
  try{ await deleteDoc(doc(db,"loans",S.editingLoan.id)); $("dlgLoan").close(); toast("已刪除"); }
  catch(e){ msg("loMsg","刪除失敗："+errText(e),"err"); }
};

/* 信用卡帳單：彙整所有看得到的帳本裡，這個月付款方式是信用卡的紀錄 */
async function loadCardBill(ym){
  const box=$("cardBill"); const token=billToken={}; S.rCardTotal=0; $("rCard").textContent="…";
  box.textContent=""; box.appendChild(el("p","small muted","讀取中…"));
  const a=`${ym}-01`, b=`${ym}-${pad(dim(ym))}`, rows=[];
  try{
    for(const l of S.ledgers.values()){
      const snap=await getDocs(query(collection(db,"ledgers",l.id,"entries"), where("date",">=",a), where("date","<=",b)));
      snap.docs.forEach(d=>{ const e=d.data(); if(e.pay==="信用卡" && e.type==="out") rows.push({...e, id:d.id, ledger:l}); });
    }
  }catch(e){ if(token!==billToken) return; box.textContent=""; box.appendChild(el("p","msg err","讀取信用卡紀錄失敗："+errText(e))); return; }
  if(token!==billToken) return;
  box.textContent="";
  const total=rows.reduce((s,e)=>s+e.amount,0);
  S.rCardTotal=total; $("rCard").textContent=fmt(total);
  renderRepay(false);
  if(!rows.length){ box.appendChild(el("p","small muted",`${ymLabel(ym)}沒有信用卡消費。記帳時付款方式選「信用卡」、填上卡片名稱，就會出現在這裡；分期的會自動顯示第幾期。`)); return; }
  const byCard=new Map(); rows.forEach(e=>{ const k=e.card||"未填卡片"; if(!byCard.has(k)) byCard.set(k,[]); byCard.get(k).push(e); });
  [...byCard.entries()].sort().forEach(([card,list])=>{
    const wrap=el("div","bill-card"); const sum=list.reduce((s,e)=>s+e.amount,0);
    const h=el("div","bill-head"); h.append(el("span",null,card), el("span","num",money(sum))); wrap.appendChild(h);
    const tw=el("div","table-wrap"), t=el("table","btable"), th=el("thead"), hr=el("tr");
    ["消費日","項目","期數","本期","剩餘"].forEach(x=>hr.appendChild(el("th",null,x))); th.appendChild(hr);
    const tb=el("tbody");
    list.sort((x,y)=>(x.inst?x.inst.purchase:x.date).localeCompare(y.inst?y.inst.purchase:y.date)).forEach(e=>{
      const tr=el("tr"); const pd=e.inst?e.inst.purchase:e.date;
      let per="一次付清", rem="—";
      if(e.inst){ const base=Math.floor(e.inst.total/e.inst.n); const left=e.inst.k>=e.inst.n?0:e.inst.total-base*e.inst.k;
        per=`${e.inst.k}/${e.inst.n}`; rem = left ? `${e.inst.n-e.inst.k} 期・${fmt(left)}` : "繳完"; }
      tr.append(el("td","num",pd.slice(5).replace("-","/")), el("td",null,`${e.note||e.categoryName}${e.payer?`（${e.payer}）`:""}・${e.ledger.name}`),
        el("td","num",per), el("td","num",fmt(e.amount)), el("td","num",rem));
      tb.appendChild(tr); });
    t.append(th,tb); tw.appendChild(t); wrap.appendChild(tw); box.appendChild(wrap);
  });
}

let resizeT; window.addEventListener("resize", ()=>{ clearTimeout(resizeT); resizeT=setTimeout(()=>{ if(S.lid && L()) renderTrend(); }, 150); });

/* ================= 外觀 ================= */
const ACCENTS=[["green","綠","#1d6b52"],["blue","藍","#2f5fa8"],["pink","粉","#b0406a"],["purple","紫","#6b4fa8"],["orange","橘","#a55a12"],["ink","墨","#33403b"]];
const store={ get:k=>{ try{return localStorage.getItem(k);}catch(e){return null;} }, set:(k,v)=>{ try{localStorage.setItem(k,v);}catch(e){} } };
const hex2rgb=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));
const rgb2hex=c=>"#"+c.map(v=>Math.round(Math.max(0,Math.min(255,v))).toString(16).padStart(2,"0")).join("");
const lum=c=>{ const f=v=>{ v/=255; return v<=.03928? v/12.92 : Math.pow((v+.055)/1.055,2.4); }; const [r,g,b]=c.map(f); return .2126*r+.7152*g+.0722*b; };
const contrast=(a,b)=>{ const x=lum(a), y=lum(b); return (Math.max(x,y)+.05)/(Math.min(x,y)+.05); };
const mix=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t);
function customVars(hex){
  const base=hex2rgb(hex), white=[255,255,255], black=[0,0,0], darkBg=[23,32,25], darkText=[10,21,16];
  let light=base; for(let t=0;t<=1 && contrast(light,white)<4.5;t+=.04) light=mix(base,black,t);
  let dark=base;  for(let t=0;t<=1 && (contrast(dark,darkText)<4.5||contrast(dark,darkBg)<3);t+=.04) dark=mix(base,white,t);
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
applyLook();

/* ================= 個人設定（存在 users/{uid}，各裝置同步） ================= */
function watchPrefs(){
  stopPrefs();
  S.unsubPrefs=onSnapshot(doc(db,"users",S.user.uid), s=>{
    S.prefs = s.exists() ? s.data() : {};
    if(!S.startApplied){ S.startApplied=true; const sp=P().startPage; if(sp && !location.hash) location.hash=sp; }
    if(location.hash==="#settings") renderGlobalSettings(false);
  }, ()=>{ S.prefs={}; S.startApplied=true; });
}
function stopPrefs(){ if(S.unsubPrefs){ S.unsubPrefs(); S.unsubPrefs=null; } S.prefs=null; }
async function savePrefs(patch){
  const next={...P(), ...patch}; S.prefs={...(S.prefs||{}), ...next};
  await setDoc(doc(db,"users",S.user.uid), {...next, updatedAt:serverTimestamp()});
}

function renderGlobalSettings(reset=true){
  document.querySelectorAll(".who-email").forEach(s=>s.textContent=S.user?S.user.email:"");
  renderLook();
  const p=P();
  if(reset){
    fillPayOptions("gsPay", p.defaultPay||"現金");
    $("gsPayer").value=p.defaultPayer; $("gsCard").value=p.defaultCard;
    const st=$("gsStart"); st.textContent="";
    [["","帳本列表"],["#repay","還款與分期"]].forEach(([v,t])=>{ const o=el("option",null,t); o.value=v; st.appendChild(o); });
    [...S.ledgers.values()].forEach(l=>{ const o=el("option",null,"帳本："+l.name); o.value="#l/"+l.id; st.appendChild(o); });
    st.value=p.startPage; if(st.value!==p.startPage) st.value="";
    const il=$("imLedger"), cur=il.value; il.textContent="";
    [...S.ledgers.values()].filter(canEdit).forEach(l=>{ const o=el("option",null,l.name+(isProj(l)?"（專案）":"")); o.value=l.id; il.appendChild(o); });
    if(cur) il.value=cur;
    if(!il.options.length){ const o=el("option",null,"請先建立一本帳本"); o.value=""; il.appendChild(o); }
  }
  const fill=(id,arr)=>{ const d=$(id); d.textContent=""; arr.forEach(v=>{ const o=el("option"); o.value=v; d.appendChild(o); }); };
  fill("dlGsPayers",p.payers); fill("dlGsCards",p.cards);
  document.querySelectorAll(".list-edit").forEach(box=>{
    const key=box.dataset.list, list=p[key], chips=box.querySelector(".chips"); chips.textContent="";
    if(!list.length) chips.appendChild(el("span","small muted","還沒有項目"));
    list.forEach(v=>{ const locked = key==="pays" && v==="信用卡";
      const b=el("button","chip"+(locked?"":" rm")); b.type="button"; b.append(document.createTextNode(v)); if(!locked) b.appendChild(el("span","x","✕"));
      b.disabled=locked; b.title=locked?"信用卡固定保留":"移除「"+v+"」";
      b.onclick=async()=>{ try{ await savePrefs({[key]: list.filter(x=>x!==v)}); msg("gsListMsg",`已移除「${v}」`,"ok"); renderGlobalSettings(false); }catch(e){ msg("gsListMsg","儲存失敗："+errText(e),"err"); } };
      chips.appendChild(b); });
    const inp=box.querySelector("input"), add=box.querySelector("button.btn");
    const go=async()=>{ const v=inp.value.trim(); if(!v) return;
      if(list.includes(v)){ msg("gsListMsg",`已經有「${v}」了`,"err"); return; }
      if(list.length>=50){ msg("gsListMsg","每個清單最多 50 項","err"); return; }
      try{ await savePrefs({[key]:[...list, v]}); inp.value=""; msg("gsListMsg",`已新增「${v}」`,"ok"); renderGlobalSettings(false); }catch(e){ msg("gsListMsg","儲存失敗："+errText(e),"err"); } };
    add.onclick=go; inp.onkeydown=e=>{ if(e.key==="Enter"){ e.preventDefault(); go(); } };
  });
}
$("gsSaveDefaults").onclick=async()=>{
  const patch={ defaultPay:$("gsPay").value, defaultPayer:$("gsPayer").value.trim().slice(0,20), defaultCard:$("gsCard").value.trim().slice(0,20), startPage:$("gsStart").value };
  const p=P();
  if(patch.defaultPayer && !p.payers.includes(patch.defaultPayer)) patch.payers=[...p.payers, patch.defaultPayer];
  if(patch.defaultCard && !p.cards.includes(patch.defaultCard)) patch.cards=[...p.cards, patch.defaultCard];
  try{ await savePrefs(patch); msg("gsDefMsg","已儲存。","ok"); renderGlobalSettings(false); }catch(e){ msg("gsDefMsg","儲存失敗："+errText(e),"err"); }
};

/* ---------- 匯出 ---------- */
function downloadCsv(name, rows){
  const esc=v=>{ v=String(v??""); return /[",\n]/.test(v) ? '"'+v.replace(/"/g,'""')+'"' : v; };
  const csv="\uFEFF"+rows.map(r=>r.map(esc).join(",")).join("\r\n");
  const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));
  a.download=name; document.body.appendChild(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); },500);
}
$("gsExportAll").onclick=async()=>{
  msg("gsExpMsg","匯出中…");
  try{
    const rows=[["帳本","日期","類型","分類","金額","預算","狀態","優先度","付款方式","卡片","分期","付款人","備註","記錄者"]];
    for(const l of S.ledgers.values()){
      const snap=await getDocs(collection(db,"ledgers",l.id,"entries")); const lb=stLabels(l);
      snap.docs.map(d=>d.data()).sort((x,y)=>x.date.localeCompare(y.date)).forEach(e=>rows.push([l.name, e.date, e.type==="in"?"收入":"支出", catName(l,e), e.amount, e.budget||"",
        isPending(e)?lb.pending:lb.paid, e.priority||"", e.pay, e.card||"", e.inst?`${e.inst.k}/${e.inst.n}`:"", e.payer||"", e.note, e.createdByEmail]));
    }
    downloadCsv(`記帳本備份_${todayStr()}.csv`, rows); msg("gsExpMsg",`已匯出 ${rows.length-1} 筆紀錄。`,"ok");
  }catch(e){ msg("gsExpMsg","匯出失敗："+errText(e),"err"); }
};
$("gsExportLoans").onclick=()=>{
  if(!S.loans.length){ msg("gsExpMsg","還沒有貸款資料。","err"); return; }
  const rows=[["品項","名稱","銀行","原貸金額","月繳","總期數","已繳期數","已還金額","剩餘金額","每月繳款日","備註","還款紀錄"]];
  S.loans.forEach(lo=>{ const st=loanStats(lo);
    rows.push([lo.type,lo.name,lo.bank,lo.principal,lo.monthly||"",lo.totalPeriods||"",st.periods,st.repaid,st.remain,lo.day||"",lo.note,
      Object.keys(lo.payments||{}).sort().map(k=>`${k}:${lo.payments[k].a}`).join("; ")]); });
  downloadCsv(`貸款備份_${todayStr()}.csv`, rows); msg("gsExpMsg",`已匯出 ${S.loans.length} 筆貸款。`,"ok");
};

/* ---------- 匯入 Excel／CSV ---------- */
const XLSX_URL="https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js";
let xlsxLoading=null;
function loadXlsx(){
  if(window.XLSX) return Promise.resolve(window.XLSX);
  if(!xlsxLoading) xlsxLoading=new Promise((ok,fail)=>{ const s=document.createElement("script"); s.src=XLSX_URL; s.onload=()=>ok(window.XLSX); s.onerror=()=>{ xlsxLoading=null; fail(new Error("讀取 Excel 元件失敗，請確認網路後再試。")); }; document.head.appendChild(s); });
  return xlsxLoading;
}
const IM_FIELDS=[["date","日期",/^日期$|預計日期|消費日|日期/],["cat","分類",/階段|類別|分類/],["item","項目",/項目|品項|名稱/],["note","備註",/備註|說明/],
  ["amount","金額（實際）",/實際支出|實際|金額|支出/],["budget","預算",/預算/],["status","狀態",/付款狀態|狀態/],["prio","優先度",/優先/],["payer","付款人",/付款人|誰付/],["pay","付款方式",/付款方式/]];
const IM={ wb:null, rows:[], header:0, map:{} };
function guessHeader(rows){
  let best=0, score=-1;
  rows.slice(0,60).forEach((r,i)=>{ const txt=r.map(c=>String(c||"")); const sc=IM_FIELDS.filter(([,,re])=>txt.some(t=>re.test(t))).length; if(sc>score){ score=sc; best=i; } });
  return best;
}
function guessMap(head){
  const used=new Set(), map={};
  IM_FIELDS.forEach(([k,,re])=>{ // 先找完全符合「日期」等，再找部分符合
    let idx=head.findIndex((h,i)=>!used.has(i) && re.test(String(h||"")) && !(k==="amount" && /差額/.test(h)));
    if(k==="date"){ const exact=head.findIndex(h=>String(h).trim()==="日期"); if(exact>=0) idx=exact; }
    if(idx>=0){ map[k]=idx; used.add(idx); } else map[k]=-1;
  });
  return map;
}
function parseDate(v){
  if(v==null || v==="") return "";
  if(typeof v==="number" && v>20000 && v<80000 && window.XLSX){ const d=XLSX.SSF.parse_date_code(v); return `${d.y}-${pad(d.m)}-${pad(d.d)}`; }
  if(v instanceof Date && !isNaN(v)) return `${v.getFullYear()}-${pad(v.getMonth()+1)}-${pad(v.getDate())}`;
  const s=String(v).trim(); let m;
  if((m=s.match(/^(\d{4})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})/))) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  if((m=s.match(/^(\d{4})[\/\-.年](\d{1,2})月?$/))) return `${m[1]}-${pad(m[2])}-01`;
  if((m=s.match(/^(\d{2,3})[\/.](\d{1,2})[\/.](\d{1,2})$/))) return `${Number(m[1])+1911}-${pad(m[2])}-${pad(m[3])}`; // 民國年
  if((m=s.match(/^(\d{1,2})[\/](\d{1,2})$/))) return `${new Date().getFullYear()}-${pad(m[1])}-${pad(m[2])}`;
  return "";
}
const toNum = v => { if(typeof v==="number") return v; const n=Number(String(v||"").replace(/[,\s$NT元]/g,"")); return isNaN(n)?0:n; };
function imRows(){
  const out=[], cell=(r,k)=>IM.map[k]>=0 ? r[IM.map[k]] : "";
  IM.rows.slice(IM.header+1).forEach(r=>{
    const item=String(cell(r,"item")||"").trim(), note=String(cell(r,"note")||"").trim();
    const amount=Math.max(0,Math.round(toNum(cell(r,"amount")))), budget=Math.max(0,Math.round(toNum(cell(r,"budget"))));
    if(!item && !amount && !budget) return;
    const st=String(cell(r,"status")||"");
    out.push({ date: parseDate(cell(r,"date")) || todayStr(), cat:String(cell(r,"cat")||"").trim()||"其他",
      note:[item,note].filter(Boolean).join("・").slice(0,100), amount, budget,
      status: /未/.test(st) ? "pending" : "paid", prio: ["高","中","低"].includes(String(cell(r,"prio")).trim()) ? String(cell(r,"prio")).trim() : "",
      payer:String(cell(r,"payer")||"").trim().slice(0,20), pay:String(cell(r,"pay")||"").trim().slice(0,20)||"現金" });
  });
  return out;
}
function renderImport(){
  const head=(IM.rows[IM.header]||[]).map(h=>String(h||"").trim());
  const mg=$("imMap"); mg.textContent="";
  IM_FIELDS.forEach(([k,label])=>{ const lab=el("label",null,label); const sel=el("select");
    const none=el("option",null,"（不使用）"); none.value="-1"; sel.appendChild(none);
    head.forEach((h,i)=>{ const o=el("option",null,h||`第 ${i+1} 欄`); o.value=String(i); sel.appendChild(o); });
    sel.value=String(IM.map[k]); sel.onchange=()=>{ IM.map[k]=Number(sel.value); renderImport(); };
    lab.appendChild(sel); mg.appendChild(lab); });
  const rows=imRows(), l=S.ledgers.get($("imLedger").value), proj=isProj(l);
  const usable=rows.filter(x=>proj || x.amount>0);
  const t=$("imPreview"); t.textContent="";
  const th=el("thead"), hr=el("tr"); ["日期","分類","項目・備註","金額","預算","狀態","付款人"].forEach(x=>hr.appendChild(el("th",null,x))); th.appendChild(hr);
  const tb=el("tbody"); rows.slice(0,8).forEach(x=>{ const tr=el("tr");
    tr.append(el("td",null,x.date), el("td",null,x.cat), el("td",null,x.note), el("td","num",fmt(x.amount)), el("td","num",x.budget?fmt(x.budget):"—"),
      el("td",null,x.status==="pending"?"未完成":"完成"), el("td",null,x.payer||"—")); tb.appendChild(tr); });
  t.append(th,tb);
  const newCats=[...new Set(usable.map(x=>x.cat))].filter(n=>!(l&&(l.categories||[]).some(c=>c.type==="out"&&c.name===n)));
  $("imSummary").textContent = !l ? "請先選擇要匯入的帳本。" :
    `共找到 ${rows.length} 筆，會匯入 ${usable.length} 筆到「${l.name}」` + (rows.length>usable.length?`（${rows.length-usable.length} 筆沒有實際金額，一般帳本不匯入；專案帳本才能只記預算）`:"") +
    (newCats.length?`，並新增分類：${newCats.slice(0,10).join("、")}${newCats.length>10?"…":""}`:"") + "。沒有日期的會用今天。";
  $("imGo").disabled = !l || !usable.length;
  $("imGo").textContent = usable.length ? `匯入 ${usable.length} 筆` : "匯入";
}
function loadSheet(){
  const ws=IM.wb.Sheets[$("imSheet").value];
  IM.rows=XLSX.utils.sheet_to_json(ws,{header:1, raw:true, defval:""});
  IM.header=guessHeader(IM.rows); $("imHeaderRow").value=IM.header+1;
  IM.map=guessMap((IM.rows[IM.header]||[]).map(h=>String(h||"").trim()));
  renderImport();
}
$("imFile").addEventListener("change", async ()=>{
  const f=$("imFile").files[0]; if(!f) return;
  msg("imMsg","讀取中…"); $("imStep2").hidden=true;
  try{
    const X=await loadXlsx();
    IM.wb=X.read(await f.arrayBuffer(), {type:"array"});
    const ss=$("imSheet"); ss.textContent=""; IM.wb.SheetNames.forEach(n=>{ const o=el("option",null,n); o.value=n; ss.appendChild(o); });
    loadSheet(); $("imStep2").hidden=false; msg("imMsg","");
  }catch(e){ msg("imMsg","讀不到這個檔案："+(e.message||e),"err"); }
});
$("imSheet").addEventListener("change", loadSheet);
$("imHeaderRow").addEventListener("change", ()=>{ IM.header=Math.max(0,Number($("imHeaderRow").value||1)-1); IM.map=guessMap((IM.rows[IM.header]||[]).map(h=>String(h||"").trim())); renderImport(); });
$("imLedger").addEventListener("change", ()=>{ if(IM.wb) renderImport(); });
$("imGo").onclick=async()=>{
  const l=S.ledgers.get($("imLedger").value); if(!l) return;
  const proj=isProj(l), rows=imRows().filter(x=>proj || x.amount>0);
  $("imGo").disabled=true; msg("imMsg","匯入中…");
  try{
    // 先補齊分類
    const cats=[...(l.categories||[])];
    [...new Set(rows.map(x=>x.cat))].forEach(n=>{ if(!cats.some(c=>c.type==="out"&&c.name===n)) cats.push({id:rid(),name:n.slice(0,40),type:"out"}); });
    if(cats.length!==(l.categories||[]).length) await updateDoc(doc(db,"ledgers",l.id), {categories:cats, updatedAt:serverTimestamp()});
    const col=collection(db,"ledgers",l.id,"entries");
    for(let i=0;i<rows.length;i+=400){
      const b=writeBatch(db);
      rows.slice(i,i+400).forEach(x=>{ const c=cats.find(c=>c.type==="out"&&c.name===x.cat);
        const d={ type:"out", amount:x.amount, categoryId:c.id, categoryName:c.name, date:x.date, note:x.note, pay:x.pay, card:"", payer:x.payer, status:x.status,
          createdBy:S.user.uid, createdByEmail:S.email, createdAt:serverTimestamp(), updatedAt:serverTimestamp() };
        if(proj){ d.budget=x.budget; d.priority=x.prio; }
        b.set(doc(col), d); });
      await b.commit();
    }
    msg("imMsg",`已匯入 ${rows.length} 筆到「${l.name}」。`,"ok"); toast(`已匯入 ${rows.length} 筆`);
    $("imFile").value=""; $("imStep2").hidden=true; IM.wb=null;
  }catch(e){ msg("imMsg","匯入失敗："+errText(e),"err"); }
  finally{ $("imGo").disabled=false; }
};
