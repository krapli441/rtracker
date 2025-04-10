const { ipcRenderer } = require('electron');
const path = require('path');
const fs = require('fs');
const audioAnalyzer = require('../utils/audioAnalyzer');

// DOM 요소
const uploadArea = document.getElementById('uploadArea');
const uploadButton = document.getElementById('uploadButton');
const videoPlayer = document.getElementById('videoPlayer');
const videoContainer = document.getElementById('videoContainer');
const waveformContainer = document.getElementById('waveformContainer');
const waveformEl = document.getElementById('waveform');
const analyzeButton = document.getElementById('analyzeButton');
const processButton = document.getElementById('processButton');
const segmentsList = document.getElementById('segmentsList');
const segmentsContainer = document.getElementById('segmentsContainer');
const loadingOverlay = document.getElementById('loadingOverlay');
const loadingText = document.getElementById('loadingText');
const amplitudeThresholdInput = document.getElementById('amplitudeThreshold');
const amplitudeThresholdValue = document.getElementById('amplitudeThresholdValue');
const minBellIntervalInput = document.getElementById('minBellInterval');

// 상태 관리
let currentVideoPath = null;
let audioPath = null;
let waveformData = null;
let bellTimestamps = [];
let videoSegments = [];
let isAnalyzing = false;

// 초기화
window.addEventListener('DOMContentLoaded', () => {
  waveformContainer.style.display = 'none';
  segmentsContainer.style.display = 'none';
  
  // 이벤트 리스너 설정
  setupEventListeners();
  
  // 초기 설정값 표시
  amplitudeThresholdValue.textContent = amplitudeThresholdInput.value;
});

