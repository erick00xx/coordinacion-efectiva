// ============================================
// CONFIGURACIÓN
// ============================================

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwOyzv_e8ySQsa_p9jyplmxSOvBKWu811-b2m6eeGezozb0MPq7OjOp_nxi9wj5CHGjBw/exec';
// ↑ Reemplaza TU_URL_AQUI con la URL de tu Web App de Apps Script desplegado

const MAX_IMAGES = 8;
const SEP = ' || '; // Separador para múltiples responsables e imágenes

// ============================================
// VARIABLES GLOBALES
// ============================================

let tareasData = [];         // Cache de todas las tareas
let currentUser = null;      // Nombre del perfil activo (null = admin)
let isAdmin = false;         // true = modo administrador
let usuariosData = [];       // [{nombre, cargo, pass}] desde hoja Responsables
let responsablesData = [];   // Solo los nombres
let _cachedAdminPass = null;
let _tareasCargadas = false;
let taskModal = null;
let quillDesc = null;
let uploadedFiles = [];      // Nuevas imágenes seleccionadas en el form
let existingImages = [];     // URLs de imágenes existentes (modo edición)

const Toast = Swal.mixin({
    toast: true, position: 'top-end',
    showConfirmButton: false, timer: 3000, timerProgressBar: true
});

// ============================================
// INICIALIZACIÓN
// ============================================

$(document).ready(function () {
    taskModal = new bootstrap.Modal('#taskModal');
    initQuill();
    initSelect2();
    initEventListeners();
    loadInitialData();
});

function initQuill() {
    quillDesc = new Quill('#editorDescripcion', {
        theme: 'snow',
        modules: {
            toolbar: [
                ['bold', 'italic', 'underline', 'strike'],
                [{ 'list': 'ordered' }, { 'list': 'bullet' }],
                ['link'],
                ['clean']
            ]
        },
        placeholder: 'Describe la tarea...'
    });
}

function initSelect2() {
    $('#formResponsables').select2({
        theme: 'bootstrap-5',
        placeholder: 'Seleccionar responsables...',
        allowClear: true,
        width: '100%',
        templateResult: formatS2Option,
        templateSelection: formatS2Selection,
        dropdownParent: $('#taskModal')
    });
}

function formatS2Option(state) {
    if (!state.id) return state.text;
    const initials = getInitials(state.text);
    const grad = getAvatarGradient(state.text);
    return $(`<div class="d-flex align-items-center gap-2 px-1">
      <div class="s2-user-avatar" style="background:${grad}">${initials}</div>
      <span class="fw-medium">${escHtml(state.text)}</span>
    </div>`);
}

function formatS2Selection(state) {
    if (!state.id) return state.text;
    const initials = getInitials(state.text);
    const grad = getAvatarGradient(state.text);
    return $(`<div class="d-flex align-items-center gap-1">
      <div class="s2-user-avatar-sm" style="background:${grad}">${initials}</div>
      <span class="small fw-medium">${escHtml(state.text)}</span>
    </div>`);
}

// ============================================
// CARGA INICIAL (con caché - no recarga al cambiar perfil)
// ============================================

async function loadInitialData() {
    showLoading(true);
    try {
        const [rResp, rPass, rTareas] = await Promise.allSettled([
            apiFetch('GET', 'getResponsables'),
            apiFetch('GET', 'getPassword'),
            apiFetch('GET', 'getTareas')
        ]);

        if (rResp.status === 'fulfilled' && rResp.value.success) {
            usuariosData = rResp.value.data || [];
            responsablesData = usuariosData.map(u => u.nombre);
        }
        if (rPass.status === 'fulfilled' && rPass.value.success) {
            _cachedAdminPass = rPass.value.data;
        }
        if (rTareas.status === 'fulfilled' && rTareas.value.success) {
            tareasData = rTareas.value.data || [];
            _tareasCargadas = true;
        }
    } catch (e) {
        console.error('Error carga inicial:', e);
    } finally {
        showLoading(false);
    }
    showLoginScreen();
}

// ============================================
// API HELPER
// ============================================

