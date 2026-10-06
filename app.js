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
  prefs:null, unsubPrefs:null, startApplied:false,
  holdings:[], unsubHoldings:null, holdingsReady:false, tdEdit:null, tdType:"b", hdId:null
};
const DEFAULT_PAYS=["現金","信用卡","悠遊卡","行動支付","轉帳","其他"];
const P = () => { const p=S.prefs||{}; return { defaultPay:p.defaultPay||"", defaultPayer:p.defaultPayer||"", defaultCard:p.defaultCard||"", startPage:p.startPage||"", lastBackup:p.lastBackup||0, tourDone:!!p.tourDone, tips:Array.isArray(p.tips)?p.tips:[],
  payers:p.payers||[], cards:p.cards||[], pays:(p.pays&&p.pays.length?p.pays:DEFAULT_PAYS),
  inv:{ disc:numOr(p.inv&&p.inv.disc,10), min:numOr(p.inv&&p.inv.min,20), fx:numOr(p.inv&&p.inv.fx,32) },
  me:typeof p.me==="string"?p.me:"", cardSet:p.cardSet&&typeof p.cardSet==="object"?p.cardSet:{}, xfer:p.xfer&&typeof p.xfer==="object"?p.xfer:{} }; };
function numOr(v,d){ return typeof v==="number" && isFinite(v) ? v : d; }
const L = () => S.ledgers.get(S.lid);
const isOwner = l => l && S.user && l.ownerUid === S.user.uid;
const canEdit = l => l && (isOwner(l) || (l.editors||[]).includes(S.email));
const roleText = l => isOwner(l) ? "擁有者" : canEdit(l) ? "可編輯" : "僅檢視";
const isProj = l => l && l.mode === "project";
const stLabels = (l, type) => isProj(l) ? {paid:"完成", pending:"未完成"} : type==="in" ? {paid:"已收到", pending:"未收到"} : {paid:"已付款", pending:"未付款"};
const IN_PAYS=["轉帳","現金","行動支付","其他"];
const isPending = e => e.status === "pending";
/* 分期手續費：每期多出來的利息／手續費另外記成一筆，分類固定用這個 id */
const FEE_CAT={id:"instfee", name:"分期手續費"};
const isFee = e => e && e.categoryId===FEE_CAT.id && !!e.inst;
/* 代墊請款：rb = {s:"pending"|"done", a:收回金額, d:收到日期}。請款中不算自己的支出；收回後只算沒補回的差額 */
const isRb = e => !!(e && e.type==="out" && e.rb && (e.rb.s==="pending" || e.rb.s==="done"));
/* 付款人：paid = {名字: 金額}（不只一個人付時）；沒有時就是 payer 一個人付全部 */
const paidMap = e => e && e.paid && typeof e.paid==="object" && Object.keys(e.paid).length ? e.paid : null;
const own = e => !isRb(e) ? (e.amount||0) : e.rb.s==="done" ? Math.max((e.amount||0)-(e.rb.a||0),0) : 0;
/* 專案用：同一組分期算一個項目（金額加總，預算只算一次） */
function projItems(entries){
  const m=new Map();
  entries.filter(e=>e.type==="out").forEach(e=>{
    const k=e.inst ? "g:"+e.inst.g+(isFee(e)?":f":"") : e.id;
    const it=m.get(k)||{categoryId:e.categoryId, categoryName:e.categoryName, amount:0, budget:0, pending:isPending(e)};
    it.amount+=own(e); it.budget=Math.max(it.budget, e.budget||0); m.set(k,it);
  });
  return [...m.values()];
}

/* ================= 畫面切換 ================= */
const VIEWS = ["viewSetup","viewLoading","viewLogin","viewVerify","viewHome","viewRepay","viewInvest","viewLists","viewList","viewSettings","viewLedger"];
function show(v){ VIEWS.forEach(id=>$(id).hidden = id!==v); }

if(!configured){ show("viewSetup"); }
else {
  onAuthStateChanged(auth, async user => {
    stopLedgers(); stopEntries(); stopLoans(); stopHoldings(); stopPrefs(); stopLists(); stopItems(); S.itemsFor=null; stopSnaps();
    S.user = user; S.email = user && user.email ? user.email.toLowerCase() : "";
    if(!user){ show("viewLogin"); return; }
    if(!user.emailVerified){ $("verifyEmail").textContent=user.email; show("viewVerify"); return; }
    signedInStart();
  });
}
function signedInStart(){
  document.querySelectorAll(".who-email").forEach(s=>s.textContent=S.user.email);
  S.startApplied = !!location.hash; // 網址已經指定頁面時，不套用「直接進入」
  watchLedgers(); watchLoans(); watchHoldings(); watchLists(); watchSnaps(); watchPrefs(); route();
}
window.addEventListener("hashchange", ()=>{ if(S.user && S.user.emailVerified) route(); });

function route(){
  const m = location.hash.match(/^#l\/([A-Za-z0-9_-]+)/);
  const lm = location.hash.match(/^#list\/([A-Za-z0-9_-]+)/);
  if(!lm){ S.listId=null; if(S.itemsFor){ stopItems(); S.itemsFor=null; } }
  if(m){ openLedger(m[1]); return; }
  if(lm){ S.lid=null; S.viewInitFor=null; stopEntries(); stopAA(); stopRb(); openList(lm[1]); return; }
  S.lid=null; S.viewInitFor=null; stopEntries(); stopAA(); stopRb(); document.title="記帳本";
  if(location.hash==="#repay"){ show("viewRepay"); renderRepay(); return; }
  if(location.hash==="#invest"){ show("viewInvest"); renderInvest(); return; }
  if(location.hash==="#lists"){ show("viewLists"); renderLists(); return; }
  if(location.hash==="#settings"){ show("viewSettings"); renderGlobalSettings(); return; }
  show("viewHome"); renderHome();
}

/* ================= 登入 ================= */
/* 其他 App 的內建瀏覽器（FB、IG、Messenger…）會擋 Google 登入，提醒改用瀏覽器 */
if(/FBAN|FBAV|Instagram|Messenger|MicroMessenger|; wv\)/i.test(navigator.userAgent||"") && !/\bLine\//i.test(navigator.userAgent||"")) $("inAppWarn").hidden=false;
const shareUrl = () => location.origin + location.pathname + "?openExternalBrowser=1";
$("gsShareLink").onclick=async()=>{
  const u=shareUrl();
  try{ await navigator.clipboard.writeText(u); toast("已複製分享連結，可以直接貼到 LINE"); }
  catch(e){ prompt("複製這個連結：", u); }
};
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

function renderBackupReminder(){
  const b=$("bkReminder"); if(!b) return;
  if(!S.prefs || !S.ledgersReady || !S.ledgers.size){ b.hidden=true; return; }
  const last=P().lastBackup, days=last ? Math.floor((Date.now()-last)/864e5) : null;
  const oldest=Math.min(...[...S.ledgers.values()].map(l=>l.createdAt&&l.createdAt.toMillis ? l.createdAt.toMillis() : l.createdAt&&l.createdAt.seconds ? l.createdAt.seconds*1000 : Date.now()));
  const show = last ? days>=30 : (Date.now()-oldest) > 3*864e5;
  b.hidden=!show;
  $("bkReminderText").textContent = last ? `已經 ${days} 天沒有備份了，建議備份一次到 Google 雲端硬碟。` : "還沒有備份過資料，建議備份一次到 Google 雲端硬碟。";
}
function renderHome(){
  renderBackupReminder(); setTimeout(maybeStartTour, 50);
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
/* 顏色按鈕：只更新選取狀態，不重畫調色盤（重畫會讓瀏覽器的調色盤視窗被關掉） */
function swatches(boxId, current, onPick, disabled){
  const box=$(boxId); box.textContent="";
  const btns=[];
  const mark=c=>{ btns.forEach(b=>b.setAttribute("aria-pressed", b.dataset.c===c)); const custom=!COLORS.includes(c);
    w.setAttribute("aria-pressed", custom); w.style.background = custom ? c : ""; };
  COLORS.forEach(c=>{ const s=el("button","swatch"); s.type="button"; s.style.background=c; s.dataset.c=c; s.setAttribute("aria-label","顏色 "+c);
    s.disabled=!!disabled; s.onclick=()=>{ onPick(c); mark(c); }; btns.push(s); box.appendChild(s); });
  const w=el("label","swatch-pick"); w.title="自訂顏色";
  const inp=el("input"); inp.type="color"; inp.value=current && !COLORS.includes(current) ? current : "#888888"; inp.disabled=!!disabled; inp.setAttribute("aria-label","自訂顏色");
  inp.addEventListener("input", ()=>{ onPick(inp.value); mark(inp.value); });
  w.appendChild(inp); box.appendChild(w);
  mark(current||COLORS[0]);
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
  swatches("nColors", S.newColor, c=>{ S.newColor=c; });
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
  S.viewInitFor=S.lid; stopEntries(); stopAA(); stopRb();
  S.catFilter=null; S.stFilter="all"; S.catView="out"; $("search").value="";
  const d=new Date(); S.period={mode: isProj(L()) ? "all" : "month", y:d.getFullYear(), m:d.getMonth()+1};
}
function renderLedgerHead(){
  const l=L(); if(!l) return;
  initLedgerView();
  $("lName").textContent=l.name; $("lDot").style.background=l.color||COLORS[0];
  $("lRole").textContent=roleText(l); document.title=l.name+"｜記帳本";
  $("btnAdd").hidden=!canEdit(l);
  renderLedgerTips(l);
  ensureAA(l); ensureRb(l);
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
  const buy = instAtBuy(L());
  // 分期記在刷卡當月：另外抓「刷卡日」在這段期間的分期
  let a=null, b= buy && r ? null : [], ready=0;
  const merge=()=>{ if(token!==S.entriesToken || a==null || b==null) return;
    const m=new Map(); [...a, ...b].forEach(e=>m.set(e.id,e));
    S.entries = buy ? foldInst([...m.values()], r) : [...m.values()]; S.entriesReady=true; renderAll(); };
  const fail=e=>{ if(token!==S.entriesToken) return; S.entriesReady=true; renderAll(); toast("讀取紀錄失敗："+errText(e)); };
  S.unsubEntries=onSnapshot(q, snap=>{ a=snap.docs.map(d=>({id:d.id, ...d.data()})); merge(); }, fail);
  if(buy && r) S.unsubEntries2=onSnapshot(query(col, where("inst.purchase",">=",r[0]), where("inst.purchase","<=",r[1])), snap=>{ b=snap.docs.map(d=>({id:d.id, ...d.data()})); merge(); }, fail);
}
function stopEntries(){ S.entriesToken=null; if(S.unsubEntries){ S.unsubEntries(); S.unsubEntries=null; } if(S.unsubEntries2){ S.unsubEntries2(); S.unsubEntries2=null; } S.entries=[]; }
/* 帳本設定「分期消費記在刷卡當月」 */
const instAtBuy = l => !!l && l.instAt==="buy";
/* 把同一組分期（商品、手續費分開）合成一筆，日期用刷卡日、金額用全部期數加總 */
function foldInst(list, r){
  const out=[], groups=new Map();
  list.forEach(e=>{
    if(!e.inst){ out.push(e); return; }
    const pd=e.inst.purchase||e.date; if(r && (pd<r[0] || pd>r[1])) return;
    const k=e.inst.g+"|"+e.categoryId; let g=groups.get(k);
    if(!g){ g={...e, amount:0, date:pd, _fold:[], _first:e}; groups.set(k,g); out.push(g); }
    g.amount+=e.amount; g._fold.push(e);
    if(e.inst.k < g._first.inst.k){ g._first=e; }
  });
  groups.forEach(g=>{ const f=g._first; g.id=f.id; g.inst={...f.inst}; g._per=f.amount; g._start=f.date.slice(0,7); g.status = g._fold.some(isPending) ? "pending" : "paid"; });
  return out;
}

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
  renderTotals(l); renderCats(l); renderTrend(); renderRb();
  const table = mode!=="month";
  $("listPanel").hidden = table && !isProj(l); $("yearPanel").hidden = !table;
  if(table) renderYearTable();
  if(!$("listPanel").hidden) renderList();
}

function renderTotals(l){
  let o=0,i=0,pn=0,pa=0; S.entries.forEach(e=>{ if(e.type==="in") i+=e.amount; else o+=own(e); if(isPending(e)){ pn++; pa+=e.amount; } });
  const rr=periodRange(), rbp=(S.rbPending||[]).filter(e=>!rr || (e.date>=rr[0] && e.date<=rr[1])); $("rbNote").hidden=!rbp.length;
  if(rbp.length) $("rbNote").textContent=`另有代墊待請款 ${rbp.length} 筆，共 ${money(rbp.reduce((t,e)=>t+e.amount,0))}（不算在支出裡）`;
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
    $("pjNote").textContent = pb ? `已用總預算 ${Math.round(o/pb*100)}%` + (mode!=="all"?"（目前只算這段期間，切到「全部」看整個專案）":"") : (canEdit(l)?"可在「帳本設定」裡設定專案總預算":"");
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
    $("bLeft").textContent = canEdit(l) ? "可在「帳本設定」裡設定每月預算" : ""; $("bExtra").textContent="";
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
    if(S.catView==="payer" && paidMap(e)){ const pm=paidMap(e), t=Object.values(pm).reduce((a,b)=>a+(Number(b)||0),0)||1, v0=own(e);
      Object.entries(pm).forEach(([p,a])=>{ const v=v0*(Number(a)||0)/t; if(!v) return; const k="p:"+p; const cur=sums.get(k)||{name:p,v:0}; cur.v+=v; sums.set(k,cur); tot+=v; }); return; }
    const k = S.catView==="payer" ? "p:"+(e.payer||"") : e.categoryId;
    const name = S.catView==="payer" ? (e.payer||"未填付款人") : catName(l,e);
    const v=e.type==="out"?own(e):e.amount; if(!v && e.type==="out" && isRb(e)) return;
    const cur=sums.get(k)||{name,v:0}; cur.v+=v; sums.set(k,cur); tot+=v; });
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
    S.entries.forEach(e=>{ if(e.type==="out"){ const k=Number(e.date.slice(8,10))-1; if(k>=0&&k<dm) d[k]+=own(e); } });
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
    S.entries.forEach(e=>{ const k=idx.get(e.date.slice(0,7)); if(k!=null) (e.type==="in"?i:o)[k]+=(e.type==="in"?e.amount:own(e)); });
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
  const lb=stLabels(l, e.type), p=isPending(e);
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
    const dt=new Date(date+"T00:00"); const out=g.filter(e=>e.type==="out").reduce((a,e)=>a+own(e),0);
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
      else if(e.inst && e._fold) meta.push(`${e.card||"信用卡"} 分期 ${e.inst.n} 期・${Number(e._start.slice(5))} 月起每期 ${fmt(e._per)}`);
      else if(e.inst) meta.push(`${e.card||"信用卡"} 分期 ${e.inst.k}/${e.inst.n}`); else if(e.card) meta.push(`${e.pay}・${e.card}`); else if(e.pay) meta.push(e.pay);
      if(paidMap(e) && !e.inst) meta.push(Object.entries(paidMap(e)).map(([p,a])=>`${p} ${fmt(a)}`).join("＋")+" 付");
      else if(e.payer) meta.push(e.payer+(e.type==="in"?" 的收入":" 付"));
      if(isRb(e)) meta.push(e.rb.s==="pending" ? "代墊・請款中" : `代墊・${e.rb.d?e.rb.d.slice(5).replace("-","/")+" ":""}已收回 ${fmt(e.rb.a||0)}`);
      if(aaOn(l) && e.type==="out" && e.split && e.split.m==="s") meta.push("只算付款人");
      if(aaOn(l) && e.type==="out" && e.split && e.split.m==="c") meta.push("自訂分攤 "+l.split.people.map(p=>`${p}${(e.split.r||{})[p]||0}%`).join("／"));
      if(aaOn(l) && e.type==="out" && e.split && e.split.m==="a"){ const r=e.split.r||{}, tot=l.split.people.reduce((t,p)=>t+(r[p]||0),0)||1;
        meta.push("自訂分攤 "+l.split.people.map(p=>`${p} ${e.inst ? fmt(e.amount*(r[p]||0)/tot) : fmt(r[p]||0)}`).join("／")); }
      if(shared && e.createdByEmail) meta.push(e.createdByEmail===S.email?"我記的":e.createdByEmail.split("@")[0]+" 記的");
      main.appendChild(el("div","meta", meta.join("・")));
      const right=el("div","entry-right");
      right.appendChild(e.amount ? el("span","num "+(e.type==="in"?"c-in":"c-out"), (e.type==="in"?"+":"−")+fmt(e.amount)) : el("span","num muted","未填"));
      if(proj && e.budget) right.appendChild(el("span","sub",`預算 ${fmt(e.budget)}`));
      if(isRb(e)) right.appendChild(el("span","sub rb-sub", e.rb.s==="pending" ? "不算支出" : own(e) ? `自付 ${fmt(own(e))}` : "已全額收回"));
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
  S.entries.forEach(e=>{ const k=idx.get(e.date.slice(0,7)); if(k==null) return; (e.type==="in"?i:o)[k]+=(e.type==="in"?e.amount:own(e)); n[k]++; });
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
function setEType(t){ S.eType=t;
  // 收入時：付款人 → 誰的收入，付款方式 → 收款方式
  { const lx=L(); $("ePayerLabel").textContent = t==="in" ? "誰的收入（選填）" : (lx && aaOn(lx)) ? "① 誰先付的錢（必填）" : "付款人（選填）"; }
  $("ePayLabel").textContent = t==="in" ? "收款方式" : "付款方式";
  $("eNote").placeholder = t==="in" ? "例如：9 月薪水" : "例如：午餐便當";
  if($("eMultiPayWrap")) renderMultiPay();
  syncRbUI();
  const l0=L(); if(l0 && !isProj(l0)){ const lb=stLabels(l0, t); $("eStPaid").textContent=lb.paid; $("eStPend").textContent=lb.pending; }
  if($("dlgEntry").open){ const cur=$("ePay").value; fillPayOptions("ePay", t==="in" ? cur : (cur||P().defaultPay||"現金"), t); syncCardUI(); } $("eOut").setAttribute("aria-pressed",t==="out"); $("eIn").setAttribute("aria-pressed",t==="in"); renderEntryCats(); if(S.eSplit) renderSplitUI(); }
$("eOut").onclick=()=>setEType("out"); $("eIn").onclick=()=>setEType("in");
function setEStatus(s){ S.eStatus=s; $("eStPaid").setAttribute("aria-pressed",s==="paid"); $("eStPend").setAttribute("aria-pressed",s==="pending"); }
$("eStPaid").onclick=()=>setEStatus("paid"); $("eStPend").onclick=()=>setEStatus("pending");

function syncCardUI(){
  const isCard=$("ePay").value==="信用卡";
  $("eCardWrap").hidden=!isCard;
  tipsFor("tipCard", isCard ? [["card4","勾選「分期付款」並填期數，系統會把金額自動分到之後每個月。每期金額不一樣（例如第一期多幾塊、有利息）可以在「每期金額」選「自己填」，多出來的利息會另外記成「分期手續費」。出差先幫公司刷的，勾「代墊」就不會算成自己的支出。商家比較晚請款、沒出現在原本那期帳單的，可以在「算在哪個月的帳單」改到下一期。"]] : []);
  const on=isCard && $("eInstOn").checked; syncRbUI();
  $("eInstBox").hidden=!on; $("eInstNote").hidden=!on; $("eInstModeBox").hidden=!on; if(!on) $("eInstFeeWrap").hidden=true;
  $("eAmtLabel").textContent = on ? (S.instMode==="custom" ? "消費金額" : "總金額") : "";
  if(on) renderInstList();
  if(isCard) renderCardChips();
  renderBillSel();
}
/* 這筆消費照卡片設定會算在哪個月繳的帳單 */
function autoBillYm(card, date){
  const m=date.slice(0,7);
  for(let k=0;k<3;k++){ const ym=addMonths(m,k), [s0,e0]=cardRange(card, ym); if(date>=s0 && date<=e0) return ym; }
  return m;
}
function renderBillSel(){
  const isCard=$("ePay").value==="信用卡", inst=isCard && $("eInstOn").checked, date=$("eDate").value;
  $("eBillWrap").hidden = !isCard || inst || !/^\d{4}-\d{2}-\d{2}$/.test(date);
  if($("eBillWrap").hidden) return;
  const sel=$("eBill"), cur = sel.dataset.v ?? sel.value, card=$("eCard").value.trim(), auto=autoBillYm(card, date);
  sel.textContent="";
  const o0=el("option",null,`自動（${Number(auto.slice(5))} 月繳的帳單）`); o0.value=""; sel.appendChild(o0);
  for(let k=-1;k<=3;k++){ const ym=addMonths(date.slice(0,7),k); if(ym===auto) continue; const o=el("option",null,`${ymLabel(ym)}繳的帳單`); o.value=ym; sel.appendChild(o); }
  sel.value=cur||""; if(sel.value!==(cur||"")){ const o=el("option",null,`${ymLabel(cur)}繳的帳單`); o.value=cur; sel.appendChild(o); sel.value=cur; }
  delete sel.dataset.v;
}
$("eBill").addEventListener("change",()=>{ $("eBill").dataset.v=$("eBill").value; });
$("eCard").addEventListener("input",renderBillSel);
$("eCardChips").addEventListener("click",()=>setTimeout(renderBillSel,0));
$("eDate").addEventListener("change",renderBillSel);
function renderInstList(){
  document.querySelectorAll("#eInstMode button").forEach(b=>b.setAttribute("aria-pressed", b.dataset.m===S.instMode));
  const box=$("eInstList"); box.textContent="";
  const amts=instAmts(), start=$("eInstStart").value||thisYM(), custom=S.instMode==="custom";
  if(custom) S.instCustom=amts.slice();
  amts.forEach((v,i)=>{
    const c=el("label","inst-cell"); const ym=addMonths(start,i);
    c.appendChild(document.createTextNode(`第 ${i+1} 期・${ym.slice(2,4)}/${ym.slice(5)}`));
    const inp=el("input"); inp.type="number"; inp.min="0"; inp.inputMode="numeric"; inp.value=v; inp.readOnly=!custom; inp.setAttribute("aria-label",`第 ${i+1} 期金額`);
    inp.addEventListener("input",()=>{ S.instCustom[i]=Math.max(0,Math.round(Number(inp.value)||0)); updateInstNote(); });
    c.appendChild(inp); box.appendChild(c);
  });
  updateInstNote();
}
function updateInstNote(){
  const note=$("eInstNote"), total=Math.round(Number($("eAmount").value)||0), n=Math.round(Number($("eInstN").value)||0);
  note.classList.remove("warn-text");
  if(!(total>0) || n<2 || n>60){ note.textContent="輸入金額和期數（2～60 期）。"; return; }
  const amts=instAmts(), sum=amts.reduce((s,x)=>s+x,0), from=ymLabel($("eInstStart").value||thisYM());
  const fw=$("eInstFeeWrap"); fw.hidden = !(S.instMode==="custom" && sum>total);
  if(!fw.hidden) $("eInstFeeText").textContent=`多出來的 ${money(sum-total)} 另外記成「分期手續費」（商品本身照 ${money(total)} 算，每期帳單金額不變）`;
  if(S.instMode==="custom" && sum!==total){
    note.classList.add("warn-text");
    note.textContent=`每期合計 ${money(sum)}，比消費金額${sum>total?"多":"少"} ${money(Math.abs(sum-total))}` + (sum>total?"（利息或手續費）":"，請確認每期金額") + `。會從 ${from} 起記到每個月。`;
  } else note.textContent=`合計 ${money(sum)}，會從 ${from} 起自動記到每個月。` + (S.instMode==="custom"?"":"要跟銀行帳單一致，可以選「自己填」逐期修改。");
}
document.querySelectorAll("#eInstMode button").forEach(b=>b.onclick=()=>{
  const m=b.dataset.m;
  if(m==="custom" && S.instMode!=="custom"){ const total=Math.round(Number($("eAmount").value)||0), n=Math.round(Number($("eInstN").value)||0); S.instCustom=autoAmts(total,n,S.instMode); }
  S.instMode=m; if(m!=="custom") store.set("ledger.instMode", m);
  syncCardUI();
});

/* 付款人、卡片：標籤選擇（點一下選取，輸入新名字按 Enter 會變成新標籤） */
function tagPicker(chipsId, inputId, getList, listKey){
  const box=$(chipsId), inp=$(inputId);
  const render=()=>{
    box.textContent=""; const cur=inp.value.trim();
    getList().forEach(v=>{ const b=el("button","chip",v); b.type="button"; b.setAttribute("aria-pressed", v===cur);
      b.onclick=()=>{ inp.value = inp.value.trim()===v ? "" : v; render(); }; box.appendChild(b); });
  };
  inp.addEventListener("input", render);
  inp.addEventListener("keydown", e=>{ if(e.key!=="Enter") return; e.preventDefault();
    const v=inp.value.trim().slice(0,20); if(!v) return;
    const list=P()[listKey];
    if(!list.includes(v) && list.length<50) savePrefs({[listKey]:[...list, v]}).then(render).catch(()=>{});
    render(); });
  return render;
}
const knownPayers=()=>[...new Set([...P().payers, ...S.entries.map(e=>e.payer).filter(Boolean)])];
const knownCards=()=>[...new Set([...P().cards, ...S.entries.map(e=>e.card).filter(Boolean)])];
const renderPayerChips=tagPicker("ePayerChips","ePayer",knownPayers,"payers");
const renderCardChips=tagPicker("eCardChips","eCard",knownCards,"cards");
["ePay","eInstOn","eInstN","eInstStart","eAmount"].forEach(id=>$(id).addEventListener("input",syncCardUI));
$("ePay").addEventListener("change",syncCardUI);
$("eDate").addEventListener("input",()=>{ const l=L(); const w=weekOf(l,$("eDate").value); $("eWeek").textContent = w!=null?`（${w} 週）`:""; });

function fillPayOptions(selId, current, type){
  const sel=$(selId); sel.textContent="";
  let pays=[...P().pays]; if(!pays.includes("信用卡")) pays.splice(1,0,"信用卡");
  if(type==="in"){ // 收入：不會用信用卡、悠遊卡收錢
    pays=[...IN_PAYS, ...pays.filter(p=>!IN_PAYS.includes(p) && !["信用卡","悠遊卡"].includes(p))];
    if(current && !pays.includes(current)) current="轉帳";
  }
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
  if(isFee(e)){ // 點到手續費那一筆：改開同一組分期的商品本身
    const sib=S.entries.find(x=>x.inst && x.inst.g===e.inst.g && !isFee(x));
    if(sib) e=sib;
    else { groupDocs(l, e.inst.g).then(ds=>{ const d=ds.find(d=>!isFee(d.data())); if(d) openEntry({id:d.id, ...d.data()}); }).catch(()=>{}); return; }
  }
  S.editing=e||null; msg("eMsg","");
  const proj=isProj(l), lb=stLabels(l, e ? e.type : "out");
  $("eTitle").textContent = e ? (e.inst?`編輯分期（第 ${e.inst.k}/${e.inst.n} 期）`:"編輯紀錄") : "記一筆";
  $("eDelete").hidden=!e; $("eDelete").textContent = e&&e.inst ? `刪除整組 ${e.inst.n} 期` : "刪除"; $("eDelete").dataset.armed="";
  S.eCat = e ? ((l.categories||[]).find(c=>c.id===e.categoryId) || {id:e.categoryId,name:e.categoryName,type:e.type}) : null;
  setEType(e ? e.type : "out");
  $("eAmount").value = e ? (e.inst ? (e.inst.price || e.inst.total) : e.amount) || "" : "";
  $("eDate").value = e ? (e.inst ? e.inst.purchase : e.date) : defaultDate();
  fillPayOptions("ePay", e ? (e.pay||"現金") : (P().defaultPay || $("ePay").dataset.last || "現金"), e ? e.type : "out");
  $("eCard").value = e ? (e.card||"") : (P().defaultCard || $("eCard").dataset.last || "");
  $("eBill").dataset.v = e && e.bill ? e.bill : "";
  $("eInstOn").checked = !!(e && e.inst);
  S.instMode = store.get("ledger.instMode")==="first" ? "first" : "last"; S.instCustom=null;
  $("eInstFee").checked = store.get("ledger.instFee")!=="0";
  $("eInstN").value = e && e.inst ? e.inst.n : 12;
  $("eInstStart").value = e && e.inst ? e.inst.start : ($("eDate").value||todayStr()).slice(0,7);
  $("eNote").value = e ? (e.note||"") : "";
  $("eRb").checked = isRb(e);
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
  // 付款人：有常用名單時直接放在主畫面，方便點選
  const pf=$("ePayerField");
  if(aaOn(l) || knownPayers().length || (e&&e.payer)) $("eNote").parentElement.before(pf); else $("eMore").querySelector(".stack").prepend(pf);
  if(aaOn(l)) pf.after($("eSplitBox")); // 先填誰付的，再選怎麼分
  $("eMore").querySelector("summary").firstChild.textContent = pf.closest("#eMore") ? "更多：付款人、狀態" : "更多：狀態";
  S.eSplit = e && e.split ? {m:e.split.m, r:{...(e.split.r||{})}} : {m:"d", r:{}};
  $("eMultiPay").checked = !!paidMap(e); S.ePaid = paidMap(e) ? {...paidMap(e)} : null;
  fillDatalists(); syncCardUI(); renderPayerChips(); renderCardChips(); renderSplitUI(); renderMultiPay(); syncSplitLabels(); splitNote();
  $("dlgEntry").showModal();
  if(e && e.inst){ // 讀出這組分期原本的每期金額
    const l2=l, g=e.inst.g;
    groupDocs(l2, g).then(docs=>{
      if(S.editing!==e) return;
      // 同一期的商品和手續費加起來，就是當期帳單金額
      const byK=new Map(); docs.map(d=>d.data()).forEach(x=>byK.set(x.inst.k,(byK.get(x.inst.k)||0)+x.amount));
      const amts=[...byK.keys()].sort((a,b)=>a-b).map(k=>byK.get(k));
      const tot=amts.reduce((s,x)=>s+x,0);
      const same=(m)=>autoAmts(tot,amts.length,m).every((v,i)=>v===amts[i]);
      if(same("last")) S.instMode="last"; else if(same("first")) S.instMode="first"; else { S.instMode="custom"; S.instCustom=amts; }
      if(docs.some(d=>isFee(d.data()))){ $("eInstFee").checked=true; }
      if(S.instMode!=="custom") $("eAmount").value=tot;
      syncCardUI();
    }).catch(()=>{});
  }
  setTimeout(()=>$("eAmount").focus(), 50);
}
function syncRbUI(){ const inst=$("ePay").value==="信用卡" && $("eInstOn").checked; $("eRbWrap").hidden = S.eType!=="out" || inst; }
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
/* 分期：每期金額（平均、零頭在最後或第一期，或自己填） */
function autoAmts(total, n, mode){
  const base=Math.floor(total/n), rem=total-base*n, a=new Array(n).fill(base);
  if(n>0){ if(mode==="first") a[0]+=rem; else a[n-1]+=rem; }
  return a;
}
function instAmts(){
  const total=Math.round(Number($("eAmount").value)||0), n=Math.round(Number($("eInstN").value)||0);
  if(n<2 || n>60) return [];
  if(S.instMode!=="custom") return autoAmts(total, n, S.instMode);
  const a=(S.instCustom||[]).slice(0,n);
  if(a.length<n){ const fill=autoAmts(total,n,"last"); for(let i=a.length;i<n;i++) a.push(fill[i]); }
  return a;
}
function buildInstallments(amts, start, purchase, price){
  const g=rid()+rid(), n=amts.length, total=amts.reduce((s,x)=>s+x,0), day=Number(purchase.slice(8,10))||1, out=[];
  let paid=0;
  for(let k=1;k<=n;k++){
    const ym=addMonths(start,k-1); paid+=amts[k-1];
    out.push({ amount:amts[k-1], date:`${ym}-${pad(Math.min(day,dim(ym)))}`,
      inst:{ g, k, n, total, start, purchase, rem:total-paid, price } });
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
  const amts = inst ? instAmts() : [];
  if(inst && (amts.length!==n || amts.some(x=>!(x>0)))){ msg("eMsg","每一期的金額都要大於 0。","err"); return; }
  const common={ type:S.eType, categoryId:S.eCat.id, categoryName:S.eCat.name,
    note:$("eNote").value.trim().slice(0,100), pay, card: isCard ? ($("eCard").value.trim() || (S.editing&&S.editing.card) || "").slice(0,20) : "",
    payer:$("ePayer").value.trim().slice(0,20), status:S.eStatus, updatedAt:serverTimestamp(),
    bill: isCard && !inst && /^\d{4}-\d{2}$/.test($("eBill").value) ? $("eBill").value : "" };
  if(proj){ common.budget=budget; common.priority=$("ePriority").value; }
  { const old=S.editing, want=S.eType==="out" && !(isCard && $("eInstOn").checked) && $("eRb").checked;
    if(want) common.rb = isRb(old) ? old.rb : {s:"pending"};
    else if(old && old.rb) common.rb = {s:"no"}; }
  if(aaOn(l) && S.eType==="out"){
    // AA 帳本：一定要知道是誰先付的，結算才算得出來
    if($("eMultiPay").checked){
      const ppl=l.split.people, sum=ppl.reduce((t,p)=>t+(S.ePaid[p]||0),0);
      if(sum!==amt){ msg("eMsg",`每人付的金額加起來要等於 ${money(amt)}（目前 ${money(sum)}）。`,"err"); return; }
      const pm=Object.fromEntries(ppl.filter(p=>(S.ePaid[p]||0)>0).map(p=>[p,S.ePaid[p]]));
      common.paid=pm; common.payer=Object.keys(pm).join("、").slice(0,20);
    } else {
    if(!common.payer){ msg("eMsg",`這本帳有開 AA，請選「付款人」（${l.split.people.join("、")} 誰先付的）。如果兩個人各付一部分，勾「不只一個人付」。`,"err"); $("ePayer").focus(); return; }
    if(!l.split.people.includes(common.payer)){ msg("eMsg",`付款人要是分攤名單裡的人（${l.split.people.join("、")}）。如果是其他人付的，可以改到帳本設定加入名單。`,"err"); $("ePayer").focus(); return; }
    if(S.editing && paidMap(S.editing)) common.paid={};
    }
    if(S.eSplit.m==="c"){
      const sum=l.split.people.reduce((s,p)=>s+(Number(S.eSplit.r[p])||0),0);
      if(Math.abs(sum-100)>0.01){ msg("eMsg",`自訂分攤的比例加起來要是 100%（目前 ${sum}%）。`,"err"); return; }
      common.split={m:"c", r:Object.fromEntries(l.split.people.map(p=>[p,Number(S.eSplit.r[p])||0]))};
    } else if(S.eSplit.m==="a"){
      const sum=l.split.people.reduce((s,p)=>s+(Number(S.eSplit.r[p])||0),0);
      if(sum!==amt){ msg("eMsg",`每人分攤的金額加起來要等於 ${money(amt)}（目前 ${money(sum)}）。`,"err"); return; }
      common.split={m:"a", r:Object.fromEntries(l.split.people.map(p=>[p,Math.round(Number(S.eSplit.r[p])||0)]))};
    } else common.split={m:S.eSplit.m};
  }
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
      const sum=amts.reduce((s,x)=>s+x,0);
      const splitFee = S.instMode==="custom" && sum>amt && $("eInstFee").checked && S.eType==="out";
      store.set("ledger.instFee", $("eInstFee").checked?"1":"0");
      // 商品本身照消費金額按比例分到每期，剩下的是手續費
      let items=amts.slice();
      if(splitFee){ let acc=0; items=amts.map((a,i)=>{ if(i===amts.length-1) return amt-acc; const v=Math.floor(a*amt/sum); acc+=v; return v; }); }
      buildInstallments(amts, start, date, amt).forEach((p,i)=>{
        b.set(doc(col), {...common, ...creator, ...p, amount:items[i]});
        const fee=amts[i]-items[i];
        if(splitFee && fee>0) b.set(doc(col), {...common, ...creator, ...p, amount:fee, categoryId:FEE_CAT.id, categoryName:FEE_CAT.name,
          note:((common.note?common.note+" ":"")+"分期手續費").slice(0,100), ...(proj?{budget:0}:{})});
      });
      await b.commit();
      toast(`已記下分期：${S.eCat.name} ${money(splitFee?amt:sum)}，分 ${n} 期` + (splitFee?`，手續費 ${money(sum-amt)} 另外記`:""));
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
    $("sProject").checked=isProj(l); $("sPBudget").value=l.projectBudget||0; $("sWeek").value=l.weekStart||""; $("sInstAt").value=instAtBuy(l)?"buy":"bill";
    ["sBasicMsg","sCatMsg","sShareMsg","sDangerMsg"].forEach(id=>msg(id,"")); $("sDelConfirm").value=""; $("sEmail").value="";
  }
  if(resetInputs){ const sp=l.split||{}; const ppl=(sp.people&&sp.people.length?sp.people:knownPayersAll().slice(0,2));
    S.aaDraft={ on:!!sp.on, people:[...ppl], ratio:{...(sp.ratio||evenRatio(ppl))} }; msg("sAAMsg",""); }
  $("sAA").hidden=!editor; renderAASettings();
  $("sName").disabled=!owner; $("sBudget").disabled=!editor; $("sSaveBasic").hidden=!editor;
  $("sProject").disabled=!owner; $("sWeek").disabled=!owner; $("sInstAt").disabled=!owner; $("sPBudget").disabled=!editor;
  $("sProjBox").hidden=!$("sProject").checked;
  if(resetInputs || !$("sColors").childElementCount) swatches("sColors", S.sColor, c=>{ S.sColor=c; }, !owner);
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
    upd.name=n; upd.color=S.sColor; upd.mode=$("sProject").checked?"project":"normal"; upd.weekStart=$("sWeek").value||""; upd.instAt=$("sInstAt").value==="buy"?"buy":""; }
  try{ await updateDoc(doc(db,"ledgers",l.id), upd); msg("sBasicMsg","已儲存。","ok");
    if(isOwner(l) && (upd.mode==="project")!==isProj(l)){ S.period.mode = upd.mode==="project" ? "all" : "month"; S.catFilter=null; watchEntries(); }
    else if(isOwner(l) && (upd.instAt==="buy")!==instAtBuy(l)){ l.instAt=upd.instAt; watchEntries(); } }
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
    for(const sub of ["entries","settles"]){
      const snap=await getDocs(collection(db,"ledgers",l.id,sub));
      for(let i=0;i<snap.docs.length;i+=400){ const b=writeBatch(db); snap.docs.slice(i,i+400).forEach(d=>b.delete(d.ref)); await b.commit(); }
    }
    stopEntries(); stopAA(); stopRb(); S.lid=null;
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
    if(S.editingLoan && $("dlgLoan").open){ const f=S.loans.find(x=>x.id===S.editingLoan.id); if(f){ S.editingLoan=f; renderLoanGrid(f); renderAdjNow(f); } }
    if(S.payLoan){ const f=S.loans.find(x=>x.id===S.payLoan.lo.id); if(f) S.payLoan.lo=f; }
    if(location.hash==="#repay") renderRepay(false);
  }, e=>msg("repayMsg","讀取還款資料失敗："+errText(e),"err"));
}
function stopLoans(){ if(S.unsubLoans){ S.unsubLoans(); S.unsubLoans=null; } S.loans=[]; }

