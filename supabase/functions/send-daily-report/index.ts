// Daily report dispatcher — Telegram.
//
// Invoked hourly by pg_cron. Finds subscriptions due this hour, builds a
// summary of the most recent day that actually has data, and sends it.
//
// ─────────────────────────────────────────────────────────────────────────
// SECURITY — the one thing that must not be got wrong
//
// This function runs as service_role, which BYPASSES Row Level Security. Every
// other data path in Demo_CSV is protected by RLS; this one is not, because
// there is no signed-in user at 07:00. So access has to be re-derived here,
// explicitly, per subscriber:
//
//   accessibleStations(userId) → owner ? every station : their station_members
//
// A naive `select * from metric_daily` would mail every station's revenue to
// every accountant. The subscription row is NOT trusted to say what it may
// read — it is re-checked against live membership on every send, so revoking
// an accountant's station access also silently narrows their next report.
// ─────────────────────────────────────────────────────────────────────────
import { createClient } from 'jsr:@supabase/supabase-js@2';

const TZ = 'Asia/Ho_Chi_Minh';
const APP_URL = Deno.env.get('APP_URL') ?? 'https://hoanghuyho2004.github.io/demo_csv/prototype';
const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
);

const nf = (n: number, d = 0) =>
  Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

/** Current wall-clock hour and weekday in the workspace timezone. */
function localNow() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, hour: '2-digit', weekday: 'short', hour12: false,
  }).formatToParts(new Date());
  return {
    hour: Number(parts.find((p) => p.type === 'hour')!.value),
    weekday: parts.find((p) => p.type === 'weekday')!.value, // Mon…Sun
  };
}

/** Stations this user may see — re-derived live, never taken from the subscription. */
async function accessibleStations(userId: string): Promise<string[]> {
  const { data: profile } = await admin
    .from('profiles').select('role').eq('id', userId).maybeSingle();

  if (profile?.role === 'owner') {
    const { data } = await admin.from('stations').select('id').is('archived_at', null);
    return (data ?? []).map((s) => s.id);
  }
  const { data } = await admin
    .from('station_members').select('station_id').eq('user_id', userId);
  return (data ?? []).map((m) => m.station_id);
}

/** The most recent day that has data, per the chosen "latest day with data" rule. */
async function latestDayWithData(stationIds: string[]) {
  if (!stationIds.length) return null;
  const { data } = await admin
    .from('metric_daily')
    .select('value_date')
    .in('station_id', stationIds)
    .order('value_date', { ascending: false })
    .limit(1);
  return data?.[0]?.value_date ?? null;
}

async function buildReport(stationIds: string[]) {
  const date = await latestDayWithData(stationIds);
  if (!date) return null;

  const { data: rows } = await admin
    .from('metric_daily')
    .select('metric_name, value')
    .in('station_id', stationIds)
    .eq('value_date', date);

  const sum = (pred: (n: string) => boolean) =>
    (rows ?? []).filter((r) => pred(r.metric_name)).reduce((s, r) => s + Number(r.value), 0);

  const amount = sum((n) => n.startsWith('tt_'));
  const litres = sum((n) => n.startsWith('sl_') && n.includes('_tru'));

  // Busiest pump that day — a single concrete detail beats another total.
  const pumps = (rows ?? [])
    .filter((r) => r.metric_name.startsWith('sl_') && r.metric_name.includes('_tru'))
    .sort((a, b) => Number(b.value) - Number(a.value));
  const top = pumps[0];

  return { date, amount, litres, avg: litres ? amount / litres : null, top };
}

function render(r: NonNullable<Awaited<ReturnType<typeof buildReport>>>, stale: boolean) {
  const [y, m, d] = r.date.split('-');
  const lines = [
    `<b>Demo_CSV — Báo cáo ngày ${d}/${m}/${y}</b>`,
    stale ? `<i>⚠ Chưa có dữ liệu mới hơn — đây là ngày gần nhất đã tải lên.</i>` : '',
    '',
    `💰 Doanh thu: <b>${nf(r.amount)} ₫</b>`,
    `⛽ Sản lượng: <b>${nf(r.litres)} L</b>`,
    r.avg ? `📊 Giá bình quân: <b>${nf(r.avg)} ₫/L</b>` : '',
    r.top ? `🔝 Trụ mạnh nhất: <b>${r.top.metric_name.replace('sl_', '').replace('_tru', ' trụ ').toUpperCase()}</b> — ${nf(Number(r.top.value))} L` : '',
    '',
    `<a href="${APP_URL}/statistics.html">Xem chi tiết trên Demo_CSV →</a>`,
  ];
  return lines.filter(Boolean).join('\n');
}

async function sendTelegram(chatId: string, text: string) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.ok === false) throw new Error(body.description ?? `HTTP ${res.status}`);
}

Deno.serve(async () => {
  if (!BOT_TOKEN) {
    return new Response(JSON.stringify({ error: 'TELEGRAM_BOT_TOKEN not set' }), { status: 500 });
  }
  const { hour, weekday } = localNow();

  const { data: subs, error } = await admin
    .from('report_subscriptions')
    .select('id, user_id, station_id, destination, frequency')
    .eq('enabled', true)
    .eq('channel', 'telegram')
    .eq('send_hour', hour)
    .not('verified_at', 'is', null);          // never write to an unconfirmed chat

  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

  const due = (subs ?? []).filter((s) =>
    s.frequency === 'daily' ||
    (s.frequency === 'weekdays' && !['Sat', 'Sun'].includes(weekday)) ||
    (s.frequency === 'weekly' && weekday === 'Mon'));

  const results = { sent: 0, skipped: 0, failed: 0 };

  for (const sub of due) {
    try {
      const allowed = await accessibleStations(sub.user_id);
      // A subscription naming a station the user has since lost access to
      // sends nothing, rather than falling back to everything.
      const scope = sub.station_id
        ? (allowed.includes(sub.station_id) ? [sub.station_id] : [])
        : allowed;

      const report = scope.length ? await buildReport(scope) : null;
      if (!report) {
        results.skipped++;
        await admin.from('report_subscriptions')
          .update({ last_status: 'skipped: no accessible data' }).eq('id', sub.id);
        continue;
      }

      // "Stale" = the newest uploaded day is not yesterday, i.e. somebody is
      // behind on uploads. Worth saying out loud rather than quietly reporting
      // an old number as if it were today's.
      const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
      await sendTelegram(sub.destination, render(report, report.date < yesterday));

      results.sent++;
      await admin.from('report_subscriptions')
        .update({ last_sent_at: new Date().toISOString(), last_status: 'ok' })
        .eq('id', sub.id);
    } catch (e) {
      results.failed++;
      await admin.from('report_subscriptions')
        .update({ last_status: `error: ${String((e as Error).message).slice(0, 200)}` })
        .eq('id', sub.id);
    }
  }

  return new Response(JSON.stringify({ hour, weekday, due: due.length, ...results }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
