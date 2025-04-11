const { ipcRenderer } = require("electron");
const path = require("path");

// DOM 요소
const selectVideoBtn = document.getElementById("select-video-btn");
const selectedFileInfo = document.getElementById("selected-file-info");
const fileName = document.getElementById("file-name");
const fileDuration = document.getElementById("file-duration");
const videoContainer = document.getElementById("video-container");
const videoPlayer = document.getElementById("video-player");
const playPauseBtn = document.getElementById("play-pause-btn");
const videoTimeline = document.getElementById("video-timeline");
const currentTimeEl = document.getElementById("current-time");
const totalTimeEl = document.getElementById("total-time");
const zoomInBtn = document.getElementById("zoom-in-btn");
const zoomOutBtn = document.getElementById("zoom-out-btn");

// 주파수 관련 DOM 요소
const peakFrequencyEl = document.getElementById("peak-frequency");
const peakIntensityEl = document.getElementById("peak-intensity");
const bellDetectionEl = document.getElementById("bell-detection");
const filterAllBtn = document.getElementById("filter-all");
const filterBellBtn = document.getElementById("filter-bell");
const filterLowBtn = document.getElementById("filter-low");
const filterMidBtn = document.getElementById("filter-mid");
const filterHighBtn = document.getElementById("filter-high");

// 현재 선택된 비디오 경로
let currentVideoPath = null;
// Web Audio API 관련 변수
let audioContext = null;
let analyser = null;
let audioSource = null;
// Canvas 관련 변수
let canvas = null;
let canvasCtx = null;
// 스펙트럼 시각화 관련 변수
let frequencyData = null;
let visualizationScale = 1.0; // 시각화 확대/축소 비율
let animationId = null;
let isPlaying = false;
// 주파수 필터 설정
let currentFilter = "all"; // 'all', 'bell', 'low', 'mid', 'high'
// 종소리 감지 관련 변수
let bellDetectionThreshold = 150; // 종소리 감지 임계값
let bellDetectionCount = 0; // 종소리 감지 카운트
let bellLastDetectedAt = 0; // 마지막 종소리 감지 시간
let isBellDetected = false; // 현재 종소리 감지 상태

// 비디오 선택 버튼 이벤트 리스너
selectVideoBtn.addEventListener("click", async () => {
  try {
    const filePath = await ipcRenderer.invoke("select-video");

    if (filePath) {
      loadVideo(filePath);
    }
  } catch (error) {
    console.error("비디오 선택 중 오류 발생:", error);
    alert("비디오 선택 중 오류가 발생했습니다.");
  }
});

// 비디오 로드 함수
async function loadVideo(filePath) {
  currentVideoPath = filePath;

  // 파일 이름 표시
  const fileNameOnly = path.basename(filePath);
  fileName.textContent = fileNameOnly;

  try {
    // 비디오 소스 설정
    videoPlayer.src = filePath;

    // 메타데이터 로드 이벤트
    videoPlayer.addEventListener("loadedmetadata", () => {
      // 비디오 컨테이너 표시
      videoContainer.classList.remove("hidden");
      selectedFileInfo.classList.remove("hidden");

      // 비디오 타임라인 최대값 설정
      videoTimeline.max = videoPlayer.duration;

      // 비디오 총 길이 표시
      const totalMinutes = Math.floor(videoPlayer.duration / 60);
      const totalSeconds = Math.floor(videoPlayer.duration % 60);
      totalTimeEl.textContent = `${formatTime(totalMinutes)}:${formatTime(
        totalSeconds
      )}`;

      // 비디오 파일 길이 표시
      fileDuration.textContent = `길이: ${formatTime(
        totalMinutes
      )}:${formatTime(totalSeconds)}`;

      // 오디오 스펙트럼 분석 초기화
      initAudioAnalyser();
    });

    // 비디오 시간 업데이트 이벤트
    videoPlayer.addEventListener("timeupdate", updateVideoProgress);
  } catch (error) {
    console.error("비디오 로드 중 오류 발생:", error);
    alert("비디오 로드 중 오류가 발생했습니다.");
  }
}