async function apiFetch(method, action, body = null, attempt = 1) {
    try {
        let resp;
        if (method === 'GET') {
            resp = await fetch(`${APPS_SCRIPT_URL}?action=${action}`);
        } else {
            resp = await fetch(APPS_SCRIPT_URL, {
                method: 'POST',
                body: JSON.stringify({ action, ...body })
            });
        }
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const result = await resp.json();
        if (!result.success && result.message) throw new Error(result.message);
        return result;
    } catch (err) {
        if (attempt < 3 && method === 'GET') {
            await sleep(2000);
            return apiFetch(method, action, body, attempt + 1);
        }
        throw err;
    }
}

// ============================================
// LOGIN / SESIÓN
// ============================================

function showLoginScreen() {
    const cards = responsablesData.map(name => {
        const initials = getInitials(name);
        const grad = getAvatarGradient(name);
        return `<div class="login-perfil-card" onclick="selectProfile('${escHtml(name).replace(/'/g, "\\'")}')">
        <div class="login-perfil-avatar" style="background:${grad}">${initials}</div>
        <div class="login-perfil-name">${escHtml(name)}</div>
      </div>`;
    }).join('');
    $('#loginPerfiles').html(cards);
    $('#loginOverlay').addClass('show');
}

function selectProfile(name) {
    const user = usuariosData.find(u => u.nombre === name);
    const expectedPass = user ? (user.pass || '').toString().trim() : '';
    promptLogin(false, expectedPass, name);
}

async function loginAsAdmin() {
    let adminPass = _cachedAdminPass;
    if (adminPass === null) {
        try {
            const r = await apiFetch('GET', 'getPassword');
            if (r.success) { adminPass = r.data; _cachedAdminPass = adminPass; }
        } catch (e) { adminPass = ''; }
    }
    promptLogin(true, adminPass);
}

async function promptLogin(isAdminRole, expectedPass, userName = null) {
    const title = isAdminRole ? 'Acceso Administrador' : `Acceso: ${userName}`;
    const { value: inputPass } = await Swal.fire({
        title, input: 'password',
        inputPlaceholder: isAdminRole ? 'Contraseña admin' : 'Tu contraseña',
        customClass: { popup: 'swal-login-compact' },
        showCancelButton: true,
        confirmButtonText: 'Ingresar',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#6366f1',
        width: '340px',
        inputAttributes: { autocomplete: 'new-password' }
    });

    if (inputPass === undefined) return; // cancelado

    const passOk = (expectedPass === '' && inputPass === '') || inputPass === expectedPass;
    if (passOk) {
        currentUser = isAdminRole ? null : userName;
        isAdmin = isAdminRole;
        finishLogin();
    } else {
        Swal.fire({ icon: 'error', title: 'Contraseña incorrecta', timer: 1600, showConfirmButton: false, width: '300px' });
    }
}

function finishLogin() {
    $('#loginOverlay').removeClass('show');
    updateNavUser();
    populateResponsableFilter();
    populateFormResponsable();
    if (_tareasCargadas) {
        updateStats();
        applyFilters();
    }
    // No hay recarga: los datos ya están en caché
}

function cambiarPerfil() {
    currentUser = null;
    isAdmin = false;
    $('#navUserInfo').addClass('d-none');
    showLoginScreen();
}

function updateNavUser() {
    if (isAdmin) {
        $('#navUserName').text('Administrador');
        $('#navAdminBadge').removeClass('d-none');
    } else {
        $('#navUserName').text(currentUser);
        $('#navAdminBadge').addClass('d-none');
    }
    $('#navUserInfo').removeClass('d-none');
}

// ============================================
// FILTROS Y RESPONSABLES
// ============================================

function populateResponsableFilter() {
    const $sel = $('#filterResponsible');
    $sel.empty().append('<option value="">Todos</option>');
    responsablesData.forEach(name => {
        $sel.append(`<option value="${escHtml(name)}">${escHtml(name)}</option>`);
    });

    if (!isAdmin && currentUser) {
        $sel.val(currentUser).prop('disabled', true);
        $('#filterResponsibleLabel').html(
            `Mi perfil <i class="fas fa-lock ms-1 filter-lock-icon text-muted" title="Filtro bloqueado a tu perfil"></i>`
        );
    } else {
        $sel.prop('disabled', false).val('');
        $('#filterResponsibleLabel').text('Responsable');
    }
}

