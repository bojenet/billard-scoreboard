(function () {
  if (window.__userMenuInitialized) return;
  window.__userMenuInitialized = true;

  const style = document.createElement('style');
  style.textContent = `
    .user-menu-wrap {
      position: fixed;
      top: 18px;
      right: 18px;
      z-index: 20000;
      font-family: 'Segoe UI', Arial, sans-serif;
    }

    .user-menu-btn {
      width: 44px;
      height: 44px;
      border-radius: 50%;
      border: 1px solid #3659bb;
      background: linear-gradient(180deg, #2f4fe0, #1c3380);
      color: white;
      font-size: 20px;
      font-weight: 700;
      cursor: pointer;
      box-shadow: 0 10px 26px rgba(0, 0, 0, 0.35);
    }

    .user-menu-panel {
      position: absolute;
      top: 52px;
      right: 0;
      width: min(320px, calc(100vw - 28px));
      border-radius: 14px;
      border: 1px solid #2f4ea0;
      background: linear-gradient(180deg, #162b66, #0f1c3f);
      box-shadow: 0 18px 40px rgba(0, 0, 0, 0.45);
      color: white;
      overflow: hidden;
      display: none;
    }

    .user-menu-panel.open {
      display: block;
    }

    .user-menu-head {
      padding: 12px 14px;
      border-bottom: 1px solid #27417f;
    }

    .user-menu-name {
      font-size: 15px;
      font-weight: 700;
      line-height: 1.3;
      word-break: break-word;
    }

    .user-menu-sub {
      margin-top: 3px;
      font-size: 13px;
      opacity: 0.78;
      word-break: break-word;
    }

    .user-menu-actions {
      padding: 10px;
      display: grid;
      gap: 8px;
    }

    .user-menu-action {
      border: none;
      border-radius: 10px;
      padding: 10px 12px;
      text-align: left;
      background: #1c3380;
      border: 1px solid #3458b8;
      color: white;
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
    }

    .user-menu-action:hover {
      filter: brightness(1.08);
    }

    .user-menu-action.logout {
      background: #8c2d2d;
      border-color: #b54e4e;
    }
  `;
  document.head.appendChild(style);

  async function init() {
    if (typeof window.supabaseClient === 'undefined') return;
    if (typeof window.getCurrentUser !== 'function') return;

    const user = await getCurrentUser();
    if (!user) return;

    let role = 'member';
    if (typeof window.hasAdminAccess === 'function') {
      const admin = await hasAdminAccess(user);
      role = admin ? 'admin' : 'member';
    }

    const wrap = document.createElement('div');
    wrap.className = 'user-menu-wrap';

    const btn = document.createElement('button');
    btn.className = 'user-menu-btn';
    btn.type = 'button';
    btn.title = 'Benutzer';
    btn.setAttribute('aria-label', 'Benutzermenü öffnen');
    btn.textContent = '☰';

    const panel = document.createElement('div');
    panel.className = 'user-menu-panel';

    const displayName = typeof window.getDisplayName === 'function' ? getDisplayName(user) : (user.email || user.id);

    panel.innerHTML = `
      <div class="user-menu-head">
        <div class="user-menu-name">${displayName || '-'}</div>
        <div class="user-menu-sub">${user.email || '-'}</div>
        <div class="user-menu-sub">Rolle: ${role}</div>
      </div>
      <div class="user-menu-actions">
        <button class="user-menu-action logout" type="button">Logout</button>
      </div>
    `;

    const logoutBtn = panel.querySelector('.logout');
    logoutBtn.addEventListener('click', async () => {
      if (typeof window.signOutAndRedirect === 'function') {
        await signOutAndRedirect();
      } else {
        const { error } = await supabaseClient.auth.signOut({ scope: 'global' });
        if (error) console.error(error);
        window.location.replace('/login.html?logged_out=1');
      }
    });

    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      panel.classList.toggle('open');
    });

    document.addEventListener('click', (event) => {
      if (!wrap.contains(event.target)) {
        panel.classList.remove('open');
      }
    });

    wrap.appendChild(btn);
    wrap.appendChild(panel);
    document.body.appendChild(wrap);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