/* 每期紀錄 {a:繳款總額, p:其中本金, i:其中利息, l/e:自動記帳的帳本與紀錄}；舊紀錄沒有 p 時整筆算本金。
   adj = {bal, ym}：校正後「繳完 ym 那個月之後」的剩餘本金，之後的月份從這裡接著扣。 */
const payP = p => typeof p.p==="number" ? p.p : (p.a||0);
/* 這個月應繳：緩繳本金期間有填利率就用算出來的利息，否則用月繳金額 */
const dueAmt = (lo, ym) => { if(lo.io && lo.rate) return autoInt(lo, ym);
  const fin=finalDue(lo, ym); return fin ? fin.amt : (lo.monthly||0); };
/* 最後一期（或剩餘本金＋利息已經比月繳少）：應繳＝剩餘本金＋這期利息，繳完剛好結清 */
function finalDue(lo, ym){
  if(lo.io || !lo.monthly) return null;
  const st=loanStats(lo, ym); if(st.remain<=0) return null;
  let i=autoInt(lo, ym), amt=st.remain+i;
  const fee = ym>((lo.adj||{}).ym||"") ? feeLeft(lo, ym) : null;
  if(fee!=null && fee>0 && (st.leftPeriods===1 || fee<=lo.monthly)){ i=Math.max(fee-st.remain,0); return { amt:fee, remain:fee-i, i, last: st.leftPeriods===1, fee:true }; }
  if(st.leftPeriods===1 || amt<=lo.monthly) return { amt, remain:st.remain, i, last: st.leftPeriods===1 };
  return null;
}
/* 往後試算到繳完：每期月繳，最後一期繳剩下的本金＋利息 */
function loanPlan(lo){
  const st=loanStats(lo); if(lo.io || !lo.monthly || st.remain<=0) return null;
  const ms=Object.keys(lo.payments||{}).sort(); let ym = ms.length ? addMonths(ms[ms.length-1],1) : thisYM();
  if(ym<thisYM() && !(lo.payments||{})[thisYM()]) ym=thisYM();
  let bal=st.remain, total=0, n=0, last=0, interest=0;
  const max = st.leftPeriods>0 ? st.leftPeriods : 600;
  while(bal>0 && n<max){
    const i=intOn(lo, ym, bal); n++;
    const pay = (n===max || bal+i<=lo.monthly) ? bal+i : lo.monthly;
    bal = Math.max(bal-(pay-i),0); total+=pay; interest+=i; last=pay; ym=addMonths(ym,1);
    if(pay<=i && n>3) return { total, n, last, interest, never:true };
  }
  return { total, n, last, interest, left:st.leftPeriods };
}
/* 銀行顯示「剩餘費用（含利息）」：校正時記下 adj.t，之後每繳一期就照銀行的方式直接扣掉繳款金額 */
const hasFee = lo => hasAdj(lo) && typeof lo.adj.t==="number";
function feeLeft(lo, beforeYm){
  if(!hasFee(lo)) return null; const pays=lo.payments||{};
  return Math.max(lo.adj.t - Object.keys(pays).filter(m=>m>lo.adj.ym && (!beforeYm || m<beforeYm)).reduce((t,m)=>t+(pays[m].a||0),0), 0);
}
/* 從 P 本金開始、每月繳 mo，一直試算到繳完 */
function simPay(tmp, P, mo, ym){
  let b=P, n=0, total=0, last=0;
  while(b>0 && n<1200){ const i=intOn(tmp, ym, b); if(n>3 && mo<=i) return null;
    n++; const pay = b+i<=mo ? b+i : mo; b-=pay-i; total+=pay; last=pay; ym=addMonths(ym,1); }
  return { n, total, last };
}
/* 剩餘費用（含利息）換算回本金：找試算總額最接近的本金 */
function feeToPrin(tmp, fee, mo, ym){
  if(!tmp.rate) return fee;
  let lo=0, hi=fee;
  while(lo<hi){ const mid=Math.ceil((lo+hi)/2), r=simPay(tmp, mid, mo, ym); if(r && r.total<=fee) lo=mid; else hi=mid-1; }
  const a=simPay(tmp, lo, mo, ym), b=simPay(tmp, lo+1, mo, ym);
  return b && a && Math.abs(b.total-fee) < Math.abs(a.total-fee) ? lo+1 : lo;
}
const payI = p => typeof p.i==="number" ? p.i : 0;
const hasAdj = lo => !!(lo.adj && typeof lo.adj.bal==="number" && lo.adj.ym);
function loanStats(lo, beforeYm){
  const pays=lo.payments||{};
  const months=Object.keys(pays).sort().filter(m=>!beforeYm || m<beforeYm);
  const adj = hasAdj(lo) && (!beforeYm || lo.adj.ym<beforeYm) ? lo.adj : null;
  let remain = adj ? adj.bal : (lo.principal||0)-(lo.paidBase||0), interest=0, cash=0;
  months.forEach(m=>{ const p=pays[m]; interest+=payI(p); cash+=p.a||0; if(adj && m<=adj.ym) return; remain-=payP(p); });
  remain=Math.max(Math.round(remain),0);
  // 校正時有填已繳期數：以銀行的期數為準，只加上校正月份之後的紀錄
  // 緩繳本金（只繳利息，紀錄上有 x）的月份不算進還款期數
  const counted=months.filter(m=>!pays[m].x), ioInt=months.filter(m=>pays[m].x).reduce((t,m)=>t+payI(pays[m]),0);
  const periods = adj && typeof adj.n==="number" ? adj.n + counted.filter(m=>m>adj.ym).length : (lo.periodsBase||0)+counted.length;
  const leftPeriods = lo.totalPeriods ? Math.max(lo.totalPeriods-periods,0) : null;
  return { repaid:Math.max((lo.principal||0)-remain,0), periods, remain, leftPeriods, interest, ioInt, cash, done: remain<=0 };
}
$("rPrev").onclick=()=>{ S.rYM=addMonths(S.rYM,-1); renderRepay(); };
$("rNext").onclick=()=>{ S.rYM=addMonths(S.rYM,1); renderRepay(); };
$("rNow").onclick=()=>{ S.rYM=thisYM(); renderRepay(); };

let billToken=null;
function renderRepay(reloadBill=true){
  const ym=S.rYM;
  tipsFor("tipRepay", [["repay9","貸款：填年利率會自動拆本金和利息；跟銀行對不起來就在「編輯」校正（銀行寫含利息的「剩餘費用」也可以），看不到已繳期數可以按「幫我推算」。信用卡：在「信用卡設定」填好持卡人、結帳日和繳款截止日；刷別人名下的卡，轉帳給持卡人繳費後按「標記已轉帳」；商家晚請款的消費可以按「移到下期」。"]]);
  $("rTitle").textContent=ymLabel(ym); $("rNow").hidden = ym===thisYM();
  const active=[], done=[];
  S.loans.slice().sort((a,b)=>(a.type+a.name).localeCompare(b.type+b.name,"zh-Hant")).forEach(lo=>{
    const st=loanStats(lo); const paidThis=(lo.payments||{})[ym];
    (st.done && !paidThis ? done : active).push(lo); });
  let paid=0, unpaid=0, left=0;
  active.forEach(lo=>{ const p=(lo.payments||{})[ym]; if(p) paid+=p.a||0; else if(!loanStats(lo).done) unpaid+=dueAmt(lo, ym); });
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
  $("rDue").textContent = money(paid+unpaid+(S.rCardTotal||0)+(S.rXferTotal||0));
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
  const fee=feeLeft(lo);
  if(fee!=null) nums.append(el("span",null,`剩餘費用 ${money(fee)}（含利息）`), el("span","muted",`剩餘本金約 ${fmt(st.remain)}・原貸 ${fmt(lo.principal||0)}`));
  else nums.append(el("span",null,`剩餘本金 ${money(st.remain)}`), el("span","muted",`原貸 ${fmt(lo.principal||0)}・已還本金 ${fmt(st.repaid)}`));
  c.appendChild(nums);
  if(lo.io){ const b=el("div","io-note");
    b.append(el("strong",null,"緩繳本金中"), document.createTextNode(`：每月只繳利息${lo.rate?`（這個月約 ${fmt(autoInt(lo, ym))} 元）`:""}，本金不會減少，也不算還款期數。`)); c.appendChild(b); }
  else { const pl=loanPlan(lo); if(pl) c.appendChild(el("div","loan-left", planText(lo, pl))); }
  const meta=[]; if(lo.monthly && !lo.io) meta.push(`月繳 ${fmt(lo.monthly)}`); if(lo.monthly && lo.io) meta.push(`恢復還本後月繳 ${fmt(lo.monthly)}`); if(lo.day) meta.push(`每月 ${lo.day} 號`);
  meta.push(lo.totalPeriods ? `已繳 ${st.periods}/${lo.totalPeriods} 期・剩 ${st.leftPeriods} 期` : `已繳 ${st.periods} 期`);
  if(lo.rate) meta.push(`年利率 ${lo.rate}%`);
  if(st.interest>0) meta.push(`已付利息 ${fmt(st.interest)}` + (st.ioInt>0?`（其中緩繳期間 ${fmt(st.ioInt)}）`:""));
  if(hasAdj(lo)) meta.push(`已依銀行校正（${lo.adj.ym.slice(2).replace("-","/")}）`);
  if(lo.note) meta.push(lo.note);
  c.appendChild(el("div","loan-meta",meta.join("・")));
  const row=el("div","row");
  const ld=lo.ledgerId && S.ledgers.get(lo.ledgerId);
  row.appendChild(el("span","small muted", ld ? `已繳會記到「${ld.name}」` : "不會自動記帳"));
  if(p){ const b=el("button","paid-btn",`✓ ${Number(ym.slice(5))} 月已繳 ${fmt(p.a)}`); b.type="button"; b.title="點一下可以修改或取消";
    b.onclick=()=>openPay(lo, ym); row.appendChild(b); }
  else if(!st.done){ const due=dueAmt(lo, ym); const b=el("button","pay-btn", due ? `標記已繳 ${fmt(due)}` : "標記已繳"); b.type="button"; b.onclick=()=>openPay(lo, ym); row.appendChild(b); }
  c.appendChild(row);
  return c;
}

function planText(lo, pl){
  const fee=feeLeft(lo);
  if(fee!=null && !pl.never && pl.n>1){ const last=fee-(pl.n-1)*lo.monthly;
    if(last>0 && last<=lo.monthly*2) pl={...pl, total:fee, last, exact:true}; }
  if(pl.never) return `照月繳 ${fmt(lo.monthly)} 只夠付利息，本金不會減少，請確認月繳金額或年利率。`;
  const pre = lo.rate && !pl.exact ? "約 " : "", pre2 = lo.rate ? "約 " : "";
  if(pl.n===1) return `還要繳 ${pre}${money(pl.total)}（剩最後 1 期，剩餘本金${lo.rate?"＋利息":""}）`;
  const diff=Math.abs(pl.last-lo.monthly);
  let t = diff<1 ? `還要繳 ${pre}${money(pl.total)}（剩 ${pl.n} 期 × ${fmt(lo.monthly)}）`
    : `還要繳 ${pre}${money(pl.total)}（剩 ${pl.n} 期：前 ${pl.n-1} 期 × ${fmt(lo.monthly)}，最後一期${pre2}${fmt(pl.last)}）`;
  if(pl.left && pl.n<pl.left) t+=`・照月繳會比原定早 ${pl.left-pl.n} 期繳完`;
  return t;
}

/* 標記已繳 */
function openPay(lo, ym){
  const cur=(lo.payments||{})[ym];
  S.payLoan={lo, ym, edit:!!cur}; msg("pyMsg","");
  $("pyWhat").textContent=`${[lo.type,lo.bank,lo.name].filter(Boolean).join(" ")}・${ymLabel(ym)}`;
  $("pyAmount").value = cur ? cur.a : (dueAmt(lo, ym)||"");
  delete $("pyInt").dataset.touched;
  if(cur){ $("pyInt").value=payI(cur); $("pyPrin").value=payP(cur); if(typeof cur.i==="number" && !cur.x) $("pyInt").dataset.touched="1"; }
  else syncSplit();
  const before=loanStats(lo, ym).remain;
  $("pySplitNote").textContent = (cur ? cur.x : lo.io) ? "緩繳本金期間：整筆都算利息，剩餘本金不變，也不算進還款期數。" + (lo.rate?`（依${intFormula(lo, ym, before)}，約 ${fmt(autoInt(lo, ym))} 元）。如果跟銀行不同，可以在「編輯」改「利息怎麼算」。`:"") : lo.rate
    ? `依${intFormula(lo, ym, before)}，這期利息約 ${fmt(autoInt(lo, ym))} 元。如果跟銀行差幾塊，可以在「編輯」改「利息怎麼算」，或直接照銀行的數字改。`
    : "這筆沒有設定年利率，整筆都算本金。銀行貸款建議在「編輯」填年利率，或照繳款明細自己填利息。";
  const fin=!cur && finalDue(lo, ym);
  if(fin) $("pySplitNote").textContent = (fin.last ? "這是最後一期" : "剩下的本金已經比月繳少") + `：應繳＝剩餘本金 ${fmt(fin.remain)}` + (fin.i?`＋利息約 ${fmt(fin.i)}`:"") + `＝${fmt(fin.amt)}，繳完就結清。如果銀行通知的金額不一樣，直接改成銀行的數字。`;
  const ld=lo.ledgerId && S.ledgers.get(lo.ledgerId);
  $("pyNote").textContent = cur ? (cur.e ? "改金額的話，帳本裡那一筆也會一起改。" : ld ? `這個月還沒記到帳本，按「儲存修改」會補記一筆到「${ld.name}」。` : "") : (ld ? `會同時在「${ld.name}」記一筆支出。` : "沒有設定自動記帳（可在「編輯」裡設定）。");
  $("pySave").textContent = cur ? "儲存修改" : "確定已繳";
  $("pyUndo").hidden=!cur; $("pyUndo").dataset.armed=""; $("pyUndo").textContent="取消這個月的已繳";
  $("dlgPay").showModal(); setTimeout(()=>$("pyAmount").select(),50);
}
/* 利息估算：有填每月繳款日時，和銀行一樣照「上期繳款日到這期繳款日的實際天數 ÷ 365」算；沒填時用 ÷ 12 */
const dueDate = (ym, day) => new Date(Number(ym.slice(0,4)), Number(ym.slice(5))-1, Math.min(day, dim(ym)));
/* 計息方式：day＝實際天數÷365；month＝÷12 四捨五入；monthFloor＝÷12 無條件捨去。沒選時：有繳款日就 day，否則 month */
const intMethod = lo => lo.im || (lo.day ? "day" : "month");
const intDays = (lo, ym) => intMethod(lo)==="day" && lo.day ? Math.round((dueDate(ym, lo.day)-dueDate(addMonths(ym,-1), lo.day))/864e5) : 0;
const intOn = (lo, ym, r) => { if(!lo.rate) return 0; const d=intDays(lo, ym), m=intMethod(lo);
  const raw = d ? r*lo.rate/100*d/365 : r*lo.rate/1200;
  return m==="monthFloor" ? Math.floor(raw+1e-9) : Math.round(raw); };
const autoInt = (lo, ym) => intOn(lo, ym, loanStats(lo, ym).remain);
const intFormula = (lo, ym, before) => { const d=intDays(lo, ym), m=intMethod(lo);
  return d ? `剩餘本金 ${fmt(before)} × 年利率 ${lo.rate}% × ${d} 天 ÷ 365` : `剩餘本金 ${fmt(before)} × 年利率 ${lo.rate}% ÷ 12` + (m==="monthFloor"?"（無條件捨去）":""); };
