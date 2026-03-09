/* =============================================
   app.js — Consulta Pública NCM + Extração PDF
   ============================================= */

const API = '/api';

const tabBtns = document.querySelectorAll('.tab');
const tabPanels = document.querySelectorAll('.tab-content');
const ncmInput = document.getElementById('ncm-input');
const btnConsultar = document.getElementById('btn-consultar');
const descInput = document.getElementById('desc-input');
const btnBuscar = document.getElementById('btn-buscar');
const loading = document.getElementById('loading');
const loadingText = document.getElementById('loading-text');
const resultCard = document.getElementById('result-card');
const errorCard = document.getElementById('error-card');
const errorMsg = document.getElementById('error-msg');
const searchResults = document.getElementById('search-results');
const pdfResults = document.getElementById('pdf-results');

let currentQuery = '';
const PAGE_SIZE = 20;

// =============================================
// Tabs
// =============================================
tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        tabBtns.forEach(b => b.classList.remove('active'));
        tabPanels.forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(`panel-${btn.dataset.tab}`).classList.add('active');
        hideAll();
    });
});

// =============================================
// Aba 1 — Busca por NCM exato
// =============================================
ncmInput.addEventListener('input', () => { ncmInput.value = ncmInput.value.replace(/[^0-9]/g, ''); });
ncmInput.addEventListener('keydown', e => { if (e.key === 'Enter') btnConsultar.click(); });

btnConsultar.addEventListener('click', async () => {
    const ncm = ncmInput.value.trim();
    if (!ncm) return shake(ncmInput);
    if (ncm.length < 4) { showError('NCM deve ter no mínimo 4 dígitos'); return; }
    hideAll();
    showLoading('Consultando...');
    try {
        const res = await fetch(`${API}/ncm/${ncm}`);
        const data = await res.json();
        showLoading(false);
        if (!res.ok) showError(data.error || 'NCM não encontrado');
        else showResult(data);
    } catch {
        showLoading(false);
        showError('Erro ao conectar com o servidor.');
    }
});

// =============================================
// Aba 2 — Busca por Descrição
// =============================================
descInput.addEventListener('keydown', e => { if (e.key === 'Enter') btnBuscar.click(); });
btnBuscar.addEventListener('click', () => {
    currentQuery = descInput.value.trim();
    if (currentQuery.length < 2) { shake(descInput); return; }
    fetchSearch(0);
});

async function fetchSearch(offset) {
    hideAll();
    showLoading('Buscando...');
    try {
        const res = await fetch(`${API}/ncm/search?q=${encodeURIComponent(currentQuery)}&limit=${PAGE_SIZE}&offset=${offset}`);
        const data = await res.json();
        showLoading(false);
        if (!res.ok) showError(data.error || 'Erro na busca');
        else renderSearchResults(data, offset);
    } catch {
        showLoading(false);
        showError('Erro ao conectar com o servidor.');
    }
}

function renderSearchResults(data, offset) {
    const { data: rows, total } = data;
    document.getElementById('results-count').textContent = `${total} resultado${total !== 1 ? 's' : ''}`;
    const tbody = document.getElementById('results-tbody');
    tbody.innerHTML = rows.map(r => `
        <tr>
            <td><span class="ncm-code">${r.ncm}</span></td>
            <td>${r.descricao || '—'}</td>
            <td>
                <span class="classtrib-badge">${r.cclasstrib}</span>
                <button class="btn-ver-detalhes" data-code="${r.cclasstrib}" data-desc="${(r.desc_cclasstrib || '').replace(/"/g, '&quot;')}">Ver detalhes</button>
            </td>
            <td>${r.cst || '—'}</td>
            <td>${r.desc_cst || '—'}</td>
        </tr>
    `).join('');
    const totalPages = Math.ceil(total / PAGE_SIZE);
    const cur = Math.floor(offset / PAGE_SIZE);
    const pg = document.getElementById('pagination');
    pg.innerHTML = '';
    if (totalPages > 1) {
        for (let i = 0; i < Math.min(totalPages, 10); i++) {
            const btn = document.createElement('button');
            btn.className = `page-btn${i === cur ? ' active' : ''}`;
            btn.textContent = i + 1;
            btn.addEventListener('click', () => fetchSearch(i * PAGE_SIZE));
            pg.appendChild(btn);
        }
    }
    searchResults.style.display = 'block';
}

