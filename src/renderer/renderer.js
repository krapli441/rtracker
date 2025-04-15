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
const bellHistoryEl = document.getElementById("bell-history");
const roundAnalysisEl = document.getElementById("round-analysis");
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
let bellDetectionThreshold = 130; // 임계값 조정
let bellDetectionCount = 0; // 종소리 감지 카운트
let bellLastDetectedAt = 0; // 마지막 종소리 감지 시간
let isBellDetected = false; // 현재 종소리 감지 상태
let bellDetectionHistory = []; // 종소리 감지 이력

// 종소리 주파수 범위 - 다양한 주파수 대역을 포함하도록 수정
const BELL_FREQUENCY_RANGES = [
  // { min: 400, max: 1100, weight: 1.0 }, // 저주파 영역 - 이미지의 노란색 부분
  { min: 2000, max: 2400, weight: 0.9 }, // 2000Hz 주변 - 이미지의 첫 번째 핑크색 피크
  { min: 3000, max: 3200, weight: 0.9 }, // 2000Hz 주변 - 이미지의 첫 번째 핑크색 피크
  { min: 4000, max: 4500, weight: 0.9 }, // 2000Hz 주변 - 이미지의 첫 번째 핑크색 피크
  { min: 5300, max: 5500, weight: 0.9 }, // 2000Hz 주변 - 이미지의 첫 번째 핑크색 피크
  { min: 6600, max: 7200, weight: 0.7 }, // 5000Hz 주변 - 이미지의 두 번째 핑크색 피크
  { min: 8000, max: 8500, weight: 0.7 }, // 5000Hz 주변 - 이미지의 두 번째 핑크색 피크
  { min: 9500, max: 10000, weight: 0.5 }, // 10000Hz 주변 - 높은 주파수 영역
];

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

  // 종소리 주파수 범위별 강도 측정
  let bellFrequencyIntensities = BELL_FREQUENCY_RANGES.map((range) => ({
    range,
    intensity: 0,
  }));
  let totalBellScore = 0;

  // 지속 시간에 따른 패턴 분석을 위한 시간 윈도우 데이터 (미래 확장용)
  const timeWindowData = {};

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
        shouldDisplay = BELL_FREQUENCY_RANGES.some(
          (range) => frequency >= range.min && frequency <= range.max
        );
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

    // 종소리 주파수 범위별 강도 측정
    for (let j = 0; j < bellFrequencyIntensities.length; j++) {
      const { range } = bellFrequencyIntensities[j];
      if (
        frequency >= range.min &&
        frequency <= range.max &&
        frequencyData[i] > bellFrequencyIntensities[j].intensity
      ) {
        bellFrequencyIntensities[j].intensity = frequencyData[i];
      }
    }

    if (shouldDisplay) {
      // 주파수에 따른 색상 계산
      const intensity = frequencyData[i] / 255;
      let r, g, b;

      // 종소리 주파수 범위 확인
      const isBellFrequency = BELL_FREQUENCY_RANGES.some(
        (range) => frequency >= range.min && frequency <= range.max
      );

      // 주파수 범위에 따라 다른 색상 사용
      if (isBellFrequency && frequencyData[i] > 100) {
        // 어떤 범위인지 확인
        let rangeIndex = -1;
        for (let k = 0; k < BELL_FREQUENCY_RANGES.length; k++) {
          if (
            frequency >= BELL_FREQUENCY_RANGES[k].min &&
            frequency <= BELL_FREQUENCY_RANGES[k].max
          ) {
            rangeIndex = k;
            break;
          }
        }

        // 범위별 색상 설정
        switch (rangeIndex) {
          case 0: // 2000Hz-2400Hz - 빨간색
            r = 255;
            g = 50;
            b = 50;
            break;
          case 1: // 3000Hz-3200Hz - 주황색
            r = 255;
            g = 150;
            b = 0;
            break;
          case 2: // 4000Hz-4500Hz - 노란색
            r = 255;
            g = 255;
            b = 0;
            break;
          case 3: // 5300Hz-5500Hz - 라임색
            r = 150;
            g = 255;
            b = 0;
            break;
          case 4: // 6600Hz-7200Hz - 청록색
            r = 0;
            g = 255;
            b = 150;
            break;
          case 5: // 6600Hz-7200Hz - 하늘색
            r = 0;
            g = 200;
            b = 255;
            break;
          case 6: // 8000Hz-8500Hz - 파란색
            r = 50;
            g = 100;
            b = 255;
            break;
          case 7: // 9500Hz-10000Hz - 보라색
            r = 150;
            g = 50;
            b = 255;
            break;
          default: // 기본 - 흰색
            r = 255;
            g = 255;
            b = 255;
        }
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

  // 종소리 감지 점수 계산 (알고리즘 개선)
  // 1. 각 범위별 점수 계산
  let rangeScores = bellFrequencyIntensities.map(
    (data) => data.intensity * data.range.weight
  );

  // 2. 범위 간 균형 검사 (종소리는 여러 주파수 범위에서 동시에 나타남)
  let activePeaks = rangeScores.filter((score) => score > 50).length;
  let hasMultipleRanges = activePeaks >= 3; // 동시에 3개 이상의 주파수 대역이 활성화되면 종소리 가능성 높음

  // 3. 최종 점수 계산
  if (hasMultipleRanges) {
    // 여러 범위가 동시에 활성화된 경우 점수 가중
    totalBellScore =
      rangeScores.reduce((sum, score) => sum + score, 0) /
      BELL_FREQUENCY_RANGES.length;
    totalBellScore *= 1 + activePeaks / 10; // 활성화된 피크 수에 따라 가중치 증가 (최대 1.8배)

    // 디버깅용 콘솔 로그 제거
  } else {
    // 단일 범위만 활성화된 경우 (노이즈일 가능성 높음)
    totalBellScore =
      rangeScores.reduce((sum, score) => sum + score, 0) /
      BELL_FREQUENCY_RANGES.length;
    // 단일 피크는 가중치 없음
  }

  // 종소리 감지 처리
  detectBellSound(totalBellScore, rangeScores, activePeaks);

  // 피크 주파수 정보 업데이트
  peakFrequencyEl.textContent = `${Math.round(peakFrequency)} Hz`;
  peakIntensityEl.textContent = peakIntensity;

  // 주파수 구분선 그리기
  drawFrequencyRangeIndicators();
}

// 종소리 감지 함수
function detectBellSound(bellScore, rangeScores, activePeaksCount) {
  const currentTime = videoPlayer.currentTime;

  // 종소리 감지 (점수가 임계값을 넘고, 마지막 감지로부터 충분한 시간이 지났을 때)
  if (bellScore > bellDetectionThreshold) {
    // 연속 감지 카운트 증가
    bellDetectionCount++;

    // 일정 횟수 이상 연속 감지되면 종소리로 판단 (2회로 조정)
    if (
      bellDetectionCount >= 2 &&
      !isBellDetected &&
      currentTime - bellLastDetectedAt > 2
    ) {
      isBellDetected = true;
      bellLastDetectedAt = currentTime;

      // 종소리 감지 기록 추가
      bellDetectionHistory.push({
        time: currentTime,
        score: bellScore,
        timestamp: new Date().toISOString(),
      });

      // 종소리로 최종 판단되었을 때만 콘솔 로그 출력
      console.log(
        `🔔 종소리 감지! 시간=${formatTime(
          Math.floor(currentTime / 60)
        )}:${formatTime(
          Math.floor(currentTime % 60)
        )}, 점수=${bellScore.toFixed(1)}, 피크 수=${activePeaksCount}`
      );
      if (rangeScores) {
        console.log(
          "주파수 범위별 점수:",
          BELL_FREQUENCY_RANGES.map(
            (range, idx) =>
              `${range.min}-${range.max}Hz: ${
                rangeScores[idx] ? rangeScores[idx].toFixed(1) : "N/A"
              }`
          )
        );
      }

      // 종소리 감지 정보 업데이트
      updateBellDetectionInfo();

      // 3초 후 감지 상태 초기화
      setTimeout(() => {
        isBellDetected = false;
        bellDetectionEl.style.color = "";
      }, 3000);
    }
  } else {
    // 감지 카운트 더 천천히 감소 (연속성 향상)
    if (bellDetectionCount > 0) {
      bellDetectionCount -= 0.5; // 0.5씩 감소하여 연속성 유지
    }

    if (bellDetectionCount === 0 && !isBellDetected) {
      bellDetectionEl.textContent = "감지되지 않음";
    }
  }
}

// 종소리 감지 정보 업데이트 함수
function updateBellDetectionInfo() {
  if (bellDetectionHistory.length === 0) return;

  // 가장 최근 감지 정보
  const latestDetection = bellDetectionHistory[bellDetectionHistory.length - 1];
  const minutes = Math.floor(latestDetection.time / 60);
  const seconds = Math.floor(latestDetection.time % 60);

  // 정보 업데이트
  bellDetectionEl.textContent = `감지됨 (${formatTime(minutes)}:${formatTime(
    seconds
  )})`;
  bellDetectionEl.style.color = "yellow";

  // 종소리 히스토리 업데이트
  let historyText = bellDetectionHistory
    .slice(-3)
    .map((detection) => {
      const mins = Math.floor(detection.time / 60);
      const secs = Math.floor(detection.time % 60);
      return `${formatTime(mins)}:${formatTime(secs)}`;
    })
    .join(", ");

  bellHistoryEl.textContent = historyText || "없음";

  // 이전 감지와의 시간 차이 계산 (2개 이상 감지된 경우)
  if (bellDetectionHistory.length >= 2) {
    const previousDetection =
      bellDetectionHistory[bellDetectionHistory.length - 2];
    const timeDiff = latestDetection.time - previousDetection.time;

    // 라운드 분석 표시
    updateRoundAnalysis(timeDiff);

    // 약 3분(180초) 간격인 경우 라운드 종으로 추정
    if (timeDiff >= 170 && timeDiff <= 190) {
      console.log(`라운드 종소리 감지: 간격 ${timeDiff.toFixed(1)}초`);
    }
    // 약 30초 간격인 경우 휴식 종료 종으로 추정
    else if (timeDiff >= 25 && timeDiff <= 35) {
      console.log(`휴식 종료 종소리 감지: 간격 ${timeDiff.toFixed(1)}초`);
    }
  }

  // 콘솔에 감지 기록 출력
  console.log(`종소리 감지 이력:`, bellDetectionHistory);
}

// 라운드 분석 텍스트 업데이트
function updateRoundAnalysis(timeDiff) {
  if (!timeDiff) {
    roundAnalysisEl.textContent = "-";
    return;
  }

  if (timeDiff >= 170 && timeDiff <= 190) {
    roundAnalysisEl.textContent = `라운드 종료 (간격: ${timeDiff.toFixed(
      1
    )}초)`;
    roundAnalysisEl.style.color = "lightgreen";
  } else if (timeDiff >= 25 && timeDiff <= 35) {
    roundAnalysisEl.textContent = `휴식 종료 (간격: ${timeDiff.toFixed(1)}초)`;
    roundAnalysisEl.style.color = "orange";
  } else {
    roundAnalysisEl.textContent = `알 수 없는 간격 (${timeDiff.toFixed(1)}초)`;
    roundAnalysisEl.style.color = "white";
  }
}

// 복싱 종소리 주파수 범위 확인 함수
function isBellFrequencyRange(binIndex, binCount, sampleRate) {
  // FFT 주파수 값 계산 (0 ~ Nyquist)
  const frequency = (binIndex * sampleRate) / (binCount * 2);

  // 여러 종소리 주파수 범위를 확인
  return BELL_FREQUENCY_RANGES.some(
    (range) => frequency >= range.min && frequency <= range.max
  );
}

// 주파수 구분선 그리기
function drawFrequencyRangeIndicators() {
  // 주요 주파수 구간 표시 (500Hz, 1000Hz, 2000Hz 등)
  const frequencies = [
    1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000,
  ];
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

  // 종소리 주파수 범위 표시 - 모든 범위 표시
  BELL_FREQUENCY_RANGES.forEach((range, index) => {
    const rangeLowIndex = Math.round(
      (range.min * analyser.frequencyBinCount * 2) / audioContext.sampleRate
    );
    const rangeHighIndex = Math.round(
      (range.max * analyser.frequencyBinCount * 2) / audioContext.sampleRate
    );

    const rangeLowX =
      ((rangeLowIndex * canvas.width) / frequencyData.length) *
      visualizationScale;
    const rangeHighX =
      ((rangeHighIndex * canvas.width) / frequencyData.length) *
      visualizationScale;

    // 영역 색상 설정 - 각 범위별 다른 색상 적용
    let strokeColor, fillColor, textColor;

    switch (index) {
      case 0: // 2000Hz-2400Hz - 빨간색
        strokeColor = "rgba(255, 50, 50, 0.3)";
        fillColor = "rgba(255, 50, 50, 0.1)";
        textColor = "rgba(255, 50, 50, 0.8)";
        break;
      case 1: // 3000Hz-3200Hz - 주황색
        strokeColor = "rgba(255, 150, 0, 0.3)";
        fillColor = "rgba(255, 150, 0, 0.1)";
        textColor = "rgba(255, 150, 0, 0.8)";
        break;
      case 2: // 4000Hz-4500Hz - 노란색
        strokeColor = "rgba(255, 255, 0, 0.3)";
        fillColor = "rgba(255, 255, 0, 0.1)";
        textColor = "rgba(255, 255, 0, 0.8)";
        break;
      case 3: // 5300Hz-5500Hz - 라임색
        strokeColor = "rgba(150, 255, 0, 0.3)";
        fillColor = "rgba(150, 255, 0, 0.1)";
        textColor = "rgba(150, 255, 0, 0.8)";
        break;
      case 4: // 6600Hz-7200Hz - 청록색
        strokeColor = "rgba(0, 255, 150, 0.3)";
        fillColor = "rgba(0, 255, 150, 0.1)";
        textColor = "rgba(0, 255, 150, 0.8)";
        break;
      case 5: // 6600Hz-7200Hz - 하늘색
        strokeColor = "rgba(0, 200, 255, 0.3)";
        fillColor = "rgba(0, 200, 255, 0.1)";
        textColor = "rgba(0, 200, 255, 0.8)";
        break;
      case 6: // 8000Hz-8500Hz - 파란색
        strokeColor = "rgba(50, 100, 255, 0.3)";
        fillColor = "rgba(50, 100, 255, 0.1)";
        textColor = "rgba(50, 100, 255, 0.8)";
        break;
      case 7: // 9500Hz-10000Hz - 보라색
        strokeColor = "rgba(150, 50, 255, 0.3)";
        fillColor = "rgba(150, 50, 255, 0.1)";
        textColor = "rgba(150, 50, 255, 0.8)";
        break;
    }

    // 종소리 영역 표시
    canvasCtx.strokeStyle = strokeColor;
    canvasCtx.fillStyle = fillColor;
    canvasCtx.fillRect(rangeLowX, 0, rangeHighX - rangeLowX, canvas.height);
    canvasCtx.strokeRect(rangeLowX, 0, rangeHighX - rangeLowX, canvas.height);

    // 범위 텍스트
    canvasCtx.fillStyle = textColor;
    canvasCtx.fillText(
      `범위 ${index + 1}`,
      (rangeLowX + rangeHighX) / 2 - 20,
      22 + index * 12
    );
  });
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