function syncSplit(from){
  const {lo, ym}=S.payLoan, a=Math.round(Number($("pyAmount").value)||0);
  if(from==="p"){ const p=Math.round(Number($("pyPrin").value)||0); $("pyInt").value=Math.max(a-p,0); $("pyInt").dataset.touched="1"; return; }
  if(from==="i") $("pyInt").dataset.touched="1";
  const cur=(lo.payments||{})[ym], io = cur ? !!cur.x : !!lo.io;
  let i = $("pyInt").dataset.touched ? Math.round(Number($("pyInt").value)||0) : io ? a : Math.min(autoInt(lo, ym), a);
  if(!$("pyInt").dataset.touched) $("pyInt").value=i;
  $("pyPrin").value=Math.max(a-i,0);
}
$("pyAmount").addEventListener("input",()=>syncSplit());
$("pyInt").addEventListener("input",()=>syncSplit("i"));
$("pyPrin").addEventListener("input",()=>syncSplit("p"));
$("formPay").addEventListener("submit", async ev=>{
  if(ev.submitter && ev.submitter.value==="cancel") return;
  ev.preventDefault();
  const amt=Math.round(Number($("pyAmount").value)||0); if(amt<=0){ msg("pyMsg","請輸入金額。","err"); return; }
  const pr=Math.round(Number($("pyPrin").value)||0), it=Math.round(Number($("pyInt").value)||0);
  if(pr<0 || it<0 || pr+it!==amt){ msg("pyMsg",`本金＋利息要等於繳款總額（現在是 ${fmt(pr)}＋${fmt(it)}＝${fmt(pr+it)}）。`,"err"); return; }
  $("pySave").disabled=true;
  try{ await markPaid(S.payLoan.lo, S.payLoan.ym, amt, pr, it); $("dlgPay").close(); }
  catch(e){ msg("pyMsg","儲存失敗："+errText(e),"err"); }
  finally{ $("pySave").disabled=false; }
});
$("pyUndo").onclick=async()=>{
  const b=$("pyUndo"); if(!b.dataset.armed){ b.dataset.armed="1"; b.textContent="再按一次確定取消"; return; }
  await unmarkPaid(S.payLoan.lo, S.payLoan.ym); $("dlgPay").close();
};
/* 某個月是第幾期：校正時填的已繳期數已經包含校正月份（含）以前的紀錄 */
function periodNo(lo, ym){
  const pays=lo.payments||{};
  if(hasAdj(lo) && typeof lo.adj.n==="number" && ym<=lo.adj.ym)
    return lo.adj.n - Object.keys(pays).filter(m=>m>ym && m<=lo.adj.ym && !pays[m].x).length;
  return loanStats(lo, ym).periods + 1;
}
const loanNote = (lo, ym) => (`${[lo.type,lo.bank,lo.name].filter(Boolean).join(" ")} ` + (lo.io ? "緩繳期間利息" : `第 ${periodNo(lo, ym)} 期`)).slice(0,100);
/* 在設定的帳本記一筆還款支出，回傳 {l, e}；沒設定或沒權限時回傳空字串 */
async function loanEntry(lo, ym, amt){
  const ld=lo.ledgerId && S.ledgers.get(lo.ledgerId);
  if(!(ld && canEdit(ld))) return {l:"", e:""};
  const cat=(ld.categories||[]).find(c=>c.id===lo.categoryId) || (ld.categories||[]).find(c=>c.type==="out");
  const today=todayStr(); const day = ym===today.slice(0,7) ? Number(today.slice(8)) : (lo.day||1);
  const ref=doc(collection(db,"ledgers",ld.id,"entries"));
  await setDoc(ref, { type:"out", amount:amt, categoryId:cat?cat.id:"loan", categoryName:cat?cat.name:(lo.categoryName||"還款"),
    date:`${ym}-${pad(Math.min(day,dim(ym)))}`, note:loanNote(lo, ym),
    pay:"轉帳", card:"", payer:(aaOn(ld) && ld.split.people.includes(P().defaultPayer)) ? P().defaultPayer : "", status:"paid",
    createdBy:S.user.uid, createdByEmail:S.email, createdAt:serverTimestamp(), updatedAt:serverTimestamp() });
  return {l:ld.id, e:ref.id, name:ld.name};
}
async function markPaid(lo, ym, amt, prin, int){
  if(prin==null){ int=lo.io ? amt : Math.min(autoInt(lo, ym), amt); prin=amt-int; }
  const cur=(lo.payments||{})[ym];
  if(cur){ // 修改已繳的月份
    const rec={...cur, a:amt, p:prin, i:int};
    let added="";
    // 修改時順便更新帳本那筆的金額和期數說明
    if(cur.l && cur.e){ try{ await updateDoc(doc(db,"ledgers",cur.l,"entries",cur.e), {amount:amt, note:loanNote(lo, ym), updatedAt:serverTimestamp()}); }catch(e){ /* 帳本沒權限或已刪，略過 */ } }
    if(!cur.e){ const r=await loanEntry(lo, ym, amt); if(r.e){ rec.l=r.l; rec.e=r.e; added=`，並補記到「${r.name}」`; } } // 當初標記時還沒設定帳本：現在補記
    await updateDoc(doc(db,"loans",lo.id), { payments:{...(lo.payments||{}), [ym]:rec}, updatedAt:serverTimestamp() });
    toast(`已更新 ${ymLabel(ym)}：本金 ${fmt(prin)}、利息 ${fmt(int)}${added}`); return;
  }
  const rec={a:amt, p:prin, i:int, l:"", e:""}; if(lo.io) rec.x=1;
  const r=await loanEntry(lo, ym, amt); rec.l=r.l; rec.e=r.e;
  await updateDoc(doc(db,"loans",lo.id), { payments:{...(lo.payments||{}), [ym]:rec}, updatedAt:serverTimestamp() });
  toast(`已標記 ${ymLabel(ym)} 已繳 ${money(amt)}` + (int?`（利息 ${fmt(int)}）`:"") + (rec.e?`，並記到「${r.name}」`:""));
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
  msg("loRateMsg",""); $("loIO").checked=!!(lo&&lo.io); $("loIM").value = lo && lo.im ? lo.im : "";
  v("loPeriodsBase",lo?lo.periodsBase||0:0); v("loPaidBase",lo?lo.paidBase||0:0); v("loNote",lo?lo.note:""); v("loRate",lo&&lo.rate?lo.rate:"");
  $("loAdjBox").hidden=!lo; msg("loAdjMsg",""); $("loAdjBal").value=""; $("loAdjN").value=""; $("loAdjNHint").textContent="";
  $("loAdjKind").value = lo && hasFee(lo) ? "t" : "p"; syncAdjKind();
  if(lo){ const ms=Object.keys(lo.payments||{}).sort(); $("loAdjYm").value = ms.length ? ms[ms.length-1] : addMonths(thisYM(),-1); renderAdjNow(lo); }
  fillLoanLedgers(lo?lo.ledgerId:"", lo?lo.categoryId:"");
  $("loDelete").hidden=!lo; $("loDelete").textContent="刪除"; $("loDelete").dataset.armed="";
  // 還款紀錄（最近 12 個月＋有繳的月份）
  $("loHistory").hidden=!lo;
  if(lo) renderLoanGrid(lo);
  $("dlgLoan").showModal();
}
function renderAdjNow(lo){
  const st=loanStats(lo), fee=feeLeft(lo);
  $("loAdjNow").textContent = (fee!=null?`目前剩餘費用 ${fmt(fee)}・`:"") + `目前剩餘本金 ${fmt(st.remain)}・已繳 ${st.periods} 期` + (hasAdj(lo) ? `・上次校正：${lo.adj.ym} ${hasFee(lo)?`剩餘費用 ${fmt(lo.adj.t)}（本金約 ${fmt(lo.adj.bal)}）`:`剩 ${fmt(lo.adj.bal)}`}${typeof lo.adj.n==="number"?`、已繳 ${lo.adj.n} 期`:""}` : "");
  $("loAdjClear").hidden=!hasAdj(lo);
}
function renderLoanGrid(lo){
  const g=$("loGrid"); g.textContent="";
  const months=new Set(Object.keys(lo.payments||{})); for(let k=-11;k<=0;k++) months.add(addMonths(thisYM(),k));
  [...months].sort().forEach(ym=>{ const p=(lo.payments||{})[ym];
    const c=el("button","pay-cell"+(p?"":" none")+(hasAdj(lo)&&lo.adj.ym===ym?" adj":"")); c.type="button";
    c.append(document.createTextNode(`${ym.slice(2,4)}/${ym.slice(5)}`), el("b",null,p?fmt(p.a):"—"));
    if(p && p.x) c.appendChild(el("small",null,"只繳息"));
    else if(p && payI(p)>0) c.appendChild(el("small",null,`本 ${fmt(payP(p))}・息 ${fmt(payI(p))}`));
    c.title = p ? "點一下修改本金和利息" : "點一下補記這個月";
    c.onclick=()=>openPay(S.loans.find(x=>x.id===lo.id)||lo, ym);
    g.appendChild(c); });
}
$("loAdjN").addEventListener("input", ()=>{
  const n=Math.round(Number($("loAdjN").value)), tot=Number($("loTotal").value)||0, h=$("loAdjNHint");
  if($("loAdjN").value.trim()===""||!(n>=0)){ h.textContent=""; return; }
  h.textContent = tot ? `校正後會顯示：已繳 ${n} 期、剩 ${Math.max(tot-n,0)} 期（共 ${tot} 期）。跟銀行 APP 一樣就對了。` : `校正後會顯示：已繳 ${n} 期。`;
});
/* 看不到已繳期數：用剩餘本金、月繳、年利率往後試算還要幾期，總期數減掉就是已繳期數 */
function syncAdjKind(){ $("loAdjBalLabel").textContent = $("loAdjKind").value==="t" ? "APP 上的剩餘費用" : "APP 上的剩餘本金"; }
$("loAdjKind").addEventListener("change", syncAdjKind);
const adjTmp = () => ({ rate:Number($("loRate").value)||0, im:$("loIM").value, day:Number($("loDay").value)||0 });
/* 校正區填的金額換算成本金（含利息時往回推） */
function adjPrin(){
  const raw=Math.round(Number($("loAdjBal").value)), ym=$("loAdjYm").value;
  if($("loAdjKind").value!=="t" || !(raw>0)) return { bal:raw };
  const mo=Math.round(Number($("loMonthly").value));
  if($("loIO").checked) return { err:"緩繳本金期間沒辦法從「含利息的剩餘費用」推回本金，請改填剩餘本金，或等恢復還本後再校正。" };
  if(!(mo>0)) return { err:"含利息的剩餘費用需要上面的「月繳金額」才能換算。" };
  const start=/^\d{4}-\d{2}$/.test(ym) ? addMonths(ym,1) : thisYM(), tmp=adjTmp();
  if(tmp.rate && !simPay(tmp, raw, mo, start)) return { err:`月繳 ${fmt(mo)} 只夠付利息，請確認月繳金額或年利率。` };
  return { bal:feeToPrin(tmp, raw, mo, start), t:raw };
}
$("loAdjGuess").onclick=()=>{
  const ap=adjPrin(); if(ap.err){ msg("loAdjMsg",ap.err,"err"); return; }
  const bal=ap.bal, mo=Math.round(Number($("loMonthly").value)), tot=Math.round(Number($("loTotal").value)), ym=$("loAdjYm").value;
  const tmp=adjTmp();
  if(!(bal>0)){ msg("loAdjMsg","請先填銀行 APP 上的剩餘金額，再按推算。","err"); return; }
  if(!(mo>0)){ msg("loAdjMsg","推算需要上面的「月繳金額」。","err"); return; }
  if(!(tot>0)){ msg("loAdjMsg","推算需要上面的「總期數」（例如 120）。","err"); return; }
  let b=bal, n=0, last=0, m=/^\d{4}-\d{2}$/.test(ym) ? addMonths(ym,1) : thisYM();
  while(b>0 && n<1200){ const i=intOn(tmp, m, b); if(n>3 && mo<=i){ msg("loAdjMsg",`月繳 ${fmt(mo)} 只夠付利息，沒辦法推算，請確認月繳金額或年利率。`,"err"); return; }
    n++; if(b+i<=mo){ last=b+i; b=0; } else b-=mo-i; m=addMonths(m,1); }
  if(n>tot){ msg("loAdjMsg",`照月繳 ${fmt(mo)} 還要繳 ${n} 期，比總期數 ${tot} 還多，請確認月繳金額、年利率或總期數。`,"err"); return; }
  $("loAdjN").value=tot-n; $("loAdjN").dispatchEvent(new Event("input"));
  msg("loAdjMsg",`照${ap.t?`剩餘費用 ${fmt(ap.t)}（本金約 ${fmt(bal)}）`:`剩餘本金 ${fmt(bal)}`}、月繳 ${fmt(mo)}${tmp.rate?`、年利率 ${tmp.rate}%`:""} 往後算，還要繳 ${n} 期（最後一期約 ${fmt(last)}），所以已繳 ${tot-n} 期。確認沒問題就按「校正」。`,"ok");
};
$("loAdjSave").onclick=async()=>{
  const lo=S.editingLoan; if(!lo) return;
  const raw=$("loAdjBal").value.trim(), ym=$("loAdjYm").value, nRaw=$("loAdjN").value.trim(), n=Math.round(Number(nRaw));
  let bal=Math.round(Number(raw));
  if(nRaw!=="" && !(n>=0)){ msg("loAdjMsg","已繳期數請填數字。","err"); return; }
  if(raw==="" || !(bal>=0)){ msg("loAdjMsg","請填銀行 APP 上顯示的剩餘本金。","err"); return; }
  if(!/^\d{4}-\d{2}$/.test(ym)){ msg("loAdjMsg","請選這是繳完哪個月之後的餘額。","err"); return; }
  const ap=adjPrin(); if(ap.err){ msg("loAdjMsg",ap.err,"err"); return; }
  bal=ap.bal;
  const before=loanStats(lo).remain;
  const adj={bal, ym}; if(nRaw!=="") adj.n=n; if(ap.t!=null) adj.t=ap.t;
  try{ await updateDoc(doc(db,"loans",lo.id), { adj, updatedAt:serverTimestamp() });
    $("loAdjBal").value=""; $("loAdjN").value="";
    msg("loAdjMsg", ap.t!=null ? `已校正：剩餘費用 ${fmt(ap.t)} 換算成剩餘本金約 ${fmt(bal)}（剩下的利息約 ${fmt(ap.t-bal)}）。卡片會照銀行的方式顯示剩餘費用，每繳一期就扣掉繳款金額。`
      : `已校正：剩餘本金從 ${fmt(before)} 改成依銀行的 ${fmt(bal)} 計算（${ym} 之後的月份從這裡接著扣）。`,"ok"); }
  catch(e){ msg("loAdjMsg","校正失敗："+errText(e),"err"); }
};
$("loAdjClear").onclick=async()=>{
  const lo=S.editingLoan; if(!lo) return;
  try{ await updateDoc(doc(db,"loans",lo.id), { adj:{}, updatedAt:serverTimestamp() }); msg("loAdjMsg","已取消校正，改回用每期本金計算。","ok"); }
  catch(e){ msg("loAdjMsg","失敗："+errText(e),"err"); }
};
/* 推算利率：本息平均攤還，已知本金、期數、月繳，反推年利率 */
function impliedRate(P, n, M){
  if(!(P>0 && n>0 && M>0) || M*n<=P) return 0;
  let lo=0, hi=0.1;
  for(let k=0;k<200;k++){ const r=(lo+hi)/2, pay=P*r/(1-Math.pow(1+r,-n)); if(pay<M) lo=r; else hi=r; }
  return (lo+hi)/2*1200;
}
$("loRateCalc").onclick=()=>{
  const P=Number($("loPrincipal").value)||0, n=Number($("loTotal").value)||0, M=Number($("loMonthly").value)||0;
  if(!P || !n || !M){ msg("loRateMsg","請先填原貸金額、總期數和月繳金額。","err"); return; }
  if(M*n<=P){ $("loRate").value=0; msg("loRateMsg",`月繳 × 期數（${fmt(M*n)}）沒有超過原貸金額，看起來是無息，年利率填 0。`,"ok"); return; }
  const r=Math.round(impliedRate(P,n,M)*100)/100;
  $("loRate").value=r;
  msg("loRateMsg",`推算年利率約 ${r}%：總共要繳 ${fmt(M*n)}，其中利息 ${fmt(M*n-P)}。第 1 期大約利息 ${fmt(Math.round(P*r/1200))}、本金 ${fmt(M-Math.round(P*r/1200))}。記得按「儲存」。`,"ok");
};
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
    rate:Math.min(Math.max(Number($("loRate").value)||0,0),100), io:$("loIO").checked, im:$("loIM").value,
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
/* ---- 信用卡：卡主、結帳日、轉帳 ---- */
/* 沒設定「我在帳本裡的名字」時用預設付款人；兩個都沒設定就全部算自己的（跟以前一樣） */
const meName = () => P().me || P().defaultPayer || "";
const cardCfg = card => { const c=(P().cardSet||{})[card]||{}; return { o:String(c.o||""), m:c.m==="o"?"o":"x", d:Math.max(0,Math.min(31,Number(c.d)||0)), p:Math.max(0,Math.min(31,Number(c.p)||0)) }; };
/* 這個月要繳的是哪個月結帳的帳單：繳款日在結帳日之後＝同月結帳；否則是上個月結帳的（沒填繳款日時，結帳後約 18 天繳款來推估） */
function closeYmFor(card, ym){
  const c=cardCfg(card); if(!c.d) return ym;
  const sameMonth = c.p ? c.p>c.d : c.d+18<=28;
  return sameMonth ? ym : addMonths(ym,-1);
}
const isMe = name => !name || !meName() || name===meName() || name==="我";
/* 卡主是不是別人（卡主沒填、填「我」或自己的名字都算自己） */
const ownerOther = o => !!o && o!=="我" && o!==meName();
/* 卡片這個月要繳的帳單區間：有結帳日就是「結帳月的上月結帳日隔天～結帳日」，沒有就是整個月 */
function cardRange(card, payYm){
  const d=cardCfg(card).d; if(!d) return [`${payYm}-01`, `${payYm}-${pad(dim(payYm))}`];
  const ym=closeYmFor(card, payYm);
  const prev=addMonths(ym,-1), pe=Math.min(d, dim(prev)), e=Math.min(d, dim(ym));
  const start = pe>=dim(prev) ? `${ym}-01` : `${prev}-${pad(pe+1)}`;
  return [start, `${ym}-${pad(e)}`];
}
function cleanCardSet(cs){ const out={}; if(cs && typeof cs==="object") Object.entries(cs).slice(0,50).forEach(([k,v])=>{ if(!v||typeof v!=="object") return;
  out[String(k).slice(0,20)]={ o:String(v.o||"").slice(0,20), m:v.m==="o"?"o":"x", d:Math.max(0,Math.min(31,Math.round(Number(v.d)||0))), p:Math.max(0,Math.min(31,Math.round(Number(v.p)||0))) }; }); return out; }
function cleanXfer(x){ const out={}; if(x && typeof x==="object") Object.entries(x).sort().slice(-600).forEach(([k,v])=>{ if(v&&typeof v==="object") out[String(k).slice(0,40)]={ a:Math.round(Number(v.a)||0), d:String(v.d||"").slice(0,10) }; }); return out; }
const xferKey = (card, ym) => `${card}|${ym}`;
const mdLabel = d => `${Number(d.slice(5,7))}/${pad(Number(d.slice(8,10)))}`;

async function loadCardBill(ym){
  const box=$("cardBill"); const token=billToken={}; S.rCardTotal=0; S.rXferTotal=0; $("rCard").textContent="…"; $("rXfer").textContent="…";
  box.textContent=""; box.appendChild(el("p","small muted","讀取中…"));
  const a=`${addMonths(ym,-2)}-01`, b=`${ym}-${pad(dim(ym))}`, raw=[];
  try{
    for(const l of S.ledgers.values()){
      const snap=await getDocs(query(collection(db,"ledgers",l.id,"entries"), where("date",">=",a), where("date","<=",b)));
      const seenId=new Set();
      snap.docs.forEach(d=>{ const e=d.data(); seenId.add(d.id); if(e.pay==="信用卡" && e.type==="out") raw.push({...e, id:d.id, ledger:l}); });
      // 手動改到這個月帳單、但消費日期比較早的
      const moved=await getDocs(query(collection(db,"ledgers",l.id,"entries"), where("bill","==",ym)));
      moved.docs.forEach(d=>{ if(seenId.has(d.id)) return; const e=d.data(); if(e.pay==="信用卡" && e.type==="out") raw.push({...e, id:d.id, ledger:l}); });
    }
  }catch(e){ if(token!==billToken) return; box.textContent=""; box.appendChild(el("p","msg err","讀取信用卡紀錄失敗："+errText(e))); return; }
  if(token!==billToken) return;
  // 照每張卡的帳單區間過濾
  // 分期的每一期已經指定「帳單月份」，直接照月份；一般消費照每張卡的帳單區間
  // 手動指定帳單月份的照指定
  const rows=raw.filter(e=>{ if(e.inst) return e.date.slice(0,7)===ym; if(e.bill) return e.bill===ym; const [s0,e0]=cardRange(e.card||"", ym); return e.date>=s0 && e.date<=e0; });
  // 分期手續費併進同一期的商品那一行
  const merged=[], seen=new Map();
  rows.slice().sort((x,y)=>isFee(x)-isFee(y)).forEach(e=>{
    if(e.inst){ const k=e.ledger.id+"|"+e.inst.g+"|"+e.inst.k, m=seen.get(k);
      if(m){ m.amount+=e.amount; m.fee=(m.fee||0)+(isFee(e)?e.amount:0); return; }
      const c={...e}; if(isFee(e)) c.fee=e.amount; seen.set(k,c); merged.push(c); }
    else merged.push(e); });
  // 分成：我的卡、要轉給卡主、其他（付款人不是我，或卡主自己繳）
  const mine=new Map(), xfer=new Map(), other=[];
  const push=(map,card,e)=>{ if(!map.has(card)) map.set(card,[]); map.get(card).push(e); };
  merged.forEach(e=>{
    const card=e.card||"未填卡片", cfg=cardCfg(card);
    let myAmt=e.amount, who=e.payer||"";
    const pm=paidMap(e);
    if(pm){ myAmt=Object.entries(pm).filter(([n])=>isMe(n)).reduce((t,[,v])=>t+v,0); who=Object.keys(pm).join("、"); }
    else if(!isMe(e.payer)) myAmt=0;
    if(myAmt<e.amount) other.push({...e, amount:e.amount-myAmt, who: pm ? Object.keys(pm).filter(n=>!isMe(n)).join("、") : who});
    if(myAmt<=0) return;
    const me={...e, amount:myAmt, part: myAmt<e.amount};
    if(ownerOther(cfg.o)){ if(cfg.m==="o") other.push({...me, who:cfg.o+"（持卡人自己繳）"}); else push(xfer,card,me); }
    else push(mine,card,me);
  });
  box.textContent="";
  const sum=list=>list.reduce((t,e)=>t+e.amount,0);
  const mineTotal=[...mine.values()].reduce((t,l)=>t+sum(l),0), xferTotal=[...xfer.values()].reduce((t,l)=>t+sum(l),0);
  S.rCardTotal=mineTotal; S.rXferTotal=xferTotal; $("rCard").textContent=fmt(mineTotal); $("rXfer").textContent=fmt(xferTotal);
  renderRepay(false);
  if(!merged.length){ box.appendChild(el("p","small muted",`${ymLabel(ym)}沒有信用卡消費。記帳時付款方式選「信用卡」、填上卡片名稱，就會出現在這裡；分期的會自動顯示第幾期。`)); return; }
  const rangeText=(card)=>{ const c=cardCfg(card); if(!c.d) return "照消費月份"; const [s0,e0]=cardRange(card, ym);
    return `${Number(e0.slice(5,7))}/${c.d} 結帳的帳單（${mdLabel(s0)}–${mdLabel(e0)} 的消費）` + (c.p ? `・${Number(ym.slice(5))}/${c.p} 前繳` : ""); };
  const setLink=()=>{ const k=el("button","link","設定"); k.type="button"; k.onclick=gotoCardSet; return k; };
  const table=(list, cols, cells)=>{
    const tw=el("div","table-wrap"), t=el("table","btable"), th=el("thead"), hr=el("tr");
    cols.forEach(x=>hr.appendChild(el("th",null,x))); th.appendChild(hr);
    const tb=el("tbody");
    list.sort((x,y)=>(x.inst?x.inst.purchase:x.date).localeCompare(y.inst?y.inst.purchase:y.date)).forEach(e=>{ const tr=el("tr"); cells(e).forEach(([c,v,extra])=>{ const td=el("td",c,v); if(extra){ td.append(" ", extra); } tr.appendChild(td); }); tb.appendChild(tr); });
    t.append(th,tb); tw.appendChild(t); return tw; };
  const itemText=e=>`${e.note||e.categoryName}${e.payer?`（${e.payer}）`:""}・${e.ledger.name}${e.part?"（我付的部分）":""}${e.fee?`（含手續費 ${fmt(e.fee)}）`:""}${isRb(e)?`（代墊${e.rb.s==="pending"?"・請款中":"・已收回"}）`:""}${e.bill?"（手動調整帳單月份）":""}`;
  /* 商家晚請款：一鍵移到下一期帳單（或改回自動） */
  const moveBtn=e=>{ if(e.inst || !canEdit(e.ledger)) return null;
    const b=el("button","link bill-move", e.bill ? "改回自動" : "移到下期"); b.type="button";
    b.title = e.bill ? "照卡片的結帳日自動算" : "商家比較晚請款，這筆會出現在下一期帳單";
    b.onclick=async()=>{ b.disabled=true; try{ await updateDoc(doc(db,"ledgers",e.ledger.id,"entries",e.id), { bill: e.bill ? "" : addMonths(ym,1), updatedAt:serverTimestamp() }); toast(e.bill?"已改回自動":"已移到下一期帳單"); loadCardBill(S.rYM); }catch(err){ toast("改不了："+errText(err)); b.disabled=false; } };
    return b; };
  const billCells=e=>{ const pd=e.inst?e.inst.purchase:e.date; let per="一次付清", rem="—";
    if(e.inst){ const base=Math.floor(e.inst.total/e.inst.n); const left= typeof e.inst.rem==="number" ? e.inst.rem : (e.inst.k>=e.inst.n?0:e.inst.total-base*e.inst.k);
      per=`${e.inst.k}/${e.inst.n}`; rem = left ? `${e.inst.n-e.inst.k} 期・${fmt(left)}` : "繳完"; }
    return [["num",pd.slice(5).replace("-","/")],[null,itemText(e),moveBtn(e)],["num",per],["num",fmt(e.amount)],["num",rem]]; };
  const cardBlock=(card, list, cls, title)=>{
    const wrap=el("div","bill-card"+(cls?" "+cls:"")); wrap.dataset.card=card;
    const h=el("div","bill-head"), nm=el("span",null,title); nm.appendChild(setLink()); h.append(nm, el("span","num",money(sum(list)))); wrap.appendChild(h);
    const c=cardCfg(card);
    wrap.appendChild(el("div","bill-sub", (ownerOther(c.o) ? `持卡人：${c.o}・轉帳給${c.o}繳卡費` : "持卡人：自己・自己繳卡費") + "・" + rangeText(card)));
    wrap.appendChild(table(list, ["消費日","項目","期數","本期","剩餘"], billCells));
    return wrap; };
  if(mine.size){ box.appendChild(el("div","bill-sec","我的卡"));
    [...mine.entries()].sort().forEach(([card,list])=>box.appendChild(cardBlock(card, list, "", card))); }
  if(xfer.size){ box.appendChild(el("div","bill-sec","別人名下的卡"));
    [...xfer.entries()].sort().forEach(([card,list])=>{ const c=cardCfg(card), total=sum(list);
      const w=cardBlock(card, list, "xfer", `${c.o}・${card}`);
      const row=el("div","xfer-row"), x=P().xfer[xferKey(card, ym)];
      const info=el("span"); info.appendChild(el("b",null,`這期要轉給${c.o}繳卡費 ${money(total)}`)); info.appendChild(el("br"));
      info.appendChild(el("span","small muted", x ? (x.a!==total ? `已轉 ${fmt(x.a)}，跟這期金額差 ${fmt(total-x.a)}` : "這期已轉清") : "轉帳不會再記一筆支出（刷卡當天已經記過了）"));
      const bt=el("button","xfer-btn"+(x?" done":""), x ? `✓ ${x.d?mdLabel(x.d)+" ":""}已轉 ${fmt(x.a)}` : "標記已轉帳"); bt.type="button";
      bt.onclick=()=>openXfer(card, ym, total);
      row.append(info, bt); w.appendChild(row); box.appendChild(w); }); }
  if(other.length){ box.appendChild(el("div","bill-sec","其他信用卡紀錄（不算進本月應繳）"));
    const w=el("div","bill-card other"); const h=el("div","bill-head"); h.append(el("span",null,"其他人付的"), el("span","num muted",money(sum(other)))); w.appendChild(h);
    w.appendChild(table(other, ["消費日","項目","卡片","金額","付款人"], e=>[["num",(e.inst?e.inst.purchase:e.date).slice(5).replace("-","/")],[null,`${e.note||e.categoryName}・${e.ledger.name}${e.inst?`（${e.inst.k}/${e.inst.n} 期）`:""}`],[null,e.card||"未填"],["num",fmt(e.amount)],[null,e.who||"—"]]));
    box.appendChild(w); }
}
function gotoCardSet(){ location.hash="#settings"; setTimeout(()=>{ const p=$("cardSetPanel"); if(p) p.scrollIntoView({behavior:"smooth", block:"start"}); }, 150); }
$("rCardSet").onclick=gotoCardSet;

/* 標記已轉帳給卡主 */
function openXfer(card, ym, total){
  const x=P().xfer[xferKey(card, ym)], c=cardCfg(card);
  S.xfer={card, ym, total}; msg("xfMsg","");
  $("xfWhat").textContent=`${c.o}・${card}・${ymLabel(ym)}：這期要轉 ${money(total)}`;
  $("xfAmt").value = x ? x.a : total; $("xfDate").value = x && x.d ? x.d : todayStr();
  $("xfUndo").hidden=!x; $("xfUndo").dataset.armed=""; $("xfUndo").textContent="取消已轉帳";
  $("xfSave").textContent = x ? "儲存修改" : "確定已轉帳";
  $("dlgXfer").showModal();
}
async function saveXfer(val){
  const {card, ym}=S.xfer, all={...P().xfer}; const k=xferKey(card, ym);
  if(val) all[k]=val; else delete all[k];
  await savePrefs({ xfer: cleanXfer(all) });
  loadCardBill(S.rYM);
}
$("formXfer").addEventListener("submit", async ev=>{
  if(ev.submitter && ev.submitter.value==="cancel") return;
  ev.preventDefault();
  const a=Math.round(Number($("xfAmt").value)||0), d=$("xfDate").value;
  if(a<=0){ msg("xfMsg","請輸入轉帳金額。","err"); return; }
  if(!/^\d{4}-\d{2}-\d{2}$/.test(d)){ msg("xfMsg","請選轉帳日期。","err"); return; }
  $("xfSave").disabled=true;
  try{ await saveXfer({a, d}); $("dlgXfer").close(); toast("已記下轉帳"); }
  catch(e){ msg("xfMsg","儲存失敗："+errText(e),"err"); }
  finally{ $("xfSave").disabled=false; }
});
$("xfUndo").onclick=async()=>{
  const b=$("xfUndo"); if(!b.dataset.armed){ b.dataset.armed="1"; b.textContent="再按一次確定取消"; return; }
  try{ await saveXfer(null); $("dlgXfer").close(); }catch(e){ msg("xfMsg","儲存失敗："+errText(e),"err"); }
};

