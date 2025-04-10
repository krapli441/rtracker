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
  // 간단한 시각화로 대체
  const totalDuration = videoPlayer.duration || 0;

  let markersHTML = "";

  // 타임라인 컨테이너 추가
  markersHTML += '<div class="waveform-timeline">';

  // 타임라인 눈금 표시
  if (totalDuration > 0) {
    // 타임라인 눈금과 시간 표시
    const numMarkers = Math.min(10, Math.ceil(totalDuration / 60));
    const interval = totalDuration / numMarkers;

    markersHTML += '<div class="timeline-scale">';
    for (let i = 0; i <= numMarkers; i++) {
      const position = (i / numMarkers) * 100;
      const time = i * interval;
      markersHTML += `<div class="time-marker" style="left: ${position}%">
        <div class="time-tick"></div>
        <span class="time-label">${formatTime(time)}</span>
      </div>`;
    }
    markersHTML += "</div>";

    // 재생 위치 표시기
    markersHTML +=
      '<div id="playerPositionMarker" class="player-position-marker"></div>';
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
    markersHTML += `<p>총 <strong>${timestamps.length}개</strong>의 벨 소리가 감지되었습니다.</p>`;
    markersHTML += '<ul class="timestamps-list">';

    timestamps.forEach((timestamp, index) => {
      markersHTML += `<li>
        <span class="timestamp-index">#${index + 1}</span>
        <span class="timestamp-time">${formatTime(timestamp)}</span>
        <button class="btn-small timestamp-jump" data-time="${timestamp}">이동</button>
      </li>`;
    });

    markersHTML += "</ul>";
  }

  waveformEl.innerHTML = markersHTML;

  // 타임라인 이벤트 리스너 설정
  setupTimelineInteractions();

  // 임계값 자동 조정 버튼 이벤트 연결
  const suggestButton = document.getElementById("suggestButton");
  if (suggestButton && debug && debug.candidateBells.length > 0) {
    suggestButton.addEventListener("click", () => {
      const suggestedThreshold = Math.max(
        0.05,
        debug.candidateBells.reduce(
          (min, b) => Math.min(min, b.peakAmplitude),
          1
        ) * 0.9
      ).toFixed(2);

      amplitudeThresholdInput.value = suggestedThreshold;
      amplitudeThresholdValue.textContent = suggestedThreshold;

      // 성공 표시 애니메이션
      suggestButton.textContent = "✓ 적용됨";
      suggestButton.style.backgroundColor = "#2ecc71";
      setTimeout(() => {
        suggestButton.textContent = "임계값 자동 조정";
        suggestButton.style.backgroundColor = "";
      }, 1500);

      alert(
        `임계값이 ${suggestedThreshold}로 조정되었습니다. '벨 소리 감지' 버튼을 다시 클릭하세요.`
      );
    });
  }

  // 타임스탬프 점프 버튼 이벤트 연결
  const jumpButtons = document.querySelectorAll(".timestamp-jump");
  jumpButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const time = parseFloat(button.getAttribute("data-time"));
      jumpToTime(time);
    });
  });

  // 미리보기 버튼 이벤트 연결
  const previewButtons = document.querySelectorAll(".btn-preview");
  previewButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const time = parseFloat(button.getAttribute("data-time"));
      jumpToTime(time);
    });
  });

  // 마커 직접 클릭 이벤트
  const allMarkers = document.querySelectorAll(
    ".bell-marker, .bell-candidate, .bell-rejected"
  );
  allMarkers.forEach((marker) => {
    marker.addEventListener("click", () => {
      const time = parseFloat(marker.getAttribute("data-time"));
      jumpToTime(time);

      // 마커 강조 효과
      marker.classList.add("marker-active");
      setTimeout(() => {
        marker.classList.remove("marker-active");
      }, 1000);
    });
  });

  // 타임라인에서 재생 위치 업데이트
  if (totalDuration > 0) {
    updatePlayerPosition();
    videoPlayer.addEventListener("timeupdate", updatePlayerPosition);
  }
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