// =============================================
// Resultado Exato (único NCM)
// =============================================
function showResult(d) {
    const classificacoes = d.classificacoes || [];
    const multiple = classificacoes.length > 1;
    document.getElementById('res-cclasstrib-badge').textContent =
        multiple ? `${classificacoes.length} classificações tributárias` : `cClassTrib: ${classificacoes[0]?.cclasstrib || ''}`;
    document.getElementById('res-ncm').textContent = d.ncm;
    document.getElementById('res-desc').textContent = d.descricao || '—';
    const container = document.getElementById('classificacoes-container');
    container.innerHTML = classificacoes.map((c, i) => `
        <div class="classificacao-item${i === 0 ? ' first' : ''}">
            <div class="result-row highlight">
                <span class="result-label">cClassTrib</span>
                <span class="result-value accent">
                    ${c.cclasstrib}
                    <button class="btn-ver-detalhes" data-code="${c.cclasstrib}" data-desc="${(c.desc_cclasstrib || '').replace(/"/g, '&quot;')}">Ver detalhes</button>
                </span>
            </div>
            ${c.desc_cclasstrib ? `
            <div class="result-row">
                <span class="result-label">Desc. cClassTrib</span>
                <span class="result-value">${c.desc_cclasstrib}</span>
            </div>` : ''}
            <div class="result-row">
                <span class="result-label">CST</span>
                <span class="result-value">${c.cst || '—'}</span>
            </div>
            <div class="result-row">
                <span class="result-label">Tributação</span>
                <span class="result-value">${c.desc_cst || '—'}</span>
            </div>
        </div>
        ${i < classificacoes.length - 1 ? '<div class="classificacao-divider"></div>' : ''}
    `).join('');
    resultCard.style.display = 'block';
}

// =============================================
// Copiar resultado
// =============================================
document.getElementById('btn-copy').addEventListener('click', () => {
    const ncm = document.getElementById('res-ncm').textContent;
    const desc = document.getElementById('res-desc').textContent;
    const items = document.getElementById('classificacoes-container').querySelectorAll('.classificacao-item');
    let text = `NCM: ${ncm} — ${desc}\n`;
    items.forEach((item, i) => {
        const labels = [...item.querySelectorAll('.result-label')].map(l => l.textContent);
        const vals = [...item.querySelectorAll('.result-value')].map(v => v.textContent);
        text += `\n[${i + 1}] ${labels.map((l, j) => `${l}: ${vals[j]}`).join(' | ')}`;
    });
    navigator.clipboard.writeText(text).then(() => {
        const btn = document.getElementById('btn-copy');
        const orig = btn.innerHTML;
        btn.innerHTML = '✓ Copiado!';
        setTimeout(() => btn.innerHTML = orig, 2000);
    });
});

// =============================================
// Aba 3 — Extração de NCMs do PDF
// =============================================
const dropzone = document.getElementById('pdf-dropzone');
const fileInput = document.getElementById('pdf-file-input');
const btnExtract = document.getElementById('btn-pdf-extract');
const fileNameEl = document.getElementById('pdf-file-name');
let selectedFile = null;

// Clique na dropzone abre seletor de arquivo
dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('drag-over'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
dropzone.addEventListener('drop', e => {
    e.preventDefault();
    dropzone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) setFile(file);
});
fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) setFile(fileInput.files[0]);
});

