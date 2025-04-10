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
const waveformMarkers = document.getElementById("waveformMarkers");
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
const useTemplateInput = document.getElementById("useTemplate");

// 상태 관리
let currentVideoPath = null;
let audioPath = null;
let waveformData = null;
let bellTimestamps = [];
let videoSegments = [];
let isAnalyzing = false;
let debugInfo = null;
let templateLoaded = false;
// 복싱 경기 관련 설정
let roundDuration = 180; // 3분 (초 단위)
let restDuration = 30; // 30초 (초 단위)

// 초기화
window.addEventListener("DOMContentLoaded", () => {
  waveformContainer.style.display = "none";
  segmentsContainer.style.display = "none";

  // 이벤트 리스너 설정
  setupEventListeners();

  // 초기 설정값 표시
  amplitudeThresholdValue.textContent = amplitudeThresholdInput.value;

  // 템플릿 벨 소리 로드 시도
  if (useTemplateInput && useTemplateInput.checked) {
    loadTemplateBellSound();
  }

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

      // 템플릿 벨 소리 로드 상태 확인 및 로드
      const useTemplate = useTemplateInput && useTemplateInput.checked;
      if (useTemplate && !templateLoaded) {
        updateLoadingMessage("템플릿 벨 소리 로드 중...");
        await loadTemplateBellSound();
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

        // 템플릿 매칭 또는 진폭 기반 벨 소리 감지 수행
        if (useTemplate && templateLoaded) {
          updateLoadingMessage("템플릿 매칭으로 벨 소리 감지 중...");
          bellTimestamps = audioAnalyzer.detectBellSoundsWithTemplate(
            waveformData,
            customOptions
          );
        } else {
          updateLoadingMessage("진폭 기반 벨 소리 감지 중...");
          bellTimestamps = audioAnalyzer.detectBellSounds(
            waveformData,
            customOptions
          );
        }

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
              "벨 소리가 감지되지 않았습니다. 임계값을 낮추거나 템플릿 매칭을 시도해보세요."
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

      // 복싱 경기 패턴을 기반으로 세그먼트 생성
      const segments = generateBoxingSegments(bellTimestamps);

      // 영상 분할 처리
      updateLoadingMessage(
        "FFmpeg로 영상 분할 중... (분할 수에 따라 시간이 걸릴 수 있습니다)"
      );
      const result = await ipcRenderer.invoke(
        "process-video",
        currentVideoPath,
        segments
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
  // 간단한 시각화로 대체
  const waveformMarkers = document.getElementById("waveformMarkers");
  if (!waveformMarkers) return;

  // 비디오 총 길이
  const totalDuration = videoPlayer.duration || 1;

  // 마커 생성
  let markersHTML = '<div class="waveform-timeline">';

  // 시간 표시선 추가
  for (let i = 0; i <= Math.floor(totalDuration); i += 30) {
    const position = (i / totalDuration) * 100;
    markersHTML += `<div class="time-marker" style="left: ${position}%">
      <div class="time-marker-line"></div>
      <div class="time-marker-label">${formatTime(i)}</div>
    </div>`;
  }

  // 복싱 타임라인 구간 표시 (분석된 벨 시간 기반)
  if (timestamps.length > 0) {
    // 세그먼트 정보 생성
    const segments = [];
    let lastType = "unknown";

    // 종소리 간격 분석하여 타입 결정
    for (let i = 0; i < timestamps.length - 1; i++) {
      const currentBell = timestamps[i];
      const nextBell = timestamps[i + 1];
      const interval = nextBell - currentBell;

      let segmentType = "unknown";

      // 3분(180초)에 가까운 간격인지 확인
      if (Math.abs(interval - roundDuration) < 10) {
        segmentType = "round";
      }
      // 30초에 가까운 간격인지 확인
      else if (Math.abs(interval - restDuration) < 5) {
        segmentType = "rest";
      }

      segments.push({
        start: currentBell,
        end: nextBell,
        type: segmentType,
        duration: interval,
      });

      lastType = segmentType;
    }

    // 구간별 시각화
    segments.forEach((segment, index) => {
      const startPos = (segment.start / totalDuration) * 100;
      const endPos = (segment.end / totalDuration) * 100;
      const width = endPos - startPos;

      let segmentClass = "segment-unknown";
      let segmentLabel = "기타";

      if (segment.type === "round") {
        segmentClass = "segment-round";
        segmentLabel = `${Math.floor(index / 2) + 1}라운드`;
      } else if (segment.type === "rest") {
        segmentClass = "segment-rest";
        segmentLabel = "휴식";
      }

      markersHTML += `<div class="segment ${segmentClass}" 
        style="left: ${startPos}%; width: ${width}%;" 
        title="${segmentLabel}: ${formatTime(segment.start)} ~ ${formatTime(
        segment.end
      )}">
        <span class="segment-label">${segmentLabel}</span>
      </div>`;
    });
  }

  // 후보 및 거부된 벨 소리도 표시 (낮은 투명도로)
  if (debug) {
    // 후보 벨 표시 (회색)
    if (debug.candidateBells && debug.candidateBells.length > 0) {
      debug.candidateBells.forEach((bell) => {
        // 수락된 벨과 중복되지 않는 경우에만 표시
        if (
          !debug.acceptedBells.find((b) => Math.abs(b.start - bell.start) < 0.1)
        ) {
          const position = (bell.start / totalDuration) * 100;
          markersHTML += `<div class="bell-candidate" style="left: ${position}%" 
            data-time="${bell.start}" 
            title="후보 벨: ${formatTime(
              bell.start
            )}, 진폭: ${bell.peakAmplitude.toFixed(2)}"></div>`;
        }
      });
    }

    // 거부된 벨 표시 (주황색)
    if (debug.rejectedBells && debug.rejectedBells.length > 0) {
      debug.rejectedBells.forEach((bell) => {
        const position = (bell.start / totalDuration) * 100;
        const reason = bell.reason.replace(/"/g, "&quot;");
        markersHTML += `<div class="bell-rejected" style="left: ${position}%" 
          data-time="${bell.start}" 
          title="거부된 벨: ${formatTime(bell.start)}, 이유: ${reason}"></div>`;
      });
    }
  }

  // 감지된 벨 소리 표시 (빨간색)
  if (totalDuration > 0 && timestamps.length > 0) {
    timestamps.forEach((timestamp, index) => {
      const position = (timestamp / totalDuration) * 100;
      markersHTML += `<div class="bell-marker" style="left: ${position}%" 
        data-time="${timestamp}" 
        data-index="${index + 1}" 
        title="벨 소리 #${index + 1}: ${formatTime(timestamp)}"></div>`;
    });
  }

  markersHTML += "</div>";

  // 벨 소리 감지 결과 정보
  if (timestamps.length === 0) {
    markersHTML += `<p class="no-bells">벨 소리가 감지되지 않았습니다. 임계값을 낮춰보세요.</p>`;

    // 디버깅 정보가 있다면 표시
    if (debug && debug.candidateBells && debug.candidateBells.length > 0) {
      // 가장 적절한 임계값 계산
      const suggestedThreshold = Math.max(
        0.05,
        debug.candidateBells.reduce(
          (min, b) => Math.min(min, b.peakAmplitude),
          1
        ) * 0.9
      ).toFixed(2);

      markersHTML += `<div class="debug-info">
        <h4>문제 해결 정보</h4>
        <p>${
          debug.candidateBells.length
        }개의 벨 소리 후보가 있지만 조건에 맞지 않아 제외되었습니다.</p>
        
        <details>
          <summary>후보 벨 소리 정보 (${
            debug.candidateBells.length
          }개)</summary>
          <ul class="debug-list">
            ${debug.candidateBells
              .map(
                (bell) =>
                  `<li>시작: ${formatTime(
                    bell.start
                  )}, 진폭: ${bell.peakAmplitude.toFixed(
                    3
                  )}, 길이: ${bell.duration.toFixed(2)}초
                <button class="btn-small btn-preview" data-time="${
                  bell.start
                }">미리보기</button>
              </li>`
              )
              .join("")}
          </ul>
        </details>
        
        <details>
          <summary>거부된 벨 소리 정보 (${
            debug.rejectedBells.length
          }개)</summary>
          <ul class="debug-list">
            ${debug.rejectedBells
              .map(
                (bell) =>
                  `<li>시작: ${formatTime(
                    bell.start
                  )}, 진폭: ${bell.peakAmplitude.toFixed(
                    3
                  )}, 길이: ${bell.duration.toFixed(2)}초, 거부 이유: ${
                    bell.reason
                  }
                <button class="btn-small btn-preview" data-time="${
                  bell.start
                }">미리보기</button>
              </li>`
              )
              .join("")}
          </ul>
        </details>
        
        <p>제안: 임계값을 <strong>${suggestedThreshold}</strong>로 설정하세요. <button id="suggestButton" class="btn-small">임계값 자동 조정</button></p>
      </div>`;
    }
  } else {
    // 복싱 세그먼트 정보 요약 표시
    markersHTML += `<div class="segments-summary">
      <h4>복싱 세그먼트 분석 결과</h4>
      <p>총 ${timestamps.length}개의 벨 소리가 감지되었습니다.</p>
      
      <details>
        <summary>세그먼트 정보 펼치기</summary>
        <ul class="segments-list">`;

    // 벨 소리가 하나만 감지된 경우
    if (timestamps.length < 2) {
      markersHTML += `<li class="segment-info-message">
        벨 소리가 2개 이상 감지되어야 의미 있는 세그먼트를 분석할 수 있습니다. 
        <br>현재 ${timestamps.length}개의 벨 소리만 감지되었습니다.
        <br>임계값을 조정하여 더 많은 벨 소리를 감지해보세요.
      </li>`;
    } else {
      // 간격에 따른 세그먼트 유형 표시
      for (let i = 0; i < timestamps.length - 1; i++) {
        const currentBell = timestamps[i];
        const nextBell = timestamps[i + 1];
        const interval = nextBell - currentBell;

        let segmentType = "알 수 없음";
        let segmentClass = "segment-unknown";

        // 3분(180초)에 가까운 간격인지 확인
        if (Math.abs(interval - roundDuration) < 10) {
          segmentType = `라운드 ${Math.floor(i / 2) + 1}`;
          segmentClass = "segment-round";
        }
        // 30초에 가까운 간격인지 확인
        else if (Math.abs(interval - restDuration) < 5) {
          segmentType = "휴식 시간";
          segmentClass = "segment-rest";
        }

        markersHTML += `<li class="${segmentClass}">
          ${formatTime(currentBell)} ~ ${formatTime(nextBell)} 
          (${interval.toFixed(1)}초): <strong>${segmentType}</strong>
          <button class="btn-small btn-preview" data-start="${currentBell}" data-end="${nextBell}">미리보기</button>
        </li>`;
      }
    }

    markersHTML += `</ul>
        </details>
      </div>`;
  }

  waveformMarkers.innerHTML = markersHTML;

  // 미리보기 버튼 이벤트 리스너 추가
  document.querySelectorAll(".btn-preview").forEach((button) => {
    button.addEventListener("click", (e) => {
      const time = e.target.getAttribute("data-time");
      const start = e.target.getAttribute("data-start");
      const end = e.target.getAttribute("data-end");

      // 단일 지점 이동
      if (time) {
        videoPlayer.currentTime = parseFloat(time);
        videoPlayer.play();
        setTimeout(() => videoPlayer.pause(), 1500); // 1.5초 재생 후 정지
      }
      // 구간 미리보기
      else if (start && end) {
        videoPlayer.currentTime = parseFloat(start);
        videoPlayer.play();

        // 구간 종료 시점에 정지
        const duration = parseFloat(end) - parseFloat(start);
        setTimeout(() => videoPlayer.pause(), duration * 1000);
      }
    });
  });

  // 자동 임계값 조정 버튼 이벤트
  const suggestButton = document.getElementById("suggestButton");
  if (suggestButton) {
    suggestButton.addEventListener("click", () => {
      const suggestedThreshold =
        suggestButton.parentElement.querySelector("strong").textContent;
      amplitudeThresholdInput.value = suggestedThreshold;
      amplitudeThresholdValue.textContent = suggestedThreshold;
      analyzeButton.click(); // 자동으로 다시 분석
    });
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

    // 세그먼트 유형 추정 (시간 기준)
    let segmentType = "기타";
    const duration = segment.duration;

    if (Math.abs(duration - roundDuration) < 10) {
      segmentType = `라운드 ${segment.id}`;
      segmentEl.classList.add("segment-round");
    } else if (Math.abs(duration - restDuration) < 5) {
      segmentType = "휴식 시간";
      segmentEl.classList.add("segment-rest");
    }

    // 데이터 채우기
    segmentContent.querySelector(".segment-id").textContent = segment.id;
    segmentContent.querySelector(".segment-type").textContent = segmentType;
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

/**
 * 복싱 경기 패턴을 기반으로 세그먼트 생성
 * @param {Array} bellTimestamps 벨 소리 시간들
 * @returns {Array} 세그먼트 배열 [시작, 끝, 시작, 끝, ...]
 */
function generateBoxingSegments(bellTimestamps) {
  if (!bellTimestamps || bellTimestamps.length === 0) return [];

  // 복싱 세그먼트 구분: 경기(3분) 또는 휴식(30초)
  const segments = [];
  let lastType = "unknown";

  // 정렬
  const sortedBells = [...bellTimestamps].sort((a, b) => a - b);

  console.log("복싱 세그먼트 생성 시작...");
  console.log(`감지된 종소리: ${sortedBells.length}개`);
  console.log(`종소리 시간: ${sortedBells.join(", ")}`);

  // 첫 번째 벨 소리 이전의 세그먼트 추가 (영상 시작부터)
  if (sortedBells.length > 0 && sortedBells[0] > 0) {
    segments.push({
      start: 0,
      end: sortedBells[0],
      type: "intro",
      duration: sortedBells[0],
    });
    console.log(`인트로 세그먼트 추가: 0초 ~ ${sortedBells[0].toFixed(2)}초`);
  }

  // 종소리 간격 분석하여 복싱 경기 패턴 감지
  for (let i = 0; i < sortedBells.length - 1; i++) {
    const currentBell = sortedBells[i];
    const nextBell = sortedBells[i + 1];
    const interval = nextBell - currentBell;

    console.log(`종소리 ${i + 1}와 ${i + 2} 간격: ${interval.toFixed(2)}초`);

    // 3분(180초)에 가까운 간격인지 확인
    if (Math.abs(interval - roundDuration) < 10) {
      // 경기 라운드로 간주
      segments.push({
        start: currentBell,
        end: nextBell,
        type: "round",
        duration: interval,
      });
      console.log(
        `경기 라운드 감지: ${currentBell.toFixed(2)}초 ~ ${nextBell.toFixed(
          2
        )}초 (${interval.toFixed(2)}초)`
      );
      lastType = "round";
    }
    // 30초에 가까운 간격인지 확인
    else if (Math.abs(interval - restDuration) < 5) {
      // 휴식 시간으로 간주
      segments.push({
        start: currentBell,
        end: nextBell,
        type: "rest",
        duration: interval,
      });
      console.log(
        `휴식 시간 감지: ${currentBell.toFixed(2)}초 ~ ${nextBell.toFixed(
          2
        )}초 (${interval.toFixed(2)}초)`
      );
      lastType = "rest";
    }
    // 간격이 너무 짧은 경우 (30초 미만) - 노이즈로 간주
    else if (interval < 20) {
      console.log(
        `간격이 너무 짧음 (${interval.toFixed(2)}초) - 노이즈로 판단하여 무시`
      );
      continue;
    }
    // 기타 간격 - 일반 세그먼트로 처리
    else {
      segments.push({
        start: currentBell,
        end: nextBell,
        type: "unknown",
        duration: interval,
      });
      console.log(
        `알 수 없는 세그먼트: ${currentBell.toFixed(2)}초 ~ ${nextBell.toFixed(
          2
        )}초 (${interval.toFixed(2)}초)`
      );
      lastType = "unknown";
    }
  }

  // 마지막 세그먼트가 경기 세그먼트라면 공백 추가 (영상 끝까지)
  if (segments.length > 0) {
    // 비디오 길이 가져오기
    const videoDuration = videoPlayer.duration;
    const lastSegmentEnd = segments[segments.length - 1].end;

    if (videoDuration > lastSegmentEnd + 1) {
      segments.push({
        start: lastSegmentEnd,
        end: videoDuration,
        type: "outro",
        duration: videoDuration - lastSegmentEnd,
      });
      console.log(
        `마지막 세그먼트 추가: ${lastSegmentEnd.toFixed(
          2
        )}초 ~ ${videoDuration.toFixed(2)}초`
      );
    }
  }

  console.log(`총 ${segments.length}개의 세그먼트 생성 완료`);

  // 세그먼트 start/end 값만 추출하여 평탄화된 배열 반환
  const flatSegments = [];
  if (segments.length > 0) {
    segments.forEach((segment) => {
      flatSegments.push(segment.start);
      flatSegments.push(segment.end);
    });
  } else if (sortedBells.length > 0) {
    // 세그먼트가 없지만 벨이 있는 경우, 각 벨을 세그먼트 시작점으로 사용
    flatSegments.push(0); // 영상 시작
    sortedBells.forEach((bell) => {
      flatSegments.push(bell);
      flatSegments.push(bell + 0.1); // 약간의 겹침 방지
    });
    if (videoPlayer.duration) {
      flatSegments.push(videoPlayer.duration); // 영상 끝
    }
  }

  console.log(`평탄화된 세그먼트 배열: ${flatSegments.join(", ")}`);
  return flatSegments;
}

/**
 * 템플릿 벨 소리 로드
 */
async function loadTemplateBellSound() {
  try {
    showLoading("템플릿 벨 소리 로드 중...");
    const success = await audioAnalyzer.loadTemplateBell(
      "Boxing_bell_ring_one_time.mp3"
    );

    if (success) {
      console.log("템플릿 벨 소리가 성공적으로 로드되었습니다.");
      templateLoaded = true;
    } else {
      console.warn("템플릿 벨 소리 로드 실패");
      templateLoaded = false;
    }

    hideLoading();
    return success;
  } catch (error) {
    console.error("템플릿 벨 소리 로드 중 오류:", error);
    hideLoading();
    templateLoaded = false;
    return false;
  }
}
