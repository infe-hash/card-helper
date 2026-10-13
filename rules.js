// 카드 조건이 바뀌면 이 파일만 고치면 된다. 금액 단위는 원.

// 결제 한 건을 종류로 나눈다. 위에서부터 먼저 맞는 것으로 정해진다.
// t.cat=분류, t.sub=소분류, t.text=내용+메모
const CATEGORY_RULES = [
  ['fee', (t) => t.sub === '카드 연회비'],
  ['fuel', (t) => t.sub === '주유비' || /오일뱅|칼텍스|SK에너지|S-?OIL|주유소/i.test(t.text)],
  ['toll', (t) => t.sub === '톨비' || /통행료|하이패스/.test(t.text)],
  ['tax', (t) => t.cat === '세금' || t.cat === '금융' || t.sub === '세금' || /국민연금|건강보험|지로|공과금|지자체세|국세청/.test(t.text)],
  ['gas', (t) => t.sub === '가스요금' || /도시가스|에너지서비스/.test(t.text)],
  ['mgmt', (t) => t.sub === '관리비'],
  ['transit', (t) => ['택시', '지하철', '버스'].includes(t.sub)],
  ['telecom', (t) => /LGUPLUS|유플러스|통신요금/i.test(t.text)],
  ['streaming', (t) => /넷플릭스|NETFLIX|티빙|웨이브|왓챠|멜론|FLO|유튜브|YOUTUBE|디즈니/i.test(t.text)],
  ['delivery', (t) => /쿠팡이츠|우아한형제들|배달의민족|배민|요기요/.test(t.text)],
  ['coupang', (t) => /쿠팡/.test(t.text)],
  ['easypay', (t) => /네이버페이|네이버파이낸|카카오페이|비바리퍼블리|토스페이|PAYCO|페이코|SSGPAY/i.test(t.text)],
  ['airline', (t) => /항공|에어부산|진에어|티웨이|에어서울/.test(t.text)],
  ['overseas', (t) => /ANTHROPIC|OPENAI|USD|해외승인/i.test(t.text)],
  ['general', () => true],
];

const CATEGORY_LABEL = {
  fee: '연회비', fuel: '주유', toll: '통행료', tax: '세금·공과금', gas: '도시가스', mgmt: '관리비',
  transit: '택시·대중교통', telecom: '통신요금', streaming: '구독', delivery: '배달앱', coupang: '쿠팡',
  easypay: '간편결제', airline: '항공권', overseas: '해외 결제', general: '그 외',
};

// tiers: 지난달 실적 구간. excluded: 실적으로 안 쳐주는 종류.
// benefits: 이번 달 혜택 한도. capSpend = 할인이 끝나는 결제 금액(구간 번호별).
const CARDS = [
  {
    id: 'taptap',
    name: '삼성 taptap DIGITAL',
    match: /탭탭|taptap/i,
    color: '#2f6fed',
    tiers: [300000],
    excluded: ['fee', 'tax', 'gas', 'mgmt', 'transit'],
    benefits: [
      { id: 'easypay', label: '간편결제 5%', cats: ['delivery', 'coupang', 'easypay'], rate: 0.05, capSpend: [400000] },
      { id: 'streaming', label: '구독 50%', cats: ['streaming'], rate: 0.5, capSpend: [20000] },
    ],
    note: '가계부에 할인 후 금액을 적고 있어 실제 결제액은 조금 더 큽니다.',
  },
  {
    id: 'deepoil',
    name: '신한 Deep Oil',
    match: /deep\s?oil|딥오일/i,
    color: '#0c8f6a',
    tiers: [300000, 700000],
    excluded: ['fee', 'tax', 'fuel'],
    benefits: [
      { id: 'fuel', label: '주유 10%', cats: ['fuel'], rate: 0.1, capSpend: [150000, 300000] },
    ],
    note: '주유는 실적에서 빠집니다. 지난달 70만 원 이상이면 주유 한도가 2배입니다.',
  },
  {
    id: 'kb',
    name: 'KB YOU Prime',
    match: /you\s?prime/i,
    color: '#c98a00',
    tiers: [400000, 800000, 1600000],
    excluded: ['fee', 'tax', 'gas', 'mgmt', 'telecom'],
    benefits: [
      { id: 'telecom', label: '통신 10%', cats: ['telecom'], rate: 0.1, capSpend: [50000, 70000, 100000] },
      { id: 'delivery', label: '배달 10% (KB Pay)', cats: ['delivery'], rate: 0.1, capSpend: [50000, 70000, 100000] },
      { id: 'fuel', label: '주유 10%', cats: ['fuel'], rate: 0.1, capSpend: [50000, 70000, 100000] },
    ],
    note: '할인받은 결제(통신요금)는 실적에서 빠집니다. 배달 할인은 KB Pay로 결제해야 합니다.',
  },
  {
    id: 'id',
    name: '삼성 THE iD. PLATINUM',
    match: /the\s?id|아이디|platinum|플래티넘|플래티늄/i,
    color: '#5b4bc4',
    tiers: [500000],
    excluded: ['fee', 'tax', 'gas', 'mgmt', 'transit'],
    benefits: [],
    // 포인트 적립률. 여기 없는 종류는 base.
    earn: { base: 0.01, delivery: 0.012, coupang: 0.012, airline: 0.015, overseas: 0.015, toll: 0, tax: 0, fee: 0, gas: 0, mgmt: 0, transit: 0 },
    annual: { start: '2026-10-01', target: 6000000, label: '2년 차 기프트 조건' },
    note: '월 50만 원은 공항 라운지 조건입니다. 적립은 실적과 상관없이 됩니다.',
  },
  {
    id: 'mrlife',
    name: '신한 Mr.Life',
    match: /mr\.?\s?life|미스터라이프/i,
    color: '#8a8f98',
    tiers: [300000, 500000, 1000000],
    excluded: ['fee', 'tax'],
    benefits: [],
    optional: true,
    note: '해지 검토 중인 카드입니다.',
  },
];

// 실적을 다 채운 뒤 남는 결제를 보낼 카드
const OVERFLOW_CARD = 'id';
