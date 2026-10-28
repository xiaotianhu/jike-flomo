// Jike → Flomo 改造主逻辑
// 即刻 = Mantine + TanStack Router SPA。类名带构建 hash（_post_160sp_5），
// 但前缀稳定，全程用 [class*=] 匹配。数据从 React fiber 的 props.data 拿（比 DOM 准）。
(function () {
  'use strict';
  window.__JF_CLEANUP__?.();
  const lifecycle = new AbortController();
  const TAG = '[jike-flomo]';
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => [...(r || document).querySelectorAll(s)];

  /* ================= 工具 ================= */

  const dayKey = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  // flomo 式："2026-06-09 13:58"
  function fmtAbsTime(d) {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // 从 DOM 元素往上爬 React fiber，找第一个 memoizedProps.data（帖子对象）
  function fiberData(el, pred, maxHops = 30) {
    const fk = Object.keys(el).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactProps'));
    if (!fk) return null;
    let node = el[fk], hops = 0;
    // __reactProps 直接是 props；__reactFiber 要读 memoizedProps
    while (node && hops < maxHops) {
      const p = node.memoizedProps || (hops === 0 ? node : null);
      if (p && pred(p)) return p;
      node = node.return; hops++;
    }
    return null;
  }

  // 从帖子 DOM 节点拿到 data（id/createdAt/content/topic/user/likeCount...）
  function postData(postEl) {
    const p = fiberData(postEl, p => p.data && p.data.id && p.data.createdAt);
    return p ? p.data : null;
  }

  /* ================= 扫描 feed 入库 ================= */

  function ownProfilePath() {
    const link = $('[class*=_desktopStack] a[href^="/u/"]');
    if (link) return link.getAttribute('href').replace(/\/$/, '');
    try {
      const user = JSON.parse(localStorage.getItem('jf-my-profile') || 'null');
      return user?.username ? '/u/' + user.username : null;
    } catch { return null; }
  }
  const isMyPage = () => location.pathname === '/me' ||
    (!!ownProfilePath() && location.pathname.replace(/\/$/, '') === ownProfilePath());

  function serializePost(data, mine) {
    const ts = new Date(data.createdAt);
    return {
      key: data.id, id: data.id, ts: ts.getTime(), day: dayKey(ts),
      text: (data.content || '').slice(0, 500), topic: data.topic?.content || '', topicId: data.topic?.id || '',
      type: data.type || '', likeCount: data.likeCount || 0, commentCount: data.commentCount || 0,
      mine, uid: data.user?.id || '', screenName: data.user?.screenName || '',
    };
  }

  // 读取页面现有的无限列表状态：只调用原生翻页方法，不拼接或请求私有 API。
  function profileQuery(el) {
    if (!el) return null;
    const key = Object.keys(el).find(k => k.startsWith('__reactFiber'));
    let node = key && el[key];
    for (let i = 0; node && i < 35; i++, node = node.return) {
      for (let hook = node.memoizedState, j = 0; hook && j < 40; hook = hook.next, j++) {
        const observer = hook.memoizedState;
        if (typeof observer?.getCurrentResult !== 'function' || typeof observer.fetchNextPage !== 'function') continue;
        const result = observer.getCurrentResult();
        if (result.data?.pages?.every(page => Array.isArray(page.data))) return result;
      }
    }
    return null;
  }
  function profileFeed() {
    const predicate = p => Array.isArray(p.data) && 'onLoadMore' in p;
    const post = $('[class*=_post_]');
    const header = $('[class*=_section_nob1h]');
    const query = profileQuery(post) || profileQuery(header);
    let props = post && fiberData(post, predicate, 40);
    const queryItems = query?.data.pages.flatMap(page => page.data) || [];
    // 即刻查询缓存保存的是 id，列表 props.data 才是补齐作者和日期的对象。
    if (query && (props || queryItems.length === 0 || typeof queryItems[0] === 'object')) return {
      data: props?.data || queryItems,
      pageCount: query.data.pages.length,
      isLoading: query.isLoading || query.isFetchingNextPage,
      hasNextPage: query.hasNextPage,
      error: query.isError || query.isFetchNextPageError ? query.error || new Error('动态加载失败') : null,
      onLoadMore: props?.onLoadMore || query.fetchNextPage,
    };
    if (props) return props;
    const main = $('[class*=_mainContainer]');
    if (!main) return null;
    for (const el of $$('div, section', main).filter(el => !el.closest('#jf-topwrap')).slice(0, 500)) {
      props = fiberData(el, predicate, 12);
      if (props) return props;
    }
    return null;
  }

  let dataManager = null, scanTask = null;
  function scanFeed() {
    if (scanTask) return scanTask;
    scanTask = (async () => {
      const myPage = isMyPage();
      for (const el of $$('[class*=_post_]')) {
        const data = postData(el); if (!data) continue;
        const descEl = $('[class*=_descContainer], [class*=_desc_]', el);
        if (descEl && descEl.dataset.jfAbs !== data.id) {
          descEl.dataset.jfAbs = data.id;
          descEl.textContent = fmtAbsTime(new Date(data.createdAt));
        }
        if (!dataManager?.canCache(data) || el.dataset.jfScanned === data.id) continue;
        await window.JF_DB.savePost(serializePost(data, myPage));
        el.dataset.jfScanned = data.id;
      }
    })().finally(() => { scanTask = null; });
    return scanTask;
  }
  function resetScanned() {
    $$('[data-jf-scanned]').forEach(el => { delete el.dataset.jfScanned; });
    const panel = $('#jf-sidebar'); if (panel) delete panel._jfStatsSignature;
  }

  // 拿当前登录用户信息
  // 优先读个人页资料，帖子尚未加载（或没有帖子）时也能展示。
  function myProfile() {
    if (isMyPage()) {
      const header = $('[class*=_section_nob1h]');
      const profile = header && fiberData(header, p =>
        [p.user, p.data, p.profile].some(u => u?.screenName && u?.avatarImage));
      const user = profile && [profile.user, profile.data, profile.profile].find(u => u?.screenName);
      if (user) {
        try { localStorage.setItem('jf-my-profile', JSON.stringify(user)); } catch {}
        return user;
      }
      for (const el of $$('[class*=_post_]')) {
        const d = postData(el);
        if (d?.user) {
          try { localStorage.setItem('jf-my-profile', JSON.stringify(d.user)); } catch {}
          return d.user;
        }
      }
    }
    // 非 /me 页：从缓存拿
    try {
      const s = localStorage.getItem('jf-my-profile');
      return s ? JSON.parse(s) : null;
    } catch { return null; }
  }

  /* ================= flomo 侧栏 ================= */

  const PANEL_ID = 'jf-sidebar';

  function refreshProfile() {
    const panel = $('#' + PANEL_ID);
    const user = myProfile();
    if (!panel || !user) return;
    const avatar = user.avatarImage?.thumbnailUrl || user.avatarImage?.picUrl || user.profileImageUrl || '';
    const bio = (user.briefIntro || user.bio || '').replace(/\s+/g, ' ').trim();
    const name = user.screenName || '我';
    const signature = JSON.stringify([user.id, name, avatar, bio, user.createdAt]);
    if (panel.dataset.profile === signature) return;
    panel.dataset.profile = signature;
    $('.jf-user', panel).innerHTML = `
      ${avatar ? `<img class="jf-avatar" src="${escapeHtml(avatar)}" alt="${escapeHtml(name)}的头像">` : ''}
      <div class="jf-userinfo"><div class="jf-username">${escapeHtml(name)}</div>
      ${bio ? `<div class="jf-bio" title="${escapeHtml(bio)}">${escapeHtml(bio)}</div>` : ''}</div>`;
    const created = new Date(user.createdAt).getTime();
    $('[data-stat=days]', panel).textContent = Number.isFinite(created)
      ? Math.max(1, Math.floor((Date.now() - created) / 864e5)) : '–';
  }

  const NAV_ITEMS = [
    { href: '/me',           text: '全部笔记', icon: 'M4 5h16M4 12h16M4 19h16' },
    { href: '/following',    text: '动态',     icon: 'M4 6h16M4 12h16M4 18h10' },
    { href: '/explore',       text: '发现',     icon: 'M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z' },
    { href: '/notification', text: '通知',     icon: 'M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 00-4-5.7V5a2 2 0 10-4 0v.3A6 6 0 006 11v3.2a2 2 0 01-.6 1.4L4 17h5m6 0v1a3 3 0 11-6 0v-1' },
  ];

  function buildSidebar() {
    if ($('#' + PANEL_ID)) { refreshProfile(); markActiveNav(); return; }
    const main = $('[class*=_mainContainer]');
    if (!main || !main.parentElement) return;

    const panel = document.createElement('aside');
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <div class="jf-profile-row">
        <div class="jf-user"><div class="jf-userinfo"><div class="jf-username">我</div></div></div>
        <div class="jf-data-menu">
          <button class="jf-data-trigger" type="button" aria-label="数据管理" title="数据管理" aria-haspopup="menu" aria-expanded="false" aria-controls="jf-data-dropdown">
            <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg>
          </button>
          <div class="jf-data-dropdown" id="jf-data-dropdown" role="menu" hidden>
            <button type="button" role="menuitem" data-sync-action="recent"><span>快速刷新</span><small>同步近半年，更新统计和热力图</small></button>
            <button type="button" role="menuitem" data-sync-action="all"><span>全量刷新</span><small>读取完整历史，耗时较长</small></button>
            <button type="button" role="menuitem" data-sync-action="clear" class="jf-menu-danger"><span>清除数据</span><small>清除本地缓存，保留草稿</small></button>
          </div>
        </div>
      </div>
      <div class="jf-stats">
        <div class="jf-stat"><div class="jf-num" data-stat="posts">–</div><div class="jf-label">动态</div></div>
        <div class="jf-stat"><div class="jf-num" data-stat="topics">–</div><div class="jf-label">圈子</div></div>
        <div class="jf-stat"><div class="jf-num" data-stat="days">–</div><div class="jf-label">天</div></div>
      </div>
      <div class="jf-heatgrid" id="jf-heatgrid"></div>
      <div class="jf-sync-summary"></div>
      <nav class="jf-nav">
        ${NAV_ITEMS.map(n => `
          <a class="jf-nav-item" data-route="${n.href}" href="${n.href}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                 stroke-linecap="round" stroke-linejoin="round"><path d="${n.icon}"/></svg>
            <span>${n.text}</span>
          </a>`).join('')}
      </nav>
      <div class="jf-tags"><div class="jf-tags-title">圈子</div><ul id="jf-topic-list"></ul></div>
    `;

    const parent = main.parentElement;
    parent.classList.add('jf-layout');
    parent.insertBefore(panel, main);
    refreshProfile();
    dataManager.mountPanel(panel);

    // 点击导航用 SPA 内部跳转，不整页刷新
    panel.addEventListener('click', (e) => {
      const a = e.target.closest('a.jf-nav-item');
      if (!a) return;
      e.preventDefault();
      // 复用原生发现入口，保留再次点击时刷新推荐的行为。
      if (a.dataset.route === '/explore') {
        const native = $('[class*=_desktopStack] a[href="/explore"]');
        if (native) { native.click(); return; }
      }
      window.__TSR_ROUTER__?.navigate?.({ to: a.getAttribute('href') })
        ?? (location.href = a.href);
    });

    refreshSidebarStats();
  }

  async function refreshSidebarStats() {
    const panel = $('#' + PANEL_ID);
    if (!panel) return;
    const posts = await window.JF_DB.allPosts();
    const user = myProfile();
    const mine = posts.filter(p => p.mine && p.uid === user?.id);
    // 注入的 DOM 也会触发 MutationObserver；数据不变时不重画，避免循环刷新。
    const signature = dayKey(new Date()) + mine.map(p => `${p.key}:${p.day}:${p.topic}`).join('|');
    if (panel._jfStatsSignature === signature) return;
    panel._jfStatsSignature = signature;
    const topics = new Map();
    mine.forEach(p => { if (p.topic) topics.set(p.topic, (topics.get(p.topic) || 0) + 1); });

    $('[data-stat=posts]', panel).textContent = mine.length;
    $('[data-stat=topics]', panel).textContent = topics.size;

    const list = $('#jf-topic-list', panel);
    list.innerHTML = [...topics.entries()]
      .sort((a, b) => b[1] - a[1]).slice(0, 24)
      .map(([t]) => `<li><span class="jf-tag">${escapeHtml(t)}</span></li>`).join('');

    renderHeatgrid(mine);
    markActiveNav();
  }

  function markActiveNav() {
    const path = location.pathname;
    $$('#jf-sidebar .jf-nav-item').forEach(a => {
      const r = a.dataset.route;
      const active =
        (r === '/me' && (path === '/me' || path.startsWith('/u/'))) ||
        (r === '/following' && path === '/following') ||
        (r === '/explore' && path === '/explore') ||
        (r === '/notification' && path.startsWith('/notification'));
      a.classList.toggle('active', !!active);
    });
  }

  /* ================= 热力图 ================= */

  function renderHeatgrid(minePosts) {
    const grid = $('#jf-heatgrid');
    if (!grid) return;
    const countMap = {};
    minePosts.forEach(p => { countMap[p.day] = (countMap[p.day] || 0) + 1; });

    const WEEKS = 13;
    const today = new Date();
    const end = new Date(today);
    end.setDate(end.getDate() + (6 - end.getDay()));          // 本周六收尾
    const start = new Date(end);
    start.setDate(start.getDate() - (WEEKS * 7 - 1));

    let html = '<div class="jf-weeks">';
    for (let w = 0; w < WEEKS; w++) {
      html += '<div class="jf-week">';
      for (let d = 0; d < 7; d++) {
        const day = new Date(start);
        day.setDate(start.getDate() + w * 7 + d);
        const n = countMap[dayKey(day)] || 0;
        const level = day > today ? 'future'
          : n === 0 ? '0' : n <= 1 ? '1' : n <= 3 ? '2' : n <= 6 ? '3' : '4';
        html += `<div class="jf-day" data-level="${level}" data-today="${dayKey(day) === dayKey(today)}" title="${dayKey(day)} · ${n} 条"></div>`;
      }
      html += '</div>';
    }
    html += '</div><div class="jf-months" id="jf-months"></div>';
    grid.innerHTML = html;

    // 与格子共用 13 列网格，尺寸变化时月份位置保持对齐。
    const monthsEl = $('#jf-months', grid);
    let lastM = -1;
    for (let w = 0; w < WEEKS; w++) {
      const d0 = new Date(start); d0.setDate(start.getDate() + w * 7);
      if (d0.getMonth() !== lastM) {
        lastM = d0.getMonth();
        const s = document.createElement('span');
        s.textContent = `${lastM + 1}月`;
        s.style.gridColumn = String(w + 1);
        monthsEl.appendChild(s);
      }
    }
  }

  /* ================= flomo 输入框（/me 页面） ================= */

  const COMPOSER_ID = 'jf-composer';
  let composerLayout = null;

  function clearComposerLayout() {
    if (!composerLayout) return;
    $('#' + COMPOSER_ID, composerLayout.wrap)?._jfDispose?.();
    composerLayout.observer.disconnect();
    composerLayout.main.style.removeProperty('--jf-composer-space');
    composerLayout = null;
  }

  function watchComposerLayout(wrap, main) {
    clearComposerLayout();
    const sync = () => {
      // SPA 卸载也会通知 ResizeObserver，脱离文档的旧节点高度为 0。
      // 旧回调不能覆盖新页面的占位，更不能把 0 - 32 写成负数。
      if (lifecycle.signal.aborted || !wrap.isConnected ||
          wrap.parentElement !== main || composerLayout?.wrap !== wrap) return;
      const height = wrap.getBoundingClientRect().height;
      if (height <= 0) return;
      const layoutTop = parseFloat(getComputedStyle(main.parentElement).paddingTop) || 0;
      main.style.setProperty('--jf-composer-space', `${Math.max(0, height - layoutTop)}px`);
    };
    const observer = new ResizeObserver(sync);
    composerLayout = { wrap, main, observer };
    observer.observe(wrap);
    // 首次插入立即占位，不依赖下一次异步回调。
    sync();
  }

  function buildComposer() {
    if (composerLayout && !composerLayout.wrap.isConnected) clearComposerLayout();
    const showComposer = isMyPage() || location.pathname === '/following' || location.pathname === '/';
    if (!showComposer) {
      clearComposerLayout();
      $('#jf-topwrap')?.remove();
      return;
    }
    const main = $('[class*=_mainContainer]');
    if (!main) return;
    const existing = $('#' + COMPOSER_ID);
    if (existing) {
      const wrap = existing.closest('#jf-topwrap');
      if (wrap?.parentElement === main && composerLayout?.wrap !== wrap) watchComposerLayout(wrap, main);
      return;
    }
    // 即刻 ScrollArea 滚整个 mainContainer，composer 固定在主区顶部。
    const wrap = document.createElement('div');
    wrap.id = 'jf-topwrap';
    wrap.innerHTML = `
      <div id="jf-composer">
        <div class="jf-composer-input" contenteditable="true" role="textbox" aria-label="现在的想法" aria-multiline="true" data-placeholder="现在的想法是…"></div>
        <div class="jf-topic-row" role="group" aria-label="圈子推荐与选择" hidden></div>
        <div class="jf-attachments" role="group" aria-label="待发送图片" hidden></div>
        <input class="jf-file-input" type="file" accept="image/*" multiple hidden>
        <div class="jf-composer-status" role="status" aria-live="polite" hidden></div>
        <div class="jf-composer-bar">
          <div class="jf-composer-icons">
            <button class="jf-icon" data-k="tag" title="标签"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 4L4 20M20 4l-5 16M6 9h14M4 15h14"/></svg></button>
            <button class="jf-icon" data-k="img" title="图片"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5-5 5"/></svg></button>
            <span class="jf-divider"></span>
            <button class="jf-icon" data-k="font" title="字体"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 20h16M6 4l6 16m0-16l6 16M8 14h8"/></svg></button>
            <button class="jf-icon" data-k="ul" title="无序列表"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><line x1="9" y1="6" x2="21" y2="6"/><line x1="9" y1="12" x2="21" y2="12"/><line x1="9" y1="18" x2="21" y2="18"/><circle cx="4" cy="6" r="1.5" fill="currentColor"/><circle cx="4" cy="12" r="1.5" fill="currentColor"/><circle cx="4" cy="18" r="1.5" fill="currentColor"/></svg></button>
            <button class="jf-icon" data-k="ol" title="有序列表"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><path d="M4 6h1v4m0 0h1m-2 0h1m-1 8c0-1 1.5-1.5 1.5-2.5S5 13 4 13s-1.5.5-1.5 1.5V17h3"/></svg></button>
            <span class="jf-divider"></span>
            <button class="jf-icon" data-k="at" title="@"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 006 0v-1a9 9 0 10-3.5 7"/></svg></button>
          </div>
          <div class="jf-composer-right">
            <span class="jf-count" data-count>0</span>
            <button class="jf-composer-send" type="button">
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M3.4 20.4l17.4-7.4c.8-.4.8-1.6 0-2L3.4 3.6c-.7-.3-1.4.4-1.2 1.1l2.4 6.1c.1.4.5.7.9.7l8.1 1.3c.1 0 .1.1.1.1s0 .1-.1.1l-8.1 1.3c-.4.1-.8.3-.9.7l-2.4 6.1c-.2.7.5 1.4 1.2 1.1z"/></svg>
            </button>
          </div>
        </div>
      </div>
    `;
    main.insertBefore(wrap, main.firstChild);
    const box = $('#jf-composer', wrap);
    watchComposerLayout(wrap, main);
    window.JF_COMPOSER.mount(box, { signal: lifecycle.signal, post: postToJike }).then(schedule);
  }

  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function waitUntil(check, timeout, error) {
    const start = Date.now();
    while (!check()) {
      if (Date.now() - start > timeout) throw new Error(error);
      if (lifecycle.signal.aborted) throw new Error('页面已切换，草稿已保留');
      await delay(100);
    }
  }

  // 图片交给即刻原生 Dropzone 上传，等待真实附件状态；复用原生按钮提交。
  async function postToJike(text, files, message, { editorState, topic } = {}) {
    const ed = $('[class*=_postForm] [data-lexical-editor]');
    if (!ed?.__lexicalEditor) {
      sessionStorage.setItem('jf-pending-send', '1');
      const router = window.__TSR_ROUTER__;
      if (router?.navigate) await router.navigate({ to: '/following' });
      else location.href = '/following';
      return 'queued';
    }
    const fileInput = $('[class*=_postForm] input[type=file]');
    const formProps = () => fileInput && fiberData(fileInput, p => typeof p.getValues === 'function');
    const form = formProps();
    const signature = JSON.stringify([text, editorState, topic?.id, files.map(f => [f.name, f.size, f.lastModified])]);
    const values = form?.getValues();
    if (!ed.dataset.jfPrepared &&
        (values?.content?.trim() || values?.attachment?.ids?.length || values?.topic)) {
      throw new Error('即刻原生编辑器已有草稿，请先处理原草稿后再发送');
    }
    if (files.length && !form) throw new Error('即刻图片上传入口尚未就绪，请稍后重试');
    ed.dataset.jfPrepared = signature;
    const paragraphs = [{
      children: text ? [{ detail: 0, format: 0, mode: 'normal', style: '', text, type: 'text', version: 1 }] : [],
      direction: null, format: '', indent: 0, type: 'paragraph', version: 1, textFormat: 0, textStyle: ''
    }];
    const editor = ed.__lexicalEditor;
    editor.setEditorState(editor.parseEditorState(JSON.stringify(editorState || {
      root: { children: paragraphs, direction: null, format: '', indent: 0, type: 'root', version: 1 }
    })));
    // 重试时清理本次准备的附件，避免重复添加。
    if (form) {
      form.setValue('attachment', { ids: [], map: {} });
      form.setValue('topic', topic || undefined, { shouldDirty: true });
    }
    if (files.length) {
      const drop = fiberData(fileInput, p => Array.isArray(p.accept) && typeof p.onDrop === 'function');
      if (!drop) throw new Error('即刻图片上传入口尚未就绪');
      message('正在上传图片…');
      await drop.onDrop(files);
      await waitUntil(() => {
        const attachment = form.getValues('attachment');
        const items = (attachment?.ids || []).map(id => attachment.map[id]);
        if (items.some(item => /FAIL|ERROR/i.test(item?.status || ''))) throw new Error('图片上传失败，草稿已保留');
        return items.length === files.length && items.every(item => item?.status === 'UPLOADED');
      }, 60000, '图片上传超时，草稿已保留');
    }
    const button = $('[class*=_postForm] [class*=_submitButton]');
    await waitUntil(() => button && !button.disabled, 5000, '即刻暂时无法发送，请检查内容后重试');
    message('正在发送…');
    const submitCount = formProps()?.formState?.submitCount || 0;
    button.click();
    // 等原生表单提交成功并清空后再清除本地草稿。
    await waitUntil(() => {
      if (!ed.isConnected) throw new Error('页面已切换，请检查发送结果；草稿已保留');
      const current = formProps();
      if (current?.formState?.submitCount > submitCount && current.formState.isSubmitSuccessful) return true;
      const value = current?.getValues();
      return value && !value.content?.trim() && !value.attachment?.ids?.length;
    }, 30000, '尚未确认发送结果，请检查动态；本地草稿已保留');
    return 'sent';
  }

  /* ================= 主流程 ================= */

  function restyle() {
    document.documentElement.classList.add('jf-on');
    const p = location.pathname;
    document.body.dataset.jfRoute =
      isMyPage() ? 'me' : (p === '/' || p === '/following') ? 'following' : 'other';
  }

  let timer = null;
  async function tick() {
    if (lifecycle.signal.aborted) return;
    restyle();
    buildSidebar();
    buildComposer();
    markActiveNav();
    // 原生容器宽度由 CSS 统一，composer 与主列对齐，空列表也有效。
    const main = $('[class*=_mainContainer]');
    if (main) {
      const r = main.getBoundingClientRect();
      document.documentElement.style.setProperty('--jf-main-left', r.left + 'px');
      document.documentElement.style.setProperty('--jf-main-w-real', r.width + 'px');
    }
    dataManager.maybeInitialize();
    await scanFeed();
    await refreshSidebarStats();
    // 只有用户按过发送才续发；在当前唯一的发送逻辑中处理，避免重复提交。
    if (sessionStorage.getItem('jf-pending-send') && $('[class*=_postForm] [data-lexical-editor]')) {
      const composer = $('#' + COMPOSER_ID);
      if (composer?._jfSubmit) {
        sessionStorage.removeItem('jf-pending-send');
        composer._jfSubmit();
      }
    }
  }

  function schedule() {
    if (timer) return;
    timer = setTimeout(() => { timer = null; tick(); }, 500);
  }

  const mutationObserver = new MutationObserver(schedule);
  mutationObserver.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('resize', schedule, { signal: lifecycle.signal });
  window.__JF_CLEANUP__ = () => {
    lifecycle.abort();
    clearComposerLayout();
    mutationObserver.disconnect();
    clearTimeout(timer);
  };

  // 裸域 → /me（即刻默认落地 /following，这里按用户要求改）
  if (location.pathname === '/') {
    window.__TSR_ROUTER__?.navigate?.({ to: '/me' }) ?? location.replace('/me');
  }

  dataManager = window.JF_SYNC.create({
    signal: lifecycle.signal, getProfile: myProfile, ownProfilePath, isMyPage,
    getFeed: profileFeed, serialize: serializePost, refresh: refreshSidebarStats,
    drainScan: async () => { if (scanTask) await scanTask; }, resetScanned,
  });

  tick();
})();