function setupEventListeners() {
  // 파일 업로드 이벤트
  uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    uploadArea.classList.add('active');
  });
  
  uploadArea.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    uploadArea.classList.remove('active');
  });
  
  uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    uploadArea.classList.remove('active');
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      if (isVideoFile(file.path)) {
        loadVideo(file.path);
      } else {
        alert('유효한 비디오 파일만 업로드할 수 있습니다.');
      }
    }
  });
  
  uploadButton.addEventListener('click', async () => {
    const filePath = await ipcRenderer.invoke('open-file-dialog');
    if (filePath) {
      loadVideo(filePath);
    }
  });
  
  // 감지 설정 이벤트
  amplitudeThresholdInput.addEventListener('input', () => {
    amplitudeThresholdValue.textContent = amplitudeThresholdInput.value;
  });
  
  // 분석 버튼 이벤트
  analyzeButton.addEventListener('click', async () => {
    if (!currentVideoPath || isAnalyzing) return;
    
    try {
      isAnalyzing = true;
      showLoading('오디오 분석 준비 중...');
      
      if (!audioPath) {
        audioPath = await extractAudio(currentVideoPath);
      }
      
      // 파형 데이터 처리
      try {
        updateLoadingMessage('오디오 파일 읽는 중...');
        
        // 분석 로그 표시를 위한 콘솔 프록시
        const originalConsoleLog = console.log;
        console.log = function() {
          const args = Array.from(arguments).join(' ');
          updateLoadingMessage(args);
          originalConsoleLog.apply(console, arguments);
        };
        
        // 파일 크기 확인 및 경고
        const fileStat = fs.statSync(audioPath);
        const fileSizeMB = fileStat.size / (1024 * 1024);
        
        if (fileSizeMB > 50) {
          updateLoadingMessage(`큰 파일 (${fileSizeMB.toFixed(2)} MB) 처리 중. 다소 시간이 걸릴 수 있습니다...`);
        }
        
        waveformData = await audioAnalyzer.getWaveformData(audioPath);
        
        // 사용자 설정 가져오기
        const customOptions = {
          amplitudeThreshold: parseFloat(amplitudeThresholdInput.value),
          minBellInterval: parseInt(minBellIntervalInput.value)
        };
        
        // 벨 소리 감지
        bellTimestamps = audioAnalyzer.detectBellSounds(waveformData, customOptions);
        
        // 콘솔 원래대로 복원
        console.log = originalConsoleLog;
        
        // 분석 결과 마크 표시 (파형에 벨 소리 지점 표시)
        displayWaveformMarkers(bellTimestamps);
        
        // 영상 분할 버튼 활성화
        processButton.disabled = bellTimestamps.length === 0;
        
        hideLoading();
        isAnalyzing = false;
        
        if (bellTimestamps.length === 0) {
          alert('벨 소리가 감지되지 않았습니다. 임계값을 낮추고 다시 시도해보세요.');
        } else {
          alert(`${bellTimestamps.length}개의 벨 소리가 감지되었습니다.`);
        }
      } catch (error) {
        console.error('파형 분석 중 오류:', error);
        hideLoading();
        isAnalyzing = false;
        alert(`파형 분석 중 오류가 발생했습니다: ${error.message}`);
      }
    } catch (error) {
      hideLoading();
      isAnalyzing = false;
      alert('오디오 분석 중 오류가 발생했습니다: ' + error.message);
      console.error(error);
    }
  });
  
  // 영상 분할 버튼 이벤트
  processButton.addEventListener('click', async () => {
    if (!currentVideoPath || bellTimestamps.length === 0) return;
    
    try {
      showLoading('영상 분할 중...');
      
      // 첫 번째와 마지막 타임스탬프 추가 (영상 시작과 끝)
      const allTimestamps = [0, ...bellTimestamps];
      
      // 영상 분할 처리
      updateLoadingMessage('FFmpeg로 영상 분할 중... (분할 수에 따라 시간이 걸릴 수 있습니다)');
      const result = await ipcRenderer.invoke('process-video', currentVideoPath, allTimestamps);
      videoSegments = result.segments;
      
      // 분할된 영상 목록 표시
      displaySegments(videoSegments);
      
      segmentsContainer.style.display = 'block';
      hideLoading();
    } catch (error) {
      hideLoading();
      alert('영상 분할 중 오류가 발생했습니다: ' + error.message);
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
    videoPlayer.style.display = 'block';
    uploadArea.style.display = 'none';
    
    // 비디오 정보 가져오기
    const filename = path.basename(filePath);
    const fileSize = fs.statSync(filePath).size;
    const fileSizeMB = (fileSize / (1024 * 1024)).toFixed(2);
    
    // 오디오 추출
    showLoading(`오디오 추출 중... (${filename}, ${fileSizeMB} MB)`);
    audioPath = await extractAudio(filePath);
    
    // 파형 표시
    waveformContainer.style.display = 'block';
    
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
        <p class="note">${audioFileSizeMB > 30 ? '⚠️ 큰 파일은 분석 시간이 오래 걸릴 수 있습니다.' : ''}</p>
      </div>`;
    } catch (error) {
      console.error('파형 시각화 초기화 오류:', error);
    }
    
    // 분석 버튼 활성화
    analyzeButton.disabled = false;
    
    hideLoading();
  } catch (error) {
    hideLoading();
    alert('비디오 로드 중 오류가 발생했습니다: ' + error.message);
    console.error(error);
  }
}

// 오디오 추출 함수
async function extractAudio(videoPath) {
  return await ipcRenderer.invoke('extract-audio', videoPath);
}

// 파형에 벨 소리 마커 표시 함수
function displayWaveformMarkers(timestamps) {
  // 간단한 시각화로 대체
  const totalDuration = videoPlayer.duration || 0;
  
  let markersHTML = '<div class="waveform-container">';
  markersHTML += '<div class="waveform-timeline">';
  
  if (totalDuration > 0) {
    timestamps.forEach(timestamp => {
      const position = (timestamp / totalDuration) * 100;
      markersHTML += `<div class="bell-marker" style="left: ${position}%" title="벨 소리: ${formatTime(timestamp)}"></div>`;
    });
  }
  
  markersHTML += '</div>';
  
  if (timestamps.length === 0) {
    markersHTML += `<p class="no-bells">벨 소리가 감지되지 않았습니다. 임계값을 낮춰보세요.</p>`;
  } else {
    markersHTML += `<p>총 ${timestamps.length}개의 벨 소리가 감지되었습니다.</p>`;
    markersHTML += '<ul class="timestamps-list">';
    
    timestamps.forEach((timestamp, index) => {
      markersHTML += `<li>벨 소리 #${index + 1}: ${formatTime(timestamp)}</li>`;
    });
    
    markersHTML += '</ul>';
  }
  
  markersHTML += '</div>';
  
  waveformEl.innerHTML = markersHTML;
  
  // CSS 추가
  const style = document.createElement('style');
  style.textContent = `
    .waveform-container {
      width: 100%;
      padding: 10px;
    }
    .waveform-timeline {
      height: 50px;
      background-color: #f0f0f0;
      position: relative;
      border-radius: 4px;
      margin-bottom: 15px;
    }
    .bell-marker {
      position: absolute;
      width: 4px;
      height: 100%;
      background-color: red;
      cursor: pointer;
    }
    .timestamps-list {
      max-height: 150px;
      overflow-y: auto;
      margin-top: 10px;
      padding-left: 20px;
    }
    .waveform-placeholder {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 150px;
      background-color: #f8f9fa;
      border-radius: 4px;
      color: #666;
      padding: 20px;
    }
    .waveform-placeholder h3 {
      margin-bottom: 10px;
      color: #333;
    }
    .waveform-placeholder .note {
      color: #e74c3c;
      margin-top: 10px;
      font-weight: bold;
    }
    .no-bells {
      color: #e74c3c;
      font-weight: bold;
      text-align: center;
      margin: 20px 0;
    }
  `;
  document.head.appendChild(style);
}

