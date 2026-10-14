/* Config contents stay in the extension host; the webview receives editable values and paths. */
(() => {
  const messages = JSON.parse(document.body.dataset.translations || '{}');
  let locale = document.documentElement.lang, languageChoice = 'auto';
  const t = (message, ...values) => (locale === 'en' ? messages[message] ?? message : message).replace(/\{(\d+)\}/g, (placeholder, index) => Number(index) < values.length ? String(values[Number(index)]) : placeholder);
  const vscode = acquireVsCodeApi();
  const $ = id => document.getElementById(id);
  const basicKeys = ['model', 'model_reasoning_effort', 'approval_policy', 'web_search'];
  const presets = ['**/.env', '**/.env.*', '**/*.pem', '**/*.key', '**/*.pfx', '**/*.p12'];
  let patterns = [], dirty = false, invalid = false, working = false, revision = 0;
  const send = (type, extra = {}) => vscode.postMessage({ type, ...extra });
  const draft = () => ({ basics: Object.fromEntries(basicKeys.map(k => [k, $(k).value])), patterns, protect: $('protect').checked, migrateLegacy: $('migrateLegacy').checked });
  let statusState, lastLoaded, lastMatches, saveBeforeScan = false;
  const status = (text, error = false) => { $('status').textContent = text; $('status').className = error ? 'error' : ''; };
  const statusKey = (message, values = [], error = false) => { statusState = { message, values, error }; status(t(message, ...values.map(v => typeof v === 'function' ? v() : v)), error); };
  const changed = () => { revision++; dirty = true; $('save').disabled = true; send('invalidate'); statusKey("未保存の変更があります。差分を確認してください。"); $('matches').replaceChildren(); lastMatches = undefined; };
  function node(tag, text, className) { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; }
  function renderPatterns() {
    $('patterns').replaceChildren();
    $('patternCount').textContent = t("{0}件", patterns.length);
    if (!patterns.length) $('patterns').append(node('p', t("読み取り禁止ルールはまだありません。"), 'empty-state'));
    patterns.forEach(pattern => {
      const row = node('div', undefined, 'pattern');
      row.append(node('code', pattern));
      const remove = node('button', t("削除"), 'secondary'); remove.setAttribute('aria-label', t("{0} を削除", pattern));
      remove.onclick = () => { patterns = patterns.filter(p => p !== pattern); renderPatterns(); changed(); };
      row.append(remove); $('patterns').append(row);
    });
  }
  function add(values) { patterns = [...new Set([...patterns, ...values])]; $('protect').checked = true; renderPatterns(); changed(); }
  function request(type) {
    if (working || invalid) return;
    working = true; $('language').disabled = true; $('rescan').disabled = true; if (type === 'save') document.querySelector('main').inert = true;
    $('preview').disabled = true; $('save').disabled = true; statusKey("処理中…"); send(type, { draft: draft(), revision });
  }
  document.querySelectorAll('[data-tab]').forEach(button => button.onclick = () => {
    document.querySelectorAll('[data-tab]').forEach(b => { const active = b === button; b.classList.toggle('active', active); b.setAttribute('aria-pressed', String(active)); });
    document.querySelectorAll('.page').forEach(page => page.hidden = page.id !== button.dataset.tab);
  });
  basicKeys.forEach(k => $(k).addEventListener('input', changed));
  ['protect', 'migrateLegacy'].forEach(k => $(k).addEventListener('change', changed));
  $('addForm').onsubmit = event => { event.preventDefault(); const value = $('pattern').value.trim(); if (value) { add([value]); $('pattern').value = ''; } };
  $('preset').onclick = () => add(presets);
  $('match').onclick = () => send('previewFiles', { draft: draft() });
  $('preview').onclick = () => request('preview');
  $('save').onclick = () => request('save');
  $('openToml').onclick = () => send('openToml');
  $('reload').onclick = () => {
    if (working) return;
    working = true; $('language').disabled = true; $('rescan').disabled = true; document.querySelector('main').inert = true; $('save').disabled = true; send('reload', { dirty });
  };
  function renderInfo(m) {
      $('issues').replaceChildren(...m.issues.map(i => node('div', i.message, `issue ${i.level}`)));
      $('candidates').replaceChildren(); $('candidateCount').textContent = `(${m.candidates.length})`;
      m.candidates.forEach(file => {
        const row = node('div', undefined, 'candidate'); row.append(node('code', file));
        const button = node('button', t("追加"), 'secondary'); button.onclick = () => add([file]); row.append(button); $('candidates').append(row);
      });
      const table = node('table'), head = node('tr'); [t("設定元"), t("モデル"), t("推論"), t("承認"), t("検索"), t("権限プロファイル")].forEach(k => head.append(node('th', k))); table.append(head);
      m.sources.forEach(source => { const tr = node('tr'); [source.name, ...basicKeys.map(k => source.values[k]), source.values.default_permissions].forEach(v => tr.append(node('td', v))); table.append(tr); });
      const wrap = node('div', undefined, 'table-wrap'); wrap.append(table); $('sources').replaceChildren(wrap);
      $('extraRules').textContent = m.extraRules.length ? t("ほかの権限プロファイル（この画面では未編集）: {0}", m.extraRules.join(' / ')) : '';
  }
  function renderMatches(m) {
      $('matches').replaceChildren();
      m.rules.forEach(rule => {
        const details = node('details'); details.append(node('summary', t("{0}: {1}件", rule.pattern, rule.count)));
        rule.files.forEach(file => details.append(node('div', file)));
        if (rule.count > rule.files.length) details.append(node('p', t("先頭200件のみ表示。")));
        $('matches').append(details);
      });
      if (m.truncated) $('matches').append(node('p', t("検索上限（{0}件）に達したため、一部のファイルは確認できていません。", m.scanLimit ?? lastLoaded?.scanLimit ?? 10000), 'issue warning'));
  }
  function renderScan(m) {
    $('scanStatus').textContent = m.truncated
      ? t("検索上限（{0}件）に達したため、一部のファイルは確認できていません。", m.scanLimit ?? 10000)
      : t("{0}件のファイルを確認（検索上限: {1}件）", m.count, m.scanLimit ?? 10000);
  }
  $('scanForm').onsubmit = event => {
    event.preventDefault();
    if (working || !$('scanLimit').reportValidity()) return;
    saveBeforeScan = !$('save').disabled;
    working = true; $('language').disabled = true; $('rescan').disabled = true;
    document.querySelector('main').inert = true;
    $('preview').disabled = true; $('save').disabled = true;
    statusKey("処理中…");
    send('rescan', { scanLimit: Number($('scanLimit').value) });
  };
  $('language').onchange = () => {
    if (working) { $('language').value = languageChoice; return; }
    working = true; $('language').disabled = true; $('rescan').disabled = true;
    send('setLanguage', { choice: $('language').value });
  };
  window.addEventListener('message', event => {
    const m = event.data;
    if (m.type === 'language') {
      locale = m.locale; languageChoice = m.choice; document.documentElement.lang = locale; $('language').value = languageChoice;
      document.querySelectorAll('[data-i18n]').forEach(el => el.textContent = t(el.dataset.i18n));
      for (const attribute of ['placeholder', 'aria-label']) document.querySelectorAll(`[data-i18n-${attribute}]`).forEach(el => el.setAttribute(attribute, t(el.getAttribute(`data-i18n-${attribute}`))));
      if (lastLoaded) { lastLoaded = { ...lastLoaded, ...m.info }; renderPatterns(); renderInfo(lastLoaded); renderScan(lastLoaded); }
      if (lastMatches) {
        const opened = Array.from($('matches').querySelectorAll('details'), el => el.open);
        renderMatches(lastMatches);
        $('matches').querySelectorAll('details').forEach((el, i) => el.open = opened[i]);
      }
      if (statusState) status(t(statusState.message, ...statusState.values.map(v => typeof v === 'function' ? v() : v)), statusState.error);
    } else if (m.type === 'scanned') {
      lastLoaded = { ...lastLoaded, ...m.info, count: m.count, truncated: m.truncated, scanLimit: m.scanLimit };
      $('scanLimit').value = String(m.scanLimit);
      renderInfo(lastLoaded); renderScan(lastLoaded);
      lastMatches = undefined; $('matches').replaceChildren();
      $('save').disabled = !saveBeforeScan;
      statusKey(saveBeforeScan ? "差分を開きました。内容を確認し、「確認した変更を保存」を押してください。" : dirty ? "未保存の変更があります。差分を確認してください。" : "再検索しました。一致するファイルは「対象ファイルを確認」で確認できます。");
    } else if (m.type === 'loaded') {
      lastLoaded = m; lastMatches = undefined;
      if (m.choice) { languageChoice = m.choice; $('language').value = languageChoice; }
      $('root').textContent = `${m.root} / .codex/config.toml`;
      invalid = m.invalid; dirty = false; patterns = m.draft.patterns;
      basicKeys.forEach(k => {
        // Preserve unknown enum values without silently converting them to unset.
        if ($(k).tagName === 'SELECT' && m.draft.basics[k] && !Array.from($(k).options).some(o => o.value === m.draft.basics[k])) {
          const option = node('option', m.draft.basics[k]); option.value = m.draft.basics[k]; $(k).append(option);
        }
        $(k).value = m.draft.basics[k];
      });
      $('protect').checked = m.draft.protect; $('migrateLegacy').checked = false;
      $('save').disabled = true; $('preview').disabled = invalid;
      renderPatterns(); $('matches').replaceChildren();
      renderInfo(m); renderScan(m); $('scanLimit').value = String(m.scanLimit ?? 10000);
      document.querySelector('main').setAttribute('aria-busy', 'false');
      if (invalid) statusKey("TOMLの構文を確認してください。フォームからの保存は無効です。", [], true);
      else statusKey("{0}件のパスを確認。{1}除外ディレクトリ・深い階層などは診断とREADMEを参照してください。", [m.count, () => m.truncated ? t("上限に達しています。") : '']);
    } else if (m.type === 'addPatterns') add(m.patterns);
    else if (m.type === 'matches') {
      lastMatches = m; renderMatches(m);
    } else if (m.type === 'prepared') { if (m.revision !== revision) { send('invalidate'); return; } $('save').disabled = false; statusKey("差分を開きました。内容を確認し、「確認した変更を保存」を押してください。"); }
    else if (m.type === 'saved') statusKey("保存しました。Codexの新しいセッションで設定を確認してください。");
    else if (m.type === 'error') { $('save').disabled = m.operation === 'rescan' ? !saveBeforeScan : true; $('language').value = languageChoice; statusState = undefined; status(m.message, true); }
    else if (m.type === 'idle') { working = false; $('language').disabled = false; $('rescan').disabled = false; document.querySelector('main').inert = false; $('preview').disabled = invalid; }
  });
  send('ready');
})();

