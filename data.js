// ═══════════════════════════════════════════════════════════════════════
// Phase 1.2 데이터 모델 (조회 전용 축소판)
// Phase 1.5 프로토타입을 fork 해, 방문상태 기록·통계 대시보드·레드존 등
// "저장이 필요한" 기능을 걷어내고 조회/필터 UX 개선만 남긴 버전.
//
// Phase 1.5 대비 변경점
//  - 방문상태(visitStatus)·담당사원·방문날짜·메모·고객코드·레드존 필드 제거
//  - 지사 필터를 3단계(조직축 세스코/CLC → 사업부·총국 → 지사·지국)로 확장
//    · 세스코 축: DIVISION_LIST(사업부→지사)  — Phase 1.5 것 그대로
//    · CLC 축:   CLC_BUREAU_LIST(총국→지국)  — 신규 mock (데이터팀 확인 전 임시)
//  - 업종 태그(tags[1])를 표준산업분류(KSIC)명 → 마케팅 신업종명으로 교체
//  - 개업기간 필터: 개업 1년(365일) 초과 매장은 "전체"에서도 상시 제외
// ═══════════════════════════════════════════════════════════════════════

// ─── 로그인 사용자 (Mock) ─────────────────────────────────────────────
// phase1 QA FAQ 확정사항: "로그인 사용자의 소속 지사 조회 → 그 지사가
// 담당하는 법정동 기준 default 조회". 실제 로그인 연동 전까지는
// 아래 객체를 대체값으로 사용해 초기 진입 시 지사 필터 자동 선택에 활용한다.
// orgAxis: 로그인 사용자가 어느 조직축(세스코/CLC) 소속인지 — 3단계 지사 필터의 최상위.
const CURRENT_USER = {
  name: '김정용',
  orgAxis: '세스코',
  division: '수도권동부사업부',
  branch: '서울동부지사'
};

// ─── 조직축 (지사 필터 1단계) ─────────────────────────────────────────
// 이 툴을 세스코(사업부 조직)와 CLC(총국/지국 조직) 두 축이 함께 쓰기 때문에
// 상위에서 조직축을 먼저 고른 뒤, 그 축의 계층(사업부→지사 / 총국→지국)을 선택한다.
const ORG_AXIS_LIST = ['세스코', 'CLC'];

// ─── [세스코] 사업부 → 지사 계층 (Phase 1.5 그대로) ───────────────────
// 전사 기준 지사 수가 약 30개 이상(부산경남사업부 한 곳의 약 6배)이라, 지사를
// 가로 칩으로 한 줄에 나열하지 않고 "사업부 먼저 선택 → 그 사업부 소속 지사만
// 보기" 2단계 드롭다운으로 구성한다.
const DIVISION_LIST = [
  { name: '수도권동부사업부', branches: ['서울동부지사', '성남지사', '하남지사', '남양주지사', '강동지사'] },
  { name: '수도권서부사업부', branches: ['인천지사', '부천지사', '김포지사', '서울서부지사', '안양지사'] },
  { name: '경기사업부',       branches: ['경기남부지사', '경기북부지사', '수원지사', '용인지사', '평택지사'] },
  { name: '대구경북사업부',   branches: ['대구지사', '경북지사', '구미지사', '포항지사', '안동지사'] },
  { name: '부산경남사업부',   branches: ['부산지사', '해운대지사', '부산동래지사', '부산수영지사', '경남지사'] },
  { name: '광주전남사업부',   branches: ['광주지사', '전남지사', '목포지사', '순천지사', '여수지사'] }
];

