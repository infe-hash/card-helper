const $ = (id) => document.getElementById(id);
const won = (n) => Math.round(n).toLocaleString('ko-KR') + '원';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const DATA_CACHE = 'ledger-data';
const DATA_KEY = './ledger-file';

let txs = [];        // 지출 내역
let months = [];     // 'YYYY-MM' 오름차순
let current = '';    // 보고 있는 달
let lastDate = '';   // 가계부의 마지막 날짜
let mapping = {};    // 카드 id -> 가계부 자산 이름
let realSpend = {};  // '카드 id|YYYY-MM' -> 카드 앱에서 확인한 실제 실적
try { realSpend = JSON.parse(localStorage.getItem('realspend') || '{}'); } catch (e) { /* 저장값 없이 진행 */ }

// ---------- 가계부 읽기 ----------

function toDateParts(v) {
  if (typeof v === 'number') {
    const d = new Date(Math.round((v - 25569) * 86400000));
    return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
  }
  if (v instanceof Date) return [v.getFullYear(), v.getMonth() + 1, v.getDate()];
  const m = String(v || '').match(/(\d{4})\D(\d{1,2})\D(\d{1,2})/);
  return m ? [+m[1], +m[2], +m[3]] : null;
}

// 열 이름 후보 (한글·영문 내보내기 모두)
const COLUMNS = {
  date: ['날짜', '기간', 'date', 'period'],
  asset: ['자산', 'account', 'accounts', 'asset'],
  cat: ['분류', 'category'],
  sub: ['소분류', 'subcategory'],
  desc: ['내용', 'note', 'contents'],
  amt: ['krw', '금액', 'amount'],
  type: ['수입/지출', 'income/expense', '구분'],
  memo: ['메모', 'description', 'memo'],
};
const EXPENSE_WORDS = ['지출', 'expense', 'exp.', 'expenses'];
const norm = (v) => String(v == null ? '' : v).replace(/[\s﻿]/g, '').toLowerCase();

function readWorkbook(buf) {
  const b = new Uint8Array(buf);
  const isZip = b[0] === 0x50 && b[1] === 0x4b;
  const isOle = b[0] === 0xd0 && b[1] === 0xcf;
  if (isZip || isOle) return XLSX.read(buf, { type: 'array' });
  // 글자로 된 파일(CSV·TSV·HTML)은 한글이 깨지지 않게 직접 풀어서 넘긴다
  let enc = 'utf-8';
  if (b[0] === 0xff && b[1] === 0xfe) enc = 'utf-16le';
  else if (b[0] === 0xfe && b[1] === 0xff) enc = 'utf-16be';
  let text = new TextDecoder(enc).decode(buf);
  if (enc === 'utf-8' && text.includes('�')) text = new TextDecoder('euc-kr').decode(buf);
  return XLSX.read(text, { type: 'string' });
}

function describeFile(buf, wb, rows) {
  const b = new Uint8Array(buf);
  const sig = Array.from(b.slice(0, 4)).map((x) => x.toString(16).padStart(2, '0')).join(' ');
  const first = (rows || []).slice(0, 2).map((r) => (r || []).slice(0, 8).join(' | ')).join(' // ');
  return `크기 ${b.length.toLocaleString()}바이트, 시작 ${sig}, 시트 ${wb ? wb.SheetNames.join(',') : '없음'}, 첫 줄: ${first.slice(0, 160) || '(비어 있음)'}`;
}