function populateFormResponsable() {
    const $sel = $('#formResponsables');
    const $fijo = $('#responsableFijo');
    const $asterisk = $('#respAsterisk');
    const $helpText = $('#respHelpText');

    $sel.empty();
    responsablesData.forEach(name => {
        $sel.append(`<option value="${escHtml(name)}">${escHtml(name)}</option>`);
    });

    if (!isAdmin && currentUser) {
        // Mostrar badge fijo con el perfil del usuario
        const initials = getInitials(currentUser);
        const grad = getAvatarGradient(currentUser);
        $fijo.html(`<div class="d-inline-flex align-items-center gap-1 bg-light border rounded px-2 py-1" style="font-size:.75rem">
        <div class="s2-user-avatar-sm" style="background:${grad}">${initials}</div>
        <span class="fw-semibold text-primary">${escHtml(currentUser)}</span>
      </div>`).removeClass('d-none');
        $asterisk.addClass('d-none');
        $helpText.removeClass('d-none');
    } else {
        $fijo.addClass('d-none').empty();
        $asterisk.removeClass('d-none');
        $helpText.addClass('d-none');
    }
}

// ============================================
// ESTADÍSTICAS
// ============================================

function updateStats(data) {
    const d = data ?? getFilteredData();
    const total = d.length;
    const enP = d.filter(t => t.estado === 'En Proceso').length;
    const term = d.filter(t => t.estado === 'Terminado').length;
    const noT = d.filter(t => t.estado === 'No terminado').length;
    const cum = total > 0 ? Math.round((term / total) * 100) : 0;

    $('#statTotal').text(total);
    $('#statEnProceso').text(enP);
    $('#statCompletadas').text(term);
    $('#statPendientes').text(noT);
    $('#statCumplimiento').text(`${cum}%`);
    $('#statCumplimientoBar').css('width', `${cum}%`);
}

// ============================================
// FILTROS
// ============================================

function getFilteredData() {
    const desde = $('#filterDesde').val();
    const hasta = $('#filterHasta').val();
    const resp = $('#filterResponsible').val();
    const estado = $('#filterEstado').val();
    const search = $('#searchInput').val().toLowerCase();

    return tareasData.filter(t => {
        // Fecha (usa fechaCreacion)
        const fecha = parseDateStr(t.fechaCreacion);
        if (desde && fecha) {
            if (fecha < new Date(desde + 'T00:00:00')) return false;
        }
        if (hasta && fecha) {
            if (fecha > new Date(hasta + 'T23:59:59')) return false;
        }
        // Responsable - buscar si el responsable está en la lista de responsables de la tarea
        if (resp) {
            const resps = t.responsables.split('||').map(r => r.trim());
            if (!resps.some(r => r === resp)) return false;
        }
        // Estado
        if (estado && t.estado !== estado) return false;
        // Búsqueda general
        if (search) {
            const haystack = `${t.titulo} ${t.responsables} ${t.comentarios}`.toLowerCase();
            if (!haystack.includes(search)) return false;
        }
        return true;
    });
}

function applyFilters() {
    const data = getFilteredData();
    updateStats(data);
    renderTable(data);
}

// ============================================
// RENDERIZADO DE TABLA
// ============================================

