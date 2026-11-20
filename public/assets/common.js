/* ===== Shared helpers: API, Thai dates, SweetAlert presets, simple table ===== */

const TH_MONTHS = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
const TH_MONTHS_SHORT = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
const TH_DAYS = ['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์'];

/** Parse 'YYYY-MM-DD' as a local date (no timezone shift). */
function parseYMD(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
function toYMD(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function todayYMD() { return toYMD(new Date()); }

function thaiDate(ymd, { short = false, weekday = false } = {}) {
  if (!ymd) return '-';
  const d = parseYMD(ymd);
  const m = short ? TH_MONTHS_SHORT[d.getMonth()] : TH_MONTHS[d.getMonth()];
  const y = short ? String(d.getFullYear() + 543).slice(-2) : d.getFullYear() + 543;
  return `${weekday ? 'วัน' + TH_DAYS[d.getDay()] + 'ที่ ' : ''}${d.getDate()} ${m} ${y}`;
}
function thaiDateTime(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  return `${d.getDate()} ${TH_MONTHS_SHORT[d.getMonth()]} ${String(d.getFullYear() + 543).slice(-2)} ${d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.`;
}

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- API ---------- */
async function api(path, { method = 'GET', data } = {}) {
  const opts = { method, headers: {}, credentials: 'same-origin' };
  if (method !== 'GET') {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(data || {});
  }
  let res, json;
  try {
    res = await fetch(path, opts);
  } catch {
    throw Object.assign(new Error('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ต'), { status: 0 });
  }
  try { json = await res.json(); } catch { json = {}; }
  if (!res.ok || json.ok === false) {
    const err = new Error(json.message || `เกิดข้อผิดพลาด (${res.status})`);
    err.status = res.status;
    err.data = json;
    throw err;
  }
  return json;
}

/* ---------- SweetAlert presets ---------- */
const SwalTheme = Swal.mixin({
  buttonsStyling: false,
  customClass: {
    popup: 'rounded-2xl !font-[Sarabun] shadow-2xl',
    title: '!text-xl !font-bold !text-slate-800',
    htmlContainer: '!text-slate-600 !text-base',
    confirmButton: 'inline-flex items-center gap-2 rounded-xl bg-navy-700 hover:bg-navy-800 text-white font-semibold px-6 py-2.5 mx-1.5 transition',
    cancelButton: 'inline-flex items-center gap-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold px-6 py-2.5 mx-1.5 transition',
    denyButton: 'inline-flex items-center gap-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-semibold px-6 py-2.5 mx-1.5 transition',
    actions: '!mt-6',
  },
  confirmButtonText: 'ตกลง',
  cancelButtonText: 'ยกเลิก',
});

const Toast = Swal.mixin({
  toast: true,
  position: 'top-end',
  showConfirmButton: false,
  timer: 2600,
  timerProgressBar: true,
  customClass: { popup: '!font-[Sarabun] rounded-xl' },
});

function alertError(err, title = 'ไม่สำเร็จ') {
  return SwalTheme.fire({ icon: 'error', title, text: err?.message || String(err) });
}

function confirmDanger(title, text, confirmText = 'ยืนยันการลบ') {
  return SwalTheme.fire({
    icon: 'warning', title, html: text, showCancelButton: true, focusCancel: true,
    confirmButtonText: `<i class="fa-solid fa-trash-can"></i> ${confirmText}`,
    customClass: { confirmButton: 'inline-flex items-center gap-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-semibold px-6 py-2.5 mx-1.5 transition', cancelButton: 'inline-flex items-center gap-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold px-6 py-2.5 mx-1.5 transition', popup: 'rounded-2xl !font-[Sarabun]', actions: '!mt-6' },
  }).then((r) => r.isConfirmed);
}

/** Ask to proceed when the slot overlaps existing bookings (HTTP 409). */
async function confirmConflict(err) {
  const list = (err.data?.conflicts || [])
    .map((c) => `<li class="py-1"><b>${c.meeting_date ? thaiDateRange(c, { short: true }) + ' · ' : ''}${esc(c.start_time)}–${esc(c.end_time)} น.</b> ${esc(c.court_name)}</li>`).join('');
  const r = await SwalTheme.fire({
    icon: 'warning',
    title: 'ช่วงเวลานี้มีการจองแล้ว',
    html: `<div class="text-left"><p class="mb-2">มีรายการที่เวลาทับซ้อนกัน:</p><ul class="list-disc pl-6 text-sm text-slate-700">${list}</ul><p class="mt-3 text-sm">ต้องการบันทึกต่อหรือไม่?</p></div>`,
    showCancelButton: true,
    confirmButtonText: 'บันทึกต่อ',
    cancelButtonText: 'กลับไปแก้ไข',
  });
  return r.isConfirmed;
}

/* ---------- Flatpickr Thai (Buddhist year display) ---------- */
function thaiDatePicker(el, opts = {}) {
  return flatpickr(el, {
    locale: 'th',
    dateFormat: 'Y-m-d',
    altInput: true,
    altFormat: 'j F Y',
    disableMobile: true,
    formatDate: (date, format) => {
      if (format === 'Y-m-d') return toYMD(date);
      return `${date.getDate()} ${TH_MONTHS[date.getMonth()]} ${date.getFullYear() + 543}`;
    },
    onReady: (_, __, fp) => fixBuddhistYear(fp),
    onMonthChange: (_, __, fp) => fixBuddhistYear(fp),
    onYearChange: (_, __, fp) => fixBuddhistYear(fp),
    onOpen: (_, __, fp) => fixBuddhistYear(fp),
    ...opts,
  });
}
function fixBuddhistYear(fp) {
  // Show พ.ศ. in the calendar header without changing the underlying value.
  const yr = fp.currentYearElement;
  if (!yr) return;
  let label = fp.calendarContainer.querySelector('.be-year');
  if (!label) {
    label = document.createElement('span');
    label.className = 'be-year';
    yr.parentNode.parentNode.appendChild(label);
    yr.parentNode.style.display = 'none';
  }
  label.textContent = ` ${fp.currentYear + 543}`;
}

/* ---------- Minimal table with search + pagination ---------- */
function createTable({ el, columns, pageSize = 10, empty = 'ไม่มีข้อมูล', rowClass }) {
  const state = { rows: [], page: 1, pageSize };
  const root = typeof el === 'string' ? document.querySelector(el) : el;

  function render() {
    const total = state.rows.length;
    const pages = Math.max(1, Math.ceil(total / state.pageSize));
    if (state.page > pages) state.page = pages;
    const start = (state.page - 1) * state.pageSize;
    const slice = state.rows.slice(start, start + state.pageSize);

    const head = columns.map((c) => `<th class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 ${c.thClass || ''}">${c.title}</th>`).join('');
    const body = slice.length
      ? slice.map((r, i) => `<tr class="border-t border-slate-100 hover:bg-slate-50/80 transition ${rowClass ? rowClass(r) : ''}">${columns
          .map((c) => `<td class="px-4 py-3 align-top text-sm text-slate-700 ${c.tdClass || ''}">${c.render ? c.render(r, start + i) : esc(r[c.key])}</td>`)
          .join('')}</tr>`).join('')
      : `<tr><td colspan="${columns.length}" class="px-4 py-14 text-center text-slate-400"><i class="fa-regular fa-folder-open text-3xl mb-2 block"></i>${empty}</td></tr>`;

    const btn = (p, label, disabled, active) =>
      `<button data-page="${p}" ${disabled ? 'disabled' : ''} class="min-w-9 h-9 px-3 rounded-lg text-sm font-medium transition ${active ? 'bg-navy-700 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'} disabled:opacity-40 disabled:cursor-not-allowed">${label}</button>`;
    let nums = '';
    const from = Math.max(1, state.page - 2), to = Math.min(pages, from + 4);
    for (let p = from; p <= to; p++) nums += btn(p, p, false, p === state.page);

    root.innerHTML = `
      <div class="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table class="min-w-full"><thead class="bg-slate-50">${`<tr>${head}</tr>`}</thead><tbody>${body}</tbody></table>
      </div>
      <div class="flex flex-col sm:flex-row items-center justify-between gap-3 mt-4 text-sm text-slate-500">
        <div>แสดง ${total ? start + 1 : 0}–${Math.min(start + state.pageSize, total)} จาก ${total.toLocaleString('th-TH')} รายการ</div>
        <div class="flex items-center gap-1.5">${btn(state.page - 1, '<i class="fa-solid fa-chevron-left text-xs"></i>', state.page <= 1)}${nums}${btn(state.page + 1, '<i class="fa-solid fa-chevron-right text-xs"></i>', state.page >= pages)}</div>
      </div>`;
    root.querySelectorAll('[data-page]').forEach((b) => b.addEventListener('click', () => { state.page = Number(b.dataset.page); render(); }));
  }

  return {
    setRows(rows, { keepPage = false } = {}) { state.rows = rows; if (!keepPage) state.page = 1; render(); },
    setPageSize(n) { state.pageSize = n; state.page = 1; render(); },
    render,
  };
}

function statusBadge(s) {
  const map = {
    confirmed: ['bg-emerald-50 text-emerald-700 ring-emerald-600/20', 'fa-circle-check', 'ยืนยันแล้ว'],
    pending: ['bg-amber-50 text-amber-700 ring-amber-600/20', 'fa-clock', 'รอตรวจสอบ'],
    cancelled: ['bg-rose-50 text-rose-700 ring-rose-600/20', 'fa-circle-xmark', 'ยกเลิก'],
  };
  const [cls, icon, label] = map[s] || map.confirmed;
  return `<span class="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset whitespace-nowrap ${cls}"><i class="fa-solid ${icon}"></i>${label}</span>`;
}

function debounce(fn, ms = 200) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/* ---------- Searchable select (combobox) ----------
   createCombobox(inputEl, { groups:[{group, items:[...]}], recent: () => [...], allowCustom, onSelect }) */
function createCombobox(input, { groups = [], recent = () => [], allowCustom = true, onSelect, emptyText = 'ไม่พบรายการที่ค้นหา' } = {}) {
  const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, '');
  const wrap = document.createElement('div');
  wrap.className = 'relative';
  input.parentNode.insertBefore(wrap, input);
  wrap.appendChild(input);
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-expanded', 'false');
  input.classList.add('!pr-10');

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.tabIndex = -1;
  toggle.setAttribute('aria-label', 'เปิดรายการ');
  toggle.className = 'absolute right-1.5 top-1/2 -translate-y-1/2 w-8 h-8 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100';
  toggle.innerHTML = '<i class="fa-solid fa-chevron-down text-xs"></i>';
  wrap.appendChild(toggle);

  const list = document.createElement('div');
  list.setAttribute('role', 'listbox');
  list.className = 'hidden absolute z-30 left-0 right-0 mt-1.5 max-h-72 overflow-y-auto rounded-xl bg-white shadow-xl ring-1 ring-slate-200 py-1.5 text-[15px]';
  wrap.appendChild(list);

  let options = [];
  let active = -1;
  const isOpen = () => !list.classList.contains('hidden');

  function highlight(text, q) {
    if (!q) return esc(text);
    const i = norm(text).indexOf(q);
    if (i < 0) return esc(text);
    // map normalized index back to the original string (spaces removed)
    let start = -1, end = -1, n = 0;
    for (let k = 0; k < text.length; k++) {
      if (/\s/.test(text[k])) continue;
      if (n === i) start = k;
      if (n === i + q.length - 1) { end = k + 1; break; }
      n++;
    }
    if (start < 0 || end < 0) return esc(text);
    return `${esc(text.slice(0, start))}<mark class="bg-gold-100 text-inherit rounded px-0.5">${esc(text.slice(start, end))}</mark>${esc(text.slice(end))}`;
  }

  function render() {
    const raw = input.value.trim();
    const q = norm(raw);
    const sections = [];
    const rec = recent().filter((n) => !q || norm(n).includes(q));
    if (rec.length) sections.push({ group: 'ใช้ล่าสุด', icon: 'fa-clock-rotate-left', items: rec });
    groups.forEach((g) => {
      const items = g.items.filter((n) => !q || norm(n).includes(q) || norm(g.group).includes(q));
      if (items.length) sections.push({ group: g.group, items });
    });
    options = [];
    let html = '';
    const exact = groups.some((g) => g.items.some((n) => norm(n) === q));
    sections.forEach((s) => {
      html += `<div class="px-4 pt-2.5 pb-1 text-xs font-semibold text-slate-400 uppercase tracking-wide">${s.icon ? `<i class="fa-solid ${s.icon} mr-1"></i>` : ''}${esc(s.group)}</div>`;
      s.items.forEach((n) => {
        const i = options.push(n) - 1;
        html += `<div role="option" data-i="${i}" class="cb-opt mx-1.5 px-3 py-2 rounded-lg cursor-pointer">${highlight(n, q)}</div>`;
      });
    });
    if (allowCustom && raw && !exact) {
      const i = options.push(raw) - 1;
      html += `<div class="mx-3 my-1 border-t border-slate-100"></div><div role="option" data-i="${i}" class="cb-opt mx-1.5 px-3 py-2 rounded-lg cursor-pointer text-navy-700"><i class="fa-solid fa-pen mr-2 text-xs"></i>ไม่มีในรายการ — ใช้ชื่อ “${esc(raw)}”</div>`;
    }
    if (!options.length) html = `<div class="px-4 py-6 text-center text-slate-400 text-sm">${emptyText}</div>`;
    list.innerHTML = html;
    active = options.length ? 0 : -1;
    paint();
  }

  function paint() {
    list.querySelectorAll('.cb-opt').forEach((el) => {
      const on = Number(el.dataset.i) === active;
      el.classList.toggle('bg-navy-50', on);
      el.setAttribute('aria-selected', on);
      if (on) el.scrollIntoView({ block: 'nearest' });
    });
  }

  function open() { if (!isOpen()) { list.classList.remove('hidden'); input.setAttribute('aria-expanded', 'true'); } render(); }
  function close() { list.classList.add('hidden'); input.setAttribute('aria-expanded', 'false'); }
  function choose(i) {
    if (i < 0 || i >= options.length) return;
    input.value = options[i];
    input.classList.remove('is-invalid');
    close();
    input.dispatchEvent(new Event('change', { bubbles: true }));
    onSelect && onSelect(options[i]);
  }

  input.addEventListener('focus', open);
  input.addEventListener('click', open);
  input.addEventListener('input', open);
  toggle.addEventListener('mousedown', (e) => { e.preventDefault(); if (isOpen()) close(); else { input.focus(); open(); } });
  list.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const opt = e.target.closest('.cb-opt');
    if (opt) choose(Number(opt.dataset.i));
  });
  list.addEventListener('mousemove', (e) => {
    const opt = e.target.closest('.cb-opt');
    if (opt && Number(opt.dataset.i) !== active) { active = Number(opt.dataset.i); paint(); }
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (!isOpen()) return open(); active = Math.min(options.length - 1, active + 1); paint(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); paint(); }
    else if (e.key === 'Enter') { if (isOpen()) { e.preventDefault(); choose(active); } }
    else if (e.key === 'Escape') { close(); }
    else if (e.key === 'Tab') { close(); }
  });
  input.addEventListener('blur', () => setTimeout(close, 120));

  return { open, close, setValue(v) { input.value = v || ''; } };
}