// 오디오 분석기 초기화 함수
function initAudioAnalyser() {
  // 이전 설정 정리
  if (audioContext) {
    audioContext.close();
  }
  if (animationId) {
    cancelAnimationFrame(animationId);
    animationId = null;
  }

  try {
    // Waveform 컨테이너에 Canvas 생성
    const waveformContainer = document.getElementById("waveform");
    waveformContainer.innerHTML = ""; // 기존 내용 제거

    canvas = document.createElement("canvas");
    canvas.width = waveformContainer.clientWidth;
    canvas.height = waveformContainer.clientHeight || 150;
    waveformContainer.appendChild(canvas);
    canvasCtx = canvas.getContext("2d");

    // AudioContext 생성
    audioContext = new (window.AudioContext || window.webkitAudioContext)();

    // 비디오의 오디오 트랙을 소스로 설정
    audioSource = audioContext.createMediaElementSource(videoPlayer);

    // 분석기 노드 생성 및 설정
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048; // 더 세밀한 주파수 분석을 위해 FFT 크기 설정
    analyser.smoothingTimeConstant = 0.8; // 스펙트럼 시각화 부드러움 설정

    // 오디오 소스를 분석기에 연결, 그리고 오디오 출력에 연결
    audioSource.connect(analyser);
    analyser.connect(audioContext.destination);

    // 주파수 데이터 저장 버퍼 생성
    frequencyData = new Uint8Array(analyser.frequencyBinCount);

    // 주파수 필터 버튼 이벤트 설정
    setupFilterButtons();

    // 비디오 이벤트 리스너 설정
    setupAudioEvents();

    // 초기 스펙트럼 그리기
    drawSpectrum();
  } catch (error) {
    console.error("오디오 분석기 초기화 중 오류 발생:", error);
    alert("오디오 분석기 초기화 중 오류가 발생했습니다.");
  }
}

// 주파수 필터 버튼 설정
function setupFilterButtons() {
  // 모든 필터 버튼
  const filterButtons = [
    filterAllBtn,
    filterBellBtn,
    filterLowBtn,
    filterMidBtn,
    filterHighBtn,
  ];

  // 필터 버튼 클릭 이벤트
  filterAllBtn.addEventListener("click", () =>
    setActiveFilter("all", filterButtons)
  );
  filterBellBtn.addEventListener("click", () =>
    setActiveFilter("bell", filterButtons)
  );
  filterLowBtn.addEventListener("click", () =>
    setActiveFilter("low", filterButtons)
  );
  filterMidBtn.addEventListener("click", () =>
    setActiveFilter("mid", filterButtons)
  );
  filterHighBtn.addEventListener("click", () =>
    setActiveFilter("high", filterButtons)
  );
}

// 활성 필터 설정
function setActiveFilter(filter, buttons) {
  // 현재 필터 설정
  currentFilter = filter;

  // 버튼 활성화 상태 업데이트
  buttons.forEach((btn) => btn.classList.remove("active"));

  // 선택된 필터 버튼 활성화
  switch (filter) {
    case "all":
      filterAllBtn.classList.add("active");
      break;
    case "bell":
      filterBellBtn.classList.add("active");
      break;
    case "low":
      filterLowBtn.classList.add("active");
      break;
    case "mid":
      filterMidBtn.classList.add("active");
      break;
    case "high":
      filterHighBtn.classList.add("active");
      break;
  }
}

// 오디오 이벤트 설정
function setupAudioEvents() {
  // 비디오 재생 이벤트
  videoPlayer.addEventListener("play", function () {
    isPlaying = true;
    if (audioContext && audioContext.state === "suspended") {
      audioContext.resume();
    }
    drawSpectrum();
  });

  // 비디오 일시정지 이벤트
  videoPlayer.addEventListener("pause", function () {
    isPlaying = false;
    if (animationId) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }
  });

  // 비디오 종료 이벤트
  videoPlayer.addEventListener("ended", function () {
    isPlaying = false;
    if (animationId) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }
  });
}