/* 設定頁：信用卡與卡主 */
function renderCardSet(force){
  const box=$("gsCardRows"), p=P(), cards=p.cards;
  const sig=cards.join("|"); if(!force && box.dataset.sig===sig) return; box.dataset.sig=sig;
  $("gsMe").value=p.me; $("gsMe").placeholder = p.defaultPayer ? `${p.defaultPayer}（沿用預設付款人）` : "例如：我"; box.textContent="";
  if(!cards.length){ box.appendChild(el("p","small muted","還沒有信用卡。在下面直接新增，或記帳時填上卡片名稱，就會出現在這裡。")); return; }
  cards.forEach(card=>{ const c=cardCfg(card);
    const r=el("div","card-row"); r.dataset.card=card; r.appendChild(el("strong",null,card));
    const g=el("div","grid4");
    const f1=el("label","field"); f1.appendChild(el("span","label","持卡人（填人名）")); const o=el("input"); o.type="text"; o.maxLength=20; o.placeholder="空白＝自己"; o.value=c.o; o.setAttribute("list","dlGsPayers"); o.className="cs-o"; f1.appendChild(o);
    const f2=el("label","field"); f2.appendChild(el("span","label","卡費怎麼付")); const m=el("select"); m.className="cs-m";
    [["x","轉帳給持卡人繳費"],["o","持卡人自己繳（不算我的）"]].forEach(([v,t])=>{ const op=el("option",null,t); op.value=v; m.appendChild(op); }); m.value=c.m; f2.appendChild(m);
    const f3=el("label","field"); f3.appendChild(el("span","label","結帳日")); const d=el("select"); d.className="cs-d";
    const op0=el("option",null,"不設定"); op0.value="0"; d.appendChild(op0);
    for(let i=1;i<=31;i++){ const op=el("option",null,`每月 ${i} 號`); op.value=String(i); d.appendChild(op); } d.value=String(c.d); f3.appendChild(d);
    const f4=el("label","field"); f4.appendChild(el("span","label","繳款截止日")); const pd=el("select"); pd.className="cs-p";
    const opp=el("option",null,"不設定"); opp.value="0"; pd.appendChild(opp);
    for(let i=1;i<=31;i++){ const op=el("option",null,`每月 ${i} 號`); op.value=String(i); pd.appendChild(op); } pd.value=String(c.p); f4.appendChild(pd);
    const sync=()=>{ const v=o.value.trim(), me=$("gsMe").value.trim()||P().defaultPayer; const self=!v || v==="我" || v===me; m.disabled=self; f2.style.opacity=self?.5:1; };
    o.addEventListener("input", sync); sync();
    const hint=el("p","small muted cs-hint");
    const sh=()=>{ const dv=Number(d.value)||0, pv=Number(pd.value)||0; pd.disabled=!dv; f4.style.opacity=dv?1:.5;
      hint.textContent = !dv ? "沒設定結帳日：每個月的帳單就是那個月的消費。"
        : pv ? (pv>dv ? `${dv} 號結帳、同月 ${pv} 號前繳：這個月繳的是本月 ${dv} 號結帳的帳單。` : `${dv} 號結帳、隔月 ${pv} 號前繳：這個月繳的是上個月 ${dv} 號結帳的帳單。`)
        : "建議填繳款截止日（帳單上都有），金額才會出現在你真正要繳的那個月。"; };
    d.addEventListener("change", sh); pd.addEventListener("change", sh); sh();
    g.append(f1,f2,f3,f4); r.append(g, hint); box.appendChild(r); });
}
function readCardSet(){
  const cs={};
  document.querySelectorAll("#gsCardRows .card-row").forEach(r=>{ const o=r.querySelector(".cs-o").value.trim().slice(0,20), m=r.querySelector(".cs-m").value, d=Number(r.querySelector(".cs-d").value)||0, pp=d ? Number(r.querySelector(".cs-p").value)||0 : 0;
    if(o||d) cs[r.dataset.card]={o, m:m==="o"?"o":"x", d, p:pp}; });
  return cs;
}
$("gsCardSave").onclick=async()=>{
  const me=$("gsMe").value.trim().slice(0,20);
  try{ await savePrefs({ me, cardSet:readCardSet() }); msg("gsCardMsg","已儲存。「還款與分期」的信用卡帳單會照新的設定分類。","ok"); renderCardSet(true); }
  catch(e){ msg("gsCardMsg","儲存失敗："+errText(e),"err"); }
};
/* 直接在這裡新增信用卡（會連同目前填的設定一起存） */
async function addCardHere(){
  const v=$("gsCardNew").value.trim().slice(0,20), cards=P().cards; if(!v) return;
  if(cards.includes(v)){ msg("gsCardMsg",`已經有「${v}」了`,"err"); return; }
  if(cards.length>=50){ msg("gsCardMsg","信用卡最多 50 張","err"); return; }
  const me=$("gsMe").value.trim().slice(0,20);
  try{ await savePrefs({ cards:[...cards, v], me, cardSet:readCardSet() }); $("gsCardNew").value=""; msg("gsCardMsg",`已新增「${v}」，在下面設定持卡人和結帳日後按「儲存信用卡設定」。`,"ok"); renderGlobalSettings(false); renderCardSet(true); }
  catch(e){ msg("gsCardMsg","儲存失敗："+errText(e),"err"); }
}
$("gsCardAdd").onclick=addCardHere;
$("gsCardNew").addEventListener("keydown", e=>{ if(e.key==="Enter"){ e.preventDefault(); addCardHere(); } });

let resizeT; window.addEventListener("resize", ()=>{ clearTimeout(resizeT); resizeT=setTimeout(()=>{ if(S.lid && L()) renderTrend(); if(location.hash==="#invest" && S.snaps && S.snaps.length>1) renderNWChart(); }, 150); });

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
  if(picked && document.activeElement!==$("lkPicker")) $("lkPicker").value=picked;
  const isCustom=a==="custom";
  $("lkPickerNote").textContent = isCustom ? "目前使用自訂顏色" : "點色塊挑選任何顏色";
  $("lkPreview").hidden=!isCustom;
  if(isCustom){ let v={}; try{ v=JSON.parse(store.get("ledger.accentVars")||"{}"); }catch(e){}
    const pl=$("pvLight"), pd=$("pvDark");
    pl.textContent="淺色"; pl.style.cssText=`background:${v["--cl-accent"]};color:#fff`;
    pd.textContent="深色"; pd.style.cssText=`background:${v["--cd-accent"]};color:#0a1510`; }
}
/* 拖動調色盤時：只套用顏色、更新預覽和按鈕狀態，不動調色盤本身（避免瀏覽器把調色盤關掉） */
let lkRaf=0;
$("lkPicker").addEventListener("input", e=>{
  const hex=e.target.value;
  cancelAnimationFrame(lkRaf);
  lkRaf=requestAnimationFrame(()=>{
    const v=customVars(hex);
    store.set("ledger.accentCustom",hex); store.set("ledger.accentVars",JSON.stringify(v)); store.set("ledger.accent","custom");
    applyLook();
    document.querySelectorAll("#lkAccent .accent-opt").forEach(b=>b.setAttribute("aria-pressed","false"));
    $("lkPickerNote").textContent="目前使用自訂顏色";
    $("lkPreview").hidden=false;
    $("pvLight").textContent="淺色"; $("pvLight").style.cssText=`background:${v["--cl-accent"]};color:#fff`;
    $("pvDark").textContent="深色"; $("pvDark").style.cssText=`background:${v["--cd-accent"]};color:#0a1510`;
  });
});
applyLook();

/* ================= 個人設定（存在 users/{uid}，各裝置同步） ================= */
function watchPrefs(){
  stopPrefs();
  S.unsubPrefs=onSnapshot(doc(db,"users",S.user.uid), s=>{
    S.prefs = s.exists() ? s.data() : {};
    if(!S.startApplied){ S.startApplied=true; const sp=P().startPage; if(sp && !location.hash) location.hash=sp; }
    if(location.hash==="#settings") renderGlobalSettings(false);
    if(!location.hash){ renderBackupReminder(); maybeStartTour(); }
    refreshTips();
  }, ()=>{ S.prefs={}; S.startApplied=true; });
}
function stopPrefs(){ if(S.unsubPrefs){ S.unsubPrefs(); S.unsubPrefs=null; } S.prefs=null; }
async function savePrefs(patch){
  const next={...P(), ...patch}; S.prefs={...(S.prefs||{}), ...next};
  await setDoc(doc(db,"users",S.user.uid), {...next, updatedAt:serverTimestamp()});
}

