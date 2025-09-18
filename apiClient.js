// Simple API client for backend endpoints
window.api = {
  async getUsers() {
    const res = await fetch('/api/users');
    if (!res.ok) throw new Error('Failed to load users');
    const data = await res.json();
    return data.items || [];
  },
  // Decks
  async getDecks() {
    const res = await fetch('/api/decks');
    if (!res.ok) throw new Error('Failed to load decks');
    const data = await res.json();
    return data.items || [];
  },
  async createDeck(name) {
    const res = await fetch('/api/decks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    if (!res.ok) {
      const err = await res.json().catch(()=>({}));
      throw new Error(err.error || 'deck_create_failed');
    }
    return res.json();
  },
  async deleteDeck(id) {
    const res = await fetch(`/api/decks/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok) {
      const err = await res.json().catch(()=>({}));
      throw new Error(err.error || 'deck_delete_failed');
    }
    return res.json();
  },
  // Words
  async getWords(deckId) {
    const res = await fetch(`/api/decks/${encodeURIComponent(deckId)}/words`);
    if (!res.ok) throw new Error('Failed to load words');
    const data = await res.json();
    return data.items || [];
  },
  async createWord(deckId, { fr, en }) {
    const res = await fetch(`/api/decks/${encodeURIComponent(deckId)}/words`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fr, en })
    });
    if (!res.ok) {
      const err = await res.json().catch(()=>({}));
      throw new Error(err.error || 'word_create_failed');
    }
    return res.json();
  },
  async deleteWord(wordId) {
    const res = await fetch(`/api/words/${encodeURIComponent(wordId)}`, { method: 'DELETE' });
    if (!res.ok) {
      const err = await res.json().catch(()=>({}));
      throw new Error(err.error || 'word_delete_failed');
    }
    return res.json();
  },
  async clearDeckWords(deckId) {
    const res = await fetch(`/api/decks/${encodeURIComponent(deckId)}/words`, { method: 'DELETE' });
    if (!res.ok) {
      const err = await res.json().catch(()=>({}));
      throw new Error(err.error || 'deck_clear_failed');
    }
    return res.json();
  },
  async getPrefs(userId) {
    const res = await fetch(`/api/users/${encodeURIComponent(userId)}/prefs`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error('Failed to load prefs');
    const data = await res.json();
    return data.prefs || null;
  },
  async setPrefs(userId, prefs) {
    const res = await fetch(`/api/users/${encodeURIComponent(userId)}/prefs`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefs })
    });
    if (!res.ok) {
      const err = await res.json().catch(()=>({}));
      throw new Error(err.error || 'prefs_save_failed');
    }
    return res.json();
  },
  async createUser(name) {
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    if (!res.ok) {
      const err = await res.json().catch(()=>({}));
      throw new Error(err.error || 'create_failed');
    }
    return res.json();
  },
  async deleteUser(id) {
    const res = await fetch(`/api/users/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok) {
      const err = await res.json().catch(()=>({}));
      throw new Error(err.error || 'delete_failed');
    }
    return res.json();
  }
};
