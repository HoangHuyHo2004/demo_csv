// index.html only. Shows a setup overlay when the signed-in visitor is not
// an Owner and has no accessible stations -- i.e. they are either the very
// first person here (should become Owner) or an unassigned accountant
// (bootstrap_first_owner() will reject them if an Owner already exists, and
// the overlay explains why instead of leaving them stuck on a blank
// dashboard with no path forward).
import { requireSession, clearProfileCache } from './auth.js';
import { supabase } from './supabase-client.js';
import { listStations } from './data.js';
import { t, onChange as onLanguageChange } from './i18n.js';

(async function () {
  const result = await requireSession();
  if (!result) return;
  const { session, profile } = result;

  if (profile?.role === 'owner') return;

  const accessible = await listStations();
  if (accessible.length > 0) return;

  const host = document.createElement('div');
  document.body.appendChild(host);

  // Tracks which step is on screen so a mid-setup language switch
  // re-renders the same step (with whatever the visitor already typed
  // into the station-name/code fields preserved) instead of silently
  // staying in English.
  let step = 1;
  let draftName = '';
  let draftCode = '';

  renderStep1();
  onLanguageChange(() => { step === 1 ? renderStep1() : renderStep2(); });

  function renderStep1() {
    step = 1;
    host.innerHTML = `
      <div class="first-run">
        <div class="first-run__card">
          <div class="first-run__icon">⛽</div>
          <h2>${t('firstRun.step1.heading')}</h2>
          <p>${t('firstRun.step1.body')}</p>
          <div class="first-run__error" id="fr-error"></div>
          <button type="button" class="first-run__cta" id="fr-become-owner">${t('firstRun.step1.cta')}</button>
        </div>
      </div>`;
    document.getElementById('fr-become-owner').addEventListener('click', becomeOwner);
  }

  async function becomeOwner() {
    const btn = document.getElementById('fr-become-owner');
    const errEl = document.getElementById('fr-error');
    errEl.classList.remove('show');
    btn.disabled = true;
    btn.textContent = t('firstRun.step1.ctaBusy');

    const { error } = await supabase.rpc('bootstrap_first_owner');
    if (error) {
      errEl.textContent = /already exists/i.test(error.message)
        ? t('firstRun.step1.errorOwnerExists')
        : error.message;
      errEl.classList.add('show');
      btn.disabled = false;
      btn.textContent = t('firstRun.step1.cta');
      return;
    }

    clearProfileCache(session.user.id);

    const stationsNow = await listStations();
    if (stationsNow.length > 0) {
      location.reload();
      return;
    }
    renderStep2();
  }

  function renderStep2() {
    step = 2;
    host.innerHTML = `
      <div class="first-run">
        <div class="first-run__card">
          <div class="first-run__icon">⛽</div>
          <h2>${t('firstRun.step2.heading')}</h2>
          <p>${t('firstRun.step2.body')}</p>
          <div class="first-run__error" id="fr-error"></div>
          <div class="first-run__field">
            <label for="fr-name">${t('firstRun.step2.nameLabel')}</label>
            <input type="text" id="fr-name" placeholder="${t('firstRun.step2.namePlaceholder')}" value="${escapeHtmlAttr(draftName)}" />
          </div>
          <div class="first-run__field">
            <label for="fr-code">${t('firstRun.step2.codeLabel')}</label>
            <input type="text" id="fr-code" placeholder="${t('firstRun.step2.codePlaceholder')}" value="${escapeHtmlAttr(draftCode)}" />
          </div>
          <button type="button" class="first-run__cta" id="fr-create-station">${t('firstRun.step2.cta')}</button>
        </div>
      </div>`;
    document.getElementById('fr-name').addEventListener('input', (e) => { draftName = e.target.value; });
    document.getElementById('fr-code').addEventListener('input', (e) => { draftCode = e.target.value; });
    document.getElementById('fr-create-station').addEventListener('click', createStation);
  }

  async function createStation() {
    const btn = document.getElementById('fr-create-station');
    const errEl = document.getElementById('fr-error');
    const name = document.getElementById('fr-name').value.trim();
    const code = document.getElementById('fr-code').value.trim();
    errEl.classList.remove('show');

    if (!name) {
      errEl.textContent = t('firstRun.step2.errorNameRequired');
      errEl.classList.add('show');
      return;
    }

    btn.disabled = true;
    btn.textContent = t('firstRun.step2.ctaBusy');
    const { error } = await supabase.from('stations').insert({
      name,
      code: code || null,
      created_by: session.user.id,
    });
    if (error) {
      errEl.textContent = error.message;
      errEl.classList.add('show');
      btn.disabled = false;
      btn.textContent = t('firstRun.step2.cta');
      return;
    }
    location.reload();
  }
})();

function escapeHtmlAttr(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
