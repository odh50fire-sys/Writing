/**
 * 동도 롸이팅 마스터 - 프론트엔드 인터랙션 스크립트
 */

let state = {
  activeUserId: "minho",
  users: [],
  userData: null,
  catalog: [],
  currentTextbookId: "ybm_park_grade1",
  activeTrack: "track1",
  currentUnit: 1,
  currentRoutine: null,
  currentStep: 1,
  stepSubIndex: 0,
  stepAnswers: { 1: {}, 2: {}, 3: {}, 4: {} },
  stepGrades: { 1: {}, 2: {}, 3: {}, 4: {} },
  timerSeconds: 30 * 60,
  timerRunning: false,
  timerInterval: null,
  radarChartInstance: null,
  currentView: "view-auth",
  onboardingStep: 1,
  onboardingReviewMode: false,
  onboardingScore: 0,
  onboardingRecLevel: 1,
  onboardingSelectedLevel: 1,
  onboardingSelectedTextbook: "ybm_park_grade1",
  onboardingPlacementDone: false,
  currentOnboardingPlacementQuestions: []
};

// ==========================================
// Session Auto-Save & Recovery
// ==========================================
let saveSessionTimeout = null;

function triggerAutoSave() {
  clearTimeout(saveSessionTimeout);
  saveSessionTimeout = setTimeout(() => {
    saveSessionNow();
  }, 250);
}

function saveSessionNow() {
  if (!state.activeUserId) return;
  const sessionData = {
    userId: state.activeUserId,
    textbookId: state.currentTextbookId,
    unit: state.currentUnit,
    currentStep: state.currentStep,
    stepSubIndex: state.stepSubIndex,
    stepAnswers: state.stepAnswers,
    stepGrades: state.stepGrades,
    timerSeconds: state.timerSeconds,
    savedAt: Date.now()
  };

  try {
    // 1. 브라우저 localStorage 즉시 저장
    localStorage.setItem(`writing_session_${state.activeUserId}`, JSON.stringify(sessionData));
  } catch (e) {
    console.error("Local storage save error:", e);
  }

  // 2. 서버 백엔드 백업 저장
  fetch("/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: state.activeUserId, session: sessionData })
  }).catch(() => {});
}

async function restoreSavedSession() {
  if (!state.activeUserId) return false;
  let sessionData = null;

  // 1. 로컬스토리지 우선 확인
  try {
    const raw = localStorage.getItem(`writing_session_${state.activeUserId}`);
    if (raw) sessionData = JSON.parse(raw);
  } catch (e) {}

  // 2. 로컬에 없으면 서버 세션 확인
  if (!sessionData) {
    try {
      const res = await fetch(`/api/session?userId=${state.activeUserId}&_t=${Date.now()}`, { cache: "no-store" });
      sessionData = await res.json();
    } catch (e) {}
  }

  if (sessionData && sessionData.unit && (sessionData.stepAnswers || sessionData.stepGrades)) {
    state.currentTextbookId = sessionData.textbookId || state.currentTextbookId;
    state.currentUnit = sessionData.unit || 1;
    state.currentStep = sessionData.currentStep || 1;
    state.stepSubIndex = sessionData.stepSubIndex || 0;
    state.stepAnswers = sessionData.stepAnswers || { 1: {}, 2: {}, 3: {}, 4: {} };
    state.stepGrades = sessionData.stepGrades || { 1: {}, 2: {}, 3: {}, 4: {} };
    if (sessionData.timerSeconds !== undefined) {
      state.timerSeconds = sessionData.timerSeconds;
      updateTimerDisplay();
    }

    try {
      const res = await fetch(`/api/daily_routine?textbookId=${state.currentTextbookId}&unit=${state.currentUnit}`);
      state.currentRoutine = await res.json();

      document.getElementById("study-unit-title").textContent = state.currentRoutine.title;
      document.getElementById("study-target-grammar").textContent = `목표 문법: ${(state.currentRoutine.targetGrammar || []).join(" / ")}`;

      updateStepPills();
      renderCurrentStepProblem();

      // 이전 채점 결과 복원
      const currentGrade = state.stepGrades[state.currentStep] && state.stepGrades[state.currentStep][state.stepSubIndex];
      if (currentGrade) {
        showGradingResult(currentGrade);
      }

      showToast("이전에 작성 중이던 답안과 학습 내용이 복원되었습니다!", "💾");
      return true;
    } catch (err) {
      console.error("Failed to restore routine:", err);
    }
  }
  return false;
}

function clearCurrentSession() {
  if (!state.activeUserId) return;
  try {
    localStorage.removeItem(`writing_session_${state.activeUserId}`);
  } catch (e) {}
  fetch("/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: state.activeUserId, session: {} })
  }).catch(() => {});
}

// ==========================================
// Initialization
// ==========================================
document.addEventListener("DOMContentLoaded", async () => {
  await loadUsers();
  await loadCatalog();
  renderAuthUsersList();
  renderRadarChart();
  initTimer();
  showView("view-auth");
});

// ==========================================
// User Profile & Data Management
// ==========================================
async function loadUsers() {
  try {
    const res = await fetch(`/api/users?_t=${Date.now()}`, { cache: "no-store" });
    const data = await res.json();
    state.activeUserId = data.activeUserId || state.activeUserId || "minho";
    state.users = data.users || [];
    renderUsersUI();
  } catch (err) {
    console.error("Failed to load users:", err);
  }
}

async function loadUserData() {
  try {
    const res = await fetch(`/api/user/data?userId=${state.activeUserId}&_t=${Date.now()}`, { cache: "no-store" });
    const data = await res.json();
    state.userData = data;

    // Active Track 설정 및 연동
    const user = state.users.find(u => u.id === state.activeUserId);
    const savedTrack = (data.settings && data.settings.activeTrack);
    if (savedTrack) {
      state.activeTrack = savedTrack;
    } else if (data.stats && data.stats.level >= 7) {
      state.activeTrack = "track3";
    } else if (data.stats && data.stats.level >= 4) {
      state.activeTrack = "track2";
    } else if (user && user.grade === 3) {
      state.activeTrack = "track3";
    } else if (user && user.grade === 2) {
      state.activeTrack = "track2";
    } else {
      state.activeTrack = "track1";
    }

    // 트랙 및 선택된 교재 ID 자동 동기화 (저장된 교재 유지)
    const savedTextbookId = (data.settings && data.settings.currentTextbookId);
    if (savedTextbookId) {
      state.currentTextbookId = savedTextbookId;
    } else {
      const isKim = state.currentTextbookId && state.currentTextbookId.startsWith("ybm_kim");
      const prefix = isKim ? "ybm_kim" : "ybm_park";
      if (state.activeTrack === "track3") {
        state.currentTextbookId = `${prefix}_grade3`;
      } else if (state.activeTrack === "track2") {
        state.currentTextbookId = `${prefix}_grade2`;
      } else {
        state.currentTextbookId = `${prefix}_grade1`;
      }
    }

    renderUserStats();
    renderActiveTrackUI();
    await renderHomeUnitsUI();
    renderWrongNotes();
    renderEssays();
    updateRadarData();
  } catch (err) {
    console.error("Failed to load user data:", err);
  }
}

function renderUsersUI(highlightUserId = null) {
  const activeUser = state.users.find(u => u.id === state.activeUserId) || state.users[0];
  if (!activeUser) return;

  const headerAvatar = document.getElementById("header-avatar");
  if (headerAvatar) headerAvatar.textContent = activeUser.avatar || "🐧";
  const headerName = document.getElementById("header-user-name");
  if (headerName) headerName.textContent = activeUser.name;
  const heroName = document.getElementById("hero-user-name");
  if (heroName) heroName.textContent = (activeUser.name || "").split(" ")[0];

  const countBadge = document.getElementById("user-count-badge");
  if (countBadge) countBadge.textContent = `${state.users.length}명`;

  // Render Modal Users List
  const listEl = document.getElementById("modal-users-list");
  if (listEl) {
    const canDelete = state.users.length > 1;
    listEl.innerHTML = state.users.map(u => {
      const isSelected = u.id === state.activeUserId;
      const isHighlighted = u.id === highlightUserId;
      const safeName = (u.name || "").replace(/'/g, "\\'");
      return `
        <div id="user-item-${u.id}" class="flex items-center justify-between p-3 rounded-2xl border ${isSelected ? 'border-indigo-500 bg-indigo-50/70 shadow-xs' : 'border-gray-200 bg-white'} ${isHighlighted ? 'ring-2 ring-emerald-400 bg-emerald-50' : ''} hover:border-indigo-300 transition-all cursor-pointer group" onclick="selectUser('${u.id}')">
          <div class="flex items-center gap-3">
            <span class="text-2xl p-1 bg-white rounded-xl shadow-xs border border-gray-100">${u.avatar}</span>
            <div>
              <div class="text-xs font-bold text-gray-800 flex items-center gap-1.5">
                ${u.name}
                ${isHighlighted ? '<span class="px-1.5 py-0.5 bg-emerald-100 text-emerald-700 text-[9px] font-extrabold rounded-full animate-bounce">방금 추가됨!</span>' : ''}
              </div>
              <div class="text-[10px] text-gray-500">대구 동도중학교 (${u.grade}학년) · ID: ${u.id}</div>
            </div>
          </div>
          <div class="flex items-center gap-2">
            ${isSelected ? '<span class="text-xs text-indigo-600 font-bold bg-indigo-100/70 px-2 py-0.5 rounded-full">✓ 현재 선택됨</span>' : '<span class="text-[11px] text-gray-400 hover:text-indigo-600 font-medium">선택</span>'}
            ${canDelete ? `
              <button onclick="event.stopPropagation(); deleteUser('${u.id}', '${safeName}')" class="p-1.5 text-gray-300 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all text-xs" title="'${u.name}' 학생 삭제">
                🗑️
              </button>
            ` : ''}
          </div>
        </div>
      `;
    }).join("");

    if (highlightUserId) {
      setTimeout(() => {
        const itemEl = document.getElementById(`user-item-${highlightUserId}`);
        if (itemEl) {
          itemEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      }, 60);
    }
  }
}

async function deleteUser(userId, userName) {
  if (state.users.length <= 1) {
    alert("최소 한 명의 사용자 프로필은 유지되어야 합니다.");
    return;
  }

  const ok = confirm(`정말로 '${userName}' 학생의 프로필과 모든 학습 데이터를 삭제하시겠습니까?\n(삭제된 데이터는 복구할 수 없습니다.)`);
  if (!ok) return;

  try {
    const res = await fetch("/api/users/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId })
    });
    const data = await res.json();
    if (data.success) {
      state.users = data.users || state.users.filter(u => u.id !== userId);
      if (data.activeUserId) {
        state.activeUserId = data.activeUserId;
      } else if (state.users.length > 0) {
        state.activeUserId = state.users[0].id;
      }
      
      if (state.selectedAuthUserId === userId || !state.users.find(u => u.id === state.selectedAuthUserId)) {
        state.selectedAuthUserId = state.users[0] ? state.users[0].id : null;
      }

      // Re-render index page auth list, dropdown, and in-app users list immediately
      renderAuthUsersList();
      renderUsersUI();

      if (state.activeUserId) {
        await loadUserData();
        await restoreSavedSession();
      }
      showToast(`🗑️ '${userName}' 학생 프로필이 삭제되었습니다.`, "🗑️");
    } else {
      alert(data.message || "삭제 실패");
    }
  } catch (err) {
    console.error("Failed to delete user:", err);
  }
}

function renderUserStats() {
  if (!state.userData || !state.userData.stats) return;
  const stats = state.userData.stats;
  const settings = state.userData.settings || {};

  document.getElementById("header-streak").textContent = stats.streakDays || 1;
  
  // Flawless Streak (무감점 콤보)
  const flawless = stats.flawlessStreak || 0;
  const flawlessEl = document.getElementById("header-flawless");
  const flawlessCont = document.getElementById("header-flawless-container");
  if (flawlessEl) flawlessEl.textContent = flawless;
  if (flawlessCont) {
    if (flawless > 0) {
      flawlessCont.classList.remove("hidden");
    } else {
      flawlessCont.classList.add("hidden");
    }
  }

  const recBadge = (stats.recommendedLevel && stats.recommendedLevel > (stats.level || 1))
    ? ` <span class="ml-1 text-[10px] text-amber-700 bg-amber-100/90 px-1.5 py-0.5 rounded-md font-bold" title="3분 진단평가 권장 실력">권장 Lv.${stats.recommendedLevel}</span>`
    : "";
  const headerLvlEl = document.getElementById("header-user-level");
  if (headerLvlEl) headerLvlEl.innerHTML = `Lv.${stats.level || 1} ${stats.levelTitle || '새싹'}${recBadge}`;
  const statLvlEl = document.getElementById("stat-level-title");
  if (statLvlEl) statLvlEl.innerHTML = `Lv.${stats.level || 1} ${stats.levelTitle || '새싹'}${recBadge}`;
  document.getElementById("stat-completed-count").textContent = `${stats.completedProblemsCount || 0}문항`;
  document.getElementById("stat-target-time").textContent = `${settings.dailyTargetMinutes || 30}분`;

  const wrongCount = (state.userData.wrongNotes || []).filter(w => !w.resolved).length;
  document.getElementById("stat-wrong-count").textContent = `${wrongCount}개 대기`;
  document.getElementById("wrong-total-badge").textContent = `${wrongCount}문항 대기`;

  // Report Level Bar
  const exp = stats.exp || 0;
  const nextExp = stats.nextLevelExp || 150;
  const pct = Math.min(100, Math.round((exp / nextExp) * 100));
  document.getElementById("report-exp-text").textContent = `${exp} / ${nextExp} EXP`;
  document.getElementById("report-exp-bar").style.width = `${pct}%`;

  // Badges Grid
  const badgesGrid = document.getElementById("badges-grid");
  if (badgesGrid && stats.badges) {
    badgesGrid.innerHTML = stats.badges.map(b => `
      <div class="p-3 rounded-2xl border ${b.unlocked ? 'border-amber-200 bg-amber-50/50' : 'border-gray-200 bg-gray-50 opacity-50'} flex items-center gap-3">
        <span class="text-2xl">${b.icon}</span>
        <div>
          <div class="text-xs font-bold ${b.unlocked ? 'text-amber-900' : 'text-gray-400'}">${b.name}</div>
          <div class="text-[10px] ${b.unlocked ? 'text-amber-700' : 'text-gray-400'}">${b.desc}</div>
        </div>
      </div>
    `).join("");
  }
}

async function selectUser(userId) {
  try {
    const res = await fetch("/api/users/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId })
    });
    const data = await res.json();
    state.activeUserId = userId;
    if (data.users) {
      state.users = data.users;
    }
    renderUsersUI();
    closeUserModal();
    await loadUserData();
    await restoreSavedSession();
    showToast(`'${state.users.find(u => u.id === userId)?.name || userId}' 학생 프로필로 전환되었습니다!`);
  } catch (err) {
    console.error("Failed to switch user:", err);
  }
}

async function addNewUser() {
  closeUserModal();
  logoutToAuthScreen(true);
  showToast("신규 학생 등록은 로그아웃 후 첫 화면(인덱스 페이지)에서만 가능합니다.", "🔒");
}

// ==========================================
// Catalog & Textbook Management (Multi-Curriculum & Custom Explanations)
// ==========================================
const CATALOG_CATEGORIES = [
  { id: "all", name: "전체 보기 (11종)" },
  { id: "dongdo", name: "🏫 동도중 맞춤 (3종)" },
  { id: "revision", name: "✨ 2022 개정 최신 (3종)" },
  { id: "killer", name: "🔥 수성구 1등급 킬러 (2종)" },
  { id: "nationwide", name: "🌐 전국 최다 채택 (2종)" },
  { id: "official", name: "🏛️ 교육부 공인 루브릭 (1종)" }
];

async function loadCatalog() {
  try {
    const res = await fetch("/api/catalog");
    const data = await res.json();
    state.catalog = data.textbooks || [];
    renderCatalogCategoryFilters();
    renderCatalogUI();
  } catch (err) {
    console.error("Failed to load catalog:", err);
  }
}

function setCatalogCategoryFilter(catId) {
  state.catalogCategory = catId;
  renderCatalogCategoryFilters();
  renderCatalogUI();
}

function renderCatalogCategoryFilters() {
  const container = document.getElementById("catalog-category-filters");
  if (!container) return;

  const currentCat = state.catalogCategory || "all";
  container.innerHTML = CATALOG_CATEGORIES.map(cat => {
    const isActive = cat.id === currentCat;
    return `
      <button onclick="setCatalogCategoryFilter('${cat.id}')" class="px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${isActive ? 'bg-indigo-600 text-white shadow-sm ring-2 ring-indigo-300' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'}">
        ${cat.name}
      </button>
    `;
  }).join("");
}

function renderCatalogUI() {
  const catalogList = document.getElementById("catalog-list");
  if (!catalogList) return;

  const currentCat = state.catalogCategory || "all";
  const filtered = (currentCat === "all")
    ? state.catalog
    : state.catalog.filter(t => t.category === currentCat);

  const countBadge = document.getElementById("catalog-count-badge");
  if (countBadge) {
    countBadge.textContent = `${filtered.length}종 표시 중 (총 ${state.catalog.length}종)`;
  }

  catalogList.innerHTML = filtered.map(tb => {
    const isCurrent = tb.id === state.currentTextbookId;
    return `
      <div class="p-5 rounded-3xl border-2 ${isCurrent ? 'border-indigo-600 bg-indigo-50/40 shadow-md ring-2 ring-indigo-200/60' : 'border-gray-200 bg-white hover:border-indigo-300'} hover:shadow-lg transition-all flex flex-col justify-between space-y-4">
        <div class="space-y-3">
          <div class="flex items-center justify-between gap-1 flex-wrap">
            <span class="text-[11px] font-black text-indigo-700 bg-indigo-50 px-2.5 py-1 rounded-full border border-indigo-200">
              ${tb.categoryBadge || tb.edition}
            </span>
            <span class="text-xs text-gray-500 font-semibold bg-gray-50 px-2 py-0.5 rounded-md border border-gray-100">
              ${tb.grade ? tb.grade + '학년' : '전 학년'} · 총 ${tb.unitsCount || 4}개 단원
            </span>
          </div>

          <h4 class="font-black text-gray-900 text-base leading-snug">${tb.title}</h4>

          <!-- 학습자 상황 맞춤 추천 및 설명 박스 -->
          <div class="p-3 rounded-2xl bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200/90 space-y-1.5 text-xs">
            <div class="font-extrabold text-amber-950 flex items-start gap-1">
              <span class="text-amber-600 flex-shrink-0">🎯</span>
              <span>추천 대상: ${tb.fitFor}</span>
            </div>
            <p class="text-[11px] text-amber-900/90 leading-relaxed font-medium pl-4">
              ${tb.fitForExplanation}
            </p>
          </div>

          <p class="text-xs text-gray-600 leading-relaxed pl-0.5">
            ${tb.description}
          </p>
        </div>

        <div class="pt-2 border-t border-gray-100">
          ${isCurrent ? `
            <button class="w-full py-2.5 bg-indigo-600 text-white font-extrabold rounded-xl text-xs shadow-md flex items-center justify-center gap-1.5 cursor-default">
              <span>✓</span> 현재 학습 중인 교재
            </button>
          ` : `
            <button onclick="selectTextbook('${tb.id}')" class="w-full py-2.5 bg-white hover:bg-indigo-600 hover:text-white border-2 border-indigo-200 hover:border-indigo-600 text-indigo-700 font-extrabold rounded-xl text-xs transition-all shadow-2xs flex items-center justify-center gap-1">
              <span>이 교재로 공부하기</span> <span>➔</span>
            </button>
          `}
        </div>
      </div>
    `;
  }).join("");
}

async function selectTextbook(tbId) {
  state.currentTextbookId = tbId;
  if (tbId.includes("grade3") || tbId.includes("1001")) {
    state.activeTrack = "track3";
  } else if (tbId.includes("grade2") || tbId.includes("killer") || tbId.includes("yoon") || tbId.includes("lee") || tbId.includes("ebs")) {
    state.activeTrack = "track2";
  } else {
    state.activeTrack = "track1";
  }

  // 서버에 교재 선택 설정 저장
  try {
    const curSettings = (state.userData && state.userData.settings) || {};
    curSettings.currentTextbookId = tbId;
    curSettings.activeTrack = state.activeTrack;
    await fetch("/api/user/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: state.activeUserId, settings: curSettings })
    });
  } catch (err) {
    console.error("Failed to save textbook setting:", err);
  }

  renderCatalogUI();
  renderActiveTrackUI();
  await renderHomeUnitsUI();
  showToast("📚 교재가 선택되었습니다! 홈 화면과 데일리 학습실에서 단원을 확인하세요!", "✨");
}

// ==========================================
// Difficulty Track & Dynamic Unit Picker
// ==========================================
function renderActiveTrackUI() {
  const track1Btn = document.getElementById("track-btn-track1");
  const track2Btn = document.getElementById("track-btn-track2");
  const track3Btn = document.getElementById("track-btn-track3");
  const badge = document.getElementById("active-track-badge");

  [track1Btn, track2Btn, track3Btn].forEach(b => {
    if (b) {
      b.className = "p-4 rounded-2xl border border-gray-200 bg-white cursor-pointer transition-all hover:shadow-md space-y-2 relative";
    }
  });

  if (state.activeTrack === "track1") {
    if (track1Btn) {
      track1Btn.className = "p-4 rounded-2xl border-2 border-indigo-500 bg-indigo-50/50 cursor-pointer transition-all hover:shadow-md space-y-2 relative shadow-xs";
    }
    if (badge) {
      badge.textContent = "중1 기초 완성";
      badge.className = "text-xs px-2.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700 font-bold";
    }
  } else if (state.activeTrack === "track2") {
    if (track2Btn) {
      track2Btn.className = "p-4 rounded-2xl border-2 border-purple-500 bg-purple-50/50 cursor-pointer transition-all hover:shadow-md space-y-2 relative shadow-xs";
    }
    if (badge) {
      badge.textContent = "중2 실전 서술형";
      badge.className = "text-xs px-2.5 py-0.5 rounded-full bg-purple-100 text-purple-700 font-bold";
    }
  } else if (state.activeTrack === "track3") {
    if (track3Btn) {
      track3Btn.className = "p-4 rounded-2xl border-2 border-amber-500 bg-amber-50/50 cursor-pointer transition-all hover:shadow-md space-y-2 relative shadow-xs";
    }
    if (badge) {
      badge.textContent = "중3·수성구 킬러 심화";
      badge.className = "text-xs px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 font-bold";
    }
  }
}

async function switchDifficultyTrack(trackId) {
  state.activeTrack = trackId;
  const isKim = state.currentTextbookId && state.currentTextbookId.startsWith("ybm_kim");
  const prefix = isKim ? "ybm_kim" : "ybm_park";

  if (trackId === "track3") {
    state.currentTextbookId = `${prefix}_grade3`;
  } else if (trackId === "track2") {
    state.currentTextbookId = `${prefix}_grade2`;
  } else {
    state.currentTextbookId = `${prefix}_grade1`;
  }

  renderActiveTrackUI();
  await renderHomeUnitsUI();
  renderCatalogUI();

  try {
    const curSettings = (state.userData && state.userData.settings) || {};
    curSettings.activeTrack = trackId;
    await fetch("/api/user/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: state.activeUserId, settings: curSettings })
    });
  } catch (err) {
    console.error("Failed to save track setting:", err);
  }

  const trackNames = { track1: "중1 기초 완성", track2: "중2 실전 서술형", track3: "중3·수성구 킬러 심화" };
  showToast(`🎯 '${trackNames[trackId]}' 트랙으로 변경되었습니다!`);
}

let currentTbCache = {};

