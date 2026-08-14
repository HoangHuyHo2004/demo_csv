import { getSession, signIn, signUp } from './auth.js';

// Sanitize the `next` redirect target. It comes from the URL, so it must
// never be trusted as-is -- accepting an arbitrary value here would be an
// open redirect. Only a bare "somepage.html" filename is allowed; anything
// else (a protocol, a host, a path with slashes) falls back to index.html.
function safeNext() {
  const raw = new URLSearchParams(location.search).get('next') || '';
  return /^[a-z0-9_-]+\.html$/i.test(raw) ? raw : 'index.html';
}

const form = document.getElementById('auth-form');
const errorEl = document.getElementById('auth-error');
const noticeEl = document.getElementById('auth-notice');
const hintEl = document.getElementById('auth-hint');
const submitBtn = document.getElementById('auth-submit');
const nameField = document.getElementById('field-name');
const tabs = document.querySelectorAll('.auth-tabs button');

const passwordInput = document.getElementById('password');
const confirmField = document.getElementById('field-confirm');
const confirmInput = document.getElementById('confirm-password');
const mismatchEl = document.getElementById('pw-mismatch');
const strengthBox = document.getElementById('pw-strength');
const strengthFill = document.getElementById('pw-strength-fill');
const strengthLabel = document.getElementById('pw-strength-label');
const ruleItems = document.querySelectorAll('#pw-rules li');

let mode = 'signin';

// Same 4 rules shown in the reference design: length, case mix, a digit, a
// symbol. Kept in one place so the live checklist and the submit gate can
// never disagree about what "meets the policy" means.
function passwordRules(pw) {
  return {
    length: pw.length >= 8,
    case: /[a-z]/.test(pw) && /[A-Z]/.test(pw),
    number: /[0-9]/.test(pw),
    symbol: /[^A-Za-z0-9]/.test(pw),
  };
}
function passwordMeetsPolicy(pw) {
  const r = passwordRules(pw);
  return r.length && r.case && r.number && r.symbol;
}

const STRENGTH = [
  { label: '', className: '' },
  { label: 'Weak', className: 'weak' },
  { label: 'Fair', className: 'fair' },
  { label: 'Strong', className: 'strong' },
  { label: 'Very Strong', className: 'very-strong' },
];

function updatePasswordUI() {
  const pw = passwordInput.value;
  const rules = passwordRules(pw);
  let metCount = 0;
  ruleItems.forEach((li) => {
    const met = rules[li.dataset.rule];
    li.classList.toggle('met', met);
    if (met) metCount += 1;
  });
  const s = STRENGTH[pw ? metCount : 0];
  strengthFill.style.width = pw ? `${(metCount / 4) * 100}%` : '0%';
  strengthFill.className = `pw-strength-fill ${s.className}`;
  strengthLabel.textContent = s.label;
  strengthLabel.className = s.className;
  updateConfirmUI();
  updateSubmitState();
}

function updateConfirmUI() {
  const mismatch = confirmInput.value.length > 0 && confirmInput.value !== passwordInput.value;
  mismatchEl.classList.toggle('show', mismatch);
}

// Only signup is gated on the checklist -- an existing account's password
// was valid under whatever policy was live when it was created, and
// sign-in must keep working for it regardless of today's rules.
function updateSubmitState() {
  if (mode !== 'signup') { submitBtn.disabled = false; return; }
  const ok = passwordMeetsPolicy(passwordInput.value) && confirmInput.value.length > 0 && confirmInput.value === passwordInput.value;
  submitBtn.disabled = !ok;
}

passwordInput.addEventListener('input', updatePasswordUI);
confirmInput.addEventListener('input', () => { updateConfirmUI(); updateSubmitState(); });

function wireToggle(btnId, inputEl) {
  document.getElementById(btnId).addEventListener('click', () => {
    inputEl.type = inputEl.type === 'password' ? 'text' : 'password';
  });
}
wireToggle('password-toggle', passwordInput);
wireToggle('confirm-password-toggle', confirmInput);