/* ---------- Browser-side form memory (localStorage, falls back silently) ---------- */
const FormMemory = {
  key: 'udtc_booking_memory_v1',
  read() {
    try { return JSON.parse(localStorage.getItem(this.key)) || { last: null, history: {} }; } catch { return { last: null, history: {} }; }
  },
  save(data, fields) {
    const mem = this.read();
    mem.last = Object.fromEntries(fields.map((f) => [f, data[f] || '']));
    mem.history = mem.history || {};
    fields.forEach((f) => {
      const v = String(data[f] || '').trim();
      if (!v) return;
      mem.history[f] = [v, ...(mem.history[f] || []).filter((x) => x !== v)].slice(0, 10);
    });
    mem.savedAt = new Date().toISOString();
    try { localStorage.setItem(this.key, JSON.stringify(mem)); } catch { /* storage unavailable */ }
  },
  clear() { try { localStorage.removeItem(this.key); } catch { /* ignore */ } },
};

/* ---------- Multi-day booking helpers ---------- */
function endDateOf(b) { return b.end_date && b.end_date > b.meeting_date ? b.end_date : b.meeting_date; }
function coversDate(b, ymd) { return b.meeting_date <= ymd && endDateOf(b) >= ymd; }
function dayCount(b) { return Math.round((parseYMD(endDateOf(b)) - parseYMD(b.meeting_date)) / 86400000) + 1; }
function addDaysYMD(ymd, n) { const d = parseYMD(ymd); d.setDate(d.getDate() + n); return toYMD(d); }
/** "20–22 พ.ย. 69" / "30 พ.ย. – 2 ธ.ค. 69" / single date */
function thaiDateRange(b, { short = false, weekday = false } = {}) {
  const s = b.meeting_date, e = endDateOf(b);
  if (s === e) return thaiDate(s, { short, weekday });
  const a = parseYMD(s), z = parseYMD(e);
  const M = short ? TH_MONTHS_SHORT : TH_MONTHS;
  const y = (d) => (short ? String(d.getFullYear() + 543).slice(-2) : d.getFullYear() + 543);
  if (a.getFullYear() === z.getFullYear() && a.getMonth() === z.getMonth()) return `${a.getDate()}–${z.getDate()} ${M[z.getMonth()]} ${y(z)}`;
  if (a.getFullYear() === z.getFullYear()) return `${a.getDate()} ${M[a.getMonth()]} – ${z.getDate()} ${M[z.getMonth()]} ${y(z)}`;
  return `${thaiDate(s, { short })} – ${thaiDate(e, { short })}`;
}

