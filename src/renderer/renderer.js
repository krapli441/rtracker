const { ipcRenderer } = require("electron");
const path = require("path");
const WaveSurfer = require("wavesurfer.js");

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

// 현재 선택된 비디오 경로
let currentVideoPath = null;
// WaveSurfer 인스턴스
let wavesurfer = null;
// 현재 줌 레벨
let currentZoomLevel = 50;

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
    // 로컬 파일 URL 가져오기
    const localUrl = await ipcRenderer.invoke("get-local-file-url", filePath);

    // 비디오 소스 설정
    videoPlayer.src = filePath; // 기본 파일 경로로 설정

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

      // WaveSurfer 초기화 - 오디오 트랙을 추출하기 위한 설정
      initWaveSurfer(filePath);
    });

    // 비디오 시간 업데이트 이벤트
    videoPlayer.addEventListener("timeupdate", updateVideoProgress);
  } catch (error) {
    console.error("비디오 로드 중 오류 발생:", error);
    alert("비디오 로드 중 오류가 발생했습니다.");
  }
}

// WaveSurfer 초기화 함수
async function initWaveSurfer(filePath) {
  // 이전 인스턴스가 있다면 파괴
  if (wavesurfer) {
    wavesurfer.destroy();
  }

  try {
    // 로컬 URL 생성
    const localUrl = await ipcRenderer.invoke("get-local-file-url", filePath);

    // WaveSurfer 생성
    wavesurfer = WaveSurfer.create({
      container: "#waveform",
      waveColor: "rgb(100, 100, 255)",
      progressColor: "rgb(0, 0, 200)",
      cursorColor: "#333",
      barWidth: 2,
      barRadius: 3,
      responsive: true,
      height: 100,
      // 비디오 파일 직접 로드하므로 WebAudio 백엔드 사용
      backend: "WebAudio",
      // 미디오 컨트롤 비활성화
      mediaControls: false,
      // 파형 연산 관련 설정
      normalize: true,
      splitChannels: false,
      // 미니맵 비활성화
      minPxPerSec: 50,
      // 오디오 파일 직접 로드 설정
      mediaType: "video",
    });

    // HTML 비디오 요소에서 미디어 소스 로드
    // 직접 url을 사용하는 대신 videoPlayer 요소의 captureStream() 사용
    if (navigator.mediaDevices) {
      console.log("미디어 디바이스 지원");
      // 미디어 스트림 방식으로 로드 시도
      wavesurfer.load(filePath);
    } else {
      // 예외적인 상황에서는 직접 filePath 사용
      console.log("미디어 디바이스 미지원, 직접 파일 경로 사용");
      wavesurfer.load(filePath);
    }

    // WaveSurfer 준비 완료 이벤트
    wavesurfer.on("ready", function () {
      console.log("WaveSurfer 준비 완료");
      currentZoomLevel = 50;
      wavesurfer.zoom(currentZoomLevel);

      // WaveSurfer의 플레이백 속도를 비디오와 동기화
      wavesurfer.setPlaybackRate(videoPlayer.playbackRate);

      // 비디오와 WaveSurfer 동기화 시작
      setupSyncEvents();
    });

    // 오류 이벤트 처리
    wavesurfer.on("error", function (err) {
      console.error("WaveSurfer 오류:", err);

      // 오류 발생 시 대체 방법 시도
      console.log("대체 방법으로 WaveSurfer 로드 시도");

      // WebAudio 백엔드에서 문제가 발생한 경우 MediaElement로 다시 시도
      wavesurfer.destroy();

      wavesurfer = WaveSurfer.create({
        container: "#waveform",
        waveColor: "rgb(100, 100, 255)",
        progressColor: "rgb(0, 0, 200)",
        cursorColor: "#333",
        barWidth: 2,
        barRadius: 3,
        responsive: true,
        height: 100,
        backend: "MediaElement",
        mediaControls: false,
        normalize: true,
      });

      // 비디오 요소를 사용하지 않고 오디오 요소를 생성
      const audio = document.createElement("audio");
      audio.src = filePath;
      audio.style.display = "none";
      document.body.appendChild(audio);

      // 오디오 요소 로드
      wavesurfer.load(audio);

      wavesurfer.on("ready", function () {
        console.log("WaveSurfer가 대체 방법으로 준비됨");
        setupSyncEvents();
      });
    });
  } catch (error) {
    console.error("WaveSurfer 초기화 중 오류 발생:", error);
    alert("오디오 파형 생성 중 오류가 발생했습니다.");
  }
}

// 비디오와 WaveSurfer 동기화 설정
function setupSyncEvents() {
  // 비디오 재생 이벤트
  videoPlayer.addEventListener("play", function () {
    // 비디오의 현재 시간으로 WaveSurfer 위치 설정
    wavesurfer.seekTo(videoPlayer.currentTime / videoPlayer.duration);
    wavesurfer.play();
  });

  // 비디오 일시정지 이벤트
  videoPlayer.addEventListener("pause", function () {
    wavesurfer.pause();
  });

  // 비디오 탐색 이벤트
  videoPlayer.addEventListener("seeking", function () {
    wavesurfer.seekTo(videoPlayer.currentTime / videoPlayer.duration);
  });

  // WaveSurfer 클릭 이벤트
  wavesurfer.on("seek", function (progress) {
    videoPlayer.currentTime = videoPlayer.duration * progress;
  });

  // 재생 종료 이벤트
  videoPlayer.addEventListener("ended", function () {
    wavesurfer.pause();
  });
}

// 줌 버튼 이벤트 리스너
zoomInBtn.addEventListener("click", function () {
  if (wavesurfer) {
    currentZoomLevel = Math.min(currentZoomLevel + 10, 100);
    wavesurfer.zoom(currentZoomLevel);
  }
});

zoomOutBtn.addEventListener("click", function () {
  if (wavesurfer) {
    currentZoomLevel = Math.max(currentZoomLevel - 10, 10);
    wavesurfer.zoom(currentZoomLevel);
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

  // WaveSurfer 진행 상태 수동 업데이트
  if (wavesurfer && !wavesurfer.isPlaying()) {
    wavesurfer.seekTo(videoPlayer.currentTime / videoPlayer.duration);
  }
}

// 시간 포맷팅 함수 (한 자리 숫자일 경우 앞에 0 추가)
function formatTime(time) {
  return time < 10 ? `0${time}` : time;
}

// 타임라인 변경 이벤트 리스너
videoTimeline.addEventListener("input", () => {
  videoPlayer.currentTime = videoTimeline.value;
  if (wavesurfer) {
    wavesurfer.seekTo(videoPlayer.currentTime / videoPlayer.duration);
  }
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
