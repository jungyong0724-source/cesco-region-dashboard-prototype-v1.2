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
    keyword: '',        // 상호명/키워드 — 메인화면 검색창에서 화면 전환 없이 바로 입력
    regionSido: '',     // 지역선택(필터 화면) — 시/도 (구·군/읍·면·동 미선택 시 시/도 단위로 매칭)
    regionDongs: []     // 지역선택(필터 화면) — 읍·면·동 다중. 값이 있으면 지사(SCH_DEPT_CD) 무시하고 조회
  };
  const regionActive = () => filterState.regionDongs.length > 0 || !!filterState.regionSido;
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
  document.getElementById('btn-close-filter').addEventListener('click', () => navigateTo('screen-main'));
  document.getElementById('btn-back-main').addEventListener('click', () => {});
  document.getElementById('btn-close-main').addEventListener('click', () => {});
  // 필터 아이콘 → 지역선택/고객유형/매출구간을 다루는 필터 화면 (지역선택 폼은 현재 적용값으로 프리필)
  document.getElementById('btn-filter').addEventListener('click', () => {
    if (typeof window.syncFilterForm === 'function') window.syncFilterForm();
    navigateTo('screen-filter');
  });


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
    // 지역(법정동)을 직접 선택하면 SCH_DEPT_CD(지사)를 빼고 선택 지역 전체를 조회 (Phase1 QA FAQ 확정)
    const useBranch = regionActive() ? 'all' : filterState.branch;
    return filterCustomers({
      orgAxis: filterState.orgAxis,
      branch: useBranch,
      industry: filterState.industry,
      period: filterState.period,
      keyword: filterState.keyword,
      regionSido: filterState.regionSido,
      regionDongs: filterState.regionDongs
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
    if (nearbyMode) { el.textContent = '내 위치 반경'; return; }
    if (regionActive()) {
      el.textContent = filterState.regionDongs.length
        ? filterState.regionDongs[0] + (filterState.regionDongs.length > 1 ? ` 외 ${filterState.regionDongs.length - 1}곳` : '')
        : filterState.regionSido;
      return;
    }
    el.textContent = filterState.branch === 'all' ? '전체 지역' : filterState.branch;
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
  // 12. 메인 검색창 — 상호/키워드 (화면 전환 없이 바로 반영. 지역선택은 필터 화면으로 이동됨)
  // ══════════════════════════════════════════════════════
  const keywordInput = document.getElementById('keyword-input');
  const keywordClearBtn = document.getElementById('keyword-clear-btn');

  const updateKeywordClearBtn = () => {
    keywordClearBtn.style.display = filterState.keyword ? 'inline' : 'none';
  };
  const applyKeyword = () => {
    filterState.keyword = keywordInput.value.trim();
    updateKeywordClearBtn();
    if (nearbyMode) exitNearbyMode(false);
    onFilterChange();
  };
  keywordInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { applyKeyword(); keywordInput.blur(); }
  });
  keywordInput.addEventListener('blur', applyKeyword);
  document.getElementById('keyword-search-btn').addEventListener('click', applyKeyword);
  keywordClearBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    keywordInput.value = '';
    applyKeyword();
  });


  // ══════════════════════════════════════════════════════
  // 13. 필터 화면 — 지역선택(3단계) + 고객유형(업종, 마케팅 신업종) + 매출구간
  //     KSIC 산업분류(10차) 섹션은 Phase 1.2에서 제거됨. 개업기간은 메인화면에서 다룸.
  //     지역선택은 사용자 요청으로 별도 "검색" 화면이 아니라 이 필터 화면에 통합.
  //     실서비스는 지역 각 단계를 POST /local-area/bjd-code 로 로드하고 선택 법정동을
  //     SCH_ADDRS 배열로 전달. mock 이라 BJD_TREE fixture + 주소 문자열 매칭.
  // ══════════════════════════════════════════════════════

  // ── 13-1. 지역선택 3단계(시/도 → 구·군 → 읍·면·동 다중) ────────────
  const sidoSel    = document.getElementById('filter-sido');
  const sigunguSel = document.getElementById('filter-sigungu');
  const dongTrigger = document.getElementById('dong-trigger');
  const dongPanel   = document.getElementById('dong-panel');
  const dongLabel   = document.getElementById('dong-label');
  const recentChipsEl = document.getElementById('recent-search-chips');

  let recentSearches = [];   // [{ sido, sigungu, dongs:[] }]

  Object.keys(BJD_TREE).forEach(sido => sidoSel.appendChild(new Option(sido, sido)));

  const resetSigungu = () => {
    sigunguSel.innerHTML = '<option value="">구/군</option>';
    sigunguSel.disabled = true;
  };
  const setDongEnabled = (on) => {
    dongTrigger.setAttribute('aria-disabled', on ? 'false' : 'true');
    dongTrigger.style.opacity = on ? '' : '0.5';
    dongTrigger.style.pointerEvents = on ? '' : 'none';
    if (!on) { dongPanel.classList.remove('open'); dongTrigger.classList.remove('open'); }
  };
  const updateDongLabel = () => {
    const checked = [...dongPanel.querySelectorAll('input.dong-cb:checked')].map(c => c.value);
    dongLabel.textContent = checked.length ? (checked[0] + (checked.length > 1 ? ` 외 ${checked.length - 1}` : '')) : '읍/면/동';
  };
  const renderDongPanel = (sido, sigungu) => {
    dongPanel.innerHTML = '';
    if (!sido || !sigungu) { setDongEnabled(false); updateDongLabel(); return; }
    const dongs = (BJD_TREE[sido] && BJD_TREE[sido][sigungu]) || [];
    const allRow = document.createElement('label');
    allRow.className = 'check-item';
    allRow.innerHTML = `<input type="checkbox" id="dong-all"> <span>이 구/군 전체</span>`;
    dongPanel.appendChild(allRow);
    dongs.forEach(d => {
      const row = document.createElement('label');
      row.className = 'check-item';
      row.innerHTML = `<input type="checkbox" class="dong-cb" value="${d}"> <span>${d}</span>`;
      dongPanel.appendChild(row);
    });
    dongPanel.querySelector('#dong-all').addEventListener('change', e => {
      dongPanel.querySelectorAll('input.dong-cb').forEach(cb => cb.checked = e.target.checked);
      updateDongLabel();
    });
    dongPanel.querySelectorAll('input.dong-cb').forEach(cb => {
      cb.addEventListener('change', () => {
        const all = dongPanel.querySelector('#dong-all');
        all.checked = [...dongPanel.querySelectorAll('input.dong-cb')].every(x => x.checked);
        updateDongLabel();
      });
    });
    setDongEnabled(true);
    updateDongLabel();
  };

  sidoSel.addEventListener('change', () => {
    resetSigungu();
    renderDongPanel('', '');
    const sido = sidoSel.value;
    if (!sido) return;
    Object.keys(BJD_TREE[sido]).forEach(gu => sigunguSel.appendChild(new Option(gu, gu)));
    sigunguSel.disabled = false;
  });
  sigunguSel.addEventListener('change', () => {
    renderDongPanel(sidoSel.value, sigunguSel.value);
  });
  dongTrigger.addEventListener('click', () => {
    if (dongTrigger.getAttribute('aria-disabled') === 'true') return;
    const open = dongPanel.classList.toggle('open');
    dongTrigger.classList.toggle('open', open);
  });

  // 메인화면 "적용된 지역" 칩 + 필터 아이콘 active 표시
  const regionSummary = () => {
    if (filterState.regionDongs.length) {
      return filterState.regionDongs[0] + (filterState.regionDongs.length > 1 ? ` 외 ${filterState.regionDongs.length - 1}곳` : '');
    }
    return filterState.regionSido || '';
  };
  const updateAppliedRegionRow = () => {
    const row = document.getElementById('applied-region-row');
    const chip = document.getElementById('applied-region-chip');
    if (regionActive()) {
      chip.textContent = regionSummary();
      row.style.display = 'flex';
    } else {
      row.style.display = 'none';
    }
  };
  const updateFilterBtnActive = () => {
    document.getElementById('btn-filter').classList.toggle('active', regionActive());
  };
  document.getElementById('applied-region-clear').addEventListener('click', () => {
    filterState.regionSido = '';
    filterState.regionDongs = [];
    updateAppliedRegionRow();
    updateFilterBtnActive();
    if (nearbyMode) exitNearbyMode(false);
    onFilterChange();
  });

  // 필터 화면을 열 때 현재 적용된 지역값으로 폼을 맞춰줌
  const syncFilterForm = () => {
    sidoSel.value = filterState.regionSido || '';
    resetSigungu();
    renderDongPanel('', '');
    if (filterState.regionSido && BJD_TREE[filterState.regionSido]) {
      Object.keys(BJD_TREE[filterState.regionSido]).forEach(gu => sigunguSel.appendChild(new Option(gu, gu)));
      sigunguSel.disabled = false;
      // 적용된 읍·면·동이 어느 구/군인지 역추적
      const gu = Object.keys(BJD_TREE[filterState.regionSido]).find(g =>
        filterState.regionDongs.some(d => BJD_TREE[filterState.regionSido][g].includes(d)));
      if (gu) {
        sigunguSel.value = gu;
        renderDongPanel(filterState.regionSido, gu);
        filterState.regionDongs.forEach(d => {
          const cb = dongPanel.querySelector(`input.dong-cb[value="${d}"]`);
          if (cb) cb.checked = true;
        });
        const all = dongPanel.querySelector('#dong-all');
        if (all) all.checked = [...dongPanel.querySelectorAll('input.dong-cb')].every(x => x.checked);
        updateDongLabel();
      }
    }
  };
  window.syncFilterForm = syncFilterForm;

  const renderRecentChips = () => {
    recentChipsEl.innerHTML = '';
    if (!recentSearches.length) {
      recentChipsEl.innerHTML = '<span style="font-size:12px;color:var(--text-light);">최근 검색 기록이 없습니다.</span>';
      return;
    }
    recentSearches.forEach((r, i) => {
      const chip = document.createElement('div');
      chip.className = 'chip';
      const region = r.dongs.length
        ? (r.dongs[0] + (r.dongs.length > 1 ? ` 외 ${r.dongs.length - 1}` : ''))
        : (r.sido || '');
      chip.textContent = region + ' ✕';
      chip.addEventListener('click', () => {
        recentSearches.splice(i, 1);
        renderRecentChips();
      });
      recentChipsEl.appendChild(chip);
    });
  };
  const pushRecent = (entry) => {
    const key = JSON.stringify(entry);
    recentSearches = recentSearches.filter(r => JSON.stringify(r) !== key);
    recentSearches.unshift(entry);
    recentSearches = recentSearches.slice(0, 5);
    renderRecentChips();
  };
  document.getElementById('btn-clear-recent').addEventListener('click', () => {
    recentSearches = [];
    renderRecentChips();
  });

  // ── 13-2. 고객유형(업종) — 마케팅 신업종 연쇄 드롭다운 ─────────────
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

  // ── 13-3. 필터 초기화 / 적용 (지역선택 + 고객유형 + 매출구간 통합) ──
  document.getElementById('btn-reset-filter').addEventListener('click', () => {
    // 고객유형·매출구간 폼 리셋
    typeL1.value = ''; resetSelect(typeL2,'중분류'); resetSelect(typeL3,'소분류'); resetSelect(typeL4,'세분류');
    document.getElementById('filter-revenue').value = '';
    // 지역선택 폼 리셋 — 폼만 비움(적용값은 유지, phase1 동작 승계). 적용값을 지우려면 메인의 "지역 해제 ✕" 사용
    sidoSel.value = '';
    resetSigungu();
    renderDongPanel('', '');
  });
  document.getElementById('btn-apply-filter').addEventListener('click', () => {
    // 지역선택을 filterState에 반영 — 지역을 고르면 지사 필터 무시하고 그 지역 전체 조회(getFilteredList)
    const sido = sidoSel.value;
    const gu = sigunguSel.value;
    let dongs = [...dongPanel.querySelectorAll('input.dong-cb:checked')].map(c => c.value);
    // 구/군까지만 골랐으면 "그 구/군 전체"로 간주 (하위 미선택 = 상위 전체)
    if (!dongs.length && sido && gu) dongs = (BJD_TREE[sido][gu] || []).slice();

    filterState.regionSido = sido;
    filterState.regionDongs = dongs;
    if (regionActive()) pushRecent({ sido, sigungu: gu, dongs });

    updateAppliedRegionRow();
    updateFilterBtnActive();
    if (nearbyMode) exitNearbyMode(false);
    navigateTo('screen-main');
    onFilterChange();
  });

  renderRecentChips();


  // ══════════════════════════════════════════════════════
  // 14. 초기화 — 로그인 사용자 정보 반영(디폴트 지역 = 담당 지사)
  // ══════════════════════════════════════════════════════
  document.getElementById('user-info-name').textContent = CURRENT_USER.name;
  document.getElementById('user-info-branch').textContent = CURRENT_USER.branch;

  updateBranchTriggerLabel();
  renderIndustryTabs();
  renderPeriodChips();
  updateKeywordClearBtn();
  updateAppliedRegionRow();
  updateFilterBtnActive();
  renderMainList();
  window.addEventListener('load', () => setTimeout(initMainMap, 300));

});
