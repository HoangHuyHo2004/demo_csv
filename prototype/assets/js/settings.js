// Controller for settings.html's Team members card: real member list +
// real invite creation, backed by public.profiles/public.invites.
// Previously both the member table and the "Send invite" form were
// static mockups -- the table showed two invented people, and the form
// did nothing when clicked. "Create account" is now gated by
// public.invites (see handle_new_user() in
// supabase/migrations/20260814000000_email_invites.sql), so this page
// is the only real way to invite someone.
import { requireSession } from './auth.js';
import { listProfiles, listInvites, createInvite, cancelInvite } from './data.js';
import { formatDateDMY } from './fmt.js';
import { t, applyTranslations, onChange as onLanguageChange } from './i18n.js';

let currentUserId = null;
let isOwner = false;

const tbody = document.getElementById('team-tbody');
const inviteRow = document.getElementById('invite-row');
const emailInput = document.getElementById('invite-email');
const roleSelect = document.getElementById('invite-role');
const submitBtn = document.getElementById('invite-submit');
const errorEl = document.getElementById('invite-error');

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

init();

async function init() {
  const result = await requireSession();
  if (!result) return;
  currentUserId = result.session.user.id;
  isOwner = result.profile?.role === 'owner';
  inviteRow.style.display = isOwner ? '' : 'none';

  wireInviteForm();
  await refresh();
  onLanguageChange(() => { applyTranslations(document); render(); });
}

let profiles = [];
let invites = [];

async function refresh() {
  [profiles, invites] = await Promise.all([listProfiles(), listInvites()]);
  render();
}

function render() {
  const memberRows = profiles.map((p) => `
    <tr>
      <td><span class="avatar-sm ${p.role === 'owner' ? 'own' : 'acc'}"></span>${escapeHtml(p.display_name || p.email)}</td>
      <td><span class="role-pill ${p.role === 'owner' ? 'owner' : 'acc'}">${p.role === 'owner' ? t('common.owner') : t('common.accountant')}</span></td>
      <td>${escapeHtml(p.email || '—')}</td>
      <td>${p.created_at ? formatDateDMY(p.created_at.slice(0, 10)) : '—'}</td>
      <td></td>
    </tr>`);

  const inviteRows = invites.map((inv) => `
    <tr>
      <td>${escapeHtml(inv.email)}</td>
      <td>
        <span class="role-pill ${inv.role === 'owner' ? 'owner' : 'acc'}">${inv.role === 'owner' ? t('common.owner') : t('common.accountant')}</span>
        <span class="role-pill" style="background:var(--chip);color:var(--muted);margin-left:4px">${t('settings.team.pending')}</span>
      </td>
      <td>—</td>
      <td>${inv.created_at ? formatDateDMY(inv.created_at.slice(0, 10)) : '—'}</td>
      <td style="text-align:right"><button type="button" class="cancel-invite-btn" data-email="${escapeHtml(inv.email)}" style="padding:5px 10px;border-radius:6px;background:var(--surface-soft);font-size:11px;font-weight:600;color:var(--ink-2)">${t('settings.team.cancelInvite')}</button></td>
    </tr>`);

  tbody.innerHTML = memberRows.join('') + inviteRows.join('') || `<tr><td colspan="5">${t('settings.team.empty')}</td></tr>`;

  tbody.querySelectorAll('.cancel-invite-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      await cancelInvite(btn.dataset.email);
      await refresh();
    });
  });
}

function wireInviteForm() {
  submitBtn.addEventListener('click', async () => {
    errorEl.style.display = 'none';
    const email = emailInput.value.trim().toLowerCase();
    const role = roleSelect.value;

    if (!email || !email.includes('@')) {
      errorEl.textContent = t('settings.team.errorInvalidEmail');
      errorEl.style.display = 'block';
      return;
    }
    if (profiles.some((p) => (p.email || '').toLowerCase() === email)) {
      errorEl.textContent = t('settings.team.errorAlreadyMember');
      errorEl.style.display = 'block';
      return;
    }

    submitBtn.disabled = true;
    const { ok, code } = await createInvite({ email, role, invitedBy: currentUserId });
    submitBtn.disabled = false;

    if (!ok) {
      errorEl.textContent = code === 'duplicate_email'
        ? t('settings.team.errorAlreadyInvited')
        : t('settings.team.errorInviteFailed');
      errorEl.style.display = 'block';
      return;
    }

    emailInput.value = '';
    roleSelect.selectedIndex = 0;
    await refresh();
  });
}
