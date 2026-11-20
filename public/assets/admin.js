/* ===== Admin console ===== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

let me = null;
let bookings = [];
let users = [];
const ROLE_LABEL = { admin: 'ผู้ดูแลระบบ', staff: 'เจ้าหน้าที่' };
const STATUS_LABEL = { confirmed: 'ยืนยันแล้ว', pending: 'รอตรวจสอบ', cancelled: 'ยกเลิก' };

/* ---------------- Boot / auth ---------------- */
async function boot() {
  try {
    const st = await api('/api/auth?action=status');
    $('#boot').classList.add('hidden');
    if (st.user) return enterApp(st.user);
    showAuth(st.needsSetup ? 'setup' : 'login');
  } catch (err) {
    $('#boot').innerHTML = `<div class="text-center max-w-md p-6"><i class="fa-solid fa-triangle-exclamation text-4xl text-rose-500"></i><p class="mt-3 font-semibold">ไม่สามารถเชื่อมต่อระบบได้</p><p class="text-slate-500 text-sm mt-1">${esc(err.message)}</p><button onclick="location.reload()" class="mt-4 rounded-xl px-5 py-2 bg-navy-700 text-white font-semibold">ลองใหม่</button></div>`;
  }
}

function showAuth(mode) {
  $('#app').classList.add('hidden');
  $('#authScreen').classList.remove('hidden');
  $('#loginForm').classList.toggle('hidden', mode !== 'login');
  $('#setupForm').classList.toggle('hidden', mode !== 'setup');
  setTimeout(() => (mode === 'login' ? $('#loginUsername') : $('#setupName')).focus(), 50);
}

$$('[data-toggle-pw]').forEach((b) => b.addEventListener('click', () => {
  const input = document.getElementById(b.dataset.togglePw);
  input.type = input.type === 'password' ? 'text' : 'password';
  b.innerHTML = `<i class="fa-regular ${input.type === 'password' ? 'fa-eye' : 'fa-eye-slash'}"></i>`;
}));

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.submitter; btn.disabled = true;
  try {
    const { user } = await api('/api/auth?action=login', { method: 'POST', data: { username: $('#loginUsername').value, password: $('#loginPassword').value } });
    $('#loginPassword').value = '';
    Toast.fire({ icon: 'success', title: `ยินดีต้อนรับ ${user.display_name}` });
    enterApp(user);
  } catch (err) {
    alertError(err, 'เข้าสู่ระบบไม่สำเร็จ');
  } finally { btn.disabled = false; }
});

$('#setupForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if ($('#setupPassword').value !== $('#setupPassword2').value) return SwalTheme.fire({ icon: 'warning', title: 'รหัสผ่านไม่ตรงกัน' });
  try {
    const { user } = await api('/api/auth?action=setup', { method: 'POST', data: { display_name: $('#setupName').value, username: $('#setupUsername').value, password: $('#setupPassword').value } });
    enterApp(user);
    await SwalTheme.fire({ icon: 'success', title: 'สร้างบัญชีผู้ดูแลระบบแล้ว', text: 'ต่อไประบบจะดึงประวัติการจองจาก Google Sheet เดิมเข้ามาให้อัตโนมัติ' });
    await importLegacy({ ask: false });
  } catch (err) { alertError(err); }
});

$('#logoutBtn').addEventListener('click', async () => {
  const r = await SwalTheme.fire({ icon: 'question', title: 'ออกจากระบบ?', showCancelButton: true, confirmButtonText: 'ออกจากระบบ' });
  if (!r.isConfirmed) return;
  await api('/api/auth?action=logout', { method: 'POST' }).catch(() => {});
  me = null;
  location.hash = '';
  showAuth('login');
});

function handleAuthError(err) {
  if (err.status === 401) {
    SwalTheme.fire({ icon: 'info', title: 'หมดเวลาการใช้งาน', text: 'กรุณาเข้าสู่ระบบอีกครั้ง' });
    showAuth('login');
    return true;
  }
  return false;
}

/* ---------------- App shell ---------------- */
function enterApp(user) {
  me = user;
  $('#authScreen').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#meName').textContent = user.display_name;
  $('#meRole').textContent = ROLE_LABEL[user.role];
  $('#meAvatar').textContent = (user.display_name || '?').trim().charAt(0);
  $$('[data-admin-only]').forEach((el) => el.classList.toggle('hidden', user.role !== 'admin'));
  $('#todayLabel').textContent = thaiDate(todayYMD(), { weekday: true });
  route();
  loadBookings();
  if (user.role === 'admin') loadUsers();
}

