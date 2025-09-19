// Vocab Trainer FR -> EN
// Stockage local: localStorage

(function() {
  const STORAGE_KEY = 'vocab_trainer_words_v1';
  const PREFS_KEY = 'vocab_trainer_prefs_v1';
  const DECKS_KEY = 'vocab_trainer_decks_v1';
  const USERS_KEY = 'vocab_trainer_users_v1';
  const HISTORY_KEY = 'vocab_trainer_history_v1';

  // Elements
  const tabs = document.querySelectorAll('.tab-button[data-tab]');
  const manageTab = document.getElementById('manage');
  const reviewTab = document.getElementById('review');
  const prefsTab = document.getElementById('prefs');
  const statsTab = document.getElementById('stats');
  const usersTab = document.getElementById('users');

  const addForm = document.getElementById('addWordForm');
  const frInput = document.getElementById('frInput');
  const enInput = document.getElementById('enInput');

  const wordsList = document.getElementById('wordsList');
  const wordsEmpty = document.getElementById('wordsEmpty');
  const exportBtn = document.getElementById('exportBtn');
  const importInput = document.getElementById('importInput');
  const clearAllBtn = document.getElementById('clearAllBtn');

  const deckSelect = document.getElementById('deckSelect');
  const newDeckBtn = document.getElementById('newDeckBtn');
  const userSelect = document.getElementById('userSelect');
  const newUserBtn = document.getElementById('newUserBtn');
  const userBadge = document.getElementById('userBadge');
  const currentUserNameTop = document.getElementById('currentUserNameTop');
  const usersListEl = document.getElementById('usersList');
  const deleteUserBtn = document.getElementById('deleteUserBtn');

  const startReviewBtn = document.getElementById('startReviewBtn');
  const shuffleToggle = document.getElementById('shuffleToggle');
  const reviewEmpty = document.getElementById('reviewEmpty');
  const quizArea = document.getElementById('quizArea');
  const promptEl = document.getElementById('prompt');
  const answerForm = document.getElementById('answerForm');
  const answerInput = document.getElementById('answerInput');
  const feedback = document.getElementById('feedback');
  const scoreEl = document.getElementById('score');
  const questionIndexEl = document.getElementById('questionIndex');
  const questionTotalEl = document.getElementById('questionTotal');
  const roundNumEl = document.getElementById('roundNum');
  const reviewDone = document.getElementById('reviewDone');
  const finalScore = document.getElementById('finalScore');
  const restartAllBtn = document.getElementById('restartAllBtn');
  const fireworksCheckbox = document.getElementById('fireworksCheckbox');
  const themeSelect = document.getElementById('themeSelect');
  const mascotSelect = document.getElementById('mascotSelect');
  const mascotEl = document.querySelector('.app-header .mascot');
  const historyTable = document.getElementById('historyTable');
  const historyTbody = document.getElementById('historyTbody');
  const historyEmpty = document.getElementById('historyEmpty');
  const clearHistoryBtn = document.getElementById('clearHistoryBtn');
  const statsCanvas = document.getElementById('statsChart');
  let statsChart = null;
  const celebrateImageCheckbox = document.getElementById('celebrateImageCheckbox');
  const celebrateImageInput = document.getElementById('celebrateImageInput');
  const celebrateImagePreview = document.getElementById('celebrateImagePreview');

  // State
  let words = loadWords();
  let prefs = loadPrefs();
  let decks = loadDecks();
  let users = loadUsers();
  // Ensure there is at least one deck and migrate existing words without deckId
  initDecksAndMigrate();
  initUsersAndPrefs();
  migrateWordErrorsPerUser();
  let session = null;
  let history = loadHistory();

  // ---- Server history (reviews) sync ----
  async function fetchHistoryFromServer() {
    if (!window.api || !window.api.getReviews || !prefs.selectedDeckId) return;
    try {
      const items = await window.api.getReviews(prefs.selectedDeckId);
      // Items already shaped similarly: { startedAt, endedAt, durationMs, totalQuestions, uniqueWords, perWord, summary, userId, deckId }
      history = Array.isArray(items) ? items.slice() : [];
      saveHistory();
      renderHistory();
      renderStatsChart();
    } catch (err) {
      console.warn('fetchHistoryFromServer failed:', err);
    }
  }

  function loadWords() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      console.error('Erreur de lecture localStorage:', e);
      return [];
    }
  }

  // ---- Server decks/words sync (SQLite via API) ----
  async function fetchDecksFromServer() {
    if (!window.api || !window.api.getDecks) return;
    try {
      const list = await window.api.getDecks();
      decks = (list || []).map(d => ({ id: d.id, name: d.name, createdAt: (d.created_at ? d.created_at * 1000 : Date.now()) }));
      saveDecks();
      if (!prefs.selectedDeckId || !decks.some(d => d.id === prefs.selectedDeckId)) {
        if (decks[0]) {
          prefs.selectedDeckId = decks[0].id;
          savePrefs();
        }
      }
      renderDecks();
    } catch (err) {
      console.warn('fetchDecksFromServer failed:', err);
    }
  }

  async function fetchWordsForSelectedDeck() {
    if (!window.api || !window.api.getWords || !prefs.selectedDeckId) return;
    try {
      const items = await window.api.getWords(prefs.selectedDeckId);
      words = (items || []).map(w => ({
        id: w.id,
        fr: w.fr,
        en: Array.isArray(w.en) ? w.en : [],
        errors: w.errors || 0,
        errorsByUser: w.errorsByUser || {},
        createdAt: w.createdAt || Date.now(),
        deckId: prefs.selectedDeckId,
      }));
      saveWords();
      renderWords();
      refreshReviewAvailability();
    } catch (err) {
      console.warn('fetchWordsForSelectedDeck failed:', err);
    }
  }

  function updateUserTabState() {
    if (!deleteUserBtn) return;
    const selectedId = prefs.selectedUserId;
    const isLast = users.length <= 1;
    const hasHist = history.some(h => h.userId === selectedId);
    deleteUserBtn.disabled = isLast || hasHist;
    deleteUserBtn.title = isLast
      ? 'Impossible de supprimer le dernier utilisateur'
      : (hasHist ? "Cet utilisateur a de l'historique et ne peut pas être supprimé." : 'Supprimer utilisateur');
  }

  // ------- Toast notifications -------
  let toastContainer = null;
  function ensureToastContainer() {
    if (toastContainer) return toastContainer;
    toastContainer = document.createElement('div');
    toastContainer.className = 'toast-container';
    document.body.appendChild(toastContainer);
    return toastContainer;
  }

  function showToast(message, type = 'success') {
    const cont = ensureToastContainer();
    const div = document.createElement('div');
    div.className = `toast ${type}`;
    div.textContent = message;
    cont.appendChild(div);
    requestAnimationFrame(() => div.classList.add('show'));
    setTimeout(() => {
      div.classList.remove('show');
      setTimeout(() => div.remove(), 300);
    }, 2000);
  }

  function applyMascot() {
    if (mascotEl && prefs && prefs.mascot) {
      mascotEl.textContent = prefs.mascot;
    }
    // Also update the browser tab title with the mascot
    try {
      const baseTitle = 'Vocab Trainer FR ↔ EN';
      const emoji = (prefs && prefs.mascot) ? prefs.mascot + ' ' : '';
      document.title = `${emoji}${baseTitle}`;
    } catch {}
    // And update the favicon to an emoji-based icon (to avoid default globe)
    try {
      if (prefs && prefs.mascot) setFaviconEmoji(prefs.mascot);
    } catch {}
  }

  function setFaviconEmoji(emoji) {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    // Optional background for better visibility in light/dark themes
    ctx.clearRect(0, 0, size, size);
    // Draw emoji centered
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Pick a good font size for emoji rendering
    ctx.font = `${Math.floor(size * 0.78)}px sans-serif`;
    ctx.fillText(emoji, size / 2, size / 2 + 2);
    const url = canvas.toDataURL('image/png');

    let link = document.querySelector('link[rel="icon"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.type = 'image/png';
    link.href = url;
  }

  function applyCelebrateImagePreview() {
    if (!celebrateImagePreview) return;
    if (prefs && prefs.celebrateImageData) {
      celebrateImagePreview.src = prefs.celebrateImageData;
      celebrateImagePreview.style.display = 'inline-block';
    } else {
      celebrateImagePreview.removeAttribute('src');
      celebrateImagePreview.style.display = 'none';
    }
  }

  // -------- Text-to-Speech (pronounce correct answer) --------
  function pickEnglishVoice() {
    try {
      const voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
      if (!voices || !voices.length) return null;
      // Prefer en-GB/en-US voices
      return (
        voices.find(v => /en-GB/i.test(v.lang)) ||
        voices.find(v => /en-US/i.test(v.lang)) ||
        voices.find(v => /^en/i.test(v.lang)) ||
        null
      );
    } catch {
      return null;
    }
  }

  function speakText(text) {
    if (!('speechSynthesis' in window)) return;
    if (!text) return;
    try {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      const voice = pickEnglishVoice();
      if (voice) utter.voice = voice;
      utter.lang = (voice && voice.lang) || 'en-US';
      utter.rate = 0.95;
      utter.pitch = 1.0;
      window.speechSynthesis.speak(utter);
    } catch {}
  }

  function speakCorrectAnswer(word) {
    if (!word) return;
    const text = (word.en && word.en.length) ? word.en.join(', ') : '';
    speakText(text);
  }

  function speakCorrectThenPraise(word) {
    if (!('speechSynthesis' in window)) return;
    if (!word) return;
    const text = (word.en && word.en.length) ? word.en.join(', ') : '';
    if (!text) { speakFrench('Bien joué ALex'); return; }
    try {
      // Speak English answer, then French praise
      const utterEn = new SpeechSynthesisUtterance(text);
      const vEn = pickEnglishVoice();
      if (vEn) utterEn.voice = vEn;
      utterEn.lang = (vEn && vEn.lang) || 'en-US';
      utterEn.rate = 0.95;
      utterEn.pitch = 1.0;
      utterEn.onend = () => {
        speakFrench('Bien joué ALex');
      };
      window.speechSynthesis.speak(utterEn);
    } catch {
      // Fallback: speak separately
      speakText(text);
      setTimeout(() => speakFrench('Bien joué ALex'), 500);
    }
  }

  function pickFrenchVoice() {
    try {
      const voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
      if (!voices || !voices.length) return null;
      return (
        voices.find(v => /fr-FR/i.test(v.lang)) ||
        voices.find(v => /^fr/i.test(v.lang)) ||
        null
      );
    } catch {
      return null;
    }
  }

  function speakFrench(text) {
    if (!('speechSynthesis' in window)) return;
    if (!text) return;
    try {
      const utter = new SpeechSynthesisUtterance(text);
      const voice = pickFrenchVoice();
      if (voice) utter.voice = voice;
      utter.lang = (voice && voice.lang) || 'fr-FR';
      utter.rate = 1.0;
      utter.pitch = 1.0;
      window.speechSynthesis.speak(utter);
    } catch {}
  }

  // Show image overlay briefly on correct answer
  let celebrateImgOverlay = null;
  function showCelebrateImage() {
    if (!prefs || !prefs.celebrateImageEnabled || !prefs.celebrateImageData) return;
    if (!celebrateImgOverlay) {
      celebrateImgOverlay = document.createElement('img');
      celebrateImgOverlay.className = 'celebrate-overlay-img';
      document.body.appendChild(celebrateImgOverlay);
    }
    celebrateImgOverlay.src = prefs.celebrateImageData;
    celebrateImgOverlay.style.display = 'block';
    // hide after 1.2s
    setTimeout(() => {
      if (celebrateImgOverlay) celebrateImgOverlay.style.display = 'none';
    }, 1200);
  }

  function saveWords() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(words));
    } catch (e) {
      console.error('Erreur d\'écriture localStorage:', e);
    }
  }

  function loadPrefs() {
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      return raw ? JSON.parse(raw) : { shuffle: true, fireworks: true, theme: 'dark', mascot: '🦊', celebrateImageEnabled: false, celebrateImageData: null };
    } catch (e) {
      return { shuffle: true, fireworks: true, theme: 'dark', mascot: '🦊', celebrateImageEnabled: false, celebrateImageData: null };
    }
  }

  function applyTheme() {
    const theme = (prefs && prefs.theme) || 'dark';
    const root = document.documentElement;
    if (theme === 'light') {
      root.classList.add('theme-light');
    } else {
      root.classList.remove('theme-light');
    }
  }

  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch (e) {}
    // Also push to server if available
    try {
      if (window.api && typeof window.api.setPrefs === 'function' && prefs && prefs.selectedUserId) {
        // Fire and forget
        window.api.setPrefs(prefs.selectedUserId, prefs).catch(() => {});
      }
    } catch {}
  }

  function loadUsers() {
    try {
      const raw = localStorage.getItem(USERS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function saveUsers() {
    try {
      localStorage.setItem(USERS_KEY, JSON.stringify(users));
    } catch (e) {}
  }

  // ---- Server users sync (SQLite via API) ----
  async function syncPrefsFromServer(userId) {
    if (!userId || !window.api || !window.api.getPrefs) return;
    try {
      const serverPrefs = await window.api.getPrefs(userId);
      if (serverPrefs && typeof serverPrefs === 'object') {
        // Merge server prefs into local, but ensure selectedUserId is consistent
        prefs = { ...prefs, ...serverPrefs, selectedUserId: userId };
        savePrefs();
        // Re-apply UI-affecting prefs
        applyTheme();
        applyMascot();
        applyShuffleButton();
        applyCelebrateImagePreview();
      } else {
        // No prefs on server yet: seed with local prefs
        await window.api.setPrefs(userId, prefs);
      }
    } catch (err) {
      console.warn('syncPrefsFromServer failed:', err);
    }
  }
  async function fetchUsersFromServer() {
    if (!window.api || !window.api.getUsers) return;
    try {
      const list = await window.api.getUsers();
      // Map server fields to client format (created_at seconds -> ms)
      users = (list || []).map(u => ({ id: u.id, name: u.name, createdAt: (u.created_at ? u.created_at * 1000 : Date.now()) }));
      saveUsers();
      // Ensure selected user is valid
      if (!prefs.selectedUserId || !users.some(u => u.id === prefs.selectedUserId)) {
        if (users[0]) {
          prefs.selectedUserId = users[0].id;
          savePrefs();
        }
      }
      renderUsers();
      applyUserBadge();
      renderUsersList();
      updateUserTabState();
    } catch (err) {
      console.warn('fetchUsersFromServer failed:', err);
    }
  }

  function loadHistory() {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function saveHistory() {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch (e) {}
  }

  function loadDecks() {
    try {
      const raw = localStorage.getItem(DECKS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function saveDecks() {
    try {
      localStorage.setItem(DECKS_KEY, JSON.stringify(decks));
    } catch (e) {}
  }

  function createDeck(name) {
    const d = { id: uid(), name: name || 'Vocabulaire', createdAt: Date.now() };
    decks.push(d);
    saveDecks();
    return d;
  }

  function initDecksAndMigrate() {
    if (!decks || decks.length === 0) {
      const def = { id: uid(), name: 'Vocab par défaut', createdAt: Date.now() };
      decks = [def];
      saveDecks();
      if (!prefs.selectedDeckId) {
        prefs.selectedDeckId = def.id;
        savePrefs();
      }
    } else if (!prefs.selectedDeckId) {
      prefs.selectedDeckId = decks[0].id;
      savePrefs();
    }
    // migrate words without deckId to selected/default deck
    let migrated = false;
    for (const w of words) {
      if (!w.deckId) {
        w.deckId = prefs.selectedDeckId;
        migrated = true;
      }
    }
    if (migrated) saveWords();
  }

  function renderDecks() {
    deckSelect.innerHTML = '';
    for (const d of decks) {
      const opt = document.createElement('option');
      opt.value = d.id;
      opt.textContent = d.name;
      if (d.id === prefs.selectedDeckId) opt.selected = true;
      deckSelect.appendChild(opt);
    }
  }

  function renderUsers() {
    if (!userSelect) return;
    userSelect.innerHTML = '';
    for (const u of users) {
      const opt = document.createElement('option');
      opt.value = u.id;
      opt.textContent = u.name;
      if (u.id === prefs.selectedUserId) opt.selected = true;
      userSelect.appendChild(opt);
    }
  }

  function renderUsersList() {
    if (!usersListEl) return;
    usersListEl.innerHTML = '';
    // compute history counts per user for current deck overall or all decks? Use all decks for delete guard consistency
    const counts = {};
    for (const h of history) {
      counts[h.userId] = (counts[h.userId] || 0) + 1;
    }
    const ul = usersListEl;
    for (const u of users) {
      const li = document.createElement('li');
      li.dataset.userId = u.id;
      li.style.display = 'grid';
      li.style.gridTemplateColumns = '1fr auto auto auto';
      li.style.alignItems = 'center';
      const nameSpan = document.createElement('span');
      nameSpan.textContent = u.name;
      const histBadge = document.createElement('span');
      const c = counts[u.id] || 0;
      histBadge.className = 'badge';
      histBadge.textContent = `historique: ${c}`;
      const activeBadge = document.createElement('span');
      activeBadge.className = 'badge';
      activeBadge.textContent = (u.id === prefs.selectedUserId) ? 'actif' : '';
      if (u.id !== prefs.selectedUserId) activeBadge.style.visibility = 'hidden';
      const deletableBadge = document.createElement('span');
      const deletable = (c === 0) && users.length > 1;
      deletableBadge.className = 'badge deletable';
      if (deletable) {
        deletableBadge.textContent = 'supprimable';
        deletableBadge.style.visibility = 'visible';
      } else {
        deletableBadge.textContent = '';
        deletableBadge.style.visibility = 'hidden';
      }
      li.appendChild(nameSpan);
      li.appendChild(histBadge);
      li.appendChild(activeBadge);
      li.appendChild(deletableBadge);
      ul.appendChild(li);
    }
  }

  function applyUserBadge() {
    const u = users.find(x => x.id === prefs.selectedUserId);
    if (userBadge) userBadge.textContent = u ? u.name : '—';
    if (currentUserNameTop) currentUserNameTop.textContent = u ? u.name : '—';
  }

  function getCurrentDeckWords() {
    return words.filter(w => w.deckId === prefs.selectedDeckId);
  }

  function initUsersAndPrefs() {
    if (!users || users.length === 0) {
      const def = { id: uid(), name: 'Alex', createdAt: Date.now() };
      users = [def];
      saveUsers();
      prefs.selectedUserId = def.id;
      savePrefs();
    } else if (!prefs.selectedUserId) {
      prefs.selectedUserId = users[0].id;
      savePrefs();
    }
  }

  function migrateWordErrorsPerUser() {
    // If words have numeric `errors`, move them to per-user map for backward compatibility
    let changed = false;
    for (const w of words) {
      if (typeof w.errorsByUser !== 'object' || w.errorsByUser === null) {
        w.errorsByUser = {};
      }
      if (typeof w.errors === 'number' && w.errors > 0) {
        const uidKey = prefs.selectedUserId || (users[0] && users[0].id);
        if (uidKey) {
          w.errorsByUser[uidKey] = (w.errorsByUser[uidKey] || 0) + (w.errors || 0);
          changed = true;
        }
        // keep w.errors for legacy display 0, but stop using it
      }
    }
    if (changed) saveWords();
  }

  function getErrorsForCurrentUser(w) {
    if (!w) return 0;
    if (w.errorsByUser && prefs.selectedUserId) return w.errorsByUser[prefs.selectedUserId] || 0;
    return 0;
  }

  function incErrorsForCurrentUser(w) {
    if (!w) return;
    if (!w.errorsByUser) w.errorsByUser = {};
    const uidKey = prefs.selectedUserId;
    if (!uidKey) return;
    w.errorsByUser[uidKey] = (w.errorsByUser[uidKey] || 0) + 1;
  }

  function getCurrentDeckHistory() {
    return history.filter(h => h.deckId === prefs.selectedDeckId);
  }

  function uid() {
    return 'w_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  function normalize(str) {
    return (str || '')
      .toString()
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{Diacritic}+/gu, '');
  }

  function parseTranslations(input) {
    return input
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function renderWords() {
    const deckWords = getCurrentDeckWords();
    wordsList.innerHTML = '';
    if (!deckWords.length) {
      wordsEmpty.style.display = 'block';
      return;
    }
    wordsEmpty.style.display = 'none';

    // Sort by number of errors (desc), then French word (asc)
    const list = [...deckWords].sort((a, b) => {
      const ea = a.errors || 0;
      const eb = b.errors || 0;
      if (eb !== ea) return eb - ea;
      return String(a.fr).localeCompare(String(b.fr), 'fr', { sensitivity: 'base' });
    });

    for (const w of list) {
      const li = document.createElement('li');
      const wordSpan = document.createElement('span');
      wordSpan.className = 'word';
      wordSpan.textContent = w.fr;

      const transSpan = document.createElement('span');
      transSpan.className = 'translations';
      transSpan.textContent = w.en.join(', ');

      const actions = document.createElement('div');
      actions.style.display = 'flex';
      actions.style.alignItems = 'center';
      actions.style.gap = '8px';

      const badge = document.createElement('span');
      badge.className = 'badge';
      const errors = getErrorsForCurrentUser(w);
      badge.textContent = errors ? `${errors} erreur${errors>1?'s':''}` : '0 erreur';

      const delBtn = document.createElement('button');
      delBtn.className = 'icon-btn';
      delBtn.textContent = 'Supprimer';
      delBtn.title = 'Supprimer ce mot';
      delBtn.addEventListener('click', async () => {
        if (!confirm(`Supprimer le mot "${w.fr}" ?`)) return;
        try {
          await window.api.deleteWord(w.id);
          await fetchWordsForSelectedDeck();
          refreshReviewAvailability();
        } catch (e) {
          alert('Erreur suppression: ' + (e.message || e));
        }
      });

      actions.appendChild(badge);
      actions.appendChild(delBtn);

      li.appendChild(wordSpan);
      li.appendChild(transSpan);
      li.appendChild(actions);

      wordsList.appendChild(li);
    }
  }

  function refreshReviewAvailability() {
    const hasWords = getCurrentDeckWords().length > 0;
    reviewEmpty.style.display = hasWords ? 'none' : 'block';
    startReviewBtn.disabled = !hasWords;
  }

  // Tab switching utility
  function switchTab(tabName) {
    // Update section visibility
    manageTab.classList.toggle('active', tabName === 'manage');
    reviewTab.classList.toggle('active', tabName === 'review');
    if (prefsTab) prefsTab.classList.toggle('active', tabName === 'prefs');
    if (usersTab) usersTab.classList.toggle('active', tabName === 'users');
    if (statsTab) statsTab.classList.toggle('active', tabName === 'stats');

    // Update nav tab button active state (only those inside nav.tabs)
    document.querySelectorAll('nav.tabs .tab-button').forEach(b => {
      b.classList.toggle('active', b.dataset.tab === tabName);
    });

    // On-demand renders for certain tabs
    if (tabName === 'manage') {
      renderWords();
    } else if (tabName === 'users') {
      renderUsers();
      applyUserBadge();
      renderUsersList();
      updateUserTabState();
    } else if (tabName === 'stats') {
      // Ensure server history is up to date before rendering
      fetchHistoryFromServer().then(() => {
        renderHistory();
        renderStatsChart();
      });
    }
  }

  // Wire any button with data-tab to switch tabs (nav buttons, close buttons, shortcuts)
  document.querySelectorAll('[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Header gear button to go to Manage tab
  const gotoManageBtn = document.getElementById('gotoManageBtn');
  if (gotoManageBtn) {
    gotoManageBtn.addEventListener('click', () => switchTab('manage'));
  }

  // Header preferences button (top-right)
  const headerPrefsBtn = document.querySelector('.header-actions [data-tab="prefs"]');
  if (headerPrefsBtn) {
    headerPrefsBtn.addEventListener('click', () => switchTab('prefs'));
  }

  // Click on user badge in header opens Users tab
  if (userBadge) {
    userBadge.style.cursor = 'pointer';
    userBadge.title = 'Gérer les utilisateurs';
    userBadge.addEventListener('click', () => switchTab('users'));
  }

  // Users button at top of Users section
  const gotoUsersBtn = document.getElementById('gotoUsersBtn');
  if (gotoUsersBtn) {
    gotoUsersBtn.addEventListener('click', () => switchTab('users'));
  }

  // Header Users button next to user badge
  const gotoUsersHeaderBtn = document.getElementById('gotoUsersHeaderBtn');
  if (gotoUsersHeaderBtn) {
    gotoUsersHeaderBtn.addEventListener('click', () => switchTab('users'));
  }

  // Gear button label: show emoji by default; show text on window blur/hidden
  function setGearLabelFocused(isFocused) {
    if (!gotoManageBtn) return;
    gotoManageBtn.textContent = isFocused ? '⚙️' : 'Vocabulaire';
  }
  setGearLabelFocused(!document.hidden);
  window.addEventListener('focus', () => setGearLabelFocused(true));
  window.addEventListener('blur', () => setGearLabelFocused(false));
  document.addEventListener('visibilitychange', () => setGearLabelFocused(!document.hidden));

  // Add word
  addForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fr = frInput.value.trim();
    const enRaw = enInput.value.trim();
    if (!fr || !enRaw) return;

    const en = parseTranslations(enRaw);
    try {
      // Ensure we have a valid selected deck that exists on server
      if (!prefs.selectedDeckId || !decks.some(d => d.id === prefs.selectedDeckId)) {
        await fetchDecksFromServer();
        if (!prefs.selectedDeckId && decks[0]) {
          prefs.selectedDeckId = decks[0].id;
          savePrefs();
        }
      }
      await window.api.createWord(prefs.selectedDeckId, { fr, en });
      await fetchWordsForSelectedDeck();
    } catch (err) {
      alert('Erreur ajout mot: ' + (err.message || err));
    }

    frInput.value = '';
    enInput.value = '';
    frInput.focus();
    refreshReviewAvailability();
  });

  // Export
  exportBtn.addEventListener('click', () => {
    const list = getCurrentDeckWords();
    const data = JSON.stringify(list, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    // try to use deck name in filename
    const deck = decks.find(d => d.id === prefs.selectedDeckId);
    const name = deck ? deck.name.replace(/\s+/g, '-').toLowerCase() : 'deck';
    a.download = `vocab-trainer-${name}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });

  // Import
  importInput.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const imported = JSON.parse(text);
      if (!Array.isArray(imported)) throw new Error('format');
      let merged = [...words];
      for (const item of imported) {
        if (!item || typeof item !== 'object') continue;
        if (!item.fr || !item.en) continue;
        const en = Array.isArray(item.en) ? item.en : [String(item.en)];
        const existing = merged.find(w => normalize(w.fr) === normalize(item.fr) && w.deckId === prefs.selectedDeckId);
        if (existing) {
          const set = new Set([...existing.en, ...en]);
          existing.en = Array.from(set);
          existing.errors = Math.max(existing.errors || 0, item.errors || 0);
        } else {
          merged.push({
            id: uid(),
            fr: String(item.fr),
            en: en.map(String),
            errors: item.errors || 0,
            createdAt: Date.now(),
            deckId: prefs.selectedDeckId,
          });
        }
      }
      words = merged;
      saveWords();
      renderWords();
      refreshReviewAvailability();
      importInput.value = '';
      alert('Import terminé.');
    } catch (err) {
      alert('Fichier invalide: ' + err.message);
    }
  });

  // Clear all
  clearAllBtn.addEventListener('click', async () => {
    const count = getCurrentDeckWords().length;
    if (!count) return;
    if (confirm('Supprimer tous les mots de ce vocabulaire ?')) {
      try {
        await window.api.clearDeckWords(prefs.selectedDeckId);
        await fetchWordsForSelectedDeck();
        refreshReviewAvailability();
      } catch (e) {
        alert('Erreur lors du vidage: ' + (e.message || e));
      }
    }
  });

  // Shuffle toggle
  function applyShuffleButton() {
    shuffleToggle.setAttribute('aria-pressed', prefs.shuffle ? 'true' : 'false');
    shuffleToggle.textContent = `Aléatoire: ${prefs.shuffle ? 'ON' : 'OFF'}`;
  }
  shuffleToggle.addEventListener('click', () => {
    prefs.shuffle = !prefs.shuffle;
    savePrefs();
    applyShuffleButton();
  });

  // Review session
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // Confetti effect (lightweight): overlay canvas
  let confettiCanvas = null;
  let confettiCtx = null;
  function ensureConfettiCanvas() {
    if (confettiCanvas) return;
    confettiCanvas = document.createElement('canvas');
    confettiCanvas.style.position = 'fixed';
    confettiCanvas.style.left = '0';
    confettiCanvas.style.top = '0';
    confettiCanvas.style.width = '100%';
    confettiCanvas.style.height = '100%';
    confettiCanvas.style.pointerEvents = 'none';
    confettiCanvas.style.zIndex = '9999';
    document.body.appendChild(confettiCanvas);
    confettiCtx = confettiCanvas.getContext('2d');
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      confettiCanvas.width = Math.floor(window.innerWidth * dpr);
      confettiCanvas.height = Math.floor(window.innerHeight * dpr);
      confettiCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    window.addEventListener('resize', resize);
    resize();
  }

  function fireConfettiAt(x, y, opts = {}) {
    ensureConfettiCanvas();
    const ctx = confettiCtx;
    const colors = ['#22c55e', '#60a5fa', '#f59e0b', '#ef4444', '#a78bfa'];
    const count = opts.count || 90;
    const gravity = 0.24;
    const drag = 0.005;
    const spread = Math.PI * 2;
    const sizeMin = 3, sizeMax = 6;

    const particles = [];
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * spread;
      const speed = 4 + Math.random() * 6;
      particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 2,
        size: sizeMin + Math.random() * (sizeMax - sizeMin),
        color: colors[Math.floor(Math.random() * colors.length)],
        life: 900 + Math.random() * 400,
        rotation: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.2,
      });
    }

    const start = performance.now();
    function frame(t) {
      const elapsed = t - start;
      ctx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
      let alive = 0;
      for (const p of particles) {
        p.vx *= (1 - drag);
        p.vy += gravity;
        p.x += p.vx;
        p.y += p.vy;
        p.rotation += p.vr;
        p.life -= 16.7;
        if (p.life > 0 && p.y < window.innerHeight + 40 && p.x > -40 && p.x < window.innerWidth + 40) {
          alive++;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rotation);
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.size/2, -p.size/2, p.size, p.size);
          ctx.restore();
        }
      }
      if (alive > 0 && elapsed < 2000) {
        requestAnimationFrame(frame);
      } else {
        ctx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
      }
    }
    requestAnimationFrame(frame);
  }

  function fireConfettiAtElement(el) {
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    fireConfettiAt(x, y);
  }

  function startSession(sourceWords) {
    const pool = sourceWords.map(w => ({ id: w.id }));
    if (prefs.shuffle) shuffle(pool);
    session = {
      round: 1,
      pool,
      index: 0,
      score: 0,
      errorsNextRound: [], // ids
      startedAt: Date.now(),
      totalQuestions: pool.length,
      stats: initSessionStats(sourceWords),
      currentShownAt: null,
    };

    quizArea.classList.remove('hidden');
    reviewDone.classList.add('hidden');
    feedback.innerHTML = '';
    scoreEl.textContent = '0';
    questionIndexEl.textContent = '1';
    questionTotalEl.textContent = String(pool.length);
    roundNumEl.textContent = '1';
    renderCurrentQuestion();
  }

  function findWordById(id) {
    return words.find(w => w.id === id);
  }

  function renderCurrentQuestion() {
    if (!session) return;
    if (session.index >= session.pool.length) {
      // fin de round
      if (session.errorsNextRound.length) {
        session.round += 1;
        session.pool = session.errorsNextRound.map(id => ({ id }));
        if (prefs.shuffle) shuffle(session.pool);
        session.index = 0;
        session.errorsNextRound = [];
        scoreEl.textContent = '0';
        session.score = 0;
        questionIndexEl.textContent = '1';
        questionTotalEl.textContent = String(session.pool.length);
        roundNumEl.textContent = String(session.round);
        feedback.innerHTML = '';
        renderCurrentQuestion();
        return;
      } else {
        // terminé
        finalScore.textContent = String(session.score);
        quizArea.classList.add('hidden');
        reviewDone.classList.remove('hidden');
        // Ensure list view shows updated error counters when user returns
        renderWords();
        // enregistrer l'historique de session
        finalizeAndStoreSessionHistory();
        // Also post to server history if available
        try {
          if (window.api && typeof window.api.createReview === 'function') {
            const last = history[history.length - 1];
            if (last) window.api.createReview(last).catch((e)=>console.warn('createReview failed:', e));
          }
        } catch (e) { console.warn('createReview failed:', e); }
        renderHistory();
        renderStatsChart();
        renderUsersList();
        session = null;
        return;
      }
    }

    const qid = session.pool[session.index].id;
    const w = findWordById(qid);
    if (!w) {
      // supprimer les ids obsolètes
      session.pool.splice(session.index, 1);
      questionTotalEl.textContent = String(session.pool.length);
      renderCurrentQuestion();
      return;
    }
    promptEl.textContent = w.fr;
    questionIndexEl.textContent = String(session.index + 1);
    answerInput.value = '';
    answerInput.focus();
    session.currentShownAt = performance.now();
  }

  function checkAnswer(userAnswer, w) {
    const ans = normalize(userAnswer);
    if (!ans) return false;
    const acceptable = w.en.map(e => normalize(e));

    // Exact match or small variants (articles/punct)
    return acceptable.some(a => a === ans);
  }

  answerForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!session) return;
    const qid = session.pool[session.index].id;
    const w = findWordById(qid);
    if (!w) return;

    const userAns = answerInput.value;
    const ok = checkAnswer(userAns, w);
    // collect timing for this question
    const now = performance.now();
    const elapsedMs = session.currentShownAt ? Math.max(0, now - session.currentShownAt) : 0;
    trackPerWordStat(w, { correct: ok, elapsedMs });
    if (ok) {
      feedback.innerHTML = `<span class="ok">Correct ✔</span>`;
      session.score += 1;
      scoreEl.textContent = String(session.score);
      // Celebrate if enabled
      if (!('fireworks' in prefs) || prefs.fireworks) {
        fireConfettiAtElement(promptEl);
      }
      // Optional celebrate image
      showCelebrateImage();
      // Speak only the correct English answer (no French praise)
      speakCorrectAnswer(w);
    } else {
      feedback.innerHTML = `
        <div class="incorrect-row">
          <span class="cross">✘</span>
          <span class="incorrect-text">Réponse incorrecte</span>
        </div>
        <div class="expected-big">${w.en.map(escapeHtml).join(', ')}</div>
      `;
      incErrorsForCurrentUser(w);
      saveWords();
      // Reposer ce mot au round suivant
      session.errorsNextRound.push(w.id);
      // Speak only the correct English answer (no French praise)
      speakCorrectAnswer(w);
    }

    // question suivante (attente plus longue si incorrect)
    const delay = ok ? 500 : 3000;
    session.index += 1;
    setTimeout(() => {
      feedback.innerHTML = '';
      renderCurrentQuestion();
    }, delay);
  });

  // ------- Session history & stats -------
  function initSessionStats(sourceWords) {
    const map = {};
    for (const w of sourceWords) {
      map[w.id] = { fr: w.fr, en: [...w.en], attempts: 0, errors: 0, sumMs: 0 };
    }
    return map;
  }

  function trackPerWordStat(word, { correct, elapsedMs }) {
    if (!session || !session.stats) return;
    const rec = session.stats[word.id] || (session.stats[word.id] = { fr: word.fr, en: [...word.en], attempts: 0, errors: 0, sumMs: 0 });
    rec.attempts += 1;
    rec.sumMs += elapsedMs || 0;
    if (!correct) rec.errors += 1;
  }

  function finalizeAndStoreSessionHistory() {
    if (!session) return;
    const endedAt = Date.now();
    const durationMs = Math.max(0, endedAt - (session.startedAt || endedAt));
    // build per-word averages
    const perWord = {};
    let totalSum = 0, totalAttempts = 0, errorsTotal = 0, firstPassCorrect = 0;
    for (const [wid, s] of Object.entries(session.stats || {})) {
      const avgMs = s.attempts ? Math.round(s.sumMs / s.attempts) : 0;
      perWord[wid] = { fr: s.fr, en: s.en, errors: s.errors, attempts: s.attempts, avgMs };
      totalSum += s.sumMs;
      totalAttempts += s.attempts;
      errorsTotal += s.errors;
      if (s.attempts >= 1 && s.errors === 0) firstPassCorrect += 1;
    }
    const avgMsOverall = totalAttempts ? Math.round(totalSum / totalAttempts) : 0;
    const uniqueCount = Object.keys(perWord).length;
    // Selon la demande: calculer le pourcentage à partir de "questions" et "erreurs"
    const questions = session.totalQuestions || uniqueCount;
    const firstPassPct = questions ? Math.round(((questions - errorsTotal) / questions) * 100) : 0;
    const record = {
      id: uid(),
      deckId: prefs.selectedDeckId,
      userId: prefs.selectedUserId,
      startedAt: session.startedAt || endedAt,
      endedAt,
      durationMs,
      totalQuestions: session.totalQuestions || 0,
      uniqueWords: uniqueCount,
      perWord,
      summary: { errorsTotal, avgMsOverall, firstPassPct }
    };
    history.push(record);
    saveHistory();
  }

  function renderHistory() {
    if (!historyTbody || !historyEmpty) return;
    const items = getCurrentDeckHistory().filter(h => h.userId === prefs.selectedUserId).slice().sort((a,b)=>b.startedAt - a.startedAt).slice(0, 50);
    historyTbody.innerHTML = '';
    if (!items.length) {
      historyEmpty.style.display = 'block';
      if (historyTable) historyTable.style.display = 'none';
      return;
    }
    historyEmpty.style.display = 'none';
    if (historyTable) historyTable.style.display = 'table';
    for (const it of items) {
      const tr = document.createElement('tr');
      const date = new Date(it.startedAt).toLocaleString();
      const durMin = (it.durationMs / 60000).toFixed(1);
      const avgSec = (it.summary.avgMsOverall / 1000).toFixed(1);
      const questions = it.totalQuestions || it.uniqueWords || 0;

      const tdDate = document.createElement('td'); tdDate.textContent = date; tr.appendChild(tdDate);
      const tdDur = document.createElement('td'); tdDur.textContent = durMin; tr.appendChild(tdDur);
      const tdQ = document.createElement('td'); tdQ.textContent = String(questions); tr.appendChild(tdQ);
      const tdFirst = document.createElement('td'); tdFirst.textContent = String(it.summary.firstPassPct); tr.appendChild(tdFirst);
      const tdErr = document.createElement('td'); tdErr.textContent = String(it.summary.errorsTotal); tr.appendChild(tdErr);
      const tdAvg = document.createElement('td'); tdAvg.textContent = avgSec; tr.appendChild(tdAvg);
      const tdDet = document.createElement('td');
      const details = document.createElement('details');
      const summary = document.createElement('summary'); summary.textContent = 'Voir'; details.appendChild(summary);
      const ul = document.createElement('ul');
      const sortedEntries = Object.entries(it.perWord).sort((a, b) => {
        const ea = a[1].errors || 0;
        const eb = b[1].errors || 0;
        if (eb !== ea) return eb - ea;
        return String(a[1].fr).localeCompare(String(b[1].fr), 'fr', { sensitivity: 'base' });
      });
      for (const [wid, s] of sortedEntries) {
        const wi = document.createElement('li');
        const avgSecWord = (s.avgMs / 1000).toFixed(1);
        wi.textContent = `${s.fr} → ${s.en.join(', ')} — erreurs ${s.errors}, essais ${s.attempts}, moy ${avgSecWord} s`;
        ul.appendChild(wi);
      }
      details.appendChild(ul);
      tdDet.appendChild(details);
      tr.appendChild(tdDet);
      historyTbody.appendChild(tr);
    }
  }

  // ------- Stats Chart (first-try correct per session) -------
  function computeStatsSeries() {
    const items = getCurrentDeckHistory()
      .filter(h => h.userId === prefs.selectedUserId)
      .slice()
      .sort((a, b) => a.startedAt - b.startedAt); // oldest -> newest
    const labels = items.map(it => new Date(it.startedAt).toLocaleString(undefined, {
      year: '2-digit', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit'
    }));
    const data = items.map(it => {
      const questions = it.totalQuestions || 0;
      const errors = (it.summary && it.summary.errorsTotal) || 0;
      const firstTryCorrect = Math.max(0, questions - errors);
      return firstTryCorrect;
    });
    return { labels, data };
  }

  function renderStatsChart() {
    if (!statsCanvas || typeof Chart === 'undefined') return;
    const { labels, data } = computeStatsSeries();
    const dataset = {
      label: 'Bonnes réponses au 1er coup',
      data,
      borderColor: '#60a5fa',
      backgroundColor: 'rgba(96,165,250,0.25)',
      fill: true,
      tension: 0.25,
      pointRadius: 3,
    };
    const cfg = {
      type: 'line',
      data: { labels, datasets: [dataset] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => `${ctx.parsed.y} première(s) tentative(s)` } }
        },
        scales: {
          x: { title: { display: true, text: 'Date' } },
          y: { beginAtZero: true, title: { display: true, text: 'Bonnes réponses (1er coup)' } }
        }
      }
    };
    if (statsChart) {
      statsChart.data.labels = labels;
      statsChart.data.datasets[0].data = data;
      statsChart.update();
    } else {
      statsChart = new Chart(statsCanvas.getContext('2d'), cfg);
    }
  }

  startReviewBtn.addEventListener('click', () => {
    const deckWords = getCurrentDeckWords();
    if (!deckWords.length) return;
    startSession(deckWords);
  });

  restartAllBtn.addEventListener('click', () => {
    const deckWords = getCurrentDeckWords();
    if (!deckWords.length) return;
    startSession(deckWords);
  });

  // Deck select handlers
  deckSelect.addEventListener('change', async () => {
    prefs.selectedDeckId = deckSelect.value;
    savePrefs();
    await fetchWordsForSelectedDeck();
    await fetchHistoryFromServer();
    renderHistory();
    renderStatsChart();
    renderUsersList();
    updateUserTabState();
  });

  // Create new deck (vocab)
  if (newDeckBtn) {
    newDeckBtn.addEventListener('click', async () => {
      const name = prompt('Nom du nouveau vocabulaire (ex: voc unit 1)');
      if (!name) return; // cancelled
      const clean = name.trim();
      if (!clean) return;
      const prevText = newDeckBtn.textContent;
      newDeckBtn.disabled = true;
      newDeckBtn.textContent = 'Création...';
      try {
        const created = await window.api.createDeck(clean);
        await fetchDecksFromServer();
        prefs.selectedDeckId = created.id;
        savePrefs();
        renderDecks();
        await fetchWordsForSelectedDeck();
        showToast(`Vocabulaire "${clean}" créé`, 'success');
      } catch (e) {
        // If deck name exists, select it
        if ((e && e.message) === 'name_exists') {
          await fetchDecksFromServer();
          const existing = decks.find(d => (d.name || '').trim().toLowerCase() === clean.toLowerCase());
          if (existing) {
            prefs.selectedDeckId = existing.id;
            savePrefs();
            renderDecks();
            await fetchWordsForSelectedDeck();
            showToast(`Vocabulaire "${clean}" déjà existant sélectionné`, 'success');
          } else {
            alert('Ce nom existe déjà.');
          }
        } else {
          alert('Erreur création vocabulaire: ' + (e.message || e));
        }
      } finally {
        newDeckBtn.disabled = false;
        newDeckBtn.textContent = prevText;
      }
    });
  }

  // User select handler (switch active user)
  userSelect.addEventListener('change', () => {
    prefs.selectedUserId = userSelect.value;
    savePrefs();
    applyUserBadge();
    renderUsersList();
    renderWords();
    refreshReviewAvailability();
    syncPrefsFromServer(prefs.selectedUserId);
  });

  // Supprimer l'utilisateur actif si et seulement si il n'a pas d'historique
  if (deleteUserBtn) {
    deleteUserBtn.addEventListener('click', async () => {
      if (!prefs.selectedUserId) return;
      if (users.length <= 1) { alert('Impossible de supprimer le dernier utilisateur.'); return; }
      const u = users.find(x => x.id === prefs.selectedUserId);
      const hasHistory = history.some(h => h.userId === prefs.selectedUserId);
      if (hasHistory) { alert('Cet utilisateur a de l\'historique et ne peut pas être supprimé.'); return; }
      if (!confirm(`Supprimer l'utilisateur "${u ? u.name : ''}" ?`)) return;
      try {
        await window.api.deleteUser(prefs.selectedUserId);
        await fetchUsersFromServer();
        // Select first available user if current was deleted
        if (!users.some(x => x.id === prefs.selectedUserId) && users[0]) {
          prefs.selectedUserId = users[0].id;
          savePrefs();
        }
        // Refresh dependent areas
        renderWords();
        refreshReviewAvailability();
        renderHistory();
        showToast('Utilisateur supprimé', 'success');
      } catch (e) {
        alert('Erreur lors de la suppression: ' + (e.message || e));
      }
    });
  }

  if (newUserBtn) {
    newUserBtn.addEventListener('click', async () => {
      const name = prompt('Nom du nouvel utilisateur');
      if (!name) return;
      const clean = name.trim();
      if (!clean) return;
      // Prevent duplicate locally (fast UX), server also enforces
      const exists = users.some(u => u.name.trim().toLowerCase() === clean.toLowerCase());
      if (exists) { alert('Ce nom d\'utilisateur existe déjà.'); return; }
      try {
        const created = await window.api.createUser(clean);
        prefs.selectedUserId = created.id;
        savePrefs();
        await fetchUsersFromServer();
        await syncPrefsFromServer(created.id);
        // Highlight the newly added user in list
        const li = usersListEl && usersListEl.querySelector(`li[data-user-id="${created.id}"]`);
        if (li) {
          li.classList.add('highlight');
          setTimeout(() => li.classList.remove('highlight'), 1200);
        }
        showToast('Utilisateur créé', 'success');
      } catch (e) {
        alert('Erreur lors de la création: ' + (e.message || e));
      }
    });
  }

  // Preferences wiring
  if (fireworksCheckbox) {
    fireworksCheckbox.checked = !('fireworks' in prefs) || !!prefs.fireworks;
    fireworksCheckbox.addEventListener('change', () => {
      prefs.fireworks = fireworksCheckbox.checked;
      savePrefs();
    });
  }

  if (themeSelect) {
    // default theme
    if (!('theme' in prefs)) {
      prefs.theme = 'dark';
      savePrefs();
    }
    themeSelect.value = prefs.theme;
    themeSelect.addEventListener('change', () => {
      prefs.theme = themeSelect.value;
      savePrefs();
      applyTheme();
    });
  }

  // Mascot preference wiring
  if (mascotSelect) {
    if (!('mascot' in prefs)) {
      prefs.mascot = '🦊';
      savePrefs();
    }
    mascotSelect.value = prefs.mascot;
    applyMascot();
    mascotSelect.addEventListener('change', () => {
      prefs.mascot = mascotSelect.value;
      savePrefs();
      applyMascot();
    });
  } else {
    applyMascot();
  }

  // Celebrate Image wiring
  if (celebrateImageCheckbox) {
    if (!('celebrateImageEnabled' in prefs)) {
      prefs.celebrateImageEnabled = false;
      savePrefs();
    }
    celebrateImageCheckbox.checked = !!prefs.celebrateImageEnabled;
    celebrateImageCheckbox.addEventListener('change', () => {
      prefs.celebrateImageEnabled = celebrateImageCheckbox.checked;
      savePrefs();
    });
  }

  if (celebrateImageInput) {
    celebrateImageInput.addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      if (!file.type.startsWith('image/')) { alert('Veuillez choisir une image.'); return; }
      const reader = new FileReader();
      reader.onload = () => {
        prefs.celebrateImageData = String(reader.result || '');
        savePrefs();
        applyCelebrateImagePreview();
      };
      reader.readAsDataURL(file);
    });
  }
  applyCelebrateImagePreview();

  // Initial render
  applyShuffleButton();
  applyTheme();
  renderUsers();
  applyUserBadge();
  renderHistory();
  renderStatsChart();
  renderUsersList();
  updateUserTabState();

  // Initial server sync for users (overrides local users), then load prefs for active user
  fetchUsersFromServer().then(() => {
    if (prefs && prefs.selectedUserId) syncPrefsFromServer(prefs.selectedUserId);
  });

  // Initial server sync for decks, words, and history
  fetchDecksFromServer().then(() => fetchWordsForSelectedDeck()).then(() => fetchHistoryFromServer());

  // Clear history button
  if (clearHistoryBtn) {
    clearHistoryBtn.addEventListener('click', async () => {
      const count = getCurrentDeckHistory().length;
      if (!count) return;
      if (confirm('Effacer l\'historique de ce vocabulaire ?')) {
        try {
          if (window.api && typeof window.api.clearDeckReviews === 'function') {
            await window.api.clearDeckReviews(prefs.selectedDeckId);
          }
        } catch (e) {
          console.warn('clearDeckReviews failed:', e);
        }
        // Clear local cache as well
        history = history.filter(h => h.deckId !== prefs.selectedDeckId);
        saveHistory();
        renderHistory();
        renderStatsChart();
        renderUsersList();
        updateUserTabState();
      }
    });
  }
})();
