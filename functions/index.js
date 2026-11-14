/**
 * פונקציות השרת של אפליקציית תזכורת ימי הולדת
 *  - dailyBirthdayAlerts: רצה כל יום ב-08:00 שעון ישראל ושולחת התראות למנהלים
 *  - sendTestNotification: כפתור "שלח התראת בדיקה" מתוך האפליקציה
 */
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');

admin.initializeApp(process.env.DATABASE_URL ? { databaseURL: process.env.DATABASE_URL } : undefined);
setGlobalOptions({ region: 'europe-west1', maxInstances: 2 });

const db = admin.database();
const TZ = 'Asia/Jerusalem';
const APP_URL = process.env.APP_URL || '';
const WA = {
  token: process.env.WHATSAPP_TOKEN || '',
  phoneId: process.env.WHATSAPP_PHONE_ID || '',
  template: process.env.WHATSAPP_TEMPLATE || 'birthday_reminder',
  lang: process.env.WHATSAPP_LANG || 'he',
  version: process.env.WHATSAPP_API_VERSION || 'v21.0',
};
const whatsappEnabled = () => Boolean(WA.token && WA.phoneId);

const REASONS = {
  'no-tokens': 'אין מכשיר שהפעיל התראות',
  'push-failed': 'שליחת ה-Push נכשלה',
  'whatsapp-not-configured': 'וואטסאפ עוד לא הוגדר',
  'no-phone': 'לא הוזן מספר טלפון בהגדרות',
};

// ---------- תאריכים (לפי שעון ישראל) ----------
const pad = (n) => String(n).padStart(2, '0');
const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

function israelToday() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short',
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t).value;
  return { y: +get('year'), m: +get('month'), d: +get('day'), weekday: get('weekday') };
}

