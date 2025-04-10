const { ipcRenderer } = require("electron");
const path = require("path");
const fs = require("fs");
const audioAnalyzer = require("../utils/audioAnalyzer");

// DOM 요소
const uploadArea = document.getElementById("uploadArea");
const uploadButton = document.getElementById("uploadButton");
const videoPlayer = document.getElementById("videoPlayer");
const videoContainer = document.getElementById("videoContainer");
const waveformContainer = document.getElementById("waveformContainer");
const waveformEl = document.getElementById("waveform");
const analyzeButton = document.getElementById("analyzeButton");
const processButton = document.getElementById("processButton");
const segmentsList = document.getElementById("segmentsList");
const segmentsContainer = document.getElementById("segmentsContainer");
const loadingOverlay = document.getElementById("loadingOverlay");
const loadingText = document.getElementById("loadingText");
const amplitudeThresholdInput = document.getElementById("amplitudeThreshold");
const amplitudeThresholdValue = document.getElementById(
  "amplitudeThresholdValue"
);
const minBellIntervalInput = document.getElementById("minBellInterval");

// 상태 관리
let currentVideoPath = null;
let audioPath = null;
let waveformData = null;
let bellTimestamps = [];
let videoSegments = [];
let isAnalyzing = false;
let debugInfo = null;

// 초기화
window.addEventListener("DOMContentLoaded", () => {
  waveformContainer.style.display = "none";
  segmentsContainer.style.display = "none";

  // 이벤트 리스너 설정
  setupEventListeners();

  // 초기 설정값 표시
  amplitudeThresholdValue.textContent = amplitudeThresholdInput.value;

  // 설정 컨트롤 영역에 자동 최적화 버튼 추가
  addOptimizeButton();
});

// 자동 최적화 버튼 추가
function addOptimizeButton() {
  const controlsDiv = document.querySelector(".detection-settings");
  if (!controlsDiv) return;

  const optimizeButtonContainer = document.createElement("div");
  optimizeButtonContainer.className = "form-group";
  optimizeButtonContainer.innerHTML = `
    <button id="optimizeButton" class="btn btn-secondary" disabled>자동 설정 최적화</button>
    <span id="optimizeHint" style="display: block; margin-top: 5px; font-size: 0.8rem; color: #666;">
      오디오 특성을 분석하여 최적의 설정값을 찾습니다
    </span>
  `;

  controlsDiv.appendChild(optimizeButtonContainer);

  // 최적화 버튼 이벤트 리스너
  document
    .getElementById("optimizeButton")
    .addEventListener("click", async () => {
      if (!waveformData || isAnalyzing) return;

      try {
        isAnalyzing = true;
        showLoading("설정 최적화 중...");

        // 오디오 분석기의 최적화 함수 호출
        const optimizedOptions =
          audioAnalyzer.optimizeDetectionSettings(waveformData);

        // UI 업데이트
        amplitudeThresholdInput.value =
          optimizedOptions.amplitudeThreshold.toFixed(2);
        amplitudeThresholdValue.textContent = amplitudeThresholdInput.value;

        minBellIntervalInput.value = optimizedOptions.minBellInterval;

        hideLoading();
        isAnalyzing = false;

        // 안내 메시지
        alert(
          `설정이 자동 최적화되었습니다.\n임계값: ${optimizedOptions.amplitudeThreshold.toFixed(
            2
          )}\n최소 간격: ${optimizedOptions.minBellInterval}초`
        );
      } catch (error) {
        hideLoading();
        isAnalyzing = false;
        alert("설정 최적화 중 오류가 발생했습니다: " + error.message);
        console.error(error);
      }
    });
}