function renderGlobalSettings(reset=true){
  document.querySelectorAll(".who-email").forEach(s=>s.textContent=S.user?S.user.email:"");
  tipsFor("tipSettings", [["settings3","外觀只影響這台裝置；記帳預設值和常用清單會跟著帳號，換手機也一樣。如果會刷別人名下的卡、再轉帳給持卡人繳費，可以在「信用卡與持卡人」設定持卡人；填上結帳日和繳款截止日，帳單金額就會出現在真正要繳的那個月。建議每個月「備份到 Google 雲端硬碟」一次。"]]);
  const lb=P().lastBackup;
  $("bkLast").textContent = lb ? `上次備份：${new Date(lb).toLocaleDateString("zh-TW")}（${Math.floor((Date.now()-lb)/864e5)} 天前）` : "還沒有備份過";
  renderLook();
  const p=P();
  if(reset){
    fillPayOptions("gsPay", p.defaultPay||"現金");
    $("gsPayer").value=p.defaultPayer; $("gsCard").value=p.defaultCard;
    const st=$("gsStart"); st.textContent="";
    [["","帳本列表"],["#repay","還款與分期"],["#invest","資產"],["#lists","清單"]].forEach(([v,t])=>{ const o=el("option",null,t); o.value=v; st.appendChild(o); });
    [...S.ledgers.values()].forEach(l=>{ const o=el("option",null,"帳本："+l.name); o.value="#l/"+l.id; st.appendChild(o); });
    st.value=p.startPage; if(st.value!==p.startPage) st.value="";
    const il=$("imLedger"), cur=il.value; il.textContent="";
    [...S.ledgers.values()].filter(canEdit).forEach(l=>{ const o=el("option",null,l.name+(isProj(l)?"（專案）":"")); o.value=l.id; il.appendChild(o); });
    if(cur) il.value=cur;
    if(!il.options.length){ const o=el("option",null,"請先建立一本帳本"); o.value=""; il.appendChild(o); }
  }
  const fill=(id,arr)=>{ const d=$(id); d.textContent=""; arr.forEach(v=>{ const o=el("option"); o.value=v; d.appendChild(o); }); };
  fill("dlGsPayers",p.payers); fill("dlGsCards",p.cards);
  renderCardSet(reset);
  document.querySelectorAll(".list-edit[data-list]").forEach(box=>{
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

/* ================= 完整備份與還原 ================= */
const tsOut = v => (v && typeof v.toMillis==="function") ? {__ts:v.toMillis()} : (v && typeof v==="object" && typeof v.seconds==="number" && Object.keys(v).length<=2) ? {__ts:Math.round(v.seconds*1000)} : v;
const cleanOut = o => Object.fromEntries(Object.entries(o).map(([k,v])=>[k,tsOut(v)]));
const tsIn = v => (v && typeof v==="object" && "__ts" in v) ? new Date(v.__ts) : v;
async function buildBackup(){
  const ledgers=[];
  for(const l of S.ledgers.values()){
    const snap=await getDocs(collection(db,"ledgers",l.id,"entries"));
    const {id, ...data}=l;
    let settles=[]; try{ settles=(await getDocs(collection(db,"ledgers",l.id,"settles"))).docs.map(d=>cleanOut(d.data())); }catch(e){}
    ledgers.push({ id, data:cleanOut(data), entries:snap.docs.map(d=>({id:d.id, ...cleanOut(d.data())})), settles });
  }
  const {lastBackup, ...prefs}=P();
  return { app:"記帳本", version:1, exportedAt:new Date().toISOString(), email:S.email,
    ledgers, loans:S.loans.map(({id,...d})=>({id, ...cleanOut(d)})), holdings:S.holdings.map(({id,...d})=>({id, ...cleanOut(d)})), snaps:S.snaps.map(({id,...d})=>({id, ...cleanOut(d)})), lists:await backupLists(), prefs };
}
const bkName = () => { const d=new Date(); return `記帳本備份_${todayStr()}_${pad(d.getHours())}${pad(d.getMinutes())}.json`; };
const bkCount = b => `${b.ledgers.length} 本帳、${b.ledgers.reduce((s,l)=>s+l.entries.length,0)} 筆紀錄、${b.loans.length} 筆貸款` + ((b.holdings||[]).length ? `、${b.holdings.length} 檔持股` : "") + ((b.lists||[]).length ? `、${b.lists.length} 個清單` : "");
async function backupLists(){
  const out=[];
  for(const x of S.lists.values()){ let items=[]; try{ items=(await getDocs(collection(db,"lists",x.id,"items"))).docs.map(d=>cleanOut(d.data())); }catch(e){}
    const {id,...data}=x; out.push({id, data:cleanOut(data), items}); }
  return out;
}
async function markBackup(){ try{ await savePrefs({lastBackup:Date.now()}); }catch(e){} renderGlobalSettings(false); }

$("bkDownload").onclick=async()=>{
  msg("bkMsg","準備備份中…");
  try{
    const b=await buildBackup();
    const a2=document.createElement("a"); a2.href=URL.createObjectURL(new Blob([JSON.stringify(b)],{type:"application/json"}));
    a2.download=bkName(); document.body.appendChild(a2); a2.click(); setTimeout(()=>{ URL.revokeObjectURL(a2.href); a2.remove(); },500);
    await markBackup(); msg("bkMsg",`已下載備份檔（${bkCount(b)}）。建議把檔案存到雲端硬碟或其他安全的地方。`,"ok");
  }catch(e){ msg("bkMsg","備份失敗："+errText(e),"err"); }
};

/* Google 雲端硬碟：用另一個登入視窗取得「只能存取本網站建立的檔案」的權限，不影響目前的登入 */
let driveToken=null, driveTokenAt=0, driveApp=null;
async function driveAuth(){
  if(driveToken && Date.now()-driveTokenAt < 50*60e3) return driveToken;
  if(!driveApp) driveApp=initializeApp(firebaseConfig, "drive");
  const a2=getAuth(driveApp);
  const prov=new GoogleAuthProvider();
  prov.addScope("https://www.googleapis.com/auth/drive.file");
  if(/@gmail\.com$/.test(S.email)) prov.setCustomParameters({login_hint:S.email});
  const res=await signInWithPopup(a2, prov);
  const cred=GoogleAuthProvider.credentialFromResult(res);
  signOut(a2).catch(()=>{});
  if(!cred || !cred.accessToken) throw new Error("沒有取得 Google 雲端硬碟的權限。");
  driveToken=cred.accessToken; driveTokenAt=Date.now(); return driveToken;
}
async function gfetch(url, opt={}){
  const r=await fetch(url,{...opt, headers:{...(opt.headers||{}), Authorization:"Bearer "+driveToken}});
  if(!r.ok){
    const t=await r.text(); let m=t; try{ m=JSON.parse(t).error.message; }catch(e){}
    if(r.status===401){ driveToken=null; throw new Error("Google 授權過期了，請再按一次。"); }
    if(r.status===403 && /not been used|disabled|not enabled/i.test(m)) throw new Error("還沒有開啟 Google Drive API。請照說明到 Google Cloud 主控台開啟後再試。");
    throw new Error(m || ("HTTP "+r.status));
  }
  return r;
}
const DRIVE="https://www.googleapis.com/drive/v3/files";
async function driveFolder(){
  const q=encodeURIComponent("name='記帳本備份' and mimeType='application/vnd.google-apps.folder' and trashed=false");
  const j=await (await gfetch(`${DRIVE}?q=${q}&fields=files(id,name)&spaces=drive`)).json();
  if(j.files && j.files.length) return j.files[0].id;
  const c=await (await gfetch(`${DRIVE}?fields=id`,{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({name:"記帳本備份", mimeType:"application/vnd.google-apps.folder"})})).json();
  return c.id;
}
async function driveUpload(name, obj){
  const folder=await driveFolder(), bd="bk"+rid()+rid();
  const body=`--${bd}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({name, parents:[folder], mimeType:"application/json"})}\r\n--${bd}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(obj)}\r\n--${bd}--`;
  return (await gfetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name",
    {method:"POST", headers:{"Content-Type":`multipart/related; boundary=${bd}`}, body})).json();
}
async function driveList(){
  const folder=await driveFolder(), q=encodeURIComponent(`'${folder}' in parents and trashed=false`);
  return ((await (await gfetch(`${DRIVE}?q=${q}&orderBy=createdTime%20desc&pageSize=20&fields=files(id,name,createdTime,size)`)).json()).files) || [];
}
async function driveGet(id){ return (await gfetch(`${DRIVE}/${id}?alt=media`)).json(); }
const driveErr = e => e && e.code==="auth/popup-closed-by-user" ? "Google 授權視窗被關掉了，請再按一次。" : errText(e);

$("bkDrive").onclick=async()=>{
  msg("bkMsg","請在跳出的 Google 視窗允許存取雲端硬碟…");
  try{
    await driveAuth();
    msg("bkMsg","備份中…");
    const b=await buildBackup(); const f=await driveUpload(bkName(), b);
    await markBackup(); msg("bkMsg",`已備份到 Google 雲端硬碟的「記帳本備份」資料夾：${f.name}（${bkCount(b)}）`,"ok");
  }catch(e){ msg("bkMsg","備份失敗："+driveErr(e),"err"); }
};
$("bkDriveList").onclick=async()=>{
  const box=$("bkDriveFiles"); msg("bkRMsg","請在跳出的 Google 視窗允許存取雲端硬碟…");
  try{
    await driveAuth(); msg("bkRMsg","讀取中…");
    const files=await driveList(); box.textContent=""; box.hidden=false; msg("bkRMsg","");
    if(!files.length){ box.appendChild(el("p","small muted","Google 雲端硬碟裡還沒有備份。")); return; }
    files.forEach(f=>{ const b=el("button","bk-file"); b.type="button";
      b.append(el("span",null,f.name), el("span","small muted", new Date(f.createdTime).toLocaleString("zh-TW")));
      b.onclick=async()=>{ msg("bkRMsg","下載中…"); try{ showRestore(await driveGet(f.id)); msg("bkRMsg",""); }catch(e){ msg("bkRMsg","讀取失敗："+driveErr(e),"err"); } };
      box.appendChild(b); });
  }catch(e){ msg("bkRMsg","讀取失敗："+driveErr(e),"err"); }
};
$("bkFile").addEventListener("change", async()=>{
  const f=$("bkFile").files[0]; if(!f) return;
  try{ showRestore(JSON.parse(await f.text())); msg("bkRMsg",""); }
  catch(e){ msg("bkRMsg","這不是記帳本的備份檔，或檔案已損壞。","err"); }
  $("bkFile").value="";
});

let BK=null;
function showRestore(b){
  if(!b || b.app!=="記帳本" || !Array.isArray(b.ledgers)) throw new Error("這不是記帳本的備份檔。");
  BK=b; $("bkDriveFiles").hidden=true; $("bkPreview").hidden=false;
  $("bkInfo").textContent=`備份時間：${new Date(b.exportedAt).toLocaleString("zh-TW")}・來自 ${b.email||"—"}・${bkCount(b)}`;
  const d=new Date(), tag=`（還原 ${d.getMonth()+1}/${d.getDate()}）`, box=$("bkLedgers"); box.textContent="";
  if(!b.ledgers.length) box.appendChild(el("p","small muted","這份備份裡沒有帳本。"));
  b.ledgers.forEach((lg,i)=>{ const lab=el("label","check"); const c=el("input"); c.type="checkbox"; c.value=String(i); c.checked=false;
    lab.append(c, document.createTextNode(`${lg.data.name}（${lg.entries.length} 筆）→ 建立新帳本「${(lg.data.name+tag).slice(0,40)}」`)); box.appendChild(lab); });
  const have=new Set(S.loans.map(x=>x.id)), missing=(b.loans||[]).filter(x=>!have.has(x.id));
  $("bkLoans").checked=missing.length>0; $("bkLoans").disabled=!missing.length;
  $("bkLoansText").textContent = (b.loans||[]).length ? `貸款：還原目前沒有的 ${missing.length} 筆（已存在的 ${(b.loans||[]).length-missing.length} 筆會略過）` : "貸款：這份備份沒有貸款";
  const haveH=new Set(S.holdings.map(x=>x.id)), missH=(b.holdings||[]).filter(x=>!haveH.has(x.id));
  const missS=(b.snaps||[]).filter(x=>!S.snaps.some(y=>y.id===x.id));
  $("bkHolds").checked=missH.length>0||missS.length>0; $("bkHolds").disabled=!missH.length && !missS.length;
  $("bkHoldsText").textContent = ((b.holdings||[]).length || (b.snaps||[]).length) ? `資產與投資：還原目前沒有的 ${missH.length} 檔持股、${missS.length} 筆資產紀錄（已存在的會略過）` : "資產與投資：這份備份沒有資料";
  const nLs=(b.lists||[]).length; $("bkLists").checked=nLs>0; $("bkLists").disabled=!nLs;
  $("bkListsText").textContent = nLs ? `清單：${nLs} 個，會建立成新的清單（不會覆蓋現有的）` : "清單：這份備份沒有清單";
  $("bkPrefs").checked=false; $("bkPrefs").disabled=!b.prefs;
}
const EF=["type","amount","categoryId","categoryName","date","note","pay","card","payer","paid","status","budget","priority","inst","split","rb"];
$("bkRestore").onclick=async()=>{
  if(!BK) return;
  const picks=[...document.querySelectorAll("#bkLedgers input:checked")].map(i=>BK.ledgers[Number(i.value)]);
  const doLoans=$("bkLoans").checked && !$("bkLoans").disabled, doPrefs=$("bkPrefs").checked, doHolds=$("bkHolds").checked && !$("bkHolds").disabled, doLists=$("bkLists").checked && !$("bkLists").disabled;
  if(!picks.length && !doLoans && !doPrefs && !doHolds && !doLists){ msg("bkRMsg","請勾選要還原的項目。","err"); return; }
  $("bkRestore").disabled=true; msg("bkRMsg","還原中…");
  try{
    const d=new Date(), tag=`（還原 ${d.getMonth()+1}/${d.getDate()}）`; let nE=0;
    for(const lg of picks){
      const x=lg.data;
      const ref=await addDoc(collection(db,"ledgers"), { name:(x.name+tag).slice(0,40), color:String(x.color||COLORS[0]).slice(0,20),
        ownerUid:S.user.uid, ownerEmail:S.email, editors:[], viewers:[], members:[S.email],
        categories:Array.isArray(x.categories)?x.categories.slice(0,200):[], budget:Number(x.budget)||0,
        mode:x.mode==="project"?"project":"normal", projectBudget:Number(x.projectBudget)||0, weekStart:String(x.weekStart||"").slice(0,10), ...(x.instAt==="buy"?{instAt:"buy"}:{}),
        ...(x.split && typeof x.split==="object" ? {split:x.split} : {}),
        createdAt:serverTimestamp(), updatedAt:serverTimestamp() });
      const col=collection(db,"ledgers",ref.id,"entries");
      for(let i=0;i<lg.entries.length;i+=400){
        const b=writeBatch(db);
        lg.entries.slice(i,i+400).forEach(e=>{ const o={}; EF.forEach(k=>{ if(e[k]!==undefined && e[k]!==null) o[k]=e[k]; });
          o.amount=Number(o.amount)||0; o.note=String(o.note||"").slice(0,100); o.pay=String(o.pay||"現金").slice(0,20);
          o.categoryId=String(o.categoryId||"x").slice(0,40); o.categoryName=String(o.categoryName||"其他").slice(0,40);
          b.set(doc(col), {...o, createdBy:S.user.uid, createdByEmail:S.email, createdAt:tsIn(e.createdAt)||serverTimestamp(), updatedAt:serverTimestamp()}); nE++; });
        await b.commit();
      }
      for(const st of (lg.settles||[])){ try{ await addDoc(collection(db,"ledgers",ref.id,"settles"), { from:String(st.from||"").slice(0,20), to:String(st.to||"").slice(0,20),
        amount:Number(st.amount)||0, date:String(st.date||todayStr()).slice(0,10), note:String(st.note||"").slice(0,100), createdBy:S.user.uid, createdByEmail:S.email, createdAt:serverTimestamp() }); }catch(e){} }
    }
    let nL=0;
    if(doLoans){ const have=new Set(S.loans.map(x=>x.id));
      for(const lo of BK.loans.filter(x=>!have.has(x.id))){
        const keys=["type","name","bank","day","principal","monthly","totalPeriods","periodsBase","paidBase","note","ledgerId","categoryId","categoryName","payments","rate","adj","io","im"], o={};
        keys.forEach(k=>{ if(lo[k]!==undefined) o[k]=lo[k]; });
        await setDoc(doc(db,"loans",lo.id), {type:"貸款",name:"",bank:"",day:0,principal:0,monthly:0,totalPeriods:0,periodsBase:0,paidBase:0,note:"",ledgerId:"",categoryId:"",categoryName:"",payments:{},
          ...o, ownerUid:S.user.uid, createdAt:serverTimestamp(), updatedAt:serverTimestamp()}); nL++; } }
    let nLs=0;
    if(doLists){ const d=new Date(), tg=`（還原 ${d.getMonth()+1}/${d.getDate()}）`;
      for(const ls of (BK.lists||[])){ const x=ls.data||{};
        const ref=await addDoc(collection(db,"lists"), { name:(String(x.name||"清單")+tg).slice(0,40), color:String(x.color||COLORS[0]).slice(0,20), ownerUid:S.user.uid, ownerEmail:S.email,
          editors:[], viewers:[], members:[S.email], memo:String(x.memo||"").slice(0,5000), createdAt:serverTimestamp(), updatedAt:serverTimestamp() });
        const its=ls.items||[];
        for(let k=0;k<its.length;k+=400){ const b=writeBatch(db);
          its.slice(k,k+400).forEach((it,j)=>b.set(doc(collection(db,"lists",ref.id,"items")), { text:String(it.text||"項目").slice(0,100), amount:Number(it.amount)||0,
            priority:["","高","中","低"].includes(it.priority)?it.priority:"", due:String(it.due||"").slice(0,10), note:String(it.note||"").slice(0,200), group:String(it.group||"").slice(0,20),
            via:it.via==="gift"?"gift":"", done:!!it.done, doneAt:String(it.doneAt||"").slice(0,10), spent:Number(it.spent)||0, ledgerId:"", entryId:"", order:Number(it.order)||k+j,
            createdBy:S.user.uid, createdByEmail:S.email, createdAt:serverTimestamp(), updatedAt:serverTimestamp() }));
          await b.commit(); }
        nLs++; } }
    let nH=0;
    if(doHolds){ const haveS=new Set(S.snaps.map(x=>x.id));
      for(const x of (BK.snaps||[]).filter(x=>!haveS.has(x.id))){ try{ await setDoc(doc(db,"snaps",x.id), { ownerUid:S.user.uid, date:String(x.date||todayStr()).slice(0,10),
        accounts:(x.accounts||[]).slice(0,30).map(a=>({n:String(a.n||"").slice(0,20), v:Number(a.v)||0})), inv:Number(x.inv)||0, loan:Number(x.loan)||0, loans:Array.isArray(x.loans)?x.loans.slice(0,30):[], note:String(x.note||"").slice(0,60),
        createdAt:serverTimestamp(), updatedAt:serverTimestamp() }); }catch(e){} } }
    if(doHolds){ const have=new Set(S.holdings.map(x=>x.id));
      for(const h of (BK.holdings||[]).filter(x=>!have.has(x.id))){
        await setDoc(doc(db,"holdings",h.id), { sym:String(h.sym||"?").slice(0,12), name:String(h.name||"").slice(0,30), cur:h.cur==="USD"?"USD":"TWD",
          kind:["stock","etf","bond"].includes(h.kind)?h.kind:"etf", price:Number(h.price)||0, priceAt:String(h.priceAt||"").slice(0,20),
          trades:Array.isArray(h.trades)?h.trades.slice(0,1000):[], note:String(h.note||"").slice(0,100), ownerUid:S.user.uid, createdAt:serverTimestamp(), updatedAt:serverTimestamp() }); nH++; } }
    if(doPrefs && BK.prefs){ const p=BK.prefs; await savePrefs({ defaultPay:String(p.defaultPay||""), defaultPayer:String(p.defaultPayer||""), defaultCard:String(p.defaultCard||""),
      startPage:String(p.startPage||""), ...(p.inv&&typeof p.inv==="object"?{inv:{disc:numOr(p.inv.disc,10),min:numOr(p.inv.min,20),fx:numOr(p.inv.fx,32)}}:{}), payers:(p.payers||[]).slice(0,50), cards:(p.cards||[]).slice(0,50), pays:(p.pays&&p.pays.length?p.pays:DEFAULT_PAYS).slice(0,30),
      me:String(p.me||"").slice(0,20), cardSet:cleanCardSet(p.cardSet), xfer:cleanXfer(p.xfer) }); }
    msg("bkRMsg",`還原完成：${picks.length} 本帳（${nE} 筆紀錄）、${nL} 筆貸款${nH?`、${nH} 檔持股`:""}${nLs?`、${nLs} 個清單`:""}${doPrefs?"、設定":""}。還原的帳本在「帳本」頁，分享設定需要重新設定。`,"ok");
    toast("還原完成"); $("bkPreview").hidden=true; BK=null;
  }catch(e){ msg("bkRMsg","還原失敗："+errText(e),"err"); }
  finally{ $("bkRestore").disabled=false; }
};

/* ================= 新手教學 ================= */
/* 情境小提示：每個提示只出現到按「知道了」為止，紀錄存在帳號裡 */
function tipsFor(slotId, items){
  const box=$(slotId); if(!box) return; box.textContent="";
  if(!S.prefs) return;
  const seen=new Set(P().tips);
  items.filter(([id])=>!seen.has(id)).forEach(([id,text])=>{
    const d=el("div","tip"); d.dataset.tip=id; d.appendChild(el("div",null,text));
    const x=el("button","tip-x","知道了"); x.type="button"; x.onclick=()=>dismissTip(id, d);
    d.appendChild(x); box.appendChild(d);
  });
}
async function dismissTip(id, node){
  node.remove();
  try{ await savePrefs({ tips:[...P().tips.filter(t=>t!==id), id].slice(-50) }); }catch(e){}
}
function renderLedgerTips(l){
  const items=[];
  if(!isOwner(l)) items.push(["shared", `這本帳是 ${l.ownerEmail} 分享給你的，你的權限是「${roleText(l)}」。` +
    (canEdit(l) ? "你可以記帳和修改紀錄；分享、改名和刪除帳本只有擁有者能做。" : "你可以查看所有紀錄和統計，但不能新增或修改。")]);
  if(isProj(l)) items.push(["project","這是專案帳本：每筆可以先只填預算，之後再補實際金額。點每筆右邊的「完成／未完成」可以直接切換，上方會顯示完成率和還需要準備多少錢。"]);
  else items.push(["ledger","點「分類統計」的長條，可以只看那個分類的明細；點任一筆紀錄可以修改或刪除。上方切換「月／年／全部」可以看不同期間。"]);
  if(canEdit(l) && !aaOn(l)) items.push(["aa-intro","和家人一起出錢？到「帳本設定」→「AA 分帳」打開，填一起分攤的人和比例（不一定要各一半，例如 60／40），系統會算出誰要給誰多少。"]);
  if((S.rbPending||[]).length || S.entries.some(isRb)) items.push(["rb","代墊的錢不會算進支出。公司付回來後，在「代墊・待請款」按「已收到」就好；公司匯進來的錢和轉帳繳卡費都不用另外記，不然會重複計算。"]);
  if(aaOn(l)) items.push(["aa-use2","這本帳有開 AA：記帳時一定要選「付款人」（誰先出的錢）；兩個人各付一部分時，勾「不只一個人付」填各付多少。某一筆不想照比例，可以選「只算付款人」或「這筆自訂」。轉帳給對方後，在「AA 結算」按「記錄已結清」就會歸零。"]);
  tipsFor("tipLedger", items);
}
function refreshTips(){
  if(S.lid && L() && !$("viewLedger").hidden) renderLedgerTips(L());
  if(!$("viewRepay").hidden) tipsFor("tipRepay", [["repay9","貸款：填年利率會自動拆本金和利息；跟銀行對不起來就在「編輯」校正（銀行寫含利息的「剩餘費用」也可以），看不到已繳期數可以按「幫我推算」。信用卡：在「信用卡設定」填好持卡人、結帳日和繳款截止日；刷別人名下的卡，轉帳給持卡人繳費後按「標記已轉帳」；商家晚請款的消費可以按「移到下期」。"]]);
  if(!$("viewInvest").hidden) renderInvestTips();
  if(!$("viewSettings").hidden) tipsFor("tipSettings", [["settings3","外觀只影響這台裝置；記帳預設值和常用清單會跟著帳號，換手機也一樣。如果會刷別人名下的卡、再轉帳給持卡人繳費，可以在「信用卡與持卡人」設定持卡人；填上結帳日和繳款截止日，帳單金額就會出現在真正要繳的那個月。建議每個月「備份到 Google 雲端硬碟」一次。"]]);
}

/* 歡迎導覽 */
const TOUR=[
  { sel:null, title:"歡迎使用記帳本", text:"花 30 秒認識一下怎麼用。隨時可以按「略過教學」，之後也能在「設定」重新看一次。" },
  { sel:"#btnNewLedger", title:"第一步：建立帳本", text:"可以從個人、家庭、孕期、寶寶、搬家範本開始，分類都能自己增減。孕期、搬家這類有總預算的，會自動開啟專案模式。" },
  { sel:"#viewHome .lcard", title:"記一筆", text:"點進帳本後，右下角的「＋ 記一筆」就能記帳，只有金額和分類必填。可以切換支出／收入；出差先幫公司付的錢勾「代墊」，請款前不算自己的支出。",
    alt:"建好帳本後點進去，右下角的「＋ 記一筆」就能記帳，只有金額和分類必填。可以切換支出／收入；出差先幫公司付的錢勾「代墊」，請款前不算自己的支出。" },
  { sel:'#viewHome .tabs a[href="#repay"]', title:"還款與分期", text:"貸款和信用卡分期都在這裡：這個月要繳哪些、還剩幾期一目了然，每月按一下「標記已繳」就好。銀行貸款填上年利率，會自動拆本金和利息；不知道利率可以一鍵推算，學貸緩繳也能記。跟銀行 APP 對不起來時可以「校正剩餘本金」，銀行寫含利息的剩餘費用也能照著對，看不到已繳期數也能幫你推算；最後一期金額不同也會自動算好。信用卡帳單會依持卡人分開，刷別人名下的卡也能算出這期要轉多少、記下轉了沒。" },
  { sel:'#viewHome .tabs a[href="#invest"]', title:"資產", text:"每個月填一次各戶頭有多少錢，就能看到淨資產的變化（會自動算進投資、扣掉每筆貸款），還會比較每個戶頭比上次多或少多少。下面是股票、ETF：買進、賣出、股息各記一筆，會自動算持有股數、平均成本和賺賠。只有你自己看得到。" },
  { sel:'#viewHome .tabs a[href="#lists"]', title:"清單", text:"待產包、寶寶用品、想買的東西都可以列在這裡，每項可以填預估金額、分組、截止日。打勾時可以順便記一筆支出到帳本，親友送的、家裡已有的也能直接勾掉。清單可以分享給家人一起勾。" },
  { sel:'#viewHome .topbar a[href="#settings"]', title:"設定", text:"換顏色、設定預設付款人和信用卡、設定每張卡的持卡人、結帳日和繳款日、備份到 Google 雲端硬碟都在這裡。帳本要分享給家人，則是點進帳本後的「帳本設定」。" }
];
let tourI=0;
const tourTarget = () => { const s=TOUR[tourI].sel; const t=s && document.querySelector(s); return t && t.offsetParent!==null ? t : null; };
function maybeStartTour(){
  if(!S.prefs || P().tourDone || !$("tour").hidden) return;
  if(location.hash || $("viewHome").hidden || !S.ledgersReady) return;
  if(document.querySelector("dialog[open]")) return;
  tourI=0; $("tour").hidden=false; showTourStep();
}
function showTourStep(){
  const st=TOUR[tourI], t=tourTarget();
  $("tourStep").textContent=`${tourI+1} / ${TOUR.length}`;
  $("tourTitle").textContent=st.title; $("tourText").textContent = t||!st.alt ? st.text : st.alt;
  $("tourPrev").hidden = tourI===0;
  $("tourNext").textContent = tourI===TOUR.length-1 ? "開始使用" : "下一步";
  placeTour(); $("tourNext").focus();
}
function placeTour(){
  if($("tour").hidden) return;
  const t=tourTarget(), hole=$("tourHole"), card=$("tourCard");
  if(t){
    t.scrollIntoView({block:"center"});
    const r=t.getBoundingClientRect();
    hole.classList.remove("none");
    Object.assign(hole.style,{ left:(r.left-6)+"px", top:(r.top-6)+"px", width:(r.width+12)+"px", height:(r.height+12)+"px" });
    const cw=card.offsetWidth, ch=card.offsetHeight, vw=innerWidth, vh=innerHeight;
    const top = r.bottom+16+ch < vh ? r.bottom+16 : Math.max(12, r.top-16-ch);
    const left = Math.min(Math.max(16, r.left+r.width/2-cw/2), vw-cw-16);
    card.style.top=top+"px"; card.style.left=left+"px";
  } else {
    hole.classList.add("none");
    card.style.left=Math.max(16,(innerWidth-card.offsetWidth)/2)+"px"; card.style.top=Math.max(20,(innerHeight-card.offsetHeight)/2.4)+"px";
  }
}
async function endTour(){ $("tour").hidden=true; try{ await savePrefs({tourDone:true}); }catch(e){} }
$("tourNext").onclick=()=>{ if(tourI>=TOUR.length-1) endTour(); else { tourI++; showTourStep(); } };
$("tourPrev").onclick=()=>{ if(tourI>0){ tourI--; showTourStep(); } };
$("tourSkip").onclick=endTour;
document.addEventListener("keydown", e=>{ if(e.key==="Escape" && !$("tour").hidden) endTour(); });
window.addEventListener("resize", ()=>placeTour());
$("gsReplay").onclick=async()=>{
  try{ await savePrefs({ tourDone:false, tips:[] }); }catch(e){ toast("設定失敗："+errText(e)); return; }
  location.hash=""; setTimeout(maybeStartTour, 250);
};

/* ================= AA 分帳結算 ================= */
const aaOn = l => !!(l && l.split && l.split.on && (l.split.people||[]).length>=2);
const evenRatio = ppl => { const n=ppl.length||1, base=Math.floor(100/n*100)/100; const r={}; ppl.forEach((p,i)=>r[p]= i===n-1 ? Math.round((100-base*(n-1))*100)/100 : base); return r; };
const knownPayersAll = () => [...new Set([...P().payers, ...S.entries.map(e=>e.payer).filter(Boolean)])];

function ensureAA(l){
  if(aaOn(l)){ if(!S.unsubAA) startAA(l.id); else renderAA(); }
  else { stopAA(); $("aaPanel").hidden=true; }
}
function startAA(lid){
  stopAA();
  const tok=S.aaTok={};
  S.aaEntries=[]; S.settles=[]; S.aaReady=0;
  const u1=onSnapshot(collection(db,"ledgers",lid,"entries"), s=>{ if(tok!==S.aaTok) return; S.aaEntries=s.docs.map(d=>({id:d.id,...d.data()})); S.aaReady|=1; renderAA(); }, ()=>{});
  const u2=onSnapshot(collection(db,"ledgers",lid,"settles"), s=>{ if(tok!==S.aaTok) return; S.settles=s.docs.map(d=>({id:d.id,...d.data()})); S.aaReady|=2; renderAA(); }, ()=>{ S.aaReady|=2; renderAA(); });
  S.unsubAA=()=>{ u1(); u2(); };
}
function stopAA(){ S.aaTok=null; if(S.unsubAA){ S.unsubAA(); S.unsubAA=null; } S.aaEntries=[]; S.settles=[]; }

function computeAA(l){
  const people=l.split.people, ratio=l.split.ratio||evenRatio(people);
  const row={}; people.forEach(p=>row[p]={paid:0, share:0, sent:0, recv:0});
  let skipped=0, skippedAmt=0;
  // 代墊請款的只算公司沒補回的部分
  S.aaEntries.filter(e=>e.type==="out" && own(e)>0).forEach(e=>{
    const amt=own(e), pm=paidMap(e);
    if(pm){ const names=Object.keys(pm), t=names.reduce((a,p)=>a+(Number(pm[p])||0),0);
      if(!t || names.some(p=>!people.includes(p))){ skipped++; skippedAmt+=amt; return; }
      names.forEach(p=>row[p].paid += amt*(Number(pm[p])||0)/t); }
    else { if(!people.includes(e.payer)){ skipped++; skippedAmt+=amt; return; }
      row[e.payer].paid+=amt; }
    const sp=e.split||{m:"d"};
    if(sp.m==="s"){ if(pm){ const t=Object.values(pm).reduce((a,b)=>a+(Number(b)||0),0); Object.keys(pm).forEach(p=>row[p].share += amt*(Number(pm[p])||0)/t); } else row[e.payer].share+=amt; return; }
    const r = (sp.m==="c" || sp.m==="a") && sp.r ? sp.r : ratio;
    const tot=people.reduce((s,p)=>s+(Number(r[p])||0),0) || 100;
    people.forEach(p=>row[p].share += amt*(Number(r[p])||0)/tot);
  });
  S.settles.forEach(s=>{ if(row[s.from]) row[s.from].sent+=s.amount; if(row[s.to]) row[s.to].recv+=s.amount; });
  people.forEach(p=>{ const x=row[p]; x.bal = x.paid - x.share + x.sent - x.recv; });
  // 最少次數的轉帳建議
  const cred=people.filter(p=>row[p].bal>0.5).map(p=>({p,v:row[p].bal})).sort((a,b)=>b.v-a.v);
  const debt=people.filter(p=>row[p].bal<-0.5).map(p=>({p,v:-row[p].bal})).sort((a,b)=>b.v-a.v);
  const moves=[]; let i=0,j=0;
  while(i<debt.length && j<cred.length){ const v=Math.min(debt[i].v,cred[j].v); if(Math.round(v)>0) moves.push({from:debt[i].p,to:cred[j].p,amount:Math.round(v)});
    debt[i].v-=v; cred[j].v-=v; if(debt[i].v<0.5) i++; if(cred[j].v<0.5) j++; }
  return {people, row, moves, skipped, skippedAmt};
}
function renderAA(){
  const l=L(); const panel=$("aaPanel");
  if(!aaOn(l)){ panel.hidden=true; return; }
  panel.hidden=false; const box=$("aaBody"); box.textContent="";
  if(S.aaReady!==3){ box.appendChild(el("p","small muted","計算中…")); return; }
  const {people,row,moves,skipped,skippedAmt}=computeAA(l), editable=canEdit(l);
  const ratio=l.split.ratio||evenRatio(people);
  box.appendChild(el("p","small muted",`預設比例：${people.map(p=>`${p} ${ratio[p]}%`).join("・")}（可以在「帳本設定」改，也可以每筆另外設定）`));
  const tw=el("div","table-wrap"), t=el("table","aa-table"), th=el("thead"), hr=el("tr");
  ["","實際付了","應該分攤","已結算","差額"].forEach(x=>hr.appendChild(el("th",null,x))); th.appendChild(hr);
  const tb=el("tbody");
  people.forEach(p=>{ const x=row[p], tr=el("tr"); const net=x.sent-x.recv;
    tr.append(el("td",null,p), el("td","num",fmt(x.paid)), el("td","num",fmt(x.share)), el("td","num",net? (net>0?"+":"−")+fmt(Math.abs(net)) : "—"),
      el("td","num "+(x.bal>0.5?"c-in":x.bal<-0.5?"c-out":""), Math.abs(x.bal)<0.5?"0":(x.bal>0?"多付 ":"少付 ")+fmt(Math.abs(x.bal))));
    tb.appendChild(tr); });
  t.append(th,tb); tw.appendChild(t); box.appendChild(tw);
  if(!moves.length){ box.appendChild(el("div","aa-even","目前已經打平，不用互相給錢。")); }
  moves.forEach(mv=>{
    const d=el("div","aa-result"); const w=el("div","who");
    w.append(document.createTextNode(`${mv.from} 要給 ${mv.to} `), el("span","num",money(mv.amount)));
    d.appendChild(w);
    if(editable){ const b=el("button","btn primary","記錄已結清"); b.type="button";
      b.onclick=async()=>{ if(!b.dataset.armed){ b.dataset.armed="1"; b.textContent=`確定 ${mv.from} 已給 ${mv.to} ${money(mv.amount)}？`; return; }
        b.disabled=true;
        try{ await addDoc(collection(db,"ledgers",l.id,"settles"), { from:mv.from, to:mv.to, amount:mv.amount, date:todayStr(), note:"",
          createdBy:S.user.uid, createdByEmail:S.email, createdAt:serverTimestamp() }); toast("已記錄結清"); }
        catch(e){ toast("記錄失敗："+errText(e)); b.disabled=false; } };
      d.appendChild(b); }
    box.appendChild(d);
  });
  if(skipped) box.appendChild(el("p","small muted",`有 ${skipped} 筆（${money(skippedAmt)}）沒有填付款人，或付款人不在分攤名單裡，沒有算進來。`));
  if(S.settles.length){
    const det=el("details","aa-hist"); det.appendChild(el("summary",null,`結算紀錄（${S.settles.length} 筆）`));
    S.settles.slice().sort((a,b)=>b.date.localeCompare(a.date)).forEach(s=>{ const r=el("div","row");
      r.append(el("span",null,`${s.date.slice(5).replace("-","/")}　${s.from} → ${s.to}`), el("span","num",money(s.amount)));
      if(editable){ const x=el("button","link","刪除"); x.type="button";
        x.onclick=async()=>{ if(!x.dataset.armed){ x.dataset.armed="1"; x.textContent="確定刪除？"; return; }
          try{ await deleteDoc(doc(db,"ledgers",l.id,"settles",s.id)); toast("已刪除結算紀錄"); }catch(e){ toast("刪除失敗："+errText(e)); } };
        r.appendChild(x); }
      det.appendChild(r); });
    box.appendChild(det);
  }
}

/* 記一筆：這筆怎麼分攤 */
/* 這筆自訂：可以用比例（m:"c"，r 是 %）或直接填金額（m:"a"，r 是每人金額）。
   結算時兩種都當權重算：分攤 = 金額 × 自己的數字 ÷ 大家的數字加總，所以金額模式也能正確套到分期或代墊差額 */
function splitAmtDefault(people, ratio, amt){
  let acc=0; const o={}; people.forEach((p,i)=>{ if(i===people.length-1) o[p]=amt-acc; else { o[p]=Math.round(amt*(Number(ratio[p])||0)/100); acc+=o[p]; } }); return o;
}
function renderSplitUI(){
  const l=L(), show=aaOn(l) && S.eType==="out";
  $("eSplitBox").hidden=!show; if(!show) return;
  const custom=S.eSplit.m==="c"||S.eSplit.m==="a";
  document.querySelectorAll("#eSplitMode button").forEach(b=>b.setAttribute("aria-pressed", b.dataset.m==="c" ? custom : b.dataset.m===S.eSplit.m));
  const people=l.split.people, ratio=l.split.ratio||evenRatio(people), grid=$("eSplitCustom"); grid.textContent="";
  $("eSplitUnit").hidden=!custom;
  document.querySelectorAll("#eSplitUnit button").forEach(b=>b.setAttribute("aria-pressed", b.dataset.u===S.eSplit.m));
  if(custom){
    const amtMode=S.eSplit.m==="a", amt=Math.round(Number($("eAmount").value)||0);
    if(amtMode && people.some(p=>S.eSplit.r[p]==null)) S.eSplit.r=splitAmtDefault(people, ratio, amt);
    people.forEach(p=>{ if(S.eSplit.r[p]==null) S.eSplit.r[p]=ratio[p]; });
    people.forEach((p,idx)=>{ const lab=el("label",null,p); const w=el("span","pct-in"); const inp=el("input"); inp.type="number"; inp.min="0"; inp.step=amtMode?"1":"any"; inp.inputMode=amtMode?"numeric":"decimal";
      if(!amtMode) inp.max="100";
      inp.value=S.eSplit.r[p]; inp.dataset.p=p; inp.setAttribute("aria-label",p+(amtMode?" 分攤金額":" 分攤比例"));
      inp.addEventListener("input",()=>{ S.eSplit.r[p]=Number(inp.value)||0;
        if(amtMode && people.length===2){ const other=people[1-idx], a=Math.round(Number($("eAmount").value)||0);
          S.eSplit.r[other]=Math.max(a-S.eSplit.r[p],0); const oi=grid.querySelector(`input[data-p="${other}"]`); if(oi) oi.value=S.eSplit.r[other]; }
        splitNote(); });
      if(amtMode) w.append(document.createTextNode("NT$ "), inp); else w.append(inp, document.createTextNode("%"));
      lab.appendChild(w); grid.appendChild(lab); });
  }
  splitNote();
}
function splitNote(){
  const l=L(); if(!aaOn(l)) return;
  const people=l.split.people, amt=Math.round(Number($("eAmount").value)||0), n=$("eSplitNote");
  const multi=$("eMultiPay").checked, payer=$("ePayer").value.trim();
  n.classList.remove("warn-text");
  if(multi && S.eSplit.m==="s"){ n.textContent="各自付的就是各自負擔的，這筆不用互相補錢。"; return; }
  if(!multi){
    if(payer && !people.includes(payer)){ n.classList.add("warn-text"); n.textContent=`「${payer}」不在分攤名單（${people.join("、")}），這筆不會算進 AA。`; return; }
    if(!payer){ n.textContent="先在上面選誰付的錢，這筆才會算進 AA 結算。"; return; }
    if(S.eSplit.m==="s"){ n.textContent=`這筆全部算 ${payer} 自己的，不用分。`; return; }
  }
  // 每人應負擔
  let share={};
  if(S.eSplit.m==="a"){
    const sum=people.reduce((t,p)=>t+(Number(S.eSplit.r[p])||0),0);
    if(sum!==amt){ n.classList.add("warn-text"); n.textContent=`每人金額加起來是 ${money(sum)}，要等於這筆金額 ${money(amt)}（差 ${money(Math.abs(amt-sum))}）。`; return; }
    people.forEach(p=>share[p]=Number(S.eSplit.r[p])||0);
  } else {
    const r = S.eSplit.m==="c" ? S.eSplit.r : (l.split.ratio||evenRatio(people));
    const sum=people.reduce((t,p)=>t+(Number(r[p])||0),0);
    if(Math.abs(sum-100)>0.01){ n.classList.add("warn-text"); n.textContent=`比例加起來是 ${sum}%，要剛好 100%。`; return; }
    if(!(amt>0)){ n.textContent=people.map(p=>`${p} ${r[p]}%`).join("・"); return; }
    people.forEach(p=>share[p]=amt*(Number(r[p])||0)/100);
  }
  // 每人實際付的
  const paid={}; people.forEach(p=>paid[p]=0);
  if(multi){ people.forEach(p=>paid[p]=Number((S.ePaid||{})[p])||0); } else paid[payer]=amt;
  let txt=people.map(p=>`${p} 應負擔 ${money(share[p])}`).join("・");
  // 這筆誰要補誰（兩個人時最清楚）
  const bal=people.map(p=>[p, paid[p]-share[p]]).filter(x=>Math.abs(x[1])>=0.5);
  if(people.length===2 && bal.length){ const over=bal.find(x=>x[1]>0), under=bal.find(x=>x[1]<0);
    if(over && under) txt+=`。這筆算下來：${under[0]} 要補給 ${over[0]} ${money(over[1])}`; }
  else if(!bal.length && amt>0) txt+="。這筆剛好打平，不用補錢";
  n.textContent=txt+"。";
}
document.querySelectorAll("#eSplitMode button").forEach(b=>b.onclick=()=>{
  if(b.dataset.m==="c"){ if(S.eSplit.m!=="c" && S.eSplit.m!=="a"){ S.eSplit.m = store.get("ledger.splitUnit")==="a" ? "a" : "c"; S.eSplit.r={}; } }
  else S.eSplit.m=b.dataset.m;
  renderSplitUI(); });
/* 比例 ↔ 金額 切換時互相換算 */
document.querySelectorAll("#eSplitUnit button").forEach(b=>b.onclick=()=>{
  const u=b.dataset.u; if(u===S.eSplit.m) return;
  const l=L(), people=l.split.people, amt=Math.round(Number($("eAmount").value)||0);
  if(u==="a"){ const pct={}; people.forEach(p=>pct[p]=Number(S.eSplit.r[p])||0); S.eSplit.r=splitAmtDefault(people, pct, amt); }
  else { const tot=people.reduce((s,p)=>s+(Number(S.eSplit.r[p])||0),0)||1; const o={}; let acc=0;
    people.forEach((p,i)=>{ if(i===people.length-1) o[p]=Math.round((100-acc)*100)/100; else { o[p]=Math.round((Number(S.eSplit.r[p])||0)/tot*10000)/100; acc+=o[p]; } }); S.eSplit.r=o; }
  S.eSplit.m=u; store.set("ledger.splitUnit", u); renderSplitUI(); });
$("eAmount").addEventListener("input", ()=>{ if($("eSplitBox").hidden) return;
  // 金額模式、兩個人：總額改了就讓最後一個人補差額
  const l=L(); if(S.eSplit.m==="a" && l && l.split.people.length===2){ const [a,b]=l.split.people, amt=Math.round(Number($("eAmount").value)||0);
    S.eSplit.r[b]=Math.max(amt-(Number(S.eSplit.r[a])||0),0); const bi=$("eSplitCustom").querySelector(`input[data-p="${b}"]`); if(bi) bi.value=S.eSplit.r[b]; }
  splitNote(); });
$("ePayer").addEventListener("input", ()=>{ if(!$("eSplitBox").hidden) splitNote(); });
$("ePayerChips").addEventListener("click", ()=>setTimeout(()=>{ if(!$("eSplitBox").hidden) splitNote(); },0));

/* 帳本設定：AA */
function renderAASettings(){
  const d=S.aaDraft; if(!d) return;
  $("sAAOn").checked=d.on; $("sAABox").hidden=!d.on;
  const chips=$("sAAPeople"); chips.textContent="";
  [...new Set([...knownPayersAll(), ...d.people])].forEach(p=>{ const b=el("button","chip",p); b.type="button"; b.setAttribute("aria-pressed", d.people.includes(p));
    b.onclick=()=>{ if(d.people.includes(p)) d.people=d.people.filter(x=>x!==p); else if(d.people.length<4) d.people.push(p); else { msg("sAAMsg","最多 4 個人。","err"); return; }
      d.ratio=evenRatio(d.people); renderAASettings(); };
    chips.appendChild(b); });
  const g=$("sAARatio"); g.textContent="";
  d.people.forEach(p=>{ const lab=el("label",null,p); const w=el("span","pct-in"); const inp=el("input"); inp.type="number"; inp.min="0"; inp.max="100"; inp.step="any"; inp.inputMode="decimal";
    inp.value=d.ratio[p]??0; inp.setAttribute("aria-label",p+" 預設比例"); inp.addEventListener("input",()=>{ d.ratio[p]=Number(inp.value)||0; aaSum(); });
    w.append(inp, document.createTextNode("%")); lab.appendChild(w); g.appendChild(lab); });
  if(!d.people.length) g.appendChild(el("span","small muted","先在上面選人。"));
  aaSum();
}
function aaSum(){ const d=S.aaDraft, s=d.people.reduce((t,p)=>t+(Number(d.ratio[p])||0),0);
  $("sAASum").textContent=`合計 ${Math.round(s*100)/100}%` + (Math.abs(s-100)>0.01?"（要剛好 100%）":""); $("sAASum").className="small "+(Math.abs(s-100)>0.01?"warn-text":"muted"); }
$("sAAOn").addEventListener("change",()=>{ S.aaDraft.on=$("sAAOn").checked; renderAASettings(); });
$("sAAEven").onclick=()=>{ S.aaDraft.ratio=evenRatio(S.aaDraft.people); renderAASettings(); };
$("sAANew").addEventListener("keydown", e=>{ if(e.key!=="Enter") return; e.preventDefault();
  const v=$("sAANew").value.trim().slice(0,20), d=S.aaDraft; if(!v) return;
  if(!d.people.includes(v)){ if(d.people.length>=4){ msg("sAAMsg","最多 4 個人。","err"); return; } d.people.push(v); d.ratio=evenRatio(d.people); }
  const pl=P().payers; if(!pl.includes(v) && pl.length<50) savePrefs({payers:[...pl, v]}).catch(()=>{});
  $("sAANew").value=""; renderAASettings(); });
$("sAASave").onclick=async()=>{
  const l=L(), d=S.aaDraft;
  if(d.on){
    if(d.people.length<2){ msg("sAAMsg","至少要選 2 個人。","err"); return; }
    const s=d.people.reduce((t,p)=>t+(Number(d.ratio[p])||0),0);
    if(Math.abs(s-100)>0.01){ msg("sAAMsg",`比例加起來要剛好 100%（目前 ${s}%）。`,"err"); return; }
  }
  const split={ on:d.on, people:d.people.slice(0,4), ratio:Object.fromEntries(d.people.slice(0,4).map(p=>[p,Number(d.ratio[p])||0])) };
  try{ await updateDoc(doc(db,"ledgers",l.id), { split, updatedAt:serverTimestamp() }); msg("sAAMsg", d.on?"已儲存，帳本頁會出現「AA 結算」。":"已關閉 AA 結算。","ok"); }
  catch(e){ msg("sAAMsg","儲存失敗："+errText(e),"err"); }
};

/* ================= 投資（股票／ETF） ================= */
/* 每一檔是一份 holdings 文件，交易紀錄放在 trades 陣列裡；只有自己看得到。
   成本用「平均成本法」：買進成本含手續費；賣出時依平均成本算已實現損益。 */
const fmtP = n => (Number(n)||0).toLocaleString("zh-TW",{maximumFractionDigits:2});
const fmtQ = n => (Number(n)||0).toLocaleString("zh-TW",{maximumFractionDigits:4});
const sgn = n => (n>0.5?"+":n<-0.5?"−":"") + fmt(Math.abs(n));
const upDown = n => n>0.5 ? "up" : n<-0.5 ? "down" : "";
const TD_LABEL={b:"買進",s:"賣出",d:"現金股息",sd:"配股"};
const TAX_RATE={stock:0.003, etf:0.001, bond:0};
const fxOf = h => h.cur==="USD" ? P().inv.fx : 1;
const sortTrades = ts => (ts||[]).map((t,k)=>({...t,_k:k})).sort((a,b)=>a.d<b.d?-1:a.d>b.d?1:a._k-b._k);

function watchHoldings(){
  stopHoldings(); S.holdingsReady=false;
  S.unsubHoldings=onSnapshot(query(collection(db,"holdings"), where("ownerUid","==",S.user.uid)), snap=>{
    S.holdings=snap.docs.map(d=>({id:d.id, ...d.data()})); S.holdingsReady=true;
    if(location.hash==="#invest") renderInvest();
    if(S.hdId && $("dlgHold").open) renderHoldDialog(false);
  }, e=>msg("investMsg","讀取投資資料失敗："+errText(e),"err"));
}
function stopHoldings(){ if(S.unsubHoldings){ S.unsubHoldings(); S.unsubHoldings=null; } S.holdings=[]; }

function holdStats(h, skipId){
  let q=0, cost=0, real=0, div=0, bought=0;
  for(const t of sortTrades(h.trades)){
    if(t.i===skipId) continue;
    if(t.t==="b"){ const c=t.q*t.p+(t.f||0); q+=t.q; cost+=c; bought+=c; }
    else if(t.t==="s"){ const qq=Math.min(t.q,q), avg=q>0?cost/q:0;
      real += t.q*t.p-(t.f||0)-(t.x||0) - avg*qq; cost-=avg*qq; q-=qq; if(q<1e-9){ q=0; cost=0; } }
    else if(t.t==="d") div+=t.a||0;
    else if(t.t==="sd") q+=t.q;
  }
  const mv=q*(h.price||0), unreal=q?mv-cost:0;
  return { q, cost, avg:q?cost/q:0, mv, unreal, pct:cost?unreal/cost:0, real, div, bought, total:unreal+real+div };
}

function renderInvestTips(){
  tipsFor("tipInvest", [["nw2","上面的「淨資產」：想到的時候（建議每月月底）把各戶頭和現金有多少填一次，系統會自動加上投資市值、扣掉每筆貸款，畫出資產變化。下方的比較表會列出每個戶頭、每筆貸款比上次多或少多少，點一列就能看那一項的曲線。不用記轉帳，也不用跟記帳對得上。"],["invest2","買進、賣出、股息都記在這裡，會自動算持有股數、平均成本和損益（和多數券商 App 一樣用平均成本法）。依台股習慣，紅色是賺、綠色是賠。現價可以按「更新台股收盤價」，或點持股自己填。在「手續費設定」填券商的折扣和最低手續費（零股常見 2.8 折、最低 1 元），市值下面就會算出跟券商 APP 一樣的參考現值。"]]);
}
function renderInvest(){
  renderInvestTips(); renderNW();
  const rows=S.holdings.map(h=>({h, st:holdStats(h), fx:fxOf(h)}));
  const act=rows.filter(r=>r.st.q>0).sort((a,b)=>b.st.mv*b.fx-a.st.mv*a.fx);
  const sold=rows.filter(r=>r.st.q<=0);
  let mv=0, cost=0, real=0, div=0;
  rows.forEach(r=>{ mv+=r.st.mv*r.fx; cost+=r.st.cost*r.fx; real+=r.st.real*r.fx; div+=r.st.div*r.fx; });
  const unreal=mv-cost, total=unreal+real+div;
  $("ivMV").textContent=money(mv);
  const hasUSD=rows.some(r=>r.h.cur==="USD");
  // 券商 APP 的「參考現值」通常先扣掉賣出時的手續費和交易稅
  // 券商逐檔取整數：市值無條件捨去、成本四捨五入
  const v=P().inv; let sc=0, net=0, costR=0;
  act.forEach(r=>{ const m=r.st.mv;
    if(r.h.cur!=="TWD"){ net+=m*r.fx; costR+=r.st.cost*r.fx; return; }
    const f=Math.max(v.min, Math.floor(m*0.001425*v.disc/10)) + Math.floor(m*(TAX_RATE[r.h.kind]??0.001));
    sc+=f; net+=Math.floor(m)-f; costR+=Math.round(r.st.cost); });
  const nu=net-costR, cost2=costR;
  $("ivMVNote").textContent = (sc>0 ? `扣掉賣出手續費和交易稅約 ${money(net)}，報酬 ${sgn(nu)}${cost2?`（${(nu/cost2*100>=0?"+":"")}${(nu/cost2*100).toFixed(2)}%）`:""}，跟券商 APP 的參考現值算法一樣。` : "")
    + (hasUSD ? `美股以匯率 ${fmtP(v.fx)} 換算成台幣（可在「手續費設定」改）。` : "");
  $("ivMVNote").className="small muted";
  $("ivCost").textContent=fmt(cost);
  const setPL=(id,v)=>{ const e=$(id); e.textContent=sgn(v); e.className="num mid "+upDown(v); };
  setPL("ivUnreal", unreal); if(cost) $("ivUnreal").textContent += `（${(unreal/cost*100>=0?"+":"")}${(unreal/cost*100).toFixed(1)}%）`;
  setPL("ivReal", real); setPL("ivDiv", div); setPL("ivTotal", total);
  $("ivDiv").className="num mid"+(div>0?" up":"");
  // 占比
  const al=$("ivAlloc"); al.textContent="";
  if(!act.length || mv<=0) al.appendChild(el("p","small muted", S.holdingsReady ? "還沒有持股。按「＋ 記一筆交易」記第一筆買進。" : "讀取中…"));
  else {
    const bar=el("div","alloc-bar"), lg=el("div","alloc-legend");
    act.forEach((r,k)=>{ const v=r.st.mv*r.fx, pc=v/mv*100, c=COLORS[k%COLORS.length];
      const seg=el("span"); seg.style.width=pc+"%"; seg.style.background=c; seg.title=`${r.h.sym} ${pc.toFixed(1)}%`; bar.appendChild(seg);
      const li=el("div","alloc-item"); const dot=el("i"); dot.style.background=c;
      li.append(dot, el("span",null,`${r.h.sym} ${r.h.name||""}`), el("span","num",pc.toFixed(1)+"%")); lg.appendChild(li); });
    al.append(bar, lg);
  }
  const lastAt=S.holdings.map(h=>h.priceAt||"").filter(Boolean).sort().pop();
  $("ivPriceAt").textContent = lastAt ? `現價更新：${lastAt.replace("m","（手動）")}` : "";
  // 持股
  const list=$("ivList"); list.textContent="";
  if(S.holdingsReady && !act.length){ const e=el("div","empty"); e.appendChild(el("strong",null,"還沒有持股"));
    e.appendChild(document.createTextNode("按「＋ 記一筆交易」，選買進、填代號（例如 0050）、股數和成交價就好。定期定額每次扣款記一筆買進。")); list.appendChild(e); }
  act.forEach(r=>list.appendChild(holdCard(r)));
  $("ivSoldWrap").hidden=!sold.length; $("ivSoldCount").textContent=sold.length?`${sold.length} 檔`:"";
  const sb=$("ivSold"); sb.textContent=""; sold.forEach(r=>sb.appendChild(holdCard(r)));
  // 最近交易
  const all=[]; S.holdings.forEach(h=>(h.trades||[]).forEach((t,k)=>all.push({h,t,k})));
  all.sort((a,b)=>a.t.d<b.t.d?1:a.t.d>b.t.d?-1:b.k-a.k);
  const rc=$("ivRecent"); rc.textContent="";
  if(!all.length) rc.appendChild(el("p","small muted","還沒有交易紀錄。"));
  all.slice(0,15).forEach(x=>rc.appendChild(tradeRow(x.h,x.t,true)));
}
function holdCard(r){
  const {h,st}=r, cur=h.cur==="USD"?"US$ ":"";
  const b=el("button","hcard"); b.type="button"; b.onclick=()=>openHold(h.id);
  const L1=el("div","hc-left");
  const t=el("div","hc-title"); t.append(el("strong",null,h.sym), el("span","muted",h.name||""));
  L1.appendChild(t);
  L1.appendChild(el("div","small muted", st.q>0 ? `${fmtQ(st.q)} 股・均價 ${cur}${fmtP(st.avg)}・現價 ${cur}${fmtP(h.price)}` : `已實現 ${sgn(st.real)}・股息 ${fmt(st.div)}`));
  const R=el("div","hc-right");
  if(st.q>0){
    R.appendChild(el("div","num",(h.cur==="USD"?"US$ ":"NT$ ")+fmt(st.mv)));
    R.appendChild(el("div","num small "+upDown(st.unreal), `${sgn(st.unreal)}（${st.pct>=0?"+":""}${(st.pct*100).toFixed(1)}%）`));
  } else R.appendChild(el("div","num "+upDown(st.total),"總報酬 "+sgn(st.total)));
  if(st.q>0 && st.div>0) L1.appendChild(el("div","small muted",`累積股息 ${cur}${fmt(st.div)}`));
  b.append(L1,R); return b;
}
function tradeRow(h,t,showSym){
  const b=el("button","trow"); b.type="button"; b.onclick=()=>openTrade({hid:h.id, i:t.i});
  const cur=h.cur==="USD"?"US$ ":"";
  let what = t.t==="d" ? `${cur}${fmtP(t.a)}` : t.t==="sd" ? `${fmtQ(t.q)} 股` : `${fmtQ(t.q)} 股 @ ${cur}${fmtP(t.p)}`;
  const fees=[]; if(t.f) fees.push("手續費 "+fmtP(t.f)); if(t.x) fees.push("稅 "+fmtP(t.x));
  const L1=el("div","trow-main");
  L1.append(el("span","small muted num",t.d), el("span","ttag t-"+t.t, TD_LABEL[t.t]||t.t));
  if(showSym) L1.appendChild(el("strong",null,h.sym));
  L1.appendChild(el("span",null,what));
  b.appendChild(L1);
  const sub=[...fees, t.n||""].filter(Boolean).join("・"); if(sub) b.appendChild(el("div","small muted",sub));
  return b;
}

/* ---- 台股收盤價（證交所、櫃買中心開放資料）---- */
let QUOTES=null, quotesAt=0, quotesLoading=null;
const rocDate = s => { s=String(s||""); const m=s.match(/^(\d{3})(\d{2})(\d{2})$/) || s.match(/^(\d{3})\/(\d{2})\/(\d{2})$/); return m ? `${Number(m[1])+1911}-${m[2]}-${m[3]}` : ""; };
async function loadQuotes(){
  if(QUOTES && Date.now()-quotesAt<10*60e3) return QUOTES;
  if(quotesLoading) return quotesLoading;
  quotesLoading=(async()=>{
    const map=new Map(); let ok=0;
    const get=async u=>{ const r=await fetch(u,{headers:{accept:"application/json"}}); if(!r.ok) throw new Error(r.status); return r.json(); };
    try{ (await get("https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL")).forEach(x=>{ const p=Number(x.ClosingPrice); if(x.Code && p>0) map.set(String(x.Code).toUpperCase(),{p, name:x.Name||"", d:rocDate(x.Date)}); }); ok++; }catch(e){}
    try{ (await get("https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes")).forEach(x=>{ const c=x.SecuritiesCompanyCode, p=Number(x.Close); if(c && p>0 && !map.has(c)) map.set(String(c).toUpperCase(),{p, name:x.CompanyName||"", d:rocDate(x.Date)}); }); ok++; }catch(e){}
    if(!ok) throw new Error("quotes");
    QUOTES=map; quotesAt=Date.now(); return map;
  })();
  try{ return await quotesLoading; } finally{ quotesLoading=null; }
}
$("ivRefresh").onclick=async()=>{
  const tw=S.holdings.filter(h=>h.cur==="TWD" && holdStats(h).q>0);
  if(!tw.length){ msg("ivPriceMsg","目前沒有台股持股需要更新。"); return; }
  $("ivRefresh").disabled=true; msg("ivPriceMsg","正在取得收盤價…");
  try{
    const map=await loadQuotes(); let n=0; const miss=[];
    for(const h of tw){ const q=map.get(h.sym.toUpperCase());
      if(!q){ miss.push(h.sym); continue; }
      await updateDoc(doc(db,"holdings",h.id), { price:q.p, priceAt:(q.d||todayStr()), ...(h.name?{}:{name:String(q.name).slice(0,30)}), updatedAt:serverTimestamp() }); n++; }
    msg("ivPriceMsg", `已更新 ${n} 檔的收盤價。` + (miss.length?`找不到：${miss.join("、")}（請點那一檔自己填現價）。`:""), "ok");
  }catch(e){
    msg("ivPriceMsg","現在沒辦法自動取得股價（證交所網站沒有回應或不允許），請點每一檔持股自己填現價。","err");
  }finally{ $("ivRefresh").disabled=false; }
};

/* ---- 手續費設定 ---- */
$("ivFeeBtn").onclick=()=>{ const v=P().inv; $("feDisc").value=v.disc; $("feMin").value=v.min; $("feFx").value=v.fx; msg("feMsg",""); $("dlgFee").showModal(); };
$("formFee").addEventListener("submit", async e=>{
  if(e.submitter && e.submitter.value!=="save") return;
  e.preventDefault();
  const disc=Number($("feDisc").value), mn=Number($("feMin").value), fx=Number($("feFx").value);
  if(!(disc>0 && disc<=10)){ msg("feMsg","折扣請填 0～10 之間，例如 6 折填 6、2.8 折填 2.8。","err"); return; }
  if(!(mn>=0) || !(fx>0)){ msg("feMsg","最低手續費和匯率請填正確的數字。","err"); return; }
  try{ await savePrefs({ inv:{disc, min:mn, fx} }); $("dlgFee").close(); toast("已儲存手續費設定"); renderInvest(); }
  catch(err){ msg("feMsg","儲存失敗："+errText(err),"err"); }
});

/* ---- 記一筆交易 ---- */
const findHold = sym => S.holdings.find(h=>h.sym.toUpperCase()===String(sym||"").trim().toUpperCase());
function setTdType(t){
  S.tdType=t;
  document.querySelectorAll("#dlgTrade [data-td]").forEach(b=>b.setAttribute("aria-pressed", b.dataset.td===t));
  const qp=t==="b"||t==="s";
  $("tdQP").hidden = t==="d"; $("tdPriceF").hidden = !qp; $("tdAmtF").hidden = t!=="d";
  $("tdFeeBox").hidden = !qp; $("tdTaxF").hidden = t!=="s";
  $("tdQLabel").textContent = t==="sd" ? "配到的股數" : t==="s" ? "賣出股數" : "買進股數";
  $("tdQty").placeholder = t==="sd" ? "例如 35" : "1 張 = 1000 股";
  $("tdPrice").required = qp; $("tdQty").required = t!=="d"; $("tdAmt").required = t==="d";
  autoFee(); tdCalc();
}
document.querySelectorAll("#dlgTrade [data-td]").forEach(b=>b.onclick=()=>setTdType(b.dataset.td));
function tdHold(){ return S.tdEdit ? S.holdings.find(h=>h.id===S.tdEdit.hid) : findHold($("tdSym").value); }
function tdMeta(){ const h=tdHold(); return h ? {cur:h.cur, kind:h.kind} : {cur:$("tdCur").value, kind:$("tdKind").value}; }
function autoFee(){
  const t=S.tdType; if(!(t==="b"||t==="s")) return;
  const q=Number($("tdQty").value)||0, p=Number($("tdPrice").value)||0, amt=q*p, m=tdMeta(), v=P().inv;
  if(!$("tdFee").dataset.touched){
    if(m.cur!=="TWD" || !amt) $("tdFee").value = m.cur!=="TWD" ? ($("tdFee").value||"") : "";
    else $("tdFee").value = Math.max(v.min, Math.floor(amt*0.001425*v.disc/10));
  }
  if(t==="s" && !$("tdTax").dataset.touched) $("tdTax").value = amt && m.cur==="TWD" ? Math.floor(amt*(TAX_RATE[m.kind]??0.001)) : (m.cur==="TWD"?"":($("tdTax").value||""));
}
function tdCalc(){
  const t=S.tdType, q=Number($("tdQty").value)||0, p=Number($("tdPrice").value)||0, f=Number($("tdFee").value)||0, x=Number($("tdTax").value)||0, m=tdMeta();
  const c=m.cur==="USD"?"US$ ":"NT$ "; let s="";
  if(t==="b" && q && p) s=`成交金額 ${c}${fmt(q*p)}，加手續費共付出 ${c}${fmt(q*p+f)}。`;
  if(t==="s" && q && p){ s=`成交金額 ${c}${fmt(q*p)}，扣掉手續費和稅實拿 ${c}${fmt(q*p-f-x)}。`;
    const h=tdHold(); if(h){ const st=holdStats(h, S.tdEdit&&S.tdEdit.i); if(st.q>0){ const pl=q*p-f-x-st.avg*Math.min(q,st.q); s+=` 這筆大約${pl>=0?"賺":"賠"} ${c}${fmt(Math.abs(pl))}（均價 ${fmtP(st.avg)}）。`; } } }
  if(t==="b" || t==="s") if(m.cur==="TWD") s+=` 手續費依「${fmtP(P().inv.disc)} 折、最低 ${fmtP(P().inv.min)} 元」自動算，可以直接改。`;
  if(t==="sd") s="配股會增加股數，不增加成本，所以平均成本會變低。";
  if(t==="d") s="填實際入帳的金額（已扣掉匯費、補充保費等）。";
  $("tdCalc").textContent=s;
}
["tdQty","tdPrice"].forEach(id=>$(id).addEventListener("input",()=>{ autoFee(); tdCalc(); }));
["tdFee","tdTax"].forEach(id=>$(id).addEventListener("input",()=>{ $(id).dataset.touched="1"; tdCalc(); }));
["tdKind","tdCur"].forEach(id=>$(id).addEventListener("change",()=>{ autoFee(); tdCalc(); }));
function syncSym(){
  const h=findHold($("tdSym").value);
  $("tdNewBox").hidden = !!h || !!S.tdEdit;
  if(h){ if(!$("tdName").dataset.touched) $("tdName").value=h.name||""; }
  else if(QUOTES && !$("tdName").dataset.touched){ const q=QUOTES.get($("tdSym").value.trim().toUpperCase()); $("tdName").value = q ? q.name : ""; }
  autoFee(); tdCalc();
}
$("tdSym").addEventListener("input", syncSym);
$("tdName").addEventListener("input", ()=>$("tdName").dataset.touched="1");
$("ivAdd").onclick=()=>openTrade();
function openTrade(edit, sym){
  S.tdEdit=edit||null; msg("tdMsg","");
  ["tdFee","tdTax","tdName"].forEach(id=>delete $(id).dataset.touched);
  const dl=$("dlSyms"); dl.textContent=""; S.holdings.forEach(h=>{ const o=el("option"); o.value=h.sym; o.label=h.name||""; dl.appendChild(o); });
  $("tdSym").disabled=!!edit; $("tdDelete").hidden=!edit;
  if(edit){
    const h=S.holdings.find(x=>x.id===edit.hid), t=h && (h.trades||[]).find(x=>x.i===edit.i); if(!t) return;
    $("tdTitle").textContent="修改交易"; $("tdSym").value=h.sym; $("tdName").value=h.name||"";
    $("tdDate").value=t.d; $("tdQty").value=t.q??""; $("tdPrice").value=t.p??""; $("tdAmt").value=t.a??"";
    $("tdFee").value=t.f??""; $("tdTax").value=t.x??""; $("tdNote").value=t.n||"";
    $("tdFee").dataset.touched="1"; $("tdTax").dataset.touched="1"; $("tdName").dataset.touched="1";
    $("tdNewBox").hidden=true; setTdType(t.t);
  } else {
    $("tdTitle").textContent="記一筆交易"; $("tdSym").value=sym||""; $("tdName").value="";
    $("tdDate").value=todayStr(); ["tdQty","tdPrice","tdAmt","tdFee","tdTax","tdNote"].forEach(id=>$(id).value="");
    $("tdKind").value="etf"; $("tdCur").value="TWD"; setTdType("b"); syncSym();
  }
  $("dlgTrade").showModal();
  if(!edit && !sym) setTimeout(()=>$("tdSym").focus(),30);
  if(!QUOTES) loadQuotes().then(()=>{ if($("dlgTrade").open && !S.tdEdit) syncSym(); }).catch(()=>{});
}
$("formTrade").addEventListener("submit", async e=>{
  if(e.submitter && e.submitter.value!=="save") return;
  e.preventDefault(); msg("tdMsg","");
  const t=S.tdType, sym=$("tdSym").value.trim().toUpperCase(), d=$("tdDate").value;
  const q=Number($("tdQty").value)||0, p=Number($("tdPrice").value)||0, a=Number($("tdAmt").value)||0, f=Number($("tdFee").value)||0, x=Number($("tdTax").value)||0;
  if(!sym){ msg("tdMsg","請填股票代號。","err"); return; }
  if(!/^\d{4}-\d{2}-\d{2}$/.test(d)){ msg("tdMsg","請選日期。","err"); return; }
  if(t!=="d" && !(q>0)){ msg("tdMsg","請填股數。","err"); return; }
  if((t==="b"||t==="s") && !(p>0)){ msg("tdMsg","請填成交價。","err"); return; }
  if(t==="d" && !(a>0)){ msg("tdMsg","請填領到的股息金額。","err"); return; }
  if(f<0||x<0){ msg("tdMsg","手續費和稅不能是負數。","err"); return; }
  const h=tdHold();
  if(!h && t!=="b"){ msg("tdMsg",`還沒有 ${sym} 的持股，第一筆請先記「買進」。`,"err"); return; }
  if(t==="s"){
    const held=holdStats({...h, trades:(h.trades||[]).filter(z=>!(S.tdEdit&&z.i===S.tdEdit.i) && z.d<=d)}).q;
    if(q>held+1e-9){ msg("tdMsg",`${d} 當時只持有 ${fmtQ(held)} 股，不能賣出 ${fmtQ(q)} 股。`,"err"); return; } }
  const tr={ i:S.tdEdit?S.tdEdit.i:rid(), d, t };
  if(t!=="d") tr.q=q; if(t==="b"||t==="s"){ tr.p=p; tr.f=f; } if(t==="s") tr.x=x; if(t==="d") tr.a=a;
  const n=$("tdNote").value.trim().slice(0,40); if(n) tr.n=n;
  const name=$("tdName").value.trim().slice(0,30);
  $("tdSave").disabled=true;
  try{
    if(h){
      const trades=(h.trades||[]).filter(z=>!(S.tdEdit&&z.i===S.tdEdit.i)); trades.push(tr);
      if(trades.length>1000) throw new Error("這檔的交易紀錄太多了（上限 1000 筆）。");
      const patch={ trades, updatedAt:serverTimestamp() }; if(name && name!==h.name) patch.name=name;
      if(!h.price && p) { patch.price=p; patch.priceAt=d+"m"; }
      await updateDoc(doc(db,"holdings",h.id), patch);
    } else {
      await addDoc(collection(db,"holdings"), { ownerUid:S.user.uid, sym, name, cur:$("tdCur").value, kind:$("tdKind").value,
        price:p, priceAt:d+"m", trades:[tr], note:"", createdAt:serverTimestamp(), updatedAt:serverTimestamp() });
    }
    $("dlgTrade").close(); toast(S.tdEdit?"已修改":`已記錄：${TD_LABEL[t]} ${sym}`);
  }catch(err){ msg("tdMsg","儲存失敗："+(err.message&&!err.code?err.message:errText(err)),"err"); }
  finally{ $("tdSave").disabled=false; }
});
$("tdDelete").onclick=async()=>{
  const b=$("tdDelete"); if(!b.dataset.armed){ b.dataset.armed="1"; b.textContent="再按一次確定刪除"; return; }
  const h=S.holdings.find(x=>x.id===S.tdEdit.hid); if(!h) return;
  try{
    const trades=(h.trades||[]).filter(z=>z.i!==S.tdEdit.i);
    if(trades.length) await updateDoc(doc(db,"holdings",h.id), { trades, updatedAt:serverTimestamp() });
    else { await deleteDoc(doc(db,"holdings",h.id)); if(S.hdId===h.id && $("dlgHold").open) $("dlgHold").close(); }
    $("dlgTrade").close(); toast("已刪除這筆交易");
  }catch(err){ msg("tdMsg","刪除失敗："+errText(err),"err"); }
};
$("dlgTrade").addEventListener("close", ()=>{ const b=$("tdDelete"); b.dataset.armed=""; b.textContent="刪除這筆"; });

/* ---- 持股明細 ---- */
function openHold(id){ S.hdId=id; msg("hdMsg",""); renderHoldDialog(true); $("dlgHold").showModal(); }
function renderHoldDialog(fill){
  const h=S.holdings.find(x=>x.id===S.hdId); if(!h){ if($("dlgHold").open) $("dlgHold").close(); return; }
  const st=holdStats(h), c=h.cur==="USD"?"US$ ":"NT$ ";
  $("hdTitle").textContent=`${h.sym} ${h.name||""}`;
  $("hdPriceLabel").textContent = `目前股價（${h.cur==="USD"?"美元":"台幣"}）` + (h.priceAt?`・${h.priceAt.replace("m","")} 更新`:"");
  if(fill){ $("hdName").value=h.name||""; $("hdPrice").value=h.price||""; $("hdKind").value=h.kind; $("hdNote").value=h.note||""; }
  const box=$("hdStats"); box.textContent="";
  [["持有股數",fmtQ(st.q)+" 股"],["平均成本",c+fmtP(st.avg)],["市值",c+fmt(st.mv)],["持有成本",c+fmt(st.cost)],
   ["未實現損益",sgn(st.unreal)+(st.cost?`（${st.pct>=0?"+":""}${(st.pct*100).toFixed(1)}%）`:""),upDown(st.unreal)],
   ["已實現損益",sgn(st.real),upDown(st.real)],["累積股息",fmt(st.div),st.div>0?"up":""],["總報酬",sgn(st.total),upDown(st.total)]]
   .forEach(([k,v,cls])=>{ const d=el("div"); d.append(el("div","label",k), el("div","num "+(cls||""),v)); box.appendChild(d); });
  const tl=$("hdTrades"); tl.textContent="";
  sortTrades(h.trades).reverse().forEach(t=>tl.appendChild(tradeRow(h,t,false)));
}
$("hdAddTrade").onclick=()=>{ const h=S.holdings.find(x=>x.id===S.hdId); $("dlgHold").close(); if(h) openTrade(null, h.sym); };
$("formHold").addEventListener("submit", async e=>{
  if(e.submitter && e.submitter.value!=="save") return;
  e.preventDefault();
  const h=S.holdings.find(x=>x.id===S.hdId); if(!h) return;
  const price=Number($("hdPrice").value)||0;
  if(price<0){ msg("hdMsg","股價不能是負數。","err"); return; }
  const patch={ name:$("hdName").value.trim().slice(0,30), kind:$("hdKind").value, note:$("hdNote").value.trim().slice(0,100), updatedAt:serverTimestamp() };
  if(price!==h.price){ patch.price=price; patch.priceAt=todayStr()+"m"; }
  try{ await updateDoc(doc(db,"holdings",h.id), patch); msg("hdMsg","已儲存。","ok"); }
  catch(err){ msg("hdMsg","儲存失敗："+errText(err),"err"); }
});
$("hdDelete").onclick=async()=>{
  const b=$("hdDelete"); if(!b.dataset.armed){ b.dataset.armed="1"; b.textContent="再按一次確定刪除（無法復原）"; return; }
  try{ await deleteDoc(doc(db,"holdings",S.hdId)); $("dlgHold").close(); toast("已刪除"); }
  catch(err){ msg("hdMsg","刪除失敗："+errText(err),"err"); }
};
$("dlgHold").addEventListener("close", ()=>{ const b=$("hdDelete"); b.dataset.armed=""; b.textContent="刪除這檔（含所有交易紀錄）"; });


/* ================= 代墊請款 ================= */
/* 待請款的紀錄不分月份都要看得到，所以另外監看 rb.s == "pending" 的紀錄 */
function ensureRb(l){ if(S.rbFor!==l.id) startRb(l.id); else renderRb(); }
function startRb(lid){
  stopRb(); const tok=S.rbTok={}; S.rbFor=lid;
  S.unsubRb=onSnapshot(query(collection(db,"ledgers",lid,"entries"), where("rb.s","==","pending")), s=>{
    if(tok!==S.rbTok) return; S.rbPending=s.docs.map(d=>({id:d.id,...d.data()})); renderRb(); if(S.lid && L()){ renderTotals(L()); renderLedgerTips(L()); } }, ()=>{});
}
function stopRb(){ S.rbTok=null; S.rbFor=null; if(S.unsubRb){ S.unsubRb(); S.unsubRb=null; } S.rbPending=[]; }
function renderRb(){
  const l=L(); if(!l) return;
  // 只列這段期間墊付的；其他月份還沒收回的收成一行提醒
  const r=periodRange(), inP = e => !r || (e.date>=r[0] && e.date<=r[1]);
  const all=(S.rbPending||[]).slice().sort((a,b)=>a.date.localeCompare(b.date));
  const pend=all.filter(inP), other=all.filter(e=>!inP(e));
  const done=S.entries.filter(e=>isRb(e) && e.rb.s==="done").sort((a,b)=>b.date.localeCompare(a.date));
  $("rbPanel").hidden = !all.length && !done.length;
  const box=$("rbBody"); box.textContent="";
  if(other.length){
    const months=[...new Set(other.map(e=>Number(e.date.slice(5,7))+" 月"))].join("、");
    const d=el("details","rb-other"); d.appendChild(el("summary",null,`另有 ${months} ${other.length} 筆待請款 ${money(other.reduce((t,e)=>t+e.amount,0))}`));
    other.forEach(e=>d.appendChild(rbRow(l,e,true))); box.appendChild(d);
  }
  if(pend.length){
    const sum=pend.reduce((t,e)=>t+e.amount,0);
    const h=el("div","rb-sum"); h.append(el("span",null,`待請款 ${pend.length} 筆`), el("span","num",money(sum))); box.appendChild(h);
    pend.forEach(e=>box.appendChild(rbRow(l,e)));
  } else box.appendChild(el("p","small muted", r ? "這段期間沒有待請款的代墊。" : "目前沒有待請款的代墊。"));
  if(done.length){
    const d=el("details","rb-done"); d.appendChild(el("summary","small",`這段期間已收回 ${done.length} 筆`));
    done.forEach(e=>d.appendChild(rbRow(l,e))); box.appendChild(d);
  }
}
function rbRow(l,e,withYear){
  const r=el("div","rb-row");
  const m=el("div"); m.appendChild(el("div",null,e.note||catName(l,e)));
  m.appendChild(el("div","small muted",[withYear && e.date.slice(0,4)!==String(new Date().getFullYear()) ? e.date.replace(/-/g,"/") : e.date.slice(5).replace("-","/"), catName(l,e), e.card?`${e.pay}・${e.card}`:e.pay, e.payer?e.payer+" 付":""].filter(Boolean).join("・")
    + (e.rb.s==="done" ? `・${(e.rb.d||"").slice(5).replace("-","/")} 收回 ${fmt(e.rb.a||0)}` + (own(e)?`，自付 ${fmt(own(e))}`:"") : "")));
  const right=el("div","rb-right"); right.appendChild(el("span","num",money(e.amount)));
  if(canEdit(l)){ const b=el("button", e.rb.s==="pending"?"btn primary sm":"link", e.rb.s==="pending"?"已收到":"修改"); b.type="button"; b.onclick=()=>openRb(e); right.appendChild(b); }
  r.append(m,right); return r;
}
function openRb(e){
  S.rbEdit=e; msg("rbMsg","");
  $("rbWhat").textContent=`${e.note||catName(L(),e)}・${e.date.replace(/-/g,"/")}・代墊 ${money(e.amount)}`;
  $("rbAmt").value = e.rb.s==="done" ? (e.rb.a||0) : e.amount;
  $("rbDate").value = e.rb.s==="done" && e.rb.d ? e.rb.d : todayStr();
  $("rbUndo").hidden = e.rb.s!=="done"; $("rbSave").textContent = e.rb.s==="done" ? "儲存修改" : "確定已收到";
  rbHint(); $("dlgRb").showModal();
}
function rbHint(){
  const e=S.rbEdit; if(!e) return; const a=Math.round(Number($("rbAmt").value)||0);
  $("rbHint").textContent = a<e.amount ? `公司少付 ${money(e.amount-a)}，這部分會算成你自己的支出。` : a>e.amount ? `比代墊金額多 ${money(a-e.amount)}，多的部分不會算進收入。` : "全額收回，這筆不會算進你的支出。";
}
$("rbAmt").addEventListener("input", rbHint);
$("formRb").addEventListener("submit", async ev=>{
  if(ev.submitter && ev.submitter.value!=="save") return;
  ev.preventDefault();
  const e=S.rbEdit, a=Math.round(Number($("rbAmt").value)||0), d=$("rbDate").value;
  if(a<0){ msg("rbMsg","金額不能是負數。","err"); return; }
  if(!/^\d{4}-\d{2}-\d{2}$/.test(d)){ msg("rbMsg","請選收到日期。","err"); return; }
  $("rbSave").disabled=true;
  try{ await updateDoc(doc(db,"ledgers",L().id,"entries",e.id), { rb:{s:"done", a, d}, updatedAt:serverTimestamp() });
    $("dlgRb").close(); toast(`已記錄收回 ${money(a)}`); }
  catch(err){ msg("rbMsg","儲存失敗："+errText(err),"err"); }
  finally{ $("rbSave").disabled=false; }
});
$("rbUndo").onclick=async()=>{
  try{ await updateDoc(doc(db,"ledgers",L().id,"entries",S.rbEdit.id), { rb:{s:"pending"}, updatedAt:serverTimestamp() }); $("dlgRb").close(); toast("已改回待請款"); }
  catch(err){ msg("rbMsg","失敗："+errText(err),"err"); }
};

/* ================= 清單（待購、待產包、備忘） ================= */
/* lists/{id}：名稱、顏色、成員（和帳本一樣可以分享）、記事 memo；項目放在 lists/{id}/items */
const LIST_TEMPLATES={
  "待產包":{ color:"#b23a5a", items:[
    ["產褥墊","媽媽"],["免洗褲","媽媽"],["哺乳內衣","媽媽"],["溢乳墊","媽媽"],["月子帽／保暖外套","媽媽"],["束腹帶","媽媽"],["吸管保溫杯","媽媽"],["拖鞋","媽媽"],["盥洗用品","媽媽"],["媽媽手冊、健保卡、身分證","證件"],
    ["紗布衣","寶寶"],["包巾","寶寶"],["紗布巾","寶寶"],["新生兒尿布（NB）","寶寶"],["濕紙巾","寶寶"],["出院衣服","寶寶"],["嬰兒汽座（出院用）","寶寶"] ]},
  "寶寶用品":{ color:"#2f5fa8", items:[
    ["奶瓶","餵奶"],["奶嘴","餵奶"],["奶瓶消毒鍋","餵奶"],["溫奶器","餵奶"],["嬰兒床","睡覺"],["床包／防水墊","睡覺"],["澡盆","洗澡"],["嬰兒沐浴乳","洗澡"],["指甲剪","護理"],["耳溫槍","護理"],["推車","外出"],["揹巾","外出"] ]},
  "待購清單":{ color:"#1d6b52", items:[] },
  "空白":{ color:"#4f6470", items:[] }
};
const PRIO_RANK={"高":0,"中":1,"低":2,"":3};
const LI = () => S.lists.get(S.listId);
S.lists=new Map(); S.listItems=[];

function watchLists(){
  stopLists(); S.listsReady=false;
  S.unsubLists=onSnapshot(query(collection(db,"lists"), where("members","array-contains", S.email)), snap=>{
    S.lists=new Map(snap.docs.map(d=>[d.id,{id:d.id,...d.data()}])); S.listsReady=true;
    if(S.listId){
      if(!S.lists.has(S.listId)){ if(!S.listDeleting) toast("你已經看不到這個清單了"); S.listDeleting=false; stopItems(); S.listId=null; location.hash="#lists"; return; }
      renderListHead(); renderListItems(); if($("dlgListSet").open) renderListSet(false);
    } else if(location.hash==="#lists") renderLists();
  }, e=>msg("listsMsg","讀取清單失敗："+errText(e),"err"));
}
function stopLists(){ if(S.unsubLists){ S.unsubLists(); S.unsubLists=null; } S.lists=new Map(); }
function watchItems(id){
  stopItems(); const tok=S.itemsTok={}; S.itemsReady=false;
  S.unsubItems=onSnapshot(collection(db,"lists",id,"items"), snap=>{ if(tok!==S.itemsTok) return;
    S.listItems=snap.docs.map(d=>({id:d.id,...d.data()})); S.itemsReady=true; renderListItems(); }, e=>msg("liMsg","讀取項目失敗："+errText(e),"err"));
}
function stopItems(){ S.itemsTok=null; if(S.unsubItems){ S.unsubItems(); S.unsubItems=null; } S.listItems=[]; }
const listRole = x => x.ownerUid===S.user.uid ? "擁有者" : (x.editors||[]).includes(S.email) ? "可編輯" : "僅檢視";
const canEditList = x => x && (x.ownerUid===S.user.uid || (x.editors||[]).includes(S.email));

/* 清單列表 */
function renderLists(){
  tipsFor("tipLists", [["lists","把手機備忘錄裡的清單搬過來：待產包、寶寶用品、想買的東西都可以。每項可以填預估金額，上方會算還要準備多少錢；打勾時可以順便記一筆支出到帳本。清單也能分享給家人一起勾。"]]);
  const mine=[], shared=[];
  [...S.lists.values()].sort((a,b)=>(a.name||"").localeCompare(b.name||"","zh-Hant")).forEach(x=>(x.ownerUid===S.user.uid?mine:shared).push(x));
  const g=$("myLists"); g.textContent="";
  if(!S.listsReady) g.appendChild(el("p","small muted","讀取中…"));
  else if(!mine.length){ const e=el("div","empty"); e.appendChild(el("strong",null,"還沒有清單"));
    e.appendChild(document.createTextNode("按「＋ 新增清單」，可以從待產包、寶寶用品範本開始，常見項目會先幫你列好。")); g.appendChild(e); }
  mine.forEach(x=>g.appendChild(listCard(x)));
  $("sharedListsWrap").hidden=!shared.length; const sg=$("sharedLists"); sg.textContent=""; shared.forEach(x=>sg.appendChild(listCard(x)));
}
function listCard(x){
  const b=el("button","lcard"); b.type="button"; b.onclick=()=>{ location.hash="#list/"+x.id; };
  const n=el("div","name"); const d=el("span","dot"); d.style.background=x.color||COLORS[0]; n.append(d, document.createTextNode(x.name)); b.appendChild(n);
  const st=x.stats||{};
  b.appendChild(el("div","meta", typeof st.left==="number" ? `還有 ${st.left} 項` + (st.need?`・還需準備 ${money(st.need)}`:"") + (st.done?`・已完成 ${st.done} 項`:"") : "點進去新增項目"));
  const others=(x.members||[]).length-1;
  b.appendChild(el("div","meta", x.ownerUid===S.user.uid ? (others>0?`與 ${others} 人共用`:"只有你看得到") : `${x.ownerEmail} 分享・${listRole(x)}`));
  return b;
}

/* 新增清單 */
let nlColor=COLORS[0];
$("btnNewList").onclick=()=>{
  msg("nlMsg",""); $("nlName").value=""; $("nlSeed").checked=true;
  const box=$("nlTemplates"); box.textContent="";
  Object.keys(LIST_TEMPLATES).forEach(k=>{ const c=el("button","chip",k); c.type="button"; c.onclick=()=>pickListTpl(k); box.appendChild(c); });
  pickListTpl("待產包"); $("dlgNewList").showModal();
};
function pickListTpl(k){
  const t=LIST_TEMPLATES[k]; S.nlTpl=k;
  document.querySelectorAll("#nlTemplates .chip").forEach(c=>c.setAttribute("aria-pressed", c.textContent===k));
  $("nlName").value = k==="空白" ? "" : k; nlColor=t.color;
  $("nlSeedWrap").hidden=!t.items.length; $("nlSeedText").textContent=`帶入 ${t.items.length} 個常見項目（之後可以刪改）`;
  swatches("nlColors", nlColor, c=>{ nlColor=c; });
}
$("formNewList").addEventListener("submit", async ev=>{
  if(ev.submitter && ev.submitter.value!=="save") return;
  ev.preventDefault();
  const name=$("nlName").value.trim().slice(0,40); if(!name){ msg("nlMsg","請輸入清單名稱。","err"); return; }
  $("nlCreate").disabled=true;
  try{
    const ref=await addDoc(collection(db,"lists"), { name, color:nlColor, ownerUid:S.user.uid, ownerEmail:S.email, editors:[], viewers:[], members:[S.email], memo:"",
      createdAt:serverTimestamp(), updatedAt:serverTimestamp() });
    const t=LIST_TEMPLATES[S.nlTpl];
    if(t && t.items.length && $("nlSeed").checked && !$("nlSeedWrap").hidden){
      const b=writeBatch(db), base=Date.now();
      t.items.forEach(([text,group],i)=>b.set(doc(collection(db,"lists",ref.id,"items")), newItem(text,0,"",base+i,group)));
      await b.commit();
    }
    $("dlgNewList").close(); location.hash="#list/"+ref.id;
  }catch(e){ msg("nlMsg","建立失敗："+errText(e),"err"); }
  finally{ $("nlCreate").disabled=false; }
});
const newItem=(text,amount,note,order,group)=>({ text:String(text).slice(0,100), amount:Math.max(0,Math.round(amount||0)), priority:"", due:"", note:String(note||"").slice(0,200),
  group:String(group||"").slice(0,20), via:"", done:false, doneAt:"", spent:0, ledgerId:"", entryId:"", order, createdBy:S.user.uid, createdByEmail:S.email, createdAt:serverTimestamp(), updatedAt:serverTimestamp() });

/* 單一清單 */
function openList(id){
  S.listId=id; show("viewList");
  if(S.itemsFor!==id){ S.itemsFor=id; watchItems(id); $("liMemo").value=""; S.memoFor=null; S.addGroup=""; S.newGroupOpen=false; }
  renderListHead(); renderListItems();
}
$("liBack").onclick=()=>{ location.hash="#lists"; };
function renderListHead(){
  const x=LI(); if(!x){ $("liName").textContent=S.listsReady?"找不到這個清單":"讀取中…"; return; }
  document.title=x.name+"・記帳本";
  $("liName").textContent=x.name; $("liDot").style.background=x.color||COLORS[0]; $("liRole").textContent=listRole(x);
  const ed=canEditList(x); $("liAddForm").hidden=!ed; $("liMemo").readOnly=!ed;
  if(S.memoFor!==x.id || document.activeElement!==$("liMemo")){ if(S.memoFor!==x.id || !S.memoDirty){ $("liMemo").value=x.memo||""; S.memoFor=x.id; } }
}
function sortItems(a,b){ return (PRIO_RANK[a.priority||""]-PRIO_RANK[b.priority||""]) || ((a.due||"9999")<(b.due||"9999")?-1:(a.due||"9999")>(b.due||"9999")?1:0) || ((a.order||0)-(b.order||0)); }
/* 分組：照每組第一個項目的先後排；沒分組的放最上面 */
const listGroups = () => { const first=new Map(); S.listItems.forEach(i=>{ const g=i.group||""; if(g && (!first.has(g) || (i.order||0)<first.get(g))) first.set(g,i.order||0); });
  return [...first.entries()].sort((a,b)=>a[1]-b[1]).map(e=>e[0]); };
function renderGroupPick(x){
  const box=$("liGroupPick"); box.textContent=""; const gs=listGroups();
  if(S.addGroup && !gs.includes(S.addGroup)) gs.push(S.addGroup);
  box.appendChild(el("span","small muted","加到："));
  ["",...gs].forEach(g=>{ const b=el("button","chip",g||"不分組"); b.type="button"; b.setAttribute("aria-pressed", g===(S.addGroup||""));
    b.onclick=()=>{ S.addGroup=g; renderGroupPick(x); $("liAddText").focus(); }; box.appendChild(b); });
  if(S.newGroupOpen){
    const inp=el("input"); inp.type="text"; inp.maxLength=20; inp.placeholder="新分組名稱，按 Enter"; inp.className="li-newgroup"; inp.setAttribute("aria-label","新分組名稱");
    inp.onkeydown=e=>{ if(e.key==="Enter"){ e.preventDefault(); const v=inp.value.trim().slice(0,20); if(v){ S.addGroup=v; } S.newGroupOpen=false; renderGroupPick(x); $("liAddText").focus(); }
      if(e.key==="Escape"){ S.newGroupOpen=false; renderGroupPick(x); } };
    box.appendChild(inp); setTimeout(()=>inp.focus(),0);
  } else { const nb=el("button","chip add","＋ 新分組"); nb.type="button"; nb.onclick=()=>{ S.newGroupOpen=true; renderGroupPick(x); }; box.appendChild(nb); }
  $("liAddText").placeholder = S.addGroup ? `新增到「${S.addGroup}」，例如：紗布衣` : "新增項目，例如：紗布衣";
}
function renderListItems(){
  const x=LI(); if(!x) return; const ed=canEditList(x);
  if(ed && !(S.newGroupOpen && document.activeElement && document.activeElement.classList.contains("li-newgroup"))) renderGroupPick(x);
  const todo=S.listItems.filter(i=>!i.done).sort(sortItems), done=S.listItems.filter(i=>i.done).sort((a,b)=>(b.doneAt||"").localeCompare(a.doneAt||""));
  const need=todo.reduce((t,i)=>t+(i.amount||0),0), spent=done.reduce((t,i)=>t+(i.spent||0),0), noAmt=todo.filter(i=>!i.amount).length;
  $("liLeftN").textContent=`${todo.length} 項`; $("liNeed").textContent=money(need); $("liDoneN").textContent=`${done.length} 項`;
  $("liSpent").textContent = spent ? `實際花了 ${money(spent)}` : "";
  if(noAmt && todo.length) $("liNeed").title=`有 ${noAmt} 項沒填金額`;
  $("liMeter").firstElementChild.style.width = S.listItems.length ? (done.length/S.listItems.length*100)+"%" : "0";
  const box=$("liItems"); box.textContent="";
  if(!S.itemsReady) box.appendChild(el("p","small muted","讀取中…"));
  else if(!todo.length) box.appendChild(el("p","small muted", done.length ? "全部完成了！" : "還沒有項目，在上面輸入就能加入。"));
  const gs=listGroups();
  if(!gs.length) todo.forEach(i=>box.appendChild(itemRow(x,i,ed)));
  else ["",...gs].forEach(g=>{
    const its=todo.filter(i=>(i.group||"")===g); if(!its.length) return;
    if(g){ const h=el("div","li-ghead"); const nd=its.reduce((t,i)=>t+(i.amount||0),0);
      h.append(el("span",null,g), el("span","small muted",`${its.length} 項`+(nd?`・${money(nd)}`:""))); box.appendChild(h); }
    its.forEach(i=>box.appendChild(itemRow(x,i,ed,true)));
  });
  $("liDoneWrap").hidden=!done.length; $("liDoneSum").textContent=`已完成 ${done.length} 項` + (spent?`・實際花了 ${money(spent)}`:"");
  const db2=$("liDone"); db2.textContent=""; done.forEach(i=>db2.appendChild(itemRow(x,i,ed)));
  // 把摘要存回清單，列表頁就能直接顯示（只有可編輯的人會寫）
  const st={left:todo.length, need, done:done.length};
  if(ed && S.itemsReady && JSON.stringify(st)!==JSON.stringify(x.stats||{})){
    const uid=S.user.uid; clearTimeout(S.statsT);
    S.statsT=setTimeout(()=>{ if(!S.user || S.user.uid!==uid) return; updateDoc(doc(db,"lists",x.id), {stats:st}).catch(()=>{}); }, 600);
  }
}
function itemRow(x,i,ed,grouped){
  const r=el("div","li-row"+(i.done?" done":""));
  const cb=el("input"); cb.type="checkbox"; cb.checked=!!i.done; cb.disabled=!ed; cb.setAttribute("aria-label",(i.done?"改回未完成：":"完成：")+i.text);
  cb.onclick=ev=>{ ev.preventDefault(); if(i.done) undoItem(x,i); else openBuy(x,i); };
  const main=el("div","li-main"); main.appendChild(el("div","li-text",i.text));
  const meta=[]; if(i.group && !grouped) meta.push(i.group); if(i.priority) meta.push(`優先 ${i.priority}`); if(i.due) meta.push(`${i.due.slice(5).replace("-","/")} 前`); if(i.note) meta.push(i.note);
  if(i.done){ if(i.via==="gift") meta.push("親友送禮"); else if(i.via==="have") meta.push("已有物品"); if(i.spent) meta.push(`實際 ${fmt(i.spent)}`); if(i.ledgerId){ const lg=S.ledgers.get(i.ledgerId); meta.push(lg?`已記到「${lg.name}」`:"已記帳"); } }
  if(meta.length) main.appendChild(el("div","li-meta",meta.join("・")));
  const right=el("div","li-right");
  if(i.amount && !i.done) right.appendChild(el("span","num",fmt(i.amount)));
  if(i.priority==="高" && !i.done) r.classList.add("hi");
  if(i.due && !i.done && i.due<todayStr()) r.classList.add("late");
  r.append(cb, main, right);
  if(ed){ main.tabIndex=0; main.setAttribute("role","button"); main.onclick=()=>openItem(i); main.onkeydown=e=>{ if(e.key==="Enter") openItem(i); }; }
  return r;
}
$("liAddForm").addEventListener("submit", async ev=>{
  ev.preventDefault(); const x=LI(); if(!x) return;
  const t=$("liAddText").value.trim(); if(!t){ $("liAddText").focus(); return; }
  const a=Math.round(Number($("liAddAmt").value)||0);
  $("liAddText").value=""; $("liAddAmt").value=""; $("liAddText").focus();
  try{ await addDoc(collection(db,"lists",x.id,"items"), newItem(t,a,"",Date.now(),S.addGroup||"")); }
  catch(e){ msg("liMsg","新增失敗："+errText(e),"err"); }
});
/* 記事：打字停下來 0.8 秒自動存 */
$("liMemo").addEventListener("input", ()=>{
  const x=LI(); if(!x || !canEditList(x)) return; S.memoDirty=true; $("liMemoState").textContent="儲存中…";
  clearTimeout(S.memoT); const id=x.id, v=$("liMemo").value.slice(0,5000);
  S.memoT=setTimeout(async()=>{ try{ await updateDoc(doc(db,"lists",id), {memo:v, updatedAt:serverTimestamp()}); S.memoDirty=false; $("liMemoState").textContent="已自動儲存"; }
    catch(e){ $("liMemoState").textContent="儲存失敗："+errText(e); } }, 800);
});

/* 修改項目 */
function openItem(i){
  S.itEdit=i; msg("itMsg","");
  $("itText").value=i.text; $("itAmt").value=i.amount||""; $("itDue").value=i.due||""; $("itNote").value=i.note||""; $("itGroup").value=i.group||"";
  const dl=$("dlItGroups"); dl.textContent=""; listGroups().forEach(g=>{ const o=el("option"); o.value=g; dl.appendChild(o); });
  setItPrio(i.priority||"");
  $("itDoneInfo").hidden=!i.done; if(i.done) $("itDoneInfo").textContent=`${i.doneAt?i.doneAt.replace(/-/g,"/")+" ":""}完成` + (i.spent?`，實際花了 ${money(i.spent)}`:"") + "。要改回未完成，點項目前面的勾勾。";
  $("itDelete").dataset.armed=""; $("itDelete").textContent="刪除";
  $("dlgItem").showModal();
}
function setItPrio(p){ S.itPrio=p; document.querySelectorAll("#itPrio button").forEach(b=>b.setAttribute("aria-pressed", b.dataset.p===p)); }
document.querySelectorAll("#itPrio button").forEach(b=>b.onclick=()=>setItPrio(b.dataset.p));
$("formItem").addEventListener("submit", async ev=>{
  if(ev.submitter && ev.submitter.value!=="save") return;
  ev.preventDefault();
  const t=$("itText").value.trim(); if(!t){ msg("itMsg","請填項目名稱。","err"); return; }
  try{ await updateDoc(doc(db,"lists",S.listId,"items",S.itEdit.id), { text:t.slice(0,100), amount:Math.max(0,Math.round(Number($("itAmt").value)||0)),
      due:$("itDue").value||"", priority:S.itPrio, note:$("itNote").value.trim().slice(0,200), group:$("itGroup").value.trim().slice(0,20), updatedAt:serverTimestamp() });
    $("dlgItem").close(); }
  catch(e){ msg("itMsg","儲存失敗："+errText(e),"err"); }
});
$("itDelete").onclick=async()=>{
  const b=$("itDelete"); if(!b.dataset.armed){ b.dataset.armed="1"; b.textContent="確定刪除？"; return; }
  try{ await deleteDoc(doc(db,"lists",S.listId,"items",S.itEdit.id)); $("dlgItem").close(); toast("已刪除"); }
  catch(e){ msg("itMsg","刪除失敗："+errText(e),"err"); }
};

/* 打勾：買好了，可以順便記帳 */
function fillBuyCats(){
  const l=S.ledgers.get($("byLedger").value), sel=$("byCat"); sel.textContent=""; sel.disabled=!l; $("byPay").disabled=!l; $("byDate").disabled=!l;
  if(!l){ sel.appendChild(el("option",null,"—")); $("byNote").textContent="只打勾完成，不記帳。"; return; }
  const last=store.get("ledger.buyCat");
  (l.categories||[]).filter(c=>c.type==="out").forEach(c=>{ const o=el("option",null,c.name); o.value=c.id; o.selected=c.id===last; sel.appendChild(o); });
  $("byNote").textContent=`會在「${l.name}」記一筆支出；之後取消打勾，那筆也會一起刪掉。`;
  renderBuySplit();
}
/* 買好了：記到有開 AA 的帳本時，可以選誰付的、怎麼分攤 */
function renderBuySplit(){
  const l=S.ledgers.get($("byLedger").value), aa=l && aaOn(l);
  $("byPayerBox").hidden=!l; $("bySplitBox").hidden=!aa;
  if(!l) return;
  const people = aa ? l.split.people : [...new Set([...P().payers])];
  $("byPayerBox").hidden = !people.length;
  if(S.byPayer==null) S.byPayer = P().defaultPayer && people.includes(P().defaultPayer) ? P().defaultPayer : (people[0]||"");
  const pc=$("byPayerChips"); pc.textContent="";
  people.forEach(p=>{ const b=el("button","chip",p); b.type="button"; b.setAttribute("aria-pressed", p===S.byPayer); b.onclick=()=>{ S.byPayer = S.byPayer===p ? "" : p; renderBuySplit(); }; pc.appendChild(b); });
  if(!aa) return;
  document.querySelectorAll("#bySplitMode button").forEach(b=>b.setAttribute("aria-pressed", b.dataset.m===S.bySplit.m));
  const grid=$("bySplitCustom"); grid.textContent="";
  const amt=Math.round(Number($("byAmt").value)||0), ratio=l.split.ratio||evenRatio(people);
  if(S.bySplit.m==="a"){
    if(people.some(p=>S.bySplit.r[p]==null)) S.bySplit.r=splitAmtDefault(people, ratio, amt);
    people.forEach((p,idx)=>{ const lab=el("label",null,p); const w=el("span","pct-in"); const inp=el("input"); inp.type="number"; inp.min="0"; inp.step="1"; inp.inputMode="numeric";
      inp.value=S.bySplit.r[p]; inp.dataset.p=p; inp.setAttribute("aria-label",p+" 分攤金額");
      inp.addEventListener("input",()=>{ S.bySplit.r[p]=Number(inp.value)||0;
        if(people.length===2){ const o=people[1-idx], a=Math.round(Number($("byAmt").value)||0); S.bySplit.r[o]=Math.max(a-S.bySplit.r[p],0); const oi=grid.querySelector(`input[data-p="${o}"]`); if(oi) oi.value=S.bySplit.r[o]; }
        buySplitNote(); });
      w.append(document.createTextNode("NT$ "), inp); lab.appendChild(w); grid.appendChild(lab); });
  }
  buySplitNote();
}
function buySplitNote(){
  const l=S.ledgers.get($("byLedger").value); if(!l || !aaOn(l)) return;
  const n=$("bySplitNote"), people=l.split.people, amt=Math.round(Number($("byAmt").value)||0); n.classList.remove("warn-text");
  if(!S.byPayer){ n.classList.add("warn-text"); n.textContent="請選誰付的（必填），AA 結算才算得出來。"; return; }
  if(S.bySplit.m==="s"){ n.textContent=`全部算 ${S.byPayer} 自己的。`; return; }
  if(S.bySplit.m==="a"){ const sum=people.reduce((t,p)=>t+(Number(S.bySplit.r[p])||0),0);
    if(sum!==amt){ n.classList.add("warn-text"); n.textContent=`每人金額加起來 ${money(sum)}，要等於 ${money(amt)}。`; return; }
    n.textContent=people.map(p=>`${p} 分攤 ${money(S.bySplit.r[p]||0)}`).join("・"); return; }
  const r=l.split.ratio||evenRatio(people); n.textContent = people.map(p=>`${p} ${r[p]}%` + (amt?`（${money(amt*(Number(r[p])||0)/100)}）`:"")).join("・");
}
document.querySelectorAll("#bySplitMode button").forEach(b=>b.onclick=()=>{ S.bySplit.m=b.dataset.m; if(b.dataset.m==="a") S.bySplit.r={}; renderBuySplit(); });
$("byAmt").addEventListener("input", ()=>{ const l=S.ledgers.get($("byLedger").value); if(!l || !aaOn(l)) return;
  if(S.bySplit.m==="a" && l.split.people.length===2){ const [a,b]=l.split.people, amt=Math.round(Number($("byAmt").value)||0);
    S.bySplit.r[b]=Math.max(amt-(Number(S.bySplit.r[a])||0),0); const bi=$("bySplitCustom").querySelector(`input[data-p="${b}"]`); if(bi) bi.value=S.bySplit.r[b]; }
  buySplitNote(); });
$("byLedger").addEventListener("change", fillBuyCats);
function openBuy(x,i){
  S.buyItem=i; msg("byMsg",""); S.byPayer=null; S.bySplit={m:"d", r:{}};
  $("byWhat").textContent=`${i.text}` + (i.amount?`（預估 ${money(i.amount)}）`:"");
  $("byAmt").value=i.amount||"";
  const sel=$("byLedger"); sel.textContent=""; const none=el("option",null,"不記帳，只打勾"); none.value=""; sel.appendChild(none);
  [...S.ledgers.values()].filter(canEdit).forEach(l=>{ const o=el("option",null,l.name); o.value=l.id; sel.appendChild(o); });
  const last=store.get("ledger.buyLedger"); sel.value = last!=null && [...sel.options].some(o=>o.value===last) ? last : "";
  $("byDate").value=todayStr(); fillPayOptions("byPay", P().defaultPay||"現金", "out"); fillBuyCats();
  $("dlgBuy").showModal(); setTimeout(()=>$("byAmt").focus(),50);
}
$("formBuy").addEventListener("submit", async ev=>{
  if(ev.submitter && ev.submitter.value!=="save") return;
  ev.preventDefault();
  const x=LI(), i=S.buyItem, amt=Math.max(0,Math.round(Number($("byAmt").value)||0)), lid=$("byLedger").value, l=S.ledgers.get(lid);
  const date=$("byDate").value||todayStr();
  if(l && !amt){ msg("byMsg","要記帳的話請填實際金額，或選「不記帳，只打勾」。","err"); return; }
  let split=null;
  if(l && aaOn(l) && !S.byPayer){ msg("byMsg",`「${l.name}」有開 AA，請選誰付的。`,"err"); return; }
  if(l && aaOn(l)){
    if(S.bySplit.m==="a"){ const sum=l.split.people.reduce((t,p)=>t+(Number(S.bySplit.r[p])||0),0);
      if(sum!==amt){ msg("byMsg",`每人分攤的金額加起來要等於 ${money(amt)}。`,"err"); return; }
      split={m:"a", r:Object.fromEntries(l.split.people.map(p=>[p,Math.round(Number(S.bySplit.r[p])||0)]))}; }
    else split={m:S.bySplit.m};
  }
  $("bySave").disabled=true;
  try{
    let entryId="";
    if(l){
      const cat=(l.categories||[]).find(c=>c.id===$("byCat").value) || (l.categories||[]).find(c=>c.type==="out");
      const ref=doc(collection(db,"ledgers",l.id,"entries"));
      await setDoc(ref, { type:"out", amount:amt, categoryId:cat?cat.id:"other", categoryName:cat?cat.name:"其他", date,
        note:`${i.text}（${x.name}）`.slice(0,100), pay:$("byPay").value||"現金", card:"", payer:(S.byPayer||"").slice(0,20), status:"paid", ...(split?{split}:{}),
        createdBy:S.user.uid, createdByEmail:S.email, createdAt:serverTimestamp(), updatedAt:serverTimestamp() });
      entryId=ref.id; store.set("ledger.buyCat", cat?cat.id:"");
    }
    store.set("ledger.buyLedger", lid);
    await updateDoc(doc(db,"lists",x.id,"items",i.id), { done:true, doneAt:todayStr(), spent:amt, ledgerId:l?l.id:"", entryId, via:"", updatedAt:serverTimestamp() });
    $("dlgBuy").close(); toast(l ? `完成，並記到「${l.name}」${money(amt)}` : "完成");
  }catch(e){ msg("byMsg","儲存失敗："+errText(e),"err"); }
  finally{ $("bySave").disabled=false; }
});
/* 不用花錢就完成的：親友送禮、家裡已有 */
async function markVia(via, label){
  const x=LI(), i=S.buyItem;
  try{ await updateDoc(doc(db,"lists",x.id,"items",i.id), { done:true, doneAt:todayStr(), spent:0, ledgerId:"", entryId:"", via, updatedAt:serverTimestamp() });
    $("dlgBuy").close(); toast("已標記："+label); }
  catch(e){ msg("byMsg","儲存失敗："+errText(e),"err"); }
}
$("byGift").onclick=()=>markVia("gift","親友送禮");
$("byHave").onclick=()=>markVia("have","已有物品");
async function undoItem(x,i){
  try{
    let note="";
    if(i.ledgerId && i.entryId){ try{ await deleteDoc(doc(db,"ledgers",i.ledgerId,"entries",i.entryId)); note="（帳本裡那筆也刪掉了）"; }catch(e){ note="（帳本裡那筆沒辦法刪，請自己到帳本刪除）"; } }
    await updateDoc(doc(db,"lists",x.id,"items",i.id), { done:false, doneAt:"", spent:0, ledgerId:"", entryId:"", via:"", updatedAt:serverTimestamp() });
    toast("已改回未完成"+note);
  }catch(e){ toast("更新失敗："+errText(e)); }
}

/* 清單設定：改名、顏色、分享、刪除／離開 */
let lsColor=COLORS[0];
$("liSetBtn").onclick=()=>{ renderListSet(true); $("dlgListSet").showModal(); };
function renderListSet(reset){
  const x=LI(); if(!x) return; const owner=x.ownerUid===S.user.uid;
  $("lsOwnerBox").hidden=!owner; $("lsDelete").hidden=!owner; $("lsLeave").hidden=owner;
  if(reset){ msg("lsMsg",""); $("lsName").value=x.name; lsColor=x.color||COLORS[0]; swatches("lsColors", lsColor, c=>{ lsColor=c; });
    $("lsDelete").dataset.armed=""; $("lsDelete").textContent="刪除這個清單"; $("lsLeave").dataset.armed=""; $("lsLeave").textContent="離開這個清單"; }
  if(!owner) return;
  const mb=$("lsMembers"); mb.textContent="";
  const me=el("div","member"); me.append(el("span","em",x.ownerEmail+"（你）"), el("span","badge","擁有者")); mb.appendChild(me);
  [...(x.editors||[]).map(e=>[e,"editor"]), ...(x.viewers||[]).map(e=>[e,"viewer"])].forEach(([em,role])=>{
    const r=el("div","member"); const sel=el("select"); sel.setAttribute("aria-label",em+" 的權限");
    [["editor","可編輯"],["viewer","僅檢視"]].forEach(([v,t])=>{ const o=el("option",null,t); o.value=v; o.selected=v===role; sel.appendChild(o); });
    sel.onchange=()=>setListMember(em, sel.value);
    const rm=el("button","btn","移除"); rm.type="button";
    rm.onclick=()=>{ if(!rm.dataset.armed){ rm.dataset.armed="1"; rm.textContent="確定移除？"; rm.classList.add("danger"); return; } setListMember(em,null); };
    r.append(el("span","em",em), sel, rm); mb.appendChild(r); });
  if(!(x.editors||[]).length && !(x.viewers||[]).length) mb.appendChild(el("p","small muted","目前只有你看得到這個清單。"));
}
async function setListMember(email, role){
  const x=LI();
  const editors=(x.editors||[]).filter(e=>e!==email), viewers=(x.viewers||[]).filter(e=>e!==email);
  if(role==="editor") editors.push(email); if(role==="viewer") viewers.push(email);
  try{ await updateDoc(doc(db,"lists",x.id), { editors, viewers, members:[x.ownerEmail, ...editors, ...viewers], updatedAt:serverTimestamp() });
    msg("lsMsg", role ? `已分享給 ${email}（${role==="editor"?"可編輯":"僅檢視"}）` : `已移除 ${email}`, "ok"); }
  catch(e){ msg("lsMsg","更新失敗："+errText(e),"err"); }
}
$("lsInvite").onclick=()=>{
  const em=$("lsEmail").value.trim().toLowerCase(), x=LI();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)){ msg("lsMsg","請輸入正確的 Email。","err"); return; }
  if(em===x.ownerEmail){ msg("lsMsg","這是你自己的 Email。","err"); return; }
  $("lsEmail").value=""; setListMember(em, $("lsRole").value);
};
$("lsEmail").addEventListener("keydown", e=>{ if(e.key==="Enter"){ e.preventDefault(); $("lsInvite").click(); } });
$("lsSaveName").onclick=async()=>{
  const x=LI(), name=$("lsName").value.trim().slice(0,40); if(!name){ msg("lsMsg","請輸入名稱。","err"); return; }
  try{ await updateDoc(doc(db,"lists",x.id), { name, color:lsColor, updatedAt:serverTimestamp() }); msg("lsMsg","已儲存。","ok"); }
  catch(e){ msg("lsMsg","儲存失敗："+errText(e),"err"); }
};
$("lsClose").onclick=()=>$("dlgListSet").close();
$("lsDelete").onclick=async()=>{
  const b=$("lsDelete"); if(!b.dataset.armed){ b.dataset.armed="1"; b.textContent="確定刪除？所有項目和記事都會刪掉（已記到帳本的不受影響）"; return; }
  const x=LI();
  try{ const snap=await getDocs(collection(db,"lists",x.id,"items"));
    for(let k=0;k<snap.docs.length;k+=400){ const bt=writeBatch(db); snap.docs.slice(k,k+400).forEach(d=>bt.delete(d.ref)); await bt.commit(); }
    stopItems(); S.itemsFor=null; S.listDeleting=true; await deleteDoc(doc(db,"lists",x.id));
    $("dlgListSet").close(); S.listId=null; location.hash="#lists"; toast("清單已刪除"); }
  catch(e){ S.listDeleting=false; msg("lsMsg","刪除失敗："+errText(e),"err"); }
};
$("lsLeave").onclick=async()=>{
  const b=$("lsLeave"); if(!b.dataset.armed){ b.dataset.armed="1"; b.textContent="確定要離開？"; return; }
  const x=LI();
  try{ stopItems(); S.itemsFor=null; S.listDeleting=true;
    await updateDoc(doc(db,"lists",x.id), { members:(x.members||[]).filter(e=>e!==S.email), editors:(x.editors||[]).filter(e=>e!==S.email), viewers:(x.viewers||[]).filter(e=>e!==S.email), updatedAt:serverTimestamp() });
    $("dlgListSet").close(); S.listId=null; location.hash="#lists"; toast("已離開這個清單"); }
  catch(e){ S.listDeleting=false; msg("lsMsg","離開失敗："+errText(e),"err"); }
};

