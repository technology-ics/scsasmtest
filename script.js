'use strict';

// This published Google Sheet is the ONLY programme data source.
const CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vR7XZFOcEKOxCsw8Yb1LJpdSj_VUhncQMaGqTIOW19PRN1jr9Df4b_-_hmJ7dOHvUUXe4dCezqVn2Hd/pub?gid=0&single=true&output=csv';
const FIELDS = {
  name: 'Session - Name', details: 'Session - Details', date: 'Session - Date',
  start: 'Session - Start Time', end: 'Session - End Time',
  location: 'Session - Location', track: 'Session - Track'
};
const state = { sessions: [], dates: [], date: '', search: '', track: '', location: '' };
const ui = {};

function clean(value) { return value == null ? '' : String(value).trim(); }
function norm(value) { return clean(value).replace(/\s+/g, ' ').toLocaleLowerCase(); }

// Calendar dates are kept as YYYY-MM-DD strings. Never use UTC conversions.
function parseDate(value) {
  const s = clean(value);
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T].*)?$/);
  if (m) return validatedDate(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return +m[1] > 12 ? validatedDate(+m[3], +m[2], +m[1]) : validatedDate(+m[3], +m[1], +m[2]);
  m = s.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m) {
    const months = ['january','february','march','april','may','june','july','august','september','october','november','december'];
    const idx = months.findIndex(month => month.startsWith(m[1].toLowerCase()) && m[1].length >= 3);
    if (idx >= 0) return validatedDate(+m[3], idx + 1, +m[2]);
  }
  return '';
}
function validatedDate(y, m, d) {
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d
    ? `${String(y).padStart(4,'0')}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}` : '';
}
function timeMinutes(value) {
  const s = clean(value);
  const m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i);
  if (!m) return null;
  let hour = +m[1]; const minute = +m[2]; const ap = m[3]?.toUpperCase();
  if (minute > 59 || (ap ? hour < 1 || hour > 12 : hour > 23)) return null;
  if (ap) hour = hour % 12 + (ap === 'PM' ? 12 : 0);
  return hour * 60 + minute;
}
function formatTime(minutes) {
  if (minutes == null) return '';
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return `${String(h % 12 || 12).padStart(2,'0')}:${String(m).padStart(2,'0')} ${h < 12 ? 'AM' : 'PM'}`;
}
function localDate(dateString) {
  const [year, month, day] = dateString.split('-').map(Number);
  return new Date(year, month - 1, day);
}
function formattedDate(dateString) {
  return new Intl.DateTimeFormat('en-US', { weekday:'long', month:'long', day:'numeric' }).format(localDate(dateString));
}
function shortDate(dateString) {
  return new Intl.DateTimeFormat('en-US', { month:'short', day:'numeric' }).format(localDate(dateString));
}
function distinct(values) { return [...new Set(values.filter(Boolean))].sort((a,b) => a.localeCompare(b, undefined, {numeric:true})); }
function addDistinct(existing, incoming) {
  if (!incoming) return existing;
  const parts = existing ? existing.split(' | ') : [];
  if (!parts.some(item => norm(item) === norm(incoming))) parts.push(incoming);
  return parts.join(' | ');
}
function buildSessions(rows) {
  const found = new Map();
  for (const row of rows) {
    const name = clean(row[FIELDS.name]);
    const date = parseDate(row[FIELDS.date]);
    if (!name || !date) continue;
    const start = timeMinutes(row[FIELDS.start]);
    const end = timeMinutes(row[FIELDS.end]);
    const location = clean(row[FIELDS.location]);
    const track = clean(row[FIELDS.track]);
    const details = clean(row[FIELDS.details]);
    // All five identity fields must match. Missing times are distinct from known times.
    const key = JSON.stringify([norm(name),date,start,end,norm(location)]);
    if (!found.has(key)) found.set(key, {id:key,name,date,start,end,location,track,details});
    else {
      const existing = found.get(key);
      existing.track = addDistinct(existing.track, track);
      if (!existing.details) existing.details = details;
      else if (details && norm(existing.details) !== norm(details)) {
        // Retain complementary detail content, without repeating identical copies.
        if (norm(details).includes(norm(existing.details))) existing.details = details;
        else if (!norm(existing.details).includes(norm(details))) existing.details += '\n\n' + details;
      }
    }
  }
  return [...found.values()].sort((a,b) => a.date.localeCompare(b.date)
    || (a.start ?? 9999) - (b.start ?? 9999) || (a.end ?? 9999) - (b.end ?? 9999)
    || a.name.localeCompare(b.name,undefined,{numeric:true}) || a.location.localeCompare(b.location));
}