async function renderHomeUnitsUI() {
  const grid = document.getElementById("home-units-grid");
  const allUnitsList = document.getElementById("all-units-list");
  const titleEl = document.getElementById("home-curriculum-title");
  const subEl = document.getElementById("home-curriculum-subtitle");
  if (!grid) return;

  const tbId = state.currentTextbookId || "ybm_park_grade1";
  let tbData = currentTbCache[tbId];
  if (!tbData) {
    try {
      const res = await fetch(`/api/textbook?id=${tbId}`);
      tbData = await res.json();
      currentTbCache[tbId] = tbData;
    } catch (e) {
      console.error(e);
      return;
    }
  }

  if (titleEl) titleEl.textContent = `${tbData.title || "교과서"} 추천 단원`;
  if (subEl) subEl.textContent = `${tbData.targetSchool ? tbData.targetSchool + " 맞춤 · " : ""}총 ${tbData.units?.length || 8}개 단원 구성`;

  const units = tbData.units || [];
  if (units.length === 0) return;

  const u1 = units[0];
  const u2 = units[1] || units[0];

  grid.innerHTML = `
    <div class="p-4 rounded-2xl border-2 border-indigo-500/40 bg-indigo-50/40 flex items-center justify-between hover:shadow-md transition-all">
      <div class="space-y-1 pr-2">
        <span class="text-[11px] font-bold text-indigo-600 bg-white px-2 py-0.5 rounded-full border border-indigo-100">추천 1순위</span>
        <h4 class="font-extrabold text-gray-900 text-sm">${u1.title}</h4>
        <p class="text-xs text-gray-600 line-clamp-1">핵심: ${(u1.targetGrammar || []).join(", ")}</p>
      </div>
      <button onclick="loadAndStartUnit(${u1.unit})" class="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs transition-all shadow-sm flex-shrink-0">
        시작하기
      </button>
    </div>
    <div class="p-4 rounded-2xl border border-gray-200 bg-gray-50/60 flex items-center justify-between hover:shadow-md transition-all">
      <div class="space-y-1 pr-2">
        <span class="text-[11px] font-bold text-gray-500 bg-white px-2 py-0.5 rounded-full border border-gray-200">후속 단원</span>
        <h4 class="font-extrabold text-gray-800 text-sm">${u2.title}</h4>
        <p class="text-xs text-gray-600 line-clamp-1">핵심: ${(u2.targetGrammar || []).join(", ")}</p>
      </div>
      <button onclick="loadAndStartUnit(${u2.unit})" class="px-4 py-2.5 bg-white hover:bg-gray-100 border border-gray-300 text-gray-700 font-bold rounded-xl text-xs transition-all shadow-2xs flex-shrink-0">
        선택하기
      </button>
    </div>
  `;

  if (allUnitsList) {
    allUnitsList.innerHTML = units.map(u => `
      <div class="p-3.5 rounded-xl border border-gray-200 bg-white hover:border-indigo-300 hover:shadow-xs transition-all flex flex-col justify-between space-y-2">
        <div>
          <div class="flex items-center justify-between mb-1">
            <span class="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md">단원 ${u.unit}</span>
            <span class="text-[10px] text-gray-400 font-medium">${u.topic || ''}</span>
          </div>
          <h5 class="text-xs font-bold text-gray-800 leading-snug">${u.title}</h5>
          <p class="text-[11px] text-gray-500 mt-1 line-clamp-1">${(u.targetGrammar || []).join(" · ")}</p>
        </div>
        <button onclick="loadAndStartUnit(${u.unit})" class="w-full py-1.5 bg-gray-50 hover:bg-indigo-600 hover:text-white border border-gray-200 hover:border-indigo-600 text-gray-700 text-[11px] font-bold rounded-lg transition-all">
          이 단원 풀기 ▶
        </button>
      </div>
    `).join("");
  }
}

function toggleAllUnitsView() {
  const container = document.getElementById("all-units-container");
  const btn = document.getElementById("toggle-units-btn");
  if (!container) return;
  const isHidden = container.classList.contains("hidden");
  if (isHidden) {
    container.classList.remove("hidden");
    if (btn) btn.innerHTML = `<span>▲</span> 단원 목록 접기`;
  } else {
    container.classList.add("hidden");
    if (btn) btn.innerHTML = `<span>📂</span> 전체 단원 펼쳐보기`;
  }
}

// ==========================================
// Daily Routine Study System (30 Minutes)
// ==========================================
function startDailyRoutine() {
  switchTab("tab-study");
  if (!state.currentRoutine || state.currentRoutine.unit !== (state.currentUnit || 1)) {
    loadAndStartUnit(state.currentUnit || 1);
  } else {
    updateStepPills();
    renderCurrentStepProblem();
    startTimer();
  }
}

async function loadAndStartUnit(unitNum) {
  state.currentUnit = unitNum;
  state.currentStep = 1;
  state.stepSubIndex = 0;
  state.stepAnswers = { 1: {}, 2: {}, 3: {}, 4: {} };
  state.stepGrades = { 1: {}, 2: {}, 3: {}, 4: {} };

  try {
    const res = await fetch(`/api/daily_routine?textbookId=${state.currentTextbookId}&unit=${unitNum}`);
    const routine = await res.json();
    state.currentRoutine = routine;

    document.getElementById("study-unit-title").textContent = routine.title;
    document.getElementById("study-target-grammar").textContent = `목표 문법: ${(routine.targetGrammar || []).join(" / ")}`;

    updateStepPills();
    renderCurrentStepProblem();
    switchTab("tab-study");
    startTimer();
  } catch (err) {
    console.error("Failed to load routine:", err);
  }
}

function updateStepPills() {
  for (let i = 1; i <= 4; i++) {
    const pill = document.getElementById(`step-pill-${i}`);
    if (!pill) continue;
    pill.classList.remove("active-step", "completed-step", "bg-white");
    if (i === state.currentStep) {
      pill.classList.add("active-step");
    } else if (i < state.currentStep) {
      pill.classList.add("completed-step");
    } else {
      pill.classList.add("bg-white");
    }
  }
}

function jumpToStep(stepNumber) {
  if (stepNumber < 1 || stepNumber > 4) return;
  state.currentStep = stepNumber;
  state.stepSubIndex = 0;
  updateStepPills();
  renderCurrentStepProblem();
  if (typeof saveSessionNow === "function") {
    saveSessionNow();
  }
}

function renderCurrentStepProblem() {
  const container = document.getElementById("problem-card");
  const resultPanel = document.getElementById("grade-result-panel");
  resultPanel.classList.add("hidden");

  if (!state.currentRoutine) {
    container.innerHTML = `<div class="text-center py-12 text-gray-400">문제를 불러오는 중입니다...</div>`;
    return;
  }

  // Step 1: Warmup
  if (state.currentStep === 1) {
    const warmupList = state.currentRoutine.step1_warmup || [];
    const item = warmupList[state.stepSubIndex] || warmupList[0];
    if (!item) {
      container.innerHTML = `<div>Step 1 문제가 없습니다.</div>`;
      return;
    }
    const savedAns = state.stepAnswers[1][state.stepSubIndex] || "";

    container.innerHTML = `
      <div class="space-y-4">
        <div class="flex items-center justify-between border-b pb-3">
          <span class="text-xs font-bold text-indigo-600 bg-indigo-50 px-3 py-1 rounded-full">Step 1. 기초 문형 다지기 (${state.stepSubIndex + 1} / ${warmupList.length})</span>
          <span class="text-xs text-gray-400 font-medium">배점: 100점</span>
        </div>
        <div class="text-base sm:text-lg font-bold text-gray-800 leading-relaxed">
          ${item.question}
        </div>
        <div class="space-y-2">
          <label class="text-xs font-bold text-gray-600">답안 작성란 (Enter 키로 제출 가능):</label>
          <input type="text" id="input-answer" value="${savedAns}" oninput="state.stepAnswers[1][state.stepSubIndex] = this.value; triggerAutoSave();" onkeydown="if(event.key==='Enter') submitStep1Answer()" placeholder="정답을 입력하세요..." class="w-full px-4 py-3 rounded-2xl border border-gray-300 focus:outline-indigo-500 font-medium text-sm">
        </div>
        <button onclick="submitStep1Answer()" class="w-full py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-2xl text-sm transition-all shadow-md shadow-indigo-100">
          채점 및 제출
        </button>
      </div>
    `;
    setTimeout(() => {
      const inputEl = document.getElementById("input-answer");
      if (inputEl) inputEl.focus();
    }, 50);
  }
  // Step 2: Type A Condition Writing
  else if (state.currentStep === 2) {
    const typeAList = state.currentRoutine.step2_typeA || [];
    const item = typeAList[state.stepSubIndex] || typeAList[0];
    if (!item) {
      container.innerHTML = `<div>Step 2 문제가 없습니다.</div>`;
      return;
    }
    const savedAns = state.stepAnswers[2][state.stepSubIndex] || "";

    container.innerHTML = `
      <div class="space-y-5">
        <div class="flex items-center justify-between border-b pb-3">
          <span class="text-xs font-bold text-indigo-600 bg-indigo-50 px-3 py-1 rounded-full">Step 2. 동도중 조건 제시형 영작 (${state.stepSubIndex + 1} / ${typeAList.length})</span>
          <span class="text-xs text-red-500 font-bold">★ 지필/수행 핵심 킬러</span>
        </div>
        <div>
          <div class="text-xs text-gray-400 font-bold mb-1">[우리말 해석]</div>
          <div class="text-base sm:text-lg font-bold text-gray-900">${item.korean}</div>
        </div>
        
        <!-- Conditions Box -->
        <div class="p-4 rounded-2xl bg-amber-50/60 border border-amber-200/80 space-y-2">
          <div class="text-xs font-bold text-amber-900 flex items-center gap-1.5">
            <span>⚠️</span> 필수 출제 조건 (미충족 시 감점)
          </div>
          <ul class="text-xs text-amber-800 space-y-1 list-disc list-inside">
            ${item.conditions.map(c => `<li>${c}</li>`).join("")}
          </ul>
        </div>

        <div class="space-y-2">
          <div class="flex items-center justify-between">
            <label class="text-xs font-bold text-gray-600">영작 답안 작성 (Ctrl + Enter로 제출 가능):</label>
            <span id="char-word-count" class="text-[11px] text-gray-400 font-medium">0 단어</span>
          </div>
          <textarea id="input-answer" rows="3" onkeydown="if(event.ctrlKey && event.key==='Enter') submitStep2Answer()" oninput="updateWordCount(this); state.stepAnswers[2][state.stepSubIndex] = this.value; triggerAutoSave();" placeholder="조건에 맞추어 완전한 영어 문장으로 작성하세요..." class="w-full px-4 py-3 rounded-2xl border border-gray-300 focus:outline-indigo-500 font-medium text-sm leading-relaxed">${savedAns}</textarea>
        </div>

        <button onclick="submitStep2Answer()" class="w-full py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-2xl text-sm transition-all shadow-md shadow-indigo-100">
          동도중 루브릭으로 즉시 채점하기
        </button>
      </div>
    `;
    setTimeout(() => {
      const el = document.getElementById("input-answer");
      if (el) {
        updateWordCount(el);
        el.focus();
      }
    }, 50);
  }
  // Step 3: Type B Error Hunting
  else if (state.currentStep === 3) {
    const typeBList = state.currentRoutine.step3_typeB || [];
    const item = typeBList[state.stepSubIndex] || typeBList[0];
    if (!item) {
      container.innerHTML = `<div>Step 3 문제가 없습니다.</div>`;
      return;
    }
    const savedAns = state.stepAnswers[3][state.stepSubIndex] || {};

    container.innerHTML = `
      <div class="space-y-5">
        <div class="flex items-center justify-between border-b pb-3">
          <span class="text-xs font-bold text-indigo-600 bg-indigo-50 px-3 py-1 rounded-full">Step 3. 오류 사냥 킬러 문항 (어법상 틀린 부분 수정)</span>
          <span class="text-xs text-purple-600 font-bold">오답률 1위 유형</span>
        </div>
        <div class="p-4 rounded-2xl bg-gray-50 border border-gray-200 text-sm sm:text-base leading-relaxed text-gray-800">
          ${item.passage}
        </div>
        <p class="text-xs text-gray-500">위 글에서 어법상 틀린 기호를 선택하고, 올바른 형태로 고쳐 쓰시오.</p>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div class="space-y-1">
            <label class="text-xs font-bold text-gray-600">틀린 부분 기호 (예: ⓐ 또는 a):</label>
            <input type="text" id="input-symbol" value="${savedAns.symbol || ''}" oninput="state.stepAnswers[3][state.stepSubIndex] = { symbol: this.value, correction: (document.getElementById('input-correction')||{}).value || '' }; triggerAutoSave();" onkeydown="if(event.key==='Enter') { const c = document.getElementById('input-correction'); if(c && !c.value.trim()){ c.focus(); } else { submitStep3Answer(); } }" placeholder="예: ⓐ 또는 a" class="w-full px-4 py-2.5 rounded-xl border border-gray-300 focus:outline-indigo-500 text-sm font-mono">
          </div>
          <div class="space-y-1">
            <label class="text-xs font-bold text-gray-600">올바르게 고친 형태:</label>
            <input type="text" id="input-correction" value="${savedAns.correction || ''}" oninput="state.stepAnswers[3][state.stepSubIndex] = { symbol: (document.getElementById('input-symbol')||{}).value || '', correction: this.value }; triggerAutoSave();" onkeydown="if(event.key==='Enter') submitStep3Answer()" placeholder="예: works" class="w-full px-4 py-2.5 rounded-xl border border-gray-300 focus:outline-indigo-500 text-sm font-mono">
          </div>
        </div>

        <button onclick="submitStep3Answer()" class="w-full py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-2xl text-sm transition-all shadow-md shadow-indigo-100">
          정답 확인 및 해설 보기
        </button>
      </div>
    `;
  }
  // Step 4: 학습 마무리 실전 Free 작문 & AI 코칭
  else if (state.currentStep === 4) {
    if (!state.currentFreeWritingTopic) {
      container.innerHTML = `
        <div class="text-center py-12 text-gray-500 space-y-3">
          <div class="text-4xl animate-bounce-slow">✨</div>
          <div class="text-sm font-bold text-gray-700">오늘의 학습 마무리 Free 영작 주제를 불러오는 중입니다...</div>
          <div class="text-xs text-indigo-500">교재 커리큘럼 및 창의 영작 풀에서 중복 없는 주제를 엄선합니다.</div>
        </div>
      `;
      loadFreeWritingTopic().then(() => renderCurrentStepProblem());
      return;
    }

    const topicData = state.currentFreeWritingTopic;
    const item = topicData.topic || {};
    const savedAns = (state.stepAnswers[4] && state.stepAnswers[4][0]) || "";

    container.innerHTML = `
      <div class="space-y-5 animate-fade-in">
        <!-- Step 4 Top Branding & Origin Badge -->
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b pb-3">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-xs font-black text-indigo-600 bg-indigo-50 px-3 py-1 rounded-full border border-indigo-200">
              Step 4. 학습 마무리 실전 Free 작문 & AI 코칭
            </span>
            <span class="text-xs px-2.5 py-0.5 rounded-full font-bold shadow-xs ${topicData.sourceType === 'random_pool' ? 'bg-amber-100 text-amber-900 border border-amber-300' : (topicData.sourceType === 'other_textbook' ? 'bg-purple-100 text-purple-900 border border-purple-300' : 'bg-emerald-100 text-emerald-900 border border-emerald-300')}">
              ${topicData.sourceBadge || '🏫 현재 교재 맞춤'}
            </span>
          </div>
          <button type="button" onclick="loadFreeWritingTopic(true)" class="text-xs px-3 py-1.5 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-900 font-bold border border-amber-300 transition-all flex items-center gap-1.5 self-start sm:self-auto cursor-pointer shadow-2xs" title="다른 교재나 풀에서 다른 주제를 추천받습니다">
            <span>🔄</span> <span>다른 주제 추천받기</span>
          </button>
        </div>

        <div>
          <div class="text-[11px] font-bold text-indigo-500 uppercase tracking-wide">Daily Finale Free Writing Topic</div>
          <h4 class="text-lg sm:text-xl font-black text-gray-900 mt-0.5">${item.title}</h4>
          <p class="text-xs sm:text-sm text-gray-700 mt-1 leading-relaxed bg-indigo-50/50 p-3.5 rounded-2xl border border-indigo-100/80">
            <strong class="text-indigo-900">🎯 작문 미션:</strong> ${item.prompt}
          </p>
        </div>

        <!-- Conditions Checklist -->
        <div class="p-4 rounded-2xl bg-amber-50/60 border border-amber-200/90 space-y-2">
          <div class="text-xs font-bold text-amber-950 flex items-center gap-1.5">
            <span>📋</span> 수행평가 감점 없는 작성 조건 가이드
          </div>
          <ul class="text-xs text-amber-900 space-y-1 list-disc list-inside">
            ${(item.conditions || []).map(c => `<li>${c}</li>`).join("")}
          </ul>
        </div>

        <!-- Live Writing Textarea -->
        <div class="space-y-2">
          <div class="flex items-center justify-between">
            <label class="text-xs font-bold text-gray-700 flex items-center gap-1.5">
              <span>✍️</span> <span>나만의 자유 에세이 작성:</span>
            </label>
            <div class="flex items-center gap-2">
              <span id="free-sentence-count" class="text-[11px] font-bold px-2 py-0.5 rounded-md bg-gray-100 text-gray-600">0문장</span>
              <span id="free-word-count" class="text-[11px] font-bold px-2.5 py-0.5 rounded-md bg-indigo-50 text-indigo-700 border border-indigo-200">0단어 (권장: 35~50단어)</span>
            </div>
          </div>
          <textarea id="input-answer" rows="6" oninput="updateFreeWritingStats(this); state.stepAnswers[4][0] = this.value; triggerAutoSave();" placeholder="자신의 생각과 표현을 자유롭게 영어 문장으로 완성해 보세요..." class="w-full px-4 py-3 rounded-2xl border-2 border-indigo-100 focus:border-indigo-500 focus:outline-none font-medium text-sm leading-relaxed shadow-xs transition-all">${savedAns}</textarea>
        </div>

        <button onclick="submitStep4Answer()" id="step4-submit-btn" class="w-full py-3.5 bg-gradient-to-r from-indigo-600 via-purple-600 to-indigo-700 hover:from-indigo-700 hover:to-purple-800 text-white font-black rounded-2xl text-sm transition-all shadow-lg shadow-indigo-200 transform hover:-translate-y-0.5 active:translate-y-0 flex items-center justify-center gap-2 cursor-pointer">
          <span>🚀</span> <span>AI 작문 스킬 정밀 평가 & 피드백 받기</span>
        </button>
      </div>
    `;

    setTimeout(() => {
      const el = document.getElementById("input-answer");
      if (el) {
        updateFreeWritingStats(el);
        el.focus();
      }
    }, 60);
  }

  // 이전에 이미 채점한 결과가 있다면 자동으로 채점 패널 복원
  const currentGrade = state.stepGrades[state.currentStep] && state.stepGrades[state.currentStep][state.stepSubIndex];
  if (currentGrade) {
    showGradingResult(currentGrade);
  }
  updateNavigationButtons();
}

function updateNavigationButtons() {
  const prevBtn = document.getElementById("prev-step-btn");
  const nextBtn = document.getElementById("next-step-btn");
  if (!prevBtn || !nextBtn) return;

  const currentListLen = getStepListLength(state.currentStep);

  // 이전 버튼 처리
  if (state.currentStep === 1 && state.stepSubIndex === 0) {
    prevBtn.disabled = true;
    prevBtn.classList.add("opacity-40", "cursor-not-allowed");
    prevBtn.innerHTML = `<span>◀</span> 이전 단계`;
  } else {
    prevBtn.disabled = false;
    prevBtn.classList.remove("opacity-40", "cursor-not-allowed");
    if (state.stepSubIndex > 0) {
      prevBtn.innerHTML = `<span>◀</span> 이전 문항`;
    } else {
      prevBtn.innerHTML = `<span>◀</span> 이전 Step ${state.currentStep - 1}`;
    }
  }

  // 다음 버튼 처리
  if (state.stepSubIndex < currentListLen - 1) {
    nextBtn.innerHTML = `다음 문항 (${state.stepSubIndex + 2} / ${currentListLen}) <span>▶</span>`;
  } else if (state.currentStep < 4) {
    nextBtn.innerHTML = `다음 Step ${state.currentStep + 1}로 이동 <span>▶</span>`;
  } else {
    nextBtn.innerHTML = `루틴 완료 및 저장 <span>▶</span>`;
  }
}

function updateWordCount(textarea) {
  const text = textarea.value.trim();
  const words = text ? text.split(/\s+/).length : 0;
  const countEl = document.getElementById("char-word-count");
  if (countEl) {
    countEl.textContent = `${words} 단어 (${text.length}자)`;
  }
}

// ==========================================
// Step Answer Grading Handlers
// ==========================================
function normalizeAnswerText(str) {
  if (!str) return "";
  return str.trim().toLowerCase()
    .replace(/[’‘]/g, "'") // 스마트 따옴표를 표준 아포스트로피로 통일
    .replace(/\s+/g, " "); // 다중 공백 단일화
}

function checkWarmupAnswer(userAns, correctAns, alternatives = []) {
  if (!userAns) return false;

  function clean(str) {
    if (!str) return "";
    return str.trim().toLowerCase()
      .replace(/[’‘]/g, "'")
      .replace(/[.!?]+$/, "") // 문장 끝 구두점 제거하여 유연 비교
      .replace(/[,]/g, " ")   // 콤마 제거 및 공백화
      .replace(/\s+/g, " ")
      .trim();
  }

  function expand(str) {
    let s = clean(str);
    const contractions = [
      ["doesn't", "does not"],
      ["don't", "do not"],
      ["didn't", "did not"],
      ["can't", "cannot"],
      ["can't", "can not"],
      ["isn't", "is not"],
      ["aren't", "are not"],
      ["wasn't", "was not"],
      ["weren't", "were not"],
      ["i'm", "i am"],
      ["he's", "he is"],
      ["she's", "she is"],
      ["it's", "it is"],
      ["we're", "we are"],
      ["they're", "they are"],
      ["there's", "there is"]
    ];
    for (const [sh, lg] of contractions) {
      const reg = new RegExp(`\\b${sh}\\b`, 'g');
      s = s.replace(reg, lg);
    }
    return s;
  }

  const uRaw = clean(userAns);
  const cRaw = clean(correctAns);
  const uExp = expand(userAns);
  const cExp = expand(correctAns);

  if (uRaw === cRaw || uExp === cExp) return true;

  // 복수 정답 목록 비교
  for (const alt of alternatives) {
    if (uRaw === clean(alt) || uExp === expand(alt)) return true;
  }

  // 콤마 열거형 단어 목록 일치 검사 (예: "went, saw" vs "went saw" vs "saw, went")
  const uWords = uExp.replace(/\band\b/g, "").split(" ").filter(Boolean).sort().join(" ");
  const cWords = cExp.replace(/\band\b/g, "").split(" ").filter(Boolean).sort().join(" ");
  if (uWords && cWords && uWords === cWords) return true;

  // 부사 위치 어순 유연성 (예: "Listen carefully to the teacher" vs "Listen to the teacher carefully")
  if (cExp.includes("listen") && cExp.includes("carefully") && cExp.includes("teacher")) {
    if (uExp.includes("listen") && uExp.includes("carefully") && uExp.includes("teacher")) {
      return true;
    }
  }

  // 관계대명사 호환 (who/which <-> that)
  if ((cRaw === "who" || cRaw === "which") && uRaw === "that") return true;
  if (cRaw === "that" && (uRaw === "who" || uRaw === "which")) return true;

  return false;
}

function checkTypeBCorrection(userCorrection, item) {
  if (!userCorrection || !item) return false;

  const userClean = normalizeAnswerText(userCorrection).replace(/[.!?]+$/, "").trim();
  const corrClean = normalizeAnswerText(item.correction).replace(/[.!?]+$/, "").trim();
  const alts = (item.alternativeCorrections || []).map(a => normalizeAnswerText(a).replace(/[.!?]+$/, "").trim());

  // 1. 직접 또는 정규화 일치
  if (checkWarmupAnswer(userClean, corrClean, alts)) {
    return true;
  }

  // 2. 부분 일치 (학생이 "ⓐ -> works" 또는 "works." 형태로 적은 경우)
  if (userClean.includes(corrClean)) {
    return true;
  }
  for (const a of alts) {
    if (a && userClean.includes(a)) return true;
  }

  // 3. 핵심 단어 포함 (예: 'doesn't drink' 중 핵심 'drink'만 적거나, 'smells sweet' 중 'sweet'만 적은 경우)
  if (corrClean.includes(userClean) && userClean.length >= 3) {
    return true;
  }

  return false;
}

function submitStep1Answer() {
  const warmupList = state.currentRoutine.step1_warmup || [];
  const item = warmupList[state.stepSubIndex];
  if (!item) return;

  const inputEl = document.getElementById("input-answer");
  const userAns = inputEl ? inputEl.value.trim() : "";
  state.stepAnswers[1][state.stepSubIndex] = userAns;

  const passed = checkWarmupAnswer(userAns, item.answer);
  const score = passed ? 100 : 0;

  const gradeResult = {
    score: score,
    passed: passed,
    deductions: passed ? ["감점 요인 없음 (정답)"] : [`정답 불일치: 입력값 '${userAns}' vs 정답 '${item.answer}' (-100점)`],
    sampleAnswer: item.answer,
    feedback: passed ? "🎉 정답입니다! 아주 훌륭한 문법 감각이에요." : `💡 아쉬워요! 해설: ${item.explanation}`
  };

  state.stepGrades[1][state.stepSubIndex] = gradeResult;
  saveSessionNow();

  if (passed) {
    triggerConfetti();
  }

  showGradingResult(gradeResult);
}