/* ---------- Booking calendar (FullCalendar) with badges + multi-day bars ---------- */
const EV_COLORS = {
  confirmed: { bg: '#1f4473', border: '#172f4d' },
  pending: { bg: '#b45309', border: '#92400e' },
  cancelled: { bg: '#94a3b8', border: '#64748b' },
};

/** Month view: one bar spanning every day of the booking. Week/list views: one block per day. */
function bookingEvents(list, viewType) {
  const spanning = String(viewType || '').startsWith('dayGrid');
  const out = [];
  list.forEach((b) => {
    const days = dayCount(b);
    const color = EV_COLORS[b.status] || EV_COLORS.confirmed;
    const base = { backgroundColor: color.bg, borderColor: color.border, textColor: '#fff', classNames: ['bk-ev', 'bk-' + (b.status || 'confirmed')] };
    const validTime = b.end_time > b.start_time;
    if (spanning || days === 1) {
      out.push({
        ...base, id: String(b.id), display: 'block',
        start: `${b.meeting_date}T${b.start_time}`,
        end: validTime || days > 1 ? `${endDateOf(b)}T${b.end_time}` : undefined,
        title: b.court_name, extendedProps: { b, days, dayIndex: 0 },
      });
    } else {
      for (let i = 0; i < days; i++) {
        const ymd = addDaysYMD(b.meeting_date, i);
        out.push({
          ...base, id: `${b.id}-${i}`, groupId: String(b.id), display: 'block',
          start: `${ymd}T${b.start_time}`, end: validTime ? `${ymd}T${b.end_time}` : undefined,
          title: b.court_name, extendedProps: { b, days, dayIndex: i },
        });
      }
    }
  });
  return out;
}