function parseLedger(buf) {
  let wb;
  try { wb = readWorkbook(buf); } catch (e) { throw new Error('파일을 열지 못했습니다. ' + describeFile(buf)); }

  // 시트마다 앞쪽 10줄 안에서 제목 줄을 찾는다
  let rows = [];
  let c = null;
  let start = 0;
  for (const name of wb.SheetNames) {
    const sheet = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true });
    if (!rows.length) rows = sheet;
    for (let i = 0; i < Math.min(10, sheet.length) && !c; i++) {
      const head = (sheet[i] || []).map(norm);
      const found = {};
      for (const [key, names] of Object.entries(COLUMNS)) found[key] = head.findIndex((h) => names.includes(h));
      if (found.date >= 0 && found.asset >= 0 && found.amt >= 0 && found.type >= 0) { c = found; rows = sheet; start = i + 1; }
    }
    if (c) break;
  }
  if (!c) throw new Error('편한가계부 엑셀 형식으로 읽지 못했습니다. 이 화면을 캡처해 보내 주세요. ' + describeFile(buf, wb, rows));

  const out = [];
  for (let i = start; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !EXPENSE_WORDS.includes(norm(r[c.type]))) continue;
    const p = toDateParts(r[c.date]);
    const amt = Number(String(r[c.amt]).replace(/,/g, ''));
    if (!p || !amt) continue;
    const t = {
      ym: p[0] + '-' + String(p[1]).padStart(2, '0'),
      day: p[2],
      asset: String(r[c.asset] || '').trim(),
      cat: String(r[c.cat] || '').trim(),
      sub: String(r[c.sub] || '').trim(),
      text: String(r[c.desc] || '') + ' ' + String(r[c.memo] || ''),
      amt,
    };
    t.kind = CATEGORY_RULES.find((rule) => rule[1](t))[0];
    out.push(t);
  }
  if (!out.length) throw new Error('지출 내역을 찾지 못했습니다.');
  return out;
}

// ---------- 계산 ----------

function prevMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return m === 1 ? (y - 1) + '-12' : y + '-' + String(m - 1).padStart(2, '0');
}

function monthSpend(card, ym) {
  const asset = mapping[card.id];
  // 가계부는 최신순이라 뒤집어서 날짜순으로 둔다
  const list = asset ? txs.filter((t) => t.asset === asset && t.ym === ym).reverse() : [];
  const byKind = {};
  let counted = 0;
  for (const t of list) {
    byKind[t.kind] = (byKind[t.kind] || 0) + t.amt;
    if (!card.excluded.includes(t.kind)) counted += t.amt;
  }
  return { counted, byKind, list };
}

const tierOf = (card, counted) => card.tiers.filter((v) => counted >= v).length - 1;
const benefitCap = (b, tier) => (tier >= 0 ? b.capSpend[Math.min(tier, b.capSpend.length - 1)] : 0);

// 그 달의 인정 실적. 할인받은 결제가 실적에서 빠지는 카드는 한도만큼 덜어낸다.
// 한도는 전달 실적 구간에 달려 있어 몇 달 거슬러 올라가며 계산한다.
function countedFor(card, ym, depth = 0) {
  // 카드 앱에서 확인한 실제 실적을 넣어 두었으면 그 값을 쓴다
  const real = realSpend[card.id + '|' + ym];
  if (real > 0) return real;
  const m = monthSpend(card, ym);
  if (!card.discountExcluded) return m.counted;
  const tier = depth >= 3 ? 0 : tierOf(card, countedFor(card, prevMonth(ym), depth + 1));
  let cut = 0;
  for (const b of card.benefits) {
    if (!card.discountExcluded.includes(b.id)) continue;
    // 날짜순으로, 한도가 남아 있는 동안의 결제는 건 전체가 빠진다
    let room = benefitCap(b, tier);
    for (const t of m.list) {
      if (room <= 0) break;
      if (!b.cats.includes(t.kind) || card.excluded.includes(t.kind)) continue;
      cut += t.amt;
      room -= t.amt;
    }
  }
  return m.counted - cut;
}