function setFile(file) {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
        showError('Apenas arquivos PDF são aceitos');
        return;
    }
    selectedFile = file;
    dropzone.classList.add('has-file');
    fileNameEl.style.display = 'flex';
    fileNameEl.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
        </svg>
        <span>${file.name}</span>
        <span class="pdf-filesize">${(file.size / 1024 / 1024).toFixed(2)} MB</span>
        <button class="pdf-remove" id="btn-remove-pdf" title="Remover">✕</button>
    `;
    btnExtract.disabled = false;
    document.getElementById('btn-remove-pdf').addEventListener('click', e => {
        e.stopPropagation();
        clearFile();
    });
}

function clearFile() {
    selectedFile = null;
    fileInput.value = '';
    dropzone.classList.remove('has-file');
    fileNameEl.style.display = 'none';
    fileNameEl.innerHTML = '';
    btnExtract.disabled = true;
    pdfResults.style.display = 'none';
}

// Guarda os dados do último resultado para exportações
let pdfData = null;

btnExtract.addEventListener('click', async () => {
    if (!selectedFile) return;
    hideAll();
    showLoading('Analisando PDF e consultando NCMs...');

    const formData = new FormData();
    formData.append('pdf', selectedFile);

    try {
        const res = await fetch(`${API}/pdf/extract`, { method: 'POST', body: formData });
        const data = await res.json();
        showLoading(false);
        if (!res.ok) { showError(data.error || 'Erro ao processar PDF'); return; }
        pdfData = data;
        renderPdfResults(data);
    } catch {
        showLoading(false);
        showError('Erro ao enviar PDF para o servidor.');
    }
});

// Linha da tabela PDF (pode ter múltiplos cClassTrib — expansível)
function renderPdfResults(data) {
    const { results, not_found, total, found, message, text_preview } = data;

    document.getElementById('pdf-results-count').textContent =
        `${total} NCM${total !== 1 ? 's' : ''} identificado${total !== 1 ? 's' : ''} · ${found} na base`;

    const tbody = document.getElementById('pdf-results-tbody');

    if (!results || results.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--text-muted)">
            ${message || 'Nenhum NCM encontrado na base'}
            ${text_preview ? `<details style="margin-top:12px;font-size:11px;text-align:left"><summary style="cursor:pointer;color:var(--accent)">Ver texto extraído do PDF (debug)</summary>
                <pre style="margin-top:8px;padding:8px;background:var(--bg-card2);border-radius:6px;overflow:auto;max-height:180px;white-space:pre-wrap">${text_preview}</pre>
            </details>` : ''}
        </td></tr>`;
        pdfResults.style.display = 'block';
        return;
    }

    // Cada NCM pode ter N classificações — linhas mescladas via rowspan
    let html = '';
    for (const item of results) {
        const cls = item.classificacoes;
        cls.forEach((c, i) => {
            html += `<tr${i === 0 ? ' class="pdf-row-first"' : ''}>`;
            if (i === 0) {
                html += `<td rowspan="${cls.length}" class="pdf-ncm-cell">
                    <span class="ncm-code">${item.ncm}</span>
                </td>
                <td rowspan="${cls.length}" class="pdf-desc-cell">${item.nome_item ? `<strong>${item.nome_item}</strong><br><small style="opacity:.7">${item.descricao || ''}</small>` : (item.descricao || '—')}</td>`;
            }
            html += `
                <td><span class="classtrib-badge">${c.cclasstrib}</span></td>
                <td class="pdf-desc-cclass">${c.desc_cclasstrib || '—'}</td>
                <td>${c.cst || '—'}</td>
                <td>${c.desc_cst || '—'}</td>
            </tr>`;
        });
    }
    tbody.innerHTML = html;

    // NCMs não encontrados na base
    const notFoundEl = document.getElementById('pdf-not-found');
    if (not_found && not_found.length > 0) {
        notFoundEl.style.display = 'block';
        notFoundEl.innerHTML = `<strong>${not_found.length} NCM${not_found.length > 1 ? 's' : ''} não encontrado${not_found.length > 1 ? 's' : ''} na base:</strong>
            <span class="pdf-notfound-list">${not_found.join(', ')}</span>`;
    } else {
        notFoundEl.style.display = 'none';
    }

    pdfResults.style.display = 'block';
}