async function submitStep2Answer() {
  const typeAList = state.currentRoutine.step2_typeA || [];
  const item = typeAList[state.stepSubIndex];
  if (!item) return;

  const inputEl = document.getElementById("input-answer");
  const userAns = inputEl ? inputEl.value.trim() : "";
  state.stepAnswers[2][state.stepSubIndex] = userAns;

  const btn = document.querySelector("#problem-card button");
  const originalText = btn ? btn.innerHTML : "";
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span>⏳ 동도중 루브릭 정밀 채점 중...</span>`;
  }

  try {
    const res = await fetch("/api/grade", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "typeA",
        studentAnswer: userAns,
        sampleAnswer: item.sampleAnswer,
        conditions: item.conditions,
        requiredWords: item.requiredWords,
        targetWordCount: item.targetWordCount
      })
    });
    const gradeResult = await res.json();
    state.stepGrades[2][state.stepSubIndex] = gradeResult;
    saveSessionNow();

    if (gradeResult.passed) {
      triggerConfetti();
    }

    showGradingResult(gradeResult);
  } catch (err) {
    console.error("Grading failed:", err);
    showToast("채점 서버 통신 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.", "❌");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  }
}

function normalizeSymbol(sym) {
  if (!sym) return "";
  let s = String(sym).trim();
  // 특수 원문자 사전 매핑
  const map = {
    'ⓐ': 'a', 'ⓑ': 'b', 'ⓒ': 'c', 'ⓓ': 'd', 'ⓔ': 'e',
    '⒜': 'a', '⒝': 'b', '⒞': 'c', '⒟': 'd', '⒠': 'e',
    '①': '1', '②': '2', '③': '3', '④': '4', '⑤': '5'
  };
  for (const [k, v] of Object.entries(map)) {
    if (s.includes(k)) return v;
  }
  // 유니코드 NFKD 정규화 (원문자 분해)
  try {
    s = s.normalize("NFKD");
  } catch (e) {}
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function submitStep3Answer() {
  const typeBList = state.currentRoutine.step3_typeB || [];
  const item = typeBList[state.stepSubIndex];
  if (!item) return;

  const symbolEl = document.getElementById("input-symbol");
  const correctionEl = document.getElementById("input-correction");
  const userSymbol = symbolEl ? symbolEl.value.trim() : "";
  const userCorrection = correctionEl ? correctionEl.value.trim() : "";

  state.stepAnswers[3][state.stepSubIndex] = { symbol: userSymbol, correction: userCorrection };

  // 기호 비교 (ⓐ, a, A, (a) 등 완벽 상호 호환)
  const normUserSym = normalizeSymbol(userSymbol);
  const normCorrectSym = normalizeSymbol(item.wrongSymbol);
  const symbolPassed = (normUserSym && normCorrectSym && normUserSym === normCorrectSym) || 
                       (userSymbol === item.wrongSymbol) || 
                       (normCorrectSym && normUserSym.includes(normCorrectSym));

  const corrPassed = checkTypeBCorrection(userCorrection, item);
  const passed = symbolPassed && corrPassed;
  const score = (symbolPassed ? 50 : 0) + (corrPassed ? 50 : 0);

  const deductions = [];
  if (!symbolPassed) deductions.push(`틀린 기호(${item.wrongSymbol} 또는 ${normCorrectSym}) 선택 오류 (-50점)`);
  if (!corrPassed) deductions.push(`올바른 수정형태('${item.correction}') 미일치 (-50점)`);

  const reasonText = item.reason || item.explanation || "학교 기출 표준 문법 해설";
  const gradeResult = {
    score: score,
    passed: passed,
    deductions: deductions.length ? deductions : ["감점 요인 없음 (만점)"],
    sampleAnswer: `${item.wrongSymbol} -> ${item.correction} (이유: ${reasonText})`,
    feedback: passed ? "🎯 완벽하게 킬러 어법 오류를 잡아냈습니다!" : `💡 문법 해설을 확인해 보세요: ${reasonText}`
  };

  state.stepGrades[3][state.stepSubIndex] = gradeResult;
  saveSessionNow();
  if (passed) triggerConfetti();
  showGradingResult(gradeResult);
}

async function loadFreeWritingTopic(forceChange = false) {
  if (!forceChange && state.currentFreeWritingTopic) {
    return state.currentFreeWritingTopic;
  }
  const excludeId = (forceChange && state.currentFreeWritingTopic && state.currentFreeWritingTopic.topic) 
    ? state.currentFreeWritingTopic.topic.id : "";
  try {
    const res = await fetch(`/api/free_writing_topic?userId=${state.activeUserId}&textbookId=${state.currentTextbookId || 'ybm_park_grade1'}&excludeTopicId=${excludeId}&_t=${Date.now()}`);
    const data = await res.json();
    state.currentFreeWritingTopic = data;
    if (forceChange) {
      state.stepAnswers[4] = {};
      state.stepGrades[4] = {};
      const resultPanel = document.getElementById("grade-result-panel");
      if (resultPanel) resultPanel.classList.add("hidden");
      renderCurrentStepProblem();
      showToast(`새로운 주제 '${data.topic ? data.topic.title : "주제"}'가 준비되었습니다!`, "✨");
    }
    return data;
  } catch (err) {
    console.error("Failed to load free writing topic:", err);
  }
}

function updateFreeWritingStats(textarea) {
  if (!textarea) return;
  const text = textarea.value.trim();
  const words = text ? text.split(/\s+/).filter(w => w.length > 0) : [];
  const wordCount = words.length;
  const sentences = text ? text.split(/[.!?]+/).filter(s => s.trim().length > 1) : [];
  const sentenceCount = sentences.length;

  const wEl = document.getElementById("free-word-count");
  const sEl = document.getElementById("free-sentence-count");

  if (sEl) sEl.textContent = `${sentenceCount}문장`;
  if (wEl) {
    if (wordCount >= 35 && wordCount <= 60) {
      wEl.className = "text-[11px] font-bold px-2.5 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-300";
      wEl.textContent = `${wordCount}단어 (적정 분량 달성 ✓)`;
    } else if (wordCount < 25) {
      wEl.className = "text-[11px] font-bold px-2.5 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-300";
      wEl.textContent = `${wordCount}단어 (권장: 35~50단어)`;
    } else {
      wEl.className = "text-[11px] font-bold px-2.5 py-0.5 rounded-md bg-indigo-50 text-indigo-700 border border-indigo-200";
      wEl.textContent = `${wordCount}단어 (권장: 35~50단어)`;
    }
  }
}

async function submitStep4Answer() {
  const currentTopic = state.currentFreeWritingTopic ? state.currentFreeWritingTopic.topic : ((state.currentRoutine && state.currentRoutine.step4_typeD && state.currentRoutine.step4_typeD[0]) || {});
  const inputEl = document.getElementById("input-answer");
  const userAns = inputEl ? inputEl.value.trim() : "";
  state.stepAnswers[4][0] = userAns;

  if (!userAns) {
    showToast("에세이 문장을 먼저 작성해 주세요!", "⚠️");
    if (inputEl) inputEl.focus();
    return;
  }

  const btn = document.getElementById("step4-submit-btn") || document.querySelector("#problem-card button");
  const originalText = btn ? btn.innerHTML : "";
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span>⏳</span> <span>AI 어시스턴트가 4대 루브릭(주제/문맥/구조/문법) 및 어휘 추천을 정밀 분석 중...</span>`;
  }

  try {
    const res = await fetch("/api/evaluate_free_writing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: state.activeUserId,
        studentText: userAns,
        topic: currentTopic
      })
    });
    const result = await res.json();
    state.stepGrades[4][0] = result;
    saveSessionNow();

    if (result.passed) triggerConfetti();
    showFreeWritingEvaluation(result);
  } catch (err) {
    console.error("Free writing evaluation failed:", err);
    showToast("작문 평가 서버 통신 중 오류가 발생했습니다.", "❌");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  }
}

function showFreeWritingEvaluation(result) {
  const panel = document.getElementById("grade-result-panel");
  if (!panel) return;
  panel.classList.remove("hidden");

  const isPassed = result.passed;
  panel.className = `rounded-3xl p-6 sm:p-7 border transition-all animate-fade-in space-y-6 ${isPassed ? 'bg-gradient-to-br from-emerald-50/90 to-indigo-50/80 border-emerald-300 shadow-md' : 'bg-red-50/90 border-red-300 shadow-md'}`;

  const currentTopic = state.currentFreeWritingTopic ? state.currentFreeWritingTopic.topic : {};
  const topicTitle = currentTopic.title || "실전 Free 작문";
  const sourceBadge = state.currentFreeWritingTopic ? state.currentFreeWritingTopic.sourceBadge : "🏫 현재 교재 맞춤";

  const rScores = result.rubricScores || { relevance: 20, structure: 20, grammar: 20, vocabulary: 20 };

  panel.innerHTML = `
    <!-- Top Evaluation Header -->
    <div class="flex items-center justify-between border-b pb-4">
      <div class="flex items-center gap-3">
        <span class="text-3xl p-2 rounded-2xl bg-white shadow-xs">${isPassed ? '🏆' : '💡'}</span>
        <div>
          <div class="flex items-center gap-2">
            <h4 class="font-black text-base sm:text-lg ${isPassed ? 'text-emerald-950' : 'text-red-950'}">
              ${isPassed ? '동도중 루브릭 기준 만점 통과!' : '작문 역량 강화를 위한 AI 피드백'}
            </h4>
            <span class="text-xs px-2.5 py-0.5 rounded-full font-bold bg-white text-indigo-700 border border-indigo-200">
              ${sourceBadge}
            </span>
          </div>
          <p class="text-xs sm:text-sm font-medium ${isPassed ? 'text-emerald-800' : 'text-red-800'} mt-1">
            ${result.feedback}
          </p>
        </div>
      </div>
      <div class="text-right">
        <div class="text-3xl sm:text-4xl font-black ${isPassed ? 'text-emerald-600' : 'text-red-600'}">${result.score}점</div>
        <div class="text-[10px] text-gray-500 font-bold">100점 만점 루브릭</div>
      </div>
    </div>

    <!-- 4 Rubric Subscore Columns -->
    <div class="space-y-2">
      <div class="text-xs font-bold text-gray-700 flex items-center gap-1.5">
        <span>📊</span> <span>4대 핵심 역량 정밀 진단표 (각 25점 만점):</span>
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <div class="p-3 bg-white rounded-2xl border border-gray-200 shadow-2xs space-y-1">
          <div class="text-[11px] font-bold text-gray-500 flex items-center justify-between">
            <span>🎯 주제·맥락</span>
            <span class="font-black text-indigo-600">${rScores.relevance}/25</span>
          </div>
          <div class="w-full bg-gray-100 h-2 rounded-full overflow-hidden">
            <div class="bg-indigo-500 h-full rounded-full" style="width: ${(rScores.relevance / 25) * 100}%"></div>
          </div>
          <div class="text-[10px] text-gray-400">주제 적합성 및 완결성</div>
        </div>

        <div class="p-3 bg-white rounded-2xl border border-gray-200 shadow-2xs space-y-1">
          <div class="text-[11px] font-bold text-gray-500 flex items-center justify-between">
            <span>📐 문장 구조</span>
            <span class="font-black text-purple-600">${rScores.structure}/25</span>
          </div>
          <div class="w-full bg-gray-100 h-2 rounded-full overflow-hidden">
            <div class="bg-purple-500 h-full rounded-full" style="width: ${(rScores.structure / 25) * 100}%"></div>
          </div>
          <div class="text-[10px] text-gray-400">접속사 및 복문 호흡</div>
        </div>

        <div class="p-3 bg-white rounded-2xl border border-gray-200 shadow-2xs space-y-1">
          <div class="text-[11px] font-bold text-gray-500 flex items-center justify-between">
            <span>🔍 문법 정밀도</span>
            <span class="font-black text-emerald-600">${rScores.grammar}/25</span>
          </div>
          <div class="w-full bg-gray-100 h-2 rounded-full overflow-hidden">
            <div class="bg-emerald-500 h-full rounded-full" style="width: ${(rScores.grammar / 25) * 100}%"></div>
          </div>
          <div class="text-[10px] text-gray-400">시제·수일치·구두점</div>
        </div>

        <div class="p-3 bg-white rounded-2xl border border-gray-200 shadow-2xs space-y-1">
          <div class="text-[11px] font-bold text-gray-500 flex items-center justify-between">
            <span>📖 어휘 다양성</span>
            <span class="font-black text-amber-600">${rScores.vocabulary}/25</span>
          </div>
          <div class="w-full bg-gray-100 h-2 rounded-full overflow-hidden">
            <div class="bg-amber-500 h-full rounded-full" style="width: ${(rScores.vocabulary / 25) * 100}%"></div>
          </div>
          <div class="text-[10px] text-gray-400">어휘 풍부성 & 표현</div>
        </div>
      </div>
    </div>

    <!-- Real-time Grammar & Mechanics Corrections -->
    ${result.corrections && result.corrections.length > 0 ? `
      <div class="p-4 rounded-2xl bg-white border border-red-200 space-y-2.5 shadow-2xs">
        <div class="text-xs font-bold text-red-900 flex items-center gap-1.5">
          <span>⚠️</span> <span>실시간 문법 & 감점 방지 교정 노트:</span>
        </div>
        <div class="space-y-2">
          ${result.corrections.map(c => `
            <div class="p-2.5 rounded-xl bg-red-50/70 border border-red-100 text-xs space-y-1">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="line-through text-red-600 font-mono font-bold bg-white px-2 py-0.5 rounded border border-red-200">${c.original}</span>
                <span class="text-gray-400">➔</span>
                <span class="text-emerald-700 font-mono font-black bg-emerald-50 px-2 py-0.5 rounded border border-emerald-300">${c.corrected}</span>
              </div>
              <div class="text-[11px] text-gray-600 font-medium">💡 ${c.reason}</div>
            </div>
          `).join("")}
        </div>
      </div>
    ` : `
      <div class="p-3.5 rounded-2xl bg-emerald-100/70 border border-emerald-300 text-xs text-emerald-950 font-bold flex items-center gap-2">
        <span>✨</span> <span>감점 없는 완벽한 문법과 구두점을 달성했습니다! (No Grammar Errors)</span>
      </div>
    `}

    <!-- Writing Skill Booster 1: Lexical Upgrades (어휘 업그레이드 추천) -->
    ${result.lexicalUpgrades && result.lexicalUpgrades.length > 0 ? `
      <div class="p-4 rounded-2xl bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 space-y-2.5 shadow-2xs">
        <div class="text-xs font-bold text-amber-950 flex items-center justify-between">
          <span class="flex items-center gap-1.5">
            <span>💡</span> <span>작문 스킬 향상 코칭: 상위권 세련된 대체 어휘 추천</span>
          </span>
          <span class="text-[10px] text-amber-800 bg-amber-200/60 px-2 py-0.5 rounded-full font-bold">Lexical Boost</span>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
          ${result.lexicalUpgrades.map(u => `
            <div class="p-3 rounded-xl bg-white border border-amber-200/80 text-xs space-y-1">
              <div class="flex items-center gap-2">
                <span class="font-mono text-gray-500 text-[11px] bg-gray-100 px-1.5 py-0.5 rounded">${u.original}</span>
                <span class="text-amber-500 font-black">➔</span>
                <span class="font-bold text-amber-900">${u.alternatives.join(", ")}</span>
              </div>
              <p class="text-[11px] text-gray-600 leading-snug">${u.tip}</p>
            </div>
          `).join("")}
        </div>
      </div>
    ` : ''}

    <!-- Writing Skill Booster 2: Sentence Combining Pro-Tip (문장 결합 및 복문 팁) -->
    ${result.sentenceCombineTip ? `
      <div class="p-4 rounded-2xl bg-indigo-50/80 border border-indigo-200 space-y-2 shadow-2xs">
        <div class="text-xs font-bold text-indigo-950 flex items-center justify-between">
          <span class="flex items-center gap-1.5">
            <span>🪄</span> <span>고득점 영작 테크닉: 복문(Complex Sentence) 결합 팁</span>
          </span>
          <span class="text-[10px] text-indigo-800 bg-indigo-100 px-2 py-0.5 rounded-full font-bold">Pro Tip</span>
        </div>
        <p class="text-xs text-indigo-900 leading-relaxed font-medium">
          ${result.sentenceCombineTip.proTip}
        </p>
        <div class="p-3 rounded-xl bg-white border border-indigo-100 text-xs font-mono font-bold text-indigo-800 leading-relaxed select-all">
          ${result.sentenceCombineTip.example}
        </div>
      </div>
    ` : ''}

    <!-- Model Essay Rewrite (모범 패러프레이징) -->
    <div class="p-4 rounded-2xl bg-white border border-gray-200 space-y-2 shadow-2xs">
      <div class="text-xs font-bold text-gray-800 flex items-center justify-between">
        <span class="flex items-center gap-1.5">
          <span>🏆</span> <span>원어민식 동도중 1등급 모범 패러프레이징 에세이:</span>
        </span>
        <button type="button" onclick="copyEssayText('${encodeURIComponent(result.modelRewrite || "")}')" class="text-[11px] text-indigo-600 hover:text-indigo-800 font-bold flex items-center gap-1">
          <span>📋</span> <span>모범문장 복사</span>
        </button>
      </div>
      <p class="text-xs font-mono text-gray-800 leading-relaxed bg-gray-50/70 p-3.5 rounded-xl border border-gray-100 select-all">
        ${result.modelRewrite}
      </p>
    </div>

    <!-- Final Action Buttons -->
    <div class="pt-2 flex flex-col sm:flex-row items-center justify-between gap-3 border-t">
      <button onclick="retryCurrentProblem()" class="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-white hover:bg-gray-50 text-gray-700 border border-gray-300 font-bold text-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs">
        <span>✏️</span> <span>피드백 반영하여 다시 다듬기</span>
      </button>

      <button onclick="triggerEssayRoutineFinish()" class="w-full sm:w-auto px-6 py-3 bg-gradient-to-r from-emerald-600 via-teal-600 to-indigo-600 hover:from-emerald-700 hover:to-indigo-700 text-white font-black rounded-xl text-xs sm:text-sm transition-all shadow-md shadow-emerald-200 flex items-center justify-center gap-2 cursor-pointer transform hover:-translate-y-0.5">
        <span>📥</span> <span>세특 에세이 보관함 저장 & 오늘 루틴 최종 완료 ➔</span>
      </button>
    </div>
  `;

  panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function triggerEssayRoutineFinish() {
  const currentTopic = state.currentFreeWritingTopic ? state.currentFreeWritingTopic.topic : ((state.currentRoutine && state.currentRoutine.step4_typeD && state.currentRoutine.step4_typeD[0]) || {});
  const userAns = (state.stepAnswers[4] && state.stepAnswers[4][0]) || "";
  const gradeResult = (state.stepGrades[4] && state.stepGrades[4][0]) || { score: 90, feedback: "루틴 완료" };
  
  finishDailyRoutine(
    currentTopic.title || "실전 Free 작문",
    userAns,
    gradeResult.score,
    gradeResult.feedback,
    currentTopic.id || "",
    state.currentFreeWritingTopic ? state.currentFreeWritingTopic.sourceBadge : "",
    gradeResult.rubricScores || {},
    gradeResult.lexicalUpgrades || [],
    gradeResult.modelRewrite || ""
  );
}

function showGradingResult(result) {
  const panel = document.getElementById("grade-result-panel");
  if (!panel) return;
  panel.classList.remove("hidden");

  const isPassed = result.passed;
  panel.className = `rounded-3xl p-6 border transition-all animate-fade-in space-y-4 ${isPassed ? 'bg-emerald-50/80 border-emerald-300 shadow-sm' : 'bg-red-50/80 border-red-300 shadow-sm'}`;

  // 입력 필드 시각적 피드백 (빨간색 흔들림 또는 녹색 표시)
  const inputEl = document.getElementById("input-answer") || document.getElementById("input-correction");
  if (inputEl) {
    inputEl.classList.remove("border-gray-300", "border-emerald-500", "border-red-500", "bg-emerald-50", "bg-red-50", "animate-shake");
    void inputEl.offsetWidth; // DOM 리플로우 강제 트리거
    if (isPassed) {
      inputEl.classList.add("border-emerald-500", "bg-emerald-50/40");
    } else {
      inputEl.classList.add("border-red-500", "bg-red-50/40", "animate-shake");
    }
  }

  // 상단 토스트 알림도 함께 발송
  if (isPassed) {
    showToast(`🎉 정답 통과! (+${result.score}점)`, "✨");
  } else {
    showToast(`⚠️ 감점 요인 발견 (${result.score}점) - 아래 해설을 확인하세요`, "❌");
  }

  const currentListLen = getStepListLength(state.currentStep);
  const isLastQuestionInStep = state.stepSubIndex >= currentListLen - 1;
  const isFinalStep = state.currentStep === 4;

  let nextBtnText = "다음 문항으로 이동 ➔";
  if (isFinalStep) {
    nextBtnText = "🎉 학습 루틴 완료하고 결과 저장 ➔";
  } else if (isLastQuestionInStep) {
    nextBtnText = `다음 Step ${state.currentStep + 1}로 이동 ➔`;
  }

  panel.innerHTML = `
    <div class="flex items-center justify-between border-b pb-3">
      <div class="flex items-center gap-2">
        <span class="text-2xl">${isPassed ? '🎉' : '❌'}</span>
        <div>
          <h4 class="font-extrabold text-sm ${isPassed ? 'text-emerald-900' : 'text-red-900'}">
            ${isPassed ? '동도중 루브릭 평가 통과!' : '감점 요인이 발견되었습니다 (오답)'}
          </h4>
          <p class="text-xs ${isPassed ? 'text-emerald-700' : 'text-red-700'} mt-0.5">${result.feedback}</p>
        </div>
      </div>
      <div class="text-right">
        <div class="text-2xl font-black ${isPassed ? 'text-emerald-600' : 'text-red-600'}">${result.score}점</div>
        <div class="text-[10px] text-gray-500 font-semibold">100점 만점 기준</div>
      </div>
    </div>

    <!-- Praises List (성취 및 칭찬) -->
    ${result.praises && result.praises.length > 0 ? `
      <div class="space-y-1.5">
        <div class="text-xs font-bold text-emerald-800 flex items-center gap-1.5">
          <span>🎯 성취 및 칭찬 내역:</span>
        </div>
        <ul class="text-xs text-emerald-900 space-y-1 bg-emerald-50/90 p-3 rounded-2xl border border-emerald-200 list-disc list-inside font-medium">
          ${result.praises.map(p => `<li>${p}</li>`).join("")}
        </ul>
      </div>
    ` : ''}

    <!-- Deductions List (감점 및 수정 필요 사항) -->
    <div class="space-y-1.5">
      <div class="text-xs font-bold text-gray-700 flex items-center gap-1.5">
        <span>${isPassed ? '💡 세부 확인 사항:' : '⚠️ 감점 및 수정 필요 내역:'}</span>
      </div>
      <ul class="text-xs ${isPassed ? 'text-emerald-800' : 'text-red-800'} space-y-1 bg-white/90 p-3 rounded-2xl border ${isPassed ? 'border-emerald-100' : 'border-red-100'} list-disc list-inside">
        ${result.deductions.map(d => `<li>${d}</li>`).join("")}
      </ul>
    </div>

    <!-- Sample Answer & Action Buttons -->
    <div class="p-4 rounded-2xl bg-white/95 border border-gray-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
      <div class="space-y-1">
        <div class="text-[11px] font-bold text-indigo-600">동도중 만점 모범 답안:</div>
        <div class="text-xs font-mono font-bold text-gray-800 leading-relaxed select-all">
          ${result.sampleAnswer}
        </div>
      </div>
      <div class="flex items-center gap-2 w-full sm:w-auto justify-end">
        ${isPassed ? `
          <button onclick="${isFinalStep ? 'triggerEssayRoutineFinish()' : 'goToNextStep()'}" class="w-full sm:w-auto px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs transition-all shadow-md flex items-center justify-center gap-1.5 whitespace-nowrap">
            <span>${nextBtnText}</span>
          </button>
        ` : `
          <button onclick="retryCurrentProblem()" class="px-4 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 font-bold rounded-xl text-xs transition-all whitespace-nowrap">
            🔄 다시 입력하기
          </button>
          <button onclick="${isFinalStep ? 'triggerEssayRoutineFinish()' : 'goToNextStep()'}" class="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 border border-gray-300 font-semibold rounded-xl text-xs transition-all whitespace-nowrap">
            ${isFinalStep ? '그대로 완료' : '건너뛰기 ➔'}
          </button>
        `}
      </div>
    </div>
  `;

  panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function retryCurrentProblem() {
  const inputEl = document.getElementById("input-answer") || document.getElementById("input-correction");
  if (inputEl) {
    inputEl.value = "";
    inputEl.classList.remove("border-red-500", "bg-red-50/40", "animate-shake");
    inputEl.focus();
  }
  const panel = document.getElementById("grade-result-panel");
  if (panel) panel.classList.add("hidden");
  showToast("답안을 다시 입력해 보세요! 할 수 있어요 💪");
}

// ==========================================
// Step Navigation & Routine Finalization
// ==========================================
function goToPrevStep() {
  if (state.stepSubIndex > 0) {
    state.stepSubIndex--;
  } else if (state.currentStep > 1) {
    state.currentStep--;
    const listLen = getStepListLength(state.currentStep);
    state.stepSubIndex = Math.max(0, listLen - 1);
  }
  updateStepPills();
  renderCurrentStepProblem();
  saveSessionNow();
}

function goToNextStep() {
  const currentListLen = getStepListLength(state.currentStep);
  if (state.stepSubIndex < currentListLen - 1) {
    state.stepSubIndex++;
  } else if (state.currentStep < 4) {
    state.currentStep++;
    state.stepSubIndex = 0;
  } else {
    showToast("모든 단계를 완료했습니다! 에세이를 제출하여 학습을 마무리하세요.");
    return;
  }
  updateStepPills();
  renderCurrentStepProblem();
  saveSessionNow();
}

function getStepListLength(step) {
  if (!state.currentRoutine) return 1;
  if (step === 1) return (state.currentRoutine.step1_warmup || []).length;
  if (step === 2) return (state.currentRoutine.step2_typeA || []).length;
  if (step === 3) return (state.currentRoutine.step3_typeB || []).length;
  if (step === 4) return (state.currentRoutine.step4_typeD || []).length;
  return 1;
}

async function finishDailyRoutine(essayTitle, essayText, essayScore, essayFeedback, topicId = "", sourceBadge = "", rubricScores = {}, lexicalUpgrades = [], modelRewrite = "") {
  // 틀린 문제 수집
  const wrongItems = [];
  const typeAList = (state.currentRoutine && state.currentRoutine.step2_typeA) || [];
  for (let i = 0; i < typeAList.length; i++) {
    const g = state.stepGrades[2] && state.stepGrades[2][i];
    if (g && !g.passed) {
      wrongItems.push({
        problemId: typeAList[i].id,
        problemType: "typeA",
        korean: typeAList[i].korean,
        studentAnswer: (state.stepAnswers[2] && state.stepAnswers[2][i]) || "",
        sampleAnswer: typeAList[i].sampleAnswer,
        deductions: g.deductions || []
      });
    }
  }

  const payload = {
    userId: state.activeUserId,
    unitTitle: (state.currentRoutine && state.currentRoutine.title) || "Daily Routine",
    durationMinutes: Math.round((30 * 60 - state.timerSeconds) / 60) || 28,
    overallScore: essayScore || 92,
    wrongItems: wrongItems,
    essayItem: essayText ? {
      title: essayTitle,
      topicId: topicId,
      sourceBadge: sourceBadge,
      studentText: essayText,
      score: essayScore,
      feedback: essayFeedback,
      rubricScores: rubricScores,
      lexicalUpgrades: lexicalUpgrades,
      modelRewrite: modelRewrite
    } : null
  };

  try {
    const res = await fetch("/api/save_routine_result", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await res.json();
    if (result.success) {
      triggerConfetti();
      clearCurrentSession();
      alert(`🎉 오늘의 30분 영작 루틴 완료!\n경험치 +${result.earnedExp} EXP 획득!\n연속 학습 ${result.streakDays}일 달성!`);
      await loadUserData();
      switchTab("tab-home");
    }
  } catch (err) {
    console.error("Failed to save routine:", err);
  }
}

// ==========================================
// 30-Minute Timer Logic
// ==========================================
function initTimer() {
  updateTimerDisplay();
}

function toggleTimer() {
  if (state.timerRunning) {
    pauseTimer();
  } else {
    startTimer();
  }
}

function startTimer() {
  if (state.timerRunning) return;
  state.timerRunning = true;
  document.getElementById("timer-toggle-btn").textContent = "❚❚";
  state.timerInterval = setInterval(() => {
    if (state.timerSeconds > 0) {
      state.timerSeconds--;
      updateTimerDisplay();
    } else {
      pauseTimer();
      showToast("⏰ 오늘의 목표 학습 시간이 완료되었습니다! 마무리 Free 작문을 작성해 주세요.", "⏰");
      jumpToStep(4);
    }
  }, 1000);
}

function pauseTimer() {
  state.timerRunning = false;
  document.getElementById("timer-toggle-btn").textContent = "▶";
  if (state.timerInterval) clearInterval(state.timerInterval);
}

function updateTimerDisplay() {
  const m = Math.floor(state.timerSeconds / 60);
  const s = state.timerSeconds % 60;
  const str = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  document.getElementById("timer-display").textContent = str;
}

function setDailyTime(minutes) {
  state.timerSeconds = minutes * 60;
  updateTimerDisplay();
  document.querySelectorAll(".time-btn").forEach(b => b.classList.remove("active-time"));
  const btn = document.getElementById(`time-btn-${minutes}`);
  if (btn) btn.classList.add("active-time");
  showToast(`일일 학습 목표가 ${minutes}분으로 설정되었습니다.`);

  if (!state.userData) state.userData = {};
  if (!state.userData.settings) state.userData.settings = {};
  state.userData.settings.dailyTargetMinutes = minutes;
  fetch("/api/user/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: state.activeUserId, settings: state.userData.settings })
  }).catch(() => {});
}

async function saveSettings() {
  const mascotEl = document.querySelector('input[name="mascot"]:checked');
  const mascot = mascotEl ? mascotEl.value : "penny";

  if (!state.userData) state.userData = {};
  if (!state.userData.settings) state.userData.settings = {};
  state.userData.settings.mascot = mascot;

  try {
    await fetch("/api/user/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: state.activeUserId,
        settings: state.userData.settings
      })
    });
    showToast("설정이 저장되었습니다!", "💾");
  } catch (err) {
    console.error("Failed to save settings:", err);
  }
}