function setupEventListeners() {
  // 파일 업로드 이벤트
  uploadArea.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.stopPropagation();
    uploadArea.classList.add("active");
  });

  uploadArea.addEventListener("dragleave", (e) => {
    e.preventDefault();
    e.stopPropagation();
    uploadArea.classList.remove("active");
  });

  uploadArea.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();
    uploadArea.classList.remove("active");

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      if (isVideoFile(file.path)) {
        loadVideo(file.path);
      } else {
        alert("유효한 비디오 파일만 업로드할 수 있습니다.");
      }
    }
  });

  uploadButton.addEventListener("click", async () => {
    const filePath = await ipcRenderer.invoke("open-file-dialog");
    if (filePath) {
      loadVideo(filePath);
    }
  });

  // 감지 설정 이벤트
  amplitudeThresholdInput.addEventListener("input", () => {
    amplitudeThresholdValue.textContent = amplitudeThresholdInput.value;
  });

  // 분석 버튼 이벤트
  analyzeButton.addEventListener("click", async () => {
    if (!currentVideoPath || isAnalyzing) return;

    try {
      isAnalyzing = true;
      showLoading("오디오 분석 준비 중...");

      if (!audioPath) {
        audioPath = await extractAudio(currentVideoPath);
      }

      // 파형 데이터 처리
      try {
        updateLoadingMessage("오디오 파일 읽는 중...");

        // 분석 로그 표시를 위한 콘솔 프록시
        const originalConsoleLog = console.log;
        console.log = function () {
          const args = Array.from(arguments).join(" ");
          updateLoadingMessage(args);
          originalConsoleLog.apply(console, arguments);
        };

        // 파일 크기 확인 및 경고
        const fileStat = fs.statSync(audioPath);
        const fileSizeMB = fileStat.size / (1024 * 1024);

        if (fileSizeMB > 50) {
          updateLoadingMessage(
            `큰 파일 (${fileSizeMB.toFixed(
              2
            )} MB) 처리 중. 다소 시간이 걸릴 수 있습니다...`
          );
        }

        if (!waveformData) {
          waveformData = await audioAnalyzer.getWaveformData(audioPath);
          // 최적화 버튼 활성화
          document.getElementById("optimizeButton").disabled = false;
        }

        // 사용자 설정 가져오기
        const customOptions = {
          amplitudeThreshold: parseFloat(amplitudeThresholdInput.value),
          minBellInterval: parseInt(minBellIntervalInput.value),
        };

        // 벨 소리 감지
        bellTimestamps = audioAnalyzer.detectBellSounds(
          waveformData,
          customOptions
        );

        // 디버그 정보 저장
        debugInfo = audioAnalyzer.getDebugInfo();

        // 콘솔 원래대로 복원
        console.log = originalConsoleLog;

        // 분석 결과 마크 표시 (파형에 벨 소리 지점 표시)
        displayWaveformMarkers(bellTimestamps, debugInfo);

        // 영상 분할 버튼 활성화
        processButton.disabled = bellTimestamps.length === 0;

        hideLoading();
        isAnalyzing = false;

        if (bellTimestamps.length === 0) {
          if (debugInfo && debugInfo.candidateBells.length > 0) {
            // 후보는 있지만 조건에 맞지 않아 거부된 경우
            const suggestedThreshold = Math.max(
              0.05,
              debugInfo.candidateBells.reduce(
                (min, b) => Math.min(min, b.peakAmplitude),
                1
              ) * 0.9
            ).toFixed(2);

            const result = confirm(
              `벨 소리가 감지되지 않았습니다. 후보 벨 소리가 ${debugInfo.candidateBells.length}개 있지만 조건에 맞지 않아 제외되었습니다.\n\n임계값을 ${suggestedThreshold}로 낮추고 다시 시도할까요?`
            );

            if (result) {
              amplitudeThresholdInput.value = suggestedThreshold;
              amplitudeThresholdValue.textContent = suggestedThreshold;
              analyzeButton.click(); // 자동으로 다시 분석
            }
          } else {
            alert(
              "벨 소리가 감지되지 않았습니다. 임계값을 낮추고 다시 시도해보세요."
            );
          }
        } else {
          alert(`${bellTimestamps.length}개의 벨 소리가 감지되었습니다.`);
        }
      } catch (error) {
        console.error("파형 분석 중 오류:", error);
        hideLoading();
        isAnalyzing = false;
        alert(`파형 분석 중 오류가 발생했습니다: ${error.message}`);
      }
    } catch (error) {
      hideLoading();
      isAnalyzing = false;
      alert("오디오 분석 중 오류가 발생했습니다: " + error.message);
      console.error(error);
    }
  });

  // 영상 분할 버튼 이벤트
  processButton.addEventListener("click", async () => {
    if (!currentVideoPath || bellTimestamps.length === 0) return;

    try {
      showLoading("영상 분할 중...");

      // 첫 번째와 마지막 타임스탬프 추가 (영상 시작과 끝)
      const allTimestamps = [0, ...bellTimestamps];

      // 영상 분할 처리
      updateLoadingMessage(
        "FFmpeg로 영상 분할 중... (분할 수에 따라 시간이 걸릴 수 있습니다)"
      );
      const result = await ipcRenderer.invoke(
        "process-video",
        currentVideoPath,
        allTimestamps
      );
      videoSegments = result.segments;

      // 분할된 영상 목록 표시
      displaySegments(videoSegments);

      segmentsContainer.style.display = "block";
      hideLoading();
    } catch (error) {
      hideLoading();
      alert("영상 분할 중 오류가 발생했습니다: " + error.message);
      console.error(error);
    }
  });
}

