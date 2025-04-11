const { app, BrowserWindow, ipcMain, dialog, protocol } = require("electron");
const path = require("path");
const fs = require("fs");

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "renderer/index.html"));
  mainWindow.webContents.openDevTools(); // 개발 중에만 사용, 나중에 제거

  // 로컬 파일 프로토콜 핸들러 등록
  protocol.registerFileProtocol("local-file", (request, callback) => {
    const url = request.url.replace(/^local-file:\/\//, "");
    try {
      return callback(decodeURIComponent(url));
    } catch (error) {
      console.error(error);
      return callback(404);
    }
  });
}

app.whenReady().then(() => {
  createWindow();

  // 로컬 파일 프로토콜 등록
  protocol.registerFileProtocol("local-media", (request, callback) => {
    const filePath = request.url.replace("local-media://", "");
    try {
      return callback({ path: decodeURIComponent(filePath) });
    } catch (error) {
      console.error("파일 프로토콜 오류:", error);
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// 비디오 파일 선택 다이얼로그
ipcMain.handle("select-video", async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ["openFile"],
    filters: [{ name: "Videos", extensions: ["mp4", "mkv", "avi", "mov"] }],
  });

  if (canceled) {
    return null;
  }

  return filePaths[0];
});

// 파일 경로를 로컬 URL로 변환
ipcMain.handle("get-local-file-url", (event, filePath) => {
  if (!filePath) return null;
  return `local-media://${encodeURIComponent(filePath)}`;
});

// 오디오 데이터 가져오기
ipcMain.handle("get-audio-data", (event, filePath) => {
  try {
    const audioBuffer = fs.readFileSync(filePath);
    return audioBuffer.buffer;
  } catch (error) {
    console.error("오디오 데이터 로드 중 오류:", error);
    return null;
  }
});