// ─── [CLC] 총국 → 지국 계층 (신규 mock — 데이터팀 확인 전 임시값) ─────
// ⚠️ CLC 총국/지국 실제 조직 목록·담당구역 매핑 데이터는 아직 확보 전.
//    아래는 화면 흐름 검증용 임시 데이터이며 실개발 시 데이터팀 확정본으로 교체해야 함.
const CLC_BUREAU_LIST = [
  { name: '수도권총국', branches: ['서울중앙지국', '서울북부지국', '서울남부지국', '인천지국', '경기지국'] },
  { name: '중부총국',   branches: ['대전지국', '충남지국', '충북지국', '강원지국', '세종지국'] },
  { name: '영남총국',   branches: ['부산지국', '대구지국', '울산지국', '경남지국', '경북지국'] },
  { name: '호남총국',   branches: ['광주지국', '전남지국', '전북지국', '제주지국', '순천지국'] }
];

// 조직축 → 계층 트리 / 역매핑 (트리거 라벨 표시 등에 사용)
const ORG_TREE = { '세스코': DIVISION_LIST, 'CLC': CLC_BUREAU_LIST };
const BRANCH_TO_PARENT = { '세스코': {}, 'CLC': {} };
DIVISION_LIST.forEach(d => d.branches.forEach(b => { BRANCH_TO_PARENT['세스코'][b] = d.name; }));
CLC_BUREAU_LIST.forEach(d => d.branches.forEach(b => { BRANCH_TO_PARENT['CLC'][b] = d.name; }));

// ─── 법정동 트리 (지역선택 3단계 — 시/도 → 구·군 → 읍·면·동) ─────────
// ⚠️ 프로토타입 fixture. 실서비스는 배포된 `POST /local-area/bjd-code`로 각 단계를 로드하고
//    선택된 법정동 코드 배열을 `SCH_ADDRS`로 전달한다.
const BJD_TREE = {
  '서울특별시': {
    '종로구':   ['누상동', '청운동', '효자동'],
    '중랑구':   ['묵동', '상봉동', '면목동'],
    '동대문구': ['휘경동', '전농동', '이문동'],
    '용산구':   ['이태원동', '한남동', '청파동'],
    '금천구':   ['독산동', '시흥동', '가산동']
  },
  '경기도': {
    '수원시': ['세류동', '권선동', '인계동'],
    '구리시': ['수택동', '인창동', '교문동'],
    '이천시': ['부발읍', '증포동', '창전동']
  },
  '대구광역시': {
    '동구':   ['방촌동', '신암동', '효목동'],
    '달서구': ['감삼동', '두류동', '성당동'],
    '북구':   ['산격동', '복현동', '침산동']
  },
  '부산광역시': { '금정구': ['남산동', '장전동', '구서동'] },
  '광주광역시': { '광산구': ['월곡동', '우산동', '신가동'] },
  '전라남도':   { '여수시': ['죽포리', '학동', '여서동'] }
};
// 주소 문자열은 축약형("서울", "경기", "전남")을 쓰므로 시/도만 선택했을 때의 매칭용 축약 맵
const SIDO_SHORT = {
  '서울특별시': '서울', '경기도': '경기', '대구광역시': '대구',
  '부산광역시': '부산', '광주광역시': '광주', '전라남도': '전남'
};

// ─── 업종 목록 (업종 빠른탭 — KSIC 정합 재설계 9종, 2026-09-18 v0.2) ──
// 구 10종(일반음식점/휴게음식점/숙박/의원/식품제조/제과점/축산가공/식육포장처리/기타소매/기타서비스)은
// 식품위생법 등 세스코 자체 분류라 KSIC 경계와 어긋나는 지점이 있어(일반/휴게음식점↔KSIC I561/I562,
// 축산가공↔식육포장처리 구분 불가) KSIC로 완전히 갈리는 카테고리로 재정리했다.
// 각 탭의 KSIC 매핑은 `기획/업종매핑표_초안_v0.1.md`(v0.2) 참조.
const INDUSTRY_TAB_LIST = [
  '음식점',      // KSIC I561 (한식/외국식/간이음식점 등, 구 일반음식점+휴게음식점 중 식사류)
  '카페·음료',   // KSIC I5622 (커피전문점 등, 구 휴게음식점 중 음료류 분리 신설)
  '숙박',        // KSIC I55
  '의료기관',    // KSIC Q86 (구 '의원'에서 병원까지 범위 확장)
  '식품제조',    // KSIC C10
  '제과점',      // KSIC I56191
  '축산물가공',  // KSIC C1012 (구 축산가공+식육포장처리 통합)
  '소매업',      // KSIC G47 (구 기타소매)
  '기타서비스'   // KSIC S96 등
];