// 비디오 로드 함수
async function loadVideo(filePath) {
  try {
    currentVideoPath = filePath;

    // 비디오 요소 업데이트
    videoPlayer.src = `file://${filePath}`;
    videoPlayer.style.display = "block";
    uploadArea.style.display = "none";

    // 비디오 정보 가져오기
    const filename = path.basename(filePath);
    const fileSize = fs.statSync(filePath).size;
    const fileSizeMB = (fileSize / (1024 * 1024)).toFixed(2);

    // 이전 분석 데이터 초기화
    waveformData = null;
    bellTimestamps = [];
    debugInfo = null;

    // 오디오 추출
    showLoading(`오디오 추출 중... (${filename}, ${fileSizeMB} MB)`);
    audioPath = await extractAudio(filePath);

    // 파형 표시
    waveformContainer.style.display = "block";

    // 간단한 파형 시각화
    try {
      const audioFileSize = fs.statSync(audioPath).size;
      const audioFileSizeMB = (audioFileSize / (1024 * 1024)).toFixed(2);

      waveformEl.innerHTML = `<div class="waveform-placeholder">
        <h3>오디오 추출 완료</h3>
        <p>파일명: ${filename}</p>
        <p>비디오 크기: ${fileSizeMB} MB</p>
        <p>오디오 크기: ${audioFileSizeMB} MB</p>
        <p>'벨 소리 감지' 버튼을 클릭하여 분석을 시작하세요</p>
        <p class="note">${
          audioFileSizeMB > 30
            ? "⚠️ 큰 파일은 분석 시간이 오래 걸릴 수 있습니다."
            : ""
        }</p>
      </div>`;
    } catch (error) {
      console.error("파형 시각화 초기화 오류:", error);
    }

    // 분석 버튼 활성화
    analyzeButton.disabled = false;

    // 최적화 버튼 비활성화 (아직 waveformData가 없음)
    const optimizeButton = document.getElementById("optimizeButton");
    if (optimizeButton) optimizeButton.disabled = true;

    hideLoading();
  } catch (error) {
    hideLoading();
    alert("비디오 로드 중 오류가 발생했습니다: " + error.message);
    console.error(error);
  }
}

// 오디오 추출 함수
async function extractAudio(videoPath) {
  return await ipcRenderer.invoke("extract-audio", videoPath);
}

// 파형에 벨 소리 마커 표시 함수
function displayWaveformMarkers(timestamps, debug = null) {
  if (!waveformData) return;

  // 파형 컨테이너 표시
  waveformContainer.style.display = "block";

  // 파형 컨테이너 초기화
  waveformEl.innerHTML = "";

  // 캔버스 크기 설정
  const containerWidth = waveformEl.offsetWidth;
  const containerHeight = 200;

  // 메인 파형 캔버스 생성
  const waveformCanvas = document.createElement("canvas");
  waveformCanvas.width = containerWidth;
  waveformCanvas.height = containerHeight;
  waveformCanvas.className = "waveform-canvas";
  waveformEl.appendChild(waveformCanvas);

  // 주파수 스펙트럼 캔버스 (추가 분석 시각화)
  const spectrumCanvas = document.createElement("canvas");
  spectrumCanvas.width = containerWidth;
  spectrumCanvas.height = 100;
  spectrumCanvas.className = "spectrum-canvas";
  waveformEl.appendChild(spectrumCanvas);

  // 파형 그리기
  drawWaveform(waveformCanvas, waveformData);

  // 디버그 정보가 있을 경우 주파수 스펙트럼 그리기
  if (debug && debug.frequencyData && debug.frequencyData.length > 0) {
    drawFrequencySpectrum(spectrumCanvas, debug.frequencyData);
  } else {
    spectrumCanvas.style.display = "none";
  }

  // 감지된 벨 소리에 마커 추가
  if (timestamps && timestamps.length > 0) {
    addWaveformMarkers(waveformEl, timestamps, waveformData, containerWidth);

    // 거부된 후보 벨 소리 표시 (디버깅 용도)
    if (debug && debug.rejectedBells && debug.rejectedBells.length > 0) {
      addRejectedBellMarkers(
        waveformEl,
        debug.rejectedBells,
        waveformData,
        containerWidth
      );
    }
  }

  // 파형 영역에 타임라인 스케일 추가
  addTimelineScale(waveformEl, waveformData, containerWidth);

  // 타임라인 상호작용 설정 (클릭 및 마커 호버 등)
  setupTimelineInteractions();
}

