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
  ['taxi', (t) => t.sub === '택시' || /택시|카카오T|우버|UBER/i.test(t.text)],
  ['transit', (t) => ['지하철', '버스'].includes(t.sub)],
  ['gift', (t) => /선물하기/.test(t.text)],
  ['telecom', (t) => /LGUPLUS|유플러스|통신요금/i.test(t.text)],
  ['streaming', (t) => /넷플릭스|NETFLIX|티빙|웨이브|왓챠|멜론|FLO|유튜브|YOUTUBE|디즈니/i.test(t.text)],
  ['membership', (t) => /배민클럽|클럽_우아한/.test(t.text)],
  ['delivery', (t) => /쿠팡이츠|우아한형제들|배달의민족|배민|요기요/.test(t.text)],
  ['coupang', (t) => /쿠팡/.test(t.text)],
  ['easypay', (t) => /네이버페이|네이버파이낸|카카오페이|비바리퍼블리|토스페이|PAYCO|페이코|SSGPAY/i.test(t.text)],
  ['airline', (t) => /항공|에어부산|진에어|티웨이|에어서울/.test(t.text)],
  ['overseas', (t) => /ANTHROPIC|OPENAI|USD|해외승인/i.test(t.text)],
  ['insurance', (t) => t.sub === '보험' || /보험/.test(t.text)],
  ['cvs', (t) => /씨유|CU\(|\bCU\b|지에스25|GS25|GS대치|세븐일레븐|이마트24/i.test(t.text)],
  ['daily', (t) => /다이소|올리브영/.test(t.text)],
  ['selfcare', (t) => (t.cat === '미용' && t.sub === '미용비') || /헤어|미용실|이발|스포애니|헬스|필라테스|요가/.test(t.text)],
  ['general', () => true],
];

const CATEGORY_LABEL = {
  fee: '연회비', fuel: '주유', toll: '통행료', tax: '세금·공과금', gas: '도시가스', mgmt: '관리비',
  taxi: '택시', transit: '대중교통', membership: '배민클럽', gift: '카카오 선물하기', telecom: '통신요금', streaming: '구독', delivery: '배달앱', coupang: '쿠팡',
  easypay: '간편결제', airline: '항공권', overseas: '해외 결제', insurance: '보험', cvs: '편의점', daily: '다이소·올리브영', selfcare: '미용·운동', general: '그 외',
};

