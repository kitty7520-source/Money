import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  setPersistence,
  browserLocalPersistence,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAXjtqcR6Jq26JKZj0z77qkAohs-4fPK_g",
  authDomain: "money-app-c9fe5.firebaseapp.com",
  projectId: "money-app-c9fe5",
  storageBucket: "money-app-c9fe5.firebasestorage.app",
  messagingSenderId: "874134089363",
  appId: "1:874134089363:web:36d97d80eb2c9ba58ca766",
  measurementId: "G-MQWS57WX5S",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

const statusEl = document.getElementById("firebaseSyncStatus");
const emailEl = document.getElementById("firebaseAuthEmail");
const buttonEl = document.getElementById("firebaseAuthButton");

let currentUser = null;
let currentDocRef = null;
let unsubscribe = null;
let saveTimer = null;
let syncPaused = false;
let applyingRemote = false;
let lastJson = "";

function setStatus(status, detail = "") {
  if (statusEl) statusEl.textContent = status;
  if (emailEl) emailEl.textContent = detail;
}

function localSnapshot() {
  return typeof window.getLedgerCloudSnapshot === "function"
    ? window.getLedgerCloudSnapshot()
    : null;
}

function meaningful(snapshot) {
  if (!snapshot?.ledger) return false;
  return !!(
    snapshot.ledger.e?.length ||
    snapshot.ledger.b?.length ||
    snapshot.ledger.prepaid?.length ||
    snapshot.memberGroups?.length ||
    snapshot.locations?.length
  );
}

function stableJson(value) {
  try { return JSON.stringify(value); }
  catch { return ""; }
}

async function writeCloudNow() {
  if (!currentUser || !currentDocRef || syncPaused || applyingRemote) return;
  const payload = localSnapshot();
  if (!payload) return;
  const json = stableJson(payload);
  if (json && json === lastJson) return;
  setStatus("正在同步…", currentUser.email || "Google 已登入");
  await setDoc(currentDocRef, {
    schemaVersion: 1,
    payload,
    updatedAt: serverTimestamp(),
    updatedAtClient: Date.now(),
  });
  lastJson = json;
  setStatus("已同步到雲端", currentUser.email || "Google 已登入");
}

window.queueLedgerCloudSave = function () {
  if (!currentUser || syncPaused || applyingRemote) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    writeCloudNow().catch((error) => {
      console.error("Firebase sync save failed", error);
      setStatus("同步失敗", currentUser?.email || "請稍後再試");
    });
  }, 450);
};

async function connectUser(user) {
  currentUser = user;
  syncPaused = false;
  currentDocRef = doc(db, "users", user.uid, "ledger", "main");
  setStatus("正在讀取雲端資料…", user.email || "Google 已登入");

  const local = localSnapshot();
  const snap = await getDoc(currentDocRef);

  if (!snap.exists()) {
    await setDoc(currentDocRef, {
      schemaVersion: 1,
      payload: local,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      updatedAtClient: Date.now(),
    });
    lastJson = stableJson(local);
    setStatus("已建立雲端帳本", user.email || "Google 已登入");
  } else {
    const cloud = snap.data()?.payload;
    const localJson = stableJson(local);
    const cloudJson = stableJson(cloud);

    if (meaningful(local) && cloud && localJson !== cloudJson) {
      const useCloud = confirm(
        "這台裝置已有記帳資料，而雲端也已有不同資料。\n\n按「確定」：載入雲端資料。\n按「取消」：保留這台裝置資料並暫停同步，避免覆蓋。",
      );
      if (!useCloud) {
        syncPaused = true;
        lastJson = cloudJson;
        setStatus("同步已暫停", "本機與雲端資料不同，尚未互相覆蓋");
        return;
      }
    }

    if (cloud && typeof window.applyLedgerCloudSnapshot === "function") {
      applyingRemote = true;
      window.applyLedgerCloudSnapshot(cloud);
      applyingRemote = false;
      lastJson = cloudJson;
    }
    setStatus("已載入雲端帳本", user.email || "Google 已登入");
  }

  unsubscribe?.();
  unsubscribe = onSnapshot(currentDocRef, (next) => {
    if (!next.exists() || syncPaused) return;
    const cloud = next.data()?.payload;
    const cloudJson = stableJson(cloud);
    if (!cloud || !cloudJson || cloudJson === lastJson) return;
    applyingRemote = true;
    try {
      window.applyLedgerCloudSnapshot?.(cloud);
      lastJson = cloudJson;
      setStatus("已同步到最新資料", currentUser?.email || "Google 已登入");
    } finally {
      applyingRemote = false;
    }
  }, (error) => {
    console.error("Firebase sync listener failed", error);
    setStatus("同步連線中斷", currentUser?.email || "請重新整理");
  });
}

async function signIn() {
  try {
    setStatus("正在開啟 Google 登入…", "請完成帳號登入");
    await signInWithPopup(auth, provider);
  } catch (error) {
    console.error("Google sign-in failed", error);
    if (["auth/popup-blocked", "auth/cancelled-popup-request"].includes(error?.code)) {
      await signInWithRedirect(auth, provider);
      return;
    }
    if (error?.code === "auth/unauthorized-domain") {
      alert("目前網址尚未加入 Firebase Authentication 的授權網域。先不要改資料，請把這個錯誤畫面截圖給我。");
    } else if (error?.code !== "auth/popup-closed-by-user") {
      alert(`Google 登入失敗：${error?.message || error}`);
    }
    setStatus("尚未登入雲端", "資料仍保存在這台裝置");
  }
}

buttonEl?.addEventListener("click", async () => {
  if (currentUser) {
    unsubscribe?.();
    unsubscribe = null;
    currentUser = null;
    currentDocRef = null;
    await signOut(auth);
  } else {
    await signIn();
  }
});

setPersistence(auth, browserLocalPersistence).catch(() => {});
onAuthStateChanged(auth, (user) => {
  if (!user) {
    currentUser = null;
    currentDocRef = null;
    unsubscribe?.();
    unsubscribe = null;
    clearTimeout(saveTimer);
    if (buttonEl) buttonEl.textContent = "Google 登入";
    setStatus("雲端同步尚未登入", "資料目前仍保存在這台裝置");
    return;
  }

  if (buttonEl) buttonEl.textContent = "登出";
  connectUser(user).catch((error) => {
    console.error("Firebase initialization failed", error);
    setStatus("雲端連線失敗", user.email || "請重新整理");
    alert(`Firebase 連線失敗：${error?.message || error}`);
  });
});