/**
 * 오디오 파형 그리기
 * @param {HTMLCanvasElement} canvas 파형을 그릴 캔버스
 * @param {Object} waveformData 파형 데이터
 */
function drawWaveform(canvas, waveformData) {
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const channel = waveformData.channel(0);
  const length = Math.min(channel.length, width * 2);

  // 그리기를 위한 스케일 계산
  const xScale = width / length;
  const yScale = height / 2;

  // 배경 그리기
  ctx.fillStyle = "#f5f5f5";
  ctx.fillRect(0, 0, width, height);

  // 격자 그리기
  ctx.strokeStyle = "#e0e0e0";
  ctx.lineWidth = 1;

  // 가로 격자
  for (let i = 0; i < height; i += 20) {
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(width, i);
    ctx.stroke();
  }

  // 세로 격자 (1초 간격)
  const secondWidth = waveformData.sample_rate / waveformData.samples_per_pixel;
  for (let i = 0; i < width; i += secondWidth * xScale) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, height);
    ctx.stroke();
  }

  // 중앙선 그리기
  ctx.beginPath();
  ctx.strokeStyle = "#999";
  ctx.lineWidth = 1;
  ctx.moveTo(0, height / 2);
  ctx.lineTo(width, height / 2);
  ctx.stroke();

  // 파형 그리기
  ctx.beginPath();
  ctx.strokeStyle = "#3498db";
  ctx.lineWidth = 1;

  // 최대 진폭 값 먼저 그리기
  for (let i = 0; i < length; i++) {
    const x = i * xScale;
    const y = height / 2 - channel.max_sample(i) * yScale;

    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }

  // 최소 진폭 값 역순으로 그리기 (닫힌 영역을 만들기 위해)
  for (let i = length - 1; i >= 0; i--) {
    const x = i * xScale;
    const y = height / 2 - channel.min_sample(i) * yScale;
    ctx.lineTo(x, y);
  }

  // 채우기
  ctx.closePath();
  ctx.fillStyle = "rgba(52, 152, 219, 0.2)";
  ctx.fill();

  // 테두리 그리기
  ctx.stroke();

  // 임계값 선 그리기
  const threshold = parseFloat(amplitudeThresholdInput.value);
  ctx.beginPath();
  ctx.strokeStyle = "rgba(231, 76, 60, 0.7)";
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 3]);
  ctx.moveTo(0, height / 2 - threshold * yScale);
  ctx.lineTo(width, height / 2 - threshold * yScale);
  ctx.stroke();
  ctx.moveTo(0, height / 2 + threshold * yScale);
  ctx.lineTo(width, height / 2 + threshold * yScale);
  ctx.stroke();
  ctx.setLineDash([]);
}

/**
 * 주파수 스펙트럼 그리기 (디버깅용)
 * @param {HTMLCanvasElement} canvas 그릴 캔버스
 * @param {Array} frequencyData 주파수 데이터 (벨 소리 후보 부근의 FFT 데이터)
 */