// tiers: 지난달 실적 구간. excluded: 실적으로 안 쳐주는 종류.
// benefits: 이번 달 혜택 한도. capSpend = 할인이 끝나는 결제 금액(구간 번호별).
const CARDS = [
  {
    id: 'taptap',
    name: '삼성 taptap DIGITAL',
    match: /탭탭|taptap/i,
    color: '#2f6fed',
    // 2026-10 삼성카드 앱 화면으로 확인: 구간 30/60/90만, 1구간 한도는 간편결제 1만·구독 5천·편의점 5천.
    // 간편결제 한도 1만/1.5만/2만, 구독 한도 5천/7천/1만 모두 앱 화면으로 확인.
    tiers: [300000, 600000, 900000],
    // 실적제외 내역으로 확인: 택시, 카카오 선물하기, 그리고 할인받은 결제(간편결제·편의점·구독)가 빠진다.
    excluded: ['fee', 'tax', 'gas', 'mgmt', 'transit', 'taxi', 'gift'],
    // 할인 한도가 남아 있는 동안의 결제는 건 전체가 실적에서 빠진다
    discountExcluded: ['easypay', 'cvs', 'streaming'],
    benefits: [
      { id: 'easypay', label: '간편결제 5%', cats: ['delivery', 'coupang', 'easypay'], rate: 0.05, capSpend: [200000, 300000, 400000] },
      { id: 'streaming', label: '구독 50%', cats: ['streaming'], rate: 0.5, capSpend: [10000, 14000, 20000] },
      { id: 'cvs', label: '편의점·다이소·올리브영 10%', cats: ['cvs', 'daily'], rate: 0.1, capSpend: [50000] },
    ],
    note: '할인받은 결제는 실적에서 빠져서, 실적은 할인 없는 결제로 채워야 합니다. 가계부에 할인 후 금액을 적고 있어 실제와 조금 다를 수 있습니다.',
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
      { id: 'life', label: '택시·편의점 5%', cats: ['taxi', 'cvs'], rate: 0.05, capSpend: [150000, 300000] },
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
    // 2026-10 KB 앱 실적 내역으로 확인: 할인받은 결제(KB Pay 배달 등)는 실적에서 빠진다. 배민클럽 이용권은 할인 없이 실적 인정.
    discountExcluded: ['delivery', 'fuel', 'selfcare', 'cvs'],
    benefits: [
      { id: 'telecom', label: '통신·보험 10%', cats: ['telecom', 'insurance'], rate: 0.1, capSpend: [50000, 70000, 100000] },
      { id: 'delivery', label: '배달 10% (KB Pay)', cats: ['delivery'], rate: 0.1, capSpend: [50000, 70000, 100000] },
      { id: 'fuel', label: '주유 10%', cats: ['fuel'], rate: 0.1, capSpend: [50000, 70000, 100000] },
      { id: 'selfcare', label: '미용·운동 5%', cats: ['selfcare'], rate: 0.05, capSpend: [100000, 140000, 200000] },
      { id: 'cvs', label: '편의점 5%', cats: ['cvs'], rate: 0.05, capSpend: [100000, 140000, 200000] },
      { id: 'shop', label: '쿠팡 5% (KB Pay)', cats: ['coupang'], rate: 0.05, capSpend: [100000, 140000, 200000] },
    ],
    note: '할인받은 결제(통신요금)는 실적에서 빠집니다. 배달 할인은 KB Pay로 결제해야 합니다.',
  },
  {
    id: 'id',
    name: '삼성 THE iD. PLATINUM',
    match: /the\s?id|아이디|platinum|플래티넘|플래티늄/i,
    color: '#5b4bc4',
    tiers: [500000],
    excluded: ['fee', 'tax', 'gas', 'mgmt', 'transit', 'taxi', 'gift'],
    benefits: [
      { id: 'streaming', label: '구독 50%', cats: ['streaming'], rate: 0.5, capSpend: [20000] },
    ],
    // 포인트 적립률. 여기 없는 종류는 base.
    earn: { base: 0.01, delivery: 0.012, coupang: 0.012, airline: 0.015, overseas: 0.015, toll: 0, tax: 0, fee: 0, gas: 0, mgmt: 0, transit: 0, taxi: 0 },
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

// '무엇을 결제하나요?' 검색어. words 중 하나가 들어 있으면 그 종류로 본다.
// fixed 가 있으면 계산 없이 그대로 안내한다.
const PURCHASE_TYPES = [
  { kind: 'selfcare', label: '미용실·운동', words: ['머리', '미용', '헤어', '커트', '컷', '펌', '염색', '이발', '헬스', '운동', '필라테스', '골프'], note: '매장에서 카드로 직접 결제해야 할인됩니다. 네이버 예약 결제는 할인에서 빠질 수 있습니다.' },
  { kind: 'delivery', label: '배달', words: ['배달', '쿠팡이츠', '배민', '치킨', '피자'], note: 'KB 배달 할인은 KB Pay로 결제해야 합니다.' },
  { kind: 'coupang', label: '쿠팡', words: ['쿠팡', '로켓'], note: 'KB 쿠팡 할인은 KB Pay로 결제해야 합니다.' },
  { kind: 'easypay', label: '네이버페이·온라인', words: ['네이버페이', '네이버', '온라인', '스마트스토어', '카카오페이', '인터넷'], note: '온라인에서 네이버페이·카카오페이 등으로 결제할 때입니다.' },
  { kind: 'taxi', label: '택시', words: ['택시', '카카오t', '우버', 'uber'], note: '삼성카드 두 장은 택시가 실적에도 적립에도 안 잡힙니다. 우버는 택시 업종으로 안 잡혀 할인이 빠질 수 있습니다.' },
  { kind: 'fuel', label: '주유', words: ['주유', '기름', '오일뱅크'] },
  { kind: 'toll', label: '통행료', words: ['통행료', '톨비', '하이패스', '톨게이트'] },
  { kind: 'cvs', label: '편의점', words: ['편의점', 'cu', 'gs25', '씨유', '세븐일레븐'] },
  { kind: 'daily', label: '다이소·올리브영', words: ['다이소', '올리브영', '생활용품'] },
  { kind: 'membership', label: '배민클럽·유튜브 묶음', words: ['배민클럽', '유튜브프리미엄', '유튜브'], note: '배민에서 묶어 결제하면 유튜브가 아니라 배민 결제로 잡혀서 구독 50% 할인과 KB 배달 할인이 모두 안 됩니다.' },
  { kind: 'streaming', label: '구독', words: ['넷플릭스', '구독', '멜론', '티빙', '디즈니'] },
  { kind: 'insurance', label: '보험', words: ['보험'], note: '보험사에 카드로 직접 낼 때만 할인됩니다. 네이버페이로 내면 빠질 수 있습니다.' },
  { kind: 'telecom', label: '통신요금', words: ['통신', '휴대폰요금', '핸드폰요금', '폰요금'] },
  { kind: 'airline', label: '항공권', words: ['항공', '비행기'], note: '항공사 공식 홈페이지·앱에서 결제해야 1.5%가 적립됩니다.' },
  { kind: 'japan', label: '일본 현지', words: ['일본', '해외', '엔화', '현지'], fixed: ['네이버 머니카드', '해외 수수료가 없음'] },
  { kind: 'general', label: '옷·병원·식당·그 외', words: ['옷', '병원', '약국', '식당', '밥', '카페', '커피', '선물', '그외', '기타'] },
];