function bookingEventContent(arg) {
  const { b, days, dayIndex } = arg.event.extendedProps;
  const view = arg.view.type;
  const time = `${b.start_time}–${b.end_time}`;
  const pill = (txt, cls = '') => `<span class="bk-badge ${cls}">${txt}</span>`;
  const dayBadge = days > 1
    ? pill(`<i class="fa-solid fa-arrows-left-right"></i> ${view.startsWith('dayGrid') ? days + ' วัน' : `วันที่ ${dayIndex + 1}/${days}`}`, 'bk-badge-gold')
    : '';
  const statusBadge = b.status === 'pending' ? pill('รอตรวจสอบ', 'bk-badge-amber') : b.status === 'cancelled' ? pill('ยกเลิก', 'bk-badge-muted') : '';
  const caseBadge = b.black_case ? pill(`<i class="fa-regular fa-file-lines"></i> ${esc(b.black_case)}`, 'bk-badge-case') : '';
  if (view.startsWith('list')) {
    return { html: `<div class="bk-list"><span class="bk-title">${esc(b.court_name)}</span>${caseBadge}${dayBadge}${statusBadge}<span class="bk-reason">${esc(b.reason || '')}</span></div>` };
  }
  return {
    html: `<div class="bk-inner">
      <div class="bk-row">${pill(`<i class="fa-regular fa-clock"></i> ${time}`, 'bk-badge-time')}${dayBadge}${statusBadge}</div>
      <div class="bk-title">${esc(b.court_name)}</div>
      ${b.black_case ? `<div class="bk-row">${caseBadge}</div>` : ''}
    </div>`,
  };
}