function drawFrequencySpectrum(canvas, frequencyData) {
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;

  // 가장 최근의 주파수 데이터만 사용 (대표 샘플)
  const sampleData = frequencyData[frequencyData.length - 1];
  if (!sampleData || !sampleData.spectrum) return;

  const spectrum = sampleData.spectrum;
  const sampleRate = sampleData.sampleRate || 44100;

  // 배경 그리기
  ctx.fillStyle = "#f9f9f9";
  ctx.fillRect(0, 0, width, height);

  // 타이틀 텍스트
  ctx.fillStyle = "#333";
  ctx.font = "12px Arial";
  ctx.fillText("주파수 스펙트럼 분석 (벨 소리 후보)", 10, 15);

  // 스펙트럼 데이터 그리기
  const barWidth = width / spectrum.length;

  // 최대값 찾기 (정규화용)
  const maxMagnitude = Math.max(...spectrum.map((v) => v.magnitude));

  // 막대 그래프로 표시
  for (let i = 0; i < spectrum.length; i++) {
    const barHeight = (spectrum[i].magnitude / maxMagnitude) * (height - 30);
    const freq = spectrum[i].frequency;

    // 복싱 벨 소리 주파수 범위 강조 (800-1200Hz)
    if (freq >= 800 && freq <= 1200) {
      ctx.fillStyle = "rgba(231, 76, 60, 0.7)";
    } else {
      ctx.fillStyle = "rgba(52, 152, 219, 0.5)";
    }

    ctx.fillRect(
      i * barWidth,
      height - barHeight - 20,
      barWidth - 1,
      barHeight
    );

    // 주요 주파수 레이블 표시 (200Hz 간격)
    if (i % 10 === 0) {
      ctx.fillStyle = "#666";
      ctx.font = "10px Arial";
      ctx.fillText(`${Math.round(freq)}Hz`, i * barWidth, height - 5);
    }
  }

  // 복싱 벨 소리 주파수 범위 표시
  ctx.strokeStyle = "rgba(231, 76, 60, 0.7)";
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 3]);

  // 800Hz와 1200Hz 지점 찾기
  const idx800 = spectrum.findIndex((s) => s.frequency >= 800);
  const idx1200 = spectrum.findIndex((s) => s.frequency >= 1200);

  if (idx800 >= 0 && idx1200 >= 0) {
    ctx.beginPath();
    ctx.moveTo(idx800 * barWidth, 20);
    ctx.lineTo(idx800 * barWidth, height - 20);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(idx1200 * barWidth, 20);
    ctx.lineTo(idx1200 * barWidth, height - 20);
    ctx.stroke();

    // 범위 레이블
    ctx.fillStyle = "rgba(231, 76, 60, 0.7)";
    ctx.font = "10px Arial";
    ctx.fillText(
      "벨 소리 주파수 범위",
      ((idx800 + idx1200) / 2) * barWidth - 50,
      35
    );
  }

  ctx.setLineDash([]);
}

/**
 * 파형에 벨 소리 마커 추가
 * @param {HTMLElement} container 마커를 추가할 컨테이너
 * @param {Array} timestamps 벨 소리 타임스탬프 배열
 * @param {Object} waveformData 파형 데이터
 * @param {number} containerWidth 컨테이너 너비
 */
function addWaveformMarkers(
  container,
  timestamps,
  waveformData,
  containerWidth
) {
  const totalDuration =
    (waveformData.length / waveformData.sample_rate) *
    waveformData.samples_per_pixel;

  timestamps.forEach((timestamp, index) => {
    const marker = document.createElement("div");
    marker.className = "bell-marker";
    marker.style.left = `${(timestamp / totalDuration) * 100}%`;

    // 툴팁 정보 추가
    marker.setAttribute("data-timestamp", timestamp);
    marker.setAttribute("data-index", index + 1);
    marker.title = `벨 #${index + 1}: ${formatTime(timestamp)}`;

    // 마커 클릭 시 해당 위치로 이동
    marker.addEventListener("click", () => {
      jumpToTime(timestamp);
    });

    container.appendChild(marker);
  });
}

/**
 * 거부된 벨 소리 후보 마커 추가 (디버깅용)
 * @param {HTMLElement} container 마커를 추가할 컨테이너
 * @param {Array} rejectedBells 거부된 벨 소리 후보 배열
 * @param {Object} waveformData 파형 데이터
 * @param {number} containerWidth 컨테이너 너비
 */
