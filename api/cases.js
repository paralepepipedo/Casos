// api/cases.js
require('dotenv').config();
const express = require('express');
const { google } = require('googleapis');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// --- CONFIGURACIÓN ---
const SPREADSHEET_ID = '1WrIqNjnY6yy9UTiDY2Q1kbMk6Rx1EOnQLq1HSAOkjr8';
const SHEET_NAME = 'BD';

// --- MODIFICACIÓN IMPORTANTE: LEER CREDENCIALES DESDE VARIABLES DE ENTORNO ---
// Esto es más seguro y necesario para Vercel.
let credentials;
try {
    // Vercel inyecta las variables de entorno aquí.
    credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
} catch (error) {
    console.error("Error al parsear GOOGLE_CREDENTIALS:", error);
    // Puedes manejar el error como prefieras. Aquí, el servidor fallará al iniciar, lo cual es informativo.
}

const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: 'https://www.googleapis.com/auth/spreadsheets',
});

const sheets = google.sheets({ version: 'v4', auth });

// --- MANTENEMOS LAS MISMAS RUTAS ---
// GET /api/cases
app.get('/api/cases', async (req, res) => {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!A:ZZ`,
        });

        let rows = response.data.values;
        if (!rows || rows.length === 0) {
            return res.json({ headers: [], cases: [] });
        }

        let headerRowIndex = -1;
        for (let i = 0; i < Math.min(rows.length, 10); i++) {
            const row = rows[i];
            if (row && row.includes('EXPEDIENTE') && row.includes('NOMBRES') && row.includes('RUT')) {
                headerRowIndex = i;
                break;
            }
        }

        if (headerRowIndex === -1) {
            console.error("No se pudo encontrar la fila de encabezados en Google Sheet.");
            return res.json({ headers: [], cases: [] });
        }

        const headers = rows[headerRowIndex].map(h => h ? String(h).trim() : '');
        const dataStartIndex = headerRowIndex + 1;

        const casesData = rows.slice(dataStartIndex).map((row, index) => {
            const caseObject = {};
            headers.forEach((header, i) => {
                caseObject[header] = row[i];
            });
            caseObject.rowIndex = dataStartIndex + index + 1;
            return caseObject;
        });

        res.json({ headers, cases: casesData });

    } catch (error) {
        console.error('Error al leer la Google Sheet:', error);
        res.status(500).json({ message: 'Error al conectar con Google Sheets.', error: error.message });
    }
});

// PUT /api/cases
app.put('/api/cases', async (req, res) => {
    try {
        const { headers, cases } = req.body;
        if (!headers || !cases) {
            return res.status(400).json({ message: 'Faltan headers o cases en la petición.' });
        }

        const dataStartRow = 4;
        const values = cases.map(caso => headers.map(header => caso[header] || null));

        await sheets.spreadsheets.values.clear({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!A${dataStartRow}:ZZ`,
        });

        if (values.length > 0) {
            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `${SHEET_NAME}!A${dataStartRow}`,
                valueInputOption: 'USER_ENTERED',
                resource: { values },
            });
        }

        res.json({ message: 'Hoja de cálculo actualizada con éxito.' });

    } catch (error) {
        console.error('Error detallado al actualizar la Google Sheet:', error);
        res.status(500).json({ message: 'Error al escribir en Google Sheets.', error: error.message });
    }
});

// --- INICIO: AÑADIR ESTA NUEVA RUTA PARA GUARDAR UBICACIONES ---
app.post('/api/location', async (req, res) => {
    const { address, location, caseId } = req.body; // caseId es opcional pero bueno tenerlo

    if (!address || !location || !location.lat || !location.lon) {
        return res.status(400).json({ message: 'Datos de ubicación incompletos.' });
    }

    try {
        const sheetName = 'Ubicaciones'; // El nombre exacto de tu hoja
        
        // --- CORRECCIÓN: AGREGAR TIMESTAMP Y CASEID (5 COLUMNAS) ---
        const values = [[
            new Date().toISOString(), // Fecha y hora automática (columna A)
            address,                  // Dirección completa (columna B)
            location.lat,             // Latitud (columna C)
            location.lon,             // Longitud (columna D)
            caseId || 'N/A'           // ID del caso (columna E)
        ]];

        // --- CORRECCIÓN: CAMBIAR EL RANGO PARA LAS 5 COLUMNAS ---
        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: `${sheetName}!A:E`, // Ahora son 5 columnas (A a E)
            valueInputOption: 'USER_ENTERED',
            resource: {
                values: values,
            },
        });

        res.status(200).json({ message: `Ubicación para "${address.split(',')[0]}" guardada correctamente.` });
    } catch (error) {
        console.error('Error al escribir ubicación en Google Sheet:', error);
        
        // Mensaje más específico según el tipo de error
        let errorMessage = 'Error al guardar la ubicación en Google Sheets.';
        if (error.message.includes('PERMISSION_DENIED')) {
            errorMessage = 'Permiso denegado. Verifica que el email del servicio tenga acceso al Sheet.';
        } else if (error.message.includes('SHEET_NOT_FOUND')) {
            errorMessage = 'No se encontró la hoja "Ubicaciones". Crea una hoja con ese nombre.';
        }
        
        res.status(500).json({ 
            message: errorMessage, 
            error: error.message 
        });
    }
});
// --- FIN: AÑADIR ESTA NUEVA RUTA ---

// --- ELIMINAMOS LA PARTE DE "Servir archivos estáticos" y "app.listen" ---

// --- EXPORTAMOS LA APP PARA VERCEL ---
module.exports = app;
