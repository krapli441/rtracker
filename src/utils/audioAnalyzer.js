const fs = require('fs');
const path = require('path');
const WaveformData = require('waveform-data');
let AudioContext;

// Node.js와 브라우저 환경에서의 오디오 컨텍스트 설정
try {
  // 브라우저/Electron 렌더러 환경
  if (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)) {
    AudioContext = window.AudioContext || window.webkitAudioContext;
  } else {
    // Node.js 환경
    const WebAudioAPI = require('web-audio-api');
    AudioContext = WebAudioAPI.AudioContext;
  }
} catch (error) {
  console.error('AudioContext 초기화 오류:', error);
}

/**
 * 벨 소리 감지를 위한 오디오 분석 클래스
 */
class AudioAnalyzer {
  constructor() {
    this.options = {
      // 기본 설정값
      // 벨 소리 감지를 위한 진폭 임계값
      amplitudeThreshold: 0.75,
      // 벨 소리 주파수 범위 (Hz)
      minFrequency: 700,
      maxFrequency: 1500,
      // 최소 벨 소리 길이 (밀리초)
      minBellDuration: 200,
      // 최대 벨 소리 길이 (밀리초)
      maxBellDuration: 2000,
      // 벨 소리 간 최소 간격 (초)
      minBellInterval: 30
    };
  }

  /**
   * 오디오 파일에서 파형 데이터 추출
   * @param {string} audioPath 오디오 파일 경로
   * @returns {Promise<WaveformData>} 파형 데이터
   */
  async getWaveformData(audioPath) {
    return new Promise((resolve, reject) => {
      try {
        if (!AudioContext) {
          return reject(new Error('AudioContext를 초기화할 수 없습니다. 브라우저 환경에서 실행해주세요.'));
        }

        // 파일 크기 확인
        const fileStat = fs.statSync(audioPath);
        const fileSizeMB = fileStat.size / (1024 * 1024);
        
        // 30MB 이상이면 다운샘플링 경고
        if (fileSizeMB > 30) {
          console.warn(`큰 오디오 파일 (${fileSizeMB.toFixed(2)} MB)를 처리합니다. 다운샘플링을 적용합니다.`);
        }

        // 최대 분석 시간 설정 (메모리 초과 방지)
        const MAX_ANALYZE_TIME = 120; // 초 (2분)
        
        // Node.js 환경에서 파일 읽기
        const audioData = fs.readFileSync(audioPath);
        
        // 오디오 버퍼 생성을 위한 AudioContext 생성
        const audioContext = new AudioContext();
        
        // ArrayBuffer로 변환
        const arrayBuffer = new Uint8Array(audioData).buffer;
        
        // 오디오 디코딩 - 진행 상황 로깅 추가
        console.log('오디오 디코딩 시작...');
        const startTime = Date.now();
        
        audioContext.decodeAudioData(arrayBuffer, (audioBuffer) => {
          console.log(`오디오 디코딩 완료. 소요 시간: ${(Date.now() - startTime) / 1000}초`);
          
          // 만약 오디오 길이가 너무 길면 다운샘플링 적용
          let processedBuffer = audioBuffer;
          
          if (audioBuffer.duration > MAX_ANALYZE_TIME) {
            console.log(`오디오 길이(${audioBuffer.duration.toFixed(2)}초)가 너무 깁니다. 다운샘플링 적용...`);
            processedBuffer = this._downsampleAudioBuffer(audioBuffer, MAX_ANALYZE_TIME);
          }
          
          // WaveformData 생성
          console.log('파형 데이터 생성 중...');
          const downsampleStartTime = Date.now();
          
          // 오디오 버퍼에서 파형 데이터 직접 생성 (waveform-data 라이브러리 호환성 문제 해결)
          const waveform = this._createWaveformDataFromAudioBuffer(processedBuffer);
          
          console.log(`파형 데이터 생성 완료. 소요 시간: ${(Date.now() - downsampleStartTime) / 1000}초`);
          
          resolve(waveform);
        }, (err) => {
          reject(new Error(`오디오 디코딩 실패: ${err ? err.message : '알 수 없는 오류'}`));
        });
      } catch (error) {
        reject(new Error(`파형 데이터 생성 실패: ${error.message}`));
      }
    });
  }

  /**
   * 오디오 버퍼에서 직접 WaveformData 객체 생성
   * @param {AudioBuffer} audioBuffer 오디오 버퍼
   * @returns {Object} 파형 데이터와 호환되는 객체
   * @private
   */
  _createWaveformDataFromAudioBuffer(audioBuffer) {
    // 채널 데이터 가져오기 (모노로 다운믹스)
    const channel = audioBuffer.getChannelData(0);
    const length = channel.length;
    const sampleRate = audioBuffer.sampleRate;
    
    // 데이터 포인트 수 줄이기 (성능 향상을 위해)
    const maxPoints = 10000;
    const skipFactor = Math.max(1, Math.floor(length / maxPoints));
    
    // 샘플 데이터 저장 배열
    const minSamples = [];
    const maxSamples = [];
    
    for (let i = 0; i < length; i += skipFactor) {
      // 각 포인트에서 최소/최대값 계산
      let min = channel[i];
      let max = channel[i];
      
      for (let j = 0; j < skipFactor && i + j < length; j++) {
        const value = channel[i + j];
        min = Math.min(min, value);
        max = Math.max(max, value);
      }
      
      minSamples.push(min);
      maxSamples.push(max);
    }
    
    // WaveformData 인터페이스와 호환되는 객체 반환
    return {
      sample_rate: sampleRate,
      samples_per_pixel: skipFactor,
      length: minSamples.length,
      channel: function(idx) {
        return {
          min_sample: function(idx) {
            return minSamples[idx];
          },
          max_sample: function(idx) {
            return maxSamples[idx];
          },
          length: minSamples.length
        };
      }
    };
  }