// ─── 개업기간 필터 (Phase 1.5 것과 동일 — 4구간 단일선택) ────────────
// "전체"를 골라도 개업 1년(365일) 초과 매장은 상시 제외됨(filterCustomers 참고).
const PERIOD_LIST = [
  { key: 'all', label: '전체' },
  { key: 'd30', label: '1~30일 이내 오픈' },
  { key: 'd60', label: '31~60일 이내 오픈' },
  { key: 'd90', label: '61~90일 이내 오픈' },
  { key: 'd365', label: '90일~1년 이내 오픈' }
];

// tags[1] = 마케팅 신업종명 (Phase 1.5 원본은 표준산업분류(KSIC)명이었음)
const ALL_CUSTOMERS = [
  {
    id: 1,
    companyName: '이안컴퓨터',
    distance: '0.5km',
    address: '서울 종로구 누상동 27-101번지',
    ceo: '최교일 대표',
    birthYear: '1973년 출생',
    area: '12 평',
    tags: ['컴퓨터/주변기기', '컴퓨터/사무기기 소매'],
    phone: '02-720-2587',
    fax: '-',
    revenue: '-',
    deposit: '약 1천만원',
    monthlyRent: '35만원',
    employees: '2 명',
    homepage: '-',
    email: 'iancomp@naver.com',
    lat: 37.581534,
    lng: 126.967838,
    branch: '서울동부지사',
    clcBranch: '서울중앙지국',
    industryTab: '소매업',
    openDate: '2026-08-19'
  },
  {
    id: 2,
    companyName: '소담',
    distance: '1.3km',
    address: '서울 중랑구 동일로157길 8 (묵동)',
    ceo: '문보향 대표',
    birthYear: '1960년 출생',
    area: '18 평',
    tags: ['떡/한과전문점', '제과/제빵'],
    phone: '02-948-8533',
    fax: '-',
    revenue: '-',
    deposit: '약 5백만원',
    monthlyRent: '25만원',
    employees: '1 명',
    homepage: '-',
    email: '-',
    lat: 37.61001,
    lng: 127.07731,
    branch: '서울동부지사',
    clcBranch: '서울북부지국',
    industryTab: '제과점',
    openDate: '2026-08-15'
  },
  {
    id: 3,
    companyName: '아모레카운셀러',
    distance: '2.1km',
    address: '서울 동대문구 휘경동 71-1번지 8층',
    ceo: '윤정희 대표',
    birthYear: '1960년 출생',
    area: '8 평',
    tags: ['방문판매업', '생활용품/잡화 소매'],
    phone: '02-2247-9647',
    fax: '-',
    revenue: '-',
    deposit: '약 3백만원',
    monthlyRent: '20만원 이하',
    employees: '0 명',
    homepage: 'www.amorepacific.com',
    email: 'yoon.jh@amorepacific.com',
    lat: 37.59178,
    lng: 127.06655,
    branch: '서울동부지사',
    clcBranch: '서울북부지국',
    industryTab: '소매업',
    openDate: '2026-08-10'
  },
  {
    id: 4,
    companyName: '신성물물교환',
    distance: '3.4km',
    address: '서울 용산구 이태원동 96-94번지',
    ceo: '정완영 대표',
    birthYear: '1946년 출생',
    area: '22 평',
    tags: ['일반가구', '가구/인테리어 소매'],
    phone: '02-795-4875',
    fax: '-',
    revenue: '-',
    deposit: '약 2천만원',
    monthlyRent: '80만원',
    employees: '3 명',
    homepage: '-',
    email: 'sinsung@daum.net',
    lat: 37.53163,
    lng: 126.99482,
    branch: '서울동부지사',
    clcBranch: '서울중앙지국',
    industryTab: '소매업',
    openDate: '2026-08-05'
  },
  {
    id: 5,
    companyName: '백양세탁소',
    distance: '4.2km',
    address: '서울 금천구 독산동 1009-5번지',
    ceo: '강호순 대표',
    birthYear: '1967년 출생',
    area: '10 평',
    tags: ['세탁소/빨래방', '세탁/생활편의 서비스'],
    phone: '02-891-3699',
    fax: '-',
    revenue: '-',
    deposit: '약 1천만원',
    monthlyRent: '30만원 이하',
    employees: '1 명',
    homepage: '-',
    email: '-',
    lat: 37.46452,
    lng: 126.89558,
    branch: '서울동부지사',
    clcBranch: '서울남부지국',
    industryTab: '기타서비스',
    openDate: '2026-07-28'
  },
  {
    id: 6,
    companyName: '경기알뜰매장',
    distance: '1.8km',
    address: '경기 수원시 권선구 정조로 364 (세류동)',
    ceo: '김재서 대표',
    birthYear: '1955년 출생',
    area: '30 평',
    tags: ['재활용품', '중고품 소매'],
    phone: '031-225-8948',
    fax: '-',
    revenue: '-',
    deposit: '약 3천만원',
    monthlyRent: '120만원',
    employees: '4 명',
    homepage: '-',
    email: 'ggbargain@naver.com',
    lat: 37.24215,
    lng: 127.01554,
    branch: '경기남부지사',
    clcBranch: '경기지국',
    industryTab: '소매업',
    openDate: '2026-08-14'
  },
  {
    id: 7,
    companyName: '은하철물',
    distance: '2.3km',
    address: '경기 구리시 수택동 489-5번지',
    ceo: '홍미리 대표',
    birthYear: '1961년 출생',
    area: '15 평',
    tags: ['열쇠/철물점', '철물/공구 소매'],
    phone: '031-551-2159',
    fax: '-',
    revenue: '-',
    deposit: '약 1천5백만원',
    monthlyRent: '45만원',
    employees: '2 명',
    homepage: '-',
    email: '-',
    lat: 37.59499,
    lng: 127.14701,
    branch: '경기북부지사',
    clcBranch: '경기지국',
    industryTab: '소매업',
    openDate: '2026-08-12'
  },
  {
    id: 8,
    companyName: '줌미술학원',
    distance: '3.1km',
    address: '인천 미추홀구 주안동 466-1번지 2,3층',
    ceo: '윤종식 대표',
    birthYear: '1962년 출생',
    area: '45 평',
    tags: ['서예/미술학원', '교육/학원 서비스'],
    phone: '032-432-9763',
    fax: '-',
    revenue: '-',
    deposit: '약 5천만원',
    monthlyRent: '200만원',
    employees: '5 명',
    homepage: 'www.zoomart.co.kr',
    email: 'zoom.art@gmail.com',
    lat: 37.45824,
    lng: 126.6804,
    branch: '인천지사',
    clcBranch: '인천지국',
    industryTab: '기타서비스',
    openDate: '2026-08-10'
  },
  {
    id: 9,
    companyName: '애플피아노학원',
    distance: '4.0km',
    address: '경기 이천시 부발읍 신하리 369-18번지 3층',
    ceo: '권현미 대표',
    birthYear: '1978년 출생',
    area: '50 평',
    tags: ['피아노/음악학원', '교육/학원 서비스'],
    phone: '031-637-1253',
    fax: '-',
    revenue: '-',
    deposit: '약 4천만원',
    monthlyRent: '150만원',
    employees: '3 명',
    homepage: '-',
    email: 'apple.piano@naver.com',
    lat: 37.26028,
    lng: 127.47987,
    branch: '경기남부지사',
    clcBranch: '경기지국',
    industryTab: '기타서비스',
    openDate: '2026-08-08'
  },
  {
    id: 10,
    companyName: '크린토피아',
    distance: '5.2km',
    address: '대구 동구 방촌동 1120-57번지',
    ceo: '이경록 대표',
    birthYear: '1977년 출생',
    area: '20 평',
    tags: ['세탁소/빨래방', '세탁/생활편의 서비스'],
    phone: '053-986-9252',
    fax: '-',
    revenue: '-',
    deposit: '약 2천만원',
    monthlyRent: '70만원',
    employees: '2 명',
    homepage: 'www.cleantopia.com',
    email: '-',
    lat: 35.87493,
    lng: 128.66788,
    branch: '대구지사',
    clcBranch: '대구지국',
    industryTab: '기타서비스',
    openDate: '2026-08-07'
  },
  {
    id: 11,
    companyName: '채승헤어커커',
    distance: '1.1km',
    address: '부산 금정구 금강로633번길 11 (남산동)',
    ceo: '양영희 대표',
    birthYear: '1976년 출생',
    area: '14 평',
    tags: ['미용실', '이·미용 서비스'],
    phone: '070-4120-4687',
    fax: '-',
    revenue: '-',
    deposit: '약 1천만원',
    monthlyRent: '40만원',
    employees: '2 명',
    homepage: '-',
    email: 'chaeseung.hair@naver.com',
    lat: 35.264,
    lng: 129.08772,
    branch: '부산지사',
    clcBranch: '부산지국',
    industryTab: '기타서비스',
    openDate: '2026-07-10'
  },
  {
    id: 12,
    companyName: '풍년생오리촌',
    distance: '2.6km',
    address: '대구 달서구 감삼동 174-1번지 1층',
    ceo: '이관순 대표',
    birthYear: '1965년 출생',
    area: '35 평',
    tags: ['오리고기전문점', '한식'],
    phone: '053-526-5001',
    fax: '053-526-5002',
    revenue: '-',
    deposit: '약 5천만원',
    monthlyRent: '180만원',
    employees: '6 명',
    homepage: '-',
    email: 'pungnyeon@daum.net',
    lat: 35.84736,
    lng: 128.53849,
    branch: '대구지사',
    clcBranch: '대구지국',
    industryTab: '음식점',
    openDate: '2026-06-25'
  },
  {
    id: 13,
    companyName: '베이커리하우스 밀',
    distance: '3.5km',
    address: '광주 광산구 월곡동 55-13번지',
    ceo: '강원길 대표',
    birthYear: '1968년 출생',
    area: '28 평',
    tags: ['제과점/베이커리', '제과/제빵'],
    phone: '062-954-7697',
    fax: '-',
    revenue: '-',
    deposit: '약 3천만원',
    monthlyRent: '100만원',
    employees: '4 명',
    homepage: '-',
    email: 'mill.bakery.gj@gmail.com',
    lat: 35.1685,
    lng: 126.80935,
    branch: '광주지사',
    clcBranch: '광주지국',
    industryTab: '제과점',
    openDate: '2026-06-10'
  },
  {
    id: 14,
    companyName: '초가삼간',
    distance: '4.3km',
    address: '대구 북구 연암로 126 (산격동)',
    ceo: '김숙자 대표',
    birthYear: '1956년 출생',
    area: '40 평',
    tags: ['일반한식/백반', '한식'],
    phone: '053-952-4388',
    fax: '-',
    revenue: '-',
    deposit: '약 4천만원',
    monthlyRent: '160만원',
    employees: '5 명',
    homepage: '-',
    email: '-',
    lat: 35.89575,
    lng: 128.59506,
    branch: '대구지사',
    clcBranch: '대구지국',
    industryTab: '음식점',
    openDate: '2026-05-28'
  },
  {
    id: 15,
    companyName: '베베올레키즈가족펜션',
    distance: '5.8km',
    address: '전남 여수시 돌산읍 방죽포길 93 (죽포리)',
    ceo: '강인규 대표',
    birthYear: '1954년 출생',
    area: '120 평',
    tags: ['펜션', '숙박 서비스'],
    phone: '061-663-7640',
    fax: '-',
    revenue: '-',
    deposit: '약 1억원',
    monthlyRent: '350만원',
    employees: '3 명',
    homepage: 'www.bebolle.com',
    email: 'bebolle.pension@naver.com',
    lat: 34.63163,
    lng: 127.79467,
    branch: '전남지사',
    clcBranch: '전남지국',
    industryTab: '숙박',
    openDate: '2026-05-20'
  }
];