function addDays(date, k) {
  const dt = new Date(Date.UTC(date.y, date.m - 1, date.d + k));
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

function isBirthdayOn(emp, date) {
  const day = Number(emp.day);
  const month = Number(emp.month);
  // 29 בפברואר בשנה לא מעוברת -> 28 בפברואר
  if (month === 2 && day === 29 && !isLeap(date.y)) return date.m === 2 && date.d === 28;
  return day === date.d && month === date.m;
}

// ביום חמישי שולחים גם על שישי ושבת. בשישי ושבת לא שולחים.
function targetDays(today) {
  if (today.weekday === 'Fri' || today.weekday === 'Sat') return [];
  if (today.weekday === 'Thu') {
    return [{ offset: 0, label: 'היום' }, { offset: 1, label: 'שישי' }, { offset: 2, label: 'שבת' }];
  }
  return [{ offset: 0, label: 'היום' }];
}

function collectBirthdays(employees, today, targets) {
  const groups = [];
  for (const t of targets) {
    const date = addDays(today, t.offset);
    const names = Object.values(employees || {})
      .filter((e) => e && isBirthdayOn(e, date))
      .map((e) => (e.department ? `${e.name} (${e.department})` : e.name))
      .sort((a, b) => a.localeCompare(b, 'he'));
    if (names.length) groups.push({ label: t.label, names });
  }
  return groups;
}

function buildMessage(groups) {
  const total = groups.reduce((s, g) => s + g.names.length, 0);
  const onlyToday = groups.length === 1 && groups[0].label === 'היום';
  const title = onlyToday
    ? (total === 1 ? '🎂 יום הולדת היום' : `🎂 ${total} ימי הולדת היום`)
    : '🎂 ימי הולדת היום ובסוף השבוע';
  const body = onlyToday
    ? groups[0].names.join(', ')
    : groups.map((g) => `${g.label}: ${g.names.join(', ')}`).join(' | ');
  return { title, body };
}

// ---------- טלפון ----------
function normalizePhone(p) {
  let d = String(p || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0')) d = '972' + d.slice(1);
  else if (!d.startsWith('972') && d.length === 9) d = '972' + d;
  return d.length >= 11 ? d : '';
}

// ---------- ערוצי שליחה ----------
async function sendPush(uid, manager, title, body) {
  const tokens = Object.keys(manager.fcmTokens || {});
  if (!tokens.length) return { ok: false, reason: 'no-tokens' };

  const webpush = { notification: { dir: 'rtl', lang: 'he' } };
  if (APP_URL) {
    webpush.notification.icon = APP_URL + 'icon.png';
    webpush.fcmOptions = { link: APP_URL };
  }

  const res = await admin.messaging().sendEachForMulticast({ tokens, notification: { title, body }, webpush });

  // ניקוי מכשירים שכבר לא רשומים
  const cleanup = {};
  res.responses.forEach((r, i) => {
    const code = r.error && r.error.code;
    if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') {
      cleanup[`managers/${uid}/fcmTokens/${tokens[i]}`] = null;
    }
  });
  if (Object.keys(cleanup).length) await db.ref().update(cleanup);

  return res.successCount > 0 ? { ok: true } : { ok: false, reason: 'push-failed' };
}

async function sendWhatsApp(manager, text) {
  if (!whatsappEnabled()) return { ok: false, reason: 'whatsapp-not-configured' };
  const to = normalizePhone(manager.phone);
  if (!to) return { ok: false, reason: 'no-phone' };

  const r = await fetch(`https://graph.facebook.com/${WA.version}/${WA.phoneId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${WA.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: WA.template,
        language: { code: WA.lang },
        components: [{ type: 'body', parameters: [{ type: 'text', text: text.slice(0, 1000) }] }],
      },
    }),
  });
  if (!r.ok) return { ok: false, reason: `whatsapp ${r.status}: ${(await r.text()).slice(0, 200)}` };
  return { ok: true };
}

// מנסה קודם את הערוץ המועדף, ואם נכשל – את השני
async function notifyManager(uid, manager, title, body) {
  const order = manager.channel === 'whatsapp' ? ['whatsapp', 'push'] : ['push', 'whatsapp'];
  const attempts = [];
  for (const ch of order) {
    let r;
    try {
      r = ch === 'push' ? await sendPush(uid, manager, title, body) : await sendWhatsApp(manager, `${title}: ${body}`);
    } catch (e) {
      r = { ok: false, reason: String(e.message || e).slice(0, 200) };
    }
    attempts.push({ channel: ch, ok: r.ok, reason: r.reason || '' });
    if (r.ok) return { ok: true, channel: ch, attempts };
  }
  return { ok: false, channel: null, attempts };
}

// ---------- ההתראה היומית ----------
exports.dailyBirthdayAlerts = onSchedule({ schedule: '0 8 * * *', timeZone: TZ }, async () => {
  const today = israelToday();
  const targets = targetDays(today);
  if (!targets.length) {
    logger.info('סוף שבוע – לא נשלחות התראות');
    return;
  }

  const [empSnap, mgrSnap] = await Promise.all([db.ref('employees').get(), db.ref('managers').get()]);
  const groups = collectBirthdays(empSnap.val(), today, targets);
  if (!groups.length) {
    logger.info('אין ימי הולדת היום');
    return;
  }

  const { title, body } = buildMessage(groups);
  const dayKey = `${today.y}-${pad(today.m)}-${pad(today.d)}`;
  const log = (await db.ref(`sentLog/${dayKey}`).get()).val() || {};
  const managers = mgrSnap.val() || {};

  for (const [uid, manager] of Object.entries(managers)) {
    if (log[uid] && log[uid].ok) continue; // כבר נשלח היום
    const result = await notifyManager(uid, manager, title, body);
    await db.ref(`sentLog/${dayKey}/${uid}`).set({
      ok: result.ok,
      channel: result.channel,
      attempts: result.attempts,
      at: admin.database.ServerValue.TIMESTAMP,
    });
    logger.info(`מנהל ${uid}: ${result.ok ? 'נשלח ב-' + result.channel : 'נכשל'}`, result.attempts);
  }
});

// ---------- התראת בדיקה ----------
exports.sendTestNotification = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'יש להתחבר לאפליקציה');
  const uid = request.auth.uid;
  const manager = (await db.ref(`managers/${uid}`).get()).val();
  if (!manager) throw new HttpsError('not-found', 'לא נמצא פרופיל מנהל');

  const result = await notifyManager(uid, manager, '🔔 התראת בדיקה', 'אם קיבלת את זה – ההתראות עובדות! 🎉');
  if (result.ok) {
    return {
      ok: true,
      message: result.channel === 'push' ? '✅ נשלחה התראת Push למכשירים שלך' : '✅ נשלחה הודעת וואטסאפ',
    };
  }
  const details = result.attempts
    .map((a) => `${a.channel === 'push' ? 'Push' : 'וואטסאפ'}: ${REASONS[a.reason] || a.reason}`)
    .join('\n');
  return { ok: false, message: '❌ השליחה נכשלה\n' + details };
});