function renderTable(data) {
    if (!data || data.length === 0) {
        $('#tableContainer').html(`<div class="text-center py-5 text-muted">
        <i class="fas fa-inbox fa-3x mb-3 opacity-25"></i>
        <p>No hay tareas para mostrar.</p>
      </div>`);
        return;
    }

    let html = '<table class="table task-table"><tbody>';

    data.forEach(t => {
        const isOptimistic = t.id && t.id.toString().startsWith('temp-');
        const fechaFmt = formatDateDisplay(t.fechaCreacion);
        const statusClass = 'status-' + (t.estado || '').replace(/\s+/g, '-');
        const statusOptions = ['En Proceso', 'Terminado', 'No terminado']
            .map(s => `<option value="${s}" ${t.estado === s ? 'selected' : ''}>${s}</option>`)
            .join('');

        // Responsables badges
        const respBadges = buildRespBadges(t.responsables);

        // Fecha terminar con color coincidente al estado
        let fechaTerminarHtml = '';
        if (t.fechaTerminar) {
            const dateColorClass = getEstadoColorClass(t.estado);
            fechaTerminarHtml = `<span class="small ${dateColorClass} d-block"><i class="fas fa-calendar-check me-1"></i><span style="opacity:.7;font-weight:400">Entrega:</span> ${formatFechaTerminar(t.fechaTerminar)}</span>`;
        }

        // Imágenes count
        const imgCount = t.capturas ? t.capturas.split('||').filter(u => u.trim()).length : 0;
        const imgBadge = imgCount > 0
            ? `<span class="badge bg-light text-muted border ms-2" title="${imgCount} captura(s)"><i class="fas fa-image me-1"></i>${imgCount}</span>`
            : '';

        html += `
      <tr class="task-row ${isOptimistic ? 'task-optimistic' : ''}" data-id="${t.id}">
        <td style="width:60%">
          <div class="d-flex gap-2 align-items-start">
            <div class="task-avatar flex-shrink-0 mt-1" style="background:${getAvatarGradient(t.responsables.split('||')[0]?.trim() || 'X')}">${getInitials(t.responsables.split('||')[0]?.trim() || 'X')}</div>
            <div>
              <div class="task-title">${escHtml(t.titulo)}${imgBadge}</div>
              <div class="task-meta">Creado: ${fechaFmt}</div>
              ${fechaTerminarHtml}
              <div class="mt-1">${respBadges}</div>
            </div>
          </div>
        </td>
        <td class="text-center" style="width:1%">
          <select class="status-pill ${statusClass}" data-id="${t.id}">
            ${statusOptions}
          </select>
        </td>
        <td style="width:1%; white-space:nowrap">
          <button class="btn btn-sm btn-outline-secondary edit-btn me-1" title="Editar"><i class="fas fa-edit"></i></button>
          <button class="btn btn-sm btn-outline-danger delete-btn" title="Eliminar"><i class="fas fa-trash"></i></button>
        </td>
      </tr>
      <tr class="task-expand-row" data-id="${t.id}">
        <td colspan="3">
          <div class="task-expand-inner">
            ${buildExpandContent(t)}
          </div>
        </td>
      </tr>`;
    });

    html += '</tbody></table>';
    $('#tableContainer').html(html);
}

function buildRespBadges(responsablesStr) {
    if (!responsablesStr) return '<span class="text-muted small">Sin asignar</span>';
    return responsablesStr.split('||').map(r => r.trim()).filter(Boolean).map(name => {
        const grad = getAvatarGradient(name);
        return `<span class="resp-badge">
        <span class="s2-user-avatar-sm" style="background:${grad}">${getInitials(name)}</span>
        ${escHtml(name)}
      </span>`;
    }).join('');
}

function buildExpandContent(t) {
    // Descripción (HTML de Quill)
    const descripHtml = t.descripcion
        ? `<div class="ql-snow"><div class="ql-editor p-0" style="font-size:.9rem">${t.descripcion}</div></div>`
        : '<em class="text-muted small">Sin descripción.</em>';

    // Imágenes
    let imgsHtml = '';
    if (t.capturas) {
        const urls = t.capturas.split('||').map(u => u.trim()).filter(Boolean);
        if (urls.length > 0) {
            imgsHtml = `<h6 class="mt-3 mb-2 fw-semibold" style="font-size:.82rem;text-transform:uppercase;letter-spacing:.4px;color:#64748b">Capturas</h6>
        <div class="detail-attachments">
          ${urls.map(url => `<a href="${escHtml(url)}" target="_blank"><img src="${escHtml(url)}" alt="Captura" loading="lazy"></a>`).join('')}
        </div>`;
        }
    }

    // Comentarios
    const comHtml = t.comentarios
        ? `<p class="mb-0" style="font-size:.9rem">${escHtml(t.comentarios)}</p>`
        : '<em class="text-muted small">Sin comentarios.</em>';

    // Fecha actualización
    const updHtml = t.fechaActualizacion
        ? `<span class="text-muted" style="font-size:.75rem"><i class="fas fa-sync-alt me-1"></i>Actualizado: ${t.fechaActualizacion}</span>`
        : '';

    return `<div class="row g-3">
      <div class="col-md-8">
        <h6 class="mb-2 fw-semibold" style="font-size:.82rem;text-transform:uppercase;letter-spacing:.4px;color:#64748b">Descripción</h6>
        ${descripHtml}
        ${imgsHtml}
      </div>
      <div class="col-md-4">
        <h6 class="mb-2 fw-semibold" style="font-size:.82rem;text-transform:uppercase;letter-spacing:.4px;color:#64748b">Comentarios</h6>
        ${comHtml}
        <div class="mt-3">${updHtml}</div>
      </div>
    </div>`;
}

