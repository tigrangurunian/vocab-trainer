// Brain Sport FR -> EN
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
  const copyDeckBtn = document.getElementById('copyDeckBtn');
  const deckPrivacyCheckbox = document.getElementById('deckPrivacyCheckbox');
  const loginLink = document.getElementById('loginLink');
  const authUserLabel = document.getElementById('authUserLabel');
  const logoutBtn = document.getElementById('logoutBtn');
  const statsTabBtn = document.getElementById('statsTabBtn');
  const authStatus = document.getElementById('authStatus');
  const userBadge = document.getElementById('userBadge');

  const startReviewBtn = document.getElementById('startReviewBtn');
  const trainingToggle = document.getElementById('trainingToggle');
  const shuffleToggle = document.getElementById('shuffleToggle');
  const reviewEmpty = document.getElementById('reviewEmpty');
  const quizArea = document.getElementById('quizArea');
  const promptEl = document.getElementById('prompt');
  const answerForm = document.getElementById('answerForm');
  const answerInput = document.getElementById('answerInput');
  const answerSubmitBtn = answerForm ? answerForm.querySelector('button[type="submit"]') : null;
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
  const ttsLangSelect = document.getElementById('ttsLangSelect');
  const ttsProviderSelect = document.getElementById('ttsProviderSelect');
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
    // Only logged-in users can load history/stats
    if (!window.authUser) {
      history = [];
      saveHistory();
      return;
    }
    try {
      const items = await window.api.getReviews(prefs.selectedDeckId);
      // Items already shaped similarly: { startedAt, endedAt, durationMs, totalQuestions, uniqueWords, perWord, summary, userId, deckId }
      history = Array.isArray(items) ? items.slice() : [];
      saveHistory();
      renderHistory();
      if (window.authUser) renderStatsChart();
    } catch (err) {
      console.warn('fetchHistoryFromServer failed:', err);
    }
  }

  // ---- Auth UI ----
  async function refreshAuthUI() {
    try {
      if (!window.api || typeof window.api.getMe !== 'function') {
        console.log('[refreshAuthUI] api.getMe not available');
        return;
      }
      console.log('[refreshAuthUI] Calling api.getMe()...');
      const me = await window.api.getMe();
      console.log('[refreshAuthUI] api.getMe() response:', me);
      const u = me?.user || null;
      window.authUser = u;
      const logged = !!u;
      console.log('[refreshAuthUI] logged:', logged, 'user:', u);
      if (loginLink) loginLink.style.display = logged ? 'none' : '';
      if (logoutBtn) logoutBtn.style.display = logged ? '' : 'none';
      if (authStatus) authStatus.textContent = `Logged: ${logged}`;
      if (authUserLabel) {
        authUserLabel.style.display = logged ? '' : 'none';
        if (logged) authUserLabel.textContent = u.name || u.user || u.id;
      }
      if (statsTabBtn) statsTabBtn.style.display = logged ? '' : 'none';
      
      // Show/hide privacy checkbox based on login status
      const privacyLabel = deckPrivacyCheckbox?.parentElement;
      if (privacyLabel) {
        privacyLabel.style.display = logged ? '' : 'none';
      }
      
      // Sync selected user with authenticated user if logged in
      if (logged && u.id) {
        // Check if this user exists in the users list
        const userExists = users.some(usr => usr.id === u.id);
        if (userExists && prefs.selectedUserId !== u.id) {
          prefs.selectedUserId = u.id;
          savePrefs();
        }
        // Load preferences for the authenticated user
        await syncPrefsFromServer(u.id);
      }
      
      // Update user badge based on login status
      applyUserBadge();
    } catch (e) {
      // default to guest
      console.error('[refreshAuthUI] Error:', e);
      window.authUser = null;
      if (loginLink) loginLink.style.display = '';
      if (logoutBtn) logoutBtn.style.display = 'none';
      if (authStatus) authStatus.textContent = 'Logged: false';
      if (authUserLabel) authUserLabel.style.display = 'none';
      if (statsTabBtn) statsTabBtn.style.display = 'none';
      
      // Hide privacy checkbox when not logged in
      const privacyLabel = deckPrivacyCheckbox?.parentElement;
      if (privacyLabel) {
        privacyLabel.style.display = 'none';
      }
      
      // When not logged in, use 'default' as selectedUserId
      if (prefs.selectedUserId !== 'default') {
        prefs.selectedUserId = 'default';
        savePrefs();
      }
      
      // Update user badge to show robot emoji
      applyUserBadge();
    }
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      try {
        if (window.api && typeof window.api.logout === 'function') await window.api.logout();
      } catch {}
      location.href = '/';
    });
  }

  // TTS preferences wiring
  if (ttsLangSelect) {
    ttsLangSelect.value = (prefs && prefs.ttsLang) || 'en';
    ttsLangSelect.addEventListener('change', () => {
      prefs.ttsLang = ttsLangSelect.value;
      savePrefs();
    });
  }

  // Deck privacy toggle (checkbox checked = private)
  if (deckPrivacyCheckbox) {
    deckPrivacyCheckbox.addEventListener('change', async () => {
      const deckId = prefs.selectedDeckId;
      if (!deckId || !window.api || typeof window.api.updateDeckPrivacy !== 'function') return;
      const makePrivate = deckPrivacyCheckbox.checked;
      const newIsPublic = !makePrivate;
      // optimistic UI update
      const d = decks.find(x => x.id === deckId);
      const prev = d ? !!d.isPublic : true;
      if (d) d.isPublic = newIsPublic;
      try {
        await window.api.updateDeckPrivacy(deckId, newIsPublic);
        saveDecks();
      } catch (e) {
        // revert UI on error
        if (d) d.isPublic = prev;
        deckPrivacyCheckbox.checked = !prev; // since checked = private
        alert('Erreur mise à jour visibilité: ' + (e.message || e));
      }
    });
  }

  if (ttsProviderSelect) {
    ttsProviderSelect.value = (prefs && prefs.ttsProvider) || 'web';
    ttsProviderSelect.addEventListener('change', () => {
      prefs.ttsProvider = ttsProviderSelect.value;
      savePrefs();
    });
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
      decks = (list || []).map(d => ({ id: d.id, name: d.name, createdAt: (d.created_at ? d.created_at * 1000 : Date.now()), isPublic: (d.is_public !== undefined ? !!d.is_public : true) }));
      saveDecks();
      const oldDeckId = getSelectedDeckId();
      const selectedDeckId = getSelectedDeckId();
      if (!selectedDeckId || !decks.some(d => d.id === selectedDeckId)) {
        console.log('[fetchDecksFromServer] Selected deck not found:', selectedDeckId, '- switching to first deck');
        if (decks[0]) {
          setSelectedDeckId(decks[0].id);
          console.log('[fetchDecksFromServer] New selected deck:', decks[0].id);
        }
      }
      renderDecks();
      // Sync privacy checkbox state with current selection
      if (deckPrivacyCheckbox) {
        const cur = decks.find(d => d.id === getSelectedDeckId());
        deckPrivacyCheckbox.checked = cur ? !cur.isPublic : false;
      }
      // If deck changed, reload words
      if (oldDeckId !== getSelectedDeckId()) {
        console.log('[fetchDecksFromServer] Deck changed, reloading words');
        await fetchWordsForSelectedDeck();
      }
    } catch (err) {
      console.warn('fetchDecksFromServer failed:', err);
    }
  }

  async function fetchWordsForSelectedDeck() {
    const selectedDeckId = getSelectedDeckId();
    if (!window.api || !window.api.getWords || !selectedDeckId) {
      console.log('[fetchWordsForSelectedDeck] Skipped - api:', !!window.api, 'selectedDeckId:', selectedDeckId);
      return;
    }
    console.log('[fetchWordsForSelectedDeck] Fetching words for deck:', selectedDeckId);
    try {
      const items = await window.api.getWords(selectedDeckId);
      console.log('[fetchWordsForSelectedDeck] Received', items?.length || 0, 'words');
      words = (items || []).map(w => ({
        id: w.id,
        fr: w.fr,
        en: Array.isArray(w.en) ? w.en : [],
        errors: w.errors || 0,
        errorsByUser: w.errorsByUser || {},
        createdAt: w.createdAt || Date.now(),
        deckId: selectedDeckId,
      }));
      saveWords();
      renderWords();
      refreshReviewAvailability();
    } catch (err) {
      console.warn('fetchWordsForSelectedDeck failed:', err);
    }
  }

  // User management moved to admin page
  function updateUserTabState() {
    // No longer needed - user management is in admin page
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
      const baseTitle = 'Brain Sport FR ↔ EN';
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

  function pickGermanVoice() {
    try {
      const voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
      if (!voices || !voices.length) return null;
      return (
        voices.find(v => /de-DE/i.test(v.lang)) ||
        voices.find(v => /^de/i.test(v.lang)) ||
        null
      );
    } catch {
      return null;
    }
  }

  async function speakTextServer(text) {
    try {
      const lang = (prefs && prefs.ttsLang) || 'en';
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, lang })
      });
      if (!res.ok) throw new Error('tts_server_failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      await audio.play().catch(()=>{});
      setTimeout(() => URL.revokeObjectURL(url), 20000);
      return true;
    } catch {
      return false;
    }
  }

  async function speakText(text) {
    if (!('speechSynthesis' in window)) return;
    if (!text) return;
    try {
      // Try server provider if selected
      const provider = (prefs && prefs.ttsProvider) || 'web';
      if (provider === 'server') {
        const ok = await speakTextServer(text);
        if (ok) return;
        // fallback to web if server failed
      }
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      const lang = (prefs && prefs.ttsLang) || 'en';
      let voice = null;
      if (lang === 'de') {
        voice = pickGermanVoice();
        utter.lang = (voice && voice.lang) || 'de-DE';
      } else {
        voice = pickEnglishVoice();
        utter.lang = (voice && voice.lang) || 'en-US';
      }
      if (voice) utter.voice = voice;
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
      const prefs = raw ? JSON.parse(raw) : { shuffle: true, fireworks: true, theme: 'dark', mascot: '🦊', ttsLang: 'en', ttsProvider: 'web', celebrateImageEnabled: false, celebrateImageData: null, trainingMode: false };
      console.log('[loadPrefs] Loaded preferences:', prefs);
      return prefs;
    } catch (e) {
      return { shuffle: true, fireworks: true, theme: 'dark', mascot: '🦊', ttsLang: 'en', ttsProvider: 'web', celebrateImageEnabled: false, celebrateImageData: null, trainingMode: false };
    }
  }

  function applyTheme() {
    const theme = (prefs && prefs.theme) || 'dark';
    const root = document.documentElement;
    // Remove all theme classes
    root.classList.remove('theme-light', 'theme-kids', 'theme-jungle', 'theme-matrix', 'theme-forest');
    
    // Remove existing jungle emojis
    document.querySelectorAll('.jungle-emoji').forEach(el => el.remove());
    
    // Remove existing matrix canvas
    const existingCanvas = document.getElementById('matrix-canvas');
    if (existingCanvas) existingCanvas.remove();
    
    // Remove existing forest trees
    document.querySelectorAll('.forest-tree').forEach(el => el.remove());
    
    // Apply the selected theme
    if (theme === 'light') {
      root.classList.add('theme-light');
    } else if (theme === 'kids') {
      root.classList.add('theme-kids');
    } else if (theme === 'jungle') {
      root.classList.add('theme-jungle');
      createJungleEmojis();
    } else if (theme === 'matrix') {
      root.classList.add('theme-matrix');
      createMatrixRain();
    } else if (theme === 'forest') {
      root.classList.add('theme-forest');
      createForestTrees();
    }
    // 'dark' is the default, no class needed
  }
  
  function createJungleEmojis() {
    // Animals (max 1 of each) and plants (can repeat)
    const animals = ['🦜', '🐒', '🦎', '🦋', '🐍', '🦅', '🐆', '🦓', '🦍', '🐘', '🦏', '🐊', '🦛', '🐅', '🦒', '🐃', '🦌', '🦘', '🐫', '🦙'];
    const plants = ['🌿', '🌴', '🌳', '🌺', '🌵', '🍃', '🌾'];
    
    // Build emoji list: 1 of each animal + many plants
    const emojis = [...animals];
    const plantsNeeded = 80 - animals.length;
    for (let i = 0; i < plantsNeeded; i++) {
      emojis.push(plants[Math.floor(Math.random() * plants.length)]);
    }
    
    // Shuffle the array
    for (let i = emojis.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [emojis[i], emojis[j]] = [emojis[j], emojis[i]];
    }
    
    const count = emojis.length;
    const positions = []; // Store positions to avoid overlap
    const minDistance = 8; // Minimum distance between emojis (in %)
    
    for (let i = 0; i < count; i++) {
      let top, left, size;
      let attempts = 0;
      let validPosition = false;
      
      // Try to find a non-overlapping position
      while (!validPosition && attempts < 50) {
        top = Math.random() * 100;
        left = Math.random() * 100;
        size = 30 + Math.random() * 60; // 30px to 90px (ratio 1:3)
        
        // Check if this position overlaps with existing emojis
        validPosition = true;
        for (const pos of positions) {
          const distance = Math.sqrt(Math.pow(top - pos.top, 2) + Math.pow(left - pos.left, 2));
          if (distance < minDistance) {
            validPosition = false;
            break;
          }
        }
        attempts++;
      }
      
      // If we found a valid position, create the emoji
      if (validPosition) {
        positions.push({ top, left, size });
        
        const emoji = document.createElement('div');
        emoji.className = 'jungle-emoji';
        emoji.textContent = emojis[i]; // Use emoji from shuffled array
        
        emoji.style.top = top + '%';
        emoji.style.left = left + '%';
        emoji.style.fontSize = size + 'px';
        
        // Random opacity
        emoji.style.opacity = 0.25 + Math.random() * 0.25; // 0.25 to 0.5
        
        // Random animation
        const animDuration = 15 + Math.random() * 15; // 15s to 30s
        emoji.style.animation = `jungle-sway-${(i % 2) + 1} ${animDuration}s ease-in-out infinite`;
        emoji.style.animationDelay = Math.random() * 5 + 's';
        
        document.body.appendChild(emoji);
      }
    }
  }
  
  function createMatrixRain() {
    const canvas = document.createElement('canvas');
    canvas.id = 'matrix-canvas';
    document.body.appendChild(canvas);
    
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    
    // Matrix characters
    const chars = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const fontSize = 16;
    const columns = Math.floor(canvas.width / fontSize);
    const drops = Array(columns).fill(1);
    
    function draw() {
      // Semi-transparent black to create trail effect
      ctx.fillStyle = 'rgba(0, 0, 0, 0.05)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      ctx.font = fontSize + 'px monospace';
      
      for (let i = 0; i < drops.length; i++) {
        // Random character
        const char = chars[Math.floor(Math.random() * chars.length)];
        
        // Gradient effect: brighter at the head
        const y = drops[i] * fontSize;
        const gradient = ctx.createLinearGradient(0, y - fontSize * 10, 0, y);
        gradient.addColorStop(0, 'rgba(0, 255, 65, 0.1)');
        gradient.addColorStop(0.5, 'rgba(0, 255, 65, 0.5)');
        gradient.addColorStop(1, 'rgba(0, 255, 65, 1)');
        
        ctx.fillStyle = gradient;
        ctx.fillText(char, i * fontSize, y);
        
        // Reset drop randomly
        if (y > canvas.height && Math.random() > 0.975) {
          drops[i] = 0;
        }
        drops[i]++;
      }
    }
    
    // Animation loop
    const interval = setInterval(() => {
      if (!document.getElementById('matrix-canvas')) {
        clearInterval(interval);
        return;
      }
      draw();
    }, 50);
    
    // Resize handler
    window.addEventListener('resize', () => {
      if (document.getElementById('matrix-canvas')) {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
      }
    });
  }
  
  function createForestTrees() {
    const treeTypes = ['🌲', '🌳', '🌴', '🌳']; // Baobabs represented by 🌳
    const count = 25; // Number of trees
    
    for (let i = 0; i < count; i++) {
      const tree = document.createElement('div');
      tree.className = 'forest-tree';
      tree.textContent = treeTypes[Math.floor(Math.random() * treeTypes.length)];
      
      // Random horizontal position
      tree.style.left = (i * (100 / count)) + Math.random() * (100 / count) + '%';
      
      // Random size
      const size = 60 + Math.random() * 80; // 60px to 140px
      tree.style.fontSize = size + 'px';
      
      // Stagger the animation start
      tree.style.animationDelay = (Math.random() * 3) + 's';
      
      // Random animation duration for variety
      tree.style.animationDuration = (6 + Math.random() * 4) + 's';
      
      document.body.appendChild(tree);
    }
    
    // Add some birds flying
    setTimeout(() => {
      for (let i = 0; i < 5; i++) {
        const bird = document.createElement('div');
        bird.className = 'forest-tree';
        bird.textContent = '🦅';
        bird.style.left = Math.random() * 100 + '%';
        bird.style.bottom = (60 + Math.random() * 30) + '%';
        bird.style.fontSize = '30px';
        bird.style.animation = 'none';
        bird.style.opacity = '0.6';
        document.body.appendChild(bird);
      }
    }, 2000);
  }

  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch (e) {}
    // Also push to server if available - save for authenticated user
    try {
      if (window.api && typeof window.api.setPrefs === 'function' && window.authUser && window.authUser.id) {
        // Fire and forget - save prefs for the authenticated user
        console.log('[savePrefs] Saving prefs for authenticated user:', window.authUser.id, prefs);
        window.api.setPrefs(window.authUser.id, prefs).catch((err) => {
          console.error('[savePrefs] Failed to save prefs:', err);
        });
      } else {
        console.log('[savePrefs] Not saving to server - authUser:', window.authUser);
      }
    } catch (e) {
      console.error('[savePrefs] Error:', e);
    }
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
    console.log('[syncPrefsFromServer] Loading prefs for user:', userId);
    try {
      const serverPrefs = await window.api.getPrefs(userId);
      console.log('[syncPrefsFromServer] Server prefs:', serverPrefs);
      if (serverPrefs && typeof serverPrefs === 'object') {
        // Merge server prefs into local, but ensure selectedUserId is consistent
        prefs = { ...prefs, ...serverPrefs, selectedUserId: userId };
        console.log('[syncPrefsFromServer] Merged prefs:', prefs);
        savePrefs();
        // Re-apply UI-affecting prefs
        applyTheme();
        applyMascot();
        applyShuffleButton();
        applyCelebrateImagePreview();
      } else {
        // No prefs on server yet: seed with local prefs
        console.log('[syncPrefsFromServer] No server prefs, seeding with local:', prefs);
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
      // Each user now has their own selectedDeckId
      users = (list || []).map(u => ({ 
        id: u.id, 
        name: u.name, 
        createdAt: (u.created_at ? u.created_at * 1000 : Date.now()),
        selectedDeckId: u.selectedDeckId || null
      }));
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
    const selectedDeckId = getSelectedDeckId();
    for (const d of decks) {
      const opt = document.createElement('option');
      opt.value = d.id;
      opt.textContent = d.name;
      if (d.id === selectedDeckId) opt.selected = true;
      deckSelect.appendChild(opt);
    }
  }

  // User dropdown removed - authentication manages the active user
  function renderUsers() {
    // No longer needed - user selection removed from UI
  }

  // User list rendering moved to admin page
  function renderUsersList() {
    // No longer needed - user management is in admin page
  }

  function applyUserBadge() {
    if (userBadge) {
      // Show robot emoji when not logged in (selectedUserId = 'default')
      if (!window.authUser || prefs.selectedUserId === 'default') {
        userBadge.textContent = '🤖';
      } else {
        const u = users.find(x => x.id === prefs.selectedUserId);
        userBadge.textContent = u ? u.name : '—';
      }
    }
  }

  // Get the selected deck ID for the current user
  function getSelectedDeckId() {
    // If using default (not authenticated), use prefs.selectedDeckId
    if (prefs.selectedUserId === 'default') {
      return prefs.selectedDeckId || null;
    }
    // Otherwise, use the user's selected deck
    const currentUser = users.find(u => u.id === prefs.selectedUserId);
    return currentUser?.selectedDeckId || prefs.selectedDeckId || null;
  }

  // Set the selected deck ID for the current user
  function setSelectedDeckId(deckId) {
    // If using default (not authenticated), save to prefs only
    if (prefs.selectedUserId === 'default') {
      prefs.selectedDeckId = deckId;
      savePrefs();
      return;
    }
    // Otherwise, save to user's selectedDeckId
    const currentUser = users.find(u => u.id === prefs.selectedUserId);
    if (currentUser) {
      currentUser.selectedDeckId = deckId;
      saveUsers();
    }
    // Keep prefs.selectedDeckId for backward compatibility
    prefs.selectedDeckId = deckId;
    savePrefs();
  }

  function getCurrentDeckWords() {
    const selectedDeckId = getSelectedDeckId();
    console.log('[getCurrentDeckWords] Filtering words. selectedDeckId:', selectedDeckId);
    words.forEach((w, i) => {
      console.log(`  Word ${i}: fr="${w.fr}", deckId="${w.deckId}", match=${w.deckId === selectedDeckId}`);
    });
    const filtered = words.filter(w => w.deckId === selectedDeckId);
    console.log('[getCurrentDeckWords] Filtered words:', filtered.length);
    return filtered;
  }

  function initUsersAndPrefs() {
    // When not authenticated, use 'default' as selectedUserId
    // When authenticated, selectedUserId will be set by refreshAuthUI
    if (!prefs.selectedUserId) {
      prefs.selectedUserId = 'default';
      savePrefs();
    }
    
    // Ensure users list is not empty (for backward compatibility)
    if (!users || users.length === 0) {
      const def = { id: uid(), name: 'Guest', createdAt: Date.now() };
      users = [def];
      saveUsers();
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
    const selectedDeckId = getSelectedDeckId();
    return history.filter(h => h.deckId === selectedDeckId);
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
    console.log('[renderWords] selectedDeckId:', prefs.selectedDeckId, 'deckWords count:', deckWords.length, 'total words:', words.length);
    wordsList.innerHTML = '';
    if (!deckWords.length) {
      wordsEmpty.style.display = 'block';
      console.log('[renderWords] No words for this deck');
      return;
    }
    wordsEmpty.style.display = 'none';

    // Sort by insertion order (createdAt ascending) by default
    const list = [...deckWords].sort((a, b) => {
      const ac = a.createdAt || 0;
      const bc = b.createdAt || 0;
      return ac - bc;
    });

    for (const w of list) {
      const li = document.createElement('li');
      const wordSpan = document.createElement('span');
      wordSpan.className = 'word';
      // Editable French field
      const frInputEl = document.createElement('input');
      frInputEl.type = 'text';
      frInputEl.value = w.fr;
      frInputEl.placeholder = 'Français';
      frInputEl.className = 'inline-input';
      wordSpan.appendChild(frInputEl);

      const transSpan = document.createElement('span');
      transSpan.className = 'translations';
      // Editable English translations field (comma-separated)
      const enInputEl = document.createElement('input');
      enInputEl.type = 'text';
      enInputEl.value = w.en.join(', ');
      enInputEl.placeholder = 'anglais (séparé par des virgules)';
      enInputEl.className = 'inline-input';
      transSpan.appendChild(enInputEl);

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

      // --- Persist edits on blur or Enter/Tab ---
      let saving = false;
      // Helper to show a transient green tick
      function showTick(afterEl) {
        const tick = document.createElement('span');
        tick.className = 'save-tick show';
        tick.textContent = '✓';
        afterEl.insertAdjacentElement('afterend', tick);
        setTimeout(() => tick.classList.remove('show'), 900);
        setTimeout(() => tick.remove(), 1200);
      }

      async function commitIfChanged() {
        if (saving) return;
        const newFr = frInputEl.value.trim();
        const newEnList = parseTranslations(enInputEl.value || '');
        if (newFr === w.fr && JSON.stringify(newEnList) === JSON.stringify(w.en)) return;
        saving = true;
        try {
          await window.api.updateWord(w.id, { fr: newFr, en: newEnList });
          // Update local cache
          const local = words.find(x => x.id === w.id);
          if (local) { local.fr = newFr; local.en = newEnList; }
          saveWords();
          // Re-render badges/order (errors-based sorting may change if fr changed vis-à-vis locale compare)
          renderWords();
          refreshReviewAvailability();
          // Visual confirmation
          showTick(enInputEl);
          frInputEl.classList.remove('error');
          enInputEl.classList.remove('error');
          frInputEl.classList.add('success');
          enInputEl.classList.add('success');
          setTimeout(() => { frInputEl.classList.remove('success'); enInputEl.classList.remove('success'); }, 1000);
        } catch (e) {
          // Visual error feedback
          frInputEl.classList.add('error');
          enInputEl.classList.add('error');
          setTimeout(() => { frInputEl.classList.remove('error'); enInputEl.classList.remove('error'); }, 1000);
          alert('Erreur mise à jour: ' + (e.message || e));
        } finally {
          saving = false;
        }
      }

      frInputEl.addEventListener('blur', commitIfChanged);
      enInputEl.addEventListener('blur', commitIfChanged);
      function keyHandler(ev) {
        if (ev.key === 'Enter' || ev.key === 'Tab') {
          commitIfChanged();
        }
      }
      frInputEl.addEventListener('keydown', keyHandler);
      enInputEl.addEventListener('keydown', keyHandler);
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
    if (statsTab) statsTab.classList.toggle('active', tabName === 'stats');

    // Update nav tab button active state (only those inside nav.tabs)
    document.querySelectorAll('nav.tabs .tab-button').forEach(b => {
      b.classList.toggle('active', b.dataset.tab === tabName);
    });

    // On-demand renders for certain tabs
    if (tabName === 'manage') {
      renderWords();
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

  // Training mode toggle
  function applyTrainingButton() {
    trainingToggle.setAttribute('aria-pressed', prefs.trainingMode ? 'true' : 'false');
    trainingToggle.textContent = `Entraînement: ${prefs.trainingMode ? 'ON' : 'OFF'}`;
  }
  trainingToggle.addEventListener('click', () => {
    prefs.trainingMode = !prefs.trainingMode;
    savePrefs();
    applyTrainingButton();
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
    const pool = sourceWords.map(w => ({ id: w.id, attempts: 0 }));
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
      trainingMode: prefs.trainingMode,
      trainingAttempts: {}, // { wordId: attemptCount }
    };

    quizArea.classList.remove('hidden');
    reviewDone.classList.add('hidden');
    feedback.innerHTML = '';
    scoreEl.textContent = '0';
    questionIndexEl.textContent = '1';
    questionTotalEl.textContent = String(pool.length);
    roundNumEl.textContent = prefs.trainingMode ? 'Entraînement' : '1';
    // Disable the Start Review button while a session is running
    if (startReviewBtn) startReviewBtn.disabled = true;
    renderCurrentQuestion();
  }

  function findWordById(id) {
    return words.find(w => w.id === id);
  }

  function renderCurrentQuestion() {
    if (!session) return;
    if (session.index >= session.pool.length) {
      // fin de session
      if (session.trainingMode) {
        // En mode entraînement, on termine directement
        finalScore.textContent = String(session.score);
        quizArea.classList.add('hidden');
        reviewDone.classList.remove('hidden');
        // Afficher les statistiques d'entraînement
        renderTrainingStats();
        // Also post to server history if available (but not in training mode)
        renderHistory();
        renderStatsChart();
        renderUsersList();
        // Re-enable the Start Review button
        if (startReviewBtn) startReviewBtn.disabled = false;
        session = null;
        return;
      } else {
        // Mode normal : vérifier s'il y a des erreurs à reposer
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
          // Re-enable the Start Review button at the end of the session
          if (startReviewBtn) startReviewBtn.disabled = false;
          session = null;
          return;
        }
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
    // Nettoyer tout écouteur de continuation précédent
    try {
      if (session.continueHandler) {
        window.removeEventListener('keydown', session.continueHandler);
        session.continueHandler = null;
      }
      session.waitingForSpace = false;
    } catch {}

    promptEl.textContent = w.fr;
    questionIndexEl.textContent = String(session.index + 1);
    answerInput.disabled = false;
    answerInput.value = '';
    answerInput.focus();
    if (typeof answerSubmitBtn !== 'undefined' && answerSubmitBtn) {
      answerSubmitBtn.disabled = false;
    }
    session.currentShownAt = performance.now();
  }

  function checkAnswer(userAnswer, w) {
    const ans = String(userAnswer || '').trim();
    if (!ans) return false;
    const acceptable = (w.en || []).map(e => String(e).trim());
    // Case-sensitive exact match required
    return acceptable.includes(ans);
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
    
    // Incrémenter le compteur d'essais pour ce mot
    if (!session.trainingAttempts[qid]) {
      session.trainingAttempts[qid] = 0;
    }
    session.trainingAttempts[qid]++;
    
    if (!session.trainingMode) {
      // Mode normal : enregistrer les stats
      trackPerWordStat(w, { correct: ok, elapsedMs });
    }
    
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
      // Advance to next question after a short delay
      session.index += 1;
      setTimeout(() => {
        feedback.innerHTML = '';
        renderCurrentQuestion();
      }, 500);
      return;
    } else {
      feedback.innerHTML = `
        <div class="incorrect-row">
          <span class="cross">✘</span>
          <span class="incorrect-text">Réponse incorrecte</span>
        </div>
        <div class="expected-big">${w.en.map(escapeHtml).join(', ')}</div>
        <div class="hint" style="margin-top:8px;color:var(--muted)">Appuyez sur la barre d'espace pour continuer</div>
      `;
      
      if (!session.trainingMode) {
        // Mode normal : incrémenter les erreurs et ajouter au round suivant
        incErrorsForCurrentUser(w);
        saveWords();
        // Reposer ce mot au round suivant
        session.errorsNextRound.push(w.id);
      }
      // Speak only the correct English answer (no French praise)
      speakCorrectAnswer(w);
      // Désactiver la saisie et le bouton pendant l'attente de la barre d'espace
      answerInput.disabled = true;
      try { answerInput.blur(); } catch {}
      if (typeof answerSubmitBtn !== 'undefined' && answerSubmitBtn) {
        answerSubmitBtn.disabled = true;
      }
      // Attendre l'appui sur la barre d'espace pour continuer
      if (!session.waitingForSpace) {
        session.waitingForSpace = true;
        const onSpace = (ev) => {
          const isSpace = (ev.code === 'Space') || (ev.key === ' ') || (ev.key === 'Spacebar') || (ev.keyCode === 32);
          if (!isSpace) return;
          ev.preventDefault();
          // Nettoyage et passage à la question suivante
          window.removeEventListener('keydown', onSpace);
          session.continueHandler = null;
          session.waitingForSpace = false;
          
          if (session.trainingMode) {
            // En mode entraînement, reposer la même question
            feedback.innerHTML = '';
            renderCurrentQuestion();
          } else {
            // Mode normal : passer à la suivante
            session.index += 1;
            feedback.innerHTML = '';
            renderCurrentQuestion();
          }
        };
        session.continueHandler = onSpace;
        window.addEventListener('keydown', onSpace);
      }
      return;
    }
  });

  // ------- Session history & stats -------
  function initSessionStats(sourceWords) {
    const map = {};
    for (const w of sourceWords) {
      map[w.id] = { fr: w.fr, en: [...w.en], attempts: 0, errors: 0, sumMs: 0 };
    }
    return map;
  }

  function renderTrainingStats() {
    if (!session || !session.trainingMode) return;
    
    // Créer une liste des mots triés par nombre d'essais
    const wordStats = [];
    for (const [wordId, attempts] of Object.entries(session.trainingAttempts)) {
      const word = findWordById(wordId);
      if (word) {
        wordStats.push({
          fr: word.fr,
          en: word.en,
          attempts: attempts
        });
      }
    }
    
    // Trier par nombre d'essais décroissant
    wordStats.sort((a, b) => b.attempts - a.attempts);
    
    // Créer le HTML pour les stats
    let statsHtml = '<h4>Statistiques d\'entraînement</h4>';
    statsHtml += '<div class="training-stats">';
    
    for (const stat of wordStats) {
      const status = stat.attempts === 1 ? 'success' : stat.attempts <= 3 ? 'warning' : 'error';
      statsHtml += `
        <div class="training-stat-item ${status}">
          <div class="question-answer">
            <span class="word">${stat.fr}</span>
            <span class="arrow">→</span>
            <span class="answer">${stat.en.join(', ')}</span>
          </div>
          <span class="attempts">${stat.attempts} essai${stat.attempts > 1 ? 's' : ''}</span>
        </div>
      `;
    }
    
    statsHtml += '</div>';
    
    // Remplacer le contenu de reviewDone
    const doneContent = reviewDone.querySelector('h3, p');
    if (doneContent) {
      doneContent.insertAdjacentHTML('afterend', statsHtml);
    } else {
      reviewDone.innerHTML += statsHtml;
    }
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
    // Pourcentage 1er coup: nombre de mots sans aucune erreur / nombre de mots uniques
    const firstPassPct = uniqueCount ? Math.round((firstPassCorrect / uniqueCount) * 100) : 0;
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
    setSelectedDeckId(deckSelect.value);
    try {
      await refreshAuthUI();
      await fetchDecksFromServer();
      await fetchWordsForSelectedDeck();
      if (window.authUser) {
        await fetchHistoryFromServer();
        renderStatsChart();
      }
      renderHistory();
      renderUsersList();
      updateUserTabState();
      // Reflect deck privacy in checkbox
      if (deckPrivacyCheckbox) {
        const cur = decks.find(d => d.id === prefs.selectedDeckId);
        deckPrivacyCheckbox.checked = cur ? !cur.isPublic : false;
      }
    } catch (e) {
      console.error(e);
      deckPrivacyCheckbox.checked = cur ? !cur.isPublic : false;
    }
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
        // Select the newly created deck
        if (created && created.id) {
          prefs.selectedDeckId = created.id;
          savePrefs();
          renderDecks();
          await fetchWordsForSelectedDeck();
          showToast('Vocabulaire créé', 'success');
        }
      } catch (e) {
        if (String(e.message).includes('name_exists')) {
          alert('Ce nom existe déjà. Choisissez un autre nom.');
        } else {
          alert('Erreur création vocabulaire: ' + (e.message || e));
        }
      } finally {
        newDeckBtn.disabled = false;
        newDeckBtn.textContent = prevText;
      }
    });
  }

  // Copy current deck (vocab) and its words
  if (copyDeckBtn) {
    copyDeckBtn.addEventListener('click', async () => {
      const currentDeck = decks.find(d => d.id === prefs.selectedDeckId);
      if (!currentDeck) { alert('Aucun vocabulaire sélectionné.'); return; }
      const defaultName = `Copie de ${currentDeck.name}`;
      const name = prompt('Nom du vocabulaire copié', defaultName);
      if (!name) return; // cancelled
      const clean = name.trim();
      if (!clean) return;
      const prevText = copyDeckBtn.textContent;
      copyDeckBtn.disabled = true;
      copyDeckBtn.textContent = 'Copie...';
      try {
        const result = await window.api.copyDeck(currentDeck.id, clean);
        await fetchDecksFromServer();
        if (result && result.id) {
          setSelectedDeckId(result.id);
          renderDecks();
          await fetchWordsForSelectedDeck();
          showToast('Vocabulaire copié', 'success');
        }
      } catch (e) {
        if (String(e.message).includes('name_exists')) {
          alert('Ce nom existe déjà. Choisissez un autre nom.');
        } else {
          alert('Erreur copie vocabulaire: ' + (e.message || e));
        }
      } finally {
        copyDeckBtn.disabled = false;
        copyDeckBtn.textContent = prevText;
      }
    });
  }

  // User selection removed - authentication manages the active user

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
  applyTrainingButton();
  applyTheme();
  renderUsers();
  applyUserBadge();
  renderHistory();
  renderStatsChart();
  renderUsersList();
  updateUserTabState();

  // Initial server sync for users (overrides local users), then check auth and load prefs
  fetchUsersFromServer().then(async () => {
    // Check auth after users are loaded so we can sync the selected user and load their prefs
    await refreshAuthUI();
    // Prefs are now loaded in refreshAuthUI for authenticated user
    // No need to load prefs for selectedUserId separately
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
