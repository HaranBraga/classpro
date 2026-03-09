/* =============================================
   admin.js — Painel Administrativo
   ============================================= */

const API = '/api';
let token = localStorage.getItem('classpro_token');
let selectedFile = null;

// ---- Inicialização ----
document.addEventListener('DOMContentLoaded', () => {
    if (token) {
        showPanel();
    }
});

// ---- Login ----
const loginForm = document.getElementById('login-form');
const btnLogin = document.getElementById('btn-login');

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;

    if (!username || !password) return;

    btnLogin.disabled = true;
    btnLogin.textContent = 'Entrando...';

    try {
        const res = await fetch(`${API}/admin/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
        });

        const data = await res.json();

        if (!res.ok) {
            showLoginError(data.error || 'Credenciais inválidas');
        } else {
            token = data.token;
            localStorage.setItem('classpro_token', token);
            showPanel();
        }
    } catch {
        showLoginError('Erro ao conectar. Verifique se o servidor está rodando.');
    } finally {
        btnLogin.disabled = false;
        btnLogin.textContent = 'Entrar';
    }
});

// ---- Logout ----
document.getElementById('btn-logout').addEventListener('click', () => {
    localStorage.removeItem('classpro_token');
    token = null;
    document.getElementById('admin-panel').style.display = 'none';
    document.getElementById('login-screen').style.display = 'flex';
});

// ---- Mostrar Painel ----
function showPanel() {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('admin-panel').style.display = 'block';
    loadStats();
}

// ---- Stats ----
async function loadStats() {
    try {
        const res = await fetch(`${API}/admin/stats`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (res.status === 401) { logout(); return; }
        const data = await res.json();
        document.getElementById('stats-total').textContent =
            data.total.toLocaleString('pt-BR');
    } catch {
        document.getElementById('stats-total').textContent = 'Erro';
    }
}
document.getElementById('btn-refresh-stats').addEventListener('click', loadStats);

// ---- Drop Zone ----
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const filePreview = document.getElementById('file-preview');

dropZone.addEventListener('click', () => fileInput.click());



dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) setFile(file);
});

fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) setFile(fileInput.files[0]);
});

document.getElementById('btn-remove-file').addEventListener('click', () => {
    selectedFile = null;
    filePreview.style.display = 'none';
    dropZone.style.display = 'block';
    document.getElementById('btn-upload').disabled = true;
    fileInput.value = '';
    document.getElementById('upload-result').style.display = 'none';
    document.getElementById('upload-progress').style.display = 'none';
});

function setFile(file) {
    const validExts = ['.xls', '.xlsx', '.csv'];
    const name = file.name.toLowerCase();
    if (!validExts.some(ext => name.endsWith(ext))) {
        alert('Formato inválido. Use .xls, .xlsx ou .csv');
        return;
    }
    selectedFile = file;
    document.getElementById('file-name').textContent = file.name;
    document.getElementById('file-size').textContent = formatSize(file.size);
    dropZone.style.display = 'none';
    filePreview.style.display = 'block';
    document.getElementById('btn-upload').disabled = false;
    document.getElementById('upload-result').style.display = 'none';
}

function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ---- Upload ----
const btnUpload = document.getElementById('btn-upload');
const uploadProgress = document.getElementById('upload-progress');
const progressBar = document.getElementById('progress-bar');
const progressLabel = document.getElementById('progress-label');
const uploadResult = document.getElementById('upload-result');

btnUpload.addEventListener('click', async () => {
    if (!selectedFile) return;

    btnUpload.disabled = true;
    uploadProgress.style.display = 'block';
    uploadResult.style.display = 'none';
    progressBar.style.width = '0%';
    progressLabel.textContent = 'Enviando arquivo...';

    // Animos de progresso simulado até resposta
    let prog = 0;
    const interval = setInterval(() => {
        prog = Math.min(prog + Math.random() * 8, 85);
        progressBar.style.width = `${prog}%`;
    }, 300);

    try {
        const formData = new FormData();
        formData.append('file', selectedFile);

        const res = await fetch(`${API}/admin/upload`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            body: formData,
        });

        clearInterval(interval);

        if (res.status === 401) { logout(); return; }

        const data = await res.json();

        progressBar.style.width = '100%';
        progressLabel.textContent = 'Concluído!';

        if (!res.ok) {
            uploadResult.innerHTML = `
        <div class="error-card" style="margin-bottom:0">
          ⚠️ ${data.error || 'Erro ao importar'}
        </div>`;
        } else {
            uploadResult.innerHTML = `
        <div class="upload-success">
          ✅ ${data.message || `${data.total} registros importados!`}
        </div>`;
            setTimeout(() => { loadStats(); }, 500);
        }

        uploadResult.style.display = 'block';
    } catch {
        clearInterval(interval);
        progressBar.style.width = '0%';
        progressLabel.textContent = 'Erro no envio';
        uploadResult.innerHTML = `<div class="error-card" style="margin-bottom:0">❌ Erro ao conectar com o servidor.</div>`;
        uploadResult.style.display = 'block';
    } finally {
        btnUpload.disabled = false;
        setTimeout(() => {
            uploadProgress.style.display = 'none';
        }, 2000);
    }
});

// ---- Helpers ----
function showLoginError(msg) {
    document.getElementById('login-error-msg').textContent = msg;
    document.getElementById('login-error').style.display = 'flex';
}

function logout() {
    localStorage.removeItem('classpro_token');
    token = null;
    window.location.reload();
}

// ---- Limpar Banco ----
document.getElementById('btn-clear').addEventListener('click', () => {
    document.getElementById('clear-confirm').style.display = 'block';
    document.getElementById('clear-result').style.display = 'none';
    document.getElementById('btn-clear').style.display = 'none';
});

document.getElementById('btn-clear-cancel').addEventListener('click', () => {
    document.getElementById('clear-confirm').style.display = 'none';
    document.getElementById('btn-clear').style.display = 'block';
});

document.getElementById('btn-clear-confirm').addEventListener('click', async () => {
    const btnConfirm = document.getElementById('btn-clear-confirm');
    btnConfirm.disabled = true;
    btnConfirm.textContent = 'Limpando...';

    try {
        const res = await fetch(`${API}/admin/clear`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` },
        });

        if (res.status === 401) { logout(); return; }

        const data = await res.json();
        document.getElementById('clear-confirm').style.display = 'none';

        const resultEl = document.getElementById('clear-result');
        if (res.ok) {
            resultEl.innerHTML = `<div class="upload-success">✅ ${data.message}</div>`;
            loadStats();
        } else {
            resultEl.innerHTML = `<div class="error-card">❌ ${data.error || 'Erro ao limpar banco'}</div>`;
        }
        resultEl.style.display = 'block';
        document.getElementById('btn-clear').style.display = 'block';
    } catch {
        document.getElementById('clear-confirm').style.display = 'none';
        document.getElementById('clear-result').innerHTML = `<div class="error-card">❌ Erro ao conectar com o servidor.</div>`;
        document.getElementById('clear-result').style.display = 'block';
        document.getElementById('btn-clear').style.display = 'block';
    } finally {
        btnConfirm.disabled = false;
        btnConfirm.textContent = 'Sim, limpar tudo';
    }
});