function cardState(card, ym) {
  const asset = mapping[card.id];
  const now = monthSpend(card, ym);
  now.counted = countedFor(card, ym);
  const before = { counted: countedFor(card, prevMonth(ym)) };
  // 이 달 이전에 쓴 적이 없는 새 카드는 혜택이 유예되는 것으로 본다
  const isNew = asset && !txs.some((t) => t.asset === asset && t.ym < ym);
  let tier = tierOf(card, before.counted);
  if (isNew) tier = 0;
  const active = tier >= 0;

  const benefits = card.benefits.map((b) => {
    const used = b.cats.reduce((s, k) => s + (now.byKind[k] || 0), 0);
    const cap = benefitCap(b, tier);
    return { ...b, used, cap, left: Math.max(0, cap - used) };
  });

  // 혜택 없이 실적만 쌓는 결제가 필요한 만큼을 넘었는지
  const benefitKinds = new Set(card.benefits.flatMap((b) => b.cats));
  let useful = 0;
  let plain = 0;
  for (const [kind, amt] of Object.entries(now.byKind)) {
    if (card.excluded.includes(kind)) continue;
    if (benefitKinds.has(kind)) useful += amt; else plain += amt;
  }
  const usefulCapped = Math.min(useful, benefits.reduce((s, b) => s + (b.cats.some((k) => !card.excluded.includes(k)) ? b.cap : 0), 0));
  plain += useful - usefulCapped;
  const need = Math.max(0, card.tiers[0] - usefulCapped);
  let overflow = card.id === OVERFLOW_CARD ? 0 : Math.max(0, plain - need);
  // 할인분이 실적에서 빠지는 카드는 인정 실적 전체가 혜택 없는 결제다
  if (card.discountExcluded) overflow = Math.max(0, now.counted - card.tiers[0]);

  let earned = 0;
  if (card.earn) {
    for (const [kind, amt] of Object.entries(now.byKind)) earned += amt * (kind in card.earn ? card.earn[kind] : card.earn.base);
  }
  let annual = null;
  if (card.annual && asset) {
    const from = card.annual.start.slice(0, 7);
    const sum = txs.filter((t) => t.asset === asset && t.ym >= from && t.ym <= ym && !card.excluded.includes(t.kind)).reduce((s, t) => s + t.amt, 0);
    annual = { sum, ...card.annual };
  }

  return {
    card, asset, isNew, active, tier, benefits, overflow, earned, annual,
    spend: now.counted, before: before.counted, total: Object.values(now.byKind).reduce((s, v) => s + v, 0),
    remain: Math.max(0, card.tiers[0] - now.counted),
    nextTier: card.tiers.find((v) => v > now.counted),
  };
}

// ---------- 추천 ----------

function buildAdvice(states) {
  const s = Object.fromEntries(states.map((x) => [x.card.id, x]));
  const has = (id) => s[id] && s[id].asset;
  const ben = (id, bid) => (has(id) ? s[id].benefits.find((b) => b.id === bid) : null);
  const over = CARDS.find((c) => c.id === OVERFLOW_CARD).name;
  const rows = [];

  const ep = ben('taptap', 'easypay');
  const kbDel = ben('kb', 'delivery');
  if (ep && ep.left > 0) {
    rows.push(['쿠팡이츠·쿠팡·네이버페이', s.taptap.card.name, `5% 한도까지 ${won(ep.left)} 더 쓸 수 있음`]);
  } else {
    const why = ep && !s.taptap.active ? 'taptap은 지난달 실적 미달로 이번 달 할인 없음' : 'taptap 간편결제 한도를 다 씀';
    if (kbDel && kbDel.left > 0) rows.push(['쿠팡이츠·배민', s.kb.card.name + ' (KB Pay)', `${why}. KB 배달 10% 한도 ${won(kbDel.left)} 남음`]);
    rows.push(['쿠팡·네이버페이', over, `${why}. 1~1.2% 적립`]);
  }

  const fuel = ben('deepoil', 'fuel');
  const kbFuel = ben('kb', 'fuel');
  if (fuel && fuel.left > 0) rows.push(['주유', s.deepoil.card.name, `10% 한도까지 ${won(fuel.left)} 남음`]);
  else if (kbFuel && kbFuel.left > 0) rows.push(['주유', s.kb.card.name, `Deep Oil 한도를 다 씀. KB 주유 10% 한도 ${won(kbFuel.left)} 남음`]);
  else rows.push(['주유', over, '주유 할인 한도를 다 씀. 1% 적립']);

  // 혜택 없는 결제로 실적을 채워야 하는 카드 (모자란 금액이 작은 순)
  const short = states
    .filter((x) => x.asset && !x.card.optional && x.remain > 0)
    .sort((a, b) => a.remain - b.remain);
  const chain = short.map((x) => `${x.card.name} ${won(x.remain)}`);

  const tollCard = has('deepoil') && s.deepoil.remain > 0 ? s.deepoil : short[0];
  rows.push(['통행료', tollCard ? tollCard.card.name : '아무 카드', tollCard ? `실적 ${won(tollCard.remain)} 모자람` : '모든 카드 실적을 채움. 통행료는 어디서도 적립 안 됨']);

  rows.push(['옷·병원·그 외', chain.length ? chain.join(' → ') : over, chain.length ? `위 금액만 채우고, 나머지는 전부 ${over}` : '모든 카드 실적을 채움. 1% 적립']);
  rows.push(['항공권', over, '항공사 공식 홈페이지·앱에서 결제하면 1.5% 적립']);
  rows.push(['통신요금', s.kb ? s.kb.card.name : 'KB YOU Prime', '자동납부 그대로']);
  rows.push(['넷플릭스', over, '50% 할인, 월 1만 원까지. taptap(지금 구간 월 5천 원)보다 큼']);
  rows.push(['일본 현지 결제', '네이버 머니카드', '해외 수수료가 없음']);
  return rows;
}

