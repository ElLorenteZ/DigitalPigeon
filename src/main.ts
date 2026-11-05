import { app, BrowserWindow, ipcMain } from 'electron';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { MongoClient } from 'mongodb';
import {
  mongoClientOptions,
  mongoUri,
  resolveDbConfig,
} from './core/db-config';
import { createDbConnection } from './core/db-connection';
import { registerIpc } from './main/ipc';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

const createWindow = () => {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1100,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      // Explicit, not left to defaults: response bodies are untrusted input
      // (see context/foundation/tech-stack.md, "Electron security model").
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  // Open the DevTools in development only.
  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools();
  }
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Credentials: environment first, then config.json in userData (plan.md, Approach).
  const configPath = path.join(app.getPath('userData'), 'config.json');
  const resolved = resolveDbConfig({
    env: process.env,
    configPath,
    readFile: (p) => readFileSync(p, 'utf8'),
  });
  const connection = createDbConnection({
    connect:
      resolved.kind === 'configured'
        ? () =>
            new MongoClient(
              mongoUri(resolved.config),
              mongoClientOptions,
            ).connect()
        : undefined,
  });
  void connection.start();
  app.on('before-quit', () => {
    connection.stop();
    void connection.client()?.close();
  });

  registerIpc({
    ipcMain,
    db: () =>
      resolved.kind === 'configured'
        ? connection.client()?.db(resolved.config.database)
        : undefined,
    dbStatus: () => ({
      status: connection.status(),
      configPath,
      ...(resolved.kind === 'configured'
        ? { database: resolved.config.database }
        : {
            detail:
              resolved.reason === 'missing'
                ? `Create ${configPath}`
                : resolved.detail,
          }),
    }),
  });

  createWindow();

  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