const TITLES = { dashboard: 'ภาพรวม', bookings: 'รายการจอง', embed: 'ฝังปฏิทินในเว็บอื่น', users: 'ผู้ใช้งาน', account: 'บัญชีของฉัน' };
function route() {
  let view = location.hash.replace('#', '') || 'dashboard';
  if (!TITLES[view] || (view === 'users' && me?.role !== 'admin')) view = 'dashboard';
  $$('.view').forEach((v) => v.classList.toggle('hidden', v.id !== 'view-' + view));
  $$('.side-link').forEach((a) => { if (a.getAttribute('href') === '#' + view) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  $('#pageTitle').textContent = TITLES[view];
  if (view === 'embed') updateEmbed();
  closeSidebar();
}
window.addEventListener('hashchange', () => me && route());

function openSidebar() { $('#sidebar').classList.remove('-translate-x-full'); $('#sidebarBackdrop').classList.remove('hidden'); }
function closeSidebar() { $('#sidebar').classList.add('-translate-x-full'); $('#sidebarBackdrop').classList.add('hidden'); }
$('#menuBtn').addEventListener('click', openSidebar);
$('#sidebarBackdrop').addEventListener('click', closeSidebar);

/* ---------------- Bookings ---------------- */
async function loadBookings() {
  try {
    const { data } = await api('/api/bookings?scope=admin');
    bookings = data;
    renderDashboard();
    applyBookingFilter(true);
  } catch (err) {
    if (!handleAuthError(err)) alertError(err, 'โหลดข้อมูลไม่สำเร็จ');
  }
}

function renderDashboard() {
  const active = bookings.filter((b) => b.status !== 'cancelled');
  const today = todayYMD();
  const d7 = new Date(); d7.setDate(d7.getDate() + 7);
  const week = toYMD(d7);
  const m0 = today.slice(0, 7) + '-01';
  const mEnd = toYMD(new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0));
  $('#dToday').textContent = active.filter((b) => coversDate(b, today)).length;
  $('#dWeek').textContent = active.filter((b) => b.meeting_date <= week && endDateOf(b) >= today).length;
  $('#dMonth').textContent = active.filter((b) => b.meeting_date <= mEnd && endDateOf(b) >= m0).length;
  $('#dAll').textContent = bookings.length.toLocaleString('th-TH');
  $('#dTodayLabel').textContent = thaiDate(today, { short: true });

  const todays = active.filter((b) => coversDate(b, today)).sort((a, b) => a.start_time.localeCompare(b.start_time));
  $('#dTodayList').innerHTML = todays.length
    ? todays.map((b) => `<li class="px-6 py-3 flex items-center gap-4 hover:bg-slate-50 cursor-pointer" data-edit="${b.id}">
        <div class="w-24 shrink-0 font-semibold text-navy-700">${b.start_time}–${b.end_time}</div>
        <div class="min-w-0 flex-1"><div class="font-medium truncate">${esc(b.court_name)}</div><div class="text-sm text-slate-500 truncate">${esc(b.black_case)} · ${esc(b.reason)}</div></div>
        <div class="text-xs font-mono text-slate-500 hidden sm:block">${esc(b.ip_address)}</div></li>`).join('')
    : '<li class="px-6 py-10 text-center text-slate-400"><i class="fa-regular fa-calendar-xmark text-2xl block mb-2"></i>ไม่มีการจองวันนี้</li>';

  const recent = [...bookings].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 6);
  $('#dRecentList').innerHTML = recent.length
    ? recent.map((b) => `<li class="px-6 py-3 flex items-center gap-4 hover:bg-slate-50 cursor-pointer" data-edit="${b.id}">
        <div class="min-w-0 flex-1"><div class="font-medium truncate">${esc(b.court_name)}</div><div class="text-sm text-slate-500">${thaiDateRange(b, { short: true })}${dayCount(b) > 1 ? ` (${dayCount(b)} วัน)` : ''} · ${b.start_time}–${b.end_time} น.</div></div>
        ${statusBadge(b.status)}</li>`).join('')
    : '<li class="px-6 py-10 text-center text-slate-400">ยังไม่มีข้อมูล</li>';
  $$('[data-edit]', $('#view-dashboard')).forEach((li) => li.addEventListener('click', () => openBookingModal(bookings.find((b) => b.id == li.dataset.edit))));
}