function make(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
}
function setStatus(message, error = false) {
  ui.status.hidden = false;
  ui.status.replaceChildren(make('span','',message));
  if (error) {
    const br = document.createElement('div');
    const retry = make('button','retry-button','Try again');
    retry.type = 'button'; retry.addEventListener('click',loadAgenda);
    br.append(retry);
    const diagnostic = make('a','diagnostic-link','Open the published CSV directly');
    diagnostic.href = CSV_URL; diagnostic.target = '_blank'; diagnostic.rel = 'noopener noreferrer';
    br.append(document.createTextNode('  '), diagnostic);
    ui.status.append(br);
  }
}
function populate(select, values, allLabel) {
  const previous = select.value;
  select.replaceChildren(new Option(allLabel,''), ...values.map(v => new Option(v,v)));
  select.value = values.includes(previous) ? previous : '';
}
function renderTabs() {
  ui.tabs.replaceChildren();
  for (const date of state.dates) {
    const button = make('button','date-tab');
    button.type = 'button'; button.role = 'tab';
    button.setAttribute('aria-selected',String(date === state.date));
    button.tabIndex = date === state.date ? 0 : -1;
    button.append(make('span','weekday',new Intl.DateTimeFormat('en-US',{weekday:'long'}).format(localDate(date))),
      make('span','day',shortDate(date)));
    button.addEventListener('click',() => selectDate(date));
    button.addEventListener('keydown',event => {
      if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
      event.preventDefault(); const pos=state.dates.indexOf(date);
      const next=event.key==='Home'?0:event.key==='End'?state.dates.length-1:
        (pos+(event.key==='ArrowRight'?1:-1)+state.dates.length)%state.dates.length;
      selectDate(state.dates[next]); ui.tabs.children[next].focus();
    });
    ui.tabs.append(button);
  }
}
function selectDate(date) { state.date = date; renderTabs(); renderSessions(); }
function metaItem(label,value) {
  const span = make('span','meta-item');
  if (label) span.append(make('span','meta-label',label));
  span.append(document.createTextNode(value)); return span;
}
function sanitizedDetails(text) {
  // DOMPurify strips scripts, unsafe attributes and URLs. Preserve CSV line breaks.
  const html = text.replace(/\r\n?/g,'\n').replace(/\n/g,'<br>');
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS:['br','p','b','strong','i','em','u','ul','ol','li','sup','sub'],
    ALLOWED_ATTR:[]
  });
}
function renderSessions() {
  ui.heading.textContent = state.date ? formattedDate(state.date) : 'Conference sessions';
  const q = norm(state.search);
  const filtered = state.sessions.filter(s => s.date===state.date
    && (!state.track || s.track.split(' | ').includes(state.track))
    && (!state.location || s.location===state.location)
    && (!q || norm(s.name).includes(q) || norm(s.details.replace(/<[^>]*>/g,' ')).includes(q)));
  ui.count.textContent = `${filtered.length} ${filtered.length===1?'session':'sessions'}`;
  ui.list.replaceChildren();
  if (!filtered.length) {setStatus('No sessions match your filters. Try clearing the search or filters.'); return;}
  ui.status.hidden = true;
  const fragment = document.createDocumentFragment();
  for (const session of filtered) {
    const card = make('details','session-card'+(session.details?'':' no-details'));
    const summary = document.createElement('summary');
    summary.append(make('h3','session-title',session.name));
    const meta = make('div','meta');
    const times = [formatTime(session.start),formatTime(session.end)].filter(Boolean).join(' – ');
    if (times) meta.append(metaItem('',times));
    if (session.location) meta.append(metaItem('Location:',session.location));
    if (session.track) meta.append(make('span','track-tag',`Track ${session.track}`));
    summary.append(meta); card.append(summary);
    if (session.details) {
      const detail = make('div','session-details');
      detail.innerHTML = sanitizedDetails(session.details);
      card.append(detail);
    } else {
      summary.addEventListener('click',event=>event.preventDefault());
    }
    fragment.append(card);
  }
  ui.list.append(fragment);
}
async function loadAgenda() {
  setStatus('Loading the latest programme…'); ui.list.replaceChildren();
  if (typeof Papa === 'undefined' || typeof DOMPurify === 'undefined') {
    const missing = [typeof Papa === 'undefined' ? 'Papa Parse' : '', typeof DOMPurify === 'undefined' ? 'DOMPurify' : ''].filter(Boolean).join(' and ');
    setStatus(`The ${missing} library could not load. Check whether your network blocks cdnjs.cloudflare.com, then reload the page.`,true); return;
  }
  try {
    // Cache-buster ensures browsers request a fresh published CSV on page refresh.
    const url = `${CSV_URL}&_=${Date.now()}`;
    const response = await fetch(url,{cache:'no-store'});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const csv = await response.text();
    if (!csv.trim()) throw new Error('The published CSV is empty.');
    if (/^\s*<!doctype html|^\s*<html/i.test(csv)) throw new Error('Google returned an HTML page rather than CSV. Check that the sheet is published to the web as CSV.');
    const parsed = Papa.parse(csv,{header:true,skipEmptyLines:'greedy',transformHeader:h=>h.replace(/^\uFEFF/,'').trim()});
    const headers = parsed.meta.fields || [];
    const missing = Object.values(FIELDS).filter(name=>!headers.includes(name));
    if (missing.length) throw new Error(`Missing spreadsheet columns: ${missing.join(', ')}. Check the published CSV tab (gid=0).`);
    const records = buildSessions(parsed.data);
    if (!records.length) throw new Error('The published sheet contains no valid sessions.');
    state.sessions = records;
    state.dates = distinct(records.map(s=>s.date));
    if (!state.dates.includes(state.date)) state.date = state.dates[0];
    populate(ui.track,distinct(records.flatMap(s=>s.track.split(' | '))),'All tracks');
    populate(ui.location,distinct(records.map(s=>s.location)),'All locations');
    state.track=ui.track.value; state.location=ui.location.value;
    renderTabs(); renderSessions();
  } catch (error) {
    console.error('Unable to load the programme:',error);
    ui.count.textContent='';
    const message = error instanceof Error ? error.message : String(error);
    const network = error instanceof TypeError && /fetch|network|load/i.test(message);
    setStatus(network
      ? 'The browser could not retrieve the Google Sheets CSV. Open the published CSV link below. If it opens correctly but this page fails, check the browser console for a CORS or network policy error.'
      : `Unable to load the programme: ${message}`,true);
  }
}
function init() {
  Object.assign(ui, {
    tabs:document.getElementById('date-tabs'),search:document.getElementById('search'),
    track:document.getElementById('track-filter'),location:document.getElementById('location-filter'),
    clear:document.getElementById('clear-filters'),heading:document.getElementById('selected-date-heading'),
    count:document.getElementById('results-count'),status:document.getElementById('status'),
    list:document.getElementById('session-list')
  });
  ui.search.addEventListener('input',()=>{state.search=ui.search.value;renderSessions();});
  ui.track.addEventListener('change',()=>{state.track=ui.track.value;renderSessions();});
  ui.location.addEventListener('change',()=>{state.location=ui.location.value;renderSessions();});
  ui.clear.addEventListener('click',()=>{
    state.search=state.track=state.location='';ui.search.value='';ui.track.value='';ui.location.value='';renderSessions();
  });
  loadAgenda();
}
if (typeof module !== 'undefined' && module.exports) module.exports={parseDate,timeMinutes,buildSessions,formatTime};
if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded',init);
