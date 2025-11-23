const { app, BrowserWindow, Tray, Menu, ipcMain, Notification } = require('electron');
const path = require('path');

let mainWindow;
let tray;

// true в dev-режиме, false в продакшене (.exe)
const isDev = !app.isPackaged;

// 👉 Укажи свои URL:
const DEV_URL = 'http://localhost:3000';           // локальный сервер
const REMOTE_URL = 'https://poluds-production.up.railway.app';      // сюда задеплоишь backend+frontend

function createMainWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 1000,
        minHeight: 600,
        backgroundColor: '#202225',
        title: 'Discord Clone',
        icon: path.join(__dirname, 'assets', 'icon.png'),
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        }
    });

    const urlToLoad = isDev ? DEV_URL : REMOTE_URL;
    mainWindow.loadURL(urlToLoad);

    if (isDev) {
        mainWindow.webContents.openDevTools();
    }

    // крестик = спрятать в трей
    mainWindow.on('close', (event) => {
        if (!app.isQuiting) {
            event.preventDefault();
            mainWindow.hide();
        }
    });

    // уведомления из фронта
    ipcMain.on('show-notification', (event, { title, body }) => {
        if (Notification.isSupported()) {
            new Notification({
                title,
                body,
                icon: path.join(__dirname, 'assets', 'icon.png')
            }).show();
        }
    });
}

function createTray() {
    const iconPath = path.join(__dirname, 'assets', 'icon.png');
    tray = new Tray(iconPath);

    const contextMenu = Menu.buildFromTemplate([
        {
            label: 'Открыть',
            click: () => {
                if (!mainWindow) createMainWindow();
                mainWindow.show();
            }
        },
        {
            label: 'Выход',
            click: () => {
                app.isQuiting = true;
                app.quit();
            }
        }
    ]);

    tray.setToolTip('Discord Clone');
    tray.setContextMenu(contextMenu);

    // клик по трею = показать/спрятать
    tray.on('click', () => {
        if (mainWindow.isVisible()) mainWindow.hide();
        else mainWindow.show();
    });
}

// ---- ОДНА КОПИЯ ПРИЛОЖЕНИЯ ----
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
        }
    });

    app.whenReady().then(() => {
        createMainWindow();
        createTray();

        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
        });
    });
}

app.on('window-all-closed', (event) => {
    event.preventDefault(); // не закрываем полностью — остаёмся в трее
});

app.on