function addRejectedBellMarkers(
  container,
  rejectedBells,
  waveformData,
  containerWidth
) {
  const totalDuration =
    (waveformData.length / waveformData.sample_rate) *
    waveformData.samples_per_pixel;

  rejectedBells.forEach((bell, index) => {
    const marker = document.createElement("div");
    marker.className = "rejected-bell-marker";
    marker.style.left = `${(bell.timestamp / totalDuration) * 100}%`;

    // 툴팁 정보 추가 (거부 이유 포함)
    marker.setAttribute("data-timestamp", bell.timestamp);
    marker.setAttribute("data-amplitude", bell.peakAmplitude);
    marker.setAttribute("data-reason", bell.rejectionReason || "알 수 없음");
    marker.title = `거부된 후보 #${index + 1}: ${formatTime(
      bell.timestamp
    )}\n진폭: ${bell.peakAmplitude.toFixed(2)}\n거부 사유: ${
      bell.rejectionReason || "알 수 없음"
    }`;

    // 마커 클릭 시 해당 위치로 이동
    marker.addEventListener("click", () => {
      jumpToTime(bell.timestamp);
    });

    container.appendChild(marker);
  });
}

/**
 * 타임라인 스케일 추가
 * @param {HTMLElement} container 스케일을 추가할 컨테이너
 * @param {Object} waveformData 파형 데이터
 * @param {number} containerWidth 컨테이너 너비
 */
function addTimelineScale(container, waveformData, containerWidth) {
  const totalDuration =
    (waveformData.length / waveformData.sample_rate) *
    waveformData.samples_per_pixel;
  const scaleEl = document.createElement("div");
  scaleEl.className = "timeline-scale";

  // 15초 간격으로 타임스탬프 표시
  const interval = 15; // 초 단위
  const numMarkers = Math.ceil(totalDuration / interval);

  for (let i = 0; i <= numMarkers; i++) {
    const time = i * interval;
    const percent = (time / totalDuration) * 100;

    // 타임라인이 너무 길면 표시 간격 조절
    if (percent <= 100) {
      const marker = document.createElement("div");
      marker.className = "timeline-marker";
      marker.style.left = `${percent}%`;

      const label = document.createElement("span");
      label.className = "timeline-label";
      label.textContent = formatTime(time);

      marker.appendChild(label);
      scaleEl.appendChild(marker);
    }
  }

  container.appendChild(scaleEl);
}

// 타임라인 상호작용 설정
function setupTimelineInteractions() {
  const timelineEl = document.querySelector(".waveform-timeline");

  if (!timelineEl) return;

  // 타임라인 클릭 이벤트
  timelineEl.addEventListener("click", (e) => {
    // 마커 클릭은 여기서 처리하지 않음 (각 마커에 별도 이벤트 있음)
    if (
      e.target.classList.contains("bell-marker") ||
      e.target.classList.contains("bell-candidate") ||
      e.target.classList.contains("bell-rejected") ||
      e.target.classList.contains("time-marker") ||
      e.target.classList.contains("time-tick") ||
      e.target.classList.contains("time-label")
    ) {
      return;
    }

    const totalDuration = videoPlayer.duration || 0;
    if (totalDuration <= 0) return;

    // 타임라인 상의 클릭 위치를 시간으로 변환
    const rect = timelineEl.getBoundingClientRect();
    const clickPos = (e.clientX - rect.left) / rect.width;
    const newTime = clickPos * totalDuration;

    // 비디오 위치 변경
    jumpToTime(newTime);
  });
}

// 비디오 위치 업데이트 함수
function updatePlayerPosition() {
  const positionMarker = document.getElementById("playerPositionMarker");
  if (!positionMarker) return;

  const totalDuration = videoPlayer.duration || 0;
  if (totalDuration <= 0) return;

  const currentTime = videoPlayer.currentTime;
  const position = (currentTime / totalDuration) * 100;

  // 위치 마커 업데이트
  positionMarker.style.left = `${position}%`;

  // 현재 시간에 해당하는 벨 마커 강조
  const bellMarkers = document.querySelectorAll(".bell-marker");
  bellMarkers.forEach((marker) => {
    const markerTime = parseFloat(marker.getAttribute("data-time"));
    if (Math.abs(currentTime - markerTime) < 0.5) {
      // 0.5초 이내면 강조
      marker.classList.add("marker-active");
    } else {
      marker.classList.remove("marker-active");
    }
  });

  // 타임스탬프 리스트 항목 강조
  const timestampItems = document.querySelectorAll(".timestamps-list li");
  timestampItems.forEach((item) => {
    const jumpBtn = item.querySelector(".timestamp-jump");
    if (!jumpBtn) return;

    const itemTime = parseFloat(jumpBtn.getAttribute("data-time"));
    if (Math.abs(currentTime - itemTime) < 0.5) {
      // 0.5초 이내면 강조
      item.classList.add("active-timestamp");
    } else {
      item.classList.remove("active-timestamp");
    }
  });
}

