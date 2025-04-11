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

// 현재 선택된 비디오 경로
let currentVideoPath = null;

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
function loadVideo(filePath) {
  currentVideoPath = filePath;

  // 파일 이름 표시
  const fileNameOnly = path.basename(filePath);
  fileName.textContent = fileNameOnly;

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
    fileDuration.textContent = `길이: ${formatTime(totalMinutes)}:${formatTime(
      totalSeconds
    )}`;
  });

  // 비디오 시간 업데이트 이벤트
  videoPlayer.addEventListener("timeupdate", updateVideoProgress);
}

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