// ==========================================
// Growth Report & Radar Chart (Chart.js)
// ==========================================
function renderRadarChart() {
  const ctx = document.getElementById("radarChart");
  if (!ctx) return;

  if (state.radarChartInstance) {
    try {
      state.radarChartInstance.destroy();
    } catch (e) {}
    state.radarChartInstance = null;
  }

  const radarData = (state.userData && state.userData.stats && state.userData.stats.radar) || {
    condition: 85, agreement: 75, tense: 80, mechanics: 90, structure: 82
  };

  state.radarChartInstance = new Chart(ctx, {
    type: "radar",
    data: {
      labels: ["조건 준수", "수 일치(-s)", "시제 일치", "철자/구두점", "문장 구조력"],
      datasets: [{
        label: "현재 역량 점수",
        data: [
          radarData.condition,
          radarData.agreement,
          radarData.tense,
          radarData.mechanics,
          radarData.structure
        ],
        backgroundColor: "rgba(99, 102, 241, 0.2)",
        borderColor: "rgba(99, 102, 241, 1)",
        borderWidth: 2,
        pointBackgroundColor: "rgba(99, 102, 241, 1)",
        pointRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        r: {
          min: 0,
          max: 100,
          ticks: { stepSize: 20, display: false },
          pointLabels: { font: { size: 11, family: 'Pretendard', weight: 'bold' } }
        }
      },
      plugins: {
        legend: { display: false }
      }
    }
  });
}

function updateRadarData() {
  if (!state.radarChartInstance || !state.userData || !state.userData.stats) return;
  const radarData = state.userData.stats.radar || {};
  state.radarChartInstance.data.datasets[0].data = [
    radarData.condition || 75,
    radarData.agreement || 75,
    radarData.tense || 75,
    radarData.mechanics || 80,
    radarData.structure || 75
  ];
  state.radarChartInstance.update();
}

function renderWrongNotes() {
  const container = document.getElementById("wrong-notes-list");
  if (!container || !state.userData) return;
  const notes = state.userData.wrongNotes || [];

  if (notes.length === 0) {
    container.innerHTML = `
      <div class="text-center py-10 text-gray-400 space-y-2">
        <span class="text-4xl">🎉</span>
        <div class="text-sm font-semibold">오답노트가 깨끗해요! 모든 문제를 완벽히 맞혔습니다.</div>
      </div>
    `;
    return;
  }

  container.innerHTML = notes.map(wn => `
    <div class="p-4 rounded-2xl border ${wn.resolved ? 'border-gray-200 bg-gray-50 opacity-60' : 'border-pink-200 bg-pink-50/30'} space-y-2.5 transition-all">
      <div class="flex items-center justify-between">
        <span class="text-[11px] font-bold ${wn.resolved ? 'text-gray-500 bg-white' : 'text-pink-600 bg-pink-100'} px-2.5 py-0.5 rounded-full">
          ${wn.resolved ? '✓ 해결 완료' : '⚠️ 다시 풀기 대기'}
        </span>
        <span class="text-[10px] text-gray-400">${wn.recordedAt} 기록</span>
      </div>
      <div>
        <div class="text-xs text-gray-400 font-bold">[문제 해석]</div>
        <div class="text-sm font-bold text-gray-800">${wn.korean}</div>
      </div>
      <div class="text-xs bg-white p-3 rounded-xl border border-gray-200 space-y-1">
        <div><span class="text-red-500 font-bold">내가 쓴 답안:</span> <span class="font-mono">${wn.studentAnswer || '(미작성)'}</span></div>
        <div><span class="text-emerald-600 font-bold">만점 모범 답안:</span> <span class="font-mono">${wn.sampleAnswer}</span></div>
      </div>
      <div class="flex items-center justify-between pt-1">
        <div class="text-xs text-pink-700 font-medium">${Array.isArray(wn.wrongPoints) ? wn.wrongPoints.join(", ") : wn.wrongPoints}</div>
        ${!wn.resolved ? `
          <button onclick="resolveWrongNote('${wn.id}')" class="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-xs transition-all">
            해결 완료 처리
          </button>
        ` : ''}
      </div>
    </div>
  `).join("");
}

async function resolveWrongNote(wrongNoteId) {
  try {
    await fetch("/api/resolve_wrong_note", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: state.activeUserId, wrongNoteId })
    });
    await loadUserData();
    showToast("오답노트 문제가 해결 처리되었습니다! 👏");
  } catch (err) {
    console.error("Failed to resolve note:", err);
  }
}

function renderEssays() {
  const container = document.getElementById("essays-list");
  if (!container || !state.userData) return;
  const essays = state.userData.essays || [];

  if (essays.length === 0) {
    container.innerHTML = `
      <div class="text-center py-10 text-gray-400 space-y-2">
        <span class="text-4xl">📝</span>
        <div class="text-sm font-semibold">아직 보관된 에세이가 없습니다. 데일리 Step 4를 완료해 보세요!</div>
      </div>
    `;
    return;
  }

  container.innerHTML = essays.map(es => `
    <div class="p-5 rounded-2xl border border-indigo-100 bg-white shadow-sm space-y-3">
      <div class="flex items-center justify-between border-b pb-2">
        <div class="space-y-1">
          <div class="flex items-center gap-1.5 flex-wrap">
            <span class="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2.5 py-0.5 rounded-full">${es.unitTitle || 'Daily Free Writing'}</span>
            ${es.sourceBadge ? `<span class="text-[10px] font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">${es.sourceBadge}</span>` : ''}
          </div>
          <h4 class="font-extrabold text-gray-800 text-sm">${es.topic}</h4>
        </div>
        <div class="text-right">
          <span class="text-base font-black text-indigo-600">${es.score || 95}점</span>
          <div class="text-[10px] text-gray-400">${es.createdAt}</div>
        </div>
      </div>
      <p class="text-xs font-mono text-gray-700 leading-relaxed bg-gray-50/80 p-3.5 rounded-xl border border-gray-100 select-all">
        ${es.studentText}
      </p>
      ${es.modelRewrite ? `
        <details class="text-xs bg-indigo-50/40 p-2.5 rounded-xl border border-indigo-100/80">
          <summary class="font-bold text-indigo-700 cursor-pointer">🏆 AI 모범 패러프레이징 에세이 확인하기</summary>
          <div class="mt-2 text-xs font-mono text-gray-700 bg-white p-2.5 rounded-lg border border-indigo-100 leading-relaxed select-all">
            ${es.modelRewrite}
          </div>
        </details>
      ` : ''}
      <div class="flex items-center justify-between text-xs text-gray-500 pt-1">
        <div class="text-[11px] text-gray-600"><span class="font-bold text-indigo-600">피드백:</span> ${es.feedback || '훌륭한 작문입니다.'}</div>
        <button onclick="copyEssayText('${es.id}')" class="px-3 py-1 bg-white hover:bg-gray-100 border rounded-lg text-[11px] font-bold transition-all shadow-2xs cursor-pointer">
          복사하기
        </button>
      </div>
    </div>
  `).join("");
}

function copyEssayText(essayId) {
  let text = "";
  const essay = (state.userData && state.userData.essays) ? state.userData.essays.find(e => e.id === essayId) : null;
  if (essay && essay.studentText) {
    text = essay.studentText;
  } else {
    try {
      text = decodeURIComponent(essayId);
    } catch (e) {
      text = essayId;
    }
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      showToast("에세이 텍스트가 클립보드에 복사되었습니다! 📋");
    }).catch(() => {
      showToast("에세이 복사 완료!");
    });
  } else {
    showToast("에세이 복사 완료!");
  }
}

// ==========================================
// Tabs & UI Utilities
// ==========================================
function switchTab(tabId) {
  document.querySelectorAll(".tab-content").forEach(el => el.classList.add("hidden"));
  document.querySelectorAll(".nav-btn").forEach(el => {
    el.classList.remove("active-tab");
    if (el.id === `nav-${tabId}` || el.getAttribute("data-tab") === tabId) {
      el.classList.add("active-tab");
    }
  });

  const targetTab = document.getElementById(tabId);
  if (targetTab) targetTab.classList.remove("hidden");

  window.scrollTo({ top: 0, behavior: "smooth" });
}

function switchReportSubTab(subTabId) {
  document.querySelectorAll(".report-subcontent").forEach(el => el.classList.add("hidden"));
  document.querySelectorAll(".subtab-btn").forEach(el => el.classList.remove("active-subtab", "text-indigo-600", "bg-indigo-50"));

  const target = document.getElementById(subTabId);
  if (target) target.classList.remove("hidden");

  const btnId = subTabId.replace("sub-", "subnav-");
  const btn = document.getElementById(btnId);
  if (btn) btn.classList.add("active-subtab", "text-indigo-600", "bg-indigo-50");
}

async function openUserModal() {
  document.getElementById("user-modal").classList.remove("hidden");
  await loadUsers();
  const inputId = document.getElementById("new-user-id");
  if (inputId) inputId.focus();
}

function closeUserModal() {
  document.getElementById("user-modal").classList.add("hidden");
}

function showToast(message, icon = "✨") {
  const toast = document.getElementById("toast");
  document.getElementById("toast-message").textContent = message;
  document.getElementById("toast-icon").textContent = icon;
  toast.classList.remove("hidden");
  setTimeout(() => toast.classList.add("hidden"), 3000);
}

function triggerConfetti() {
  if (typeof confetti === "function") {
    confetti({
      particleCount: 60,
      spread: 70,
      origin: { y: 0.6 }
    });
  }
}

// ==========================================
// 10-Level System Roadmap & Modal Logic
// ==========================================
const LEVEL_ROADMAP = [
  {
    level: 1,
    title: "새싹 영작러",
    badge: "🌱",
    gradeBadge: "중1 기초",
    grammarTarget: "Be동사 / 일반동사 현재형, 3인칭 단수 -s 기초",
    description: "영어 문장의 기본 뼈대인 주어-동사를 바르게 세우고, 동도중 최다 감점 포인트인 3인칭 단수 주어 뒤 일반동사 -s 규칙을 완벽하게 마스터합니다."
  },
  {
    level: 2,
    title: "도약하는 영작러",
    badge: "🌿",
    gradeBadge: "중1 기본",
    grammarTarget: "과거시제 (규칙/불규칙), There is/are, 부정문/의문문",
    description: "규칙·불규칙 과거형 변형과 부정문(did not 등) 어순을 숙달하여 다양한 일상과 과거 경험을 서술형 문장으로 막힘없이 조립합니다."
  },
  {
    level: 3,
    title: "성장하는 챌린저",
    badge: "⭐",
    gradeBadge: "중1 심화",
    grammarTarget: "조동사(can, will, must), 감각동사+형용사, to부정사 명사적 용법",
    description: "조동사 뒤 동사원형 원칙과 감각동사 보어 규칙을 체화하고, to부정사를 활용해 문장의 주어와 목적어를 폭넓게 확장합니다."
  },
  {
    level: 4,
    title: "문법 탐험가",
    badge: "🔍",
    gradeBadge: "중1 완성 / 중2 대비",
    grammarTarget: "동명사 목적어, 등위·종속 접속사(and/so/because), 조건영작 적응",
    description: "두 문장을 인과관계로 매끄럽게 연결하는 접속사와 동명사구를 익혀 동도중 서술형 조건(단어 수 일치 및 어형 변형)을 100% 충족합니다."
  },
  {
    level: 5,
    title: "서술형 명사수",
    badge: "🏹",
    gradeBadge: "중2 핵심",
    grammarTarget: "현재완료(have+p.p.), 수동태(be+p.p.), 5형식 목적격보어",
    description: "중2 내신 킬러 문법인 현재완료의 4대 용법과 수동태 문장 변환, 목적격보어(to부정사/원형부정사) 패턴을 감점 없이 완벽 영작합니다."
  },
  {
    level: 6,
    title: "조건영작 스페셜리스트",
    badge: "💎",
    gradeBadge: "중2 심화",
    grammarTarget: "관계대명사(who/which/that), 분사구문, 비교급/최상급",
    description: "수식어구를 더해 문장을 풍성하게 만드는 관계사절과 비교 표현을 통달하여, 까다로운 복합 조건 제시형 문항을 백발백중 격파합니다."
  },
  {
    level: 7,
    title: "동도중 에이스",
    badge: "🏆",
    gradeBadge: "중3 핵심",
    grammarTarget: "관계부사, 목적/결과 접속사(so that), It~that 강조구문",
    description: "동도중 3학년 상위권을 가르는 관계부사와 강조구문을 자유자재로 구사하며 내신 지필평가 95점 고지에 안정적으로 안착합니다."
  },
  {
    level: 8,
    title: "수성구 영작 달인",
    badge: "👑",
    gradeBadge: "중3 심화",
    grammarTarget: "가정법 과거/과거완료, 복합관계사, 어법 오류 완벽 수정",
    description: "대구 수성학군 특유의 고난도 서술형인 가정법과 어법 오류 찾기(기호 선택 및 올바른 형태 수정)를 100% 잡아내는 킬러 해결사 단계입니다."
  },
  {
    level: 9,
    title: "내신 1등급 마스터",
    badge: "⚡",
    gradeBadge: "중3 완성",
    grammarTarget: "복합 고난도 서술형, 자유주제 단락 에세이 완벽 구성",
    description: "동도중 지필고사 서술형 전 문항 만점과 과정중심 수행평가(자유주제 단락 에세이)에서 최고 등급을 기록하는 중학 최고수 단계입니다."
  },
  {
    level: 10,
    title: "수능/내신 완벽 지배자",
    badge: "🌟",
    gradeBadge: "고등 연계 최상위",
    grammarTarget: "고등 수능형 어법·서술형 연계 & 논리적 학술 에세이",
    description: "중학 3개년 영작 과정을 완벽히 지배하고 고교 내신 1등급과 수능 1등급까지 탄탄하게 연결하는 최상위 마스터 단계입니다."
  }
];

function openLevelGuideModal() {
  const modal = document.getElementById("level-guide-modal");
  if (!modal) return;

  const stats = (state.userData && state.userData.stats) || {};
  const currentLevel = stats.level || 1;
  const recLevel = stats.recommendedLevel || null;
  const currentExp = stats.exp || 0;
  const nextExp = stats.nextLevelExp || 150;
  const container = document.getElementById("level-roadmap-list");

  if (container) {
    const bannerHtml = recLevel ? `
      <div class="p-3.5 rounded-2xl bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 text-xs text-amber-900 space-y-1 mb-2">
        <div class="flex items-center justify-between font-bold">
          <span class="flex items-center gap-1.5"><span>🎯</span> 3분 진단평가 기록:</span>
          <span class="bg-amber-200/90 text-amber-950 px-2.5 py-0.5 rounded-full font-black text-[11px]">진단 권장: Lv.${recLevel}</span>
        </div>
        <p class="text-[11px] text-amber-800 leading-relaxed">
          회원님의 진단 실력은 <strong>Lv.${recLevel}</strong>이지만, 기본기를 완벽하게 다지기 위해 현재 <strong>Lv.${currentLevel}</strong>부터 학습을 진행 중입니다.
        </p>
      </div>
    ` : "";

    container.innerHTML = bannerHtml + LEVEL_ROADMAP.map(item => {
      const isCurrent = item.level === currentLevel;
      const isPast = item.level < currentLevel;
      const isRec = item.level === recLevel && recLevel !== currentLevel;
      
      let borderClass = "border-gray-200 bg-white hover:border-indigo-200";
      let badgeTag = "";

      if (isCurrent) {
        borderClass = "border-2 border-indigo-500 bg-gradient-to-r from-indigo-50/70 to-purple-50/70 shadow-md ring-2 ring-indigo-200/50";
        badgeTag = `<span class="px-2.5 py-1 rounded-full bg-indigo-600 text-white font-extrabold text-[10px] animate-pulse shadow-sm">📍 현재 학습 레벨 (${currentExp} / ${nextExp} EXP)</span>`;
      } else if (isRec) {
        borderClass = "border-2 border-amber-400 bg-amber-50/50 shadow-sm";
        badgeTag = `<span class="px-2.5 py-1 rounded-full bg-amber-500 text-white font-extrabold text-[10px] shadow-sm">🌟 진단 권장 실력</span>`;
      } else if (isPast) {
        borderClass = "border-emerald-200 bg-emerald-50/40";
        badgeTag = `<span class="px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 font-bold text-[10px]">✓ 달성 완료</span>`;
      } else {
        badgeTag = `<span class="px-2 py-0.5 rounded-full bg-gray-100 text-gray-400 font-medium text-[10px]">🔒 도전 목표</span>`;
      }

      return `
        <div class="p-4 rounded-2xl border ${borderClass} transition-all space-y-2">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2.5">
              <span class="text-2xl p-1 bg-white rounded-xl shadow-xs border border-gray-100">${item.badge}</span>
              <div>
                <span class="text-xs font-black text-indigo-600">Lv.${item.level}</span>
                <strong class="text-sm font-extrabold text-gray-900 ml-1">${item.title}</strong>
                <span class="text-[10px] font-semibold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-md ml-1.5">${item.gradeBadge}</span>
              </div>
            </div>
            <div>${badgeTag}</div>
          </div>
          <div class="text-xs font-semibold text-indigo-900 bg-indigo-50/80 px-3 py-1.5 rounded-xl border border-indigo-100 flex items-center gap-1.5">
            <span class="text-indigo-500">🎯</span> <span>핵심 역량: <strong>${item.grammarTarget}</strong></span>
          </div>
          <p class="text-[12px] text-gray-600 leading-relaxed pl-1">
            ${item.description}
          </p>
        </div>
      `;
    }).join("");
  }

  modal.classList.remove("hidden");
}

function closeLevelGuideModal() {
  const modal = document.getElementById("level-guide-modal");
  if (modal) modal.classList.add("hidden");
}

// ==========================================
// 3-Minute Quick Placement Test Logic (Dynamic Question Pool & Flexible Level Selection)
// ==========================================
const LEVEL_TITLES = [
  "새싹 영작러", "도약하는 영작러", "성장하는 챌린저",
  "문법 탐험가", "서술형 명사수", "조건영작 스페셜리스트",
  "동도중 에이스", "수성구 영작 달인", "내신 1등급 마스터", "수능/내신 완벽 지배자"
];