// =============================================
// Exportar CSV do PDF
// =============================================
document.getElementById('btn-pdf-csv').addEventListener('click', () => {
    if (!pdfData || !pdfData.results || pdfData.results.length === 0) return;

    let csv = 'NCM,Nome na Nota,Descrição NCM,cClassTrib,Desc cClassTrib,CST,Tributação\n';

    for (const item of pdfData.results) {
        for (const c of item.classificacoes) {
            csv += [item.ncm, item.nome_item || '', item.descricao || '',
            c.cclasstrib, c.desc_cclasstrib || '', c.cst || '', c.desc_cst || '']
                .map(v => `"${String(v).replace(/"/g, '""')}"`)
                .join(',') + '\n';
        }
    }

    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ncm-classificacoes.csv';
    a.click();
    URL.revokeObjectURL(url);
});

// =============================================
// Exportar PDF com jsPDF + AutoTable
// =============================================
document.getElementById('btn-pdf-export').addEventListener('click', () => {
    if (!pdfData || !pdfData.results || pdfData.results.length === 0) return;

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

    // Paleta fundo branco
    const accent = [0, 150, 130];      // verde-teal escuro (contrasta no branco)
    const darkText = [30, 30, 30];       // texto principal
    const mutedText = [100, 100, 110];    // texto secundário
    const headerBg = [0, 150, 130];      // cabeçalho da tabela
    const rowAlt = [245, 248, 250];    // linha alternada
    const white = [255, 255, 255];
    const lineClr = [210, 215, 220];

    // Fundo branco total da página
    doc.setFillColor(...white);
    doc.rect(0, 0, 297, 210, 'F');

    // Faixa de cabeçalho colorida
    doc.setFillColor(...accent);
    doc.rect(0, 0, 297, 18, 'F');

    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(255, 255, 255);
    doc.text('ClassPro', 14, 11);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text('Classificação Tributária NCM', 42, 11);

    const fileName = selectedFile ? selectedFile.name : 'PDF';
    const now = new Date().toLocaleString('pt-BR');
    doc.setFontSize(7.5);
    doc.setTextColor(220, 240, 238);
    doc.text(`Arquivo: ${fileName}   |   Gerado em: ${now}`, 14, 16);

    // Resumo abaixo do cabeçalho
    doc.setFontSize(8.5);
    doc.setTextColor(...mutedText);
    doc.text(`${pdfData.total} NCM(s) identificado(s)  ·  ${pdfData.found} encontrado(s) na base tributária`, 14, 25);

    // Uma linha por cClassTrib, repetindo NCM e nome do item
    const tableRows = [];
    for (const item of pdfData.results) {
        for (const c of item.classificacoes) {
            // Linha 1: nome da nota / linha 2: descrição do NCM
            const prodLabel = item.nome_item
                ? item.nome_item + (item.descricao ? '\n(' + item.descricao + ')' : '')
                : (item.descricao || '—');
            tableRows.push([
                item.ncm,
                prodLabel,
                c.cclasstrib,
                c.desc_cclasstrib || '—',
                c.cst || '—',
                c.desc_cst || '—',
            ]);
        }
    }

    doc.autoTable({
        startY: 29,
        head: [['NCM', 'Nome / Descrição do Item', 'cClassTrib', 'Desc. cClassTrib', 'CST', 'Tributação']],
        body: tableRows,
        styles: {
            fontSize: 7.5,
            cellPadding: 3,
            textColor: darkText,
            fillColor: white,
            lineColor: lineClr,
            lineWidth: 0.2,
            overflow: 'linebreak',
        },
        headStyles: {
            fillColor: headerBg,
            textColor: [255, 255, 255],
            fontStyle: 'bold',
            fontSize: 8,
        },
        alternateRowStyles: {
            fillColor: rowAlt,
        },
        columnStyles: {
            0: { cellWidth: 22, fontStyle: 'bold', textColor: accent },
            1: { cellWidth: 65 },
            2: { cellWidth: 22, fontStyle: 'bold', textColor: accent },
            3: { cellWidth: 'auto', overflow: 'linebreak', minCellWidth: 70 },
            4: { cellWidth: 14 },
            5: { cellWidth: 60 },
        },
        margin: { left: 14, right: 14 },
        didDrawPage: (d) => {
            // Rodapé
            doc.setFontSize(7);
            doc.setTextColor(...mutedText);
            doc.text(
                `ClassPro — Dados conforme tabela oficial cClassTrib · Página ${d.pageNumber}`,
                14,
                doc.internal.pageSize.height - 5
            );
        },
    });

    doc.save(`ClassPro-NCM-${new Date().toISOString().slice(0, 10)}.pdf`);
});

