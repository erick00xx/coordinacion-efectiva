// El verdadero lenguaje de este archivo es .gs , pero para fines de edición se ha nombrado como .js
// Este archivo es el backend en Google Apps Script para el Sistema de Gestión de Tareas.

// ============================================
// CONFIGURACIÓN
// ============================================

const SPREADSHEET_ID = '11D8eqLQNm4G31xqpeK0wX7VE-OF97eoTHvaBCEFUbBU';
const SHEET_TAREAS = 'Tareas';
const SHEET_RESPONSABLES = 'Responsables';
const SHEET_PASSWORD = 'Password';
const DRIVE_FOLDER_ID = '1g37JKhzQ41HLN1hJ_70puwBv0Ha475ex';

// Separador especial para múltiples responsables e imágenes en una misma celda
const SEP = ' || ';

// Columnas de la hoja "Tareas" (0-indexed):
// A=0 ID, B=1 Creado, C=2 Titulo, D=3 Descripcion, E=4 Responsables,
// F=5 FechaTerminar, G=6 Estado, H=7 FechaActualizacion, I=8 Capturas, J=9 Comentarios

// ============================================
// ENDPOINTS PRINCIPALES
// ============================================

/**
 * Maneja todas las solicitudes GET
 */
function doGet(e) {
    const action = e.parameter.action;
    let response;
    try {
        switch (action) {
            case 'getTareas':
                response = getTareas();
                break;
            case 'getResponsables':
                response = getResponsables();
                break;
            case 'getPassword':
                response = getPassword();
                break;
            default:
                response = { success: false, message: 'Acción GET no válida' };
        }
    } catch (error) {
        response = { success: false, message: error.toString() };
    }
    return ContentService
        .createTextOutput(JSON.stringify(response))
        .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Maneja todas las solicitudes POST
 */
function doPost(e) {
    let response;
    try {
        const data = JSON.parse(e.postData.contents);
        const action = data.action;
        switch (action) {
            case 'createTarea':
                response = createTarea(data.tarea);
                break;
            case 'updateTarea':
                response = updateTarea(data.tarea);
                break;
            case 'deleteTarea':
                response = deleteTarea(data.id);
                break;
            case 'uploadImage':
                response = uploadImage(data.fileName, data.base64Data, data.mimeType);
                break;
            default:
                response = { success: false, message: 'Acción POST no válida' };
        }
    } catch (error) {
        response = { success: false, message: error.toString() };
    }
    return ContentService
        .createTextOutput(JSON.stringify(response))
        .setMimeType(ContentService.MimeType.JSON);
}

// ============================================
// OPERACIONES CRUD - TAREAS
// ============================================

/**
 * Obtiene todas las tareas de la hoja "Tareas"
 */
function getTareas() {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_TAREAS);
    if (!sheet) return { success: false, message: 'Hoja Tareas no encontrada' };

    const data = sheet.getDataRange().getValues();
    const tareas = [];

    // Fila 1 (índice 0) es encabezado, datos desde fila 2 (índice 1)
    for (let i = 1; i < data.length; i++) {
        const row = data[i];
        if (row[0]) { // Solo filas con ID
            tareas.push(rowToTarea(row));
        }
    }

    return { success: true, data: tareas };
}

/**
 * Crea una nueva tarea
 */
function createTarea(tarea) {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_TAREAS);
    if (!sheet) return { success: false, message: 'Hoja Tareas no encontrada' };

    if (!tarea.id) tarea.id = generateId();
    if (!tarea.fechaCreacion) tarea.fechaCreacion = formatDate(new Date());
    tarea.fechaActualizacion = formatDate(new Date());

    const row = tareaToRow(tarea);
    sheet.appendRow(row);

    return { success: true, data: tarea, message: 'Tarea creada exitosamente' };
}

/**
 * Actualiza una tarea existente
 */
function updateTarea(tarea) {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_TAREAS);
    if (!sheet) return { success: false, message: 'Hoja Tareas no encontrada' };

    const data = sheet.getDataRange().getValues();
    let rowIndex = -1;

    for (let i = 1; i < data.length; i++) {
        if (data[i][0].toString() === tarea.id.toString()) {
            rowIndex = i + 1; // +1 porque Sheets usa 1-indexed
            break;
        }
    }

    if (rowIndex === -1) return { success: false, message: 'Tarea no encontrada' };

    tarea.fechaActualizacion = formatDate(new Date());

    // Preservar fecha de creación original
    if (!tarea.fechaCreacion) {
        tarea.fechaCreacion = formatDateValue(data[rowIndex - 1][1]);
    }

    const row = tareaToRow(tarea);
    sheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);

    return { success: true, data: tarea, message: 'Tarea actualizada exitosamente' };
}

/**
 * Elimina una tarea por ID
 */
function deleteTarea(id) {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_TAREAS);
    if (!sheet) return { success: false, message: 'Hoja Tareas no encontrada' };

    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
        if (data[i][0].toString() === id.toString()) {
            sheet.deleteRow(i + 1);
            return { success: true, message: 'Tarea eliminada exitosamente' };
        }
    }
    return { success: false, message: 'Tarea no encontrada' };
}

// ============================================
// GESTIÓN DE ARCHIVOS (GOOGLE DRIVE)
// ============================================

/**
 * Sube un archivo a Google Drive y retorna la URL thumbnail
 */