// 스펙트럼 그리기 함수
function drawSpectrum() {
  if (!analyser) {
    return;
  }

  // 애니메이션 프레임 설정 (재생 중일 때만)
  if (isPlaying) {
    animationId = requestAnimationFrame(drawSpectrum);
  }

  // 주파수 데이터 가져오기
  analyser.getByteFrequencyData(frequencyData);

  // 캔버스 초기화
  canvasCtx.fillStyle = "rgb(20, 20, 30)";
  canvasCtx.fillRect(0, 0, canvas.width, canvas.height);

  // 스펙트럼 그리기
  const barWidth = (canvas.width / frequencyData.length) * visualizationScale;
  let barHeight;
  let x = 0;

  // 피크 주파수 초기화
  let peakFrequency = 0;
  let peakIntensity = 0;
  let bellFrequencyIntensity = 0;

  // 주파수 데이터를 기반으로 스펙트럼 그리기
  for (let i = 0; i < frequencyData.length; i++) {
    // 현재 빈의 주파수 값 계산
    const frequency =
      (i * audioContext.sampleRate) / (analyser.frequencyBinCount * 2);

    // 현재 필터에 따라 표시 여부 결정
    let shouldDisplay = false;

    switch (currentFilter) {
      case "all":
        shouldDisplay = true;
        break;
      case "bell":
        shouldDisplay = frequency >= 700 && frequency <= 1200;
        break;
      case "low":
        shouldDisplay = frequency < 500;
        break;
      case "mid":
        shouldDisplay = frequency >= 500 && frequency <= 2000;
        break;
      case "high":
        shouldDisplay = frequency > 2000;
        break;
    }

    // 피크 주파수 찾기
    if (frequencyData[i] > peakIntensity) {
      peakIntensity = frequencyData[i];
      peakFrequency = frequency;
    }

    // 종소리 주파수 범위의 강도 계산
    if (
      frequency >= 700 &&
      frequency <= 1200 &&
      frequencyData[i] > bellFrequencyIntensity
    ) {
      bellFrequencyIntensity = frequencyData[i];
    }

    if (shouldDisplay) {
      // 주파수에 따른 색상 계산
      const intensity = frequencyData[i] / 255;
      let r, g, b;

      // 복싱 종소리 주파수 범위(약 700-1200Hz)를 강조
      const isBellFrequency = frequency >= 700 && frequency <= 1200;

      // 주파수 범위에 따라 다른 색상 사용
      if (isBellFrequency && frequencyData[i] > 100) {
        // 종소리 주파수 범위(높은 강도일 때)는 밝은 노란색으로 강조
        r = 255;
        g = 255;
        b = 0;
      } else {
        // 일반 주파수 범위는 강도에 따라 색상 결정
        r = Math.round(intensity * 255);
        g = Math.round((1 - intensity) * 100);
        b = Math.round(intensity * 150);
      }

      canvasCtx.fillStyle = `rgb(${r}, ${g}, ${b})`;

      // 막대 높이 계산
      barHeight = (frequencyData[i] / 255) * canvas.height;

      // 막대 그리기
      canvasCtx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
    }

    // x 좌표 업데이트
    x += barWidth;
  }

  // 종소리 감지 처리
  detectBellSound(bellFrequencyIntensity);

  // 피크 주파수 정보 업데이트
  peakFrequencyEl.textContent = `${Math.round(peakFrequency)} Hz`;
  peakIntensityEl.textContent = peakIntensity;

  // 주파수 구분선 그리기
  drawFrequencyRangeIndicators();
}

// 종소리 감지 함수
function detectBellSound(bellIntensity) {
  const currentTime = videoPlayer.currentTime;

  // 종소리 감지 (강도가 임계값을 넘고, 마지막 감지로부터 충분한 시간이 지났을 때)
  if (bellIntensity > bellDetectionThreshold) {
    // 연속 감지 카운트 증가
    bellDetectionCount++;

    // 일정 횟수 이상 연속 감지되면 종소리로 판단
    if (
      bellDetectionCount >= 3 &&
      !isBellDetected &&
      currentTime - bellLastDetectedAt > 2
    ) {
      isBellDetected = true;
      bellLastDetectedAt = currentTime;
      bellDetectionEl.textContent = `감지됨 (${formatTime(
        Math.floor(currentTime / 60)
      )}:${formatTime(Math.floor(currentTime % 60))})`;
      bellDetectionEl.style.color = "yellow";

      // 3초 후 감지 상태 초기화
      setTimeout(() => {
        isBellDetected = false;
        bellDetectionEl.style.color = "";
      }, 3000);
    }
  } else {
    // 감지 카운트 초기화
    bellDetectionCount = Math.max(0, bellDetectionCount - 1);

    if (bellDetectionCount === 0 && !isBellDetected) {
      bellDetectionEl.textContent = "감지되지 않음";
    }
  }
}

// 복싱 종소리 주파수 범위 확인 함수
function isBellFrequencyRange(binIndex, binCount, sampleRate) {
  // FFT 주파수 값 계산 (0 ~ Nyquist)
  const frequency = (binIndex * sampleRate) / (binCount * 2);

  // 복싱 종소리 주파수 범위 (약 700Hz~1200Hz)
  return frequency >= 700 && frequency <= 1200;
}