// 결제 종류 하나에 대해 쓸 카드를 좋은 순서로 늘어놓는다
function recommend(kind, amount, states) {
  const type = PURCHASE_TYPES.find((t) => t.kind === kind);
  if (type.fixed) return [{ name: type.fixed[0], why: type.fixed[1], room: Infinity }];
  const live = states.filter((x) => x.asset && !x.card.optional);
  const steps = [];
  for (const x of live) {
    for (const b of x.benefits) {
      if (b.cats.includes(kind) && b.left > 0) steps.push({ name: x.card.name, why: `${b.label} · ${won(b.left)}까지 할인`, room: b.left, rate: b.rate });
    }
  }
  steps.sort((a, b) => b.rate - a.rate || b.room - a.room);
  live.filter((x) => x.remain > 0 && x.card.id !== OVERFLOW_CARD && !x.card.excluded.includes(kind))
    .sort((a, b) => a.remain - b.remain)
    .forEach((x) => steps.push({ name: x.card.name, why: `할인은 없지만 실적 ${won(x.remain)} 모자람`, room: x.remain }));
  const over = CARDS.find((c) => c.id === OVERFLOW_CARD);
  const rate = kind in over.earn ? over.earn[kind] : over.earn.base;
  if (rate) {
    steps.push({ name: over.name, why: `${+(rate * 100).toFixed(1)}% 적립, 한도 없음`, room: Infinity });
  } else {
    // 적립도 안 되는 결제는 실적으로라도 인정해 주는 카드로
    const counts = live.find((x) => !x.card.excluded.includes(kind));
    const name = counts ? counts.card.name : over.name;
    const last = steps[steps.length - 1];
    // 바로 앞 단계가 같은 카드면 줄을 늘리지 않고 그 카드로 끝까지 쓴다
    if (last && last.name === name) last.room = Infinity;
    else steps.push({ name, why: counts ? '혜택은 없지만 실적으로는 인정됨' : '어느 카드도 혜택 없음', room: Infinity });
  }
  if (!amount) return steps;
  const plan = [];
  let rest = amount;
  for (const s of steps) {
    const use = Math.min(rest, s.room);
    if (use > 0) plan.push({ ...s, use });
    rest -= use;
    if (rest <= 0) break;
  }
  return plan;
}

function findType(query) {
  const q = norm(query);
  if (!q) return null;
  return PURCHASE_TYPES.find((t) => t.words.some((w) => q.includes(norm(w)) || norm(w).includes(q))) || PURCHASE_TYPES.find((t) => t.kind === 'general');
}

let askKind = '';

function renderAsk(states) {
  $('ask-chips').innerHTML = PURCHASE_TYPES.map((t) => `<button type="button" data-kind="${t.kind}"${t.kind === askKind ? ' class="on"' : ''}>${esc(t.label)}</button>`).join('');
  const type = PURCHASE_TYPES.find((t) => t.kind === askKind);
  if (!type) { $('ask-result').innerHTML = ''; return; }
  const amount = Number(String($('ask-amount').value).replace(/[^0-9]/g, '')) || 0;
  const steps = recommend(type.kind, amount, states);
  let html = `<p class="ask-kind">${esc(type.label)}${amount ? ' · ' + won(amount) : ''}</p><ol class="steps">`;
  html += steps.map((s) => `<li><b>${esc(s.name)}${s.use ? ' ' + won(s.use) : ''}</b><small>${esc(s.why)}</small></li>`).join('');
  html += '</ol>';
  if (!amount && steps.length > 1) html += '<p class="muted">위에서부터 한도·실적을 채우는 순서입니다. 금액을 넣으면 나눠서 계산합니다.</p>';
  if (type.note) html += `<p class="muted">${esc(type.note)}</p>`;
  $('ask-result').innerHTML = html;
}

// ---------- 화면 ----------

function bar(ratio, color) {
  return `<div class="bar"><i style="width:${Math.min(100, Math.max(0, ratio * 100)).toFixed(1)}%;background:${color}"></i></div>`;
}