function uploadImage(fileName, base64Data, mimeType) {
    try {
        const folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);

        const now = new Date();
        const datePart = Utilities.formatDate(now, 'America/Lima', 'yyyyMMdd_HHmm');
        const uniqueId = Math.random().toString(36).substring(2, 7).toUpperCase();
        const safeOrig = fileName.replace(/[^a-zA-Z0-9._\-]/g, '_');
        const finalName = `${datePart}_${uniqueId}_${safeOrig}`;

        const decoded = Utilities.base64Decode(base64Data);
        const blob = Utilities.newBlob(decoded, mimeType, finalName);
        const file = folder.createFile(blob);

        try {
            file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        } catch (e) {
            Logger.log('Set sharing failed: ' + e.toString());
        }

        const fileId = file.getId();
        const thumbnailUrl = `https://drive.google.com/thumbnail?id=${fileId}&sz=w800`;
        const viewUrl = `https://drive.google.com/file/d/${fileId}/view`;

        return {
            success: true,
            data: {
                fileId: fileId,
                fileName: finalName,
                url: thumbnailUrl,
                viewUrl: viewUrl
            }
        };
    } catch (error) {
        return { success: false, message: error.toString() };
    }
}

// ============================================
// RESPONSABLES Y CONTRASEÑA
// ============================================

/**
 * Lee la hoja "Responsables" y devuelve los perfiles con contraseña
 */
function getResponsables() {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_RESPONSABLES);
    if (!sheet) return { success: false, message: 'Hoja Responsables no encontrada' };

    const data = sheet.getDataRange().getValues();
    const perfiles = [];

    // Encabezados: Nombre | Cargo | Correo | Pass
    for (let i = 1; i < data.length; i++) {
        const nombre = (data[i][0] || '').toString().trim();
        const cargo = (data[i][1] || '').toString().trim();
        const pass = (data[i][3] || '').toString().trim();
        if (nombre) {
            perfiles.push({ nombre, cargo, pass });
        }
    }

    return { success: true, data: perfiles };
}

/**
 * Lee la contraseña de administrador desde la hoja "Password", celda A1
 */
function getPassword() {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_PASSWORD);
    if (!sheet) return { success: false, message: 'Hoja Password no encontrada' };

    const pass = (sheet.getRange('A1').getValue() || '').toString().trim();
    return { success: true, data: pass };
}

// ============================================
// FUNCIONES AUXILIARES
// ============================================

/**
 * Convierte una fila del sheet a objeto tarea
 * Columnas: A=ID, B=Creado, C=Titulo, D=Descripcion, E=Responsables,
 *           F=FechaTerminar, G=Estado, H=FechaActualizacion, I=Capturas, J=Comentarios
 */
function rowToTarea(row) {
    return {
        id: row[0] ? row[0].toString() : '',
        fechaCreacion: formatDateValue(row[1]),
        titulo: row[2] ? row[2].toString() : '',
        descripcion: row[3] ? row[3].toString() : '',
        responsables: row[4] ? row[4].toString() : '',
        fechaTerminar: formatDateOnly(row[5]),   // Solo fecha sin hora
        estado: row[6] ? row[6].toString() : 'En Proceso',
        fechaActualizacion: formatDateValue(row[7]),
        capturas: row[8] ? row[8].toString() : '',
        comentarios: row[9] ? row[9].toString() : ''
    };
}

/**
 * Convierte un objeto tarea a fila del sheet
 */
function tareaToRow(tarea) {
    return [
        tarea.id || '',
        tarea.fechaCreacion || '',
        tarea.titulo || '',
        tarea.descripcion || '',
        tarea.responsables || '',      // "Ana || Pedro"
        tarea.fechaTerminar || '',
        tarea.estado || 'En Proceso',
        tarea.fechaActualizacion || '',
        tarea.capturas || '',          // "url1 || url2"
        tarea.comentarios || ''
    ];
}

/**
 * Genera un ID único numérico
 */
function generateId() {
    return Math.floor(100000000 + Math.random() * 900000000).toString();
}

/**
 * Formatea una fecha con hora en zona horaria de Perú
 */
function formatDate(date) {
    return Utilities.formatDate(date, 'America/Lima', 'd/M/yyyy, HH:mm');
}

/**
 * Convierte valor de celda (Date o string) a formato de fecha legible CON hora
 */
function formatDateValue(value) {
    if (!value) return '';
    if (value instanceof Date) return formatDate(value);
    return value.toString();
}

/**
 * Convierte valor de celda a SOLO FECHA sin hora (d/M/yyyy)
 * Evita el .toString() nativo de Date que incluye zona horaria
 */
function formatDateOnly(value) {
    if (!value) return '';
    if (value instanceof Date) {
        return Utilities.formatDate(value, 'America/Lima', 'd/M/yyyy');
    }
    // Si ya es string, quitar parte de hora si existe
    const str = value.toString().split(',')[0].trim();
    return str;
}

// ============================================
// TESTING (Ejecutar desde el editor de Apps Script)
// ============================================

function testGetTareas() {
    const result = getTareas();
    Logger.log(JSON.stringify(result, null, 2));
}

function testGetResponsables() {
    const result = getResponsables();
    Logger.log(JSON.stringify(result, null, 2));
}

function testCreateTarea() {
    const tarea = {
        titulo: 'Tarea de prueba',
        descripcion: '<p>Esta es una descripción de prueba</p>',
        responsables: 'Ana || Pedro',
        fechaTerminar: '2026-03-31',
        estado: 'En Proceso',
        capturas: '',
        comentarios: 'Comentario inicial'
    };
    const result = createTarea(tarea);
    Logger.log(JSON.stringify(result, null, 2));
}
