const $ = (x) => document.getElementById(x),
  K = "ledger-v2-data";
const APPEARANCE_KEY = "ledger-appearance";
const MONTH_OVERVIEW_KEY = "ledger-month-overview-open";
const BACKGROUND_DB = "ledger-background-images";
const BACKGROUND_MAX_MIGRATION_KEY = "ledger-background-maximized-v72";
const PHOTO_DB_NAME = "ledger-photo-attachments";
const PHOTO_STORE_NAME = "photos";
const PHOTO_LIMIT_PER_ENTRY = 10;
const BACKGROUND_TARGETS = [
  { key: "home", name: "首頁整體背景", element: "home", shape: "home" },
  { key: "overview", name: "本月總覽", element: "monthOverviewCard", shape: "card" },
  { key: "reminders", name: "近期提醒", element: "remindersCard", shape: "card" },
  { key: "calendar", name: "Google 行事曆", element: "calendarCard", shape: "card" },
  { key: "temp", name: "臨時帳本", element: "tempHomeCard", shape: "card" },
  { key: "recent", name: "最近頁面", element: null, shape: "home" },
  { key: "search", name: "搜尋頁面", element: null, shape: "home" },
  { key: "tempPage", name: "臨時帳本頁面", element: null, shape: "home" },
];
let backgroundUrls = {}, cropState = null;
let pendingPhotos = { formal: [], temp: [] };
let photoViewerUrls = [], photoViewerContext = null;
let D = JSON.parse(localStorage.getItem(K) || "null") || {
    e: [],
    b: [],
    cats: [
      "餐飲",
      "交通",
      "購物",
      "追星",
      "娛樂",
      "寵物",
      "固定支出",
      "醫療",
      "信用卡繳款",
      "預購",
      "非必要支出",
    ],
  },
  B = null;