const PLACEMENT_POOL = {
  slot1: [
    {
      id: "p1_1",
      level: 1,
      grade: "중1 기초",
      grammar: "3인칭 단수 일반동사 -s",
      korean: "그는 매일 아침 일찍 일어난다.",
      conditions: ["'get up early every morning', 'He'를 사용할 것", "3인칭 단수 현재형 주어에 맞추어 동사를 알맞게 변형할 것"],
      placeholder: "He gets up early every morning.",
      sample: "He gets up early every morning.",
      explanation: "주어 He가 3인칭 단수이므로 get up을 gets up으로 변형해야 합니다.",
      checkGrammar: (rawAns, tokens) => {
        if (tokens.includes("gets") || /gets\s+up/i.test(rawAns)) {
          return { ok: true, praise: "✅ 주어(He)가 3인칭 단수이므로 동사에 -s를 붙인 'gets up'은 완벽하게 작성했습니다!" };
        }
        if (tokens.includes("get")) {
          return { ok: false, error: "❌ 3인칭 단수 동사 변형 오류: 주어가 He이므로 'get up'이 아닌 'gets up'으로 변형해야 합니다." };
        }
        return { ok: false, error: "❌ 핵심 동사 변형 누락: 'gets up' 표현이 올바르게 포함되지 않았습니다." };
      }
    },
    {
      id: "p1_2",
      level: 1,
      grade: "중1 기초",
      grammar: "3인칭 단수 일반동사 -es",
      korean: "그녀는 학교에서 영어를 가르친다.",
      conditions: ["'teach English at school', 'She'를 사용할 것", "3인칭 단수 주어에 맞추어 teach에 -es를 붙일 것"],
      placeholder: "She teaches English at school.",
      sample: "She teaches English at school.",
      explanation: "주어 She가 3인칭 단수이고 -ch로 끝나는 동사이므로 teach에 -es를 붙여 teaches로 씁니다.",
      checkGrammar: (rawAns, tokens) => {
        if (tokens.includes("teaches") || /teaches/i.test(rawAns)) {
          return { ok: true, praise: "✅ 3인칭 단수 주어에 맞추어 동사 뒤에 -es를 붙인 'teaches'를 완벽히 작성했습니다!" };
        }
        if (tokens.includes("teach")) {
          return { ok: false, error: "❌ 동사 수 일치 오류: 주어가 She(3인칭 단수)이므로 'teach' 뒤에 -es를 붙여 'teaches'로 써야 합니다." };
        }
        return { ok: false, error: "❌ 핵심 동사 변형 누락: 'teaches' 표현이 올바르게 포함되지 않았습니다." };
      }
    },
    {
      id: "p1_3",
      level: 1,
      grade: "중1 기초",
      grammar: "be동사 인칭과 수 일치 (복수 주어 are)",
      korean: "그들은 모든 학생들에게 매우 친절하다.",
      conditions: ["'very kind to all students', 'They'를 사용할 것", "복수 주어 They에 알맞은 be동사를 사용할 것"],
      placeholder: "They are very kind to all students.",
      sample: "They are very kind to all students.",
      explanation: "주어 They는 3인칭 복수이므로 be동사 are를 사용해야 합니다.",
      checkGrammar: (rawAns, tokens) => {
        if (tokens.includes("are") || /they\s+are/i.test(rawAns)) {
          return { ok: true, praise: "✅ 복수 주어 They에 알맞은 be동사 'are'를 정확히 사용했습니다!" };
        }
        if (tokens.includes("is")) {
          return { ok: false, error: "❌ be동사 수 일치 오류: 주어가 복수(They)이므로 is가 아닌 'are'를 써야 합니다." };
        }
        return { ok: false, error: "❌ be동사 누락: They 뒤에 'are'가 필요합니다." };
      }
    },
    {
      id: "p1_4",
      level: 1,
      grade: "중1 기초",
      grammar: "3인칭 단수 불규칙 동사 has",
      korean: "내 남동생은 작고 귀여운 강아지를 한 마리 가지고 있다.",
      conditions: ["'a small and cute puppy', 'My brother'를 사용할 것", "동사 have를 3인칭 단수 주어에 알맞게 변형할 것"],
      placeholder: "My brother has a small and cute puppy.",
      sample: "My brother has a small and cute puppy.",
      explanation: "주어 My brother가 3인칭 단수이므로 have의 단수형인 has를 사용합니다.",
      checkGrammar: (rawAns, tokens) => {
        if (tokens.includes("has") || /brother\s+has/i.test(rawAns)) {
          return { ok: true, praise: "✅ 3인칭 단수 주어에 맞춘 불규칙 동사 변형 'has'를 완벽히 작성했습니다!" };
        }
        if (tokens.includes("have")) {
          return { ok: false, error: "❌ 3인칭 단수 동사 변형 오류: 주어가 My brother이므로 have가 아닌 'has'를 써야 합니다." };
        }
        return { ok: false, error: "❌ 핵심 동사 누락: 3인칭 단수 형태 'has'가 필요합니다." };
      }
    }
  ],
  slot2: [
    {
      id: "p2_1",
      level: 3,
      grade: "중1 기본",
      grammar: "조동사 can 부정문 (can't / cannot)",
      korean: "그녀는 피아노를 칠 수 없다.",
      conditions: ["'play the piano', 'She'를 사용할 것", "조동사 can의 부정형(cannot 또는 can't)을 사용할 것"],
      placeholder: "She cannot play the piano.",
      sample: "She cannot play the piano. (또는 She can't play the piano.)",
      explanation: "조동사 can 뒤에는 반드시 동사원형(play)이 오며, 부정형은 cannot 또는 can't입니다.",
      checkGrammar: (rawAns, tokens) => {
        const hasNeg = /cannot|can't|can\s+not/i.test(rawAns);
        const hasPlay = tokens.includes("play");
        const hasPlays = tokens.includes("plays") || tokens.includes("playing");
        if (hasNeg && hasPlay) {
          return { ok: true, praise: "✅ 조동사 can의 부정 표현(cannot/can't) 및 동사원형 play를 완벽하게 사용했습니다!" };
        }
        if (!hasNeg) {
          return { ok: false, error: "❌ 부정 표현 누락: 피아노를 칠 수 '없다'이므로 조동사의 부정형 'cannot' 또는 \"can't\"가 필요합니다." };
        }
        if (hasPlays) {
          return { ok: false, error: "❌ 조동사 뒤 동사원형 오류: can't 뒤에는 동사원형 'play'를 써야 하며 변형하지 않습니다." };
        }
        return { ok: false, error: "❌ 조동사 부정문 표현('cannot play')이 올바르지 않습니다." };
      }
    },
    {
      id: "p2_2",
      level: 3,
      grade: "중1 기본",
      grammar: "to부정사 부사적 용법 (목적: ~하기 위해)",
      korean: "나는 새 책을 빌리기 위해 도서관에 갔다.",
      conditions: ["'go to the library', 'borrow a new book', 'I'를 사용할 것", "과거 시제 및 to부정사의 목적(~하기 위해)을 사용할 것"],
      placeholder: "I went to the library to borrow a new book.",
      sample: "I went to the library to borrow a new book.",
      explanation: "~하기 위해의 목적을 나타낼 때는 to + 동사원형(to borrow)을 쓰며, 과거 시제이므로 went를 씁니다.",
      checkGrammar: (rawAns, tokens) => {
        const hasWent = tokens.includes("went");
        const hasToBorrow = /to\s+borrow/i.test(rawAns);
        if (hasWent && hasToBorrow) {
          return { ok: true, praise: "✅ 과거 시제 went와 목적을 나타내는 to부정사(to borrow)를 완벽히 구사했습니다!" };
        }
        if (!hasWent) {
          return { ok: false, error: "❌ 시제 오류: 과거 시제이므로 go가 아닌 'went'를 써야 합니다." };
        }
        return { ok: false, error: "❌ to부정사 목적 오류: '~하기 위해'를 나타내는 'to borrow'가 필요합니다." };
      }
    },
    {
      id: "p2_3",
      level: 3,
      grade: "중1 기본",
      grammar: "감각동사 + 형용사 보어",
      korean: "이 신선한 빵은 정말 맛있는 냄새가 난다.",
      conditions: ["'This fresh bread', 'smell', 'really delicious'를 사용할 것", "감각동사 뒤에 부사가 아닌 형용사 보어를 쓸 것"],
      placeholder: "This fresh bread smells really delicious.",
      sample: "This fresh bread smells really delicious.",
      explanation: "감각동사 smell 뒤에는 부사가 아닌 형용사(delicious)가 보어로 오며, 주어가 단수이므로 smells를 씁니다.",
      checkGrammar: (rawAns, tokens) => {
        const hasSmells = tokens.includes("smells") || /smells/i.test(rawAns);
        const hasDel = tokens.includes("delicious");
        if (hasSmells && hasDel) {
          return { ok: true, praise: "✅ 감각동사 뒤 형용사 보어(delicious)와 3인칭 단수 수 일치(smells)를 정확히 반영했습니다!" };
        }
        if (!hasSmells) {
          return { ok: false, error: "❌ 동사 수 일치 오류: 주어가 This fresh bread(단수)이므로 smell이 아닌 'smells'로 써야 합니다." };
        }
        return { ok: false, error: "❌ 보어 오류: 감각동사 뒤에는 형용사 'delicious'가 필요합니다." };
      }
    },
    {
      id: "p2_4",
      level: 3,
      grade: "중1 기본",
      grammar: "조동사 should 의무·충고",
      korean: "너는 매일 아침 따뜻한 물을 마셔야 한다.",
      conditions: ["'drink warm water every morning', 'You'를 사용할 것", "충고의 조동사 should와 동사원형을 사용할 것"],
      placeholder: "You should drink warm water every morning.",
      sample: "You should drink warm water every morning.",
      explanation: "충고나 권유를 나타낼 때는 조동사 should 뒤에 동사원형(drink)을 씁니다.",
      checkGrammar: (rawAns, tokens) => {
        if (tokens.includes("should") && tokens.includes("drink")) {
          return { ok: true, praise: "✅ 충고의 조동사 should와 동사원형 drink를 완벽하게 구사했습니다!" };
        }
        return { ok: false, error: "❌ 조동사 구문 오류: 'should drink' (should + 동사원형) 구조가 필요합니다." };
      }
    }
  ],
  slot3: [
    {
      id: "p3_1",
      level: 5,
      grade: "중2 실전",
      grammar: "현재완료 계속적 용법 (have + p.p.)",
      korean: "나는 3년 동안 대구에 살아왔다.",
      conditions: ["'live in Daegu', 'for three years', 'I'를 사용할 것", "현재완료 시제(have + p.p.)를 사용할 것"],
      placeholder: "I have lived in Daegu for three years.",
      sample: "I have lived in Daegu for three years.",
      explanation: "과거부터 지금까지 지속되는 상태이므로 현재완료 have lived를 씁니다.",
      checkGrammar: (rawAns, tokens) => {
        if (/have\s+lived/i.test(rawAns)) {
          return { ok: true, praise: "✅ 과거부터 지금까지 3년간 지속된 현재완료 시제(have lived)를 정확하게 구사했습니다!" };
        }
        if (/have\s+live\b/i.test(rawAns)) {
          return { ok: false, error: "❌ 과거분사(p.p.) 형태 오류: have 뒤에는 동사원형이 아닌 과거분사 'lived'를 써야 합니다." };
        }
        if (tokens.includes("lived")) {
          return { ok: false, error: "❌ 시제 오류: 과거부터 지금까지 3년간 지속된 상태이므로 단순 과거(lived)가 아닌 현재완료 'have lived'를 써야 합니다." };
        }
        return { ok: false, error: "❌ 현재완료 구문 오류: 'have lived' (have + p.p.) 형태가 필요합니다." };
      }
    },
    {
      id: "p3_2",
      level: 5,
      grade: "중2 실전",
      grammar: "단순 과거 수동태 (was/were + p.p.)",
      korean: "그 깨끗한 창문은 어제 민호에 의해 깨졌다.",
      conditions: ["'The clean window', 'break', 'by Minho yesterday'를 사용할 것", "단수 과거 수동태(was + p.p.)를 사용할 것"],
      placeholder: "The clean window was broken by Minho yesterday.",
      sample: "The clean window was broken by Minho yesterday.",
      explanation: "창문이 깨짐을 당한 수동의 의미이며 단수 과거이므로 was broken을 씁니다.",
      checkGrammar: (rawAns, tokens) => {
        if (/was\s+broken/i.test(rawAns)) {
          return { ok: true, praise: "✅ 단수 과거 수동태(was broken) 및 행위자 by 구문을 완벽하게 작성했습니다!" };
        }
        if (/were\s+broken/i.test(rawAns)) {
          return { ok: false, error: "❌ 수동태 be동사 수 일치 오류: 주어(The clean window)가 단수이므로 were가 아닌 'was broken'을 써야 합니다." };
        }
        if (/broke/i.test(rawAns)) {
          return { ok: false, error: "❌ 수동태 태 오류: 창문이 깨진 것이므로 능동태(broke)가 아닌 수동태 'was broken'을 써야 합니다." };
        }
        return { ok: false, error: "❌ 수동태 구문 오류: 'was broken' (was + p.p.) 형태가 필요합니다." };
      }
    },
    {
      id: "p3_3",
      level: 5,
      grade: "중2 실전",
      grammar: "5형식 사역동사 (make + 목적어 + 동사원형)",
      korean: "우리 엄마는 내가 매일 내 방을 청소하게 하신다.",
      conditions: ["'My mom', 'make', 'clean my room every day', 'me'를 사용할 것", "사역동사의 목적격 보어로 동사원형을 쓸 것"],
      placeholder: "My mom makes me clean my room every day.",
      sample: "My mom makes me clean my room every day.",
      explanation: "사역동사 make의 목적격 보어로는 to부정사가 아닌 동사원형(clean)을 쓰며, 주어가 단수이므로 makes입니다.",
      checkGrammar: (rawAns, tokens) => {
        const hasMakes = tokens.includes("makes") || /makes/i.test(rawAns);
        const hasClean = /me\s+clean/i.test(rawAns);
        if (hasMakes && hasClean) {
          return { ok: true, praise: "✅ 사역동사 makes와 목적격 보어인 동사원형 clean을 완벽하게 구사했습니다!" };
        }
        if (!hasMakes) {
          return { ok: false, error: "❌ 3인칭 단수 일치 오류: 주어 My mom에 맞추어 사역동사는 'makes'로 써야 합니다." };
        }
        if (/me\s+to\s+clean/i.test(rawAns)) {
          return { ok: false, error: "❌ 사역동사 목적격 보어 오류: 사역동사 make 뒤에는 to clean이 아닌 동사원형 'clean'을 씁니다." };
        }
        return { ok: false, error: "❌ 5형식 사역동사 구문('makes me clean')이 올바르지 않습니다." };
      }
    },
    {
      id: "p3_4",
      level: 5,
      grade: "중2 실전",
      grammar: "현재완료 경험적 용법 (have never + p.p.)",
      korean: "나는 전에 파리를 방문해 본 적이 결코 없다.",
      conditions: ["'visit Paris before', 'never', 'I'를 사용할 것", "현재완료 경험의 부정형(have never + p.p.)을 사용할 것"],
      placeholder: "I have never visited Paris before.",
      sample: "I have never visited Paris before.",
      explanation: "경험의 부정을 나타낼 때는 have never + 과거분사(visited)를 씁니다.",
      checkGrammar: (rawAns, tokens) => {
        if (/have\s+never\s+visited/i.test(rawAns)) {
          return { ok: true, praise: "✅ 현재완료 경험의 부정 형태인 'have never visited'를 정확히 구사했습니다!" };
        }
        return { ok: false, error: "❌ 현재완료 경험 부정은 'have never visited' (have never + p.p.) 형태로 작성해야 합니다." };
      }
    }
  ],
  slot4: [
    {
      id: "p4_1",
      level: 7,
      grade: "중2/3 심화",
      grammar: "주격 관계대명사 및 수 일치",
      korean: "나는 영어를 가르치는 그 친절한 선생님을 좋아한다.",
      conditions: ["'I like the kind teacher', 'teach English'를 사용할 것", "주격 관계대명사 who를 사용하고, 관계사절 동사의 수 일치에 주의할 것"],
      placeholder: "I like the kind teacher who teaches English.",
      sample: "I like the kind teacher who teaches English.",
      explanation: "선행사 the kind teacher가 3인칭 단수이므로 관계사절 동사는 teaches가 되어야 합니다.",
      checkGrammar: (rawAns, tokens) => {
        const hasWho = tokens.includes("who") || tokens.includes("that");
        const hasWhich = tokens.includes("which");
        const hasTeaches = tokens.includes("teaches");
        const hasTeach = tokens.includes("teach") && !hasTeaches;
        if (hasWho && hasTeaches) {
          return { ok: true, praise: "✅ 주격 관계대명사(who)와 선행사 단수 수 일치(teaches)를 완벽히 반영했습니다!" };
        }
        if (hasWhich) {
          return { ok: false, error: "❌ 관계대명사 선택 오류: 선행사가 사람이므로 'which'가 아닌 'who'(또는 'that')를 써야 합니다." };
        }
        if (hasTeach) {
          return { ok: false, error: "❌ 관계사절 동사 수 일치 오류: 선행사 the kind teacher가 단수이므로 'teaches'로 써야 합니다." };
        }
        return { ok: false, error: "❌ 주격 관계대명사 구문('who teaches')이 올바르지 않습니다." };
      }
    },
    {
      id: "p4_2",
      level: 7,
      grade: "중2/3 심화",
      grammar: "목적격 관계대명사 (which / that)",
      korean: "이것은 내가 어제 서점에서 샀던 그 재미있는 책이다.",
      conditions: ["'This is the interesting book', 'buy at the bookstore yesterday', 'I'를 사용할 것", "사물 목적격 관계대명사 which(또는 that)와 과거 시제를 사용할 것"],
      placeholder: "This is the interesting book which I bought at the bookstore yesterday.",
      sample: "This is the interesting book which I bought at the bookstore yesterday.",
      explanation: "선행사가 사물이므로 목적격 관계대명사 which(또는 that)를 쓰며 과거 시제 bought를 씁니다.",
      checkGrammar: (rawAns, tokens) => {
        const hasRel = tokens.includes("which") || tokens.includes("that") || /(which|that)\s+i\s+bought/i.test(rawAns);
        const hasBought = tokens.includes("bought");
        if (hasRel && hasBought) {
          return { ok: true, praise: "✅ 사물 목적격 관계대명사(which/that)와 과거 시제 bought를 완벽하게 연결했습니다!" };
        }
        if (!hasBought) {
          return { ok: false, error: "❌ 시제 오류: 어제 일어난 일이므로 buy가 아닌 과거형 'bought'를 써야 합니다." };
        }
        return { ok: false, error: "❌ 목적격 관계대명사 which(또는 that)가 누락되었습니다." };
      }
    },
    {
      id: "p4_3",
      level: 7,
      grade: "중2/3 심화",
      grammar: "관계부사 where (장소 선행사)",
      korean: "이곳은 우리가 매주 일요일에 축구를 했던 그 공원이다.",
      conditions: ["'This is the park', 'we played soccer every Sunday'를 사용할 것", "장소 선행사를 수식하는 관계부사 where를 사용할 것"],
      placeholder: "This is the park where we played soccer every Sunday.",
      sample: "This is the park where we played soccer every Sunday.",
      explanation: "장소를 나타내는 선행사 the park 뒤에는 완전한 절을 이끄는 관계부사 where를 씁니다.",
      checkGrammar: (rawAns, tokens) => {
        if (/where\s+we\s+played/i.test(rawAns) || (tokens.includes("where") && tokens.includes("played"))) {
          return { ok: true, praise: "✅ 장소 선행사에 알맞은 관계부사 where와 완전한 문장 구조를 완벽히 연결했습니다!" };
        }
        return { ok: false, error: "❌ 관계부사 구문 오류: 장소 선행사 the park 뒤에는 'where'를 사용해야 합니다." };
      }
    },
    {
      id: "p4_4",
      level: 7,
      grade: "중2/3 심화",
      grammar: "간접의문문 어순 (의문사 + 주어 + 동사)",
      korean: "너는 그녀가 어디에 사는지 아니?",
      conditions: ["'Do you know', 'where', 'she live'를 사용할 것", "간접의문문의 어순(의문사 + 주어 + 동사)과 3인칭 단수 수 일치에 주의할 것"],
      placeholder: "Do you know where she lives?",
      sample: "Do you know where she lives?",
      explanation: "간접의문문은 [의문사 + 주어 + 동사] 어순을 따르며, 주어 she에 맞춰 lives로 씁니다.",
      checkGrammar: (rawAns, tokens) => {
        if (/where\s+she\s+lives/i.test(rawAns)) {
          return { ok: true, praise: "✅ 간접의문문 어순 [where + she + lives]을 완벽히 맞추었습니다!" };
        }
        if (/where\s+does\s+she\s+live/i.test(rawAns)) {
          return { ok: false, error: "❌ 간접의문문 어순 오류: 직접의문문 어순이 아닌 [의문사 + 주어 + 동사]인 'where she lives'로 써야 합니다." };
        }
        if (/where\s+she\s+live\b/i.test(rawAns)) {
          return { ok: false, error: "❌ 3인칭 단수 수 일치 오류: 주어가 she이므로 live 뒤에 -s를 붙여 'lives'로 써야 합니다." };
        }
        return { ok: false, error: "❌ 간접의문문 어순('where she lives')이 올바르지 않습니다." };
      }
    }
  ],
  slot5: [
    {
      id: "p5_1",
      level: 8,
      grade: "중3 킬러",
      grammar: "가정법 과거 be동사 오류 수정",
      korean: "If I ⓐwas rich, I ⓑwould buy that big house.",
      isCorrection: true,
      conditions: ["위 문장에서 어법상 틀린 기호(a 또는 b)를 고르고, 올바른 형태로 고쳐 쓰시오."],
      sampleSymbol: "a (또는 ⓐ)",
      sampleCorrection: "were",
      explanation: "가정법 과거에서 be동사는 주어 인칭과 상관없이 were를 쓰는 것이 원칙입니다.",
      checkSymbol: (sym) => normalizeSymbol(sym) === 'a',
      checkCorrection: (corr) => /were/i.test(corr),
      symbolErrorMsg: "was가 포함된 '(a)'를 골라야 합니다.",
      correctionErrorMsg: "가정법 과거 if절의 be동사는 'were'로 써야 합니다.",
      correctionPraise: "가정법 과거 be동사 'were'로 올바르게 수정했습니다!"
    },
    {
      id: "p5_2",
      level: 8,
      grade: "중3 킬러",
      grammar: "관계대명사 what vs that 오류 수정",
      korean: "This book is ⓐthat I ⓑwanted to read.",
      isCorrection: true,
      conditions: ["선행사를 포함한 관계대명사 규칙에 맞추어 틀린 기호와 올바른 형태를 쓰시오."],
      sampleSymbol: "a (또는 ⓐ)",
      sampleCorrection: "what",
      explanation: "앞에 선행사가 없고 read의 목적어가 없는 불완전한 절이 오므로 that이 아닌 what을 써야 합니다.",
      checkSymbol: (sym) => normalizeSymbol(sym) === 'a',
      checkCorrection: (corr) => /what/i.test(corr),
      symbolErrorMsg: "that이 포함된 '(a)'를 골라야 합니다.",
      correctionErrorMsg: "선행사를 포함하는 관계대명사는 'what'이어야 합니다.",
      correctionPraise: "선행사를 포함한 관계대명사 'what'으로 정확히 수정했습니다!"
    },
    {
      id: "p5_3",
      level: 8,
      grade: "중3 킬러",
      grammar: "분사구문 능동 현재분사 오류 수정",
      korean: "ⓐSeen him on the street, Minho ⓑsmiled brightly.",
      isCorrection: true,
      conditions: ["분사의 능동/수동 관계에 맞추어 틀린 기호와 올바른 형태를 쓰시오."],
      sampleSymbol: "a (또는 ⓐ)",
      sampleCorrection: "Seeing",
      explanation: "주절의 주어 Minho가 그를 '보는' 능동의 관계이므로 과거분사 Seen이 아닌 현재분사 Seeing을 써야 합니다.",
      checkSymbol: (sym) => normalizeSymbol(sym) === 'a',
      checkCorrection: (corr) => /seeing/i.test(corr),
      symbolErrorMsg: "Seen이 포함된 '(a)'를 골라야 합니다.",
      correctionErrorMsg: "능동 의미의 분사구문이므로 'Seeing'으로 고쳐야 합니다.",
      correctionPraise: "능동 의미의 현재분사 'Seeing'으로 완벽히 수정했습니다!"
    },
    {
      id: "p5_4",
      level: 8,
      grade: "중3 킬러",
      grammar: "부정어 도치 구문 일반동사 did 오류 수정",
      korean: "Little ⓐhe knew that she ⓑwas a famous writer.",
      isCorrection: true,
      conditions: ["부정어 도치 규칙에 맞추어 틀린 기호와 올바른 형태를 쓰시오."],
      sampleSymbol: "a (또는 ⓐ)",
      sampleCorrection: "did he know",
      explanation: "부정어 Little이 문두에 오면 [조동사(did) + 주어 + 동사원형]으로 도치되므로 did he know가 되어야 합니다.",
      checkSymbol: (sym) => normalizeSymbol(sym) === 'a',
      checkCorrection: (corr) => /did\s+he\s+know/i.test(corr),
      symbolErrorMsg: "he knew가 포함된 '(a)'를 골라야 합니다.",
      correctionErrorMsg: "부정어 도치이므로 [did + 주어 + 동사원형]인 'did he know'로 고쳐야 합니다.",
      correctionPraise: "부정어 도치 어순 'did he know'로 훌륭하게 수정했습니다!"
    }
  ]
};

// 매 진단 시도마다 슬롯별 1문제씩 무작위 추출하여 신선한 문제 세트 구성
function pickRandomPlacementQuestions() {
  const q1 = PLACEMENT_POOL.slot1[Math.floor(Math.random() * PLACEMENT_POOL.slot1.length)];
  const q2 = PLACEMENT_POOL.slot2[Math.floor(Math.random() * PLACEMENT_POOL.slot2.length)];
  const q3 = PLACEMENT_POOL.slot3[Math.floor(Math.random() * PLACEMENT_POOL.slot3.length)];
  const q4 = PLACEMENT_POOL.slot4[Math.floor(Math.random() * PLACEMENT_POOL.slot4.length)];
  const q5 = PLACEMENT_POOL.slot5[Math.floor(Math.random() * PLACEMENT_POOL.slot5.length)];
  state.currentPlacementQuestions = [q1, q2, q3, q4, q5];
  return state.currentPlacementQuestions;
}

function openPlacementModal() {
  const modal = document.getElementById("placement-modal");
  if (!modal) return;
  pickRandomPlacementQuestions();
  renderPlacementTestQuestions();
  modal.classList.remove("hidden");
}