// ─── 오늘 날짜 기준 신규뱃지(NEW, 14일 이내) · 개업기간 버킷 계산 ───────
const TODAY = new Date('2026-08-21');

function daysSinceOpen(openDateStr) {
  return Math.floor((TODAY - new Date(openDateStr)) / 86400000);
}
function isNewOpen(openDateStr) {
  const d = daysSinceOpen(openDateStr);
  return d >= 0 && d <= 14;
}
// 개업기간 버킷: 1~30일 / 31~60일 / 61~90일 / 90일~1년.
// 개업 1년(365일) 초과 또는 미래 개업일은 null → filterCustomers에서 "전체"를 골라도 항상 제외됨
// (Phase1 상호목록조회의 SCH_START/END_JOINDT 필수·기본 1년 필터와 동일한 취지).
function getOpenBucket(openDateStr) {
  const d = daysSinceOpen(openDateStr);
  if (d < 0) return null;
  if (d <= 30) return 'd30';
  if (d <= 60) return 'd60';
  if (d <= 90) return 'd90';
  if (d <= 365) return 'd365';
  return null;
}
ALL_CUSTOMERS.forEach(c => {
  c.isNew = isNewOpen(c.openDate);
  c.openBucket = getOpenBucket(c.openDate);
});

// ─── 조회/필터 헬퍼 ─────────────────────────────────────────────────────

