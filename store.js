// お問い合わせデータの置き場。
// config.js に API_URL があれば Apps Script のサーバーへ、無ければ localStorage（同じブラウザ内だけ）に置く。
// 画面からは同期的に読めるよう、サーバーの中身は手元に写して持つ。
const Store = (() => {
  const KEY = 'baiko-inquiries-v1';
  const cfg = window.APP_CONFIG || {};
  const remote = !!cfg.API_URL && !new URLSearchParams(location.search).has('demo');
  let cache = [];
  let auth = {}; // 質問者は { idToken }、職員は { adminKey }

  const fire = () => window.dispatchEvent(new Event('store-changed'));
  const load = () => {
    if (remote) return cache;
    try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; }
  };
  const save = (list) => {
    if (remote) cache = list;
    else try { localStorage.setItem(KEY, JSON.stringify(list)); } catch {}
    fire();
  };
  const now = () => new Date().toISOString();
  const newId = () => 'Q' + Date.now().toString(36).toUpperCase();

  async function call(action, body = {}) {
    // text/plain にして、Apps Script が受けられない事前確認（CORS preflight）を起こさない
    const res = await fetch(cfg.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, ...auth, ...body }),
    });
    const json = await res.json();
    if (json.error) throw new Error(json.error);
    return json;
  }
  // 書き込みは先に手元を変えて見せ、サーバーに送ったあと取り直す
  const send = (action, body) => {
    if (!remote) return;
    call(action, body).then(Store.refresh).catch((e) => Store.onError(e));
  };
  const isAdmin = () => !!auth.adminKey;

  return {
    remote,
    onError: (e) => alert('通信できませんでした：' + e.message),
    setAuth: (a) => { auth = a; },
    async refresh() {
      if (!remote) return fire();
      const r = await call(isAdmin() ? 'adminList' : 'mine');
      cache = r.items;
      fire();
    },

    all: () => load().slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    byUser: (userId) => load().filter((q) => remote || q.userId === userId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    get: (id) => load().find((q) => q.id === id),

    create({ userId, displayName, name, role, school, category, text }) {
      const list = load();
      const q = {
        id: newId(), userId, displayName, name, role, school, category,
        status: '未対応', assignee: '', unreadForUser: false,
        createdAt: now(), updatedAt: now(),
        messages: [{ from: 'user', text, at: now() }],
      };
      list.push(q);
      save(list);
      send('create', { q: { id: q.id, name, role, school, category, text } });
      return q;
    },

    addMessage(id, { from, text, staffName }) {
      const list = load();
      const q = list.find((x) => x.id === id);
      if (!q) return;
      q.messages.push({ from, text, staffName, at: now() });
      q.updatedAt = now();
      if (from === 'staff') { q.status = '回答済み'; q.unreadForUser = true; }
      else { q.status = '未対応'; }
      save(list);
      if (from === 'staff') send('adminReply', { id, text, staffName });
      else send('userMessage', { id, text });
    },

    update(id, patch) {
      const list = load();
      const q = list.find((x) => x.id === id);
      if (!q) return;
      Object.assign(q, patch);
      save(list);
      if (isAdmin()) send('adminUpdate', { id, patch });
      else if (patch.unreadForUser === false) send('markRead', { id });
    },

    reset: () => save([]),
  };
})();

// 別タブ・別フレームの変更も拾う（デモ用）
window.addEventListener('storage', (e) => {
  if (e.key === 'baiko-inquiries-v1') window.dispatchEvent(new Event('store-changed'));
});

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
const fmt = (iso) => {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
};