// 주파수 구분선 그리기
function drawFrequencyRangeIndicators() {
  // 주요 주파수 구간 표시 (500Hz, 1000Hz, 2000Hz 등)
  const frequencies = [500, 1000, 2000, 5000, 10000];
  canvasCtx.strokeStyle = "rgba(255, 255, 255, 0.3)";
  canvasCtx.font = "10px Arial";
  canvasCtx.fillStyle = "white";

  frequencies.forEach((freq) => {
    // 주파수 위치 계산
    const binIndex = Math.round(
      (freq * analyser.frequencyBinCount * 2) / audioContext.sampleRate
    );
    const x =
      ((binIndex * canvas.width) / frequencyData.length) * visualizationScale;

    if (x < canvas.width) {
      // 구분선 그리기
      canvasCtx.beginPath();
      canvasCtx.moveTo(x, 0);
      canvasCtx.lineTo(x, canvas.height);
      canvasCtx.stroke();

      // 주파수 텍스트 표시
      canvasCtx.fillText(`${freq}Hz`, x + 2, 10);
    }
  });

  // 종소리 주파수 범위 표시
  const bellLowIndex = Math.round(
    (700 * analyser.frequencyBinCount * 2) / audioContext.sampleRate
  );
  const bellHighIndex = Math.round(
    (1200 * analyser.frequencyBinCount * 2) / audioContext.sampleRate
  );

  const bellLowX =
    ((bellLowIndex * canvas.width) / frequencyData.length) * visualizationScale;
  const bellHighX =
    ((bellHighIndex * canvas.width) / frequencyData.length) *
    visualizationScale;

  // 종소리 영역 표시
  canvasCtx.strokeStyle = "rgba(255, 255, 0, 0.3)";
  canvasCtx.fillStyle = "rgba(255, 255, 0, 0.1)";
  canvasCtx.fillRect(bellLowX, 0, bellHighX - bellLowX, canvas.height);
  canvasCtx.strokeRect(bellLowX, 0, bellHighX - bellLowX, canvas.height);

  // 종소리 범위 텍스트
  canvasCtx.fillStyle = "rgba(255, 255, 0, 0.8)";
  canvasCtx.fillText("종소리 범위", (bellLowX + bellHighX) / 2 - 30, 22);
}

// 줌 버튼 이벤트 리스너
zoomInBtn.addEventListener("click", function () {
  visualizationScale = Math.min(visualizationScale * 1.2, 5.0);
  // 다시 그리기
  if (canvas) {
    drawSpectrum();
  }
});

zoomOutBtn.addEventListener("click", function () {
  visualizationScale = Math.max(visualizationScale / 1.2, 0.5);
  // 다시 그리기
  if (canvas) {
    drawSpectrum();
  }
});

// 비디오 진행 상태 업데이트 함수
function updateVideoProgress() {
  // 타임라인 진행 상태 업데이트
  videoTimeline.value = videoPlayer.currentTime;

  // 현재 시간 표시 업데이트
  const currentMinutes = Math.floor(videoPlayer.currentTime / 60);
  const currentSeconds = Math.floor(videoPlayer.currentTime % 60);
  currentTimeEl.textContent = `${formatTime(currentMinutes)}:${formatTime(
    currentSeconds
  )}`;
}

// 시간 포맷팅 함수 (한 자리 숫자일 경우 앞에 0 추가)
function formatTime(time) {
  return time < 10 ? `0${time}` : time;
}

// 타임라인 변경 이벤트 리스너
videoTimeline.addEventListener("input", () => {
  videoPlayer.currentTime = videoTimeline.value;
});

// 재생/일시정지 버튼 이벤트 리스너
playPauseBtn.addEventListener("click", togglePlayPause);

// 재생/일시정지 토글 함수
function togglePlayPause() {
  if (videoPlayer.paused) {
    videoPlayer.play();
  } else {
    videoPlayer.pause();
  }
}

// 키보드 단축키 지원
document.addEventListener("keydown", (e) => {
  if (e.code === "Space" && document.activeElement !== selectVideoBtn) {
    e.preventDefault();
    togglePlayPause();
  }
});

// 창 크기 변경 시 캔버스 크기 조정
window.addEventListener("resize", function () {
  if (canvas) {
    const waveformContainer = document.getElementById("waveform");
    canvas.width = waveformContainer.clientWidth;

    // 다시 그리기
    if (analyser) {
      drawSpectrum();
    }
  }
});
