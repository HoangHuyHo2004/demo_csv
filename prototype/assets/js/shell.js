(function(){
  var NAV_ITEMS_MAIN = [
    { key: 'overview',   href: 'index.html',      i18n: 'shell.nav.overview',   label: 'Overview',   icon: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>' },
    { key: 'statistics', href: 'statistics.html', i18n: 'shell.nav.statistics', label: 'Statistics', icon: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>' },
    { key: 'metrics',    href: 'metrics.html',    i18n: 'shell.nav.metrics',    label: 'Metrics',    icon: '<circle cx="9" cy="8" r="4"/><path d="M2 21c1-4 5-6 7-6s6 2 7 6M17 11a3 3 0 100-6M23 21c-.6-2.4-2.3-4-4-4.8"/>' },
    { key: 'stations',   href: 'stations.html',   i18n: 'shell.nav.stations',   label: 'Stations',   icon: '<path d="M3 21h18M5 21V10l7-6 7 6v11M9 21v-6h6v6"/>', badge: '2' },
    { key: 'uploads',    href: 'uploads.html',    i18n: 'shell.nav.uploads',    label: 'Uploads',    icon: '<path d="M20 7h-6L12 5H4v14h16V7z"/>' },
    { key: 'alerts',     href: 'alerts.html',     i18n: 'shell.nav.alerts',     label: 'Alerts',     icon: '<path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>', badge: '13' },
    { key: 'insights',   href: 'insights.html',   i18n: 'shell.nav.insights',   label: 'Insights',   icon: '<path d="M3 3h18v4H3zM3 10h18v4H3zM3 17h18v4H3z"/>' }
  ];
  var NAV_ITEMS_GENERAL = [
    { key: 'settings', href: 'settings.html', i18n: 'shell.nav.settings', label: 'Settings', icon: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" stroke-linecap="round" stroke-linejoin="round"/>' },
    { key: 'security', href: 'security.html', i18n: 'shell.nav.security', label: 'Security', icon: '<path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z"/>' }
  ];

  // The label span has a plain-English fallback baked in (like the "Menu"/
  // "General" side-labels below already did) instead of being left empty
  // for i18n.js to fill in later -- if applyTranslations() is ever slow,
  // errors, or races behind first paint, the nav showed icon-only rows
  // with no text at all rather than briefly-wrong-language text.
  function navLinkHtml(item, activeKey){
    var cls = item.key === activeKey ? ' class="active"' : '';
    var badge = item.badge ? '<span class="badge">' + item.badge + '</span>' : '';
    return '<a' + cls + ' href="' + item.href + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' + item.icon + '</svg><span data-i18n="' + item.i18n + '">' + item.label + '</span>' + badge + '</a>';
  }

  function sidebarHtml(activeKey){
    var mainNav = NAV_ITEMS_MAIN.map(function(item){ return navLinkHtml(item, activeKey); }).join('\n      ');
    var generalNav = NAV_ITEMS_GENERAL.map(function(item){ return navLinkHtml(item, activeKey); }).join('\n      ');
    return '' +
      '<div class="brand">\n' +
      '  <svg class="brand-mark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M2 12h20M4.5 4.5l15 15M19.5 4.5l-15 15"/></svg>\n' +
      '  <div class="brand-name">Demo_CSV</div>\n' +
      '</div>\n' +
      '<div class="side-label" data-i18n="shell.menuLabel">Menu</div>\n' +
      '<nav class="nav">\n' +
      '      ' + mainNav + '\n' +
      '</nav>\n' +
      '<div class="side-label" data-i18n="shell.generalLabel">General</div>\n' +
      '<nav class="nav">\n' +
      '      ' + generalNav + '\n' +
      '</nav>\n' +
      '<div class="profile" data-shell="profile">\n' +
      '  <div class="avatar"></div>\n' +
      '  <div>\n' +
      '    <div class="who" data-shell="profile-name" data-i18n="shell.ownerAccount">Owner Account</div>\n' +
      '    <div class="mail" data-shell="profile-email">hoanghuyho2810@gmail.com</div>\n' +
      '  </div>\n' +
      '  <button type="button" class="signout-btn" data-shell="signout" data-i18n-title="shell.signOut" title="Sign out">\n' +
      '    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>\n' +
      '  </button>\n' +
      '</div>';
  }

  // Set by guard.js after it confirms a session; the button below calls
  // whatever was last registered here. shell.js itself knows nothing about
  // Supabase -- it stays a plain, dependency-free script.
  var signOutHandler = null;

  function mountShell(){
    var placeholder = document.querySelector('aside[data-shell="sidebar"]');
    if(!placeholder) return;
    var activeKey = document.body.getAttribute('data-shell-active') || '';
    placeholder.innerHTML = sidebarHtml(activeKey);

    var signoutBtn = placeholder.querySelector('[data-shell="signout"]');
    if(signoutBtn){
      signoutBtn.addEventListener('click', function(){
        if(signOutHandler) signOutHandler();
      });
    }
  }

  function setProfile(name, email){
    var placeholder = document.querySelector('aside[data-shell="sidebar"]');
    if(!placeholder) return;
    var nameEl = placeholder.querySelector('[data-shell="profile-name"]');
    var emailEl = placeholder.querySelector('[data-shell="profile-email"]');
    if(nameEl) nameEl.textContent = name;
    if(emailEl) emailEl.textContent = email;
  }

  function onSignOut(cb){
    signOutHandler = cb;
  }

  window.DemoCSVShell = { mountShell: mountShell, setProfile: setProfile, onSignOut: onSignOut };

  document.addEventListener('DOMContentLoaded', mountShell);
})();