const bookingsTable = createTable({
  el: '#bookingsTable',
  pageSize: 15,
  columns: [
    { title: '#', tdClass: 'text-slate-400 w-10', render: (_, i) => i + 1 },
    { title: 'วันที่ / เวลา', render: (b) => `<div class="font-semibold whitespace-nowrap">${thaiDateRange(b, { short: true })}</div>${dayCount(b) > 1 ? `<span class="inline-flex rounded-full bg-gold-50 text-gold-700 ring-1 ring-gold-100 px-1.5 py-0.5 text-[11px] font-semibold"><i class="fa-solid fa-arrows-left-right mr-1"></i>${dayCount(b)} วัน</span>` : ''}<div class="text-navy-600 text-sm whitespace-nowrap">${b.start_time}–${b.end_time} น.</div>` },
    { title: 'ศาล', render: (b) => `<div class="font-medium min-w-[10rem]">${esc(b.court_name)}</div><div class="text-xs text-slate-500 line-clamp-2">${esc(b.reason)}</div>` },
    { title: 'คดีดำ / แดง', render: (b) => `<div class="whitespace-nowrap">${esc(b.black_case)}</div>${b.red_case ? `<div class="text-rose-600 whitespace-nowrap">${esc(b.red_case)}</div>` : ''}` },
    { title: 'ผู้ติดต่อ', render: (b) => `<div>${esc(b.contact_name)}</div><div class="text-xs text-slate-500 whitespace-nowrap"><i class="fa-solid fa-phone mr-1"></i>${esc(b.phone)}</div>` },
    { title: 'IP Address', tdClass: 'font-mono text-xs whitespace-nowrap', render: (b) => esc(b.ip_address) },
    { title: 'สถานะ', render: (b) => statusBadge(b.status) + (b.source === 'import' ? '<div class="mt-1"><span class="inline-flex items-center gap-1 rounded-full bg-slate-100 text-slate-500 px-2 py-0.5 text-[11px]"><i class="fa-solid fa-clock-rotate-left"></i>นำเข้า</span></div>' : '') + (b.note ? `<div class="text-xs text-slate-400 mt-1" title="${esc(b.note)}"><i class="fa-regular fa-note-sticky"></i> มีหมายเหตุ</div>` : '') },
    { title: '', tdClass: 'text-right whitespace-nowrap', render: (b) => `
        <button data-act="edit" data-id="${b.id}" class="w-9 h-9 rounded-lg text-navy-700 hover:bg-navy-50" title="แก้ไข"><i class="fa-solid fa-pen-to-square"></i></button>
        <button data-act="del" data-id="${b.id}" class="w-9 h-9 rounded-lg text-rose-600 hover:bg-rose-50" title="ลบ"><i class="fa-solid fa-trash-can"></i></button>` },
  ],
  rowClass: (b) => (b.status === 'cancelled' ? 'opacity-60' : ''),
  empty: 'ไม่พบรายการจอง',
});

$('#bookingsTable').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const b = bookings.find((x) => x.id == btn.dataset.id);
  if (btn.dataset.act === 'edit') openBookingModal(b);
  if (btn.dataset.act === 'del') deleteBooking(b);
});

const fFrom = thaiDatePicker('#fFrom', { onChange: () => applyBookingFilter() });
const fTo = thaiDatePicker('#fTo', { onChange: () => applyBookingFilter() });
$('#fSearch').addEventListener('input', debounce(() => applyBookingFilter()));
$('#fStatus').addEventListener('change', () => applyBookingFilter());
$('#fClear').addEventListener('click', () => { $('#fSearch').value = ''; $('#fStatus').value = ''; fFrom.clear(); fTo.clear(); applyBookingFilter(); });

function filteredBookings() {
  const term = $('#fSearch').value.trim().toLowerCase();
  const status = $('#fStatus').value;
  const from = $('#fFrom').value, to = $('#fTo').value;
  return bookings.filter((b) =>
    (!status || b.status === status) &&
    (!from || endDateOf(b) >= from) &&
    (!to || b.meeting_date <= to) &&
    (!term || [b.court_name, b.black_case, b.red_case, b.reason, b.contact_name, b.phone, b.ip_address, b.note].join(' ').toLowerCase().includes(term)));
}
function applyBookingFilter(keepPage = false) {
  const rows = filteredBookings();
  $('#bCount').textContent = `${rows.length.toLocaleString('th-TH')} รายการ${rows.length !== bookings.length ? ` (จากทั้งหมด ${bookings.length.toLocaleString('th-TH')})` : ''}`;
  bookingsTable.setRows(rows, { keepPage });
}

/* --- modal helpers --- */
function openModal(id) { $(id).classList.remove('hidden'); document.body.classList.add('overflow-hidden'); }
function closeModal(id) { $(id).classList.add('hidden'); document.body.classList.remove('overflow-hidden'); }
$$('#bookingModal [data-close]').forEach((el) => el.addEventListener('click', () => closeModal('#bookingModal')));
$$('#userModal [data-close]').forEach((el) => el.addEventListener('click', () => closeModal('#userModal')));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !Swal.isVisible()) { closeModal('#bookingModal'); closeModal('#userModal'); } });

const bForm = $('#bookingForm');
const bEnd = thaiDatePicker('#bEnd');
const bDate = thaiDatePicker('#bDate', {
  onChange: () => {
    const s = bForm.meeting_date.value;
    if (s && (!bForm.end_date.value || bForm.end_date.value < s)) bEnd.setDate(s, false);
    if (s) bEnd.set('minDate', s);
  },
});
createCombobox($('#bCourt'), { groups: window.COURT_GROUPS || [] });

