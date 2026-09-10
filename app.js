document.addEventListener('DOMContentLoaded', () => {

  // ══════════════════════════════════════════════════════
  // 0. 필터 상태 (조직축·지사·업종·개업기간 + 내 주위 신규 개업 모드)
  //    Phase 1.2 = 조회 전용 — 방문상태/레드존/통계 상태는 없음
  // ══════════════════════════════════════════════════════
  const filterState = {
    orgAxis: CURRENT_USER.orgAxis,   // 세스코 / CLC
    branch: CURRENT_USER.branch,     // 로그인 기반 디폴트 지역(담당 지사)
    industry: 'all',
    period: 'all',   // 개업기간 필터 — 기본값 "전체"(단, 개업 1년 초과는 항상 제외)
    regionKeyword: ''   // 지역검색(자유텍스트/시도) 적용값 — 검색화면 "적용" 버튼으로만 세팅됨
  };
  let nearbyMode = false;
  let nearbyOrigin = null;   // { lat, lng }
  let nearbyList = [];

  // ══════════════════════════════════════════════════════
  // 1. 화면 라우팅
  // ══════════════════════════════════════════════════════
  const navigateTo = (screenId) => {
    document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');
    if (screenId === 'screen-main') {
      renderMainList();
      refreshMapMarkers();
      setTimeout(initMainMap, 200);
    }
  };

  document.getElementById('btn-back-detail').addEventListener('click', () => navigateTo('screen-main'));
  document.getElementById('btn-close-detail').addEventListener('click', () => navigateTo('screen-main'));
  document.getElementById('btn-close-search').addEventListener('click', () => navigateTo('screen-main'));
  document.getElementById('btn-close-filter').addEventListener('click', () => navigateTo('screen-main'));
  document.getElementById('btn-back-main').addEventListener('click', () => {});
  document.getElementById('btn-close-main').addEventListener('click', () => {});
  document.getElementById('search-input').addEventListener('click', () => navigateTo('screen-search'));
  document.getElementById('btn-filter').addEventListener('click', () => navigateTo('screen-filter'));


  // ══════════════════════════════════════════════════════
  // 2. Leaflet 지도 초기화
  // ══════════════════════════════════════════════════════
  let mainMap = null;
  let detailMap = null;
  let mainMarkers = [];
  let originMarker = null;
  let detailMarker = null;

  const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
  const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

  // 조회 전용 — 신규 개업(14일 이내)만 색으로 구분, 나머지는 세스코 블루
  const markerColor = (d) => d.isNew ? '#E67E22' : '#0060A9';

  const makeCircleIcon = (color = '#0060A9', size = 14) => L.divIcon({
    className: '',
    html: `<div style="width:${size}px;height:${size}px;background:${color};border-radius:50%;border:2px solid #fff;box-shadow:0 2px 5px rgba(0,0,0,.35);"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2]
  });

  const makeOriginIcon = () => L.divIcon({
    className: '',
    html: `<div style="width:18px;height:18px;background:#333;border-radius:50%;border:3px solid #fff;box-shadow:0 0 0 4px rgba(51,51,51,.25);"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9]
  });

  const initMainMap = () => {
    if (mainMap) { refreshMapMarkers(); return; }
    const list = getFilteredList();
    const first = list[0];
    const center = first ? [first.lat, first.lng] : [37.5, 127.0];
    mainMap = L.map('main-map', { zoomControl: false, attributionControl: true })
      .setView(center, 12);
    L.tileLayer(TILE_URL, { attribution: TILE_ATTR }).addTo(mainMap);
    refreshMapMarkers();
  };

  // 현재 필터/모드에 맞춰 지도 마커 다시 그리기
  const refreshMapMarkers = () => {
    if (!mainMap) return;
    mainMarkers.forEach(m => mainMap.removeLayer(m));
    mainMarkers = [];
    if (originMarker) { mainMap.removeLayer(originMarker); originMarker = null; }

    const list = getFilteredList();
    list.forEach(d => {
      const marker = L.marker([d.lat, d.lng], { icon: makeCircleIcon(markerColor(d), 16) })
        .addTo(mainMap)
        .bindTooltip(d.companyName, { permanent: false, direction: 'top' });
      marker.on('click', () => openCustomerDetail(d));
      mainMarkers.push(marker);
    });

    if (nearbyMode && nearbyOrigin) {
      originMarker = L.marker([nearbyOrigin.lat, nearbyOrigin.lng], { icon: makeOriginIcon() })
        .addTo(mainMap)
        .bindTooltip('내 위치', { permanent: true, direction: 'top' });
      mainMap.setView([nearbyOrigin.lat, nearbyOrigin.lng], 12);
    } else if (list.length > 0) {
      mainMap.setView([list[0].lat, list[0].lng], 12);
    }
  };

  const initDetailMap = (lat, lng) => {
    if (!detailMap) {
      detailMap = L.map('detail-map', { zoomControl: false, attributionControl: false })
        .setView([lat, lng], 16);
      L.tileLayer(TILE_URL, { attribution: TILE_ATTR }).addTo(detailMap);
      detailMarker = L.marker([lat, lng], { icon: makeCircleIcon('#E74C3C', 20) }).addTo(detailMap);
    } else {
      detailMap.setView([lat, lng], 16);
      detailMarker.setLatLng([lat, lng]);
    }
    setTimeout(() => detailMap.invalidateSize(), 100);
  };


  // ══════════════════════════════════════════════════════
  // 3. 거리 계산 (Haversine)
  // ══════════════════════════════════════════════════════
  const haversineKm = (lat1, lng1, lat2, lng2) => {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };


  // ══════════════════════════════════════════════════════
  // 4. 통합 필터 조회 (조직축·지사·업종·개업기간 + 내 주위 모드)
  // ══════════════════════════════════════════════════════
  const getFilteredList = () => {
    if (nearbyMode) return nearbyList;
    return filterCustomers({
      orgAxis: filterState.orgAxis,
      branch: filterState.branch,
      industry: filterState.industry,
      period: filterState.period,
      region: filterState.regionKeyword
    });
  };


  // ══════════════════════════════════════════════════════
  // 5. 지사 필터(조직축→사업부/총국→지사/지국 3단계) / 업종 탭 렌더링
  // ══════════════════════════════════════════════════════
  const tabsIndustryEl = document.getElementById('tabs-industry');

  const renderIndustryTabs = () => {
    tabsIndustryEl.innerHTML = '';
    const allChip = document.createElement('div');
    allChip.className = 'radio-chip-inline' + (filterState.industry === 'all' ? ' active' : '');
    allChip.textContent = '전체';
    allChip.addEventListener('click', () => selectIndustry('all'));
    tabsIndustryEl.appendChild(allChip);

    INDUSTRY_TAB_LIST.forEach(v => {
      const chip = document.createElement('div');
      chip.className = 'radio-chip-inline' + (filterState.industry === v ? ' active' : '');
      chip.textContent = v;
      chip.addEventListener('click', () => selectIndustry(v));
      tabsIndustryEl.appendChild(chip);
    });

    // 업종 10종 + "자세히 보기" — 클릭 시 필터화면(마케팅 신업종 상세 트리)으로 이동
    const moreChip = document.createElement('div');
    moreChip.className = 'radio-chip-inline chip-more-link';
    moreChip.textContent = '자세히 보기 ›';
    moreChip.addEventListener('click', () => navigateTo('screen-filter'));
    tabsIndustryEl.appendChild(moreChip);
  };

  const selectIndustry = (v) => {
    if (nearbyMode) exitNearbyMode(false);
    filterState.industry = v;
    renderIndustryTabs();
    onFilterChange();
  };

  // ── 지사 필터: 조직축 → 사업부/총국 → 지사/지국 3단계 ─────────────
  const branchTrigger    = document.getElementById('branch-select-trigger');
  const branchPanel      = document.getElementById('branch-select-panel');
  const branchLabelEl    = document.getElementById('branch-select-label');
  const branchSubEl      = document.getElementById('branch-select-sub');
  const orgAxisChipRow   = document.getElementById('orgaxis-chip-row');
  const divisionChipRow  = document.getElementById('division-chip-row');
  const branchChipRow    = document.getElementById('branch-chip-row');
  const divisionStepTitle = document.getElementById('division-step-title');
  const branchStepTitle   = document.getElementById('branch-step-title');

  // 패널 안에서 현재 펼쳐서 보고 있는 임시 상태(선택 확정 전) — 기본은 내 소속
  let panelAxis = filterState.orgAxis;
  let panelDivision = BRANCH_TO_PARENT[panelAxis][filterState.branch] || ORG_TREE[panelAxis][0].name;

  const axisTitles = { '세스코': { div: '사업부', branch: '지사' }, 'CLC': { div: '총국', branch: '지국' } };

  const renderOrgAxisChips = () => {
    orgAxisChipRow.innerHTML = '';
    ORG_AXIS_LIST.forEach(axis => {
      const chip = document.createElement('div');
      chip.className = 'radio-chip-inline' + (axis === panelAxis ? ' active' : '');
      chip.textContent = axis;
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        panelAxis = axis;
        panelDivision = ORG_TREE[panelAxis][0].name;
        divisionStepTitle.textContent = axisTitles[axis].div;
        branchStepTitle.textContent = axisTitles[axis].branch;
        renderOrgAxisChips();
        renderDivisionChips();
        renderBranchChips();
      });
      orgAxisChipRow.appendChild(chip);
    });
  };

  const renderDivisionChips = () => {
    divisionChipRow.innerHTML = '';
    ORG_TREE[panelAxis].forEach(d => {
      const chip = document.createElement('div');
      chip.className = 'radio-chip-inline' + (d.name === panelDivision ? ' active' : '');
      chip.textContent = d.name;
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        panelDivision = d.name;
        renderDivisionChips();
        renderBranchChips();
      });
      divisionChipRow.appendChild(chip);
    });
  };

  const renderBranchChips = () => {
    branchChipRow.innerHTML = '';
    const division = ORG_TREE[panelAxis].find(d => d.name === panelDivision);
    (division ? division.branches : []).forEach(b => {
      const chip = document.createElement('div');
      chip.className = 'radio-chip-inline' +
        (b === filterState.branch && panelAxis === filterState.orgAxis ? ' active' : '');
      chip.textContent = b;
      chip.addEventListener('click', () => {
        if (nearbyMode) exitNearbyMode(false);
        filterState.orgAxis = panelAxis;
        filterState.branch = b;
        updateBranchTriggerLabel();
        closeBranchPanel();
        onFilterChange();
        updateResultBranchText();
      });
      branchChipRow.appendChild(chip);
    });
  };

  const updateBranchTriggerLabel = () => {
    branchLabelEl.textContent = filterState.branch;
    const parent = BRANCH_TO_PARENT[filterState.orgAxis][filterState.branch] || '';
    branchSubEl.textContent = filterState.orgAxis + (parent ? ' · ' + parent : '');
  };

  const openBranchPanel = () => {
    panelAxis = filterState.orgAxis;
    panelDivision = BRANCH_TO_PARENT[panelAxis][filterState.branch] || ORG_TREE[panelAxis][0].name;
    divisionStepTitle.textContent = axisTitles[panelAxis].div;
    branchStepTitle.textContent = axisTitles[panelAxis].branch;
    renderOrgAxisChips();
    renderDivisionChips();
    renderBranchChips();
    branchPanel.classList.add('open');
    branchTrigger.classList.add('open');
  };
  const closeBranchPanel = () => {
    branchPanel.classList.remove('open');
    branchTrigger.classList.remove('open');
  };
  branchTrigger.addEventListener('click', () => {
    if (branchPanel.classList.contains('open')) closeBranchPanel();
    else openBranchPanel();
  });
  document.addEventListener('click', e => {
    if (!branchPanel.classList.contains('open')) return;
    if (e.target === branchTrigger || branchTrigger.contains(e.target)) return;
    if (branchPanel.contains(e.target)) return;
    closeBranchPanel();
  });

  const updateResultBranchText = () => {
    const el = document.getElementById('result-branch-text');
    el.textContent = nearbyMode ? '내 위치 반경' : (filterState.branch === 'all' ? '전체 지역' : filterState.branch);
  };

  // ── 개업기간 필터: 4구간 단일 필터 (전체/1~30일/31~60일/61~90일/90일~1년) ──
  const periodChipsEl = document.getElementById('main-chips');
  const renderPeriodChips = () => {
    periodChipsEl.innerHTML = '';
    PERIOD_LIST.forEach(p => {
      const chip = document.createElement('div');
      chip.className = 'radio-chip-inline' + (p.key === filterState.period ? ' active' : '');
      chip.textContent = p.label;
      chip.dataset.period = p.key;
      chip.addEventListener('click', () => {
        if (nearbyMode) exitNearbyMode(false);
        filterState.period = p.key;
        renderPeriodChips();
        onFilterChange();
      });
      periodChipsEl.appendChild(chip);
    });
  };

  // 필터가 바뀔 때 공통으로 호출 — 리스트/지도 갱신
  const onFilterChange = () => {
    renderMainList();
    refreshMapMarkers();
  };


  // ══════════════════════════════════════════════════════
  // 6. 필터 영역 접기·펼치기 — 하단 리스트 영역 확보용
  // ══════════════════════════════════════════════════════
  const filterPanel = document.getElementById('filter-panel');
  const filterPanelToggle = document.getElementById('filter-panel-toggle');
  const filterPanelToggleLabel = document.getElementById('filter-panel-toggle-label');
  let filterPanelOpen = true;

  const updateFilterPanelToggle = () => {
    filterPanel.style.display = filterPanelOpen ? '' : 'none';
    filterPanelToggleLabel.textContent = filterPanelOpen ? '필터 접기' : '필터 펼치기';
    filterPanelToggle.classList.toggle('collapsed', !filterPanelOpen);
    if (mainMap) setTimeout(() => mainMap.invalidateSize(), 320);
  };
  filterPanelToggle.addEventListener('click', () => {
    filterPanelOpen = !filterPanelOpen;
    updateFilterPanelToggle();
  });


  // ══════════════════════════════════════════════════════
  // 7. 지도 ↔ 리스트 드래그 전환
  // ══════════════════════════════════════════════════════
  const mapWrapper   = document.getElementById('map-wrapper');
  const dragHandle   = document.getElementById('drag-handle');
  const btnShowMap   = document.getElementById('btn-show-map');

  const MAP_H_SPLIT  = 180; // 기본: 반반

  let dragStartY = 0;
  let dragStartH = MAP_H_SPLIT;
  let mapHeight  = MAP_H_SPLIT;
  let isDragging = false;

  const setMapHeight = (h) => {
    const container = document.getElementById('map-list-container');
    const maxH = container ? container.offsetHeight - 24 : 600; // 24 = dragHandle
    h = Math.max(0, Math.min(maxH, h));
    mapHeight = h;
    mapWrapper.style.height = h + 'px';
    if (h === 0) {
      btnShowMap.style.display = 'flex';
      dragHandle.style.display = 'none';
    } else {
      btnShowMap.style.display = 'none';
      dragHandle.style.display = 'flex';
    }
    if (mainMap) setTimeout(() => mainMap.invalidateSize(), 50);
  };

  const onDragStart = (clientY) => {
    isDragging = true;
    dragStartY = clientY;
    dragStartH = mapHeight;
    mapWrapper.style.transition = 'none';
  };
  const onDragMove = (clientY) => {
    if (!isDragging) return;
    const delta = clientY - dragStartY;
    setMapHeight(dragStartH + delta);
  };
  const onDragEnd = () => {
    if (!isDragging) return;
    isDragging = false;
    mapWrapper.style.transition = 'height 0.3s ease';
    const container = document.getElementById('map-list-container');
    const maxH = container ? container.offsetHeight - 24 : 600;
    if (mapHeight < maxH * 0.15) {
      setMapHeight(0);
    } else if (mapHeight > maxH * 0.7) {
      setMapHeight(maxH);
      dragHandle.style.display = 'none';
    } else {
      setMapHeight(MAP_H_SPLIT);
    }
  };

  dragHandle.addEventListener('mousedown', e => onDragStart(e.clientY));
  document.addEventListener('mousemove', e => { if (isDragging) onDragMove(e.clientY); });
  document.addEventListener('mouseup', () => onDragEnd());

  dragHandle.addEventListener('touchstart', e => onDragStart(e.touches[0].clientY), { passive: true });
  document.addEventListener('touchmove', e => { if (isDragging) onDragMove(e.touches[0].clientY); }, { passive: true });
  document.addEventListener('touchend', () => onDragEnd());

  btnShowMap.addEventListener('click', () => {
    mapWrapper.style.transition = 'height 0.3s ease';
    setMapHeight(MAP_H_SPLIT);
  });


  // ══════════════════════════════════════════════════════
  // 8. 고객 카드 렌더링 (조회 전용 — 방문상태 뱃지 없음)
  // ══════════════════════════════════════════════════════
  const extraTagsHtml = (data) => data.isNew ? `<span class="status-badge badge-new">NEW</span>` : '';

  const renderMainList = () => {
    const data_list = getFilteredList();
    const list = document.getElementById('main-card-list');
    list.innerHTML = '';
    document.getElementById('result-count').textContent = data_list.length;
    updateResultBranchText();

    if (data_list.length === 0) {
      list.innerHTML = `<div style="padding:40px 20px; text-align:center; color:#999; font-size:13px;">조건에 맞는 업체가 없습니다.</div>`;
      return;
    }

    data_list.forEach(data => {
      const card = document.createElement('div');
      card.className = 'customer-card';
      const tagsHtml = data.tags.map(t => `<span class="tag-outline">${t}</span>`).join('') + extraTagsHtml(data);
      card.innerHTML = `
        <div class="card-tags">${tagsHtml}</div>
        <div class="card-title-row">
          <div class="card-title">${data.companyName}</div>
          <div class="card-distance">📍 ${data.distance}</div>
        </div>
        <div class="card-info">${data.address}</div>
        <div class="card-info">${data.ceo} · ${data.area}</div>
        <div class="card-bottom-row">
          <button class="navi-btn" data-id="${data.id}">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <path d="M3 11l19-9-9 19-2-8-8-2z"/>
            </svg>
            길찾기
          </button>
        </div>
      `;
      card.querySelector('.navi-btn').addEventListener('click', e => {
        e.stopPropagation();
        openNaviModal(data);
      });
      card.addEventListener('click', () => openCustomerDetail(data));
      list.appendChild(card);
    });
  };


  // ══════════════════════════════════════════════════════
  // 9. 고객 상세 화면 (조회 전용)
  // ══════════════════════════════════════════════════════
  let currentCustomer = null;

  const openCustomerDetail = (data) => {
    currentCustomer = data;
    document.getElementById('detail-tags').innerHTML =
      data.tags.map(t => `<span class="tag-outline">${t}</span>`).join('') + extraTagsHtml(data);
    document.getElementById('detail-company-name').textContent = data.companyName;
    document.getElementById('detail-distance').textContent = '📍 ' + data.distance;
    document.getElementById('detail-address').textContent = data.address;
    document.getElementById('detail-ceo').textContent = data.ceo;
    document.getElementById('detail-birth').textContent = data.birthYear;
    document.getElementById('detail-phone').textContent = 'T. ' + data.phone;
    document.getElementById('detail-fax').textContent = 'F. ' + (data.fax || '-');
    document.getElementById('detail-revenue').textContent = '매출 규모 ' + (data.revenue || '-');
    document.getElementById('detail-area').textContent = '면적 ' + data.area;
    document.getElementById('detail-deposit').textContent = data.deposit || '-';
    document.getElementById('detail-monthly-rent').textContent = data.monthlyRent || '-';
    document.getElementById('detail-employees').textContent = data.employees || '-';
    document.getElementById('detail-homepage').textContent = data.homepage || '-';
    document.getElementById('detail-email').textContent = data.email || '-';

    navigateTo('screen-detail');
    setTimeout(() => initDetailMap(data.lat, data.lng), 200);
  };

  document.getElementById('btn-navi-detail').addEventListener('click', () => {
    if (currentCustomer) openNaviModal(currentCustomer);
  });


  // ══════════════════════════════════════════════════════
  // 10. 길찾기 (네비게이션) 모달
  // ══════════════════════════════════════════════════════
  let naviTarget = null;

  const openNaviModal = (data) => {
    naviTarget = data;
    document.getElementById('navi-modal-overlay').style.display = 'flex';
  };
  const closeNaviModal = () => {
    document.getElementById('navi-modal-overlay').style.display = 'none';
  };

  document.getElementById('btn-close-navi').addEventListener('click', closeNaviModal);
  document.getElementById('navi-modal-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('navi-modal-overlay')) closeNaviModal();
  });

  document.querySelectorAll('.navi-option').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!naviTarget) return;
      const app = btn.dataset.app;
      const lat = naviTarget.lat, lng = naviTarget.lng;
      const name = encodeURIComponent(naviTarget.companyName);
      const addr = naviTarget.address;

      if (app === 'tmap') {
        window.open(`tmap://route?goalname=${name}&goalx=${lng}&goaly=${lat}`, '_blank');
        setTimeout(() => {
          window.open(`https://tmap.life/route?goalname=${name}&goalx=${lng}&goaly=${lat}`, '_blank');
        }, 500);
      } else if (app === 'naver') {
        window.open(`nmap://navigation?dlat=${lat}&dlng=${lng}&dname=${name}&appname=cesco`, '_blank');
        setTimeout(() => {
          window.open(`https://map.naver.com/index.nhn?slng=&slat=&stext=내위치&elng=${lng}&elat=${lat}&etext=${name}&menu=route`, '_blank');
        }, 500);
      } else if (app === 'kakao') {
        window.open(`kakaomap://route?ep=${lat},${lng}&by=CAR`, '_blank');
        setTimeout(() => {
          window.open(`https://map.kakao.com/link/to/${name},${lat},${lng}`, '_blank');
        }, 500);
      } else if (app === 'copy') {
        navigator.clipboard.writeText(addr).then(() => {
          showToast('주소가 복사되었습니다');
        }).catch(() => {
          const el = document.createElement('textarea');
          el.value = addr;
          document.body.appendChild(el);
          el.select();
          document.execCommand('copy');
          document.body.removeChild(el);
          showToast('주소가 복사되었습니다');
        });
      }
      if (app !== 'copy') closeNaviModal();
    });
  });

  const showToast = (msg) => {
    const toast = document.getElementById('copy-toast');
    toast.textContent = msg;
    toast.style.display = 'block';
    toast.style.animation = 'none';
    void toast.offsetWidth;
    toast.style.animation = 'fadeInOut 2s ease forwards';
    setTimeout(() => { toast.style.display = 'none'; }, 2100);
  };


  // ══════════════════════════════════════════════════════
  // 11. 내 주위 신규 개업 매장 보기 (GPS 반경 거리순 + 내 위치 마커)
  // ══════════════════════════════════════════════════════
  const btnNearby = document.getElementById('btn-nearby');

  const buildNearbyList = (origin) => {
    return ALL_CUSTOMERS
      .filter(c => c.openBucket !== null)   // 개업 1년 초과 매장은 제외 (조회 정책 일치)
      .map(c => {
        c._distanceKm = haversineKm(origin.lat, origin.lng, c.lat, c.lng);
        return c;
      })
      .sort((a, b) => a._distanceKm - b._distanceKm)
      .slice(0, 20)
      .map(c => {
        c.distance = c._distanceKm < 1 ? `${Math.round(c._distanceKm * 1000)}m` : `${c._distanceKm.toFixed(1)}km`;
        return c;
      });
  };

  const enterNearbyMode = (origin) => {
    nearbyMode = true;
    nearbyOrigin = origin;
    nearbyList = buildNearbyList(origin);
    btnNearby.textContent = '✕ 닫기';
    btnNearby.classList.add('active');
    document.querySelectorAll('.tabs-block, .map-search-row').forEach(el => el.style.opacity = '0.4');
    document.querySelectorAll('.tabs-block .radio-chip-inline, #main-chips .radio-chip-inline, #btn-filter, #branch-select-trigger')
      .forEach(el => el.style.pointerEvents = 'none');
    onFilterChange();
    updateResultBranchText();
  };

  const exitNearbyMode = (refresh = true) => {
    nearbyMode = false;
    nearbyOrigin = null;
    nearbyList = [];
    btnNearby.textContent = '📍 내 주위 신규 개업 매장 보기';
    btnNearby.classList.remove('active');
    document.querySelectorAll('.tabs-block, .map-search-row').forEach(el => el.style.opacity = '1');
    document.querySelectorAll('.tabs-block .radio-chip-inline, #main-chips .radio-chip-inline, #btn-filter, #branch-select-trigger')
      .forEach(el => el.style.pointerEvents = '');
    if (refresh) {
      onFilterChange();
      updateResultBranchText();
    }
  };

  btnNearby.addEventListener('click', () => {
    if (nearbyMode) { exitNearbyMode(); return; }

    // 기본 fallback: 로그인 사용자 담당 지사의 첫 고객 좌표(지사 대표 위치)
    const fallbackList = ALL_CUSTOMERS.filter(c => c.branch === CURRENT_USER.branch);
    const fallbackOrigin = fallbackList.length
      ? { lat: fallbackList[0].lat, lng: fallbackList[0].lng }
      : { lat: ALL_CUSTOMERS[0].lat, lng: ALL_CUSTOMERS[0].lng };

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        pos => enterNearbyMode({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => enterNearbyMode(fallbackOrigin),
        { timeout: 3000 }
      );
    } else {
      enterNearbyMode(fallbackOrigin);
    }
  });


  // ══════════════════════════════════════════════════════
  // 12. 필터 화면 (고객유형(업종) — 마케팅 신업종 / 매출구간)
  //     KSIC 산업분류(10차) 섹션은 Phase 1.2에서 제거됨
  //     개업기간 필터는 메인화면으로 통합되어 여기서는 다루지 않음
  // ══════════════════════════════════════════════════════
  const typeL1 = document.getElementById('filter-type-l1');
  const typeL2 = document.getElementById('filter-type-l2');
  const typeL3 = document.getElementById('filter-type-l3');
  const typeL4 = document.getElementById('filter-type-l4');

  const resetSelect = (sel, label) => {
    sel.innerHTML = `<option value="">${label}</option>`;
    sel.disabled = true;
  };

  // 대분류 채우기 (마케팅 신업종)
  if (typeof INDUSTRY_TYPE_DATA !== 'undefined') {
    Object.entries(INDUSTRY_TYPE_DATA).sort((a,b) => a[0].localeCompare(b[0])).forEach(([code, v]) => {
      typeL1.appendChild(new Option(v.name, code));
    });
  }
  resetSelect(typeL2, '중분류');
  resetSelect(typeL3, '소분류');
  resetSelect(typeL4, '세분류');

  typeL1.addEventListener('change', () => {
    resetSelect(typeL2, '중분류');
    resetSelect(typeL3, '소분류');
    resetSelect(typeL4, '세분류');
    const lc = typeL1.value;
    if (!lc || !INDUSTRY_TYPE_DATA[lc]) return;
    Object.entries(INDUSTRY_TYPE_DATA[lc].mid).sort((a,b) => a[0].localeCompare(b[0])).forEach(([code, v]) => {
      typeL2.appendChild(new Option(v.name, code));
    });
    typeL2.disabled = false;
  });
  typeL2.addEventListener('change', () => {
    resetSelect(typeL3, '소분류');
    resetSelect(typeL4, '세분류');
    const lc = typeL1.value, mc = typeL2.value;
    if (!mc) return;

    const parentName = INDUSTRY_TYPE_DATA[lc].mid[mc].name;
    const smallEntries = Object.entries(INDUSTRY_TYPE_DATA[lc].mid[mc].small)
      .sort((a, b) => a[0].localeCompare(b[0]));

    if (smallEntries.length === 1 && smallEntries[0][1].name === 'NULL') {
      const [sc, sv] = smallEntries[0];
      typeL3.innerHTML = `<option value="${sc}">${parentName}</option>`;
      typeL3.disabled = true;
      Object.entries(sv.detail).sort((a, b) => a[0].localeCompare(b[0])).forEach(([code, name]) => {
        typeL4.appendChild(new Option(name, code));
      });
      typeL4.disabled = false;
      return;
    }

    smallEntries.forEach(([code, v]) => {
      const displayName = v.name === 'NULL' ? parentName : v.name;
      typeL3.appendChild(new Option(displayName, code));
    });
    typeL3.disabled = false;
  });

  typeL3.addEventListener('change', () => {
    resetSelect(typeL4, '세분류');
    const lc = typeL1.value, mc = typeL2.value, sc = typeL3.value;
    if (!sc) return;
    Object.entries(INDUSTRY_TYPE_DATA[lc].mid[mc].small[sc].detail)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .forEach(([code, name]) => {
        typeL4.appendChild(new Option(name, code));
      });
    typeL4.disabled = false;
  });

  // 필터 초기화 / 적용
  document.getElementById('btn-reset-filter').addEventListener('click', () => {
    typeL1.value = ''; resetSelect(typeL2,'중분류'); resetSelect(typeL3,'소분류'); resetSelect(typeL4,'세분류');
    document.getElementById('filter-revenue').value = '';
  });
  document.getElementById('btn-apply-filter').addEventListener('click', () => {
    document.getElementById('btn-filter').classList.add('active');
    navigateTo('screen-main');
  });


  // ══════════════════════════════════════════════════════
  // 13. 검색 화면 – 지역 커스텀 드롭다운 + 적용/초기화 버튼
  // ══════════════════════════════════════════════════════
  const sidoTrigger = document.getElementById('sido-trigger');
  const sidoPanel   = document.getElementById('sido-panel');
  const sidoLabel   = document.getElementById('sido-label');

  sidoTrigger.addEventListener('click', () => {
    const isOpen = sidoPanel.classList.contains('open');
    sidoPanel.classList.toggle('open', !isOpen);
    sidoTrigger.classList.toggle('open', !isOpen);
    const svg = sidoTrigger.querySelector('svg');
    svg.style.transform = isOpen ? '' : 'rotate(180deg)';
  });

  sidoPanel.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      const checked = [...sidoPanel.querySelectorAll('input:checked')].map(c => c.value);
      sidoLabel.textContent = checked.length ? checked.join(', ') : '시/도';
    });
  });

  // 지역검색 적용/초기화/클리어 — 실서비스에서 지적된 "적용 버튼 부재"(불편점 2.1) 해결.
  // mock 데이터라 실제 매칭은 address 문자열 포함 여부로 단순화.
  const updateSearchDisplay = () => {
    const display = document.getElementById('search-display-input');
    const clearBtn = document.getElementById('search-clear-btn');
    display.value = filterState.regionKeyword;
    clearBtn.style.display = filterState.regionKeyword ? 'inline' : 'none';
  };

  document.getElementById('btn-apply-search').addEventListener('click', () => {
    const keyword = document.getElementById('search-text-input').value.trim();
    const checkedSido = [...sidoPanel.querySelectorAll('input:checked')]
      .map(c => c.value).filter(v => v !== '전체');
    filterState.regionKeyword = keyword || checkedSido.join(' ');
    updateSearchDisplay();
    if (nearbyMode) exitNearbyMode(false);
    navigateTo('screen-main');
    onFilterChange();
  });
  document.getElementById('btn-reset-search').addEventListener('click', () => {
    document.getElementById('search-text-input').value = '';
    sidoPanel.querySelectorAll('input:checked').forEach(cb => cb.checked = false);
    sidoLabel.textContent = '시/도';
  });
  document.getElementById('search-clear-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    filterState.regionKeyword = '';
    updateSearchDisplay();
    onFilterChange();
  });


  // ══════════════════════════════════════════════════════
  // 14. 초기화 — 로그인 사용자 정보 반영(디폴트 지역 = 담당 지사)
  // ══════════════════════════════════════════════════════
  document.getElementById('user-info-name').textContent = CURRENT_USER.name;
  document.getElementById('user-info-branch').textContent = CURRENT_USER.branch;

  updateBranchTriggerLabel();
  renderIndustryTabs();
  renderPeriodChips();
  updateSearchDisplay();
  renderMainList();
  window.addEventListener('load', () => setTimeout(initMainMap, 300));

});
