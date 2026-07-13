(() => {
  'use strict';

  const DEMO_KEY = 'tsukimusubi-public-beta-v1';
  const PHOTO_DB = 'tsukimusubi-public-beta-photos';
  const config = window.TSUKIMUSUBI_CONFIG || {};
  let mode = 'demo';
  let client = null;
  let context = null;
  const FREE_LIMITS = { photos: 24, anniversaries: 3, date_records: 10, date_wishes: 10 };

  const normalizeCode = value => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const readDemo = () => {
    try { return JSON.parse(localStorage.getItem(DEMO_KEY) || '{}'); }
    catch { return {}; }
  };
  const writeDemo = data => localStorage.setItem(DEMO_KEY, JSON.stringify(data));

  function memberFor(pair, role) {
    return {
      role,
      display_name: role === 'a' ? pair.name_a : pair.name_b,
      avatar_initial: role === 'a' ? pair.initial_a : pair.initial_b
    };
  }

  function demoContext() {
    const db = readDemo();
    if (!db.pair || !db.role) return null;
    const active = Boolean(db.entitlement?.expires_at && new Date(db.entitlement.expires_at) > new Date());
    return {
      pair: db.pair,
      membership: memberFor(db.pair, db.role),
      members: [memberFor(db.pair, 'a'), memberFor(db.pair, 'b')],
      role: db.role,
      entitlement: { tier: active ? 'plus' : 'free', is_plus: active, expires_at: db.entitlement?.expires_at || null },
      limits: active
        ? { photos: 300, anniversaries: 100, date_records: 500, date_wishes: 200 }
        : { ...FREE_LIMITS }
    };
  }

  function photoDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(PHOTO_DB, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('photos', { keyPath: 'id' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function photoStore(modeName, work) {
    const db = await photoDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('photos', modeName);
      const request = work(tx.objectStore('photos'));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function initCloud() {
    if (!config.supabaseUrl || !config.supabaseKey || !window.supabase?.createClient) return false;
    client = window.supabase.createClient(config.supabaseUrl, config.supabaseKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
    });
    let { data: { session } } = await client.auth.getSession();
    if (!session) {
      const result = await client.auth.signInAnonymously();
      if (result.error) throw result.error;
      session = result.data.session;
    }
    if (!session) throw new Error('Unable to start a secure session');
    const result = await client.rpc('get_pair_context');
    if (result.error) throw result.error;
    context = result.data || null;
    mode = 'cloud';
    return true;
  }

  async function init() {
    if (await initCloud()) return { mode, context };
    mode = 'demo';
    context = demoContext();
    return { mode, context };
  }

  async function createPair(input) {
    if (mode === 'cloud') {
      const result = await client.rpc('create_pair', {
        p_name_a: input.nameA,
        p_initial_a: input.initialA,
        p_name_b: input.nameB,
        p_initial_b: input.initialB,
        p_met_date: input.metDate || null,
        p_dating_date: input.datingDate || null,
        p_code_a: input.codeA,
        p_code_b: input.codeB
      });
      if (result.error) throw result.error;
      const refreshed = await client.rpc('get_pair_context');
      if (refreshed.error) throw refreshed.error;
      context = refreshed.data;
      return context;
    }
    const db = readDemo();
    if (db.pair) throw new Error('This browser already has a demo pair');
    const id = crypto.randomUUID();
    db.pair = {
      id,
      name_a: input.nameA,
      initial_a: input.initialA,
      name_b: input.nameB,
      initial_b: input.initialB,
      met_date: input.metDate || null,
      dating_date: input.datingDate || null,
      created_at: new Date().toISOString()
    };
    db.codes = { a: normalizeCode(input.codeA), b: normalizeCode(input.codeB) };
    db.role = 'a';
    db.reviews = [];
    db.anniversaries = [];
    db.dateRecords = [];
    db.dateWishes = [];
    writeDemo(db);
    context = demoContext();
    return context;
  }

  async function joinPair(code) {
    if (mode === 'cloud') {
      const result = await client.rpc('join_pair', { p_code: code });
      if (result.error) throw result.error;
      const refreshed = await client.rpc('get_pair_context');
      if (refreshed.error) throw refreshed.error;
      context = refreshed.data;
      return context;
    }
    const db = readDemo();
    if (!db.pair) throw new Error('Demo pair not found on this browser');
    const normalized = normalizeCode(code);
    const role = normalized === db.codes?.a ? 'a' : normalized === db.codes?.b ? 'b' : null;
    if (!role) throw new Error('Invalid invitation code');
    db.role = role;
    writeDemo(db);
    context = demoContext();
    return context;
  }

  async function switchDemoRole(role) {
    if (mode !== 'demo') return;
    const db = readDemo();
    if (!db.pair || !['a', 'b'].includes(role)) return;
    db.role = role;
    writeDemo(db);
    context = demoContext();
  }

  async function loadReviews() {
    if (!context) return [];
    if (mode === 'cloud') {
      const result = await client.from('monthly_reviews').select('*').order('month', { ascending: true });
      if (result.error) throw result.error;
      return result.data || [];
    }
    return readDemo().reviews || [];
  }

  async function monthStatus(month) {
    if (!context) return { a: false, b: false };
    if (mode === 'cloud') {
      const result = await client.rpc('monthly_submission_status', { p_month: month });
      if (result.error) throw result.error;
      return result.data || { a: false, b: false };
    }
    const rows = (readDemo().reviews || []).filter(row => row.month === month);
    return { a: rows.some(row => row.author_role === 'a'), b: rows.some(row => row.author_role === 'b') };
  }

  async function submitReview(month, review) {
    if (!context) throw new Error('Pairing required');
    if (mode === 'cloud') {
      const result = await client.rpc('submit_monthly_review_v2', {
        p_month: month,
        p_scores: review.scores,
        p_grateful: review.grateful,
        p_happy: review.happy,
        p_difficult: review.difficult,
        p_hope: review.hope,
        p_self_change: review.selfChange,
        p_renew: review.renew,
        p_question_pack: review.questionPack || 'standard',
        p_extra_answers: review.extraAnswers || {}
      });
      if (result.error) throw result.error;
      return;
    }
    const db = readDemo();
    const role = db.role;
    if ((db.reviews || []).some(row => row.month === month && row.author_role === role)) throw new Error('Already submitted');
    if ((review.questionPack || 'standard') !== 'standard' && !context.entitlement?.is_plus) throw new Error('Plus membership required');
    db.reviews ||= [];
    db.reviews.push({
      id: crypto.randomUUID(), pair_id: db.pair.id, month, author_role: role,
      scores: review.scores, grateful: review.grateful, happy: review.happy,
      difficult: review.difficult, hope: review.hope, self_change: review.selfChange,
      renew: review.renew, question_pack: review.questionPack || 'standard',
      extra_answers: review.extraAnswers || {}, submitted_at: new Date().toISOString()
    });
    writeDemo(db);
  }

  async function getPhotos() {
    if (!context) return [];
    if (mode === 'cloud') {
      const rows = await client.from('album_photos').select('*').order('created_at', { ascending: false });
      if (rows.error) throw rows.error;
      return Promise.all((rows.data || []).map(async row => {
        const signed = await client.storage.from('couple-album').createSignedUrl(row.path, 3600);
        return { ...row, url: signed.data?.signedUrl || '' };
      }));
    }
    const rows = await photoStore('readonly', store => store.getAll());
    return (rows || []).filter(row => row.pair_id === context.pair.id).sort((a, b) => b.created_at.localeCompare(a.created_at)).map(row => ({ ...row, url: URL.createObjectURL(row.blob) }));
  }

  async function addPhoto(file) {
    if (!context) throw new Error('Pairing required');
    if (mode === 'cloud') {
      const id = crypto.randomUUID();
      const path = `${context.pair.id}/${id}.jpg`;
      const reserved = await client.rpc('reserve_album_photo', { p_id: id, p_path: path, p_name: file.name, p_size: file.size });
      if (reserved.error) throw reserved.error;
      const upload = await client.storage.from('couple-album').upload(path, file, { contentType: 'image/jpeg', upsert: false });
      if (upload.error) {
        await client.from('album_photos').delete().eq('id', id);
        throw upload.error;
      }
      return;
    }
    const current = await getPhotos();
    if (current.length >= (context.limits?.photos || FREE_LIMITS.photos)) throw new Error('Album quota reached');
    await photoStore('readwrite', store => store.put({ id: crypto.randomUUID(), pair_id: context.pair.id, uploader_role: context.role, name: file.name, blob: file, created_at: new Date().toISOString() }));
  }

  async function loadMemories() {
    if (!context) return { anniversaries: [], dateRecords: [], dateWishes: [] };
    if (mode === 'cloud') {
      const [anniversaries, dateRecords, dateWishes] = await Promise.all([
        client.from('pair_anniversaries').select('*').order('event_date', { ascending: true }),
        client.from('pair_date_records').select('*').order('date_on', { ascending: false }),
        client.from('pair_date_wishes').select('*').order('created_at', { ascending: false })
      ]);
      const failure = [anniversaries, dateRecords, dateWishes].find(result => result.error);
      if (failure) throw failure.error;
      return {
        anniversaries: anniversaries.data || [],
        dateRecords: dateRecords.data || [],
        dateWishes: dateWishes.data || []
      };
    }
    const db = readDemo();
    return {
      anniversaries: db.anniversaries || [],
      dateRecords: db.dateRecords || [],
      dateWishes: db.dateWishes || []
    };
  }

  async function createMemory(type, input) {
    if (!context) throw new Error('Pairing required');
    const definitions = {
      anniversary: {
        rpc: 'create_anniversary',
        params: { p_event_date: input.date, p_title: input.title, p_note: input.note || '' },
        key: 'anniversaries',
        limitKey: 'anniversaries',
        row: { event_date: input.date, title: input.title, note: input.note || '' }
      },
      date: {
        rpc: 'create_date_record',
        params: { p_date_on: input.date, p_title: input.title, p_place: input.place || '', p_memory: input.note || '' },
        key: 'dateRecords',
        limitKey: 'date_records',
        row: { date_on: input.date, title: input.title, place: input.place || '', memory: input.note || '' }
      },
      wish: {
        rpc: 'create_date_wish',
        params: { p_title: input.title, p_place: input.place || '', p_note: input.note || '' },
        key: 'dateWishes',
        limitKey: 'date_wishes',
        row: { title: input.title, place: input.place || '', note: input.note || '', status: 'planned' }
      }
    };
    const definition = definitions[type];
    if (!definition) throw new Error('Unknown memory type');
    if (mode === 'cloud') {
      const result = await client.rpc(definition.rpc, definition.params);
      if (result.error) throw result.error;
      return result.data;
    }
    const db = readDemo();
    db[definition.key] ||= [];
    const limit = context.limits?.[definition.limitKey] || FREE_LIMITS[definition.limitKey];
    if (db[definition.key].length >= limit) throw new Error('Memory quota reached');
    const row = { id: crypto.randomUUID(), pair_id: context.pair.id, ...definition.row, created_at: new Date().toISOString() };
    db[definition.key].unshift(row);
    writeDemo(db);
    return row.id;
  }

  async function deleteMemory(type, id) {
    const tables = { anniversary: 'pair_anniversaries', date: 'pair_date_records', wish: 'pair_date_wishes' };
    const keys = { anniversary: 'anniversaries', date: 'dateRecords', wish: 'dateWishes' };
    if (!tables[type]) throw new Error('Unknown memory type');
    if (mode === 'cloud') {
      const result = await client.from(tables[type]).delete().eq('id', id);
      if (result.error) throw result.error;
      return;
    }
    const db = readDemo();
    db[keys[type]] = (db[keys[type]] || []).filter(row => row.id !== id);
    writeDemo(db);
  }

  async function setWishStatus(id, status) {
    if (mode === 'cloud') {
      const result = await client.rpc('set_date_wish_status', { p_id: id, p_status: status });
      if (result.error) throw result.error;
      return;
    }
    const db = readDemo();
    const row = (db.dateWishes || []).find(item => item.id === id);
    if (!row) return;
    row.status = status;
    row.completed_at = status === 'done' ? new Date().toISOString() : null;
    writeDemo(db);
  }

  async function deletePhoto(photo) {
    if (mode === 'cloud') {
      const metadata = await client.from('album_photos').delete().eq('id', photo.id);
      if (metadata.error) throw metadata.error;
      const object = await client.storage.from('couple-album').remove([photo.path]);
      if (object.error) throw object.error;
      return;
    }
    await photoStore('readwrite', store => store.delete(photo.id));
  }

  async function updateProfile(name, initial) {
    if (mode === 'cloud') {
      const result = await client.rpc('update_my_profile', { p_display_name: name, p_initial: initial });
      if (result.error) throw result.error;
      const refreshed = await client.rpc('get_pair_context');
      if (refreshed.error) throw refreshed.error;
      context = refreshed.data;
      return context;
    }
    const db = readDemo();
    const suffix = db.role === 'a' ? 'a' : 'b';
    db.pair[`name_${suffix}`] = name;
    db.pair[`initial_${suffix}`] = initial;
    writeDemo(db);
    context = demoContext();
    return context;
  }

  async function rotateInvite(code) {
    if (context?.role !== 'a') throw new Error('Only the creator can renew the invitation code');
    if (mode === 'cloud') {
      const result = await client.rpc('rotate_partner_code', { p_code: code });
      if (result.error) throw result.error;
      return code;
    }
    const db = readDemo();
    db.codes.b = normalizeCode(code);
    writeDemo(db);
    return code;
  }

  async function rotateRecovery(code) {
    if (!context) throw new Error('Pairing required');
    if (mode === 'cloud') {
      const result = await client.rpc('rotate_my_recovery_code', { p_code: code });
      if (result.error) throw result.error;
      return code;
    }
    const db = readDemo();
    db.codes[db.role] = normalizeCode(code);
    writeDemo(db);
    return code;
  }

  async function exportData() {
    if (!context) return {};
    const reviews = await loadReviews();
    const photos = await getPhotos();
    const memories = await loadMemories();
    return { exportedAt: new Date().toISOString(), pair: context.pair, membership: context.membership, entitlement: context.entitlement, visibleReviews: reviews, memories, albumMetadata: photos.map(({ url, blob, ...row }) => row) };
  }

  async function deleteAccount() {
    if (mode === 'cloud') {
      if ((context?.members || []).length === 1) {
        const photos = await client.from('album_photos').select('path');
        if (!photos.error && photos.data?.length) {
          await client.storage.from('couple-album').remove(photos.data.map(photo => photo.path));
        }
      }
      const result = await client.rpc('delete_my_account');
      if (result.error) throw result.error;
      await client.auth.signOut();
    } else {
      localStorage.removeItem(DEMO_KEY);
      const db = await photoDatabase();
      db.close();
      indexedDB.deleteDatabase(PHOTO_DB);
    }
    context = null;
  }

  window.TsukiBackend = {
    init, createPair, joinPair, switchDemoRole, loadReviews, monthStatus, submitReview,
    getPhotos, addPhoto, deletePhoto, loadMemories, createMemory, deleteMemory, setWishStatus,
    updateProfile, rotateInvite, rotateRecovery, exportData, deleteAccount,
    get mode() { return mode; },
    get context() { return context; }
  };
})();