// 분할된 세그먼트 표시 함수
function displaySegments(segments) {
  segmentsList.innerHTML = '';
  
  segments.forEach(segment => {
    const segmentEl = document.createElement('div');
    segmentEl.className = 'segment-item';
    
    // 템플릿 복제
    const template = document.getElementById('segmentTemplate');
    const segmentContent = template.content.cloneNode(true);
    
    // 데이터 채우기
    segmentContent.querySelector('.segment-id').textContent = segment.id;
    segmentContent.querySelector('.segment-start').textContent = formatTime(segment.startTime);
    segmentContent.querySelector('.segment-end').textContent = formatTime(segment.endTime);
    segmentContent.querySelector('.segment-duration').textContent = formatTime(segment.duration);
    
    const video = segmentContent.querySelector('video');
    video.src = `file://${segment.path}`;
    
    // 저장 버튼 이벤트
    segmentContent.querySelector('.btn-save').addEventListener('click', () => {
      saveSegment(segment.path);
    });
    
    // 삭제 버튼 이벤트
    segmentContent.querySelector('.btn-delete').addEventListener('click', () => {
      deleteSegment(segment);
    });
    
    segmentEl.appendChild(segmentContent);
    segmentsList.appendChild(segmentEl);
  });
}

// 세그먼트 저장 함수
async function saveSegment(segmentPath) {
  try {
    showLoading('세그먼트 저장 중...');
    const result = await ipcRenderer.invoke('save-segment', segmentPath);
    hideLoading();
    
    if (result.success) {
      alert('세그먼트가 성공적으로 저장되었습니다.');
    } else {
      alert('세그먼트 저장 실패: ' + result.error);
    }
  } catch (error) {
    hideLoading();
    alert('세그먼트 저장 중 오류가 발생했습니다: ' + error.message);
    console.error(error);
  }
}

// 세그먼트 삭제 함수
async function deleteSegment(segment) {
  if (confirm(`세그먼트 ${segment.id}를 삭제하시겠습니까?`)) {
    try {
      showLoading('세그먼트 삭제 중...');
      const result = await ipcRenderer.invoke('delete-segment', segment.path);
      hideLoading();
      
      if (result.success) {
        // 목록에서 제거
        videoSegments = videoSegments.filter(s => s.id !== segment.id);
        displaySegments(videoSegments);
        alert('세그먼트가 삭제되었습니다.');
      } else {
        alert('세그먼트 삭제 실패: ' + result.error);
      }
    } catch (error) {
      hideLoading();
      alert('세그먼트 삭제 중 오류가 발생했습니다: ' + error.message);
      console.error(error);
    }
  }
}

// 유틸리티 함수
function isVideoFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return ['.mp4', '.avi', '.mov', '.mkv'].includes(ext);
}

function formatTime(seconds) {
  const min = Math.floor(seconds / 60);
  const sec = Math.floor(seconds % 60);
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function showLoading(message = '처리 중...') {
  loadingText.textContent = message;
  loadingOverlay.style.display = 'flex';
}

function hideLoading() {
  loadingOverlay.style.display = 'none';
}

function updateLoadingMessage(message) {
  loadingText.textContent = message;
} 