function showBookingDetail(b) {
  const days = dayCount(b);
  return SwalTheme.fire({
    title: esc(b.court_name),
    html: `<div class="text-left space-y-2 text-[15px]">
      <div><i class="fa-regular fa-calendar w-5 text-navy-500"></i> ${thaiDateRange(b, { weekday: days === 1 })}${days > 1 ? ` <span class="ml-1 inline-flex rounded-full bg-gold-50 text-gold-700 ring-1 ring-gold-100 px-2 py-0.5 text-xs font-semibold">${days} วัน</span>` : ''}</div>
      <div><i class="fa-regular fa-clock w-5 text-navy-500"></i> ${b.start_time}–${b.end_time} น.${days > 1 ? ' (ทุกวัน)' : ''}</div>
      <div><i class="fa-solid fa-file-lines w-5 text-navy-500"></i> คดีดำ ${esc(b.black_case)}${b.red_case ? ` · คดีแดง <span class="text-rose-600">${esc(b.red_case)}</span>` : ''}</div>
      <div><i class="fa-solid fa-comment w-5 text-navy-500"></i> ${esc(b.reason)}</div>
      <div><i class="fa-solid fa-user w-5 text-navy-500"></i> ${esc(b.contact_name)}</div>
      ${b.status && b.status !== 'confirmed' ? `<div>${statusBadge(b.status)}</div>` : ''}</div>`,
  });
}