function renderCard(x) {
  const { card } = x;
  if (!x.asset) {
    return `<article class="card off"><h3><span class="dot" style="background:${card.color}"></span>${esc(card.name)}<span class="badge">연결 안 됨</span></h3>
      <p class="hint">가계부에 이 카드의 자산이 없습니다. 추가한 뒤 아래 ‘카드 연결’에서 골라 주세요.</p></article>`;
  }
  const goal = card.tiers[0];
  const done = x.remain === 0;
  const badge = done ? '<span class="badge ok">실적 채움</span>' : `<span class="badge warn">${won(x.remain)} 더</span>`;
  let html = `<article class="card${card.optional ? ' off' : ''}"><h3><span class="dot" style="background:${card.color}"></span>${esc(card.name)}${badge}</h3>`;
  html += `<div class="big"><span class="num">${won(x.spend)}</span><span class="muted">/ ${won(goal)} (다음 달 혜택 조건)</span></div>`;
  html += bar(x.spend / goal, card.color);

  if (card.benefits.length) {
    const status = x.isNew ? '새 카드라 이번 달 혜택 적용' : x.active ? `지난달 실적 ${won(x.before)} → 이번 달 혜택 적용` : `지난달 실적 ${won(x.before)} → 이번 달 혜택 없음`;
    html += `<p class="hint ${x.active ? '' : 'warn'}">${status}</p>`;
  }
  for (const b of x.benefits) {
    if (!b.cap) continue;
    const saved = Math.min(b.used, b.cap) * b.rate;
    html += `<div class="row"><div class="line"><span>${esc(b.label)}</span><span>${won(b.used)} / ${won(b.cap)} · 약 ${won(saved)} 할인</span></div>${bar(b.used / b.cap, b.left ? card.color : 'var(--ok)')}</div>`;
  }
  if (card.earn) html += `<p class="hint ok">이번 달 적립 약 ${won(x.earned).replace('원', 'P')}</p>`;
  if (x.annual) {
    html += `<div class="row"><div class="line"><span>${esc(x.annual.label)}</span><span>${won(x.annual.sum)} / ${won(x.annual.target)}</span></div>${bar(x.annual.sum / x.annual.target, card.color)}</div>`;
  }
  if (x.overflow > 0) {
    const overCard = CARDS.find((c) => c.id === OVERFLOW_CARD);
    html += `<p class="hint warn">혜택 없이 넘치게 쓴 금액 ${won(x.overflow)} — ${esc(overCard.name)}로 썼다면 약 ${won(x.overflow * overCard.earn.base).replace('원', 'P')} 적립</p>`;
  }
  if (done && x.nextTier && card.benefits.length && card.tiers.length > 1) {
    html += `<p class="hint">다음 구간 ${won(x.nextTier)}까지 ${won(x.nextTier - x.spend)}</p>`;
  }
  if (card.note) html += `<p class="hint muted">${esc(card.note)}</p>`;
  return html + '</article>';
}

function renderMapping() {
  const recent = months.slice(-6);
  const assets = [...new Set(txs.filter((t) => recent.includes(t.ym)).map((t) => t.asset))].sort();
  $('mapping').innerHTML = CARDS.map((c) => {
    const opts = ['<option value="">없음</option>'].concat(assets.map((a) => `<option${a === mapping[c.id] ? ' selected' : ''}>${esc(a)}</option>`));
    const real = realSpend[c.id + '|' + prevMonth(current)] || '';
    return `<label><span>${esc(c.name)}</span><select data-card="${c.id}">${opts.join('')}</select></label>
      <label class="real"><span>지난달 실제 실적</span><input data-real="${c.id}" type="text" inputmode="numeric" placeholder="카드 앱 숫자 (선택)" value="${real ? Number(real).toLocaleString('ko-KR') : ''}"></label>`;
  }).join('');
}