// 통합 필터: 조직축(세스코/CLC) / 지사·지국 / 업종 / 개업기간(버킷) / 키워드 / 지역(법정동) 을 동시에 적용(AND)
//  - branch 가 'all'이면 지사 조건 무시. orgAxis 가 'CLC'면 clcBranch 필드로, 그 외엔 branch 필드로 매칭
//  - 개업 1년 초과(openBucket === null)는 period 값과 무관하게 항상 제외
//  - keyword: 상호명 또는 주소 부분일치 (SCH_KEYWORD 상당)
//  - regionSido / regionDongs: 지역(법정동) 선택값. 실서비스에서는 SCH_ADDRS(법정동 코드 배열)로 전달되고,
//    지역을 직접 선택하면 SCH_DEPT_CD(지사)를 빼고 조회한다 → 그 정책은 getFilteredList()에서 branch:'all'로 처리
//  - mock 이라 주소 문자열 포함 여부로 단순 매칭
function filterCustomers({ orgAxis = '세스코', branch = 'all', industry = 'all', period = 'all',
                           keyword = '', regionSido = '', regionDongs = [] } = {}) {
  return ALL_CUSTOMERS.filter(c => {
    if (c.openBucket === null) return false;               // 개업 1년 초과 상시 제외
    if (period !== 'all' && c.openBucket !== period) return false;
    if (branch !== 'all') {
      const field = orgAxis === 'CLC' ? c.clcBranch : c.branch;
      if (field !== branch) return false;
    }
    if (industry !== 'all' && c.industryTab !== industry) return false;
    if (keyword && !(c.companyName.includes(keyword) || c.address.includes(keyword))) return false;
    if (regionDongs.length) {
      if (!regionDongs.some(d => c.address.includes(d))) return false;
    } else if (regionSido) {
      const short = SIDO_SHORT[regionSido] || regionSido;
      if (!c.address.includes(short)) return false;
    }
    return true;
  });
}
