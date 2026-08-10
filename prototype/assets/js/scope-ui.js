// Wires the header "scope switcher" button into scope.js. No-ops on pages
// that don't have the #scope-switcher element (currently stations.html).
import * as scope from './scope.js';

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export async function mountScopeSwitcher(userId, isOwner) {
  const root = document.getElementById('scope-switcher');
  if (!root) return;

  const btn = root.querySelector('.scope-switcher__btn');
  const label = root.querySelector('.scope-switcher__label');
  const dot = root.querySelector('.scope-switcher__dot');
  const menu = root.querySelector('.scope-switcher__menu');

  await scope.init(userId, { isOwner });
  render();

  function openMenu() {
    renderMenuItems();
    menu.removeAttribute('hidden');
    btn.setAttribute('aria-expanded', 'true');
  }

  function closeMenu() {
    menu.setAttribute('hidden', '');
    btn.setAttribute('aria-expanded', 'false');
  }

  function renderMenuItems() {
    const list = scope.stations();
    const cur = scope.current();
    let html = '';
    if (isOwner) {
      html += `<li class="scope-switcher__item${cur.mode === 'all' ? ' active' : ''}" data-value="all"><span class="dot" style="background:#0f2a1f"></span>All stations</li>`;
    }
    if (list.length === 0) {
      html += `<li class="scope-switcher__empty">No stations yet</li>`;
    } else {
      list.forEach((s) => {
        const isActive = cur.mode === 'station' && cur.stationId === s.id;
        html += `<li class="scope-switcher__item${isActive ? ' active' : ''}" data-value="${s.id}"><span class="dot" style="background:${s.color || '#3455b3'}"></span>${escapeHtml(s.name)}</li>`;
      });
    }
    menu.innerHTML = html;
    menu.querySelectorAll('[data-value]').forEach((li) => {
      li.addEventListener('click', () => {
        scope.set(li.dataset.value);
        closeMenu();
      });
    });
  }

  function render() {
    const cur = scope.current();
    if (cur.mode === 'all' && isOwner) {
      label.textContent = 'All stations';
      dot.style.background = '#0f2a1f';
    } else if (cur.station) {
      label.textContent = cur.station.name;
      dot.style.background = cur.station.color || '#3455b3';
    } else {
      // mode === 'all' here only happens for a non-Owner with zero
      // accessible stations -- "All stations" would overstate what they
      // can actually see, so say so plainly instead.
      label.textContent = 'No station access';
      dot.style.background = '#8a978f';
    }
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (menu.hasAttribute('hidden')) openMenu(); else closeMenu();
  });
  menu.addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', () => closeMenu());

  scope.onChange(render);
}