function closePlacementModal() {
  const modal = document.getElementById("placement-modal");
  if (modal) modal.classList.add("hidden");
}

function renderPlacementTestQuestions() {
  const body = document.getElementById("placement-body");
  const footer = document.getElementById("placement-footer");
  if (!body) return;

  if (!state.currentPlacementQuestions || state.currentPlacementQuestions.length === 0) {
    pickRandomPlacementQuestions();
  }
  const questions = state.currentPlacementQuestions;

  if (footer) {
    footer.innerHTML = `
      <div class="flex items-center justify-between w-full">
        <div class="text-xs text-gray-500">💡 1,024가지 무작위 조합 문항으로 정밀 진단합니다!</div>
        <button onclick="submitPlacementTest()" class="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs transition-all shadow-md flex items-center gap-1.5">
          <span>🚀</span> 진단 결과 확인 및 맞춤 레벨 분석
        </button>
      </div>
    `;
  }

  body.innerHTML = questions.map((q, idx) => `
    <div class="p-4 rounded-2xl border border-gray-200 bg-white space-y-2.5 shadow-2xs">
      <div class="flex items-center justify-between border-b pb-2">
        <div class="flex items-center gap-2">
          <span class="w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 font-extrabold text-xs flex items-center justify-center">Q${idx + 1}</span>
          <span class="text-xs font-bold text-gray-800">${q.grammar}</span>
        </div>
        <span class="text-[10px] font-semibold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-md">${q.grade} (20점)</span>
      </div>
      <div>
        <div class="text-[11px] text-gray-400 font-bold">[문제 해석 / 지문]</div>
        <div class="text-sm font-bold text-gray-900">${q.korean}</div>
      </div>
      <div class="bg-gray-50 p-2.5 rounded-xl border border-gray-100 text-[11px] text-gray-600 space-y-0.5">
        <div class="font-bold text-gray-700">📌 영작 조건:</div>
        ${q.conditions.map(c => `<div>• ${c}</div>`).join("")}
      </div>
      ${q.isCorrection ? `
        <div class="grid grid-cols-2 gap-2 pt-1">
          <div>
            <label class="text-[11px] font-bold text-gray-600 mb-1 block">틀린 기호 (예: a 또는 b):</label>
            <input type="text" id="p-ans-sym-${q.id}" placeholder="a" class="w-full px-3 py-2 text-xs border rounded-xl font-mono focus:outline-indigo-500 bg-white">
          </div>
          <div>
            <label class="text-[11px] font-bold text-gray-600 mb-1 block">올바른 수정 형태:</label>
            <input type="text" id="p-ans-corr-${q.id}" placeholder="were" class="w-full px-3 py-2 text-xs border rounded-xl font-mono focus:outline-indigo-500 bg-white">
          </div>
        </div>
      ` : `
        <div class="pt-1">
          <input type="text" id="p-ans-${q.id}" placeholder="여기에 영어로 작성하세요..." class="w-full px-3.5 py-2.5 text-xs border rounded-xl font-mono focus:outline-indigo-500 bg-white">
        </div>
      `}
    </div>
  `).join("");
}

function levenshteinDistJS(s1, s2) {
  if (s1.length < s2.length) return levenshteinDistJS(s2, s1);
  if (s2.length === 0) return s1.length;
  let prev = Array.from({ length: s2.length + 1 }, (_, i) => i);
  for (let i = 0; i < s1.length; i++) {
    let curr = [i + 1];
    for (let j = 0; j < s2.length; j++) {
      let ins = prev[j + 1] + 1;
      let del = curr[j] + 1;
      let sub = prev[j] + (s1[i] !== s2[j] ? 1 : 0);
      curr.push(Math.min(ins, del, sub));
    }
    prev = curr;
  }
  return prev[s2.length];
}

function cleanTokensJS(text) {
  if (!text) return [];
  return text.toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9'\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function diagnosePlacementQuestion(q, userAns, userSym, userCorr) {
  if (q.isCorrection) {
    const sym = (userSym || "").trim();
    const corr = (userCorr || "").trim();
    const isSymCorrect = q.checkSymbol ? q.checkSymbol(sym) : (normalizeSymbol(sym) === 'a');
    const isCorrCorrect = q.checkCorrection ? q.checkCorrection(corr) : (/were/i.test(corr));

    let praises = [];
    let errors = [];
    let score = 0;

    if (isSymCorrect) {
      praises.push("✅ 틀린 부분 기호 '(a)'를 정확하게 찾아냈습니다!");
      score += 10;
    } else {
      errors.push(`❌ 틀린 기호 오류: ${q.symbolErrorMsg || "was가 포함된 '(a)'를 골라야 합니다."} (작성한 기호: '${sym || "미작성"}')`);
    }

    if (isCorrCorrect) {
      praises.push(`✅ ${q.correctionPraise || "올바르게 수정했습니다!"}`);
      score += 10;
    } else {
      errors.push(`❌ 수정 형태 오류: ${q.correctionErrorMsg || "올바른 형태가 아닙니다."} (작성한 형태: '${corr || "미작성"}')`);
    }

    let statusText = "✕ 오답 (0점)";
    let badgeClass = "text-pink-600 bg-pink-50 border border-pink-200";
    if (score === 20) {
      statusText = "✓ 완벽한 정답! (+20점)";
      badgeClass = "text-emerald-600 bg-emerald-50 border border-emerald-200";
    } else if (score > 0) {
      statusText = `⚠️ 부분 정답 (+${score}점)`;
      badgeClass = "text-amber-600 bg-amber-50 border border-amber-200";
    }

    const userDisplay = `기호: ${sym || '(미작성)'} ➔ 수정: ${corr || '(미작성)'}`;
    const sampleDisplay = `기호: ${q.sampleSymbol} / 수정: ${q.sampleCorrection}`;

    return {
      score,
      statusText,
      badgeClass,
      praises,
      errors,
      userDisplay,
      sampleDisplay,
      explanation: q.explanation
    };
  }

  // 문장 영작 문항
  const rawAns = (userAns || "").trim();
  if (!rawAns) {
    return {
      score: 0,
      statusText: "✕ 미작성 (0점)",
      badgeClass: "text-gray-500 bg-gray-100 border border-gray-200",
      praises: [],
      errors: ["답안이 입력되지 않았습니다."],
      userDisplay: "(미작성)",
      sampleDisplay: q.sample,
      explanation: q.explanation
    };
  }

  const stuTokens = cleanTokensJS(rawAns);
  const sampleTokens = cleanTokensJS(q.sample);
  let praises = [];
  let errors = [];
  let score = 20;

  // 문항별 고유 문법 로직 검사
  if (q.checkGrammar) {
    const gRes = q.checkGrammar(rawAns, stuTokens);
    if (gRes.ok) {
      praises.push(gRes.praise);
    } else {
      errors.push(gRes.error);
      score -= 15;
    }
  }

  // 실시간 철자(스펠링) 오타 감지 (Levenshtein & Anagram)
  let typoMap = {};
  for (let samWord of sampleTokens) {
    if (stuTokens.includes(samWord)) continue;
    for (let stuWord of stuTokens) {
      if (sampleTokens.includes(stuWord)) continue;
      if (typoMap[stuWord]) continue;

      const isAnagram = (stuWord.length === samWord.length && stuWord.split("").sort().join("") === samWord.split("").sort().join(""));
      const dist = levenshteinDistJS(stuWord, samWord);
      const isClose = (samWord.length >= 4 && dist <= 2) || (samWord.length <= 3 && dist === 1);

      const isInflection = (
        stuWord + 's' === samWord || stuWord + 'es' === samWord ||
        samWord + 's' === stuWord || samWord + 'es' === stuWord ||
        stuWord + 'd' === samWord || stuWord + 'ed' === samWord ||
        samWord + 'd' === stuWord || samWord + 'ed' === stuWord
      );

      if ((isAnagram || isClose) && !isInflection) {
        typoMap[stuWord] = samWord;
        errors.push(`❌ 단어 철자(스펠링) 오류: '${stuWord}' ➔ 올바른 철자는 '${samWord}'입니다.`);
        score -= 5;
        break;
      }
    }
  }

  // 필수 단어 누락 검사 (오타로 매핑된 단어 제외)
  const typoCorrectWords = Object.values(typoMap);
  for (let samWord of sampleTokens) {
    if (!stuTokens.includes(samWord) && !typoCorrectWords.includes(samWord)) {
      if (["gets", "get", "teaches", "teach", "are", "is", "has", "have", "cannot", "can't", "play", "went", "smells", "should", "lived", "live", "broken", "makes", "never", "who", "which", "where", "lives"].includes(samWord)) {
        continue;
      }
      errors.push(`⚠️ 필수 단어 누락: '${samWord}' 단어가 빠져 있습니다.`);
      score -= 5;
    }
  }

  // 문장 부호 및 대소문자 (Mechanics)
  if (!/^[A-Z]/.test(rawAns)) {
    errors.push("⚠️ 문장 시작 첫 글자는 대문자로 작성해야 합니다.");
    score -= 2;
  }
  if (!/[.!?]$/.test(rawAns)) {
    errors.push("⚠️ 문장 끝에는 마침표(.) 등 문장부호가 필요합니다.");
    score -= 2;
  }

  score = Math.max(0, Math.min(20, score));

  // 사용자 답안 시각적 하이라이트 생성
  let highlightedWords = rawAns.split(/\s+/).map(rawWord => {
    const cleanW = rawWord.toLowerCase().replace(/[^a-z0-9']/g, "");
    if (typoMap[cleanW]) {
      return `<span class="bg-rose-100 text-rose-800 font-bold px-1.5 py-0.5 rounded border border-rose-300 line-through">${rawWord}</span> <span class="text-emerald-700 font-extrabold text-[11px]">(➔ ${typoMap[cleanW]})</span>`;
    }
    if (["gets", "teaches", "are", "has", "cannot", "can't", "went", "smells", "should", "lived", "broken", "makes", "who", "which", "where", "lives"].includes(cleanW)) {
      return `<span class="bg-emerald-100 text-emerald-800 font-bold px-1.5 py-0.5 rounded border border-emerald-300">${rawWord}</span>`;
    }
    if (["get", "teach", "is", "have", "live", "broke", "make"].includes(cleanW)) {
      return `<span class="bg-amber-100 text-amber-900 font-bold px-1.5 py-0.5 rounded border border-amber-300">${rawWord}</span>`;
    }
    return rawWord;
  });

  let statusText = "✕ 오답 (0점)";
  let badgeClass = "text-pink-600 bg-pink-50 border border-pink-200";
  if (score === 20) {
    statusText = "✓ 완벽한 정답! (+20점)";
    badgeClass = "text-emerald-600 bg-emerald-50 border border-emerald-200";
  } else if (score >= 15) {
    statusText = `⚠️ 부분 정답 (+${score}점) - 핵심 문법 완성 / 철자 보완`;
    badgeClass = "text-amber-600 bg-amber-50 border border-amber-200";
  } else if (score > 0) {
    statusText = `⚠️ 부분 점수 (+${score}점) - 문법 보완 필요`;
    badgeClass = "text-amber-600 bg-amber-50 border border-amber-200";
  }

  return {
    score,
    statusText,
    badgeClass,
    praises,
    errors,
    userDisplay: highlightedWords.join(" "),
    sampleDisplay: q.sample,
    explanation: q.explanation
  };
}

function renderPlacementLevelSelector(recLevel) {
  const container = document.getElementById("placement-level-options");
  if (!container) return;

  const currentSelected = state.selectedPlacementLevel || 1;
  let html = "";
  for (let lvl = 1; lvl <= recLevel; lvl++) {
    const isSel = lvl === currentSelected;
    const isRec = lvl === recLevel;
    const title = LEVEL_TITLES[lvl - 1] || "영작러";
    let gradeBadge = "중1 기초";
    if (lvl >= 7) gradeBadge = "중3 킬러";
    else if (lvl >= 4) gradeBadge = "중2 실전";

    html += `
      <div onclick="selectPlacementStartLevel(${lvl})" class="p-3 rounded-2xl border-2 transition-all cursor-pointer flex flex-col justify-between ${isSel ? 'border-indigo-600 bg-indigo-50/90 shadow-sm ring-2 ring-indigo-300' : 'border-gray-200 bg-white hover:border-indigo-300'}">
        <div class="flex items-center justify-between">
          <span class="text-xs font-black ${isSel ? 'text-indigo-700' : 'text-gray-800'}">Lv.${lvl}</span>
          ${isRec ? '<span class="text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded font-extrabold">🌟 권장</span>' : (lvl === 1 ? '<span class="text-[10px] bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded font-bold">🌱 기초</span>' : '')}
        </div>
        <div class="text-[11px] font-bold text-gray-800 truncate mt-1">${title}</div>
        <div class="text-[10px] text-gray-400 mt-0.5 font-medium">${gradeBadge}</div>
      </div>
    `;
  }
  container.innerHTML = html;

  const confirmBtn = document.getElementById("placement-confirm-btn");
  if (confirmBtn) {
    const chosenTitle = LEVEL_TITLES[currentSelected - 1] || "영작러";
    confirmBtn.innerHTML = `<span>🚀</span> [Lv.${currentSelected} ${chosenTitle}]으로 학습 시작하기`;
  }
}

function selectPlacementStartLevel(lvl) {
  state.selectedPlacementLevel = lvl;
  renderPlacementLevelSelector(state.lastPlacementRecLevel || 1);
}

function submitPlacementTest() {
  let score = 0;
  let results = [];
  const questions = state.currentPlacementQuestions || [];

  questions.forEach(q => {
    let diag;
    if (q.isCorrection) {
      const sym = (document.getElementById(`p-ans-sym-${q.id}`)?.value || "").trim();
      const corr = (document.getElementById(`p-ans-corr-${q.id}`)?.value || "").trim();
      diag = diagnosePlacementQuestion(q, "", sym, corr);
    } else {
      const ans = (document.getElementById(`p-ans-${q.id}`)?.value || "").trim();
      diag = diagnosePlacementQuestion(q, ans, "", "");
    }

    score += diag.score;
    results.push({
      ...q,
      ...diag
    });
  });

  let recLevel = 1;
  let recTitle = "새싹 영작러";
  let recTrack = "track1";
  let recTrackName = "중1 기초 완성 트랙";
  let evaluationSummary = "";

  if (score >= 80) {
    recLevel = 7;
    recTitle = "동도중 에이스";
    recTrack = "track3";
    recTrackName = "중3·수성구 킬러 심화 트랙";
    evaluationSummary = "🔥 뛰어난 실력입니다! 관계사 수일치와 가정법까지 완벽히 이해하고 있어, 중3·수성구 킬러 심화 트랙에서 바로 고난도 영작을 시작하는 것을 추천합니다.";
  } else if (score >= 40) {
    recLevel = 4;
    recTitle = "문법 탐험가";
    recTrack = "track2";
    recTrackName = "중2 실전 서술형 트랙";
    evaluationSummary = "👍 탄탄한 기본기를 갖추고 있습니다! 현재완료, 수동태 등 중2 핵심 지필평가 서술형 트랙부터 시작하면 빠르게 상위권으로 도약할 수 있습니다.";
  } else {
    recLevel = 1;
    recTitle = "새싹 영작러";
    recTrack = "track1";
    recTrackName = "중1 기초 완성 트랙";
    evaluationSummary = "🌱 영어 문장의 기본 뼈대와 3인칭 단수 -s 규칙부터 차근차근 다져나가면 감점 없는 완벽한 영작러가 될 수 있습니다.";
  }

  state.lastPlacementRecLevel = recLevel;
  state.lastPlacementScore = score;
  state.selectedPlacementLevel = 1; // 기본값은 기초부터 탄탄히 다질 수 있도록 Lv.1로 제안

  const body = document.getElementById("placement-body");
  const footer = document.getElementById("placement-footer");

  body.innerHTML = `
    <!-- 상단 진단 결과 카드 -->
    <div class="p-5 rounded-3xl bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 text-white shadow-lg space-y-3">
      <div class="flex items-center justify-between">
        <span class="text-xs font-bold bg-white/20 px-3 py-1 rounded-full border border-white/20">진단평가 정밀 채점 완료</span>
        <span class="text-2xl font-black">${score}점 / 100점</span>
      </div>
      <div>
        <h4 class="text-lg font-extrabold flex items-center gap-2">
          <span>🎯 진단 권장 레벨:</span>
          <span class="text-yellow-300">Lv.${recLevel} ${recTitle}</span>
          <span class="text-xs bg-white/20 px-2 py-0.5 rounded-full">(${recTrackName})</span>
        </h4>
        <p class="text-xs text-indigo-100 leading-relaxed mt-1">
          ${evaluationSummary}
        </p>
      </div>
      <div class="text-[11px] text-white/80 bg-black/20 p-2.5 rounded-xl border border-white/10 flex items-center justify-between">
        <span>💾 회원님의 진단 이력(권장 Lv.${recLevel})이 프로필에 영구 보존되었습니다.</span>
      </div>
    </div>

    <!-- 시작 레벨 유연 선택 UI (Lv.1 ~ 권장 레벨) -->
    <div class="p-4 rounded-2xl bg-indigo-50/70 border border-indigo-200/80 space-y-3 shadow-2xs">
      <div class="flex items-center justify-between">
        <div class="font-extrabold text-sm text-indigo-950 flex items-center gap-1.5">
          <span>🌱</span> 실제 학습 시작 레벨 선택 (Lv.1 ~ 권장 Lv.${recLevel})
        </div>
        <span class="text-[10px] text-indigo-600 bg-white px-2 py-0.5 rounded-full font-bold border border-indigo-100">원하는 레벨 클릭</span>
      </div>
      <p class="text-xs text-indigo-900/80 leading-relaxed">
        진단 결과 회원님의 권장 실력은 <strong>Lv.${recLevel} ${recTitle}</strong>이지만,
        기초부터 탄탄하게 복습하고 싶다면 <strong>Lv.1</strong>부터 권장 레벨 사이의 원하는 레벨을 직접 선택하여 시작할 수 있습니다.
      </p>
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1" id="placement-level-options">
        <!-- renderPlacementLevelSelector에서 동적 렌더링 -->
      </div>
    </div>

    <!-- 문항별 상세 실시간 정밀 채점 결과 -->
    <div class="space-y-3 pt-1">
      <h4 class="font-bold text-xs text-gray-700">문항별 상세 실시간 진단 및 해설:</h4>
      ${results.map((r, idx) => `
        <div class="p-4 rounded-2xl border ${r.score === 20 ? 'border-emerald-200 bg-emerald-50/30' : (r.score >= 15 ? 'border-amber-200 bg-amber-50/20' : 'border-rose-200 bg-rose-50/20')} space-y-2.5 text-xs shadow-2xs">
          <div class="flex items-center justify-between border-b pb-2">
            <div class="flex items-center gap-2">
              <span class="w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 font-extrabold text-xs flex items-center justify-center">Q${idx + 1}</span>
              <span class="font-extrabold text-gray-800 text-sm">${r.grammar}</span>
              <span class="text-[10px] text-gray-500 bg-gray-100 px-2 py-0.5 rounded">${r.grade}</span>
            </div>
            <span class="text-xs font-extrabold px-2.5 py-0.5 rounded-full ${r.badgeClass}">${r.statusText}</span>
          </div>

          <!-- 내 답안과 모범 답안 비교 -->
          <div class="space-y-1.5 bg-white/95 p-3 rounded-xl border border-gray-100 shadow-2xs">
            <div class="flex items-start gap-2">
              <span class="text-gray-400 font-bold w-16 flex-shrink-0 pt-0.5">내 답안:</span>
              <div class="font-mono text-gray-900 font-medium leading-relaxed">${r.userDisplay}</div>
            </div>
            <div class="flex items-start gap-2 pt-1 border-t border-gray-50">
              <span class="text-indigo-600 font-bold w-16 flex-shrink-0 pt-0.5">모범 답안:</span>
              <span class="font-mono font-bold text-gray-800 select-all leading-relaxed">${r.sampleDisplay}</span>
            </div>
          </div>

          <!-- 실시간 정밀 피드백 (칭찬 및 오류 지적) -->
          <div class="space-y-1.5 pt-1">
            <div class="text-[11px] font-bold text-indigo-700 flex items-center gap-1">
              <span>🎯 작성 답안 실시간 정밀 분석:</span>
            </div>
            ${r.praises.map(p => `
              <div class="text-xs text-emerald-900 bg-emerald-50 px-3 py-1.5 rounded-xl border border-emerald-200 flex items-start gap-1.5 font-medium">
                <span>${p}</span>
              </div>
            `).join("")}
            ${r.errors.map(e => `
              <div class="text-xs text-rose-900 bg-rose-50 px-3 py-1.5 rounded-xl border border-rose-200 flex items-start gap-1.5 font-medium">
                <span>${e}</span>
              </div>
            `).join("")}
          </div>

          <!-- 핵심 문법 가이드 -->
          <div class="text-[11px] text-gray-600 bg-indigo-50/40 p-2.5 rounded-xl border border-indigo-100/60 leading-relaxed">
            <span class="font-bold text-indigo-700">💡 핵심 문법 가이드:</span> ${r.explanation}
          </div>
        </div>
      `).join("")}
    </div>
  `;

  if (footer) {
    footer.innerHTML = `
      <div class="flex items-center justify-between w-full gap-2">
        <button onclick="pickRandomPlacementQuestions(); renderPlacementTestQuestions();" class="px-4 py-2.5 border border-gray-300 rounded-xl text-xs font-bold text-gray-700 hover:bg-gray-100 transition-all flex items-center gap-1">
          <span>🔄</span> 새로운 문제로 다시 진단하기
        </button>
        <button id="placement-confirm-btn" onclick="applyChosenPlacementLevel()" class="px-5 py-2.5 bg-gradient-to-r from-emerald-500 to-indigo-600 hover:from-emerald-600 hover:to-indigo-700 text-white font-extrabold rounded-xl text-xs transition-all shadow-md flex items-center gap-1.5">
          <span>🚀</span> [Lv.1 ${LEVEL_TITLES[0]}]으로 학습 시작하기
        </button>
      </div>
    `;
  }

  renderPlacementLevelSelector(recLevel);
}

async function applyChosenPlacementLevel() {
  const selectedLevel = state.selectedPlacementLevel || 1;
  const recLevel = state.lastPlacementRecLevel || 1;
  let track = "track1";
  if (selectedLevel >= 7) track = "track3";
  else if (selectedLevel >= 4) track = "track2";

  const prefix = (state.currentTextbookId && state.currentTextbookId.startsWith("ybm_kim")) ? "ybm_kim" : "ybm_park";

  try {
    const res = await fetch("/api/user/set_level", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: state.activeUserId,
        level: selectedLevel,
        track: track,
        recommendedLevel: recLevel,
        testScore: state.lastPlacementScore,
        textbookPrefix: prefix
      })
    });
    const data = await res.json();
    if (data.success) {
      closePlacementModal();
      state.activeTrack = track;
      if (data.recommendedTextbook) {
        state.currentTextbookId = data.recommendedTextbook;
      }
      triggerConfetti();
      await loadUserData();
      renderActiveTrackUI();
      await renderHomeUnitsUI();
      showToast(`🎉 진단 권장 Lv.${recLevel} 기록 완료! 선택하신 Lv.${selectedLevel}로 학습을 시작합니다!`);
    }
  } catch (err) {
    console.error("Failed to apply placement level:", err);
  }
}

async function applyPlacementLevel(targetLevel, targetTrack) {
  state.selectedPlacementLevel = targetLevel;
  await applyChosenPlacementLevel();
}

// 모달 배경 클릭 시 닫기
window.addEventListener("click", (e) => {
  const levelModal = document.getElementById("level-guide-modal");
  if (levelModal && e.target === levelModal) {
    closeLevelGuideModal();
  }
  const userModal = document.getElementById("user-modal");
  if (userModal && e.target === userModal) {
    closeUserModal();
  }
  const placeModal = document.getElementById("placement-modal");
  if (placeModal && e.target === placeModal) {
    closePlacementModal();
  }
});

// ESC 키 입력 시 열려있는 모달 닫기
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeLevelGuideModal();
    closeUserModal();
    closePlacementModal();
  }
});