// ============================================
// EVENT LISTENERS
// ============================================

function initEventListeners() {
    // Login
    $('#btnAdminLogin').on('click', loginAsAdmin);

    // Filtros
    $('#btnFiltrar').on('click', applyFilters);
    $('#btnLimpiar').on('click', () => {
        $('#filterDesde, #filterHasta, #filterEstado').val('');
        $('#searchInput').val('');
        if (isAdmin || !currentUser) {
            $('#filterResponsible').val('');
        }
        applyFilters();
    });
    $('#searchInput').on('input', debounce(applyFilters, 300));

    // Nueva tarea
    $('#btnNuevaTarea').on('click', () => openModal());

    // Guardar tarea
    $('#btnGuardarTarea').on('click', handleFormSubmit);

    // Limpiar form al cerrar modal
    $('#taskModal').on('hidden.bs.modal', clearForm);

    // Tabla: toggle expand row
    $('#tableContainer').on('click', '.task-row', function (e) {
        if ($(e.target).closest('select, button').length) return;
        const id = $(this).data('id');
        const $expRow = $(`.task-expand-row[data-id="${id}"]`);
        const $inner = $expRow.find('.task-expand-inner');

        if ($expRow.hasClass('expanded')) {
            $inner.slideUp(150);
            $expRow.removeClass('expanded');
        } else {
            // Colapsar otras
            $('.task-expand-row.expanded .task-expand-inner').slideUp(150);
            $('.task-expand-row').removeClass('expanded');
            $inner.slideDown(150);
            $expRow.addClass('expanded');
        }
    });

    // Tabla: editar
    $('#tableContainer').on('click', '.edit-btn', function (e) {
        e.stopPropagation();
        const id = $(this).closest('.task-row').data('id');
        openModal(id);
    });

    // Tabla: eliminar
    $('#tableContainer').on('click', '.delete-btn', function (e) {
        e.stopPropagation();
        const id = $(this).closest('.task-row').data('id');
        handleDelete(id);
    });

    // Tabla: cambiar estado inline
    $('#tableContainer').on('change', '.status-pill', async function (e) {
        e.stopPropagation();
        const $sel = $(this);
        const id = $sel.data('id');
        const newEstado = $sel.val();
        const tarea = tareasData.find(t => t.id == id);
        const oldEstado = tarea?.estado;

        $sel.prop('disabled', true);

        // Actualizar clase visual del select pill
        $sel.removeClass('status-En-Proceso status-Terminado status-No-terminado')
            .addClass('status-' + newEstado.replace(/\s+/g, '-'));

        // Actualizar color de la fecha de entrega en la misma fila (inmediato)
        const $row = $(`.task-row[data-id="${id}"]`);
        const $dateSpan = $row.find('.date-en-proceso, .date-terminado, .date-no-terminado');
        $dateSpan.removeClass('date-en-proceso date-terminado date-no-terminado')
            .addClass(getEstadoColorClass(newEstado));

        Toast.fire({ icon: 'info', title: 'Actualizando estado...' });
        try {
            if (!tarea) return;
            const updated = { ...tarea, estado: newEstado };
            await apiFetch('POST', 'updateTarea', { tarea: updated });
            tarea.estado = newEstado;
            tarea.fechaActualizacion = new Date().toLocaleDateString('es-PE');
            Toast.fire({ icon: 'success', title: '¡Estado actualizado!' });
            updateStats();
        } catch (err) {
            // Revertir select
            $sel.val(oldEstado)
                .removeClass('status-' + newEstado.replace(/\s+/g, '-'))
                .addClass('status-' + (oldEstado || '').replace(/\s+/g, '-'));
            // Revertir color de fecha
            $dateSpan.removeClass('date-en-proceso date-terminado date-no-terminado')
                .addClass(getEstadoColorClass(oldEstado));
            Swal.fire('Error', 'No se pudo actualizar el estado.', 'error');
        } finally {
            $sel.prop('disabled', false);
        }
    });

    // Dropzone
    const $dz = $('#image-drop-zone');
    $dz.on('click', () => $('#imageUpload').click());
    $dz.on('dragover', e => { e.preventDefault(); $dz.addClass('is-dragover'); });
    $dz.on('dragleave', () => $dz.removeClass('is-dragover'));
    $dz.on('drop', e => {
        e.preventDefault(); $dz.removeClass('is-dragover');
        handleFileSelection(e.originalEvent.dataTransfer.files);
    });
    $('#imageUpload').on('change', e => handleFileSelection(e.target.files));
    $('#image-preview').on('click', '.remove-btn', function () {
        uploadedFiles.splice(parseInt($(this).data('index')), 1);
        renderPreviews();
    });

    // Pegar imágenes en modal
    $('#taskModal').on('paste', e => {
        if ($(document.activeElement).closest('.ql-editor').length) return;
        const files = Array.from(e.originalEvent.clipboardData.items)
            .filter(item => item.type.startsWith('image'))
            .map(item => item.getAsFile());
        if (files.length) { e.preventDefault(); handleFileSelection(files); }
    });

    // Eliminar imagen existente en edición
    $('#existing-images').on('click', '.remove-existing-btn', function () {
        const url = $(this).data('url');
        existingImages = existingImages.filter(u => u !== url);
        renderExistingImages();
    });
}