// 비디오 특정 시간으로 이동 함수
function jumpToTime(time) {
  videoPlayer.currentTime = time;
  videoPlayer.play();

  // 플레이 시각화 효과 추가
  const timeline = document.querySelector(".waveform-timeline");
  if (timeline) {
    const ripple = document.createElement("div");
    ripple.className = "timeline-ripple";

    const totalDuration = videoPlayer.duration || 0;
    if (totalDuration > 0) {
      const position = (time / totalDuration) * 100;
      ripple.style.left = `${position}%`;
      timeline.appendChild(ripple);

      // 애니메이션 후 제거
      setTimeout(() => {
        ripple.remove();
      }, 1000);
    }
  }
}

// 분할된 세그먼트 표시 함수
function displaySegments(segments) {
  segmentsList.innerHTML = "";

  segments.forEach((segment) => {
    const segmentEl = document.createElement("div");
    segmentEl.className = "segment-item";

    // 템플릿 복제
    const template = document.getElementById("segmentTemplate");
    const segmentContent = template.content.cloneNode(true);

    // 데이터 채우기
    segmentContent.querySelector(".segment-id").textContent = segment.id;
    segmentContent.querySelector(".segment-start").textContent = formatTime(
      segment.startTime
    );
    segmentContent.querySelector(".segment-end").textContent = formatTime(
      segment.endTime
    );
    segmentContent.querySelector(".segment-duration").textContent = formatTime(
      segment.duration
    );

    const video = segmentContent.querySelector("video");
    video.src = `file://${segment.path}`;

    // 저장 버튼 이벤트
    segmentContent.querySelector(".btn-save").addEventListener("click", () => {
      saveSegment(segment.path);
    });

    // 삭제 버튼 이벤트
    segmentContent
      .querySelector(".btn-delete")
      .addEventListener("click", () => {
        deleteSegment(segment);
      });

    segmentEl.appendChild(segmentContent);
    segmentsList.appendChild(segmentEl);
  });
}

// 세그먼트 저장 함수
async function saveSegment(segmentPath) {
  try {
    showLoading("세그먼트 저장 중...");
    const result = await ipcRenderer.invoke("save-segment", segmentPath);
    hideLoading();

    if (result.success) {
      alert("세그먼트가 성공적으로 저장되었습니다.");
    } else {
      alert("세그먼트 저장 실패: " + result.error);
    }
  } catch (error) {
    hideLoading();
    alert("세그먼트 저장 중 오류가 발생했습니다: " + error.message);
    console.error(error);
  }
}

// 세그먼트 삭제 함수
async function deleteSegment(segment) {
  if (confirm(`세그먼트 ${segment.id}를 삭제하시겠습니까?`)) {
    try {
      showLoading("세그먼트 삭제 중...");
      const result = await ipcRenderer.invoke("delete-segment", segment.path);
      hideLoading();

      if (result.success) {
        // 목록에서 제거
        videoSegments = videoSegments.filter((s) => s.id !== segment.id);
        displaySegments(videoSegments);
        alert("세그먼트가 삭제되었습니다.");
      } else {
        alert("세그먼트 삭제 실패: " + result.error);
      }
    } catch (error) {
      hideLoading();
      alert("세그먼트 삭제 중 오류가 발생했습니다: " + error.message);
      console.error(error);
    }
  }
}

// 유틸리티 함수
function isVideoFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return [".mp4", ".avi", ".mov", ".mkv"].includes(ext);
}

function formatTime(seconds) {
  if (isNaN(seconds)) return "00:00";

  const min = Math.floor(seconds / 60);
  const sec = Math.floor(seconds % 60);

  if (min >= 60) {
    const hour = Math.floor(min / 60);
    const remainMin = min % 60;
    return `${String(hour).padStart(2, "0")}:${String(remainMin).padStart(
      2,
      "0"
    )}:${String(sec).padStart(2, "0")}`;
  }

  return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function showLoading(message = "처리 중...") {
  loadingText.textContent = message;
  loadingOverlay.style.display = "flex";
}

function hideLoading() {
  loadingOverlay.style.display = "none";
}

function updateLoadingMessage(message) {
  loadingText.textContent = message;
}