/* ================= 資產快照（淨資產） ================= */
/* 不追蹤每一筆轉帳：想到的時候（例如月底）把各戶頭、現金的金額填一次，
   系統自動加上投資市值、扣掉貸款剩餘本金，算出淨資產並畫出變化。只有自己看得到。 */
S.snaps=[];
function watchSnaps(){
  stopSnaps(); S.snapsReady=false;
  S.unsubSnaps=onSnapshot(query(collection(db,"snaps"), where("ownerUid","==",S.user.uid)), snap=>{
    S.snaps=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>a.date.localeCompare(b.date)||((a.createdAt&&a.createdAt.seconds)||0)-((b.createdAt&&b.createdAt.seconds)||0));
    S.snapsReady=true; if(location.hash==="#invest") renderNW();
  }, e=>msg("investMsg","讀取資產紀錄失敗："+errText(e),"err"));
}
function stopSnaps(){ if(S.unsubSnaps){ S.unsubSnaps(); S.unsubSnaps=null; } S.snaps=[]; }
const snapCash = x => (x.accounts||[]).reduce((t,a)=>t+(Number(a.v)||0),0);
const snapNet = x => snapCash(x) + (x.inv||0) - (x.loan||0);
const curInvMV = () => Math.round(S.holdings.reduce((t,h)=>t+holdStats(h).mv*fxOf(h),0));
const curLoanLeft = () => S.loans.reduce((t,lo)=>t+loanStats(lo).remain,0);
const loanLabel = lo => [lo.bank,lo.name].filter(Boolean).join(" ") || lo.type || "貸款";
const curLoans = () => S.loans.map(lo=>({n:loanLabel(lo).slice(0,30), v:loanStats(lo).remain})).filter(x=>x.v>0);
/* 一筆紀錄拆成各項：帳戶、投資、每筆貸款（舊紀錄沒有分開時就用「貸款」合計） */
function snapItems(x){
  const out=(x.accounts||[]).map(a=>({k:"a:"+a.n, n:a.n, v:Number(a.v)||0, t:"acct"}));
  if(x.inv) out.push({k:"inv", n:"投資", v:x.inv, t:"inv"});
  if(x.loan){ if(Array.isArray(x.loans) && x.loans.length) x.loans.forEach(l=>out.push({k:"l:"+l.n, n:l.n, v:-(Number(l.v)||0), t:"loan"}));
    else out.push({k:"l:貸款", n:"貸款", v:-x.loan, t:"loan"}); }
  return out;
}
const md = d => `${Number(d.slice(5,7))}/${Number(d.slice(8,10))}`;