/** createBookingCalendar(el, { getBookings, initialView, nav, viewSwitcher, details, height }) */
function createBookingCalendar(el, opts = {}) {
  const { getBookings = () => [], initialView = 'dayGridMonth', nav = true, viewSwitcher = true, details = true, height = 'auto' } = opts;
  let lastType = initialView;
  const cal = new FullCalendar.Calendar(el, {
    locale: 'th',
    initialView,
    headerToolbar: {
      left: nav ? 'prev,next today' : '',
      center: 'title',
      right: viewSwitcher ? 'dayGridMonth,timeGridWeek,listMonth' : '',
    },
    buttonText: { today: 'วันนี้', month: 'เดือน', week: 'สัปดาห์', list: 'รายการ' },
    titleFormat: (arg) => `${TH_MONTHS[arg.date.month]} ${arg.date.year + 543}`,
    height,
    slotMinTime: '07:00:00', slotMaxTime: '19:00:00',
    allDaySlot: false,
    displayEventTime: false,
    views: { listMonth: { displayEventTime: true } },
    eventOrder: 'start,-duration,title',
    dayMaxEvents: 3,
    moreLinkContent: (a) => `+ อีก ${a.num} รายการ`,
    noEventsText: 'ไม่มีการจองในช่วงนี้',
    events: (info, success) => success(bookingEvents(getBookings(), cal.view?.type || initialView)),
    eventContent: bookingEventContent,
    eventDidMount: (arg) => {
      const b = arg.event.extendedProps.b;
      arg.el.title = `${b.court_name}\n${thaiDateRange(b)} ${b.start_time}–${b.end_time} น.\nคดีดำ ${b.black_case}`;
    },
    datesSet: (arg) => { if (arg.view.type !== lastType) { lastType = arg.view.type; cal.refetchEvents(); } },
    eventClick: (info) => { if (details) showBookingDetail(info.event.extendedProps.b); },
  });
  cal.render();
  return { calendar: cal, refresh() { cal.refetchEvents(); cal.updateSize(); } };
}