// ============================================
// MODAL ABRIR / CERRAR
// ============================================

function openModal(taskId = null) {
    clearForm();
    if (taskId) {
        const t = tareasData.find(t => t.id == taskId); if (!t) return;
        $('#modalTitle').html('<i class="fas fa-edit me-2 text-warning"></i>Editar Tarea');
        $('#formTaskId').val(t.id);
        $('#formTitulo').val(t.titulo);
        quillDesc.root.innerHTML = t.descripcion || '';
        $('#formEstado').val(t.estado);
        $('#formFechaTerminar').val(t.fechaTerminar);
        $('#formComentarios').val(t.comentarios);

        // Responsables
        const resps = t.responsables.split('||').map(r => r.trim()).filter(Boolean);
        if (!isAdmin && currentUser) {
            // No-admin: el usuario está fijo, cargar extras
            const extras = resps.filter(r => r !== currentUser);
            $('#formResponsables').val(extras).trigger('change');
        } else {
            $('#formResponsables').val(resps).trigger('change');
        }

        // Imágenes existentes
        if (t.capturas) {
            existingImages = t.capturas.split('||').map(u => u.trim()).filter(Boolean);
            renderExistingImages();
        }
    } else {
        $('#modalTitle').html('<i class="fas fa-plus me-2 text-primary"></i>Nueva Tarea');
        // Si es perfil no-admin, no preselectar nada extra
    }
    taskModal.show();
}

function clearForm() {
    $('#taskForm')[0].reset();
    $('#formTaskId').val('');
    if (quillDesc) quillDesc.setText('');
    uploadedFiles = []; existingImages = [];
    renderPreviews();
    renderExistingImages();
    $('#imageUpload').val('');
    $('#formResponsables').val(null).trigger('change');
}

// ============================================
// IMÁGENES - VISTA PREVIA
// ============================================

function handleFileSelection(files) {
    const arr = Array.from(files);
    if (uploadedFiles.length + arr.length > MAX_IMAGES) {
        return Swal.fire('Límite excedido', `Máximo ${MAX_IMAGES} imágenes en total.`, 'warning');
    }
    uploadedFiles.push(...arr);
    renderPreviews();
}

function renderPreviews() {
    const $c = $('#image-preview').empty();
    uploadedFiles.forEach((file, i) => {
        const reader = new FileReader();
        reader.onload = e => {
            $c.append(`<div class="preview-image-container">
          <img src="${e.target.result}" class="preview-image" alt="">
          <div class="remove-btn" data-index="${i}">&times;</div>
        </div>`);
        };
        reader.readAsDataURL(file);
    });
}