function openBookingModal(b) {
  bForm.reset();
  bForm.querySelectorAll('.is-invalid').forEach((x) => x.classList.remove('is-invalid'));
  $('#bookingModalTitle').textContent = b ? 'แก้ไขการจอง' : 'เพิ่มการจอง';
  bForm.id.value = b?.id || '';
  ['court_name', 'start_time', 'end_time', 'black_case', 'red_case', 'reason', 'contact_name', 'phone', 'ip_address', 'note'].forEach((k) => { bForm[k].value = b?.[k] || ''; });
  bForm.status.value = b?.status || 'confirmed';
  bEnd.set('minDate', null); bEnd.clear();
  if (b) { bDate.setDate(b.meeting_date, true, 'Y-m-d'); bEnd.setDate(endDateOf(b), false, 'Y-m-d'); } else { bDate.setDate(new Date(), true); bForm.start_time.value = '08:30'; bForm.end_time.value = '16:30'; }
  $('#bookingMeta').innerHTML = b
    ? `บันทึกเมื่อ ${thaiDateTime(b.created_at)} (${b.source === 'web' ? 'จองผ่านเว็บ' : b.source === 'import' ? 'นำเข้าจากระบบเดิม' : 'เจ้าหน้าที่เพิ่ม'}) · แก้ไขล่าสุด ${thaiDateTime(b.updated_at)}${b.updated_by_name ? ' โดย ' + esc(b.updated_by_name) : ''}`
    : '';
  openModal('#bookingModal');

}
$('#addBookingBtn').addEventListener('click', () => openBookingModal(null));

async function saveBooking(force = false) {
  const data = Object.fromEntries(['court_name', 'meeting_date', 'end_date', 'start_time', 'end_time', 'black_case', 'red_case', 'reason', 'contact_name', 'phone', 'ip_address', 'status', 'note'].map((k) => [k, bForm[k].value.trim()]));
  const missing = ['court_name', 'meeting_date', 'start_time', 'end_time', 'black_case', 'reason', 'contact_name', 'phone', 'ip_address'].filter((k) => !data[k]);
  ['court_name', 'start_time', 'end_time', 'black_case', 'reason', 'contact_name', 'phone', 'ip_address'].forEach((k) => bForm[k].classList.toggle('is-invalid', missing.includes(k)));
  bDate.altInput.classList.toggle('is-invalid', missing.includes('meeting_date'));
  if (missing.length) return SwalTheme.fire({ icon: 'warning', title: 'กรุณากรอกข้อมูลให้ครบ' });

  const id = bForm.id.value;
  const btn = $('#bookingSave'); btn.disabled = true;
  try {
    await api(id ? `/api/bookings?id=${id}` : '/api/bookings', { method: id ? 'PUT' : 'POST', data: { ...data, force } });
    closeModal('#bookingModal');
    Toast.fire({ icon: 'success', title: id ? 'บันทึกการแก้ไขแล้ว' : 'เพิ่มการจองแล้ว' });
    await loadBookings();
  } catch (err) {
    if (err.status === 409 && await confirmConflict(err)) return saveBooking(true);
    if (err.status !== 409 && !handleAuthError(err)) alertError(err, 'บันทึกไม่สำเร็จ');
  } finally { btn.disabled = false; }
}
$('#bookingSave').addEventListener('click', () => saveBooking());
bForm.addEventListener('submit', (e) => { e.preventDefault(); saveBooking(); });

async function deleteBooking(b) {
  const ok = await confirmDanger('ลบรายการจองนี้?',
    `<div class="text-left bg-slate-50 rounded-xl p-4 text-[15px]"><b>${esc(b.court_name)}</b><br>${thaiDateRange(b)} ${b.start_time}–${b.end_time} น.<br>คดีดำ ${esc(b.black_case)}</div>
     <p class="mt-3 text-sm text-rose-600">การลบไม่สามารถกู้คืนได้ หากต้องการเก็บประวัติ แนะนำให้เปลี่ยนสถานะเป็น "ยกเลิก" แทน</p>`);
  if (!ok) return;
  try {
    await api(`/api/bookings?id=${b.id}`, { method: 'DELETE' });
    Toast.fire({ icon: 'success', title: 'ลบรายการแล้ว' });
    await loadBookings();
  } catch (err) { if (!handleAuthError(err)) alertError(err, 'ลบไม่สำเร็จ'); }
}

