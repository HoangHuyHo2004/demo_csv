// index.html only. Shows a setup overlay when the signed-in visitor is not
// an Owner and has no accessible stations -- i.e. they are either the very
// first person here (should become Owner) or an unassigned accountant
// (bootstrap_first_owner() will reject them if an Owner already exists, and
// the overlay explains why instead of leaving them stuck on a blank
// dashboard with no path forward).
import { requireSession, clearProfileCache } from './auth.js';
import { supabase } from './supabase-client.js';
import { listStations } from './data.js';

(async function () {
  const result = await requireSession();
  if (!result) return;
  const { session, profile } = result;

  if (profile?.role === 'owner') return;

  const accessible = await listStations();
  if (accessible.length > 0) return;

  const host = document.createElement('div');
  document.body.appendChild(host);
  renderStep1();

  function renderStep1() {
    host.innerHTML = `
      <div class="first-run">
        <div class="first-run__card">
          <div class="first-run__icon">⛽</div>
          <h2>Set up Demo_CSV</h2>
          <p>No one owns this workspace yet. Become the Owner to get full access and create your first station.</p>
          <div class="first-run__error" id="fr-error"></div>
          <button type="button" class="first-run__cta" id="fr-become-owner">Become the Owner</button>
        </div>
      </div>`;
    document.getElementById('fr-become-owner').addEventListener('click', becomeOwner);
  }

  async function becomeOwner() {
    const btn = document.getElementById('fr-become-owner');
    const errEl = document.getElementById('fr-error');
    errEl.classList.remove('show');
    btn.disabled = true;
    btn.textContent = 'Setting up…';

    const { error } = await supabase.rpc('bootstrap_first_owner');
    if (error) {
      errEl.textContent = /already exists/i.test(error.message)
        ? 'An owner already exists for this workspace. Ask them to add you to a station.'
        : error.message;
      errEl.classList.add('show');
      btn.disabled = false;
      btn.textContent = 'Become the Owner';
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
    host.innerHTML = `
      <div class="first-run">
        <div class="first-run__card">
          <div class="first-run__icon">⛽</div>
          <h2>Create your first station</h2>
          <p>You're the Owner now. Add a location to start tracking data.</p>
          <div class="first-run__error" id="fr-error"></div>
          <div class="first-run__field">
            <label for="fr-name">Station name</label>
            <input type="text" id="fr-name" placeholder="e.g. Station A · Quận 1" />
          </div>
          <div class="first-run__field">
            <label for="fr-code">Short code</label>
            <input type="text" id="fr-code" placeholder="STN-A" />
          </div>
          <button type="button" class="first-run__cta" id="fr-create-station">Create station</button>
        </div>
      </div>`;
    document.getElementById('fr-create-station').addEventListener('click', createStation);
  }

  async function createStation() {
    const btn = document.getElementById('fr-create-station');
    const errEl = document.getElementById('fr-error');
    const name = document.getElementById('fr-name').value.trim();
    const code = document.getElementById('fr-code').value.trim();
    errEl.classList.remove('show');

    if (!name) {
      errEl.textContent = 'Station name is required.';
      errEl.classList.add('show');
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Creating…';
    const { error } = await supabase.from('stations').insert({
      name,
      code: code || null,
      created_by: session.user.id,
    });
    if (error) {
      errEl.textContent = error.message;
      errEl.classList.add('show');
      btn.disabled = false;
      btn.textContent = 'Create station';
      return;
    }
    location.reload();
  }
})();