function renderExistingImages() {
    const $w = $('#existing-images-wrapper');
    const $c = $('#existing-images').empty();
    if (existingImages.length === 0) { $w.hide(); return; }
    $w.show();
    existingImages.forEach(url => {
        $c.append(`<div class="existing-img-container me-2 mb-2">
        <img src="${escHtml(url)}" alt="Captura">
        <button type="button" class="remove-existing-btn" data-url="${escHtml(url)}" title="Quitar"><i class="fas fa-times"></i></button>
      </div>`);
    });
}

// ============================================
// SUBIDA DE IMÁGENES A DRIVE
// ============================================

async function uploadAllImages() {
    if (uploadedFiles.length === 0) return [];
    const urls = [];
    for (const file of uploadedFiles) {
        const base64 = await fileToBase64(file);
        try {
            const r = await apiFetch('POST', 'uploadImage', {
                fileName: file.name,
                base64Data: base64.split(',')[1],
                mimeType: file.type
            });
            if (r.success) urls.push(r.data.url);
        } catch (e) {
            console.warn('No se pudo subir:', file.name, e);
        }
    }
    return urls;
}

function fileToBase64(file) {
    return new Promise((res, rej) => {
        const reader = new FileReader();
        reader.onload = e => res(e.target.result);
        reader.onerror = rej;
        reader.readAsDataURL(file);
    });
}

// ============================================
// GUARDAR TAREA (CREAR / ACTUALIZAR)
// ============================================

async function handleFormSubmit() {
    if (!$('#taskForm')[0].checkValidity()) {
        $('#taskForm').addClass('was-validated');
        return;
    }

    const taskId = $('#formTaskId').val();

    // Construir responsables
    let responsables = [];
    if (!isAdmin && currentUser) {
        responsables.push(currentUser);
    }
    const extras = $('#formResponsables').val() || [];
    extras.forEach(r => { if (!responsables.includes(r)) responsables.push(r); });

    if (responsables.length === 0) {
        return Swal.fire('Atención', 'Debes seleccionar al menos un responsable.', 'warning');
    }

    showModalSpinner(true);

    try {
        // Subir imágenes nuevas
        const newImageUrls = await uploadAllImages();
        const allImageUrls = [...existingImages, ...newImageUrls];
        const capturas = allImageUrls.join(SEP);

        const tarea = {
            titulo: $('#formTitulo').val().trim(),
            descripcion: quillDesc.root.innerHTML,
            responsables: responsables.join(SEP),
            fechaTerminar: $('#formFechaTerminar').val(),
            estado: $('#formEstado').val(),
            comentarios: $('#formComentarios').val().trim(),
            capturas: capturas
        };

        if (taskId) {
            // EDITAR
            const original = tareasData.find(t => t.id == taskId);
            tarea.id = taskId;
            tarea.fechaCreacion = original ? original.fechaCreacion : '';

            const r = await apiFetch('POST', 'updateTarea', { tarea });
            const idx = tareasData.findIndex(t => t.id == taskId);
            if (idx > -1) tareasData[idx] = { ...tareasData[idx], ...tarea, fechaActualizacion: r.data?.fechaActualizacion || '' };

            taskModal.hide();
            Toast.fire({ icon: 'success', title: '¡Tarea actualizada!' });

        } else {
            // CREAR (Optimistic UI)
            const tempId = 'temp-' + Date.now();
            const optimistic = {
                id: tempId,
                fechaCreacion: new Date().toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' }),
                fechaActualizacion: '',
                ...tarea
            };
            tareasData.unshift(optimistic);
            taskModal.hide();
            applyFilters();
            Toast.fire({ icon: 'info', title: 'Agregando tarea...' });

            try {
                const r = await apiFetch('POST', 'createTarea', { tarea });
                const idx = tareasData.findIndex(t => t.id === tempId);
                if (idx > -1) tareasData[idx] = r.data;
                applyFilters();
                Toast.fire({ icon: 'success', title: '¡Tarea agregada!' });
            } catch (err) {
                tareasData = tareasData.filter(t => t.id !== tempId);
                applyFilters();
                Swal.fire('Error', 'No se pudo guardar la tarea.', 'error');
            }
            return; // Modal ya está cerrado
        }

        applyFilters();

    } catch (err) {
        Swal.fire('Error', err.message || 'No se pudo guardar.', 'error');
    } finally {
        showModalSpinner(false);
    }
}