/* --- CSV export --- */
$('#csvBtn').addEventListener('click', () => {
  const rows = filteredBookings();
  if (!rows.length) return SwalTheme.fire({ icon: 'info', title: 'ไม่มีข้อมูลให้ส่งออก' });
  const head = ['ที่', 'วันที่', 'ถึงวันที่', 'จำนวนวัน', 'เวลาเริ่ม', 'เวลาสิ้นสุด', 'ชื่อศาล', 'คดีดำ', 'คดีแดง', 'เหตุที่นัด', 'ผู้ติดต่อ', 'โทรศัพท์', 'IP Address', 'สถานะ', 'หมายเหตุ'];
  const sorted = [...rows].sort((a, b) => (a.meeting_date + a.start_time).localeCompare(b.meeting_date + b.start_time));
  const lines = sorted.map((b, i) => [i + 1, thaiDate(b.meeting_date), thaiDate(endDateOf(b)), dayCount(b), b.start_time, b.end_time, b.court_name, b.black_case, b.red_case, b.reason, b.contact_name, b.phone, b.ip_address, STATUS_LABEL[b.status], b.note]);
  const csv = [head, ...lines].map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `การจองห้องประชุม_${todayYMD()}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

/* --- Printable report (save as PDF from the print dialog) --- */
$('#printBtn').addEventListener('click', async () => {
  let rows = filteredBookings();
  const from = $('#fFrom').value, to = $('#fTo').value;
  if (!from && !to) {
    const r = await SwalTheme.fire({
      icon: 'question', title: 'ช่วงวันที่ของรายงาน',
      html: `<div class="grid grid-cols-2 gap-3 text-left mt-2"><div><label class="label">ตั้งแต่</label><input id="rFrom" class="input"></div><div><label class="label">ถึง</label><input id="rTo" class="input"></div></div>`,
      showCancelButton: true, confirmButtonText: '<i class="fa-solid fa-print"></i> สร้างรายงาน',
      didOpen: () => { thaiDatePicker('#rFrom', { defaultDate: new Date(), static: true }); thaiDatePicker('#rTo', { defaultDate: new Date(), static: true }); },
      preConfirm: () => {
        const f = $('#rFrom').value, t = $('#rTo').value;
        if (!f || !t) { Swal.showValidationMessage('กรุณาเลือกวันที่ให้ครบ'); return false; }
        if (t < f) { Swal.showValidationMessage('วันสิ้นสุดต้องไม่ก่อนวันเริ่มต้น'); return false; }
        return { f, t };
      },
    });
    if (!r.isConfirmed) return;
    rows = rows.filter((b) => endDateOf(b) >= r.value.f && b.meeting_date <= r.value.t);
    printReport(rows, r.value.f, r.value.t);
  } else {
    printReport(rows, from, to);
  }
});

function printReport(rows, from, to) {
  rows = rows.filter((b) => b.status !== 'cancelled' || $('#fStatus').value === 'cancelled')
    .sort((a, b) => (a.meeting_date + a.start_time).localeCompare(b.meeting_date + b.start_time));
  if (!rows.length) return SwalTheme.fire({ icon: 'info', title: 'ไม่พบข้อมูลในช่วงที่เลือก' });
  const now = new Date();
  const range = from && to ? `ระหว่างวันที่ ${thaiDate(from)} ถึง ${thaiDate(to)}` : from ? `ตั้งแต่วันที่ ${thaiDate(from)}` : to ? `ถึงวันที่ ${thaiDate(to)}` : 'ทุกช่วงเวลา';
  const body = rows.map((b, i) => `<tr>
      <td class="c">${i + 1}</td><td class="c nw">${thaiDateRange(b, { short: true })}${dayCount(b) > 1 ? `<br><span class="muted">(${dayCount(b)} วัน)</span>` : ''}</td><td class="c nw">${b.start_time}–${b.end_time}</td>
      <td>${esc(b.court_name)}</td><td class="c">${esc(b.black_case)}${b.red_case ? `<br><span class="red">${esc(b.red_case)}</span>` : ''}</td>
      <td>${esc(b.reason)}</td><td>${esc(b.contact_name)}<br><span class="muted">${esc(b.phone)}</span></td><td class="c mono">${esc(b.ip_address)}</td></tr>`).join('');
  const html = `<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><title>รายงานการจองห้องประชุมทางไกล</title>
    <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap" rel="stylesheet">
    <style>
      @page { size: A4 landscape; margin: 12mm 10mm; }
      * { box-sizing: border-box; } body { font-family: 'Sarabun', sans-serif; color: #0f172a; font-size: 12.5px; margin: 0; }
      .head { text-align: center; margin-bottom: 10px; } .head h1 { font-size: 19px; margin: 0; color: #172f4d; } .head h2 { font-size: 14px; margin: 2px 0; font-weight: 600; color: #334155; }
      .meta { display: flex; justify-content: space-between; font-size: 11.5px; color: #475569; border-bottom: 2px solid #c9a227; padding-bottom: 6px; margin-bottom: 8px; }
      table { width: 100%; border-collapse: collapse; } thead { display: table-header-group; } tr { page-break-inside: avoid; }
      th { background: #1f4473; color: #fff; font-weight: 600; padding: 7px 5px; border: 1px solid #1f4473; font-size: 12px; }
      td { border: 1px solid #cbd5e1; padding: 5px 6px; vertical-align: top; } tbody tr:nth-child(even) td { background: #f8fafc; }
      .c { text-align: center; } .nw { white-space: nowrap; } .red { color: #be123c; } .muted { color: #64748b; font-size: 11px; } .mono { font-family: monospace; font-size: 11px; }
      .foot { margin-top: 10px; font-size: 11.5px; color: #475569; }
      @media print { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      th, tbody tr:nth-child(even) td { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    </style></head><body>
    <div class="head"><h1>รายงานการจองห้องประชุมทางไกลผ่านจอภาพ</h1><h2>ศาลจังหวัดอุดรธานี</h2><div>${range}</div></div>
    <div class="meta"><span>จำนวน ${rows.length} รายการ</span><span>พิมพ์เมื่อ ${thaiDate(toYMD(now))} เวลา ${now.toTimeString().slice(0, 5)} น. โดย ${esc(me.display_name)}</span></div>
    <table><thead><tr><th style="width:4%">ที่</th><th style="width:9%">วันที่</th><th style="width:9%">เวลา</th><th style="width:15%">ชื่อศาล</th><th style="width:12%">คดีดำ / แดง</th><th>เหตุที่นัด</th><th style="width:15%">ผู้ติดต่อ</th><th style="width:10%">IP Address</th></tr></thead>
    <tbody>${body}</tbody></table>
    <div class="foot">หมายเหตุ: รายงานนี้ไม่รวมรายการที่ถูกยกเลิก</div>
    <script>document.fonts.ready.then(() => setTimeout(() => window.print(), 300));<\/script></body></html>`;
  const w = window.open('', '_blank');
  if (!w) return SwalTheme.fire({ icon: 'warning', title: 'เบราว์เซอร์บล็อกหน้าต่างใหม่', text: 'กรุณาอนุญาต Pop-up สำหรับเว็บไซต์นี้แล้วลองอีกครั้ง' });
  w.document.open(); w.document.write(html); w.document.close();
}

/* --- Import history from the old Google Sheet (fetched by the server) --- */
async function importLegacy({ ask = true } = {}) {
  if (ask) {
    const r = await SwalTheme.fire({
      icon: 'question',
      title: 'ดึงประวัติจาก Google Sheet',
      html: '<p class="text-left">ระบบจะดึงข้อมูลการจองทั้งหมดจาก Google Sheet ของระบบเดิมมาบันทึกในฐานข้อมูลใหม่<br><span class="text-sm text-slate-500">รายการที่มีอยู่แล้ว (วันที่ เวลาเริ่ม ศาล และคดีดำเดียวกัน) จะถูกข้าม จึงกดซ้ำได้อย่างปลอดภัย</span></p>',
      showCancelButton: true,
      confirmButtonText: '<i class="fa-solid fa-cloud-arrow-down"></i> ดึงข้อมูล',
    });
    if (!r.isConfirmed) return;
  }
  SwalTheme.fire({ title: 'กำลังดึงประวัติจาก Google Sheet…', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
  try {
    const res = await api('/api/bookings?action=import-legacy', { method: 'POST' });
    await SwalTheme.fire({
      icon: res.failed ? 'warning' : 'success',
      title: 'ดึงประวัติเสร็จสิ้น',
      html: `<div class="text-left space-y-1">
        <div>พบข้อมูลใน Google Sheet <b>${res.total}</b> แถว</div>
        <div>นำเข้าใหม่ <b class="text-emerald-600">${res.inserted}</b> · มีอยู่แล้ว/ซ้ำ <b>${res.skipped}</b> · ไม่สำเร็จ <b class="text-rose-600">${res.failed}</b></div>
        ${res.errors.length ? `<ul class="mt-3 text-xs text-rose-600 max-h-40 overflow-auto list-disc pl-5">${res.errors.map((e) => `<li>แถว ${e.row}: ${esc(e.message)}</li>`).join('')}</ul>` : ''}
        <p class="text-xs text-slate-500 pt-2">รายการที่นำเข้าจะมีป้าย "นำเข้า" และหากข้อมูลเดิมมีเวลาหรือ IP ผิดรูปแบบ ระบบจะบันทึกไว้ในหมายเหตุ</p></div>`,
    });
    loadBookings();
  } catch (err) {
    if (!handleAuthError(err)) alertError(err, 'ดึงประวัติไม่สำเร็จ');
  }
}
$('#importBtn').addEventListener('click', () => importLegacy());

/* ---------------- Users ---------------- */
const usersTable = createTable({
  el: '#usersTable',
  pageSize: 20,
  columns: [
    { title: 'ผู้ใช้งาน', render: (u) => `<div class="flex items-center gap-3"><div class="w-9 h-9 rounded-full ${u.role === 'admin' ? 'bg-gold-100 text-gold-700' : 'bg-navy-50 text-navy-700'} font-bold grid place-items-center">${esc(u.display_name.charAt(0))}</div><div><div class="font-medium">${esc(u.display_name)}${u.id === me.id ? ' <span class="text-xs text-slate-400">(คุณ)</span>' : ''}</div><div class="text-xs text-slate-500 font-mono">${esc(u.username)}</div></div></div>` },
    { title: 'สิทธิ์', render: (u) => u.role === 'admin' ? '<span class="inline-flex items-center gap-1 rounded-full bg-gold-50 text-gold-700 ring-1 ring-gold-100 px-2.5 py-1 text-xs font-medium"><i class="fa-solid fa-user-shield"></i>ผู้ดูแลระบบ</span>' : '<span class="inline-flex items-center gap-1 rounded-full bg-navy-50 text-navy-700 ring-1 ring-navy-100 px-2.5 py-1 text-xs font-medium"><i class="fa-solid fa-user"></i>เจ้าหน้าที่</span>' },
    { title: 'สถานะ', render: (u) => u.is_active ? '<span class="text-emerald-600 text-sm"><i class="fa-solid fa-circle text-[8px] mr-1 align-middle"></i>ใช้งาน</span>' : '<span class="text-slate-400 text-sm"><i class="fa-solid fa-circle text-[8px] mr-1 align-middle"></i>ปิดใช้งาน</span>' },
    { title: 'เข้าสู่ระบบล่าสุด', tdClass: 'text-sm text-slate-500 whitespace-nowrap', render: (u) => (u.last_login ? thaiDateTime(u.last_login) : '-') },
    { title: '', tdClass: 'text-right whitespace-nowrap', render: (u) => `
      <button data-uact="edit" data-id="${u.id}" class="w-9 h-9 rounded-lg text-navy-700 hover:bg-navy-50" title="แก้ไข"><i class="fa-solid fa-pen-to-square"></i></button>
      ${u.id === me.id ? '' : `<button data-uact="del" data-id="${u.id}" class="w-9 h-9 rounded-lg text-rose-600 hover:bg-rose-50" title="ลบ"><i class="fa-solid fa-trash-can"></i></button>`}` },
  ],
  empty: 'ยังไม่มีผู้ใช้งาน',
});

async function loadUsers() {
  try {
    const { data } = await api('/api/users');
    users = data;
    usersTable.setRows(users, { keepPage: true });
  } catch (err) { if (!handleAuthError(err)) alertError(err); }
}

$('#usersTable').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-uact]');
  if (!btn) return;
  const u = users.find((x) => x.id == btn.dataset.id);
  if (btn.dataset.uact === 'edit') openUserModal(u);
  if (btn.dataset.uact === 'del') deleteUser(u);
});

const uForm = $('#userForm');
function openUserModal(u) {
  uForm.reset();
  $('#userModalTitle').textContent = u ? 'แก้ไขผู้ใช้งาน' : 'เพิ่มผู้ใช้งาน';
  uForm.id.value = u?.id || '';
  uForm.display_name.value = u?.display_name || '';
  uForm.username.value = u?.username || '';
  uForm.username.disabled = !!u;
  uForm.role.value = u?.role || 'staff';
  uForm.is_active.value = String(u ? u.is_active : true);
  $('#userPwLabel').innerHTML = u ? 'ตั้งรหัสผ่านใหม่' : 'รหัสผ่าน<span class="req">*</span>';
  $('#userPwHint').textContent = u ? 'เว้นว่างไว้หากไม่ต้องการเปลี่ยน' : 'อย่างน้อย 8 ตัวอักษร';
  openModal('#userModal');
  setTimeout(() => uForm.display_name.focus(), 50);
}
$('#addUserBtn').addEventListener('click', () => openUserModal(null));
$('#genPw').addEventListener('click', () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const arr = crypto.getRandomValues(new Uint32Array(10));
  uForm.password.value = [...arr].map((n) => chars[n % chars.length]).join('');
});

$('#userSave').addEventListener('click', async () => {
  const id = uForm.id.value;
  const data = {
    display_name: uForm.display_name.value.trim(),
    username: uForm.username.value.trim(),
    role: uForm.role.value,
    is_active: uForm.is_active.value === 'true',
    password: uForm.password.value,
  };
  if (!data.display_name || (!id && (!data.username || !data.password))) return SwalTheme.fire({ icon: 'warning', title: 'กรุณากรอกข้อมูลให้ครบ' });
  try {
    await api(id ? `/api/users?id=${id}` : '/api/users', { method: id ? 'PUT' : 'POST', data });
    closeModal('#userModal');
    if (data.password) {
      await SwalTheme.fire({ icon: 'success', title: id ? 'บันทึกแล้ว' : 'เพิ่มผู้ใช้งานแล้ว', html: `แจ้งข้อมูลเข้าสู่ระบบแก่ผู้ใช้<div class="mt-3 bg-slate-50 rounded-xl p-4 text-left font-mono text-sm">ชื่อผู้ใช้: ${esc(data.username)}<br>รหัสผ่าน: ${esc(data.password)}</div>` });
    } else Toast.fire({ icon: 'success', title: 'บันทึกแล้ว' });
    loadUsers();
  } catch (err) { if (!handleAuthError(err)) alertError(err, 'บันทึกไม่สำเร็จ'); }
});

async function deleteUser(u) {
  const ok = await confirmDanger('ลบผู้ใช้งานนี้?', `<b>${esc(u.display_name)}</b> (${esc(u.username)})<p class="mt-2 text-sm">หากต้องการระงับชั่วคราว แนะนำให้ "ปิดใช้งาน" แทนการลบ</p>`);
  if (!ok) return;
  try {
    await api(`/api/users?id=${u.id}`, { method: 'DELETE' });
    Toast.fire({ icon: 'success', title: 'ลบผู้ใช้งานแล้ว' });
    loadUsers();
  } catch (err) { if (!handleAuthError(err)) alertError(err, 'ลบไม่สำเร็จ'); }
}

/* ---------------- Embed calendar ---------------- */
let embedTimer = null;
function embedUrl() {
  const p = new URLSearchParams();
  p.set('view', $('#eView').value);
  if ($('#eHeader').checked) p.set('header', '1');
  if ($('#eFooter').checked) p.set('footer', '1');
  if (!$('#eNav').checked) p.set('nav', '0');
  if (!$('#eDetails').checked) p.set('details', '0');
  if ($('#eCompact').checked) p.set('compact', '1');
  if ($('#eRefresh').value !== '5') p.set('refresh', $('#eRefresh').value);
  const title = $('#eTitle').value.trim();
  if (title) p.set('title', title);
  return `${location.origin}/embed?${p.toString()}`;
}
function updateEmbed() {
  const url = embedUrl();
  const h = Math.min(2000, Math.max(300, Number($('#eHeight').value) || 700));
  const wv = $('#eWidth').value;
  const w = wv === '100%' ? '100%' : `${wv}`;
  $('#eCode').value =
    `<iframe src="${url}"\n  width="${w}" height="${h}" style="border:0;border-radius:12px;max-width:100%"\n  title="ปฏิทินการจองห้องประชุมทางไกล ศาลจังหวัดอุดรธานี" loading="lazy"></iframe>`;
  $('#eOpen').href = url;
  $('#eSizeLabel').textContent = `${wv === '100%' ? 'กว้างเต็มพื้นที่' : wv + ' px'} × ${h} px`;
  const frame = $('#ePreview');
  frame.style.width = wv === '100%' ? '100%' : `${wv}px`;
  frame.style.height = `${h}px`;
  clearTimeout(embedTimer);
  embedTimer = setTimeout(() => { if (frame.getAttribute('src') !== url) frame.src = url; }, 350);
}
['#eView', '#eHeight', '#eWidth', '#eRefresh', '#eTitle', '#eHeader', '#eFooter', '#eNav', '#eDetails', '#eCompact']
  .forEach((id) => $(id).addEventListener(id === '#eTitle' || id === '#eHeight' ? 'input' : 'change', updateEmbed));

async function copyText(text, label) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select();
    document.execCommand('copy'); t.remove();
  }
  Toast.fire({ icon: 'success', title: label });
}
$('#eCopy').addEventListener('click', () => copyText($('#eCode').value, 'คัดลอกโค้ด iframe แล้ว'));
$('#eCopyUrl').addEventListener('click', () => copyText(embedUrl(), 'คัดลอกลิงก์แล้ว'));

/* ---------------- Account ---------------- */
$('#pwForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if ($('#pwNew').value !== $('#pwNew2').value) return SwalTheme.fire({ icon: 'warning', title: 'รหัสผ่านใหม่ไม่ตรงกัน' });
  try {
    await api('/api/auth?action=password', { method: 'POST', data: { current_password: $('#pwCurrent').value, new_password: $('#pwNew').value } });
    e.target.reset();
    SwalTheme.fire({ icon: 'success', title: 'เปลี่ยนรหัสผ่านแล้ว' });
  } catch (err) { if (!handleAuthError(err)) alertError(err, 'เปลี่ยนรหัสผ่านไม่สำเร็จ'); }
});

boot();
