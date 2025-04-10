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
      amplitudeThreshold: 0.65,
      // 벨 소리 주파수 범위 (Hz)
      minFrequency: 700,
      maxFrequency: 1500,
      // 최소 벨 소리 길이 (밀리초)
      minBellDuration: 50,
      // 최대 벨 소리 길이 (밀리초)
      maxBellDuration: 2000,
      // 벨 소리 간 최소 간격 (초)
      minBellInterval: 30
    };
    
    // 디버깅 정보 저장
    this.debug = {
      candidateBells: [], // 임계값을 넘은 모든 후보 벨 소리들
      rejectedBells: [],  // 길이나 간격 조건으로 제외된 벨 소리들
      acceptedBells: []   // 최종 채택된 벨 소리들
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
          console.log(`오디오 정보: 길이=${audioBuffer.duration.toFixed(2)}초, 채널=${audioBuffer.numberOfChannels}, 샘플레이트=${audioBuffer.sampleRate}Hz`);
          
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
          console.log(`파형 데이터 정보: 길이=${waveform.length}포인트, 샘플레이트=${waveform.sample_rate}Hz`);
          
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
   * 파형 데이터에서 벨 소리 감지 (향상된 알고리즘)
   * @param {WaveformData} waveformData 파형 데이터
   * @param {Object} options 감지 옵션
   * @returns {Array<number>} 벨 소리 시작 타임스탬프 (초 단위)
   */
  detectBellSounds(waveformData, customOptions = {}) {
    console.log('벨 소리 감지 시작...');
    const startTime = Date.now();
    
    // 옵션 설정
    const options = { ...this.options, ...customOptions };
    console.log('벨 소리 감지 옵션:', JSON.stringify(options, null, 2));
    
    // 결과 초기화
    const bellTimestamps = [];
    this.debug.candidateBells = [];
    this.debug.rejectedBells = [];
    this.debug.acceptedBells = [];
    
    // 채널 데이터 및 기본 정보
    const channel = waveformData.channel(0);
    const sampleRate = waveformData.sample_rate;
    const totalSamples = channel.length;
    
    // 진폭 데이터 수집 (전체 파형의 진폭 정보를 수집하여 분석)
    console.log('진폭 데이터 수집 중...');
    const amplitudes = [];
    for (let i = 0; i < totalSamples; i++) {
      amplitudes.push(Math.abs(channel.max_sample(i)));
    }
    
    // 신호의 통계적 정보 계산
    const maxAmplitude = Math.max(...amplitudes);
    const avgAmplitude = amplitudes.reduce((sum, a) => sum + a, 0) / amplitudes.length;
    
    console.log(`신호 분석: 최대진폭=${maxAmplitude.toFixed(3)}, 평균진폭=${avgAmplitude.toFixed(3)}, 임계값=${options.amplitudeThreshold.toFixed(3)}`);
    
    // 자동 임계값 조정 (필요한 경우)
    let effectiveThreshold = options.amplitudeThreshold;
    
    // 만약 최대 진폭이 임계값보다 낮다면 적응형 임계값 적용
    if (maxAmplitude < effectiveThreshold) {
      effectiveThreshold = Math.max(0.5, maxAmplitude * 0.8);
      console.log(`최대 진폭이 임계값보다 낮습니다. 임계값을 ${effectiveThreshold.toFixed(3)}로 조정합니다.`);
    }
    
    // 강한 윈도우 슬라이딩 접근법을 사용하여 벨 소리 패턴 감지
    console.log('패턴 분석을 통한 벨 소리 감지 중...');
    
    // 윈도우 크기 계산 (벨 소리의 최소 및 최대 길이에 따라)
    const minBellSamples = Math.floor((options.minBellDuration / 1000) * sampleRate);
    const maxBellSamples = Math.ceil((options.maxBellDuration / 1000) * sampleRate);
    
    // 벨 감지 상태 변수
    let inBell = false;
    let bellStart = 0;
    let bellEnd = 0;
    let bellPeakAmplitude = 0;
    let consecutiveHighAmplitudeSamples = 0;
    let minConsecutiveHighSamples = 3; // 복싱 벨소리를 더 잘 감지하기 위해 더 낮게 설정
    
    // 마지막 감지된 벨 시간
    let lastBellTime = -options.minBellInterval;
    
    // 임시 벨 후보들 저장 (나중에 그룹화를 위해)
    const tempBellCandidates = [];
    
    // 진행 상황 보고용 변수
    const progressStep = Math.max(1, Math.floor(totalSamples / 20)); // 5% 단위
    
    // 모든 샘플을 분석
    for (let i = 0; i < totalSamples; i++) {
      // 진행 상황 보고
      if (i % progressStep === 0) {
        const percentage = Math.floor((i / totalSamples) * 100);
        console.log(`벨 소리 감지 진행: ${percentage}%`);
      }
      
      const amplitude = amplitudes[i];
      const time = i / sampleRate;
      
      // 임계값 이상의 진폭을 가진 샘플 감지
      if (amplitude >= effectiveThreshold) {
        if (!inBell) {
          // 새로운 벨 시작
          inBell = true;
          bellStart = i;
          bellPeakAmplitude = amplitude;
          consecutiveHighAmplitudeSamples = 1;
        } else {
          // 진행 중인 벨의 피크 업데이트
          consecutiveHighAmplitudeSamples++;
          if (amplitude > bellPeakAmplitude) {
            bellPeakAmplitude = amplitude;
          }
        }
      } else {
        // 임계값 미만의 진폭
        if (inBell) {
          // 충분한 높은 진폭 샘플이 있는지 확인
          if (consecutiveHighAmplitudeSamples >= minConsecutiveHighSamples) {
            // 벨 종료
            bellEnd = i;
            const bellDuration = (bellEnd - bellStart) / sampleRate;
            const bellStartTime = bellStart / sampleRate;
            
            // 임시 벨 후보 저장
            tempBellCandidates.push({
              start: bellStartTime,
              end: bellStartTime + bellDuration,
              duration: bellDuration,
              peakAmplitude: bellPeakAmplitude,
              samples: consecutiveHighAmplitudeSamples
            });
            
            // 디버깅 로그
            console.log(`벨 후보 발견: ${bellStartTime.toFixed(3)}초, 길이: ${bellDuration.toFixed(3)}초, 진폭: ${bellPeakAmplitude.toFixed(3)}, 샘플 수: ${consecutiveHighAmplitudeSamples}`);
          } else {
            // 연속된 높은 진폭 샘플이 충분하지 않으면 로그만
            if (consecutiveHighAmplitudeSamples > 0) {
              const bellStartTime = bellStart / sampleRate;
              console.log(`짧은 후보 무시: ${bellStartTime.toFixed(3)}초, 샘플 수: ${consecutiveHighAmplitudeSamples}`);
            }
          }
          
          // 상태 초기화
          inBell = false;
          consecutiveHighAmplitudeSamples = 0;
        }
      }
    }
    
    // 마지막 남은 벨 처리
    if (inBell && consecutiveHighAmplitudeSamples >= minConsecutiveHighSamples) {
      bellEnd = totalSamples - 1;
      const bellDuration = (bellEnd - bellStart) / sampleRate;
      const bellStartTime = bellStart / sampleRate;
      
      tempBellCandidates.push({
        start: bellStartTime,
        end: bellStartTime + bellDuration,
        duration: bellDuration,
        peakAmplitude: bellPeakAmplitude,
        samples: consecutiveHighAmplitudeSamples
      });
      
      console.log(`마지막 벨 후보 발견: ${bellStartTime.toFixed(3)}초, 길이: ${bellDuration.toFixed(3)}초, 진폭: ${bellPeakAmplitude.toFixed(3)}, 샘플 수: ${consecutiveHighAmplitudeSamples}`);
    }
    
    // 서로 가까운 벨 후보들을 그룹화하여 하나의 벨로 만들기
    console.log(`총 ${tempBellCandidates.length}개의 벨 후보를 그룹화합니다...`);
    const groupedBells = this._groupBellCandidates(tempBellCandidates, 0.5); // 0.5초 이내 후보들은 그룹화
    
    // 그룹화된 벨 후보들을 처리
    for (const bell of groupedBells) {
      this.debug.candidateBells.push(bell);
      
      // 벨 길이 조건 확인 (최소 길이는 매우 짧게 설정)
      const effectiveMinDuration = 0.03; // 30ms
      
      if (bell.duration >= effectiveMinDuration && 
          bell.duration <= options.maxBellDuration / 1000) {
        
        // 이전 벨과의 간격 확인
        if (bell.start - lastBellTime >= options.minBellInterval) {
          // 벨 소리로 채택
          bellTimestamps.push(bell.start);
          lastBellTime = bell.start;
          
          this.debug.acceptedBells.push(bell);
          
          console.log(`벨 소리 감지: ${bell.start.toFixed(2)}초, 길이: ${bell.duration.toFixed(2)}초, 진폭: ${bell.peakAmplitude.toFixed(3)}, 그룹화됨: ${bell.grouped ? 'Yes' : 'No'}`);
        } else {
          // 간격 조건으로 거부
          this.debug.rejectedBells.push({
            ...bell,
            reason: '최소 간격 미달',
            interval: bell.start - lastBellTime
          });
        }
      } else {
        // 길이 조건으로 거부
        this.debug.rejectedBells.push({
          ...bell,
          reason: '길이 조건 미달',
          minDuration: effectiveMinDuration,
          maxDuration: options.maxBellDuration / 1000
        });
      }
    }
    
    // 분석 결과 요약
    console.log(`벨 소리 감지 완료. 소요 시간: ${(Date.now() - startTime) / 1000}초`);
    console.log(`총 후보 벨 소리: ${this.debug.candidateBells.length}개`);
    console.log(`거부된 벨 소리: ${this.debug.rejectedBells.length}개`);
    console.log(`감지된 벨 소리: ${bellTimestamps.length}개`);
    
    if (bellTimestamps.length === 0) {
      console.log('주의: 벨 소리가 감지되지 않았습니다.');
      console.log('임계값을 낮추거나 (현재: ' + effectiveThreshold.toFixed(2) + ') 길이 조건을 조정해보세요.');
      
      // 후보 벨들의 진폭 정보 출력
      if (this.debug.candidateBells.length > 0) {
        console.log('후보 벨 소리들의 진폭 정보:');
        this.debug.candidateBells.forEach(bell => {
          console.log(`시작: ${bell.start.toFixed(2)}초, 진폭: ${bell.peakAmplitude.toFixed(3)}, 길이: ${bell.duration.toFixed(2)}초, 그룹화됨: ${bell.grouped ? 'Yes' : 'No'}`);
        });
      }
      
      // 거부된 벨들의 정보 출력
      if (this.debug.rejectedBells.length > 0) {
        console.log('거부된 벨 소리 정보:');
        this.debug.rejectedBells.forEach(bell => {
          console.log(`시작: ${bell.start.toFixed(2)}초, 진폭: ${bell.peakAmplitude.toFixed(3)}, 길이: ${bell.duration.toFixed(2)}초, 거부 이유: ${bell.reason}`);
        });
      }
      
      // 진폭 임계값 자동 조정 제안
      if (this.debug.candidateBells.length > 0) {
        const suggestedThreshold = Math.max(
          0.05,
          this.debug.candidateBells.reduce((min, b) => Math.min(min, b.peakAmplitude), 1) * 0.9
        );
        console.log(`제안: 진폭 임계값을 ${suggestedThreshold.toFixed(2)}로 시도해보세요.`);
      } else if (maxAmplitude > 0) {
        // 후보가 없다면 최대 진폭의 60%를 제안
        const suggestedThreshold = Math.max(0.05, maxAmplitude * 0.6);
        console.log(`제안: 진폭 임계값을 ${suggestedThreshold.toFixed(2)}로 시도해보세요.`);
      }
    }
    
    return bellTimestamps;
  }

  /**
   * 근접한 벨 후보들을 그룹화하는 함수
   * @param {Array<Object>} candidates 벨 후보 목록
   * @param {number} maxGap 최대 허용 간격 (초)
   * @returns {Array<Object>} 그룹화된 벨 후보 목록
   * @private
   */
  _groupBellCandidates(candidates, maxGap) {
    if (candidates.length <= 1) return candidates;
    
    // 시작 시간으로 정렬
    candidates.sort((a, b) => a.start - b.start);
    
    const result = [];
    let currentGroup = { ...candidates[0], grouped: false };
    
    for (let i = 1; i < candidates.length; i++) {
      const current = candidates[i];
      
      // 현재 그룹과 현재 후보 사이의 간격 계산
      const gap = current.start - currentGroup.end;
      
      if (gap <= maxGap) {
        // 그룹화
        currentGroup.end = Math.max(currentGroup.end, current.end);
        currentGroup.duration = currentGroup.end - currentGroup.start;
        currentGroup.peakAmplitude = Math.max(currentGroup.peakAmplitude, current.peakAmplitude);
        currentGroup.samples += current.samples;
        currentGroup.grouped = true;
        
        console.log(`후보 그룹화: ${current.start.toFixed(3)}초 후보를 ${currentGroup.start.toFixed(3)}초 그룹에 병합`);
      } else {
        // 이전 그룹 저장하고 새 그룹 시작
        result.push(currentGroup);
        currentGroup = { ...current, grouped: false };
      }
    }
    
    // 마지막 그룹 추가
    result.push(currentGroup);
    
    console.log(`${candidates.length}개의 후보를 ${result.length}개의 그룹으로 통합했습니다.`);
    return result;
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
    let sumAmplitude = 0;
    let sampleCount = 0;
    
    for (let i = 0; i < channel.length; i += samplingRate) {
      const amplitude = Math.abs(channel.max_sample(i));
      maxAmplitude = Math.max(maxAmplitude, amplitude);
      sumAmplitude += amplitude;
      sampleCount++;
    }
    
    const avgAmplitude = sumAmplitude / sampleCount;
    
    // 진폭 히스토그램 생성 (더 정교한 임계값 설정 위해)
    const histogram = new Array(10).fill(0);
    for (let i = 0; i < channel.length; i += samplingRate) {
      const amplitude = Math.abs(channel.max_sample(i));
      const bin = Math.min(9, Math.floor(amplitude * 10));
      histogram[bin]++;
    }
    
    // 히스토그램 분석 (노이즈와 신호를 구분할 수 있는 지점 찾기)
    let significantBin = 0;
    for (let i = 9; i >= 0; i--) {
      if (histogram[i] > sampleCount * 0.01) { // 1% 이상의 샘플
        significantBin = i;
        break;
      }
    }
    
    // 최적의 임계값 계산 (통계 기반)
    // 최대 진폭의 40%와 히스토그램 기반 분석의 중간값
    const histogramThreshold = (significantBin / 10) * 0.8;
    const amplitudeThreshold = Math.max(
      avgAmplitude * 2,           // 평균 진폭의 2배
      maxAmplitude * 0.4,         // 최대 진폭의 40%
      histogramThreshold          // 히스토그램 기반 임계값
    );
    
    console.log(`진폭 분석: 최대=${maxAmplitude.toFixed(3)}, 평균=${avgAmplitude.toFixed(3)}`);
    console.log(`임계값 계산: 평균기반=${(avgAmplitude * 2).toFixed(3)}, 최대기반=${(maxAmplitude * 0.4).toFixed(3)}, 히스토그램기반=${histogramThreshold.toFixed(3)}`);
    console.log(`설정 최적화 완료. 임계값: ${amplitudeThreshold.toFixed(3)}`);
    
    return {
      ...this.options,
      amplitudeThreshold
    };
  }
  
  /**
   * 디버깅 정보 가져오기
   * @returns {Object} 디버깅 정보
   */
  getDebugInfo() {
    return this.debug;
  }
}

module.exports = new AudioAnalyzer(); 