const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const ffmpeg = require("fluent-ffmpeg");

// 개발 환경에서 Hot Reload 설정
if (process.env.NODE_ENV === "development") {
  try {
    require("electron-reload")(__dirname, {
      electron: path.join(__dirname, "../../node_modules", ".bin", "electron"),
    });
  } catch (err) {
    console.log("Error loading electron-reload:", err);
  }
}

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));

  // 개발 환경에서 개발자 도구 열기
  if (process.env.NODE_ENV === "development") {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.on("ready", createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// 비디오 파일 열기 대화상자
ipcMain.handle("open-file-dialog", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"],
    filters: [{ name: "Videos", extensions: ["mp4", "avi", "mov", "mkv"] }],
  });

  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

// 오디오 추출 함수
ipcMain.handle("extract-audio", async (event, videoPath) => {
  const tempDir = path.join(app.getPath("temp"), "rtracker");

  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const audioPath = path.join(tempDir, "audio.wav");

  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .outputOptions("-ab", "192k")
      .output(audioPath)
      .on("end", () => {
        resolve(audioPath);
      })
      .on("error", (err) => {
        reject(err.message);
      })
      .run();
  });
});

// 벨 소리 감지 및 비디오 분할
ipcMain.handle("process-video", async (event, videoPath, bellTimestamps) => {
  try {
    console.log(`비디오 분할 요청: ${videoPath}`);
    console.log(`타임스탬프: ${bellTimestamps.join(", ")}`);

    const resultsDir = path.join(
      app.getPath("documents"),
      "RTracker",
      "Results",
      path.basename(videoPath, path.extname(videoPath))
    );

    if (!fs.existsSync(resultsDir)) {
      fs.mkdirSync(resultsDir, { recursive: true });
    }

    const segments = [];

    // 타임스탬프가 부족한 경우 처리
    if (!bellTimestamps || bellTimestamps.length < 2) {
      console.log(
        "타임스탬프가 충분하지 않습니다. 전체 영상을 하나의 세그먼트로 처리합니다."
      );
      const outputPath = path.join(
        resultsDir,
        `segment_1${path.extname(videoPath)}`
      );

      await new Promise((resolve, reject) => {
        ffmpeg(videoPath)
          .output(outputPath)
          .on("end", () => {
            // 영상 길이 가져오기
            ffmpeg.ffprobe(videoPath, (err, metadata) => {
              const duration = metadata.format.duration || 0;

              segments.push({
                id: 1,
                path: outputPath,
                startTime: 0,
                endTime: duration,
                duration: duration,
              });
              resolve();
            });
          })
          .on("error", (err) => {
            reject(err.message);
          })
          .run();
      });

      return { segments, outputDir: resultsDir };
    }

    // bellTimestamps를 이용하여 비디오 세그먼트 자르기
    for (let i = 0; i < bellTimestamps.length - 1; i += 2) {
      const startTime = bellTimestamps[i];
      const endTime = bellTimestamps[i + 1];

      // 유효하지 않은 타임스탬프 건너뛰기
      if (isNaN(startTime) || isNaN(endTime) || startTime >= endTime) {
        console.log(
          `유효하지 않은 타임스탬프 쌍 건너뛰기: ${startTime}, ${endTime}`
        );
        continue;
      }

      const duration = endTime - startTime;
      const segmentId = segments.length + 1;
      const outputPath = path.join(
        resultsDir,
        `segment_${segmentId}${path.extname(videoPath)}`
      );

      console.log(
        `세그먼트 ${segmentId} 생성 중: ${startTime}초 ~ ${endTime}초 (${duration}초)`
      );

      await new Promise((resolve, reject) => {
        ffmpeg(videoPath)
          .setStartTime(startTime)
          .setDuration(duration)
          .output(outputPath)
          .on("end", () => {
            segments.push({
              id: segmentId,
              path: outputPath,
              startTime,
              endTime,
              duration,
            });
            resolve();
          })
          .on("error", (err) => {
            console.error(`세그먼트 ${segmentId} 생성 오류:`, err.message);
            reject(err.message);
          })
          .run();
      });
    }

    console.log(`총 ${segments.length}개의 세그먼트 생성 완료`);
    return { segments, outputDir: resultsDir };
  } catch (error) {
    console.error("비디오 분할 처리 중 오류:", error);
    throw error;
  }
});

// 세그먼트 삭제
ipcMain.handle("delete-segment", async (event, segmentPath) => {
  try {
    if (fs.existsSync(segmentPath)) {
      fs.unlinkSync(segmentPath);
      return { success: true };
    }
    return { success: false, error: "File not found" };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// 세그먼트 저장
ipcMain.handle("save-segment", async (event, segmentPath, saveAs) => {
  try {
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: saveAs || path.basename(segmentPath),
      filters: [
        {
          name: "Videos",
          extensions: [path.extname(segmentPath).substring(1)],
        },
      ],
    });

    if (!result.canceled && result.filePath) {
      fs.copyFileSync(segmentPath, result.filePath);
      return { success: true, savedPath: result.filePath };
    }
    return { success: false, error: "Save canceled" };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