D.prepaid ||= [];
D.cards ||= ["國泰", "星展", "台新"].map((name, index) => ({ id: index + 1, name, closeDay: "", statementDay: "", dueDay: "", active: true }));
D.cards.forEach((card) => card.paidStatements ||= []);
const td = () => {
    let now = new Date(),
      y = now.getFullYear(),
      m = String(now.getMonth() + 1).padStart(2, "0"),
      d = String(now.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  },
  currentTime = () => {
    let now = new Date(),
      h = String(now.getHours()).padStart(2, "0"),
      m = String(now.getMinutes()).padStart(2, "0");
    return `${h}:${m}`;
  },
  setCurrentDateTime = (dateId, timeId) => {
    $(dateId).value = td();
    $(timeId).value = currentTime();
  },
  money = (n) => "$" + Math.round(+n || 0).toLocaleString("zh-TW");
function photoDb() {
  return new Promise((resolve, reject) => {
    let request = indexedDB.open(PHOTO_DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(PHOTO_STORE_NAME))
        request.result.createObjectStore(PHOTO_STORE_NAME, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function photoDbAction(mode, value) {
  let db = await photoDb();
  return new Promise((resolve, reject) => {
    let tx = db.transaction(PHOTO_STORE_NAME, mode === "get" ? "readonly" : "readwrite"),
      store = tx.objectStore(PHOTO_STORE_NAME),
      request = mode === "put" ? store.put(value) : mode === "delete" ? store.delete(value) : store.get(value);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
    tx.onerror = () => reject(tx.error);
  });
}
function photoUid() {
  return globalThis.crypto?.randomUUID?.() || `photo-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
function recordUid(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
function compressPhoto(file) {
  return new Promise((resolve, reject) => {
    let url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      let maxSide = 1800, scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight)),
        canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("照片處理失敗")), "image/jpeg", 0.82);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("無法讀取照片")); };
    img.src = url;
  });
}
function photoUi(scope) {
  let prefix = scope === "formal" ? "e" : "t";
  return { count: $(`${prefix}photoCount`), preview: $(`${prefix}photoPreview`), camera: $(`${prefix}photoCamera`), files: $(`${prefix}photoFiles`) };
}
async function handlePhotoSelection(scope, fileList) {
  let files = [...(fileList || [])].filter((file) => file.type.startsWith("image/")), current = pendingPhotos[scope];
  if (!files.length) return;
  if (current.length + files.length > PHOTO_LIMIT_PER_ENTRY) {
    alert(`每筆最多 ${PHOTO_LIMIT_PER_ENTRY} 張照片`);
    files = files.slice(0, PHOTO_LIMIT_PER_ENTRY - current.length);
  }
  try {
    for (let file of files) {
      let blob = await compressPhoto(file);
      current.push({ blob, url: URL.createObjectURL(blob), name: file.name || "照片" });
    }
    renderPhotoPicker(scope);
  } catch (error) {
    alert(error.message || "照片處理失敗，請換一張再試");
  } finally {
    let ui = photoUi(scope);
    if (ui.camera) ui.camera.value = "";
    if (ui.files) ui.files.value = "";
  }
}
function renderPhotoPicker(scope) {
  let ui = photoUi(scope), photos = pendingPhotos[scope];
  if (!ui.preview || !ui.count) return;
  ui.count.textContent = `${photos.length} 張`;
  ui.preview.innerHTML = photos.map((photo, index) => `<div class="photo-thumb"><img src="${photo.url}" alt="${esc(photo.name)}"><button class="photo-remove" type="button" aria-label="刪除照片" onclick="removePendingPhoto('${scope}',${index})">×</button></div>`).join("");
}
function removePendingPhoto(scope, index) {
  let [photo] = pendingPhotos[scope].splice(index, 1);
  if (photo?.url) URL.revokeObjectURL(photo.url);
  renderPhotoPicker(scope);
}
function resetPhotoPicker(scope) {
  pendingPhotos[scope].forEach((photo) => URL.revokeObjectURL(photo.url));
  pendingPhotos[scope] = [];
  renderPhotoPicker(scope);
}
async function savePendingPhotos(scope, recordId) {
  let ids = [];
  for (let photo of pendingPhotos[scope]) {
    let id = photoUid();
    await photoDbAction("put", { id, recordId, blob: photo.blob, createdAt: Date.now() });
    ids.push(id);
  }
  return ids;
}
function recordForPhotos(scope, index) {
  return scope === "formal" ? D.e[index] : B?.entries[index];
}
function photoIdInUse(photoId) {
  return D.e.some((entry) => entry.photoIds?.includes(photoId)) ||
    D.b.some((book) => book.entries?.some((entry) => entry.photoIds?.includes(photoId)));
}
async function cleanupUnusedPhotoIds(photoIds) {
  for (let photoId of photoIds || [])
    if (!photoIdInUse(photoId)) await photoDbAction("delete", photoId).catch(() => {});
}
function photoRecordButton(scope, index, entry) {
  let count = entry?.photoIds?.length || 0;
  return count ? `<button class="photo-record-button" type="button" onclick="openRecordPhotos('${scope}',${index})">📷 ${count}</button>` : "";
}
function clearPhotoViewerUrls() {
  photoViewerUrls.forEach((url) => URL.revokeObjectURL(url));
  photoViewerUrls = [];
}
async function openRecordPhotos(scope, index) {
  let entry = recordForPhotos(scope, index);
  if (!entry?.photoIds?.length) return alert("這筆紀錄目前沒有照片");
  photoViewerContext = { scope, index };
  clearPhotoViewerUrls();
  $("photoViewerTitle").textContent = entry.item || entry.cat || "照片附件";
  $("photoViewerGrid").innerHTML = '<div class="muted">照片載入中…</div>';
  openM("photoViewerM");
  let rows = [];
  for (let photoId of entry.photoIds) {
    let stored = await photoDbAction("get", photoId).catch(() => null);
    if (!stored?.blob) continue;
    let url = URL.createObjectURL(stored.blob), urlIndex = photoViewerUrls.push(url) - 1;
    rows.push(`<div class="photo-thumb"><img src="${url}" alt="記帳照片" onclick="openFullPhoto(${urlIndex})"><button class="photo-remove" type="button" aria-label="刪除照片" onclick="deleteSavedPhoto('${photoId}')">×</button></div>`);
  }
  $("photoViewerGrid").innerHTML = rows.join("") || '<div class="muted">照片檔案已不存在</div>';
}
function openFullPhoto(index) {
  let url = photoViewerUrls[index];
  if (url) window.open(url, "_blank", "noopener");
}
function closePhotoViewer() {
  clearPhotoViewerUrls();
  photoViewerContext = null;
  closeM("photoViewerM");
}
async function deleteSavedPhoto(photoId) {
  if (!photoViewerContext || !confirm("確定刪除這張照片？")) return;
  let entry = recordForPhotos(photoViewerContext.scope, photoViewerContext.index);
  if (!entry) return;
  entry.photoIds = (entry.photoIds || []).filter((id) => id !== photoId);
  persist();
  await cleanupUnusedPhotoIds([photoId]);
  if (photoViewerContext.scope === "formal") renderRecent(); else detail();
  if (entry.photoIds.length) await openRecordPhotos(photoViewerContext.scope, photoViewerContext.index);
  else closePhotoViewer();
}
function persist() {
  localStorage.setItem(K, JSON.stringify(D));
  home();
}
function show(x) {
  document.querySelectorAll(".screen").forEach((e) => e.classList.remove("on"));
  $(x).classList.add("on");
  if (x === "temp") books();
  applyPageBackgrounds();
}
function openM(x) {
  $(x).classList.add("on");
}
function closeM(x) {
  $(x).classList.remove("on");
}
function toggleMonthOverview() {
  let content = $("monthOverviewContent"),
    button = $("monthOverviewToggle"),
    opening = content.hidden;
  content.hidden = !opening;
  button.setAttribute("aria-expanded", String(opening));
  button.setAttribute("aria-label", opening ? "收合本月總覽" : "展開本月總覽");
  button.textContent = opening ? "－" : "＋";
  localStorage.setItem(MONTH_OVERVIEW_KEY, opening ? "1" : "0");
}
function restoreMonthOverview() {
  let opening = localStorage.getItem(MONTH_OVERVIEW_KEY) === "1",
    content = $("monthOverviewContent"),
    button = $("monthOverviewToggle");
  content.hidden = !opening;
  button.setAttribute("aria-expanded", String(opening));
  button.setAttribute("aria-label", opening ? "收合本月總覽" : "展開本月總覽");
  button.textContent = opening ? "－" : "＋";
}
function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
function paymentLabel(x) {
  if (x.pay === "預繳帳戶" && x.prepaidAccountName) return `預繳－${x.prepaidAccountName}`;
  return x.pay === "信用卡" && x.card ? `${x.pay}－${x.card}` : x.pay || "未設定";
}
function activePrepaidAccounts() { return D.prepaid.filter((account) => account.active !== false); }
function renderPrepaidSelect(selectId) {
  let select = $(selectId), current = select?.value;
  if (!select) return;
  select.replaceChildren(new Option("選擇預繳帳戶", ""), ...activePrepaidAccounts().map((account) => new Option(`${account.name}（餘額 ${money(account.balance)}）`, String(account.id))));
  if ([...select.options].some((option) => option.value === current)) select.value = current;
  showPrepaidBalance(selectId, selectId === "eprepaid" ? "eprepaidBalance" : "");
}
function showPrepaidBalance(selectId, outputId) {
  let account = D.prepaid.find((item) => String(item.id) === $(selectId)?.value), output = outputId && $(outputId);
  if (output) output.textContent = account ? `目前餘額 ${money(account.balance)}` : "";
}
function createPrepaidAccount(selectId = "") {
  let name = prompt("預繳帳戶名稱，例如：悠遊卡、會員儲值");
  if (!name?.trim()) return;
  let amount = +prompt("本次預繳／加值金額", "1000");
  if (!(amount > 0)) return alert("請輸入大於 0 的金額");
  let account = { id: Date.now(), name: name.trim(), balance: amount, active: true, transactions: [{ date: td(), type: "topup", amount, note: "建立／加值" }] };
  D.prepaid.push(account); persist(); renderPrepaidSelect("eprepaid");
  if (selectId && $(selectId)) { $(selectId).value = String(account.id); showPrepaidBalance(selectId, "eprepaidBalance"); }
  if ($("gtitle")?.textContent === "預繳帳戶") renderPrepaidAccounts();
}
function deactivatePrepaidAccount(selectId) {
  let account = D.prepaid.find((item) => String(item.id) === $(selectId)?.value);
  if (!account) return alert("請先選擇預繳帳戶");
  if (!confirm(`確定停用「${account.name}」？既有紀錄與餘額會保留。`)) return;
  account.active = false; persist(); renderPrepaidSelect(selectId);
}
function topupPrepaidAccount(id) {
  let account = D.prepaid.find((item) => item.id === id), amount = +prompt(`「${account?.name || ""}」加值金額`);
  if (!account || !(amount > 0)) return;
  account.balance += amount; account.transactions.push({ date: td(), type: "topup", amount, note: "加值" }); persist(); renderPrepaidAccounts();
}
function renderPrepaidAccounts() {
  $("genericList").innerHTML = `<div class="card"><button type="button" onclick="createPrepaidAccount()">＋ 建立預繳帳戶</button></div>${D.prepaid.map((account) => `<div class="card"><div class="top"><div><b>${esc(account.name)}</b><div class="muted">${account.active === false ? "已停用" : "使用中"}</div></div><b>${money(account.balance)}</b></div><button type="button" onclick="topupPrepaidAccount(${account.id})">＋ 加值</button>${account.transactions.slice().reverse().map((tx) => `<div class="item top"><span>${esc(tx.date)}｜${esc(tx.note || tx.type)}</span><b>${tx.amount >= 0 ? "+" : ""}${money(tx.amount)}</b></div>`).join("")}</div>`).join("") || '<div class="card muted">尚無預繳帳戶</div>'}`;
}
function renderCreditCardSelect(selectId) {
  let select = $(selectId), current = select?.value;
  if (!select) return;
  select.replaceChildren(...D.cards.filter((card) => card.active !== false).map((card) => new Option(card.name, card.name)));
  if ([...select.options].some((option) => option.value === current)) select.value = current;
}
function renderMixedPaymentSelect(selectId, defaultValue) {
  let select = $(selectId), current = select?.value;
  if (!select) return;
  let values = ["現金", ...D.cards.filter((card) => card.active !== false).map((card) => `信用卡－${card.name}`), "貨到付款"];
  select.replaceChildren(...values.map((value) => new Option(value, value)));
  select.value = values.includes(current) ? current : defaultValue;
}
function cardChargeAmount(entry, cardName) {
  if (entry.pay === "信用卡" && entry.card === cardName) return +entry.amount || 0;
  return (entry.paymentParts || []).filter((part) => part.pay === `信用卡－${cardName}`).reduce((sum, part) => sum + (+part.amount || 0), 0);
}
function cardBillRange(card) {
  let now = new Date(), closeDay = +card.closeDay, statementDay = +card.statementDay;
  if (!(closeDay && statementDay)) return null;
  let generated = new Date(now.getFullYear(), now.getMonth(), statementDay);
  if (now < generated) generated = new Date(now.getFullYear(), now.getMonth() - 1, statementDay);
  let closeMonthOffset = closeDay <= statementDay ? 0 : -1,
    end = new Date(generated.getFullYear(), generated.getMonth() + closeMonthOffset, closeDay),
    previousEnd = new Date(end.getFullYear(), end.getMonth() - 1, closeDay),
    start = new Date(previousEnd.getFullYear(), previousEnd.getMonth(), previousEnd.getDate() + 1);
  return { start: start.toLocaleDateString("sv-SE"), end: end.toLocaleDateString("sv-SE") };
}
function currentCardBillAmount(card) {
  let range = cardBillRange(card), month = td().slice(0, 7);
  return D.e.filter((entry) => range ? entry.date >= range.start && entry.date <= range.end : entry.date?.startsWith(month)).reduce((sum, entry) => sum + cardChargeAmount(entry, card.name), 0);
}
function cardStatementKey(card) { return cardBillRange(card)?.end || ""; }
function isCardStatementPaid(card) { let key = cardStatementKey(card); return !!key && card.paidStatements.includes(key); }
function payCreditCardBill(id) {
  let card = D.cards.find((item) => item.id === id), key = card && cardStatementKey(card), amount = card ? currentCardBillAmount(card) : 0;
  if (!card || !key || !(amount > 0)) return alert("目前沒有可繳納的帳單");
  if (isCardStatementPaid(card)) return alert("這期帳單已完成繳款");
  if (!confirm(`確認「${card.name}」已繳款 ${money(amount)}？`)) return;
  card.paidStatements.push(key);
  D.e.push({ date:td(), item:`${card.name}信用卡繳款`, cat:"信用卡繳款", amount, pay:"現金", card:"", paymentParts:null, proxy:0, recv:0, person:"", rdate:"", isCreditCardPayment:true, creditCardId:card.id, cardStatementKey:key });
  persist();
  if ($("gtitle")?.textContent === "信用卡管理") renderCreditCards();
}
function editCreditCard(id = null) {
  let card = D.cards.find((item) => item.id === id), name = prompt("銀行／信用卡名稱", card?.name || "");
  if (!name?.trim()) return;
  let closeDay = prompt("每月結帳日（1～31）", card?.closeDay || ""), statementDay = prompt("帳單產生日（1～31）", card?.statementDay || ""), dueDay = prompt("繳款截止日（1～31）", card?.dueDay || "");
  if (![closeDay, statementDay, dueDay].every((value) => /^([1-9]|[12]\d|3[01])$/.test(value))) return alert("日期請輸入 1～31");
  let value = { id: card?.id || Date.now(), name: name.trim(), closeDay:+closeDay, statementDay:+statementDay, dueDay:+dueDay, active:true };
  if (card) Object.assign(card, value); else D.cards.push(value);
  persist(); renderCreditCardSelect("ecard"); renderCreditCardSelect("tcard"); renderCreditCards();
}
function renderCreditCards() {
  $("genericList").innerHTML = `<div class="card"><button type="button" onclick="editCreditCard()">＋ 新增信用卡</button></div>${D.cards.map((card) => { let range = cardBillRange(card), amount = currentCardBillAmount(card), paid = isCardStatementPaid(card); return `<div class="card"><div class="top"><div><b>${esc(card.name)}</b><div class="muted">結帳 ${card.closeDay || "未設定"} 日｜帳單產生 ${card.statementDay || "未設定"} 日｜繳款截止 ${card.dueDay || "未設定"} 日</div></div><button type="button" onclick="editCreditCard(${card.id})">修改</button></div><div class="item top"><span>本期帳單金額${range ? `<span class="muted">（${range.start}～${range.end}）</span>` : ""}</span><b>${money(amount)}</b></div>${amount > 0 ? `<button type="button" onclick="payCreditCardBill(${card.id})">${paid ? "已繳款" : "繳款"}</button>` : ""}</div>`; }).join("")}`;
}
function formalPaymentParts(x) {
  return x.pay === "複合" && Array.isArray(x.paymentParts) && x.paymentParts.length
    ? x.paymentParts
    : [{ pay: paymentLabel(x), amount: +x.amount || 0 }];
}
function recentRecord(x) {
  let index = D.e.indexOf(x);
  return `<div class="card recent-quick-row"><div class="recent-main"><button class="recent-title-button" type="button" onclick="editFormalItem(${index})">${esc(x.item || x.cat)}</button><div class="muted">${esc(x.date || "未填日期")}${x.time ? ` ${esc(x.time)}` : ""}</div>${photoRecordButton("formal",index,x)}</div><button class="recent-quick-button" type="button" onclick="editFormalAmount(${index})">${x.draft ? "待補" : money(x.amount)}</button><button class="recent-quick-button" type="button" onclick="editFormalPayment(${index})">${esc(paymentLabel(x))}</button><button class="recent-quick-button recent-delete" type="button" onclick="deleteFormal(${index})">刪除</button></div>`;
}
function renderRecent() {
  $("genericList").innerHTML =
    D.e.slice().reverse().map(recentRecord).join("") ||
    '<div class="card muted">尚無正式支出</div>';
}
function renderSearch(query = "") {
  let q = query.trim().toLocaleLowerCase("zh-TW"),
    results = !q
      ? []
      : D.e.filter((x) =>
          [x.item, x.cat, x.person, x.pay, x.card, x.date, JSON.stringify(x.paymentParts || [])]
            .some((value) => String(value || "").toLocaleLowerCase("zh-TW").includes(q)),
        );
  $("genericList").innerHTML = `<div class="card"><div class="field" style="margin:0"><label for="formalSearch">輸入關鍵字</label><input id="formalSearch" type="search" value="${esc(query)}" placeholder="項目、分類、付款方式、代付對象" oninput="renderSearch(this.value)"></div></div><div id="searchResults">${q ? results.slice().reverse().map(recentRecord).join("") || '<div class="card muted">找不到符合的正式支出</div>' : '<div class="card muted">輸入文字後顯示搜尋結果</div>'}</div>`;
  let input = $("formalSearch");
  if (input) {
    input.focus({ preventScroll: true });
    input.setSelectionRange(input.value.length, input.value.length);
  }
}
function renderCategories() {
  $("genericList").innerHTML = `<div class="card"><div class="field" style="margin-top:0"><label for="newCategory">新增分類</label><input id="newCategory" placeholder="例如：旅遊"></div><button class="primary" type="button" onclick="addCategory()">新增分類</button></div><div class="card"><h2>目前分類</h2>${D.cats.map((cat, index) => `<div class="category-manage-row"><span>${esc(cat)}</span><button class="category-delete" type="button" onclick="deleteCategory(${index})">刪除</button></div>`).join("")}</div>`;
  $("genericList").insertAdjacentHTML("afterbegin", '<div class="card"><button type="button" onclick="generic(\'預繳帳戶\')">預繳帳戶管理</button></div>');
  $("genericList").insertAdjacentHTML("afterbegin", '<div class="card"><button type="button" onclick="generic(\'信用卡管理\')">信用卡管理</button></div>');
}
function addCategory() {
  let input = $("newCategory"),
    name = input.value.trim();
  if (!name) return alert("請輸入分類名稱");
  if (D.cats.includes(name)) return alert("這個分類已存在");
  D.cats.push(name);
  persist();
  generic("分類");
}
function deleteCategory(index) {
  let name = D.cats[index];
  if (D.e.some((entry) => entry.cat === name))
    return alert(`「${name}」已有記帳紀錄，暫時不能刪除`);
  if (!confirm(`確定刪除分類「${name}」？`)) return;
  D.cats.splice(index, 1);
  persist();
  generic("分類");
}
function appearanceSettings() {
  let saved;
  try {
    saved = JSON.parse(localStorage.getItem(APPEARANCE_KEY) || "{}");
  } catch {
    saved = {};
  }
  return {
    font: saved.font || "normal",
    textColor: saved.textColor || "#272438",
    backgroundColor: saved.backgroundColor || "#f5f4fa",
    backgroundStrength: saved.backgroundStrength || {},
  };
}
function applyAppearance() {
  let settings = appearanceSettings();
  delete document.body.dataset.theme;
  document.body.dataset.font = settings.font;
  document.body.style.setProperty("--user-text-color", settings.textColor);
  document.body.style.setProperty("--user-background-color", settings.backgroundColor);
}
function migrateBackgroundStrengthToMaximum() {
  if (localStorage.getItem(BACKGROUND_MAX_MIGRATION_KEY) === "1") return;
  let settings = appearanceSettings();
  settings.backgroundStrength = {};
  localStorage.setItem(APPEARANCE_KEY, JSON.stringify(settings));
  localStorage.setItem(BACKGROUND_MAX_MIGRATION_KEY, "1");
}
function setBackgroundPreference(type, value) {
  let settings = appearanceSettings();
  settings[type] = value;
  localStorage.setItem(APPEARANCE_KEY, JSON.stringify(settings));
  applyAppearance();
  applyBackgrounds().catch(() => {});
  renderBackgroundSettings();
}
function backgroundOverlayColor(key) {
  let hex = appearanceSettings().textColor.replace("#", ""),
    red = parseInt(hex.slice(0, 2), 16) || 0,
    green = parseInt(hex.slice(2, 4), 16) || 0,
    blue = parseInt(hex.slice(4, 6), 16) || 0,
    luminance = (red * 299 + green * 587 + blue * 114) / 255000,
    strength = appearanceSettings().backgroundStrength[key] ?? 100,
    overlay = Math.max(0, Math.min(0.8, 1 - strength / 100));
  return luminance > 0.58
    ? `rgba(0,0,0,${overlay})`
    : `rgba(255,255,255,${overlay})`;
}
function backgroundDb() {
  return new Promise((resolve, reject) => {
    let request = indexedDB.open(BACKGROUND_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("images");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function backgroundGet(key) {
  let db = await backgroundDb();
  return new Promise((resolve, reject) => {
    let request = db.transaction("images").objectStore("images").get(key);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}
async function backgroundPut(key, blob) {
  let db = await backgroundDb();
  return new Promise((resolve, reject) => {
    let transaction = db.transaction("images", "readwrite");
    transaction.objectStore("images").put(blob, key);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
}
async function backgroundRemove(key) {
  let db = await backgroundDb();
  return new Promise((resolve, reject) => {
    let transaction = db.transaction("images", "readwrite");
    transaction.objectStore("images").delete(key);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
}
async function applyBackgrounds() {
  if (!("indexedDB" in window)) return;
  await Promise.all(BACKGROUND_TARGETS.map(async (target) => {
    let element = $(target.element), blob = await backgroundGet(target.key);
    if (backgroundUrls[target.key]) URL.revokeObjectURL(backgroundUrls[target.key]);
    if (!blob) {
      delete backgroundUrls[target.key];
      if (element) {
        element.style.backgroundImage = "";
        element.classList.remove("custom-bg-active");
      }
      return;
    }
    let url = URL.createObjectURL(blob);
    backgroundUrls[target.key] = url;
    refreshBackgroundStyle(target.key);
    if (element) element.classList.add("custom-bg-active");
  }));
  updateHomeBackgroundVisibility();
  applyPageBackgrounds();
}
function updateHomeBackgroundVisibility() {
  let homeHasImage = !!backgroundUrls.home;
  BACKGROUND_TARGETS.filter((target) => target.element && target.key !== "home").forEach((target) => {
    let element = $(target.element), hasOwnImage = !!backgroundUrls[target.key];
    element.style.backgroundColor = homeHasImage && !hasOwnImage ? "transparent" : "";
  });
  if ($("prepaidHomeCard")) $("prepaidHomeCard").style.backgroundColor = homeHasImage ? "transparent" : "";
}
function refreshBackgroundStyle(key) {
  let target = BACKGROUND_TARGETS.find((item) => item.key === key),
    url = backgroundUrls[key];
  if (!target || !url) return;
  let overlay = backgroundOverlayColor(key);
  if (target.element) $(target.element).style.backgroundImage = `linear-gradient(${overlay}, ${overlay}), url("${url}")`;
  else applyPageBackgrounds();
}
function setPageBackground(elementId, preferredKey) {
  let element = $(elementId), key = backgroundUrls[preferredKey] ? preferredKey : "home", url = backgroundUrls[key];
  if (!element) return;
  element.classList.toggle("page-bg-active", !!url);
  element.style.backgroundImage = url
    ? `linear-gradient(${backgroundOverlayColor(key)}, ${backgroundOverlayColor(key)}), url("${url}")`
    : "";
}
function applyPageBackgrounds() {
  setPageBackground("temp", "tempPage");
  setPageBackground("detail", "home");
  let title = $("gtitle")?.textContent;
  setPageBackground("generic", title === "最近" ? "recent" : title === "搜尋" ? "search" : "home");
}
function setBackgroundStrength(key, value) {
  let settings = appearanceSettings(), strength = Math.max(20, Math.min(100, +value));
  settings.backgroundStrength[key] = strength;
  localStorage.setItem(APPEARANCE_KEY, JSON.stringify(settings));
  let label = $(`backgroundStrengthLabel-${key}`);
  if (label) label.textContent = `${strength}%`;
  refreshBackgroundStyle(key);
}
function renderBackgroundSettings() {
  let settings = appearanceSettings();
  $("genericList").innerHTML = `<div class="card appearance-section"><h2>字體設定</h2><div class="field"><label>字體大小</label><div class="appearance-options"><button class="appearance-choice${settings.font === "normal" ? " selected" : ""}" type="button" onclick="setBackgroundPreference('font','normal')">標準</button><button class="appearance-choice${settings.font === "large" ? " selected" : ""}" type="button" onclick="setBackgroundPreference('font','large')">放大</button></div></div><div class="color-setting-row"><label for="backgroundTextColor">字體顏色</label><input id="backgroundTextColor" type="color" value="${esc(settings.textColor)}" onchange="setBackgroundPreference('textColor',this.value)"></div><div class="color-setting-row"><label for="backgroundDefaultColor">未設定圖片的預設背景顏色</label><input id="backgroundDefaultColor" type="color" value="${esc(settings.backgroundColor)}" onchange="setBackgroundPreference('backgroundColor',this.value)"></div></div><div class="card"><div class="notice" style="margin:0 0 8px">每個區域可使用不同相片。選擇後可拖曳、放大、縮小及裁剪；圖片只儲存在目前裝置。</div>${BACKGROUND_TARGETS.map((target) => { let strength = settings.backgroundStrength[target.key] ?? 100; return `<div class="background-setting-row"><div class="background-setting-head"><div><b>${esc(target.name)}</b><div id="backgroundStatus-${target.key}" class="muted">讀取中</div></div><div class="background-setting-actions"><button class="background-small-button" type="button" onclick="chooseBackground('${target.key}')">選擇相片</button><button class="background-small-button background-remove" type="button" onclick="removeBackground('${target.key}')">移除</button></div></div><div class="background-strength"><label for="backgroundStrength-${target.key}">圖片顯示濃度 <span id="backgroundStrengthLabel-${target.key}">${strength}%</span></label><input id="backgroundStrength-${target.key}" type="range" min="20" max="100" step="5" value="${strength}" oninput="setBackgroundStrength('${target.key}',this.value)"></div></div>`; }).join("")}</div><button class="secondary" type="button" onclick="resetAllBackgroundSettings()">全部恢復預設</button>`;
  if (!("indexedDB" in window)) return alert("此瀏覽器不支援儲存背景圖片");
  BACKGROUND_TARGETS.forEach(async (target) => {
    let blob = await backgroundGet(target.key), status = $(`backgroundStatus-${target.key}`);
    if (status) status.textContent = blob ? "已設定，可重新選擇" : target.key === "home" ? "尚未設定" : "沿用首頁背景";
  });
}
function chooseBackground(key) {
  let target = BACKGROUND_TARGETS.find((item) => item.key === key);
  if (!target) return;
  cropState = { target };
  $("backgroundFile").value = "";
  $("backgroundFile").click();
}
function loadBackgroundFile(event) {
  let file = event.target.files?.[0];
  if (!file || !cropState) return;
  if (!file.type.startsWith("image/")) return alert("請選擇圖片檔案");
  let image = new Image(), url = URL.createObjectURL(file);
  image.onload = () => {
    URL.revokeObjectURL(url);
    let canvas = $("backgroundCanvas"), homeShape = cropState.target.shape === "home";
    canvas.width = 720;
    canvas.height = homeShape ? 1200 : 320;
    cropState.image = image;
    cropState.baseScale = Math.max(canvas.width / image.width, canvas.height / image.height);
    cropState.zoom = 1;
    cropState.x = (canvas.width - image.width * cropState.baseScale) / 2;
    cropState.y = (canvas.height - image.height * cropState.baseScale) / 2;
    $("backgroundZoom").value = "1";
    $("backgroundCropTitle").textContent = `裁剪－${cropState.target.name}`;
    setupBackgroundDrag();
    drawBackgroundCrop();
    openM("backgroundM");
  };
  image.onerror = () => {
    URL.revokeObjectURL(url);
    alert("無法讀取這張圖片，請改選其他圖片");
  };
  image.src = url;
}
function clampBackgroundCrop() {
  if (!cropState?.image) return;
  let canvas = $("backgroundCanvas"), scale = cropState.baseScale * cropState.zoom,
    width = cropState.image.width * scale, height = cropState.image.height * scale;
  cropState.x = Math.min(0, Math.max(canvas.width - width, cropState.x));
  cropState.y = Math.min(0, Math.max(canvas.height - height, cropState.y));
}
function drawBackgroundCrop() {
  if (!cropState?.image) return;
  clampBackgroundCrop();
  let canvas = $("backgroundCanvas"), context = canvas.getContext("2d"),
    scale = cropState.baseScale * cropState.zoom;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(cropState.image, cropState.x, cropState.y,
    cropState.image.width * scale, cropState.image.height * scale);
}
function changeBackgroundZoom(value) {
  if (!cropState?.image) return;
  let oldScale = cropState.baseScale * cropState.zoom,
    nextZoom = +value,
    nextScale = cropState.baseScale * nextZoom;
  cropState.x -= cropState.image.width * (nextScale - oldScale) / 2;
  cropState.y -= cropState.image.height * (nextScale - oldScale) / 2;
  cropState.zoom = nextZoom;
  drawBackgroundCrop();
}
function setupBackgroundDrag() {
  let canvas = $("backgroundCanvas");
  canvas.onpointerdown = (event) => {
    if (!cropState?.image) return;
    cropState.drag = { x: event.clientX, y: event.clientY, imageX: cropState.x, imageY: cropState.y };
    canvas.setPointerCapture(event.pointerId);
  };
  canvas.onpointermove = (event) => {
    if (!cropState?.drag) return;
    let ratio = canvas.width / canvas.getBoundingClientRect().width;
    cropState.x = cropState.drag.imageX + (event.clientX - cropState.drag.x) * ratio;
    cropState.y = cropState.drag.imageY + (event.clientY - cropState.drag.y) * ratio;
    drawBackgroundCrop();
  };
  canvas.onpointerup = canvas.onpointercancel = () => {
    if (cropState) cropState.drag = null;
  };
}
function cancelBackgroundCrop() {
  closeM("backgroundM");
  cropState = null;
}
function saveBackgroundCrop() {
  if (!cropState?.image) return;
  let key = cropState.target.key, canvas = $("backgroundCanvas");
  canvas.toBlob(async (blob) => {
    if (!blob) return alert("背景圖片處理失敗，請再試一次");
    try {
      await backgroundPut(key, blob);
      closeM("backgroundM");
      cropState = null;
      await applyBackgrounds();
      renderBackgroundSettings();
    } catch {
      alert("背景圖片儲存失敗，請確認瀏覽器允許網站儲存資料");
    }
  }, "image/jpeg", 0.82);
}
async function removeBackground(key) {
  let target = BACKGROUND_TARGETS.find((item) => item.key === key);
  if (!target || !confirm(`確定移除「${target.name}」背景圖片？`)) return;
  await backgroundRemove(key);
  await applyBackgrounds();
  renderBackgroundSettings();
}
async function resetAllBackgroundSettings() {
  if (!confirm("確定移除全部背景圖片，並恢復預設字體與顏色？")) return;
  await Promise.all(BACKGROUND_TARGETS.map((target) => backgroundRemove(target.key)));
  localStorage.setItem(APPEARANCE_KEY, JSON.stringify({
    font: "normal",
    textColor: "#272438",
    backgroundColor: "#f5f4fa",
    backgroundStrength: {},
  }));
  applyAppearance();
  await applyBackgrounds();
  renderBackgroundSettings();
}
function openMonthlyAnalysis() {
  show("generic");
  $("gtitle").textContent = "本月分析";
  $("gtext").textContent = "依本月正式記帳紀錄統計分類、付款方式與消費明細。";
  let month = td().slice(0, 7),
    entries = D.e.filter((entry) => entry.date?.startsWith(month)),
    analysisEntries = entries.filter((entry) => !entry.isCreditCardPayment),
    total = analysisEntries.reduce((sum, entry) => sum + entry.amount - (entry.proxy || 0), 0),
    average = analysisEntries.length ? total / analysisEntries.length : 0,
    categories = {},
    payments = {};
  analysisEntries.forEach((entry) => {
    let net = entry.amount - (entry.proxy || 0),
      category = entry.cat || "未分類";
    categories[category] = (categories[category] || 0) + net;
    formalPaymentParts(entry).forEach((part) => {
      payments[part.pay] = (payments[part.pay] || 0) + (+part.amount || 0);
    });
  });
  let categoryRows = Object.entries(categories)
      .sort((a, b) => b[1] - a[1])
      .map(([name, amount]) => `<div class="item top"><span>${esc(name)}</span><b>${money(amount)}</b></div>`)
      .join("") || '<div class="muted">本月尚無分類資料</div>',
    paymentRows = Object.entries(payments)
      .sort((a, b) => b[1] - a[1])
      .map(([name, amount]) => `<div class="item top"><span>${esc(name)}</span><b>${money(amount)}</b></div>`)
      .join("") || '<div class="muted">本月尚無付款資料</div>',
    detailRows = entries.slice().reverse().map((entry) =>
      `<div class="item top"><div><b>${esc(entry.item || entry.cat)}</b><div class="muted">${esc(entry.date)}｜${esc(entry.cat || "未分類")}｜${esc(paymentLabel(entry))}</div></div><b>${money(entry.amount)}</b></div>`,
    ).join("") || '<div class="muted">本月尚無正式記帳紀錄</div>';
  $("genericList").innerHTML = `<div class="card"><div class="analysis-summary"><div class="analysis-stat"><span class="muted">本月記帳筆數</span><div class="val">${analysisEntries.length} 筆</div></div><div class="analysis-stat"><span class="muted">平均每筆消費</span><div class="val">${money(average)}</div></div><div class="analysis-stat"><span class="muted">本月總消費</span><div class="val">${money(total)}</div></div><div class="analysis-stat"><span class="muted">最高分類</span><div class="val">${esc(Object.entries(categories).sort((a, b) => b[1] - a[1])[0]?.[0] || "尚無")}</div></div></div></div><div class="card"><h2>分類分析</h2>${categoryRows}</div><div class="card"><h2>付款方式分析</h2>${paymentRows}</div><div class="card"><h2>本月記帳明細</h2>${detailRows}</div>`;
  applyPageBackgrounds();
}
function generic(t) {
  show("generic");
  $("gtitle").textContent = t;
  $("gtext").textContent =
    t === "搜尋"
      ? "搜尋正式支出、備註與代付對象。"
      : t === "分類"
        ? "正式帳本分類與項目管理。"
        : t === "背景"
          ? "設定首頁背景、區塊背景、字體大小與顏色。"
          : t === "預繳帳戶"
            ? "管理預繳、加值、扣款與目前餘額。"
          : t === "信用卡管理"
            ? "管理信用卡結帳日、帳單產生日、繳款截止日與本期金額。"
          : "最近正式記帳紀錄。";
  if (t === "最近") renderRecent();
  else if (t === "搜尋") renderSearch();
  else if (t === "分類") renderCategories();
  else if (t === "背景") renderBackgroundSettings();
  else if (t === "預繳帳戶") renderPrepaidAccounts();
  else if (t === "信用卡管理") renderCreditCards();
  applyPageBackgrounds();
}
function openExpense() {
  openM("expenseM");
  resetPhotoPicker("formal");
  setCurrentDateTime("edate", "etime");
  $("ecat").innerHTML = D.cats.map((x) => `<option>${x}</option>`).join("");
  renderLocations();
  $("eitem").value = $("eamt").value = $("emixamt1").value = $("emixamt2").value = "";
  $("emixpay1").value = "現金";
  $("emixpay2").value = "貨到付款";
  cardToggle();
  renderPrepaidSelect("eprepaid");
  renderCreditCardSelect("ecard");
  renderMixedPaymentSelect("emixpay1", "現金");
  renderMixedPaymentSelect("emixpay2", "貨到付款");
}
const MEMBER_GROUPS_KEY = "ledger-member-groups";
function memberGroups() {
  return JSON.parse(localStorage.getItem(MEMBER_GROUPS_KEY) || "[]");
}
function renderMemberGroups() {
  let groups = memberGroups();
  $("memberGroupOptions").replaceChildren(...groups.map((group) => {
    let option = new Option(group.members.join(", "));
    option.label = group.name;
    return option;
  }));
}
function openBookModal() {
  renderMemberGroups();
  renderLocations();
  openM("bookM");
}
function saveMemberGroup() {
  let members = $("bmembers")
    .value.split(/[,，]/)
    .map((x) => x.trim())
    .filter(Boolean);
  if (!members.includes("我")) members.unshift("我");
  if (members.length < 2) return alert("請先輸入至少 2 位成員");
  let name = prompt("請輸入組合名稱，例如：家人、聚餐群");
  if (!name?.trim()) return;
  let groups = memberGroups(),
    existing = groups.findIndex((group) => group.name === name.trim()),
    value = { name: name.trim(), members };
  if (existing >= 0) groups[existing] = value;
  else groups.push(value);
  localStorage.setItem(MEMBER_GROUPS_KEY, JSON.stringify(groups));
  renderMemberGroups();
  alert("常用成員組合已儲存");
}
function deleteMemberGroup() {
  let members = $("bmembers").value.split(/[,，]/).map((x) => x.trim()).filter(Boolean),
    groups = memberGroups(),
    index = groups.findIndex((group) => group.members.join("|") === members.join("|"));
  if (index < 0) return alert("目前成員不在常用清單中");
  let name = groups[index].name;
  if (!confirm(`確定刪除常用組合「${name}」？`)) return;
  groups.splice(index, 1);
  localStorage.setItem(MEMBER_GROUPS_KEY, JSON.stringify(groups));
  renderMemberGroups();
}
const LOCATIONS_KEY = "ledger-common-locations";
function commonLocations() {
  return JSON.parse(localStorage.getItem(LOCATIONS_KEY) || "[]");
}
function renderLocations(selectId) {
  let list = $("locationOptions");
  if (list) list.replaceChildren(...commonLocations().map((location) => new Option(location)));
}
function refreshLocations() {
  renderLocations();
}
function saveLocation(inputId) {
  let location = $(inputId).value.trim();
  if (!location) return alert("請先輸入地點");
  let locations = commonLocations(),
    index = locations.indexOf(location),
    added = index < 0;
  if (index < 0) {
    locations.push(location);
    index = locations.length - 1;
    localStorage.setItem(LOCATIONS_KEY, JSON.stringify(locations));
  }
  refreshLocations();
  alert(added ? "常用地點已儲存" : "這個地點已在常用清單中");
}
function deleteLocation(inputId) {
  let location = $(inputId).value.trim(), locations = commonLocations(), index = locations.indexOf(location);
  if (index < 0) return alert("目前地點不在常用清單中");
  if (!confirm(`確定刪除常用地點「${location}」？`)) return;
  locations.splice(index, 1);
  localStorage.setItem(LOCATIONS_KEY, JSON.stringify(locations));
  refreshLocations();
}
function openLocationMap(inputId) {
  let location = $(inputId).value.trim();
  if (!location) return alert("請先輸入或選擇地點");
  let url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`,
    mapWindow = window.open(url, "_blank");
  if (mapWindow) mapWindow.opener = null;
  else alert("地圖被瀏覽器阻擋，請允許此網站開啟新視窗後再試一次。");
}
function cardToggle() {
  let payment = $("epay").value;
  $("epaygroup").classList.toggle("has-bank", payment === "信用卡");
  $("ecardbox").classList.toggle("hide", payment !== "信用卡");
  $("emixedbox").classList.toggle("hide", payment !== "複合");
  $("eprepaidbox").classList.toggle("hide", payment !== "預繳帳戶");
  if (payment === "預繳帳戶") renderPrepaidSelect("eprepaid");
}
function proxyToggle() {
  $("proxybox").classList.toggle("hide", !$("proxy").checked);
}
function personToggle() {
  $("otherbox").classList.toggle("hide", $("person").value !== "_");
}
async function saveExpense() {
  let a = +$("eamt").value;
  let isDraft = !(a > 0);
  if (isDraft && !pendingPhotos.formal.length) return alert("請輸入金額，或先加入照片以建立待補記帳");
  let paymentParts = null;
  let prepaidAccount = null;
  if (!isDraft && $("epay").value === "複合") {
    let amount1 = +$("emixamt1").value, amount2 = +$("emixamt2").value;
    if (!(amount1 > 0 && amount2 > 0)) return alert("請輸入兩種付款方式的金額");
    if (Math.abs(amount1 + amount2 - a) > 0.01) return alert("複合付款金額合計必須等於總金額");
    paymentParts = [
      { pay: $("emixpay1").value, amount: amount1 },
      { pay: $("emixpay2").value, amount: amount2 },
    ];
  }
  if (!isDraft && $("epay").value === "預繳帳戶") {
    prepaidAccount = D.prepaid.find((account) => String(account.id) === $("eprepaid").value && account.active !== false);
    if (!prepaidAccount) return alert("請選擇預繳帳戶");
    if (prepaidAccount.balance < a) return alert(`預繳餘額不足，尚差 ${money(a - prepaidAccount.balance)}`);
  }
  let recordId = recordUid("formal"), photoIds;
  try { photoIds = await savePendingPhotos("formal", recordId); }
  catch { return alert("照片儲存失敗，請確認瀏覽器儲存空間後再試一次"); }
  if (prepaidAccount) {
    prepaidAccount.balance -= a;
    prepaidAccount.transactions.push({ date: $("edate").value, type: "spend", amount: -a, note: $("eitem").value || $("ecat").value });
  }
  let p = $("proxy").checked ? +$("pamt").value : 0;
  D.e.push({
    id: recordId,
    draft: isDraft,
    date: $("edate").value,
    time: $("etime").value,
    item: $("eitem").value || (isDraft ? "待補記帳" : ""),
    cat: $("ecat").value,
    amount: a,
    pay: isDraft ? "未設定" : $("epay").value,
    card: isDraft ? "" : $("ecard").value,
    paymentParts,
    prepaidAccountId: prepaidAccount?.id || null,
    prepaidAccountName: prepaidAccount?.name || "",
    proxy: p,
    recv: +$("recv").value || 0,
    person: $("person").value === "_" ? $("other").value : $("person").value,
    rdate: $("rdate").value,
    photoIds,
  });
  resetPhotoPicker("formal");
  closeM("expenseM");
  persist();
}
function daysFromToday(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return null;
  let [year, month, day] = date.split("-").map(Number),
    today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((new Date(year, month - 1, day) - today) / 86400000);
}
function renderCalendarUpcoming() {
  let events = [
    ...D.e.filter((entry) => entry.calendarSync).map((entry) => ({
      date: entry.date,
      title: entry.item || entry.cat,
      time: entry.time || "",
      type: "正式支出",
    })),
    ...D.b.filter((book) => book.calendarSync).map((book) => ({
      date: book.start,
      title: book.name,
      time: book.startTime || "",
      type: "臨時帳本",
    })),
  ].map((event) => ({ ...event, days: daysFromToday(event.date) }))
    .filter((event) => event.days !== null && event.days >= 0 && event.days <= 14)
    .sort((a, b) => a.days - b.days || a.title.localeCompare(b.title, "zh-TW"));
  $("calendarCard").hidden = events.length === 0;
  $("calendarUpcoming").innerHTML = events.length
    ? `<div class="item"><b>未來 14 天行程提醒</b></div>${events.map((event) => {
        let countdown = event.days === 0 ? "今天" : event.days === 1 ? "明天" : `還有 ${event.days} 天`;
        return `<div class="item"><b>📅 ${esc(event.title)}</b><div class="muted">${esc(event.date)}${event.time ? ` ${esc(event.time)}` : ""}｜${countdown}｜${event.type}</div></div>`;
      }).join("")}`
    : "未來 14 天沒有已加入的行程";
}
function home() {
  $("month").textContent = new Date().toLocaleDateString("zh-TW", {
    year: "numeric",
    month: "2-digit",
  });
  let m = td().slice(0, 7),
    E = D.e.filter((x) => x.date?.startsWith(m)),
    prepaidTopups = D.prepaid.flatMap((account) => account.transactions || []).filter((tx) => tx.type === "topup" && tx.date?.startsWith(m)).reduce((sum, tx) => sum + (+tx.amount || 0), 0),
    paid = E.flatMap(formalPaymentParts).filter((x) => x.pay === "現金").reduce((s, x) => s + (+x.amount || 0), 0) + prepaidTopups,
    allCreditCharges = D.e.reduce((sum, entry) => sum + D.cards.reduce((cardSum, card) => cardSum + cardChargeAmount(entry, card.name), 0), 0),
    allCreditPayments = D.e.filter((entry) => entry.isCreditCardPayment).reduce((sum, entry) => sum + (+entry.amount || 0), 0),
    codPending = E.flatMap(formalPaymentParts).filter((x) => x.pay === "貨到付款").reduce((s, x) => s + (+x.amount || 0), 0),
    pend = Math.max(0, allCreditCharges - allCreditPayments) + codPending,
    con = E.filter((entry) => !entry.isCreditCardPayment).reduce((s, x) => s + x.amount - (x.proxy || 0), 0);
  $("paid").textContent = money(paid);
  $("pending").textContent = money(pend);
  $("cash").textContent = money(pend);
  $("consume").textContent = money(con);
  $("prepaidHomeCard").hidden = D.prepaid.length === 0;
  $("prepaidHome").innerHTML = D.prepaid.filter((account) => account.active !== false || account.balance > 0).map((account) => `<div class="item top"><span>${esc(account.name)}</span><b>${money(account.balance)}</b></div>`).join("");
  let r = D.e
    .filter((x) => (x.proxy || 0) > (x.recv || 0))
    .map(
      (x) =>
        `<div class="item"><b>💰 ${x.item || x.cat}－待收款</b><div class="muted">${x.person}｜${money(x.proxy - x.recv)} ${x.rdate ? "｜" + x.rdate : ""}</div></div>`,
    );
  D.cards.forEach((card) => {
    if (!card.dueDay) return;
    let now = new Date(), lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate(), due = new Date(now.getFullYear(), now.getMonth(), Math.min(+card.dueDay, lastDay));
    if (due < new Date(now.getFullYear(), now.getMonth(), now.getDate())) {
      let nextLastDay = new Date(now.getFullYear(), now.getMonth() + 2, 0).getDate();
      due = new Date(now.getFullYear(), now.getMonth() + 1, Math.min(+card.dueDay, nextLastDay));
    }
    let date = due.toLocaleDateString("sv-SE"), days = daysFromToday(date), amount = currentCardBillAmount(card);
    if (days !== null && days <= 5 && amount > 0 && !isCardStatementPaid(card)) r.push(`<div class="item"><div class="top"><div><b>💳 繳款提醒－${esc(card.name)}</b><div class="muted">${date}｜${money(amount)}｜還有 ${days} 天</div></div><button type="button" onclick="payCreditCardBill(${card.id})">繳款</button></div></div>`);
  });
  $("remindersCard").hidden = r.length === 0;
  $("reminders").innerHTML = r.join("") || "目前沒有提醒";
  renderCalendarUpcoming();
  let activeBooks = D.b.filter((book) => !book.imported);
  $("tempHomeCard").hidden = activeBooks.length === 0;
  $("tempHome").innerHTML = activeBooks.length
    ? activeBooks
        .map(
          (book) =>
            `<div class="temp-home-row"><div class="temp-home-info"><b>${book.name}</b><div class="muted">${book.start}～${book.end}｜${book.members.length}人｜使用中</div></div><button class="temp-quick-add" type="button" aria-label="新增${book.name}支出" onclick="quickAddToBook(${book.id})">＋</button></div>`,
        )
        .join("")
    : "";
}
function saveBook() {
  let ms = $("bmembers")
    .value.split(/[,，]/)
    .map((x) => x.trim())
    .filter(Boolean);
  if (!ms.includes("我")) ms.unshift("我");
  if (!$("bname").value || ms.length < 2)
    return alert("請輸入名稱與至少2位成員");
  D.b.push({
    id: Date.now(),
    name: $("bname").value,
    start: $("bstart").value,
    end: $("bend").value,
    members: ms,
    entries: [],
    imported: false,
  });
  closeM("bookM");
  persist();
  books();
}
function books() {
  let activeBooks = D.b.filter((book) => !book.imported);
  $("activeBooksTitle").hidden = activeBooks.length === 0;
  $("books").innerHTML =
    activeBooks
      .map(
        (b) =>
          `<div class="card" onclick="openBook(${b.id})"><div class="top"><b>${b.name}</b><span class="badge">使用中</span></div><div class="muted">${b.start}～${b.end}｜${b.members.length} 人</div></div>`,
      )
      .join("") || '<div class="card muted">目前沒有使用中的臨時帳本</div>';
}
function openBook(id) {
  B = D.b.find((x) => x.id === id);
  show("detail");
  $("bookTitle").textContent = B.name;
  $("bookMeta").textContent =
    `${B.start}～${B.end}｜成員 ${B.members.length} 人`;
  detail();
}
function quickAddToBook(id) {
  B = D.b.find((book) => book.id === id && !book.imported);
  if (!B) return alert("找不到使用中的臨時帳本");
  openTempEntry();
}
function detail() {
  $("bookTotal").textContent = money(
    B.entries.reduce((s, x) => s + x.amount, 0),
  );
  $("detailBody").innerHTML =
    B.entries
      .map(
        (x, i) =>
          `<div class="card"><div class="top"><b>${x.item}</b><b>${x.draft ? "待補" : money(x.amount)}</b></div><div class="muted">${x.date}${x.time ? ` ${x.time}` : ""}｜${x.payer}支付${x.payer === "我" ? "（" + tempPaymentLabel(x) + "）" : ""}｜${x.shares.length}人分攤</div><div class="row" style="margin-top:9px">${photoRecordButton("temp",i,x)}<button class="secondary" onclick="editTempEntry(${i})">編輯</button><button class="secondary" onclick="deleteTempEntry(${i})">刪除</button></div></div>`,
      )
      .join("") || '<div class="card muted">尚無支出</div>';
}
function tempPaymentLabel(x) {
  return x.pay === "信用卡" && x.card ? `信用卡－${x.card}` : x.pay || "現金";
}
function tempPaymentParts(x) {
  if (x.pay === "複合式" && x.paymentParts && !Array.isArray(x.paymentParts)) {
    let parts = [];
    if (x.paymentParts.cash) parts.push({ pay: "現金", amount: x.paymentParts.cash });
    if (x.paymentParts.card) parts.push({ pay: "信用卡", amount: x.paymentParts.card });
    if (x.paymentParts.unpaid) parts.push({ pay: "貨到付款", amount: x.paymentParts.unpaid });
    return parts;
  }
  return x.pay === "複合" && Array.isArray(x.paymentParts)
    ? x.paymentParts
    : [{ pay: tempPaymentLabel(x), amount: +x.amount || 0 }];
}
function openTempEntry() {
  openM("entryM");
  resetPhotoPicker("temp");
  setCurrentDateTime("tdate", "ttime");
  $("titem").value = "";
  $("tamt").value = "";
  $("tmixamt1").value = $("tmixamt2").value = "";
  $("tmixpay1").value = "現金";
  $("tmixpay2").value = "貨到付款";
  renderCreditCardSelect("tcard");
  renderMixedPaymentSelect("tmixpay1", "現金");
  renderMixedPaymentSelect("tmixpay2", "貨到付款");
  $("payer").innerHTML = B.members.map((x) => `<option>${x}</option>`).join("");
  let previousPayer = B.entries.at(-1)?.payer;
  if (previousPayer && B.members.includes(previousPayer))
    $("payer").value = previousPayer;
  $("shares").innerHTML = B.members
    .map(
      (x) =>
        `<label class="check"><input class="sc" type="checkbox" value="${x}" checked onchange="shareChanged()"> ${x}</label>`,
    )
    .join("");
  payerToggle();
  customShares();
}
function payerToggle() {
  let isMe = $("payer").value === "我";
  $("mypay").classList.toggle("hide", !isMe);
  if (isMe) tempPaymentToggle();
  else {
    $("tcardbox").classList.add("hide");
    $("tmixed").classList.add("hide");
  }
}
function tempPaymentToggle() {
  let pay = $("tpay").value;
  $("mypay").classList.toggle("has-bank", pay === "信用卡");
  $("tcardbox").classList.toggle("hide", pay !== "信用卡");
  $("tmixed").classList.toggle("hide", pay !== "複合");
}
function selected() {
  return [...document.querySelectorAll(".sc:checked")].map((x) => x.value);
}
function clearAllShares() {
  document.querySelectorAll(".sc").forEach((x) => (x.checked = false));
  customShares();
}
function shareChanged() {
  customShares();
}
function customShares() {
  $("custom").innerHTML =
    $("mode").value === "custom"
      ? selected()
          .map(
            (x) =>
              `<div class="field"><label>${x} 應負擔</label><input class="ca" data-p="${x}" type="number"></div>`,
          )
          .join("")
      : "";
}
async function saveEntry() {
  let a = +$("tamt").value,
    ms = selected();
  let isDraft = !(a > 0);
  if (!ms.length) return alert("請選擇分攤成員");
  if (isDraft && !pendingPhotos.temp.length) return alert("請輸入金額，或先加入照片以建立待補記帳");
  let sh =
    $("mode").value === "equal"
      ? ms.map((p) => ({ p, a: a / ms.length }))
      : [...document.querySelectorAll(".ca")].map((x) => ({
          p: x.dataset.p,
          a: +x.value,
        }));
  if (Math.abs(sh.reduce((s, x) => s + x.a, 0) - a) > 0.01)
    return alert("分攤加總需等於總金額");
  let payer = $("payer").value;
  let pay = payer === "我" ? $("tpay").value : "現金",
    card = payer === "我" && pay === "信用卡" ? $("tcard").value : "",
    paymentParts = null;
  if (!isDraft && payer === "我" && pay === "複合") {
    let amount1 = +$("tmixamt1").value, amount2 = +$("tmixamt2").value;
    if (!(amount1 > 0 && amount2 > 0)) return alert("請輸入兩種付款方式的金額");
    if (Math.abs(amount1 + amount2 - a) > 0.01)
      return alert("複合付款金額合計必須等於總金額");
    paymentParts = [
      { pay: $("tmixpay1").value, amount: amount1 },
      { pay: $("tmixpay2").value, amount: amount2 },
    ];
  }
  let recordId = recordUid("temp"), photoIds;
  try { photoIds = await savePendingPhotos("temp", recordId); }
  catch { return alert("照片儲存失敗，請確認瀏覽器儲存空間後再試一次"); }
  B.entries.push({
    id: recordId,
    draft: isDraft,
    date: $("tdate").value,
    time: $("ttime").value,
    item: $("titem").value || (isDraft ? "待補記帳" : "未命名"),
    amount: a,
    payer,
    pay,
    card,
    paymentParts,
    shares: sh,
    photoIds,
  });
  resetPhotoPicker("temp");
  closeM("entryM");
  persist();
  detail();
}
function bal() {
  let p = {},
    o = {};
  B.members.forEach((x) => (p[x] = o[x] = 0));
  B.entries.forEach((x) => {
    p[x.payer] += x.amount;
    x.shares.forEach((y) => (o[y.p] += y.a));
  });
  return B.members.map((x) => ({
    p: x,
    paid: p[x],
    owed: o[x],
    net: p[x] - o[x],
  }));
}
function settle() {
  let bs = bal();
  $("detailBody").innerHTML =
    `<div class="card"><h2>成員結算</h2>${bs.map((x) => `<div class="item top"><div><b>${x.p}</b><div class="muted">已付 ${money(x.paid)}｜應負擔 ${money(x.owed)}</div></div><b class="${x.net >= 0 ? "red" : "green"}">${x.net >= 0 ? "應收" : "應付"} ${money(Math.abs(x.net))}</b></div>`).join("")}</div><button class="primary" onclick="preview()">匯入正式帳本</button><div class="notice">其他人的付款方式預設現金，不需選擇；只有我的付款方式會帶入正式帳本。</div>`;
}
function overview() {
  $("detailBody").innerHTML =
    `<div class="card"><h2>總覽</h2><div class="val">${money(B.entries.reduce((s, x) => s + x.amount, 0))}</div><div class="muted">此金額不列入正式帳本</div></div><button class="primary" onclick="preview()">匯入正式帳本</button>`;
}
function preview() {
  if (B.imported) return alert("此帳本已匯入過");
  let g = {},
    me = bal().find((x) => x.p === "我");
  B.entries.filter((x) => x.payer === "我").forEach((x) =>
    tempPaymentParts(x).forEach((part) =>
      g[part.pay] = (g[part.pay] || 0) + (+part.amount || 0),
    ),
  );
  $("preview").innerHTML = `<div class="card">${Object.entries(g)
    .map(
      ([k, v]) =>
        `<div class="item top"><span>${k}</span><b>${money(v)}</b></div>`,
    )
    .join(
      "",
    )}<div class="item top"><span>我的最終負擔</span><b>${money(me.owed)}</b></div><div class="item top"><span>${me.net >= 0 ? "朋友應還我" : "我應付朋友"}</span><b>${money(Math.abs(me.net))}</b></div></div>`;
  openM("importM");
}
function doImport() {
  if (B.imported) return;
  let me = bal().find((x) => x.p === "我"),
    mine = B.entries.filter((x) => x.payer === "我"),
    paid = mine.reduce((s, x) => s + x.amount, 0),
    ratio = paid ? Math.min(1, me.owed / paid) : 0;
  mine.forEach((x) => {
    let oldCard = x.pay?.startsWith("信用卡－"),
      oldMixed = x.pay === "複合式",
      importedParts = oldMixed ? tempPaymentParts(x) : x.paymentParts || null;
    D.e.push({
      id: recordUid("formal-import"),
      date: x.date,
      time: x.time || "",
      item: B.name + "－" + x.item,
      cat: "非必要支出",
      amount: x.amount,
      pay: oldCard ? "信用卡" : oldMixed ? "複合" : x.pay,
      card: oldCard ? x.pay.replace("信用卡－", "") : x.card || "",
      paymentParts: importedParts,
      proxy: x.amount * (1 - ratio),
      recv: 0,
      person: "旅伴",
      rdate: "",
      photoIds: [...(x.photoIds || [])],
    });
  });
  B.imported = true;
  closeM("importM");
  persist();
  settle();
  alert("已依你的原始付款方式匯入，且同一帳本不可重複匯入");
}
if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js");
$("bstart").value = $("bend").value = td();
migrateBackgroundStrengthToMaximum();
applyAppearance();
restoreMonthOverview();
applyBackgrounds().catch(() => {});
home();
async function deleteFormal(i) {
  if (confirm("確定刪除這筆正式支出？刪除後無法復原。")) {
    let entry = D.e[i];
    if (entry?.isCreditCardPayment && entry.creditCardId && entry.cardStatementKey) {
      let card = D.cards.find((item) => item.id === entry.creditCardId);
      if (card) card.paidStatements = card.paidStatements.filter((key) => key !== entry.cardStatementKey);
    }
    if (entry?.pay === "預繳帳戶" && entry.prepaidAccountId) {
      let account = D.prepaid.find((item) => item.id === entry.prepaidAccountId);
      if (account) { account.balance += entry.amount; account.transactions.push({ date: td(), type: "restore", amount: entry.amount, note: `刪除支出歸還：${entry.item || entry.cat}` }); }
    }
    let photoIds = [...(entry?.photoIds || [])];
    D.e.splice(i, 1);
    persist();
    await cleanupUnusedPhotoIds(photoIds);
    generic("最近");
  }
}
function editFormalAmount(i) {
  let x = D.e[i];
  if (!x) return alert("找不到這筆紀錄");
  if (x.isCreditCardPayment) return alert("信用卡帳單金額由該期刷卡紀錄自動計算；如需取消，請刪除這筆繳款紀錄。");
  let v = prompt("修改金額", x.amount);
  if (v === null) return;
  v = +v;
  if (!v) return alert("金額需大於0");
  if (x.pay === "預繳帳戶" && x.prepaidAccountId) {
    let account = D.prepaid.find((item) => item.id === x.prepaidAccountId), difference = v - x.amount;
    if (account && difference > account.balance) return alert("預繳帳戶餘額不足以增加這筆金額");
    if (account) { account.balance -= difference; account.transactions.push({ date: td(), type: "adjust", amount: -difference, note: `調整支出：${x.item || x.cat}` }); }
  }
  x.amount = v;
  x.draft = false;
  persist();
  generic("最近");
}
function editFormalItem(i) {
  let x = D.e[i];
  if (!x) return alert("找不到這筆紀錄");
  let value = prompt("修改項目", x.item || "");
  if (value === null) return;
  x.item = value.trim() || "未命名";
  persist();
  generic("最近");
}
function editFormalPayment(i) {
  let x = D.e[i];
  if (!x) return alert("找不到這筆紀錄");
  if (x.isCreditCardPayment) return alert("信用卡繳款紀錄的付款狀態不可快速修改；如需取消，請刪除這筆繳款紀錄。");
  let current = x.pay === "信用卡" ? `信用卡－${x.card || "國泰"}` : x.pay,
    value = prompt("修改付款方式\n輸入：現金、信用卡－國泰、信用卡－星展、信用卡－台新、貨到付款、複合", current);
  if (value === null) return;
  value = value.trim();
  let allowed = ["現金", "信用卡－國泰", "信用卡－星展", "信用卡－台新", "貨到付款", "複合"];
  if (!allowed.includes(value)) return alert("請輸入清單中的付款方式");
  if (value === "複合" && !(x.pay === "複合" && x.paymentParts?.length)) {
    return alert("複合付款需設定各付款金額，請於新增支出時選擇「複合」。");
  }
  if (x.pay === "預繳帳戶" && x.prepaidAccountId) {
    let account = D.prepaid.find((item) => item.id === x.prepaidAccountId);
    if (account) { account.balance += x.amount; account.transactions.push({ date: td(), type: "restore", amount: x.amount, note: `更改付款方式歸還：${x.item || x.cat}` }); }
    x.prepaidAccountId = null; x.prepaidAccountName = "";
  }
  if (value.startsWith("信用卡－")) {
    x.pay = "信用卡";
    x.card = value.replace("信用卡－", "");
  } else {
    x.pay = value;
    x.card = "";
    if (value !== "複合") x.paymentParts = null;
  }
  persist();
  generic("最近");
}
async function deleteTempEntry(i) {
  if (confirm("確定刪除這筆臨時帳本支出？")) {
    let photoIds = [...(B.entries[i]?.photoIds || [])];
    B.entries.splice(i, 1);
    persist();
    await cleanupUnusedPhotoIds(photoIds);
    detail();
  }
}
function editTempEntry(i) {
  let x = B.entries[i],
    v = prompt("修改金額", x.amount);
  if (v === null) return;
  v = +v;
  if (!v) return alert("金額需大於0");
  let n = prompt("修改項目", x.item);
  if (n === null) return;
  x.amount = v;
  x.item = n;
  x.draft = false;
  if (x.shares && x.shares.length) {
    let each = v / x.shares.length;
    x.shares = x.shares.map((s) => ({ p: s.p, a: each }));
  }
  persist();
  detail();
}
async function deleteBook() {
  if (!B) return;
  if (
    !confirm(
      `確定刪除「${B.name}」？\n${B.imported ? "此帳本已匯入正式帳本；刪除臨時帳本不會刪除已匯入的正式帳務。" : "帳本內的臨時紀錄會一起刪除。"}`,
    )
  )
    return;
  let photoIds = B.entries.flatMap((entry) => entry.photoIds || []);
  D.b = D.b.filter((x) => x.id !== B.id);
  B = null;
  persist();
  await cleanupUnusedPhotoIds(photoIds);
  show("temp");
}

// ===== V6 Google Calendar integration (no OAuth Client ID required) =====
function addDays(date, days) {
  let [y, m, d] = date.split("-").map(Number),
    value = new Date(Date.UTC(y, m - 1, d));
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
function compactDate(date) {
  return date.replaceAll("-", "");
}
function compactDateTime(date, time, minuteDelta = 0) {
  let [y, m, d] = date.split("-").map(Number),
    [h, min] = time.split(":").map(Number),
    value = new Date(Date.UTC(y, m - 1, d, h, min + minuteDelta));
  return value.toISOString().slice(0, 19).replaceAll("-", "").replaceAll(":", "");
}
function googleCalendarUrl({
  summary,
  startDate,
  startTime,
  endDate,
  endTime,
  location = "",
  description = "",
}) {
  startDate = startDate || td();
  endDate = endDate || startDate;
  let timed = !!(startTime || endTime),
    start,
    end;
  if (timed) {
    let st = startTime || "09:00",
      et = endTime || "";
    start = compactDateTime(startDate, st);
    end = et ? compactDateTime(endDate, et) : compactDateTime(startDate, st, 60);
    if (end <= start) end = compactDateTime(startDate, st, 60);
  } else {
    start = compactDate(startDate);
    end = compactDate(addDays(endDate, 1));
  }
  let params = new URLSearchParams({
    action: "TEMPLATE",
    text: summary || "未命名活動",
    dates: `${start}/${end}`,
    ctz: "Asia/Taipei",
  });
  if (location) params.set("location", location);
  if (description) params.set("details", description);
  return `https://calendar.google.com/calendar/render?${params}`;
}
function openGoogleCalendar(event) {
  let calendarWindow = window.open(googleCalendarUrl(event), "_blank");
  if (calendarWindow) calendarWindow.opener = null;
  else
    alert("行事曆頁面被瀏覽器阻擋，請允許此網站開啟新視窗後再試一次。");
}

// Wrap saveExpense to optionally sync calendar while preserving existing behavior.
const _saveExpense = saveExpense;
saveExpense = function () {
  let before = D.e.length;
  let startTime = $("etime")?.value || "",
    location = $("elocation")?.value || "",
    sync = !!$("ecalendar")?.checked;
  _saveExpense();
  if (D.e.length === before) return;
  let x = D.e[D.e.length - 1];
  x.time = startTime;
  x.location = location;
  x.calendarSync = sync;
  persist();
  if (sync) {
    openGoogleCalendar({
      summary: x.item || x.cat,
      startDate: x.date,
      startTime,
      location,
      description: `日常隨手記帳｜${x.cat}｜${money(x.amount)}`,
    });
    alert("支出已儲存。Google 行事曆已開啟，請按「儲存」完成加入。");
  }
};

const _saveBook = saveBook;
saveBook = function () {
  let before = D.b.length;
  let startTime = $("bstarttime")?.value || "",
    endTime = $("bendtime")?.value || "",
    location = $("blocation")?.value || "",
    sync = !!$("bcalendar")?.checked;
  _saveBook();
  if (D.b.length === before) return;
  let b = D.b[D.b.length - 1];
  b.startTime = startTime;
  b.endTime = endTime;
  b.location = location;
  b.calendarSync = sync;
  persist();
  if (sync) {
    openGoogleCalendar({
      summary: b.name,
      startDate: b.start,
      startTime: b.startTime,
      endDate: b.end,
      endTime: b.endTime,
    });
    alert("臨時帳本已建立。Google 行事曆已開啟，請按「儲存」完成加入。");
  }
};