// =============================================
// Helpers
// =============================================
function showLoading(msg) {
    if (msg === false) { loading.style.display = 'none'; return; }
    loadingText.textContent = msg || 'Consultando...';
    loading.style.display = 'flex';
}
function showError(msg) { errorMsg.textContent = msg; errorCard.style.display = 'flex'; }
function hideAll() {
    resultCard.style.display = 'none';
    errorCard.style.display = 'none';
    searchResults.style.display = 'none';
    pdfResults.style.display = 'none';
    showLoading(false);
}
function shake(el) {
    el.style.borderColor = 'var(--error)';
    el.style.boxShadow = '0 0 0 3px rgba(248,81,73,0.2)';
    setTimeout(() => { el.style.borderColor = ''; el.style.boxShadow = ''; }, 1500);
    el.focus();
}

// =============================================
// Modal — Detalhes cClassTrib
// =============================================
const modalOverlay = document.getElementById('modal-cclasstrib');
const modalBody = document.getElementById('modal-body');
const modalTitle = document.getElementById('modal-title-text');

document.getElementById('modal-close').addEventListener('click', closeModal);
modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

function closeModal() {
    modalOverlay.style.display = 'none';
    document.body.style.overflow = '';
}

async function openCClassTribModal(code, desc) {
    modalTitle.textContent = `cClassTrib ${code}`;
    modalBody.innerHTML = '<div class="loading-wrap"><div class="spinner"></div><span>Carregando detalhes...</span></div>';
    modalOverlay.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    try {
        const res = await fetch(`${API}/ncm/cclasstrib/${encodeURIComponent(code)}`);
        if (!res.ok) {
            modalBody.innerHTML = `<p style="color:var(--text-muted);text-align:center;padding:24px">
                Nenhum detalhe adicional encontrado para <strong>${code}</strong>.<br>
                <small style="opacity:.6">Verifique se a 2ª aba do arquivo foi importada.</small>
            </p>`;
            return;
        }
        const d = await res.json();
        renderModal(d, desc);
    } catch {
        modalBody.innerHTML = '<p style="color:var(--error);text-align:center;padding:24px">Erro ao carregar detalhes.</p>';
    }
}

function field(label, value, fullWidth = false) {
    const v = value && value !== 'null' ? value : null;
    return `<div class="modal-field${fullWidth ? ' style="grid-column:1/-1"' : ''}">
        <div class="modal-field-label">${label}</div>
        <div class="modal-field-value${v ? '' : ' empty'}">${v || '—'}</div>
    </div>`;
}