// ==========================================
// Multi-View Controller & Auth Landing
// ==========================================
function showView(viewId) {
  const views = ["view-auth", "view-onboarding", "view-app"];
  views.forEach(v => {
    const el = document.getElementById(v);
    if (el) {
      if (v === viewId) {
        el.classList.remove("hidden");
      } else {
        el.classList.add("hidden");
      }
    }
  });
  state.currentView = viewId;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function highlightSelectedAvatar(radioEl) {
  const container = document.getElementById("auth-avatar-selector");
  if (!container) return;
  container.querySelectorAll("label").forEach(l => {
    l.classList.remove("ring-2", "ring-amber-400", "bg-white/20");
    l.classList.add("bg-white/5");
  });
  const parent = radioEl.closest("label");
  if (parent) {
    parent.classList.remove("bg-white/5");
    parent.classList.add("ring-2", "ring-amber-400", "bg-white/20");
  }
}

function toggleAuthIdDropdown(event) {
  if (event) event.stopPropagation();
  const menu = document.getElementById("auth-dropdown-menu");
  const arrow = document.getElementById("auth-dropdown-arrow");
  if (!menu) return;
  const isHidden = menu.classList.contains("hidden");
  if (isHidden) {
    menu.classList.remove("hidden");
    if (arrow) arrow.textContent = "▲";
  } else {
    menu.classList.add("hidden");
    if (arrow) arrow.textContent = "▼";
  }
}

// Close dropdown on outside click
document.addEventListener("click", (e) => {
  const dropdown = document.getElementById("auth-custom-dropdown");
  const menu = document.getElementById("auth-dropdown-menu");
  const arrow = document.getElementById("auth-dropdown-arrow");
  if (dropdown && menu && !dropdown.contains(e.target)) {
    menu.classList.add("hidden");
    if (arrow) arrow.textContent = "▼";
  }
});

function renderAuthUsersList() {
  const container = document.getElementById("auth-users-list");
  if (!container) return;

  const countEl = document.getElementById("auth-users-count");
  if (countEl) countEl.textContent = `${state.users.length}명 등록됨`;

  const dropdown = document.getElementById("auth-quick-id-dropdown");
  const menuEl = document.getElementById("auth-dropdown-menu");

  if (state.users.length === 0) {
    container.innerHTML = `
      <div class="text-center py-8 text-gray-400 space-y-2">
        <span class="text-3xl">🌱</span>
        <div class="text-xs">아직 등록된 학생 ID가 없습니다.</div>
        <div class="text-[11px] text-indigo-300">오른쪽 양식에서 새로운 학생 ID를 등록해 보세요!</div>
      </div>
    `;
    if (dropdown) dropdown.innerHTML = `<option value="">등록된 학생 ID 없음</option>`;
    if (menuEl) menuEl.innerHTML = `<div class="p-3 text-center text-xs text-gray-400">등록된 학생 ID 없음</div>`;
    return;
  }

  // Ensure an active selected user id exists for the auth screen
  if (!state.selectedAuthUserId || !state.users.find(u => u.id === state.selectedAuthUserId)) {
    state.selectedAuthUserId = state.users[0].id;
  }

  // Update quick fallback select
  if (dropdown) {
    dropdown.innerHTML = state.users.map(u => `
      <option value="${u.id}" ${u.id === state.selectedAuthUserId ? 'selected' : ''} style="background-color: #16123D; color: #ffffff;">
        🆔 ID: ${u.id} │ ${u.name} (${u.grade}학년)
      </option>
    `).join("");
  }

  // Populate floating custom dropdown list menu
  if (menuEl) {
    menuEl.innerHTML = state.users.map(u => {
      const isSel = u.id === state.selectedAuthUserId;
      return `
        <div onclick="selectAuthUserId('${u.id}', true)" class="p-3 rounded-xl border transition-all flex items-center justify-between cursor-pointer ${isSel ? 'border-amber-400 bg-amber-400/20 text-white' : 'border-white/10 hover:border-amber-400/50 hover:bg-white/10 text-gray-200'}">
          <div class="flex items-center gap-3">
            <span class="text-2xl">${u.avatar || "🐧"}</span>
            <div>
              <div class="flex items-center gap-2">
                <span class="font-mono text-xs font-black px-2 py-0.5 rounded ${isSel ? 'bg-amber-400 text-gray-950' : 'bg-indigo-500/40 text-amber-300'}">🆔 ${u.id}</span>
                <span class="text-xs font-bold text-white">${u.name}</span>
              </div>
              <div class="text-[11px] text-indigo-200/70 mt-0.5">${u.targetSchool || '대구 동도중학교'} (${u.grade}학년)</div>
            </div>
          </div>
          ${isSel ? '<span class="text-xs text-amber-300 font-black shrink-0">✓ 선택됨</span>' : '<span class="text-xs text-indigo-300/80 shrink-0">선택</span>'}
        </div>
      `;
    }).join("");
  }

  // Update trigger button selected preview
  const selUser = state.users.find(u => u.id === state.selectedAuthUserId);
  if (selUser) {
    const avEl = document.getElementById("auth-dropdown-selected-avatar");
    const idEl = document.getElementById("auth-dropdown-selected-id");
    const infoEl = document.getElementById("auth-dropdown-selected-info");
    if (avEl) avEl.textContent = selUser.avatar || "🐧";
    if (idEl) idEl.textContent = `🆔 ID: ${selUser.id}`;
    if (infoEl) infoEl.textContent = `│ ${selUser.name} (${selUser.grade}학년)`;
  }

  updateAuthLoginButtonText();

  container.innerHTML = state.users.map(u => {
    const isSelected = u.id === state.selectedAuthUserId;
    const safeName = (u.name || "").replace(/'/g, "\\'");
    return `
      <div class="p-3.5 rounded-2xl glass-panel border transition-all cursor-pointer group ${isSelected ? 'border-amber-400 bg-white/15 ring-2 ring-amber-400/60 shadow-lg' : 'border-white/15 hover:border-indigo-300 hover:bg-white/10'}" onclick="selectAuthUserId('${u.id}')">
        <div class="flex items-center justify-between gap-3">
          <div class="flex items-center gap-3">
            <span class="text-3xl p-1.5 bg-white/15 rounded-2xl border border-white/20 shadow-sm shrink-0">${u.avatar || "🐧"}</span>
            <div class="space-y-1">
              <!-- Prominent ID Badge Display -->
              <div class="flex items-center gap-2 flex-wrap">
                <span class="text-xs font-mono font-black px-2.5 py-0.5 rounded-md ${isSelected ? 'bg-amber-400 text-gray-950 font-black' : 'bg-indigo-500/40 text-amber-300 border border-amber-400/30'}">
                  🆔 ID: ${u.id}
                </span>
                <span class="text-sm font-black text-white">${u.name}</span>
                <span class="text-[10px] px-2 py-0.5 rounded-md bg-white/10 text-indigo-200 border border-white/10 font-bold">${u.grade}학년</span>
              </div>
              <div class="text-[11px] text-indigo-200/80">${u.targetSchool || '대구 동도중학교'}</div>
            </div>
          </div>
          
          <div class="flex items-center gap-2 shrink-0">
            <button onclick="event.stopPropagation(); loginExistingUser('${u.id}')" class="px-3 py-1.5 rounded-xl font-extrabold text-xs shadow-md transition-all flex items-center gap-1 cursor-pointer ${isSelected ? 'bg-amber-400 hover:bg-amber-300 text-gray-950 shadow-amber-500/30' : 'bg-white/15 hover:bg-white/25 text-white border border-white/20'}">
              <span>로그인</span> <span>➔</span>
            </button>
            ${state.users.length > 1 ? `
              <button onclick="event.stopPropagation(); deleteUser('${u.id}', '${safeName}')" class="p-1.5 text-gray-400 hover:text-red-400 hover:bg-white/10 rounded-xl transition-all text-xs" title="삭제">
                🗑️
              </button>
            ` : ''}
          </div>
        </div>
      </div>
    `;
  }).join("");

  // Populate avatar selector in register form if not already
  const avatarContainer = document.getElementById("auth-avatar-selector");
  if (avatarContainer && avatarContainer.children.length === 0) {
    const avatars = [
      { icon: "🐧", label: "페니" },
      { icon: "🦉", label: "올리" },
      { icon: "🦊", label: "폭시" },
      { icon: "🐥", label: "삐약" },
      { icon: "🐱", label: "키티" },
      { icon: "🐶", label: "멍멍" }
    ];
    avatarContainer.innerHTML = avatars.map((a, i) => `
      <label class="flex flex-col items-center p-2 rounded-xl border border-white/20 bg-white/5 hover:bg-white/15 cursor-pointer text-center transition-all ${i === 0 ? 'ring-2 ring-amber-400 bg-white/20' : ''}">
        <input type="radio" name="auth-avatar-choice" value="${a.icon}" ${i === 0 ? 'checked' : ''} class="sr-only" onchange="highlightSelectedAvatar(this)">
        <span class="text-2xl">${a.icon}</span>
        <span class="text-[10px] text-gray-300 font-bold mt-1">${a.label}</span>
      </label>
    `).join("");
  }
}

function selectAuthUserId(userId, closeDropdown = false) {
  state.selectedAuthUserId = userId;
  if (closeDropdown) {
    const menu = document.getElementById("auth-dropdown-menu");
    const arrow = document.getElementById("auth-dropdown-arrow");
    if (menu) menu.classList.add("hidden");
    if (arrow) arrow.textContent = "▼";
  }
  renderAuthUsersList();
}

function updateAuthLoginButtonText() {
  const btnText = document.getElementById("auth-login-btn-text");
  const user = state.users.find(u => u.id === state.selectedAuthUserId);
  if (btnText) {
    if (user) {
      btnText.textContent = `선택한 학생 ID '${user.id}' (${user.name})로 로그인하기 ➔`;
    } else {
      btnText.textContent = "선택한 학생 ID로 메인화면 로그인 ➔";
    }
  }
}

async function loginSelectedAuthUser() {
  const userId = state.selectedAuthUserId || (state.users[0] && state.users[0].id);
  if (!userId) {
    alert("로그인할 학생 ID를 선택해 주세요.");
    return;
  }
  await loginExistingUser(userId);
}

async function loginExistingUser(userId) {
  state.activeUserId = userId;
  await selectUser(userId);
  showView("view-app");
  const user = state.users.find(u => u.id === userId);
  showToast(`반가워요, ${user ? user.name : userId} 학생! 오늘의 30분 영작 루틴을 시작합니다! 🚀`, "✨");
}

function logoutToAuthScreen(focusNewRegister = false) {
  closeUserModal();
  renderAuthUsersList();
  showView("view-auth");
  if (focusNewRegister) {
    setTimeout(() => {
      const input = document.getElementById("auth-new-id");
      if (input) {
        input.focus();
        input.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 120);
    showToast("신규 학생 등록 화면입니다. 학생 ID와 이름을 입력해 주세요!", "🌱");
  } else {
    showToast("성공적으로 로그아웃되었습니다. 로그인할 학생 ID를 선택해 주세요.", "👋");
  }
}

function autoFillSampleStudent() {
  const idInput = document.getElementById("auth-new-id");
  const nameInput = document.getElementById("auth-new-name");
  const schoolInput = document.getElementById("auth-new-school");
  const fb = document.getElementById("auth-register-feedback");

  // Pick a random unique student sample ID
  const randomSuffix = Math.floor(100 + Math.random() * 900);
  const sampleId = `student_${randomSuffix}`;

  if (idInput) {
    idInput.value = sampleId;
    idInput.classList.remove("border-rose-500", "ring-2", "ring-rose-400", "bg-rose-500/10");
  }
  if (nameInput) {
    nameInput.value = "김수현";
    nameInput.classList.remove("border-rose-500", "ring-2", "ring-rose-400", "bg-rose-500/10");
  }
  if (schoolInput && !schoolInput.value) {
    schoolInput.value = "대구 동도중학교";
  }
  if (fb) fb.classList.add("hidden");
  showToast(`⚡ 테스트용 예시 학생 정보가 자동 입력되었습니다. (ID: ${sampleId})`, "✨");
}

function clearAuthValidation() {
  const idInput = document.getElementById("auth-new-id");
  const nameInput = document.getElementById("auth-new-name");
  const fb = document.getElementById("auth-register-feedback");
  if (idInput) idInput.classList.remove("border-rose-500", "ring-2", "ring-rose-400", "bg-rose-500/10");
  if (nameInput) nameInput.classList.remove("border-rose-500", "ring-2", "ring-rose-400", "bg-rose-500/10");
  if (fb) fb.classList.add("hidden");
}

async function handleAuthRegister() {
  const idInput = document.getElementById("auth-new-id");
  const nameInput = document.getElementById("auth-new-name");
  const gradeSelect = document.getElementById("auth-new-grade");
  const schoolInput = document.getElementById("auth-new-school");
  const avatarRadio = document.querySelector('input[name="auth-avatar-choice"]:checked');
  const fb = document.getElementById("auth-register-feedback");
  const fbText = document.getElementById("auth-register-feedback-text");

  const id = idInput ? idInput.value.trim().toLowerCase() : "";
  const name = nameInput ? nameInput.value.trim() : "";
  const grade = gradeSelect ? parseInt(gradeSelect.value) : 1;
  const school = schoolInput ? schoolInput.value.trim() : "대구 동도중학교";
  const avatar = avatarRadio ? avatarRadio.value : "🐧";

  clearAuthValidation();

  // Highlight empty fields and notify clearly
  if (!id) {
    if (fb) {
      fb.classList.remove("hidden");
      if (fbText) fbText.textContent = "학생 ID를 입력해 주세요. (또는 우측 '⚡ 예시 자동입력' 클릭)";
    }
    if (idInput) {
      idInput.classList.add("border-rose-500", "ring-2", "ring-rose-400", "bg-rose-500/10");
      idInput.focus();
    }
    showToast("신규 등록을 위해 학생 ID를 입력해 주세요!", "⚠️");
    return;
  }

  if (!name) {
    if (fb) {
      fb.classList.remove("hidden");
      if (fbText) fbText.textContent = "학생 이름을 입력해 주세요. (예: 김수현)";
    }
    if (nameInput) {
      nameInput.classList.add("border-rose-500", "ring-2", "ring-rose-400", "bg-rose-500/10");
      nameInput.focus();
    }
    showToast("학생 이름을 입력해 주세요!", "⚠️");
    return;
  }

  const btn = document.getElementById("auth-register-btn");
  const originalText = btn ? btn.innerHTML : "";
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span>⏳</span> <span>학생 등록 및 가이드 준비 중...</span>`;
  }

  try {
    const res = await fetch("/api/users/add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, name, grade, avatar, targetSchool: school })
    });
    const data = await res.json();
    if (data.success) {
      if (idInput) idInput.value = "";
      if (nameInput) nameInput.value = "";
      state.activeUserId = id;
      state.users = data.users || state.users;
      
      // Default textbook based on grade
      state.onboardingSelectedTextbook = (grade === 3) ? "ybm_park_grade3" : ((grade === 2) ? "ybm_park_grade2" : "ybm_park_grade1");
      state.onboardingStep = 1;
      state.onboardingReviewMode = false;
      state.onboardingScore = 0;
      state.onboardingRecLevel = (grade === 3) ? 7 : ((grade === 2) ? 4 : 1);
      state.onboardingSelectedLevel = 1;
      state.onboardingPlacementDone = false;
      state.currentOnboardingPlacementQuestions = pickRandomPlacementQuestions();

      triggerConfetti();
      showView("view-onboarding");
      renderOnboardingStep();
      showToast(`🎉 ${name} 학생 환영합니다! 시스템 시작 가이드를 진행합니다.`, "🌱");
    } else {
      if (fb) {
        fb.classList.remove("hidden");
        if (fbText) fbText.textContent = data.message || "등록에 실패했습니다.";
      }
      if (idInput && (data.message || "").includes("ID")) {
        idInput.classList.add("border-rose-500", "ring-2", "ring-rose-400", "bg-rose-500/10");
        idInput.focus();
      }
      showToast(data.message || "등록 실패", "⚠️");
    }
  } catch (err) {
    console.error("Failed to register:", err);
    if (fb) {
      fb.classList.remove("hidden");
      if (fbText) fbText.textContent = "등록 통신 중 오류가 발생했습니다. 다시 시도해 주세요.";
    }
    showToast("등록 통신 중 오류가 발생했습니다.", "⚠️");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  }
}

// ==========================================
// Interactive 6-Step Onboarding Guide
// ==========================================
const ONBOARDING_STEP_TITLES = [
  { step: 1, name: "4단계 루틴", subtitle: "1단계: 왜 서술형 영어작문인가? & 4단계 골든 루틴" },
  { step: 2, name: "진단평가", subtitle: "2단계: 3분 실력 진단평가 (빠른 레벨 배치)" },
  { step: 3, name: "시작 레벨", subtitle: "3단계: 나만의 시작 레벨 선택 (10단계 로드맵)" },
  { step: 4, name: "레벨업 규칙", subtitle: "4단계: 경험치(EXP)와 레벨업, 무감점 콤보 규칙" },
  { step: 5, name: "맞춤 교재", subtitle: "5단계: 내 상황에 꼭 맞는 교재 선택 (11종 라이브러리)" },
  { step: 6, name: "출격 준비", subtitle: "6단계: 온보딩 완료 축하 & 대시보드 입장 준비" }
];

function openOnboardingGuide(reviewMode = false) {
  state.onboardingReviewMode = reviewMode;
  state.onboardingStep = 1;
  if (!state.currentOnboardingPlacementQuestions || state.currentOnboardingPlacementQuestions.length === 0) {
    state.currentOnboardingPlacementQuestions = pickRandomPlacementQuestions();
  }
  showView("view-onboarding");
  renderOnboardingStep();
}

function goToOnboardingStep(step) {
  state.onboardingStep = Math.max(1, Math.min(6, step));
  renderOnboardingStep();
}

function nextOnboardingStep() {
  if (state.onboardingStep < 6) {
    goToOnboardingStep(state.onboardingStep + 1);
  } else {
    finishOnboardingAndEnterApp();
  }
}

function prevOnboardingStep() {
  if (state.onboardingStep > 1) {
    goToOnboardingStep(state.onboardingStep - 1);
  }
}

function renderOnboardingStep() {
  const step = state.onboardingStep || 1;
  const stepInfo = ONBOARDING_STEP_TITLES[step - 1];

  // Header update
  const subtitleEl = document.getElementById("onboarding-step-subtitle");
  if (subtitleEl) subtitleEl.textContent = stepInfo.subtitle;
  const indEl = document.getElementById("onboarding-step-indicator");
  if (indEl) indEl.textContent = `${step} / 6 단계`;
  const barEl = document.getElementById("onboarding-progress-bar");
  if (barEl) barEl.style.width = `${Math.round((step / 6) * 100)}%`;
  const counterLabel = document.getElementById("onboarding-step-counter-label");
  if (counterLabel) counterLabel.textContent = `Step ${step} of 6`;

  // Review mode pill
  const revPill = document.getElementById("onboarding-review-pill");
  if (revPill) {
    if (state.onboardingReviewMode) {
      revPill.classList.remove("hidden");
    } else {
      revPill.classList.add("hidden");
    }
  }

  // Stepper Pills
  const pillsEl = document.getElementById("onboarding-stepper-pills");
  if (pillsEl) {
    pillsEl.innerHTML = ONBOARDING_STEP_TITLES.map(s => {
      const isCur = s.step === step;
      const isPast = s.step < step;
      return `
        <button onclick="goToOnboardingStep(${s.step})" class="py-1 px-1.5 rounded-xl text-[10px] sm:text-xs font-bold transition-all truncate ${isCur ? 'bg-indigo-600 text-white shadow-xs' : (isPast ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-gray-50 text-gray-400 border border-gray-100')}">
          ${s.step}. ${s.name}
        </button>
      `;
    }).join("");
  }

  // Prev / Next button adjustments
  const prevBtn = document.getElementById("onboarding-prev-btn");
  if (prevBtn) {
    if (step === 1) {
      prevBtn.classList.add("invisible");
    } else {
      prevBtn.classList.remove("invisible");
    }
  }
  const nextBtn = document.getElementById("onboarding-next-btn");
  if (nextBtn) {
    if (step === 6) {
      nextBtn.innerHTML = `<span>🚀 대시보드 입장하기</span>`;
      nextBtn.className = "px-6 py-2.5 bg-gradient-to-r from-amber-500 to-indigo-600 hover:from-amber-600 hover:to-indigo-700 text-white font-black rounded-xl text-xs transition-all shadow-md flex items-center gap-1.5 animate-bounce-slow";
    } else {
      nextBtn.innerHTML = `<span>다음 단계 ➔</span>`;
      nextBtn.className = "px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs transition-all shadow-md flex items-center gap-1.5";
    }
  }

  // Render Step Body Content
  const container = document.getElementById("onboarding-step-content");
  if (!container) return;

  if (step === 1) {
    renderOnboardingStep1(container);
  } else if (step === 2) {
    renderOnboardingStep2(container);
  } else if (step === 3) {
    renderOnboardingStep3(container);
  } else if (step === 4) {
    renderOnboardingStep4(container);
  } else if (step === 5) {
    renderOnboardingStep5(container);
  } else if (step === 6) {
    renderOnboardingStep6(container);
  }
}

// ----------------------------------------------------
// Step 1: 왜 서술형 영어작문인가? & 4단계 골든 루틴
// ----------------------------------------------------
function renderOnboardingStep1(container) {
  container.innerHTML = `
    <div class="space-y-6">
      <div class="space-y-2">
        <span class="text-xs font-extrabold text-indigo-600 bg-indigo-50 px-3 py-1 rounded-full border border-indigo-200">
          시스템 핵심 철학 & 매일의 학습 방식
        </span>
        <h3 class="text-xl sm:text-2xl font-black text-gray-900 leading-snug">
          동도중 내신 1등급의 승부처, <br class="sm:hidden">
          <span class="text-indigo-600">조건 제시형 서술형 영작</span>과 수행평가 에세이!
        </h3>
        <p class="text-xs sm:text-sm text-gray-600 leading-relaxed">
          객관식 문법 문제는 누구나 맞춥니다. 상위권을 가르는 진짜 변별력은 <strong>주어-동사 수 일치(-s), 시제, 관계사, 어순 조건</strong>을 감점 없이 완전한 영어 문장으로 완성해내는 <strong>서술형 작문 역량</strong>입니다.
        </p>
      </div>

      <!-- 4 Golden Steps Grid -->
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-1">
        
        <!-- Step 1 Card -->
        <div class="p-4 rounded-2xl border-2 border-indigo-100 bg-indigo-50/40 space-y-2 hover:border-indigo-300 transition-all">
          <div class="flex items-center justify-between">
            <span class="text-xs font-black text-indigo-700 bg-white px-2.5 py-0.5 rounded-lg border border-indigo-200">Step 1. 웜업</span>
            <span class="text-[11px] font-bold text-gray-500">약 5분 소요</span>
          </div>
          <h4 class="font-extrabold text-sm text-gray-900 flex items-center gap-1.5">
            <span>🧩</span> 어휘·구문 조각 퍼즐
          </h4>
          <p class="text-xs text-gray-600 leading-relaxed">
            단어 청크(Chunk)와 필수 어휘를 바른 순서로 배열하며 오늘 학습할 핵심 구문의 뼈대를 직관적으로 세웁니다.
          </p>
        </div>

        <!-- Step 2 Card -->
        <div class="p-4 rounded-2xl border-2 border-purple-100 bg-purple-50/40 space-y-2 hover:border-purple-300 transition-all">
          <div class="flex items-center justify-between">
            <span class="text-xs font-black text-purple-700 bg-white px-2.5 py-0.5 rounded-lg border border-purple-200">Step 2. 유형 A</span>
            <span class="text-[11px] font-bold text-gray-500">약 10분 소요</span>
          </div>
          <h4 class="font-extrabold text-sm text-gray-900 flex items-center gap-1.5">
            <span>✍️</span> 조건 제시형 서술형 영작
          </h4>
          <p class="text-xs text-gray-600 leading-relaxed">
            단어 수 일치, 어형 변형, 특정 문법 적용 등 학교 지필평가 서술형 킬러 조건을 100% 충족하는 실전 영작 훈련입니다.
          </p>
        </div>

        <!-- Step 3 Card -->
        <div class="p-4 rounded-2xl border-2 border-rose-100 bg-rose-50/40 space-y-2 hover:border-rose-300 transition-all">
          <div class="flex items-center justify-between">
            <span class="text-xs font-black text-rose-700 bg-white px-2.5 py-0.5 rounded-lg border border-rose-200">Step 3. 유형 B</span>
            <span class="text-[11px] font-bold text-gray-500">약 7분 소요</span>
          </div>
          <h4 class="font-extrabold text-sm text-gray-900 flex items-center gap-1.5">
            <span>🔍</span> 킬러 어법 오류 사냥
          </h4>
          <p class="text-xs text-gray-600 leading-relaxed">
            전국 오답률 1위! 지문 속 틀린 기호(ⓐ~ⓔ)를 정확히 찾아내고, 감점 없이 올바른 형태로 고쳐 쓰는 능력을 기릅니다.
          </p>
        </div>

        <!-- Step 4 Card -->
        <div class="p-4 rounded-2xl border-2 border-emerald-100 bg-emerald-50/40 space-y-2 hover:border-emerald-300 transition-all">
          <div class="flex items-center justify-between">
            <span class="text-xs font-black text-emerald-700 bg-white px-2.5 py-0.5 rounded-lg border border-emerald-200">Step 4. 유형 D</span>
            <span class="text-[11px] font-bold text-gray-500">약 8분 소요</span>
          </div>
          <h4 class="font-extrabold text-sm text-gray-900 flex items-center gap-1.5">
            <span>📝</span> 수행평가 미니 단락 에세이
          </h4>
          <p class="text-xs text-gray-600 leading-relaxed">
            학교생활기록부 교과세특에 직결되는 4~5문장 단락 작문! 작성한 에세이는 언제든 세특 보관함에서 확인하고 복사할 수 있습니다.
          </p>
        </div>

      </div>

      <!-- Mascot Advice Callout -->
      <div class="p-4 rounded-2xl bg-amber-50 border border-amber-200 flex items-center gap-3.5">
        <span class="text-3xl shrink-0">🐧</span>
        <div class="text-xs text-amber-950 leading-relaxed">
          <strong>튜터 페니의 조언:</strong> "하루 딱 30분, 욕심내지 않고 4단계를 차례대로 완주하는 것이 핵심이에요! 이제 2단계에서 나의 현재 실력을 3분 진단평가로 확인해 볼까요?"
        </div>
      </div>
    </div>
  `;
}

// ----------------------------------------------------
// Step 2: 3분 실력 진단평가 (Interactive Test or Skip)
// ----------------------------------------------------
function renderOnboardingStep2(container) {
  const questions = state.currentOnboardingPlacementQuestions || [];

  if (state.onboardingPlacementDone) {
    // Show Placement Result Summary in Step 2
    const score = state.onboardingScore || 0;
    const recLvl = state.onboardingRecLevel || 1;
    container.innerHTML = `
      <div class="space-y-6">
        <div class="text-center space-y-2">
          <span class="text-4xl animate-bounce-slow inline-block">🎉</span>
          <h3 class="text-xl sm:text-2xl font-black text-gray-900">3분 진단평가 완료!</h3>
          <p class="text-xs text-gray-600">동도중 루브릭 정밀 분석 결과가 나왔습니다.</p>
        </div>

        <div class="p-6 rounded-3xl bg-gradient-to-br from-indigo-50 to-purple-50 border-2 border-indigo-200 text-center space-y-3 shadow-sm">
          <div class="text-xs font-bold text-indigo-700">진단평가 획득 점수</div>
          <div class="text-4xl sm:text-5xl font-black text-indigo-600">${score}점 <span class="text-sm font-semibold text-gray-500">/ 100점</span></div>
          
          <div class="pt-2">
            <span class="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-amber-400 text-amber-950 font-black text-sm shadow-sm">
              <span>🎯</span> AI 권장 시작 레벨: Lv.${recLvl}
            </span>
          </div>

          <p class="text-xs text-gray-600 max-w-md mx-auto pt-1 leading-relaxed">
            학생의 문법 감각과 영작 구문력을 종합 분석하여 <strong>Lv.${recLvl}</strong>을 추천합니다.<br>
            다음 단계에서 <strong>Lv.1부터 Lv.${recLvl} 사이</strong>의 원하는 시작 레벨을 직접 선택할 수 있습니다.
          </p>
        </div>

        <div class="flex items-center justify-center gap-3 pt-2">
          <button onclick="state.onboardingPlacementDone = false; state.currentOnboardingPlacementQuestions = pickRandomPlacementQuestions(); renderOnboardingStep();" class="px-4 py-2.5 rounded-xl border border-gray-300 hover:bg-gray-100 text-xs font-bold text-gray-700 transition-all">
            🔄 다른 문제로 다시 진단받기
          </button>
          <button onclick="nextOnboardingStep()" class="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs transition-all shadow-md">
            다음: 시작 레벨 선택하기 ➔
          </button>
        </div>
      </div>
    `;
    return;
  }

  // Render 5 Diagnostic Questions
  container.innerHTML = `
    <div class="space-y-5">
      <div class="flex items-center justify-between border-b pb-3">
        <div>
          <h3 class="text-lg sm:text-xl font-extrabold text-gray-900 flex items-center gap-2">
            <span>⚡</span> 3분 실력 진단평가
            <span class="text-xs px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 font-bold">5문항 쾌속 진단</span>
          </h3>
          <p class="text-xs text-gray-500 mt-0.5">내 실력에 꼭 맞는 시작 레벨을 인공지능이 찾아드립니다.</p>
        </div>
        <button onclick="skipOnboardingPlacement()" class="px-3.5 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-xs font-bold transition-all border border-gray-200 shrink-0">
          🌱 Lv.1부터 기초 시작 (건너뛰기)
        </button>
      </div>

      <!-- Questions List Container -->
      <div class="space-y-4 max-h-[380px] overflow-y-auto pr-1">
        ${questions.map((q, idx) => `
          <div class="p-4 rounded-2xl border border-gray-200 bg-gray-50/50 space-y-2.5">
            <div class="flex items-center justify-between">
              <span class="text-xs font-extrabold text-indigo-700 bg-indigo-100/80 px-2.5 py-0.5 rounded-md">Q${idx + 1}. ${q.grammar}</span>
              <span class="text-[11px] text-gray-400 font-semibold">${q.grade}</span>
            </div>

            <div class="text-xs sm:text-sm font-bold text-gray-800">${q.korean}</div>

            <ul class="text-[11px] text-gray-500 list-disc list-inside bg-white p-2 rounded-xl border border-gray-100">
              ${q.conditions.map(c => `<li>${c}</li>`).join("")}
            </ul>

            ${q.isCorrection ? `
              <div class="grid grid-cols-2 gap-2 pt-1">
                <div>
                  <label class="text-[10px] font-bold text-gray-500">틀린 기호 (예: a 또는 ⓐ):</label>
                  <input type="text" id="ob-input-sym-${idx}" placeholder="예: a" class="w-full px-3 py-1.5 text-xs border rounded-xl font-mono focus:outline-indigo-500 bg-white">
                </div>
                <div>
                  <label class="text-[10px] font-bold text-gray-500">올바르게 고친 형태:</label>
                  <input type="text" id="ob-input-corr-${idx}" placeholder="예: ${q.sampleCorrection || 'were'}" class="w-full px-3 py-1.5 text-xs border rounded-xl font-mono focus:outline-indigo-500 bg-white">
                </div>
              </div>
            ` : `
              <div class="pt-1">
                <input type="text" id="ob-input-ans-${idx}" placeholder="${q.placeholder || '완전한 영어 문장으로 작성하세요.'}" class="w-full px-3.5 py-2 text-xs border rounded-xl font-medium focus:outline-indigo-500 bg-white shadow-2xs">
              </div>
            `}
          </div>
        `).join("")}
      </div>

      <div class="pt-2 flex flex-col sm:flex-row items-center justify-between gap-3 border-t">
        <span class="text-xs text-gray-500">💡 부담 없이 작성해 보세요! 틀려도 정확한 오답 분석과 피드백을 드립니다.</span>
        <button onclick="submitOnboardingPlacement()" class="w-full sm:w-auto px-6 py-3 bg-gradient-to-r from-amber-500 to-indigo-600 hover:from-amber-600 hover:to-indigo-700 text-white font-extrabold rounded-2xl text-xs transition-all shadow-md flex items-center justify-center gap-1.5">
          <span>🎯 진단평가 제출 및 실력 판정하기</span>
        </button>
      </div>
    </div>
  `;
}

function submitOnboardingPlacement() {
  const questions = state.currentOnboardingPlacementQuestions || [];
  let totalScore = 0;

  questions.forEach((q, idx) => {
    let diag = null;
    if (q.isCorrection) {
      const sym = (document.getElementById(`ob-input-sym-${idx}`)||{}).value || "";
      const corr = (document.getElementById(`ob-input-corr-${idx}`)||{}).value || "";
      diag = diagnosePlacementQuestion(q, "", sym, corr);
    } else {
      const ans = (document.getElementById(`ob-input-ans-${idx}`)||{}).value || "";
      diag = diagnosePlacementQuestion(q, ans, "", "");
    }
    totalScore += (diag ? diag.score : 0);
  });

  const recLevel = Math.max(1, Math.min(10, Math.floor(totalScore / 10)));
  state.onboardingScore = totalScore;
  state.onboardingRecLevel = recLevel;
  state.onboardingSelectedLevel = 1; // Default to starting from Level 1
  state.onboardingPlacementDone = true;

  triggerConfetti();
  renderOnboardingStep();
  showToast(`진단평가 완료! ${totalScore}점 획득 (권장 레벨: Lv.${recLevel})`, "🎯");
}

function skipOnboardingPlacement() {
  state.onboardingScore = null;
  state.onboardingRecLevel = 1;
  state.onboardingSelectedLevel = 1;
  state.onboardingPlacementDone = true;
  goToOnboardingStep(3);
  showToast("Lv.1 기초 새싹 단계부터 차근차근 시작합니다!", "🌱");
}

// ----------------------------------------------------
// Step 3: 나만의 시작 레벨 선택 (10단계 로드맵)
// ----------------------------------------------------
function selectOnboardingLevel(lvl) {
  state.onboardingSelectedLevel = lvl;
  renderOnboardingStep();
  const title = (LEVEL_ROADMAP[lvl - 1] || {}).title || "";
  showToast(`시작 레벨이 'Lv.${lvl} ${title}'(으)로 선택되었습니다!`, "⭐");
}

function renderOnboardingStep3(container) {
  const recLevel = state.onboardingRecLevel || 1;
  const currentSelected = state.onboardingSelectedLevel || 1;

  container.innerHTML = `
    <div class="space-y-5">
      <div class="space-y-1 border-b pb-3">
        <div class="flex items-center justify-between flex-wrap gap-2">
          <h3 class="text-lg sm:text-xl font-extrabold text-gray-900 flex items-center gap-2">
            <span>⭐</span> 나만의 시작 레벨 선택
            <span class="text-xs px-2.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 font-bold border border-indigo-200">10단계 로드맵</span>
          </h3>
          <span class="text-xs px-3 py-1 rounded-full bg-amber-100 text-amber-900 font-extrabold">
            🎯 AI 권장 시작 레벨: Lv.${recLevel}
          </span>
        </div>
        <p class="text-xs text-gray-600 leading-relaxed">
          성취감이 중요하므로, 추천 레벨이 높더라도 <strong>Lv.1부터 Lv.${recLevel} 사이의 원하는 레벨</strong>을 자유롭게 선택할 수 있습니다.
        </p>
      </div>

      <!-- Level Selection Grid -->
      <div class="grid grid-cols-2 sm:grid-cols-5 gap-2.5 max-h-[360px] overflow-y-auto pr-1">
        ${LEVEL_ROADMAP.map(r => {
          const isSelected = r.level === currentSelected;
          const isRec = r.level === recLevel;
          const isAllowed = r.level <= Math.max(recLevel, 1);
          return `
            <div onclick="selectOnboardingLevel(${r.level})" class="p-3 rounded-2xl border-2 transition-all cursor-pointer flex flex-col justify-between space-y-2 text-center relative ${isSelected ? 'border-indigo-600 bg-indigo-50/70 shadow-sm ring-2 ring-indigo-200' : 'border-gray-200 bg-white hover:border-indigo-300'}">
              ${isRec ? '<span class="absolute -top-2 right-2 px-1.5 py-0.2 bg-amber-400 text-amber-950 text-[9px] font-black rounded-full shadow-2xs">추천!</span>' : ''}
              <div>
                <span class="text-2xl">${r.badge}</span>
                <div class="text-xs font-black text-gray-900 mt-1">Lv.${r.level}</div>
                <div class="text-[11px] font-bold text-indigo-700 truncate">${r.title}</div>
                <div class="text-[9px] text-gray-400">${r.gradeBadge}</div>
              </div>
              <div class="pt-1 border-t border-gray-100 text-[10px] ${isSelected ? 'text-indigo-600 font-black' : 'text-gray-400'}">
                ${isSelected ? '✓ 선택됨' : '선택하기'}
              </div>
            </div>
          `;
        }).join("")}
      </div>

      <!-- Selected Level Description Card -->
      <div class="p-3.5 rounded-2xl bg-indigo-50/80 border border-indigo-200 flex items-start gap-3">
        <span class="text-2xl shrink-0">${LEVEL_ROADMAP[currentSelected - 1].badge}</span>
        <div class="space-y-0.5 text-xs">
          <div class="font-extrabold text-indigo-950">
            선택한 시작 레벨: Lv.${currentSelected} ${LEVEL_ROADMAP[currentSelected - 1].title} (${LEVEL_ROADMAP[currentSelected - 1].gradeBadge})
          </div>
          <div class="text-indigo-900/90 leading-relaxed font-medium">
            <strong>핵심 문법:</strong> ${LEVEL_ROADMAP[currentSelected - 1].grammarTarget}
          </div>
        </div>
      </div>
    </div>
  `;
}

// ----------------------------------------------------
// Step 4: 레벨업 및 무감점 콤보 규칙 (EXP & Gamification)
// ----------------------------------------------------
function renderOnboardingStep4(container) {
  container.innerHTML = `
    <div class="space-y-6">
      <div class="space-y-1.5 border-b pb-3">
        <span class="text-xs font-extrabold text-indigo-600 bg-indigo-50 px-3 py-1 rounded-full border border-indigo-200">
          게이미피케이션 동기부여 시스템
        </span>
        <h3 class="text-xl sm:text-2xl font-black text-gray-900">
          재미있게 몰입하는 <span class="text-indigo-600">레벨업 & 보상 규칙</span>
        </h3>
        <p class="text-xs sm:text-sm text-gray-600">
          작문을 풀 때마다 실시간 경험치가 쌓이고, 100점 무감점 통과 시 왕관 콤보를 달성합니다.
        </p>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        
        <!-- Rule 1: EXP & Level Up -->
        <div class="p-4 rounded-2xl border border-amber-200 bg-amber-50/50 space-y-2 flex items-start gap-3">
          <span class="text-3xl p-2 bg-white rounded-xl shadow-xs border border-amber-100">🌟</span>
          <div class="space-y-1">
            <h4 class="font-black text-sm text-amber-950">경험치(EXP) & 자동 레벨업</h4>
            <p class="text-xs text-amber-900 leading-relaxed">
              데일리 4단계를 완료할 때마다 <strong>50~100 EXP</strong>를 획득합니다. <strong>150 EXP</strong>가 모이면 즉시 다음 레벨로 승급하며 멋진 명예 칭호가 주어집니다.
            </p>
          </div>
        </div>

        <!-- Rule 2: Flawless Streak -->
        <div class="p-4 rounded-2xl border border-purple-200 bg-purple-50/50 space-y-2 flex items-start gap-3">
          <span class="text-3xl p-2 bg-white rounded-xl shadow-xs border border-purple-100">👑</span>
          <div class="space-y-1">
            <h4 class="font-black text-sm text-purple-950">무감점 콤보 (Flawless Streak)</h4>
            <p class="text-xs text-purple-900 leading-relaxed">
              동도중 감점 규정 시뮬레이터를 <strong>95점 이상 무감점</strong>으로 통과하면 무감점 콤보 카운트가 상승하며 특별 도전과제 뱃지가 해금됩니다!
            </p>
          </div>
        </div>

        <!-- Rule 3: Daily Streak -->
        <div class="p-4 rounded-2xl border border-orange-200 bg-orange-50/50 space-y-2 flex items-start gap-3">
          <span class="text-3xl p-2 bg-white rounded-xl shadow-xs border border-orange-100">🔥</span>
          <div class="space-y-1">
            <h4 class="font-black text-sm text-orange-950">연속 학습 스트릭 (Streak)</h4>
            <p class="text-xs text-orange-900 leading-relaxed">
              매일 빠짐없이 30분씩 학습할 때마다 연속 출석 스트릭 불꽃이 커집니다. 3일, 7일, 30일 연속 달성 시 한정판 뱃지를 수집하세요!
            </p>
          </div>
        </div>

        <!-- Rule 4: Smart Wrong Notes & Radar -->
        <div class="p-4 rounded-2xl border border-indigo-200 bg-indigo-50/50 space-y-2 flex items-start gap-3">
          <span class="text-3xl p-2 bg-white rounded-xl shadow-xs border border-indigo-100">📊</span>
          <div class="space-y-1">
            <h4 class="font-black text-sm text-indigo-950">스마트 오답노트 & 레이더 성장</h4>
            <p class="text-xs text-indigo-900 leading-relaxed">
              틀린 문제는 오답노트에 자동 보관됩니다. <strong>[스마트 오답 클리닉]</strong>에서 다시 풀면 수일치, 시제, 문장 구조력 5각 레이더가 실시간으로 강화됩니다.
            </p>
          </div>
        </div>

      </div>
    </div>
  `;
}

// ----------------------------------------------------
// Step 5: 내게 맞는 교재 선택 (11종 교재 라이브러리)
// ----------------------------------------------------
function selectOnboardingTextbook(tbId) {
  state.onboardingSelectedTextbook = tbId;
  renderOnboardingStep();
  const tb = state.catalog.find(t => t.id === tbId);
  showToast(`'${tb ? tb.title : tbId}' 교재가 선택되었습니다!`, "📚");
}

function renderOnboardingStep5(container) {
  const currentTbId = state.onboardingSelectedTextbook || "ybm_park_grade1";
  const catalog = state.catalog || [];

  container.innerHTML = `
    <div class="space-y-5">
      <div class="space-y-1 border-b pb-3">
        <div class="flex items-center justify-between flex-wrap gap-2">
          <h3 class="text-lg sm:text-xl font-extrabold text-gray-900 flex items-center gap-2">
            <span>📚</span> 내 상황에 꼭 맞는 교재 선택
            <span class="text-xs px-2.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 font-bold border border-indigo-200">총 11종 완비</span>
          </h3>
          <span class="text-xs text-gray-500 font-medium">
            (선택한 교재는 언제든 교재 자료실 탭에서 변경 가능)
          </span>
        </div>
        <p class="text-xs text-gray-600 leading-relaxed">
          동도중 현행 교과서부터 수성구 1등급 킬러 교재, 전국 표준 교과서, 교육부 공인 EBS 문항 중 하나를 선택하세요.
        </p>
      </div>

      <!-- Textbooks Carousel Grid -->
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-h-[360px] overflow-y-auto pr-1">
        ${catalog.map(tb => {
          const isSelected = tb.id === currentTbId;
          return `
            <div onclick="selectOnboardingTextbook('${tb.id}')" class="p-3.5 rounded-2xl border-2 transition-all cursor-pointer flex flex-col justify-between space-y-2.5 ${isSelected ? 'border-indigo-600 bg-indigo-50/70 shadow-sm ring-2 ring-indigo-200' : 'border-gray-200 bg-white hover:border-indigo-300'}">
              <div class="space-y-1.5">
                <div class="flex items-center justify-between">
                  <span class="text-[10px] font-black text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-full border border-indigo-200 truncate max-w-[130px]">
                    ${tb.categoryBadge || tb.edition}
                  </span>
                  <span class="text-[10px] text-gray-400 font-semibold">${tb.grade ? tb.grade + '학년' : '공통'}</span>
                </div>
                <h4 class="font-bold text-xs sm:text-sm text-gray-900 leading-snug">${tb.title}</h4>
                <p class="text-[11px] text-amber-900 bg-amber-50 p-2 rounded-xl border border-amber-200/80 leading-relaxed font-medium">
                  🎯 ${tb.fitFor}
                </p>
              </div>
              <div class="pt-1.5 border-t border-gray-100 flex items-center justify-between text-[11px]">
                <span class="text-gray-400">총 ${tb.unitsCount || 4}개 단원</span>
                <span class="font-extrabold ${isSelected ? 'text-indigo-600' : 'text-gray-400'}">
                  ${isSelected ? '✓ 선택됨' : '선택하기'}
                </span>
              </div>
            </div>
          `;
        }).join("")}
      </div>
    </div>
  `;
}

// ----------------------------------------------------
// Step 6: 온보딩 완료 축하 & 출격 준비 완료! (Launch Pad)
// ----------------------------------------------------
function renderOnboardingStep6(container) {
  const activeUser = state.users.find(u => u.id === state.activeUserId) || { name: "학생", grade: 1, avatar: "🐧", targetSchool: "대구 동도중학교" };
  const currentLvl = state.onboardingSelectedLevel || 1;
  const levelInfo = LEVEL_ROADMAP[currentLvl - 1] || { title: "새싹 영작러", badge: "🌱" };
  const currentTb = state.catalog.find(t => t.id === (state.onboardingSelectedTextbook || "ybm_park_grade1")) || { title: "YBM(박준언) 중등 영어 1", categoryBadge: "🏫 동도중 현행 교과서" };

  container.innerHTML = `
    <div class="space-y-6 text-center">
      <div class="space-y-2">
        <span class="text-5xl animate-bounce-slow inline-block">🎉</span>
        <h3 class="text-2xl sm:text-3xl font-black text-gray-900">
          모든 준비가 완료되었습니다!
        </h3>
        <p class="text-xs sm:text-sm text-gray-600">
          ${activeUser.name} 학생만의 맞춤형 영작러 출격 프로필 카드가 생성되었습니다.
        </p>
      </div>

      <!-- Personalized Student Mission Card -->
      <div class="max-w-md mx-auto p-6 rounded-3xl bg-gradient-to-br from-indigo-600 via-purple-600 to-indigo-800 text-white shadow-xl shadow-indigo-200 text-left space-y-4 relative overflow-hidden">
        <div class="absolute -right-8 -bottom-8 w-36 h-36 bg-white/10 rounded-full blur-xl pointer-events-none"></div>

        <div class="flex items-center justify-between border-b border-white/20 pb-3">
          <div class="flex items-center gap-3">
            <span class="text-4xl p-2 bg-white/20 rounded-2xl backdrop-blur-md">${activeUser.avatar || "🐧"}</span>
            <div>
              <div class="text-lg font-black text-white">${activeUser.name} 학생</div>
              <div class="text-xs text-purple-200">${activeUser.targetSchool || '대구 동도중학교'} · ${activeUser.grade}학년</div>
            </div>
          </div>
          <span class="text-xs px-2.5 py-1 rounded-full bg-white/20 text-white font-bold backdrop-blur-md">
            동도 롸이팅 마스터
          </span>
        </div>

        <div class="grid grid-cols-2 gap-2.5 text-xs">
          <div class="p-3 rounded-2xl bg-white/10 backdrop-blur-sm space-y-1">
            <div class="text-[10px] text-purple-200 font-bold">시작 레벨</div>
            <div class="font-extrabold text-amber-300 text-sm flex items-center gap-1">
              <span>${levelInfo.badge}</span> Lv.${currentLvl} ${levelInfo.title}
            </div>
          </div>
          <div class="p-3 rounded-2xl bg-white/10 backdrop-blur-sm space-y-1">
            <div class="text-[10px] text-purple-200 font-bold">일일 학습 목표</div>
            <div class="font-extrabold text-white text-sm">
              매일 30분 루틴 (4단계)
            </div>
          </div>
        </div>

        <div class="p-3 rounded-2xl bg-white/10 backdrop-blur-sm space-y-1 text-xs">
          <div class="text-[10px] text-purple-200 font-bold">현재 선택된 학습 교재</div>
          <div class="font-bold text-white truncate">${currentTb.title}</div>
          <div class="text-[10px] text-indigo-200">${currentTb.categoryBadge}</div>
        </div>
      </div>

      <!-- Action Button -->
      <div class="pt-2 max-w-md mx-auto">
        <button onclick="finishOnboardingAndEnterApp()" class="w-full py-4 bg-gradient-to-r from-amber-400 via-orange-400 to-indigo-500 hover:from-amber-300 hover:to-indigo-400 text-gray-950 font-black rounded-2xl text-base transition-all shadow-xl shadow-orange-500/20 transform hover:-translate-y-0.5 active:translate-y-0 flex items-center justify-center gap-2">
          <span>🚀</span> <span>동도 롸이팅 마스터 대시보드 입장하기</span>
        </button>
      </div>
    </div>
  `;
}

// ----------------------------------------------------
// Finish Onboarding and enter App
// ----------------------------------------------------
async function finishOnboardingAndEnterApp() {
  const selectedLvl = state.onboardingSelectedLevel || 1;
  const recLvl = state.onboardingRecLevel || 1;
  const tbId = state.onboardingSelectedTextbook || "ybm_park_grade1";
  
  let targetTrack = "track1";
  if (selectedLvl >= 7 || tbId.includes("grade3") || tbId.includes("1001")) {
    targetTrack = "track3";
  } else if (selectedLvl >= 4 || tbId.includes("grade2") || tbId.includes("killer") || tbId.includes("yoon") || tbId.includes("lee") || tbId.includes("ebs")) {
    targetTrack = "track2";
  }

  try {
    // 1. Set Level API
    await fetch("/api/user/set_level", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: state.activeUserId,
        level: selectedLvl,
        recommendedLevel: recLvl,
        track: targetTrack,
        testScore: state.onboardingScore,
        textbookPrefix: tbId.startsWith("ybm_kim") ? "ybm_kim" : "ybm_park"
      })
    });

    // 2. Set Settings & Textbook API
    const curSettings = (state.userData && state.userData.settings) || {};
    curSettings.currentTextbookId = tbId;
    curSettings.activeTrack = targetTrack;
    curSettings.onboardingCompleted = true;
    await fetch("/api/user/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: state.activeUserId, settings: curSettings })
    });
  } catch (err) {
    console.error("Failed to save onboarding settings:", err);
  }

  triggerConfetti();
  await loadUserData();
  await restoreSavedSession();
  showView("view-app");
  showToast("🎉 축하합니다! 동도 롸이팅 마스터 학습실에 오신 것을 환영합니다!", "✨");
}