  /**
   * 오디오 버퍼의 다운샘플링을 수행하여 분석 속도 향상
   * @param {AudioBuffer} audioBuffer 원본 오디오 버퍼
   * @param {number} maxDuration 최대 분석 시간 (초)
   * @returns {AudioBuffer} 다운샘플링된 오디오 버퍼
   * @private
   */
  _downsampleAudioBuffer(audioBuffer, maxDuration) {
    // 다운샘플링 비율 계산
    const downsampleRatio = maxDuration / audioBuffer.duration;
    
    // 새 버퍼 생성 (시간 축소)
    const newLength = Math.floor(audioBuffer.length * downsampleRatio);
    const newChannels = [];
    
    // 각 채널 다운샘플링
    for (let c = 0; c < audioBuffer.numberOfChannels; c++) {
      const originalData = audioBuffer.getChannelData(c);
      const newData = new Float32Array(newLength);
      
      for (let i = 0; i < newLength; i++) {
        // 원본 인덱스 계산 (간단한 선형 보간)
        const originalIndex = Math.floor(i / downsampleRatio);
        newData[i] = originalData[originalIndex];
      }
      
      newChannels.push(newData);
    }
    
    // 새 오디오 버퍼 생성
    const ctx = new AudioContext();
    const newBuffer = ctx.createBuffer(
      audioBuffer.numberOfChannels,
      newLength,
      audioBuffer.sampleRate
    );
    
    // 채널 데이터 복사
    for (let c = 0; c < newBuffer.numberOfChannels; c++) {
      newBuffer.getChannelData(c).set(newChannels[c]);
    }
    
    return newBuffer;
  }

  /**
   * 파형 데이터에서 벨 소리 감지
   * @param {WaveformData} waveformData 파형 데이터
   * @param {Object} options 감지 옵션
   * @returns {Array<number>} 벨 소리 시작 타임스탬프 (초 단위)
   */
  detectBellSounds(waveformData, customOptions = {}) {
    console.log('벨 소리 감지 시작...');
    const startTime = Date.now();
    
    const options = { ...this.options, ...customOptions };
    const bellTimestamps = [];
    
    const channel = waveformData.channel(0);
    const sampleRate = waveformData.sample_rate;
    const totalSamples = channel.length;
    
    // 계산량 줄이기 위해 샘플 스킵 간격 결정
    // 크기에 따라 더 효율적인 처리
    const sampleSkip = totalSamples > 1000000 ? 10 : 1;
    
    // 진행 로깅 위한 변수
    const logInterval = Math.floor(totalSamples / 10); // 10% 단위로 진행상황 보고
    
    let inBell = false;
    let bellStartSample = 0;
    let bellDurationSamples = 0;
    let lastBellTimestamp = -options.minBellInterval;
    
    // 파형 샘플을 순회하며 벨 소리 패턴 감지 (건너뛰며 분석)
    for (let i = 0; i < totalSamples; i += sampleSkip) {
      // 진행 상황 로깅
      if (i % logInterval === 0) {
        const percentage = Math.floor((i / totalSamples) * 100);
        console.log(`벨 소리 감지 진행: ${percentage}%`);
      }
      
      const amplitude = Math.abs(channel.max_sample(i));
      
      // 임계값을 넘는 진폭 감지
      if (amplitude > options.amplitudeThreshold) {
        if (!inBell) {
          inBell = true;
          bellStartSample = i;
        }
        bellDurationSamples += sampleSkip;
      } else if (inBell) {
        // 벨 소리가 끝남
        inBell = false;
        
        // 벨 소리 길이가 유효한지 확인
        const bellDurationMs = (bellDurationSamples / sampleRate) * 1000;
        
        if (bellDurationMs >= options.minBellDuration && 
            bellDurationMs <= options.maxBellDuration) {
          
          const bellTimestamp = bellStartSample / sampleRate;
          
          // 이전 벨 소리와의 간격 확인
          if (bellTimestamp - lastBellTimestamp >= options.minBellInterval) {
            bellTimestamps.push(bellTimestamp);
            lastBellTimestamp = bellTimestamp;
          }
        }
        
        bellDurationSamples = 0;
      }
    }
    
    console.log(`벨 소리 감지 완료. 소요 시간: ${(Date.now() - startTime) / 1000}초`);
    console.log(`감지된 벨 소리 수: ${bellTimestamps.length}`);
    
    return bellTimestamps;
  }

  /**
   * 오디오 특성 분석을 통한 벨 소리 감지 설정 최적화
   * @param {WaveformData} waveformData 파형 데이터
   * @returns {Object} 최적화된 감지 옵션
   */
  optimizeDetectionSettings(waveformData) {
    console.log('감지 설정 최적화 중...');
    
    const channel = waveformData.channel(0);
    
    // 샘플링을 통한 효율적인 최대 진폭 계산
    const samplingRate = Math.max(1, Math.floor(channel.length / 1000)); // 최대 1000 포인트만 샘플링
    let maxAmplitude = 0;
    
    for (let i = 0; i < channel.length; i += samplingRate) {
      maxAmplitude = Math.max(maxAmplitude, Math.abs(channel.max_sample(i)));
    }
    
    // 최대 진폭의 70%를 임계값으로 설정
    const amplitudeThreshold = maxAmplitude * 0.7;
    
    console.log(`설정 최적화 완료. 임계값: ${amplitudeThreshold.toFixed(3)}`);
    
    return {
      ...this.options,
      amplitudeThreshold
    };
  }
}

module.exports = new AudioAnalyzer(); 