function renderModal(d, descFromSearch) {
    const desc = d.desc_cclasstrib || descFromSearch || '—';

    // Chips de documentos aceitos
    const docMap = {
        'NFe': d.nfe, 'NFCe': d.nfce, 'CTe': d.cte, 'CTe OS': d.cte_os,
        'BPe': d.bpe, 'NF3e': d.nf3e, 'NFCom': d.nfcom, 'NFSE': d.nfse,
        'BPe TM': d.bpe_tm, 'BPe TA': d.bpe_ta, 'NFAg': d.nfag,
        'NFSVIA': d.nfsvia, 'NFABI': d.nfabi, 'NFGas': d.nfgas, 'DERE': d.dere,
    };
    const activeChips = Object.entries(docMap)
        .filter(([, v]) => v && v !== 'null' && v !== '0' && v.trim() !== '')
        .map(([k]) => `<span class="doc-chip">${k}</span>`)
        .join('');

    const urlLeg = d.url_legislacao ?
        `<div class="modal-field" style="grid-column:1/-1">
            <div class="modal-field-label">URL da Legislação</div>
            <div class="modal-field-value"><a href="${d.url_legislacao}" target="_blank" rel="noopener">${d.url_legislacao}</a></div>
        </div>` : '';

    modalBody.innerHTML = `
        <div class="modal-section">
            <div class="modal-section-title">Identificação</div>
            <div class="modal-grid">
                ${field('cClassTrib', d.cclasstrib)}
                ${field('Cód. Situação Tributária', d.cod_sit_tributaria)}
                ${field('Tipo de Alíquota', d.tipo_aliquota)}
                ${field('Nº do Anexo', d.numero_anexo)}
                <div class="modal-field" style="grid-column:1/-1">
                    <div class="modal-field-label">Descrição cClassTrib</div>
                    <div class="modal-field-value">${desc}</div>
                </div>
                <div class="modal-field" style="grid-column:1/-1">
                    <div class="modal-field-label">Descrição da Situação Tributária</div>
                    <div class="modal-field-value${d.desc_sit_tributaria ? '' : ' empty'}">${d.desc_sit_tributaria || '—'}</div>
                </div>
            </div>
        </div>

        <div class="modal-section">
            <div class="modal-section-title">Características Tributárias</div>
            <div class="modal-grid">
                ${field('Exige Tributação', d.exige_tributacao)}
                ${field('Redução BC CST', d.reducao_bc_cst)}
                ${field('Redução de Alíquota', d.reducao_aliquota)}
                ${field('Transferência de Crédito', d.transferencia_credito)}
                ${field('Diferimento', d.diferimento)}
                ${field('Monofásica', d.monofasica)}
                ${field('Crédito Presumido IBS (ZFM)', d.credito_presumido_ibs_zfm)}
                ${field('Ajuste de Competência', d.ajuste_competencia)}
                ${field('% Redução IBS', d.perc_reducao_ibs)}
                ${field('% Redução CBS', d.perc_reducao_cbs)}
            </div>
        </div>

        <div class="modal-section">
            <div class="modal-section-title">Modalidades</div>
            <div class="modal-grid">
                ${field('Tributação Regular', d.trib_regular)}
                ${field('Crédito Presumido', d.credito_presumido)}
                ${field('Estorno de Crédito', d.estorno_credito)}
                ${field('Monofásica Normal', d.trib_monofasica_normal)}
                ${field('Monofásica s/ Retenção', d.trib_monofasica_retencao)}
                ${field('Monofásica Retida Ant.', d.trib_monofasica_retida)}
                ${field('Monofásica Combustível', d.trib_monofasica_combustivel)}
            </div>
        </div>

        ${activeChips ? `
        <div class="modal-section">
            <div class="modal-section-title">Tipos de Documento Aceitos</div>
            <div class="doc-chips">${activeChips}</div>
        </div>` : ''}

        ${(urlLeg || d.numero_anexo) ? `
        <div class="modal-section">
            <div class="modal-section-title">Legislação</div>
            <div class="modal-grid">${urlLeg}</div>
        </div>` : ''}
    `;
}

// Delegação de evento global para botões "Ver detalhes"
document.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-ver-detalhes');
    if (!btn) return;
    const code = btn.dataset.code;
    const desc = btn.dataset.desc || '';
    if (code) openCClassTribModal(code, desc);
});