// ============================================
// ELIMINAR TAREA
// ============================================

async function handleDelete(taskId) {
    const result = await Swal.fire({
        title: '¿Eliminar tarea?',
        text: 'Esta acción no se puede revertir.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        confirmButtonText: 'Sí, eliminar',
        cancelButtonText: 'Cancelar'
    });

    if (!result.isConfirmed) return;

    try {
        await apiFetch('POST', 'deleteTarea', { id: taskId });
        tareasData = tareasData.filter(t => t.id != taskId);
        applyFilters();
        Swal.fire({ icon: 'success', title: '¡Eliminada!', timer: 1500, showConfirmButton: false });
    } catch (err) {
        Swal.fire('Error', 'No se pudo eliminar la tarea.', 'error');
    }
}

// ============================================
// UTILIDADES
// ============================================

function showLoading(show) {
    const $ov = $('#loadingOverlay');
    show ? $ov.addClass('show') : $ov.removeClass('show');
}

function showModalSpinner(show) {
    $('#modal-spinner-overlay').css('display', show ? 'flex' : 'none');
}

function getAvatarGradient(name) {
    const gradients = [
        ['#2563eb', '#0ea5e9'], ['#7c3aed', '#a78bfa'], ['#059669', '#34d399'],
        ['#d97706', '#fbbf24'], ['#dc2626', '#f87171'], ['#0891b2', '#38bdf8'],
        ['#db2777', '#f9a8d4'], ['#65a30d', '#a3e635']
    ];
    if (!name) return `linear-gradient(135deg, #94a3b8, #64748b)`;
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash += name.charCodeAt(i);
    const g = gradients[Math.abs(hash) % gradients.length];
    return `linear-gradient(135deg, ${g[0]}, ${g[1]})`;
}

function getInitials(name) {
    if (!name) return '?';
    return name.split(' ').map(w => w[0] || '').join('').substring(0, 2).toUpperCase();
}

function escHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function formatDateDisplay(dateStr) {
    if (!dateStr) return 'Sin fecha';
    // Si ya tiene formato legible (ej "13/3/2026, 14:30") devolver tal cual
    if (dateStr.includes('/')) return dateStr;
    // Si es ISO
    try {
        return new Date(dateStr).toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch (e) { return dateStr; }
}

function parseDateStr(dateStr) {
    if (!dateStr) return null;
    // "d/M/yyyy, HH:mm" → parse
    if (dateStr.includes('/')) {
        const parts = dateStr.split(',')[0].split('/');
        if (parts.length === 3) {
            return new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
        }
    }
    const d = new Date(dateStr);
    return isNaN(d) ? null : d;
}

/**
 * Devuelve la clase CSS de color que coincide con el estado de la tarea
 */
function getEstadoColorClass(estado) {
    if (estado === 'Terminado') return 'date-terminado';
    if (estado === 'No terminado') return 'date-no-terminado';
    return 'date-en-proceso'; // En Proceso o cualquier otro
}

/**
 * Formatea cualquier valor de fecha a "15 mar 2026" (solo fecha, en español, sin hora ni zona horaria)
 */
function formatFechaTerminar(dateStr) {
    if (!dateStr) return '';
    // Si ya viene como "d/M/yyyy, HH:mm" (del backend) tomamos solo la parte de fecha
    let clean = dateStr.toString().split(',')[0].trim();
    // Si está en formato d/M/yyyy convertir a Date
    let d;
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(clean)) {
        const [day, month, year] = clean.split('/');
        d = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    } else {
        // ISO yyyy-MM-dd o cualquier otro
        d = new Date(clean + (clean.includes('T') ? '' : 'T00:00:00'));
    }
    if (isNaN(d)) return dateStr;
    return d.toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' });
}

function getDateClass(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T00:00:00');
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const diff = Math.floor((d - now) / 86400000);
    if (diff < 0) return 'date-overdue';
    if (diff <= 3) return 'date-soon';
    return 'date-ok';
}

function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }

function debounce(fn, delay) {
    let timer;
    return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
    };
}