function render() {
  const states = CARDS.map((c) => cardState(c, current));
  const [y, m] = current.split('-').map(Number);
  $('month-label').textContent = `${y}년 ${m}월`;
  const today = new Date();
  const isThisMonth = today.getFullYear() === y && today.getMonth() + 1 === m;
  const left = isThisMonth ? new Date(y, m, 0).getDate() - today.getDate() : null;
  $('month-sub').textContent = `가계부 ${lastDate}까지` + (left !== null ? ` · 이번 달 ${left}일 남음` : '');
  $('prev').disabled = months.indexOf(current) <= 0;
  $('next').disabled = months.indexOf(current) >= months.length - 1;

  renderAsk(states);
  $('advice').innerHTML = buildAdvice(states).map(([what, use, why]) =>
    `<li><span class="what">${esc(what)}</span><span class="use"><b>${esc(use)}</b><small>${esc(why)}</small></span></li>`).join('');
  $('cards').innerHTML = states.filter((x) => !x.card.optional || x.total > 0).map(renderCard).join('');
  renderMapping();
}

function show(which, message) {
  $('empty').hidden = which !== 'empty';
  $('content').hidden = which !== 'content';
  $('error').hidden = !message;
  $('error').textContent = message || '';
}

function loadMapping() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('cardmap') || '{}'); } catch (e) { /* 저장값 없이 진행 */ }
  const recent = months.slice(-6);
  const assets = [...new Set(txs.filter((t) => recent.includes(t.ym)).map((t) => t.asset))];
  mapping = {};
  for (const c of CARDS) {
    mapping[c.id] = c.id in saved && (saved[c.id] === '' || assets.includes(saved[c.id])) ? saved[c.id] : (assets.find((a) => c.match.test(a)) || '');
  }
}

function useLedger(buf) {
  txs = parseLedger(buf);
  months = [...new Set(txs.map((t) => t.ym))].sort();
  current = months[months.length - 1];
  const last = txs.filter((t) => t.ym === current).reduce((d, t) => Math.max(d, t.day), 0);
  lastDate = `${+current.slice(5)}월 ${last}일`;
  loadMapping();
  show('content');
  render();
}

async function saveLedger(buf) {
  try { await (await caches.open(DATA_CACHE)).put(DATA_KEY, new Response(buf)); } catch (e) { /* 저장 못 해도 화면은 보여준다 */ }
}

async function loadSaved() {
  try {
    const res = await (await caches.open(DATA_CACHE)).match(DATA_KEY);
    return res ? await res.arrayBuffer() : null;
  } catch (e) { return null; }
}

// ---------- 시작 ----------

$('file').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const buf = await f.arrayBuffer();
    useLedger(buf);
    saveLedger(buf);
  } catch (err) { show(txs.length ? 'content' : 'empty', err.message); }
  e.target.value = '';
});
$('prev').addEventListener('click', () => { current = months[months.indexOf(current) - 1]; render(); });
$('next').addEventListener('click', () => { current = months[months.indexOf(current) + 1]; render(); });
function ask(kind) { askKind = kind; renderAsk(CARDS.map((c) => cardState(c, current))); }
$('ask-text').addEventListener('input', (e) => { const t = findType(e.target.value); ask(t ? t.kind : ''); });
$('ask-amount').addEventListener('input', () => ask(askKind));
$('ask-chips').addEventListener('click', (e) => { const k = e.target.dataset.kind; if (k) { $('ask-text').value = ''; ask(k); } });
$('mapping').addEventListener('change', (e) => {
  const realId = e.target.dataset.real;
  if (realId) {
    const key = realId + '|' + prevMonth(current);
    const v = Number(e.target.value.replace(/[^0-9]/g, ''));
    if (v > 0) realSpend[key] = v; else delete realSpend[key];
    try { localStorage.setItem('realspend', JSON.stringify(realSpend)); } catch (err) { /* 이번 화면에만 반영 */ }
    render();
    return;
  }
  const id = e.target.dataset.card;
  if (!id) return;
  mapping[id] = e.target.value;
  try { localStorage.setItem('cardmap', JSON.stringify(mapping)); } catch (err) { /* 이번 화면에만 반영 */ }
  render();
});

const APP_VERSION = 'v9';

(async function start() {
  $('ver').textContent = APP_VERSION;
  const got = new URLSearchParams(location.search).get('got');
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  const shared = new URLSearchParams(location.search).get('shared');
  if (shared) history.replaceState(null, '', './');
  const buf = await loadSaved();
  if (!buf) return show('empty', shared === '0' ? '공유받은 파일을 읽지 못했습니다. ‘가계부 열기’로 다시 시도해 주세요.' : '');
  try { useLedger(buf); } catch (err) { show('empty', err.message + (got ? ` (받은 파일: ${got})` : '')); }
})();
