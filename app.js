(() => {
  'use strict';

  const backend = window.TsukiBackend;
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const e = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  const t = (ja, zh) => state.lang === 'zh' ? zh : ja;
  const pad = number => String(number).padStart(2, '0');
  const today = new Date();
  const monthKey = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-01`;
  const categories = [
    { key: 'communication', ja: '会話と傾聴', zh: '沟通与倾听' },
    { key: 'trust', ja: '信頼と安心', zh: '信任与安心' },
    { key: 'care', ja: '思いやり', zh: '体贴与关心' },
    { key: 'time', ja: '一緒の時間', zh: '相处的时间' },
    { key: 'support', ja: '支え合い', zh: '互相支持' },
    { key: 'affection', ja: '愛情表現', zh: '爱意表达' }
  ];
  const textFields = [
    { key: 'grateful', ja: '今月、感謝したこと', zh: '这个月最感谢对方的事' },
    { key: 'happy', ja: '一番うれしかった瞬間', zh: '最开心的瞬间' },
    { key: 'difficult', ja: '少し寂しかった・難しかったこと', zh: '有点难过或辛苦的事' },
    { key: 'hope', ja: '来月、一緒にしたいこと', zh: '下个月想一起做的事' },
    { key: 'selfChange', ja: '自分が少し変えたいこと', zh: '自己想稍微改变的地方' }
  ];
  const state = {
    lang: localStorage.getItem('tsuki-language') || (navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'ja'),
    context: null,
    reviews: [],
    status: { a: false, b: false },
    photos: [],
    selectedMonth: monthKey,
    lineProfile: null
  };

  function showToast(message) {
    const toast = $('#toast');
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove('show'), 2600);
  }

  function errorText(error) {
    const message = String(error?.message || error || 'Unknown error');
    if (/Invalid invitation code|Invalid pairing code/i.test(message)) return t('招待コードが正しくありません。', '邀请码不正确。');
    if (/Already submitted/i.test(message)) return t('今月の回答は提出済みです。', '本月回答已经提交。');
    if (/quota/i.test(message)) return t('無料Betaの写真上限に達しました。', '已达到免费Beta的照片上限。');
    if (/already has a demo pair/i.test(message)) return t('この端末にはすでにデモ空間があります。設定から削除できます。', '此设备已经有演示空间，可在设置中删除。');
    return message;
  }

  function applyLanguage() {
    document.documentElement.lang = state.lang === 'zh' ? 'zh-CN' : 'ja';
    $$('[data-ja][data-zh]').forEach(element => {
      element.textContent = element.dataset[state.lang];
    });
    localStorage.setItem('tsuki-language', state.lang);
    if (state.context) renderAll();
  }

  function openModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
  }

  function closeModal(modal) {
    const target = typeof modal === 'string' ? document.getElementById(modal) : modal.closest('.modal');
    target?.classList.remove('open');
    target?.setAttribute('aria-hidden', 'true');
  }

  function showView(name) {
    $$('.view').forEach(view => view.classList.remove('active'));
    document.getElementById(`${name}View`)?.classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function randomCode() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return [...bytes].map(byte => alphabet[byte % alphabet.length]).join('').match(/.{1,4}/g).join('-');
  }

  function roleData(role) {
    const pair = state.context.pair;
    return role === 'a'
      ? { name: pair.name_a, initial: pair.initial_a }
      : { name: pair.name_b, initial: pair.initial_b };
  }

  function displayDate(value) {
    if (!value) return '—';
    const date = new Date(`${value}T00:00:00`);
    return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}`;
  }

  function daysSince(value) {
    if (!value) return '—';
    const start = new Date(`${value}T00:00:00`);
    return Math.max(0, Math.floor((new Date(today.getFullYear(), today.getMonth(), today.getDate()) - start) / 86400000) + 1);
  }

  function monthLabel(value, long = false) {
    const [year, month] = value.split('-');
    return state.lang === 'zh' ? `${year}年${Number(month)}月${long ? '契约' : ''}` : `${year}年${Number(month)}月${long ? 'の契約' : ''}`;
  }

  function nextMonth() {
    const date = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    return date;
  }

  function reviewAverage(review) {
    return categories.reduce((sum, category) => sum + Number(review?.scores?.[category.key] || 0), 0) / categories.length;
  }

  function currentReview(role) {
    return state.reviews.find(row => row.month === monthKey && row.author_role === role);
  }

  function reviewsForMonth(month) {
    const rows = state.reviews.filter(row => row.month === month);
    return { a: rows.find(row => row.author_role === 'a'), b: rows.find(row => row.author_role === 'b') };
  }

  function completedMonths() {
    const months = [...new Set(state.reviews.map(row => row.month))].sort();
    return months.map(month => ({ month, ...reviewsForMonth(month) })).filter(item => item.a && item.b);
  }

  function renderPair() {
    const pair = state.context.pair;
    const a = roleData('a');
    const b = roleData('b');
    $('#sealNameA').textContent = a.name;
    $('#sealNameB').textContent = b.name;
    $('#heroMonth').textContent = monthLabel(monthKey, true);
    [['#avatarA', a.initial], ['#scoreAvatarA', a.initial], ['#avatarB', b.initial], ['#scoreAvatarB', b.initial]].forEach(([selector, value]) => $(selector).textContent = value);
    [['#nameA', a.name], ['#scoreNameA', a.name], ['#legendA', a.name], ['#nameB', b.name], ['#scoreNameB', b.name], ['#legendB', b.name]].forEach(([selector, value]) => $(selector).textContent = value);
    $('#metDate').textContent = displayDate(pair.met_date);
    $('#datingDate').textContent = displayDate(pair.dating_date);
    $('#metDays').textContent = daysSince(pair.met_date);
    $('#datingDays').textContent = daysSince(pair.dating_date);
    const next = nextMonth();
    const remaining = Math.max(0, Math.ceil((next - today) / 86400000));
    $('#nextDays').textContent = remaining;
    $('#nextDate').textContent = `${next.getFullYear()}.${pad(next.getMonth() + 1)}.01`;
  }

  function renderStatus() {
    const count = Number(state.status.a) + Number(state.status.b);
    $('#monthProgressCount').textContent = `${count} / 2`;
    $('#monthProgressText').textContent = count === 2 ? t('今月の契約が完成しました', '本月契约已经完成') : count === 1 ? t('ひとりの手紙を預かっています', '已收到一人的来信') : t('今月の契約は進行中', '本月契约进行中');
    $('#stateA').textContent = state.status.a ? t('封印済み ✓', '已封存 ✓') : t('記入待ち', '等待填写');
    $('#stateB').textContent = state.status.b ? t('封印済み ✓', '已封存 ✓') : t('記入待ち', '等待填写');
    const mine = state.context.role;
    const submitted = state.status[mine];
    const button = $('#startReview');
    button.querySelector('span').textContent = count === 2 ? t('今月の契約を読む', '查看本月契约') : submitted ? t('相手の提出を待っています', '等待对方提交') : t('今月の振り返りを始める', '开始本月回顾');
    button.disabled = submitted && count !== 2;
  }

  function renderScores() {
    const completed = completedMonths();
    const latest = completed.at(-1);
    $('#totalA').textContent = latest ? reviewAverage(latest.b).toFixed(1) : '—';
    $('#totalB').textContent = latest ? reviewAverage(latest.a).toFixed(1) : '—';
    const chart = $('#trendChart');
    if (!completed.length) {
      chart.innerHTML = `<p>${t('最初の共同契約が完成すると表示されます。', '完成第一份共同契约后将显示趋势。')}</p>`;
      return;
    }
    const width = 720, height = 210, left = 34, right = 18, top = 15, bottom = 35;
    const x = index => completed.length === 1 ? width / 2 : left + index * ((width - left - right) / (completed.length - 1));
    const y = value => top + (10 - value) / 9 * (height - top - bottom);
    const pointsA = completed.map((item, index) => [x(index), y(reviewAverage(item.b))]);
    const pointsB = completed.map((item, index) => [x(index), y(reviewAverage(item.a))]);
    const path = points => points.map((point, index) => `${index ? 'L' : 'M'}${point[0].toFixed(1)},${point[1].toFixed(1)}`).join(' ');
    const grid = [1, 4, 7, 10].map(value => `<line x1="${left}" x2="${width-right}" y1="${y(value)}" y2="${y(value)}" stroke="#eadfd8" stroke-width="1"/><text x="5" y="${y(value)+3}" fill="#9a8e89" font-size="9">${value}</text>`).join('');
    const dots = (points, color) => points.map(point => `<circle cx="${point[0]}" cy="${point[1]}" r="4" fill="${color}"/>`).join('');
    const labels = completed.map((item, index) => `<text x="${x(index)}" y="${height-8}" text-anchor="middle" fill="#9a8e89" font-size="9">${Number(item.month.slice(5,7))}月</text>`).join('');
    chart.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Monthly score chart">${grid}<path d="${path(pointsA)}" fill="none" stroke="#759da1" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="${path(pointsB)}" fill="none" stroke="#c8797b" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>${dots(pointsA, '#759da1')}${dots(pointsB, '#c8797b')}${labels}</svg>`;
  }

  function renderHistory() {
    const list = $('#historyList');
    const completed = completedMonths().reverse();
    if (!completed.length) {
      list.innerHTML = `<div class="empty">${t('最初の契約は、ふたりの提出後にここへ保存されます。毎月の契約はすべて新しい記録として残ります。', '双方完成第一份契约后会保存在这里。以后每个月的契约都会成为一条新记录。')}</div>`;
      return;
    }
    list.innerHTML = completed.map(item => {
      const continued = item.a.renew === 'yes' && item.b.renew === 'yes';
      const average = ((reviewAverage(item.a) + reviewAverage(item.b)) / 2).toFixed(1);
      return `<button class="history-item" data-month="${item.month}"><div><b>${monthLabel(item.month, true)}</b><small>${t('ふたりの平均', '两人平均')} ${average} / 10</small></div><span>${continued ? t('契約継続', '继续交往') : t('対話を選択', '选择沟通')}</span></button>`;
    }).join('');
  }

  function renderAlbum() {
    $('#albumUsage').textContent = `${state.photos.length} / 24`;
    const grid = $('#albumGrid');
    if (!state.photos.length) {
      grid.innerHTML = `<div class="empty">${t('まだ写真はありません。ふたりの最初の一枚を追加してみよう。', '还没有照片，添加属于两个人的第一张回忆吧。')}</div>`;
      return;
    }
    grid.innerHTML = state.photos.map(photo => `<article class="photo-card"><img src="${e(photo.url)}" alt="${e(photo.name || '')}" loading="lazy"><footer><span>${e((photo.created_at || '').slice(0,10))}</span><button data-delete-photo="${photo.id}" aria-label="Delete">×</button></footer></article>`).join('');
  }

  function renderAll() {
    if (!state.context) return;
    renderPair();
    renderStatus();
    renderScores();
    renderHistory();
    renderAlbum();
    $('#demoWarning').classList.toggle('hidden', backend.mode !== 'demo');
  }

  async function refreshData() {
    state.context = backend.context;
    if (!state.context) return;
    const [reviews, status, photos] = await Promise.all([backend.loadReviews(), backend.monthStatus(monthKey), backend.getPhotos()]);
    state.reviews = reviews;
    state.status = status;
    state.photos = photos;
    renderAll();
  }

  function renderReviewForm() {
    const mine = roleData(state.context.role);
    $('#reviewerName').textContent = mine.name;
    $('#reviewForm').reset();
    $('#scoreFields').innerHTML = categories.map(category => `<div class="score-row"><label><b>${t(category.ja, category.zh)}</b><small>${t('パートナーへの評価', '给对象的评价')}</small></label><input type="range" name="${category.key}" min="1" max="10" value="7"><output class="score-value">7</output></div>`).join('');
    $('#textFields').innerHTML = textFields.map(field => `<div class="field"><label>${t(field.ja, field.zh)}<small>${t('短くても、正直な言葉で大丈夫です。', '写得简短也没关系，真诚就好。')}</small></label><textarea required maxlength="500" name="${field.key}"></textarea></div>`).join('');
    $$('#scoreFields input').forEach(input => input.addEventListener('input', () => input.nextElementSibling.textContent = input.value));
  }

  function renderResult(month) {
    const { a, b } = reviewsForMonth(month);
    if (!a || !b) return;
    const personA = roleData('a'), personB = roleData('b');
    const continued = a.renew === 'yes' && b.renew === 'yes';
    $('#resultHero').innerHTML = `<span class="section-kicker">${e(monthLabel(month, true))}</span><h1>${continued ? t('来月も、よろしくね ♡', '下个月，也请继续相爱 ♡') : t('まずは、ゆっくり話そう', '先停下来，好好聊聊')}</h1><p>${e(personA.name)}：${a.renew === 'yes' ? t('続けたい', '想继续') : t('話して決めたい', '想谈谈再决定')}<br>${e(personB.name)}：${b.renew === 'yes' ? t('続けたい', '想继续') : t('話して決めたい', '想谈谈再决定')}</p>`;
    $('#scoreCompare').innerHTML = categories.map(category => `<article class="score-box"><span>${t(category.ja, category.zh)}</span><strong>${((Number(a.scores[category.key]) + Number(b.scores[category.key])) / 2).toFixed(1)}</strong><small>${e(personA.name)} ${a.scores[category.key]} · ${e(personB.name)} ${b.scores[category.key]}</small></article>`).join('');
    $('#wordsCompare').innerHTML = [['a', a, personA], ['b', b, personB]].map(([, review, person]) => `<article class="words-person"><h2>${e(person.name)} ${t('から、ふたりへ', '写给我们')}</h2>${textFields.map(field => `<div class="quote-block"><span>${t(field.ja, field.zh)}</span><p>${e(review[field.key === 'selfChange' ? 'self_change' : field.key])}</p></div>`).join('')}</article>`).join('');
    showView('result');
  }

  async function initLine() {
    const config = window.TSUKIMUSUBI_CONFIG || {};
    if (!config.liffId || !window.liff) return;
    try {
      await liff.init({ liffId: config.liffId });
      if (!liff.isLoggedIn()) {
        $('#lineState span').textContent = 'LINE';
        return;
      }
      state.lineProfile = await liff.getProfile();
      $('#lineState').classList.add('connected');
      $('#lineState span').textContent = state.lineProfile.displayName || 'LINE';
    } catch (error) {
      console.warn('LINE initialization failed', error);
    }
  }

  function codesMarkup(codeA, codeB) {
    return `<div class="code-card"><span>${t('あなたの復元コード', '你的恢复码')}</span><strong>${e(codeA)}</strong><button data-copy="${e(codeA)}">${t('コピー', '复制')}</button></div><div class="code-card partner"><span>${t('パートナーへの招待コード', '给对象的邀请码')}</span><strong>${e(codeB)}</strong><button data-copy="${e(codeB)}">${t('コピー', '复制')}</button></div><p class="tiny">${t('この2つを知っている人は対応する役割で参加できます。公開しないでください。', '知道代码的人可以用对应身份加入，请勿公开。')}</p>`;
  }

  async function handleCreate(event) {
    event.preventDefault();
    const button = event.submitter;
    button.disabled = true;
    const form = new FormData(event.currentTarget);
    const codeA = randomCode(), codeB = randomCode();
    try {
      await backend.createPair({
        nameA: form.get('nameA').trim(), initialA: form.get('initialA').trim(),
        nameB: form.get('nameB').trim(), initialB: form.get('initialB').trim(),
        metDate: form.get('metDate'), datingDate: form.get('datingDate'), codeA, codeB
      });
      state.context = backend.context;
      closeModal('createModal');
      $('#createdCodes').innerHTML = codesMarkup(codeA, codeB);
      bindCopyButtons();
      $('#codesSaved').checked = false;
      $('#finishCodes').disabled = true;
      openModal('codesModal');
      await refreshData();
    } catch (error) { showToast(errorText(error)); }
    finally { button.disabled = false; }
  }

  async function handleJoin(event) {
    event.preventDefault();
    const button = event.submitter;
    button.disabled = true;
    try {
      await backend.joinPair(new FormData(event.currentTarget).get('code'));
      state.context = backend.context;
      closeModal('joinModal');
      await refreshData();
      showView('home');
    } catch (error) { showToast(errorText(error)); }
    finally { button.disabled = false; }
  }

  async function handleReview(event) {
    event.preventDefault();
    const button = event.submitter;
    button.disabled = true;
    const form = new FormData(event.currentTarget);
    const scores = Object.fromEntries(categories.map(category => [category.key, Number(form.get(category.key))]));
    const review = { scores, renew: form.get('renew') };
    textFields.forEach(field => review[field.key] = form.get(field.key).trim());
    try {
      await backend.submitReview(monthKey, review);
      await refreshData();
      showView('home');
      showToast(t('回答を安全に封印しました。', '回答已安全封存。'));
      if (state.status.a && state.status.b) {
        state.reviews = await backend.loadReviews();
        renderAll();
        renderResult(monthKey);
      }
    } catch (error) { showToast(errorText(error)); }
    finally { button.disabled = false; }
  }

  async function compressPhoto(file) {
    if (!file.type.startsWith('image/')) throw new Error(t('画像ファイルを選んでください。', '请选择图片文件。'));
    const bitmap = window.createImageBitmap ? await createImageBitmap(file) : await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = URL.createObjectURL(file);
    });
    const max = 1600;
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    let quality = .84;
    let blob;
    do {
      blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
      quality -= .1;
    } while (blob.size > 900000 && quality >= .44);
    return new File([blob], `${file.name.replace(/\.[^.]+$/, '')}.jpg`, { type: 'image/jpeg' });
  }

  async function handlePhotos(files) {
    if (state.photos.length >= 24) return showToast(t('無料Betaの写真上限に達しました。', '已达到免费Beta的照片上限。'));
    const available = 24 - state.photos.length;
    for (const file of [...files].slice(0, available)) {
      try { await backend.addPhoto(await compressPhoto(file)); }
      catch (error) { showToast(errorText(error)); break; }
    }
    state.photos = await backend.getPhotos();
    renderAlbum();
  }

  function renderSettings() {
    const content = $('#settingsContent');
    if (!state.context) {
      content.innerHTML = `<section class="settings-section"><h3>${t('表示言語', '显示语言')}</h3>${languageButtons()}</section><section class="settings-section"><p class="tiny">${t('空間を作成または参加すると、プロフィールとデータ管理が表示されます。', '创建或加入空间后，将显示个人资料与数据管理。')}</p></section>`;
      bindSettings();
      return;
    }
    const me = roleData(state.context.role);
    content.innerHTML = `<section class="settings-section"><h3>${t('あなたのプロフィール', '你的个人资料')}</h3><form id="profileForm" class="stack-form"><div class="two-fields"><label><span>${t('呼び名', '昵称')}</span><input name="name" required maxlength="16" value="${e(me.name)}"></label><label><span>${t('一文字', '头像文字')}</span><input name="initial" required maxlength="1" value="${e(me.initial)}"></label></div><button class="settings-button" type="submit">${t('プロフィールを保存', '保存个人资料')}</button></form></section><section class="settings-section"><h3>${t('表示言語', '显示语言')}</h3>${languageButtons()}</section>${state.context.role === 'a' ? `<section class="settings-section"><h3>${t('新しい招待コード', '新的邀请码')}</h3><p class="tiny">${t('以前のパートナー用コードを無効にし、新しいコードを一度だけ表示します。', '旧的对象邀请码将失效，新代码只显示一次。')}</p><button id="rotateInvite" class="settings-button">${t('招待コードを再発行', '重新生成邀请码')}</button><div id="rotatedCode"></div></section>` : ''}${backend.mode === 'demo' ? `<section class="settings-section"><h3>${t('デモ用の役割切替', '演示身份切换')}</h3><div class="language-buttons"><button data-role="a">${e(roleData('a').name)}</button><button data-role="b">${e(roleData('b').name)}</button></div></section>` : ''}<section class="settings-section"><h3>${t('データ管理', '数据管理')}</h3><div class="language-buttons"><button id="exportData">${t('データを書き出す', '导出数据')}</button><button id="deleteAccount" class="danger-button">${t('アカウントを削除', '删除账户')}</button></div></section><section class="settings-section"><p class="tiny">${t('FREE BETA：課金は発生しません。写真は1組24枚までです。', '免费Beta：不会产生费用，每对情侣最多保存24张照片。')}</p></section>`;
    content.insertAdjacentHTML('beforeend', `<section class="settings-section"><h3>${t('自分の復元コード', '自己的恢复码')}</h3><p class="tiny">${t('機種変更用の新しいコードを一度だけ表示します。以前の自分用コードは無効になります。', '将显示一次用于换手机的新代码，旧的个人恢复码会失效。')}</p><button id="rotateRecovery" class="settings-button">${t('復元コードを再発行', '重新生成恢复码')}</button><div id="rotatedRecovery"></div></section>`);
    bindSettings();
  }

  function languageButtons() {
    return `<div class="language-buttons"><button data-lang="ja" class="${state.lang === 'ja' ? 'active' : ''}">日本語</button><button data-lang="zh" class="${state.lang === 'zh' ? 'active' : ''}">中文</button></div>`;
  }

  function downloadJson(data, filename) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = filename; anchor.click();
    URL.revokeObjectURL(url);
  }

  function bindSettings() {
    $$('[data-lang]').forEach(button => button.onclick = () => { state.lang = button.dataset.lang; applyLanguage(); renderSettings(); });
    $('#profileForm')?.addEventListener('submit', async event => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      try { await backend.updateProfile(form.get('name').trim(), form.get('initial').trim()); state.context = backend.context; renderAll(); renderSettings(); showToast(t('保存しました。', '已保存。')); }
      catch (error) { showToast(errorText(error)); }
    });
    $('#rotateInvite')?.addEventListener('click', async () => {
      const code = randomCode();
      try { await backend.rotateInvite(code); $('#rotatedCode').innerHTML = `<div class="code-card partner"><span>${t('新しいパートナー招待コード', '新的对象邀请码')}</span><strong>${code}</strong><button data-copy="${code}">${t('コピー', '复制')}</button></div>`; bindCopyButtons(); }
      catch (error) { showToast(errorText(error)); }
    });
    $('#rotateRecovery')?.addEventListener('click', async () => {
      const code = randomCode();
      try { await backend.rotateRecovery(code); $('#rotatedRecovery').innerHTML = `<div class="code-card"><span>${t('新しい自分の復元コード', '新的个人恢复码')}</span><strong>${code}</strong><button data-copy="${code}">${t('コピー', '复制')}</button></div>`; bindCopyButtons(); }
      catch (error) { showToast(errorText(error)); }
    });
    $$('[data-role]').forEach(button => button.onclick = async () => { await backend.switchDemoRole(button.dataset.role); state.context = backend.context; await refreshData(); closeModal('settingsModal'); showToast(t('デモの役割を切り替えました。', '已切换演示身份。')); });
    $('#exportData')?.addEventListener('click', async () => downloadJson(await backend.exportData(), `tsukimusubi-${new Date().toISOString().slice(0,10)}.json`));
    $('#deleteAccount')?.addEventListener('click', async () => {
      const confirmed = confirm(t('この端末の会員情報を削除します。最後のメンバーの場合、ふたりのデータも削除されます。続けますか？', '将删除此设备的会员信息。如果这是最后一名成员，两人的数据也会删除。继续吗？'));
      if (!confirmed) return;
      try { await backend.deleteAccount(); state.context = null; state.reviews = []; state.photos = []; closeModal('settingsModal'); showView('welcome'); showToast(t('削除しました。', '已删除。')); }
      catch (error) { showToast(errorText(error)); }
    });
  }

  function renderLegal(type) {
    const privacy = state.lang === 'zh'
      ? `<span class="section-kicker">PRIVACY</span><h2>隐私政策（Beta）</h2><p>月结仅收集提供双人契约、历史记录与共享相册所必需的信息，包括昵称、配对关系、回答、评分、照片及技术日志。回答在双方提交前不会向对象公开。</p><h3>数据用途</h3><ul><li>提供、维护与保护服务</li><li>排查故障及防止滥用</li><li>根据用户请求导出或删除数据</li></ul><h3>保存与删除</h3><p>照片存放在私有存储空间，通过短期有效链接读取。用户可在设置中删除自己的账户；最后一名成员删除账户后，配对数据将一并删除。</p><h3>Beta说明</h3><p>本版本不收取费用，不用于医疗、法律或心理诊断。提供者为 HAKU（月结运营）。</p><p><a href="privacy.html" target="_blank" rel="noopener">查看完整隐私政策</a></p>`
      : `<span class="section-kicker">PRIVACY</span><h2>プライバシーポリシー（Beta）</h2><p>月結びは、ふたりの契約、履歴、共有アルバムを提供するために必要な範囲で、呼び名、ペア関係、回答、得点、写真、技術ログを取り扱います。回答は双方が提出するまで相手に公開されません。</p><h3>利用目的</h3><ul><li>サービスの提供・保守・安全確保</li><li>不具合調査および不正利用の防止</li><li>利用者の求めに応じたデータの出力・削除</li></ul><h3>保存と削除</h3><p>写真は非公開ストレージに保存し、短時間のみ有効なURLで表示します。設定からアカウントを削除でき、最後のメンバーが削除した場合はペアデータも削除します。</p><h3>Betaについて</h3><p>本版は無料で、医療・法律・心理診断を目的としません。提供者は HAKU（月結び運営）です。</p><p><a href="privacy.html" target="_blank" rel="noopener">完全版のプライバシーポリシーを確認</a></p>`;
    const terms = state.lang === 'zh'
      ? `<span class="section-kicker">TERMS</span><h2>使用条款（Beta）</h2><p>本服务供年满18周岁的用户，在双方同意的前提下记录关系回顾。不得擅自上传第三人的照片或个人信息，也不得将邀请码公开。</p><h3>禁止事项</h3><ul><li>骚扰、监视、胁迫或未经同意使用</li><li>侵犯他人权利或违法内容</li><li>试图访问其他配对的数据</li></ul><h3>服务性质</h3><p>Beta期间功能可能变更或暂停。重要内容请使用导出功能自行备份。本服务不能代替紧急援助或专业咨询。</p>`
      : `<span class="section-kicker">TERMS</span><h2>利用規約（Beta）</h2><p>本サービスは18歳以上の方が、双方の同意のもとで関係の振り返りを記録するために利用できます。第三者の写真・個人情報を無断で投稿したり、招待コードを公開したりしないでください。</p><h3>禁止事項</h3><ul><li>嫌がらせ、監視、強要または同意のない利用</li><li>他者の権利を侵害する内容、法令に反する内容</li><li>他のペアのデータへのアクセスの試み</li></ul><h3>サービスの性質</h3><p>Beta期間中は機能の変更・停止があります。大切な内容は書き出し機能で保管してください。本サービスは緊急支援や専門家への相談を代替するものではありません。</p>`;
    $('#legalContent').innerHTML = type === 'privacy' ? privacy : terms;
    openModal('legalModal');
  }

  function bindCopyButtons() {
    $$('[data-copy]').forEach(button => button.onclick = async () => {
      try { await navigator.clipboard.writeText(button.dataset.copy); showToast(t('コピーしました。', '已复制。')); }
      catch { showToast(t('長押ししてコピーしてください。', '请长按复制。')); }
    });
  }

  function bindEvents() {
    $('#openCreate').onclick = () => openModal('createModal');
    $('#openJoin').onclick = () => openModal('joinModal');
    $('#createForm').addEventListener('submit', handleCreate);
    $('#joinForm').addEventListener('submit', handleJoin);
    $('#reviewForm').addEventListener('submit', handleReview);
    $('#settingsButton').onclick = () => { renderSettings(); openModal('settingsModal'); };
    $('#homeButton').onclick = () => showView(state.context ? 'home' : 'welcome');
    $$('[data-close]').forEach(button => button.onclick = () => closeModal(button));
    $$('.back-button').forEach(button => button.onclick = () => showView(button.dataset.target));
    $('#codesSaved').onchange = event => $('#finishCodes').disabled = !event.target.checked;
    $('#finishCodes').onclick = () => { closeModal('codesModal'); showView('home'); };
    $('#startReview').onclick = () => {
      if (state.status.a && state.status.b) return renderResult(monthKey);
      if (state.status[state.context.role]) return;
      renderReviewForm(); showView('review');
    };
    $('#historyList').onclick = event => { const item = event.target.closest('[data-month]'); if (item) renderResult(item.dataset.month); };
    $('#photoInput').onchange = event => { handlePhotos(event.target.files); event.target.value = ''; };
    $('#albumGrid').onclick = async event => {
      const button = event.target.closest('[data-delete-photo]');
      if (!button) return;
      const photo = state.photos.find(item => item.id === button.dataset.deletePhoto);
      if (!photo || !confirm(t('この写真を削除しますか？', '要删除这张照片吗？'))) return;
      try { await backend.deletePhoto(photo); state.photos = await backend.getPhotos(); renderAlbum(); }
      catch (error) { showToast(errorText(error)); }
    };
    $$('[data-legal]').forEach(button => button.onclick = () => renderLegal(button.dataset.legal));
    document.addEventListener('keydown', event => { if (event.key === 'Escape') $$('.modal.open').forEach(closeModal); });
  }

  async function init() {
    applyLanguage();
    bindEvents();
    await initLine();
    try {
      const result = await backend.init();
      state.context = result.context;
      if (state.context) { await refreshData(); showView('home'); }
      else showView('welcome');
    } catch (error) {
      console.error(error);
      showToast(t('クラウドへの接続に失敗しました。設定を確認してください。', '云端连接失败，请检查配置。'));
      showView('welcome');
    }
  }

  init();
})();