function showError(message) {
  errorEl.textContent = message;
  errorEl.classList.add('show');
  noticeEl.classList.remove('show');
}

function showNotice(message) {
  noticeEl.textContent = message;
  noticeEl.classList.add('show');
  errorEl.classList.remove('show');
}

function clearMessages() {
  errorEl.classList.remove('show');
  noticeEl.classList.remove('show');
}

function friendlyError(error) {
  const msg = error?.message || 'Something went wrong. Please try again.';
  if (/invalid login credentials/i.test(msg)) return 'Invalid email or password.';
  if (/user already registered/i.test(msg)) return 'An account with this email already exists — sign in instead.';
  if (/password.*at least/i.test(msg)) return msg;
  // handle_new_user()'s trigger exception for an uninvited email (see
  // supabase/migrations/20260814000000_email_invites.sql) -- match both
  // the raw message (in case Supabase passes it through as-is) and its
  // generic "Database error saving new user" wrapper, since that generic
  // wrapper can only mean the invite gate here (nothing else in that
  // trigger can fail).
  if (/not been invited/i.test(msg) || /database error saving new user/i.test(msg)) {
    return "This email hasn't been invited by the Owner. Ask them to send you an invite first.";
  }
  return msg;
}

// Switches the sign-in/create-account UI without touching the error/notice
// banners -- callers that need to clear messages do so explicitly. This
// split matters because signup-success also calls setMode('signin') to
// send the visitor back to the sign-in tab, and that call must NOT wipe
// the "check your email" notice it just set.
function setMode(newMode) {
  mode = newMode;
  tabs.forEach((b) => b.classList.toggle('active', b.dataset.mode === newMode));
  nameField.style.display = newMode === 'signup' ? '' : 'none';
  strengthBox.style.display = newMode === 'signup' ? '' : 'none';
  confirmField.style.display = newMode === 'signup' ? '' : 'none';
  passwordInput.autocomplete = newMode === 'signup' ? 'new-password' : 'current-password';
  submitBtn.textContent = newMode === 'signup' ? 'Create account' : 'Sign in';
  updateSubmitState();
}

tabs.forEach((btn) => {
  btn.addEventListener('click', () => {
    setMode(btn.dataset.mode);
    clearMessages();
  });
});

// If a session already exists, don't show the login form at all.
getSession().then((session) => {
  if (session) location.replace(safeNext());
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  // Belt-and-suspenders: the button is already disabled while this fails,
  // but a disabled button can still be triggered programmatically (e.g.
  // pressing Enter in some browsers), so re-check before ever calling
  // Supabase.
  if (mode === 'signup' && !passwordMeetsPolicy(passwordInput.value)) {
    showError('Password does not meet the requirements above.');
    return;
  }
  if (mode === 'signup' && confirmInput.value !== passwordInput.value) {
    showError("Passwords don't match.");
    return;
  }
  clearMessages();
  submitBtn.disabled = true;

  // Free-tier Supabase projects pause after ~7 days idle; the first
  // request after a pause can hang for several seconds. Give the visitor
  // a reason to keep waiting instead of assuming the page is broken.
  const hintTimer = setTimeout(() => hintEl.classList.add('show'), 4000);

  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const displayName = document.getElementById('display-name').value.trim();

  try {
    if (mode === 'signup') {
      const data = await signUp(email, password, displayName || email);
      if (!data.session) {
        setMode('signin');
        showNotice('Check your email to confirm your account, then sign in.');
      } else {
        location.href = safeNext();
      }
    } else {
      await signIn(email, password);
      location.href = safeNext();
    }
  } catch (err) {
    showError(friendlyError(err));
  } finally {
    clearTimeout(hintTimer);
    hintEl.classList.remove('show');
    updateSubmitState();
  }
});
