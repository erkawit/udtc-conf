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
    .map((c) => `<li class="py-1"><b>${esc(c.start_time)}–${esc(c.end_time)} น.</b> ${esc(c.court_name)}</li>`).join('');
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