function renderNW(){
  const sn=S.snaps, last=sn[sn.length-1], prev=sn[sn.length-2];
  const parts=$("nwParts"); parts.textContent="";
  if(!last){
    $("nwSeries").textContent=""; $("nwCompare").textContent="";
    $("nwNet").textContent = S.snapsReady ? "還沒有記錄" : "讀取中…"; $("nwNet").className="num mid";
    $("nwWhen").textContent="按「＋ 記錄資產」，把各戶頭和現金現在有多少填一次就好。建議每個月月底記一次，就能看到資產的變化。";
    $("nwChart").textContent=""; $("nwHistWrap").hidden=true; return;
  }
  const net=snapNet(last);
  $("nwNet").textContent=money(net); $("nwNet").className="num big"+(net<0?" c-out":"");
  let when=`${last.date.replace(/-/g,"/")} 記錄`;
  if(prev){ const d=net-snapNet(prev); when+=`・比上次（${md(prev.date)}）${d>=0?"多":"少"} ${money(Math.abs(d))}`; }
  $("nwWhen").textContent=when;
  [["戶頭與現金", snapCash(last), ""], ["投資", last.inv||0, ""], ["貸款（"+((last.loans||[]).length||1)+" 筆）", -(last.loan||0), "c-out"]].forEach(([k,v,c])=>{
    if(k!=="戶頭與現金" && !v) return; if(k.startsWith("貸款") && !(last.loans||[]).length) k="貸款";
    const d=el("div"); d.append(el("div","label",k), el("div","num mid "+c, (v<0?"−":"")+fmt(Math.abs(v)))); parts.appendChild(d); });
  renderNWSeries(); renderNWChart(); renderNWCompare();
  $("nwHistWrap").hidden=false;
  const h=$("nwHist"); h.textContent="";
  sn.slice().reverse().forEach(x=>{ const b=el("button","trow"); b.type="button"; b.onclick=()=>openSnap(x);
    const m=el("div","trow-main"); m.append(el("span","small muted num",x.date), el("strong","num",money(snapNet(x))));
    const det=snapItems(x).map(i=>`${i.n} ${i.v<0?"−":""}${fmt(Math.abs(i.v))}`).join("・");
    b.appendChild(m); b.appendChild(el("div","small muted", det + (x.note?`・${x.note}`:""))); h.appendChild(b); });
}
function renderNWChart(){
  const sn=S.snaps, box=$("nwChart");
  if(sn.length<2){ box.innerHTML=`<p class="small muted">再記錄一次，就會畫出變化的曲線。</p>`; return; }
  const key=S.nwSeries||"net";
  const valOf = x => key==="net" ? snapNet(x) : ((snapItems(x).find(i=>i.k===key)||{}).v);
  const pts=sn.slice(-24).filter(x=>valOf(x)!=null), vals=pts.map(x=>Math.abs(valOf(x)));
  if(pts.length<2){ box.innerHTML=`<p class="small muted">這個項目還不到兩筆紀錄，畫不出變化。</p>`; return; }
  const W=Math.max(300,Math.min(720,box.clientWidth||640)), H=W<480?180:200, Lp=54, R=14, T=14, B=26;
  let lo=Math.min(...vals), hi=Math.max(...vals); if(lo===hi){ lo-=1000; hi+=1000; }
  const pad0=(hi-lo)*.12; lo-=pad0; hi+=pad0;
  const xv=i=>Lp+(W-Lp-R)*(pts.length===1?0.5:i/(pts.length-1)), yv=v=>T+(H-T-B)*(1-(v-lo)/(hi-lo));
  let s=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="淨資產變化">`;
  for(let k=0;k<=3;k++){ const v=lo+(hi-lo)*k/3, y=yv(v);
    s+=`<line x1="${Lp}" x2="${W-R}" y1="${y}" y2="${y}" stroke="var(--rule)"/>`;
    s+=`<text x="${Lp-6}" y="${y+4}" text-anchor="end" font-size="11" fill="var(--muted)" font-family="var(--f-num)">${(v<0?"-":"")+tick(Math.abs(Math.round(v/1000)*1000))}</text>`; }
  const col = key.startsWith("l:") ? "var(--out)" : "var(--accent)";
  s+=`<polyline fill="none" stroke="${col}" stroke-width="2.5" stroke-linejoin="round" points="${pts.map((p,i)=>`${xv(i)},${yv(vals[i])}`).join(" ")}"/>`;
  const every=Math.ceil(pts.length/8);
  pts.forEach((p,i)=>{ s+=`<circle cx="${xv(i)}" cy="${yv(vals[i])}" r="${i===pts.length-1?5:3.5}" fill="${col}"><title>${p.date}：${money(vals[i])}</title></circle>`;
    if(i%every===0 || i===pts.length-1) s+=`<text x="${xv(i)}" y="${H-8}" text-anchor="middle" font-size="11" fill="var(--muted)" font-family="var(--f-num)">${md(p.date)}</text>`; });
  box.innerHTML=s+"</svg>";
}

/* 記錄／修改一筆 */
$("nwAdd").onclick=()=>openSnap(null);
function snapRow(n,v){
  const r=el("div","sn-row");
  const ni=el("input"); ni.type="text"; ni.maxLength=20; ni.placeholder="例如：郵局、現金"; ni.value=n||""; ni.className="sn-n"; ni.setAttribute("aria-label","帳戶名稱");
  const vi=el("input"); vi.type="number"; vi.inputMode="numeric"; vi.placeholder="金額"; vi.value=v!=null&&v!==""?v:""; vi.className="sn-v"; vi.setAttribute("aria-label","金額");
  const x=el("button","icon-btn","✕"); x.type="button"; x.setAttribute("aria-label","移除這個帳戶"); x.onclick=()=>{ r.remove(); snapTotal(); };
  vi.addEventListener("input", snapTotal);
  r.append(ni,vi,x); return r;
}
function openSnap(x){
  S.snEdit=x; msg("snMsg","");
  $("snTitle").textContent = x ? "修改資產紀錄" : "記錄資產";
  $("snDate").value = x ? x.date : todayStr(); $("snNote").value = x ? (x.note||"") : "";
  const box=$("snAccts"); box.textContent="";
  const src = x || S.snaps[S.snaps.length-1];
  const accts = src && (src.accounts||[]).length ? src.accounts : [{n:"",v:""},{n:"現金",v:""}];
  accts.forEach(a=>box.appendChild(snapRow(a.n, x ? a.v : (src ? a.v : ""))));
  S.snInv = x ? (x.inv||0) : curInvMV(); S.snLoan = x ? (x.loan||0) : curLoanLeft();
  S.snLoans = x ? (x.loans||[]) : curLoans();
  $("snLoans").textContent = S.snLoans.length>1 ? S.snLoans.map(l=>`${l.n} −${fmt(l.v)}`).join("・") : "";
  $("snInvV").textContent=fmt(S.snInv); $("snLoanV").textContent="−"+fmt(S.snLoan);
  $("snInv").checked = x ? !!x.inv : S.snInv>0; $("snLoan").checked = x ? !!x.loan : S.snLoan>0;
  $("snInv").parentElement.hidden = !S.snInv && !x; $("snLoan").parentElement.hidden = !S.snLoan && !x;
  $("snDelete").hidden=!x; $("snDelete").dataset.armed=""; $("snDelete").textContent="刪除這筆";
  snapTotal(); $("dlgSnap").showModal();
}
$("snAddAcct").onclick=()=>{ const r=snapRow("",""); $("snAccts").appendChild(r); r.querySelector(".sn-n").focus(); };
["snInv","snLoan"].forEach(id=>$(id).addEventListener("change", snapTotal));
function snapRows(){ return [...document.querySelectorAll("#snAccts .sn-row")].map(r=>({n:r.querySelector(".sn-n").value.trim().slice(0,20), v:Math.round(Number(r.querySelector(".sn-v").value)||0), blank:r.querySelector(".sn-v").value.trim()===""})); }
function snapTotal(){
  const cash=snapRows().reduce((t,a)=>t+a.v,0), net=cash+($("snInv").checked?S.snInv:0)-($("snLoan").checked?S.snLoan:0);
  $("snNet").textContent=money(net); $("snNet").className="num"+(net<0?" c-out":"");
}
$("formSnap").addEventListener("submit", async ev=>{
  if(ev.submitter && ev.submitter.value!=="save") return;
  ev.preventDefault();
  const date=$("snDate").value; if(!/^\d{4}-\d{2}-\d{2}$/.test(date)){ msg("snMsg","請選日期。","err"); return; }
  const rows=snapRows().filter(a=>a.n || !a.blank);
  if(rows.some(a=>!a.n)){ msg("snMsg","有金額的帳戶要填名稱，例如「郵局」「現金」。","err"); return; }
  if(!rows.length){ msg("snMsg","至少填一個戶頭或現金。","err"); return; }
  if(rows.length>30){ msg("snMsg","帳戶最多 30 個。","err"); return; }
  const data={ date, accounts:rows.map(a=>({n:a.n, v:a.v})), inv:$("snInv").checked?S.snInv:0, loan:$("snLoan").checked?S.snLoan:0, loans:$("snLoan").checked?(S.snLoans||[]).slice(0,30):[],
    note:$("snNote").value.trim().slice(0,60), updatedAt:serverTimestamp() };
  $("snSave").disabled=true;
  try{
    if(S.snEdit) await updateDoc(doc(db,"snaps",S.snEdit.id), data);
    else await addDoc(collection(db,"snaps"), {...data, ownerUid:S.user.uid, createdAt:serverTimestamp()});
    $("dlgSnap").close(); toast(`已記錄：淨資產 ${money(snapNet(data))}`);
  }catch(e){ msg("snMsg","儲存失敗："+errText(e),"err"); }
  finally{ $("snSave").disabled=false; }
});
$("snDelete").onclick=async()=>{
  const b=$("snDelete"); if(!b.dataset.armed){ b.dataset.armed="1"; b.textContent="確定刪除？"; return; }
  try{ await deleteDoc(doc(db,"snaps",S.snEdit.id)); $("dlgSnap").close(); toast("已刪除"); }
  catch(e){ msg("snMsg","刪除失敗："+errText(e),"err"); }
};

/* 曲線要看哪一項：淨資產、某個帳戶、投資、某筆貸款 */
function renderNWSeries(){
  const box=$("nwSeries"); box.textContent="";
  const keys=new Map([["net","淨資產"]]);
  S.snaps.slice().reverse().forEach(x=>snapItems(x).forEach(i=>{ if(!keys.has(i.k)) keys.set(i.k, i.n+(i.t==="loan"?"（貸款）":"")); }));
  if(!keys.has(S.nwSeries||"net")) S.nwSeries="net";
  keys.forEach((label,k)=>{ const b=el("button","chip",label); b.type="button"; b.setAttribute("aria-pressed", k===(S.nwSeries||"net"));
    b.onclick=()=>{ S.nwSeries=k; renderNWSeries(); renderNWChart(); }; box.appendChild(b); });
}
/* 和上一筆比：每個帳戶、投資、每筆貸款各自變多少 */
function renderNWCompare(){
  const box=$("nwCompare"); box.textContent=""; const sn=S.snaps; if(sn.length<2) return;
  const a=sn[sn.length-2], b=sn[sn.length-1], A=new Map(snapItems(a).map(i=>[i.k,i])), B=new Map(snapItems(b).map(i=>[i.k,i]));
  const keys=[...new Set([...B.keys(), ...A.keys()])];
  const t=el("table","btable nw-cmp"), th=el("thead"), hr=el("tr");
  ["項目",`上次 ${md(a.date)}`,`這次 ${md(b.date)}`,"變化"].forEach(x=>hr.appendChild(el("th",null,x))); th.appendChild(hr);
  const tb=el("tbody");
  keys.forEach(k=>{ const x=A.get(k), y=B.get(k), it=y||x, va=x?x.v:0, vb=y?y.v:0, d=vb-va;
    const tr=el("tr"); tr.className="nw-row"+(it.t==="loan"?" is-loan":""); tr.title="看這一項的曲線"; tr.onclick=()=>{ S.nwSeries=k; renderNWSeries(); renderNWChart(); $("nwChart").scrollIntoView({block:"nearest"}); };
    const f=v=>v==null?"—":(v<0?"−":"")+fmt(Math.abs(v));
    tr.append(el("td",null,it.n+(it.t==="loan"?"（貸款）":"")), el("td","num",x?f(va):"—"), el("td","num",y?f(vb):"—"),
      el("td","num "+(d>0?"c-in":d<0?"c-out":"muted"), d? (d>0?"+":"−")+fmt(Math.abs(d)) : "—"));
    tb.appendChild(tr); });
  const nd=snapNet(b)-snapNet(a), fr=el("tr"); fr.className="nw-total";
  fr.append(el("td",null,"淨資產"), el("td","num",fmt(snapNet(a))), el("td","num",fmt(snapNet(b))), el("td","num "+(nd>0?"c-in":nd<0?"c-out":""), (nd>=0?"+":"−")+fmt(Math.abs(nd))));
  tb.appendChild(fr);
  t.append(th,tb); const w=el("div","table-wrap"); w.appendChild(t);
  box.append(el("div","label nw-cmp-title","和上次比較（點一列可以看那一項的曲線）"), w);
}

/* 記一筆：不只一個人付（AA 帳本才有） */
function renderMultiPay(){
  const l=L(), show=l && aaOn(l) && S.eType==="out";
  $("eMultiPayWrap").hidden=!show;
  const on = show && $("eMultiPay").checked;
  $("eMultiPayGrid").hidden=!on; $("eMultiPayNote").hidden=!on;
  $("ePayer").hidden=on; $("ePayerChips").hidden=on;
  if(!on) return;
  const people=l.split.people, grid=$("eMultiPayGrid"), amt=Math.round(Number($("eAmount").value)||0);
  if(!S.ePaid || people.some(p=>S.ePaid[p]==null)) S.ePaid=splitAmtDefault(people, l.split.ratio||evenRatio(people), amt);
  grid.textContent="";
  people.forEach((p,idx)=>{ const lab=el("label",null,p); const w=el("span","pct-in"); const inp=el("input"); inp.type="number"; inp.min="0"; inp.step="1"; inp.inputMode="numeric";
    inp.value=S.ePaid[p]; inp.dataset.p=p; inp.setAttribute("aria-label",p+" 付了多少");
    inp.addEventListener("input",()=>{ S.ePaid[p]=Math.max(0,Math.round(Number(inp.value)||0));
      if(people.length===2){ const o=people[1-idx], a=Math.round(Number($("eAmount").value)||0); S.ePaid[o]=Math.max(a-S.ePaid[p],0); const oi=grid.querySelector(`input[data-p="${o}"]`); if(oi) oi.value=S.ePaid[o]; }
      multiPayNote(); splitNote(); });
    w.append(document.createTextNode("NT$ "), inp); lab.appendChild(w); grid.appendChild(lab); });
  multiPayNote();
}
function multiPayNote(){
  const l=L(); if(!l||!aaOn(l)) return; const people=l.split.people, amt=Math.round(Number($("eAmount").value)||0), n=$("eMultiPayNote");
  const sum=people.reduce((t,p)=>t+(S.ePaid[p]||0),0); n.classList.toggle("warn-text", sum!==amt);
  n.textContent = sum!==amt ? `每人付的加起來是 ${money(sum)}，要等於這筆金額 ${money(amt)}。` : "這裡填「實際各付了多少」。如果各付的剛好就是各自該負擔的，下面選「各付各的」就好。";
}
$("eMultiPay").addEventListener("change", ()=>{ if($("eMultiPay").checked) S.ePaid=null; renderMultiPay(); syncSplitLabels(); splitNote(); });
$("eAmount").addEventListener("input", ()=>{ const l=L(); if(!l || !aaOn(l) || !$("eMultiPay").checked) return;
  const ppl=l.split.people; if(ppl.length===2){ const amt=Math.round(Number($("eAmount").value)||0); S.ePaid[ppl[1]]=Math.max(amt-(S.ePaid[ppl[0]]||0),0); const bi=$("eMultiPayGrid").querySelector(`input[data-p="${ppl[1]}"]`); if(bi) bi.value=S.ePaid[ppl[1]]; }
  multiPayNote(); });

/* 「只算付款人」在兩個人各付一部分時，意思就是「各付各的」 */
function syncSplitLabels(){
  const b=document.querySelector('#eSplitMode button[data-m="s"]'); if(!b) return;
  b.textContent = $("eMultiPay").checked ? "各付各的" : "只算付款人";
}
