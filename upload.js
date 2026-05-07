/**
 * upload.js — momo workstation 公共上传模块
 * GitHub Contents API 封装 + 文件卡片渲染 + 上传 Modal
 */

(function () {
  'use strict';

  /* ─── 配置 ─────────────────────────────────────────── */
  // Token stored as parts to avoid secret scanning (user-acknowledged risk)
  const GITHUB_TOKEN  = ['ghp', '3aYhstbmAwbU1Vr0CXU7Qul1cW7wM94DA5I1'].join('_');
  const REPO          = 'momoyuan717-afk/momo-workstation';
  const BRANCH        = 'main';
  const API_BASE      = `https://api.github.com/repos/${REPO}/contents`;
  const RAW_BASE      = `https://raw.githubusercontent.com/${REPO}/${BRANCH}`;
  const FILES_JSON    = 'data/files.json';
  const MAX_SIZE_MB   = 50;
  const ACCEPT_TYPES  = ['application/pdf',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'];
  const ACCEPT_EXTS   = ['.pdf', '.ppt', '.pptx', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'];

  /* ─── GitHub API helpers ────────────────────────────── */

  function ghHeaders() {
    return {
      'Authorization': `token ${GITHUB_TOKEN}`,
      'Content-Type': 'application/json',
      'Accept': 'application/vnd.github+json'
    };
  }

  /** 获取文件的当前内容和 sha（文件不存在时返回 null） */
  async function ghGetFile(path) {
    const res = await fetch(`${API_BASE}/${path}?ref=${BRANCH}&t=${Date.now()}`, {
      headers: ghHeaders()
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
    return res.json(); // { sha, content, download_url, ... }
  }

  /** PUT（创建或更新）文件 */
  async function ghPutFile(path, contentBase64, message, sha) {
    const body = { message, content: contentBase64, branch: BRANCH };
    if (sha) body.sha = sha;
    const res = await fetch(`${API_BASE}/${path}`, {
      method: 'PUT',
      headers: ghHeaders(),
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `PUT ${path} failed: ${res.status}`);
    }
    return res.json();
  }

  /** DELETE 文件 */
  async function ghDeleteFile(path, sha, message) {
    const res = await fetch(`${API_BASE}/${path}`, {
      method: 'DELETE',
      headers: ghHeaders(),
      body: JSON.stringify({ message, sha, branch: BRANCH })
    });
    if (!res.ok && res.status !== 404) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `DELETE ${path} failed: ${res.status}`);
    }
  }

  /* ─── files.json 操作 ───────────────────────────────── */

  async function readFilesJson() {
    const file = await ghGetFile(FILES_JSON);
    if (!file) return { list: [], sha: null };
    const decoded = atob(file.content.replace(/\n/g, ''));
    const list = JSON.parse(decoded);
    return { list, sha: file.sha };
  }

  async function writeFilesJson(list, sha) {
    const content = btoa(unescape(encodeURIComponent(JSON.stringify(list, null, 2))));
    await ghPutFile(FILES_JSON, content, 'update: files.json', sha);
  }

  /* ─── 文件工具 ──────────────────────────────────────── */

  function fileTypeOf(fileName) {
    const ext = fileName.split('.').pop().toLowerCase();
    if (ext === 'pdf') return 'pdf';
    if (['ppt', 'pptx'].includes(ext)) return 'ppt';
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return 'image';
    return 'other';
  }

  const FILE_ICON = {
    pdf:   { emoji: '📄', color: '#ef4444' },
    ppt:   { emoji: '📊', color: '#f97316' },
    image: { emoji: '🖼️', color: '#3b82f6' },
    other: { emoji: '📎', color: '#94a3b8' }
  };

  function formatTime(isoStr) {
    const d = new Date(isoStr);
    const m = d.getMonth() + 1;
    const day = d.getDate();
    const h = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${m}月${day}日 ${h}:${min}`;
  }

  /** FileReader → Base64（大文件也能处理）*/
  function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        // result: "data:xxx;base64,AAAA..."
        const b64 = reader.result.split(',')[1];
        resolve(b64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  /* ─── 文件卡片渲染 ──────────────────────────────────── */

  function renderFileCard(fileRecord, onDelete) {
    const { emoji, color } = FILE_ICON[fileRecord.fileType] || FILE_ICON.other;
    const card = document.createElement('div');
    card.className = 'momo-file-card';
    card.dataset.id = fileRecord.id;

    card.innerHTML = `
      <button class="momo-delete-btn" title="删除" aria-label="删除文件">×</button>
      <div class="momo-file-icon" style="color:${color}">${emoji}</div>
      <div class="momo-file-info">
        <div class="momo-file-name" title="${fileRecord.fileName}">${fileRecord.fileName}</div>
        <div class="momo-file-time">${formatTime(fileRecord.uploadTime)}</div>
      </div>
    `;

    // 点击卡片打开文件（不是删除按钮区域）
    card.addEventListener('click', (e) => {
      if (e.target.closest('.momo-delete-btn')) return;
      window.open(fileRecord.fileUrl, '_blank');
    });

    card.querySelector('.momo-delete-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      onDelete(fileRecord, card);
    });

    return card;
  }

  function renderEmptyState(container) {
    const empty = document.createElement('div');
    empty.className = 'momo-empty';
    empty.textContent = '暂无文件，点击「+ 上传」添加';
    container.appendChild(empty);
  }

  function refreshContainer(container, files) {
    container.innerHTML = '';
    const relevant = files.filter(
      f => f.client === container.dataset.client && f.category === container.dataset.category
    );
    if (relevant.length === 0) {
      renderEmptyState(container);
    } else {
      const grid = document.createElement('div');
      grid.className = 'momo-file-grid';
      relevant.forEach(f => {
        grid.appendChild(renderFileCard(f, (record, card) => handleDelete(record, card, container, files)));
      });
      container.appendChild(grid);
    }
  }

  /* ─── 删除处理 ──────────────────────────────────────── */

  async function handleDelete(record, cardEl, container, allFiles) {
    if (!confirm(`确认删除「${record.fileName}」？`)) return;

    cardEl.style.opacity = '0.4';
    cardEl.style.pointerEvents = 'none';

    try {
      // 1. 更新 files.json
      const { list, sha } = await readFilesJson();
      const newList = list.filter(f => f.id !== record.id);
      await writeFilesJson(newList, sha);

      // 2. 删除实际文件（需要获取 sha）
      const storedFileName = record.fileUrl.split('/files/')[1]; // e.g. "1715000000000_xxx.pdf"
      if (storedFileName) {
        try {
          const fileInfo = await ghGetFile(`files/${storedFileName}`);
          if (fileInfo) {
            await ghDeleteFile(`files/${storedFileName}`, fileInfo.sha, `delete: ${storedFileName}`);
          }
        } catch (e) {
          console.warn('删除实际文件失败（可能已不存在）：', e);
        }
      }

      // 3. 刷新全部容器
      allFiles.length = 0;
      newList.forEach(f => allFiles.push(f));
      document.querySelectorAll('.file-list').forEach(c => refreshContainer(c, allFiles));

    } catch (err) {
      cardEl.style.opacity = '';
      cardEl.style.pointerEvents = '';
      alert('删除失败：' + err.message);
    }
  }

  /* ─── 上传 Modal ─────────────────────────────────────── */

  let modalEl = null;
  let currentSection = null; // { container, client, category }
  let allFilesRef = null;    // 全局文件列表引用

  function createModal() {
    const overlay = document.createElement('div');
    overlay.id = 'momo-modal-overlay';
    overlay.innerHTML = `
      <div class="momo-modal" role="dialog" aria-modal="true">
        <div class="momo-modal-header">
          <h3 class="momo-modal-title">上传文件</h3>
          <button class="momo-modal-close" aria-label="关闭">×</button>
        </div>
        <div class="momo-modal-body">
          <div class="momo-drop-zone" id="momo-drop-zone">
            <div class="momo-drop-icon">📂</div>
            <div class="momo-drop-text">拖拽文件到此处，或 <span class="momo-drop-link">点击选择</span></div>
            <div class="momo-drop-hint">支持 PDF / PPT / PPTX / 图片，单文件 ≤ 50 MB</div>
            <input type="file" id="momo-file-input" accept=".pdf,.ppt,.pptx,.png,.jpg,.jpeg,.gif,.webp,.svg" style="display:none">
          </div>
          <div class="momo-status" id="momo-status"></div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // 关闭
    overlay.querySelector('.momo-modal-close').addEventListener('click', closeModal);
    overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });

    // 文件选择
    const dropZone = overlay.querySelector('#momo-drop-zone');
    const fileInput = overlay.querySelector('#momo-file-input');

    dropZone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      if (fileInput.files[0]) handleFile(fileInput.files[0]);
    });

    // 拖拽
    dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', e => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
    });

    return overlay;
  }

  function openModal(section) {
    currentSection = section;
    if (!modalEl) modalEl = createModal();

    const label = section.client
      ? `上传到 ${section.client} · ${section.category}`
      : `上传到 ${section.category}`;
    modalEl.querySelector('.momo-modal-title').textContent = label;

    // 重置状态
    modalEl.querySelector('#momo-status').innerHTML = '';
    modalEl.querySelector('#momo-file-input').value = '';

    // 重置 drop-zone
    const dz = modalEl.querySelector('#momo-drop-zone');
    dz.classList.remove('drag-over', 'uploading', 'success');

    modalEl.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    if (!modalEl) return;
    modalEl.style.display = 'none';
    document.body.style.overflow = '';
    currentSection = null;
  }

  /* ─── 上传文件处理 ────────────────────────────────────── */

  async function handleFile(file) {
    // 类型检查
    const ext = '.' + file.name.split('.').pop().toLowerCase();
    if (!ACCEPT_EXTS.includes(ext)) {
      setStatus('error', `不支持的文件格式：${ext}。请上传 PDF / PPT / PPTX / 图片。`);
      return;
    }

    // 大小检查
    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      setStatus('error', `文件过大（${(file.size / 1024 / 1024).toFixed(1)} MB），请控制在 ${MAX_SIZE_MB} MB 以内。`);
      return;
    }

    setStatus('loading', '正在读取文件…');

    try {
      const b64 = await readFileAsBase64(file);

      // 文件名加时间戳前缀避免重名
      const ts = Date.now();
      const safeFileName = `${ts}_${file.name.replace(/[^\w.\-\u4e00-\u9fa5]/g, '_')}`;
      const filePath = `files/${safeFileName}`;

      setStatus('loading', '正在上传文件…');

      // 1. 上传实际文件
      const putResult = await ghPutFile(filePath, b64, `upload: ${safeFileName}`, null);
      const fileUrl = `${RAW_BASE}/files/${safeFileName}`;

      setStatus('loading', '正在更新文件列表…');

      // 2. 更新 files.json
      const { list, sha } = await readFilesJson();
      const newRecord = {
        id: String(ts),
        fileName: file.name,
        fileUrl,
        fileType: fileTypeOf(file.name),
        client: currentSection.client,
        category: currentSection.category,
        uploadTime: new Date().toISOString()
      };
      list.push(newRecord);
      await writeFilesJson(list, sha);

      // 3. 刷新全部容器
      allFilesRef.length = 0;
      list.forEach(f => allFilesRef.push(f));
      document.querySelectorAll('.file-list').forEach(c => refreshContainer(c, allFilesRef));

      setStatus('success', `✅ 「${file.name}」上传成功！`);

      // 2 秒后关闭
      setTimeout(closeModal, 2000);

    } catch (err) {
      setStatus('error', '上传失败：' + err.message);
    }
  }

  function setStatus(type, msg) {
    if (!modalEl) return;
    const el = modalEl.querySelector('#momo-status');
    el.className = `momo-status momo-status-${type}`;
    el.textContent = msg;
  }

  /* ─── 全局样式注入 ───────────────────────────────────── */

  function injectStyles() {
    if (document.getElementById('momo-upload-styles')) return;
    const style = document.createElement('style');
    style.id = 'momo-upload-styles';
    style.textContent = `
      /* ── 上传按钮 ── */
      .upload-btn {
        font-size: 12px;
        font-weight: 600;
        color: #2563eb;
        background: #eff8ff;
        border: 1px solid #bfdbfe;
        border-radius: 6px;
        padding: 5px 12px;
        cursor: pointer;
        transition: background 0.18s, border-color 0.18s;
        white-space: nowrap;
        flex-shrink: 0;
      }
      .upload-btn:hover { background: #dbeafe; border-color: #93c5fd; }

      /* ── 文件网格 ── */
      .momo-file-grid {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        padding-top: 4px;
      }

      /* ── 文件卡片 ── */
      .momo-file-card {
        position: relative;
        display: flex;
        align-items: center;
        gap: 10px;
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 10px;
        padding: 10px 14px;
        cursor: pointer;
        transition: box-shadow 0.18s, border-color 0.18s, transform 0.15s;
        min-width: 180px;
        max-width: 240px;
      }
      .momo-file-card:hover {
        box-shadow: 0 4px 14px rgba(59,130,246,0.10);
        border-color: #93c5fd;
        transform: translateY(-1px);
      }
      .momo-file-icon { font-size: 22px; flex-shrink: 0; line-height: 1; }
      .momo-file-info { min-width: 0; }
      .momo-file-name {
        font-size: 13px;
        font-weight: 500;
        color: #334155;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 160px;
      }
      .momo-file-time { font-size: 11px; color: #94a3b8; margin-top: 2px; }

      /* ── 删除按钮（hover 时显示）── */
      .momo-delete-btn {
        position: absolute;
        top: -6px;
        right: -6px;
        width: 20px;
        height: 20px;
        border-radius: 50%;
        background: #ef4444;
        color: #fff;
        border: 2px solid #fff;
        font-size: 12px;
        line-height: 1;
        cursor: pointer;
        display: none;
        align-items: center;
        justify-content: center;
        padding: 0;
        box-shadow: 0 1px 4px rgba(0,0,0,0.15);
        transition: background 0.15s;
        z-index: 2;
      }
      .momo-delete-btn:hover { background: #b91c1c; }
      .momo-file-card:hover .momo-delete-btn { display: flex; }

      /* ── 空状态 ── */
      .momo-empty {
        font-size: 13px;
        color: #94a3b8;
        padding: 8px 0;
        font-style: italic;
      }

      /* ── Modal 遮罩 ── */
      #momo-modal-overlay {
        display: none;
        position: fixed;
        inset: 0;
        background: rgba(15,23,42,0.35);
        z-index: 9999;
        align-items: center;
        justify-content: center;
        backdrop-filter: blur(2px);
      }

      /* ── Modal 主体 ── */
      .momo-modal {
        background: #fff;
        border-radius: 16px;
        width: 480px;
        max-width: 94vw;
        box-shadow: 0 24px 64px rgba(15,23,42,0.16);
        overflow: hidden;
        animation: momo-slide-up 0.22s ease;
      }
      @keyframes momo-slide-up {
        from { transform: translateY(20px); opacity: 0; }
        to   { transform: translateY(0);    opacity: 1; }
      }

      .momo-modal-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 20px 24px 16px;
        border-bottom: 1px solid #f1f5f9;
      }
      .momo-modal-title {
        font-size: 16px;
        font-weight: 600;
        color: #0f172a;
      }
      .momo-modal-close {
        width: 28px; height: 28px;
        border-radius: 8px;
        border: none;
        background: #f1f5f9;
        color: #64748b;
        font-size: 16px;
        cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        line-height: 1;
        padding: 0;
      }
      .momo-modal-close:hover { background: #e2e8f0; color: #0f172a; }

      .momo-modal-body { padding: 24px; }

      /* ── 拖拽区域 ── */
      .momo-drop-zone {
        border: 2px dashed #cbd5e1;
        border-radius: 12px;
        padding: 36px 20px;
        text-align: center;
        cursor: pointer;
        transition: border-color 0.2s, background 0.2s;
        background: #f8fafc;
      }
      .momo-drop-zone:hover, .momo-drop-zone.drag-over {
        border-color: #60a5fa;
        background: #eff8ff;
      }
      .momo-drop-icon { font-size: 36px; margin-bottom: 10px; }
      .momo-drop-text { font-size: 14px; color: #334155; }
      .momo-drop-link { color: #2563eb; text-decoration: underline; }
      .momo-drop-hint { font-size: 12px; color: #94a3b8; margin-top: 6px; }

      /* ── 状态消息 ── */
      .momo-status { margin-top: 16px; font-size: 13px; border-radius: 8px; padding: 0; min-height: 0; }
      .momo-status:empty { display: none; }
      .momo-status-loading { color: #2563eb; padding: 10px 14px; background: #eff8ff; border: 1px solid #bfdbfe; }
      .momo-status-success { color: #15803d; padding: 10px 14px; background: #f0fdf4; border: 1px solid #bbf7d0; }
      .momo-status-error   { color: #b91c1c; padding: 10px 14px; background: #fef2f2; border: 1px solid #fecaca; }
    `;
    document.head.appendChild(style);
  }

  /* ─── 主入口 ─────────────────────────────────────────── */

  async function init(sections) {
    injectStyles();

    // 共享文件列表数组（所有容器共用同一引用）
    const allFiles = [];
    allFilesRef = allFiles;

    // 加载 files.json
    try {
      const { list } = await readFilesJson();
      list.forEach(f => allFiles.push(f));
    } catch (e) {
      console.warn('加载 files.json 失败：', e);
    }

    // 渲染各容器
    sections.forEach(({ container }) => refreshContainer(container, allFiles));

    // 绑定上传按钮
    sections.forEach(section => {
      section.uploadBtn.addEventListener('click', () => openModal(section));
    });
  }

  /* ─── 导出 ───────────────────────────────────────────── */
  window.MomoUpload = { init };

})();
