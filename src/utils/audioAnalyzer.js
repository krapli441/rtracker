const fs = require("fs");
const path = require("path");
const WaveformData = require("waveform-data");
const FFT = require("fft-js").fft;
const FFTUtil = require("fft-js").util;
let AudioContext;

// Node.js와 브라우저 환경에서의 오디오 컨텍스트 설정
try {
  // 브라우저/Electron 렌더러 환경
  if (
    typeof window !== "undefined" &&
    (window.AudioContext || window.webkitAudioContext)
  ) {
    AudioContext = window.AudioContext || window.webkitAudioContext;
  } else {
    // Node.js 환경
    const WebAudioAPI = require("web-audio-api");
    AudioContext = WebAudioAPI.AudioContext;
  }
} catch (error) {
  console.error("AudioContext 초기화 오류:", error);
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
      minBellInterval: 30,
      // 주파수 분석을 위한 FFT 윈도우 크기
      fftSize: 2048,
      // 복싱 벨 소리의 특징적인 주파수 범위 (Hz)
      boxingBellMinFreq: 800,
      boxingBellMaxFreq: 1200,
      // 주파수 에너지 임계값 (0-1 사이 값)
      frequencyEnergyThreshold: 0.6,
      // 패턴 매칭 유사도 임계값 (0-1 사이 값)
      patternSimilarityThreshold: 0.7,
    };

    // 디버깅 정보 저장
    this.debug = {
      candidateBells: [], // 임계값을 넘은 모든 후보 벨 소리들
      rejectedBells: [], // 길이나 간격 조건으로 제외된 벨 소리들
      acceptedBells: [], // 최종 채택된 벨 소리들
      frequencyData: [], // 주파수 분석 데이터
    };

    // 복싱 벨 소리의 전형적인 패턴 템플릿 (진폭 변화 패턴)
    this.bellPatternTemplate = [
      1.0, 0.95, 0.9, 0.85, 0.8, 0.75, 0.7, 0.65, 0.6, 0.55, 0.5, 0.45, 0.4,
      0.35, 0.3, 0.25, 0.2, 0.15, 0.1, 0.05,
    ];
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
          return reject(
            new Error(
              "AudioContext를 초기화할 수 없습니다. 브라우저 환경에서 실행해주세요."
            )
          );
        }

        // 파일 크기 확인
        const fileStat = fs.statSync(audioPath);
        const fileSizeMB = fileStat.size / (1024 * 1024);

        // 30MB 이상이면 다운샘플링 경고
        if (fileSizeMB > 30) {
          console.warn(
            `큰 오디오 파일 (${fileSizeMB.toFixed(
              2
            )} MB)를 처리합니다. 다운샘플링을 적용합니다.`
          );
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
        console.log("오디오 디코딩 시작...");
        const startTime = Date.now();

        audioContext.decodeAudioData(
          arrayBuffer,
          (audioBuffer) => {
            console.log(
              `오디오 디코딩 완료. 소요 시간: ${
                (Date.now() - startTime) / 1000
              }초`
            );
            console.log(
              `오디오 정보: 길이=${audioBuffer.duration.toFixed(2)}초, 채널=${
                audioBuffer.numberOfChannels
              }, 샘플레이트=${audioBuffer.sampleRate}Hz`
            );

            // 만약 오디오 길이가 너무 길면 다운샘플링 적용
            let processedBuffer = audioBuffer;

            if (audioBuffer.duration > MAX_ANALYZE_TIME) {
              console.log(
                `오디오 길이(${audioBuffer.duration.toFixed(
                  2
                )}초)가 너무 깁니다. 다운샘플링 적용...`
              );
              processedBuffer = this._downsampleAudioBuffer(
                audioBuffer,
                MAX_ANALYZE_TIME
              );
            }

            // WaveformData 생성
            console.log("파형 데이터 생성 중...");
            const downsampleStartTime = Date.now();

            // 오디오 버퍼에서 파형 데이터 직접 생성 (waveform-data 라이브러리 호환성 문제 해결)
            const waveform =
              this._createWaveformDataFromAudioBuffer(processedBuffer);

            console.log(
              `파형 데이터 생성 완료. 소요 시간: ${
                (Date.now() - downsampleStartTime) / 1000
              }초`
            );
            console.log(
              `파형 데이터 정보: 길이=${waveform.length}포인트, 샘플레이트=${waveform.sample_rate}Hz`
            );

            resolve(waveform);
          },
          (err) => {
            reject(
              new Error(
                `오디오 디코딩 실패: ${err ? err.message : "알 수 없는 오류"}`
              )
            );
          }
        );
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
      channel: function (idx) {
        return {
          min_sample: function (idx) {
            return minSamples[idx];
          },
          max_sample: function (idx) {
            return maxSamples[idx];
          },
          length: minSamples.length,
        };
      },
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
   * 오디오 데이터에 FFT를 적용하여 주파수 분석 수행
   * @param {Float32Array} audioData 오디오 샘플 데이터
   * @param {number} sampleRate 샘플링 레이트
   * @param {number} windowSize FFT 윈도우 크기
   * @returns {Array<{frequency: number, magnitude: number}>} 주파수별 크기
   * @private
   */
  _analyzeFrequency(audioData, sampleRate, windowSize = this.options.fftSize) {
    // FFT 윈도우 크기 조정 (2의 제곱수로)
    const fftSize = Math.pow(2, Math.ceil(Math.log2(windowSize)));

    // 분석할 데이터 준비 (윈도우 크기에 맞게)
    const dataToAnalyze = new Array(fftSize).fill(0);
    for (let i = 0; i < Math.min(audioData.length, fftSize); i++) {
      dataToAnalyze[i] = audioData[i];
    }

    // 해밍 윈도우 적용 (주파수 누출 감소)
    for (let i = 0; i < fftSize; i++) {
      dataToAnalyze[i] *=
        0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (fftSize - 1));
    }

    // FFT 실행
    const fftResult = FFT(dataToAnalyze);

    // 주파수 비닝 및 정규화
    const frequencies = [];
    const magnitudes = FFTUtil.fftMag(fftResult);

    // 의미 있는 주파수만 분석 (나이퀴스트 주파수까지)
    const nyquistFreq = sampleRate / 2;
    const usableBins = Math.floor(fftSize / 2);

    // 최대 진폭 찾기 (정규화 용)
    const maxMagnitude = Math.max(...magnitudes.slice(0, usableBins));

    // 주파수 비닝 및 정규화
    for (let i = 0; i < usableBins; i++) {
      const frequency = (i * sampleRate) / fftSize;
      const normalizedMagnitude = magnitudes[i] / maxMagnitude;

      frequencies.push({
        frequency,
        magnitude: normalizedMagnitude,
      });
    }

    return frequencies;
  }

  /**
   * 주파수 스펙트럼에서 벨 소리의 특징적인 주파수 범위의 에너지 계산
   * @param {Array<{frequency: number, magnitude: number}>} frequencyData 주파수 데이터
   * @param {number} minFreq 최소 주파수
   * @param {number} maxFreq 최대 주파수
   * @returns {number} 지정된 주파수 범위의 에너지 (0-1 사이 정규화)
   * @private
   */
  _calculateBellFrequencyEnergy(
    frequencyData,
    minFreq = this.options.boxingBellMinFreq,
    maxFreq = this.options.boxingBellMaxFreq
  ) {
    // 전체 주파수 범위의 에너지 합
    const totalEnergy = frequencyData.reduce(
      (sum, item) => sum + item.magnitude,
      0
    );

    // 벨 주파수 범위의 에너지 합
    const bellRangeEnergy = frequencyData
      .filter((item) => item.frequency >= minFreq && item.frequency <= maxFreq)
      .reduce((sum, item) => sum + item.magnitude, 0);

    // 상대적 에너지 비율 계산 (정규화)
    const normalizedEnergy =
      totalEnergy > 0 ? bellRangeEnergy / totalEnergy : 0;

    return normalizedEnergy;
  }

  /**
   * 진폭 패턴과 벨 소리 패턴 템플릿 간의 유사도 계산
   * @param {Array<number>} amplitudePattern 진폭 패턴
   * @returns {number} 패턴 유사도 (0-1 사이, 1이 가장 유사)
   * @private
   */
  _calculatePatternSimilarity(amplitudePattern) {
    // 패턴 길이가 템플릿보다 짧으면 보간하여 확장
    let normalizedPattern = amplitudePattern;
    if (amplitudePattern.length < this.bellPatternTemplate.length) {
      normalizedPattern = this._interpolatePattern(
        amplitudePattern,
        this.bellPatternTemplate.length
      );
    } else if (amplitudePattern.length > this.bellPatternTemplate.length) {
      // 패턴이 더 길면 다운샘플링
      normalizedPattern = this._downsamplePattern(
        amplitudePattern,
        this.bellPatternTemplate.length
      );
    }

    // 정규화 (최대값이 1이 되도록)
    const maxAmplitude = Math.max(...normalizedPattern);
    if (maxAmplitude > 0) {
      normalizedPattern = normalizedPattern.map((a) => a / maxAmplitude);
    }

    // 패턴 유사도 계산 (코사인 유사도)
    let dotProduct = 0;
    let patternMagnitude = 0;
    let templateMagnitude = 0;

    for (let i = 0; i < this.bellPatternTemplate.length; i++) {
      dotProduct += normalizedPattern[i] * this.bellPatternTemplate[i];
      patternMagnitude += normalizedPattern[i] * normalizedPattern[i];
      templateMagnitude +=
        this.bellPatternTemplate[i] * this.bellPatternTemplate[i];
    }

    patternMagnitude = Math.sqrt(patternMagnitude);
    templateMagnitude = Math.sqrt(templateMagnitude);

    const similarity = dotProduct / (patternMagnitude * templateMagnitude);

    return similarity;
  }

  /**
   * 패턴 보간 (길이 확장)
   * @param {Array<number>} pattern 원본 패턴
   * @param {number} newLength 새 길이
   * @returns {Array<number>} 보간된 패턴
   * @private
   */
  _interpolatePattern(pattern, newLength) {
    const result = new Array(newLength);
    const ratio = (pattern.length - 1) / (newLength - 1);

    for (let i = 0; i < newLength; i++) {
      const position = i * ratio;
      const index = Math.floor(position);
      const fraction = position - index;

      if (index < pattern.length - 1) {
        result[i] =
          pattern[index] * (1 - fraction) + pattern[index + 1] * fraction;
      } else {
        result[i] = pattern[pattern.length - 1];
      }
    }

    return result;
  }

  /**
   * 패턴 다운샘플링 (길이 축소)
   * @param {Array<number>} pattern 원본 패턴
   * @param {number} newLength 새 길이
   * @returns {Array<number>} 다운샘플링된 패턴
   * @private
   */
  _downsamplePattern(pattern, newLength) {
    const result = new Array(newLength);
    const ratio = pattern.length / newLength;

    for (let i = 0; i < newLength; i++) {
      const startIdx = Math.floor(i * ratio);
      const endIdx = Math.floor((i + 1) * ratio);

      let sum = 0;
      for (let j = startIdx; j < endIdx; j++) {
        sum += pattern[j];
      }

      result[i] = sum / (endIdx - startIdx);
    }

    return result;
  }

  /**
   * 파형 데이터에서 벨 소리 감지 (향상된 알고리즘)
   * @param {WaveformData} waveformData 파형 데이터
   * @param {Object} options 감지 옵션
   * @returns {Array<number>} 벨 소리 시작 타임스탬프 (초 단위)
   */
  detectBellSounds(waveformData, customOptions = {}) {
    console.log("벨 소리 감지 시작...");
    const startTime = Date.now();

    // 옵션 설정
    const options = { ...this.options, ...customOptions };
    console.log("벨 소리 감지 옵션:", JSON.stringify(options, null, 2));

    // 결과 초기화
    const bellTimestamps = [];
    this.debug.candidateBells = [];
    this.debug.rejectedBells = [];
    this.debug.acceptedBells = [];
    this.debug.frequencyData = [];

    // 채널 데이터 및 기본 정보
    const channel = waveformData.channel(0);
    const sampleRate = waveformData.sample_rate;
    const totalSamples = channel.length;

    // 진폭 데이터 수집 (전체 파형의 진폭 정보를 수집하여 분석)
    console.log("진폭 데이터 수집 중...");
    const amplitudes = [];
    for (let i = 0; i < totalSamples; i++) {
      amplitudes.push(Math.abs(channel.max_sample(i)));
    }

    // 신호의 통계적 정보 계산
    const maxAmplitude = Math.max(...amplitudes);
    const avgAmplitude =
      amplitudes.reduce((sum, a) => sum + a, 0) / amplitudes.length;

    console.log(
      `신호 분석: 최대진폭=${maxAmplitude.toFixed(
        3
      )}, 평균진폭=${avgAmplitude.toFixed(
        3
      )}, 임계값=${options.amplitudeThreshold.toFixed(3)}`
    );

    // 자동 임계값 조정 (필요한 경우)
    let effectiveThreshold = options.amplitudeThreshold;

    // 만약 최대 진폭이 임계값보다 낮다면 적응형 임계값 적용
    if (maxAmplitude < effectiveThreshold) {
      effectiveThreshold = Math.max(0.5, maxAmplitude * 0.8);
      console.log(
        `최대 진폭이 임계값보다 낮습니다. 임계값을 ${effectiveThreshold.toFixed(
          3
        )}로 조정합니다.`
      );
    }

    // 강한 윈도우 슬라이딩 접근법을 사용하여 벨 소리 패턴 감지
    console.log("패턴 분석을 통한 벨 소리 감지 중...");

    // 윈도우 크기 계산 (벨 소리의 최소 및 최대 길이에 따라)
    const minBellSamples = Math.floor(
      (options.minBellDuration / 1000) * sampleRate
    );
    const maxBellSamples = Math.ceil(
      (options.maxBellDuration / 1000) * sampleRate
    );
    const windowSize = Math.min(options.fftSize, totalSamples);

    // 벨 감지 상태 변수
    let inBell = false;
    let bellStart = 0;
    let bellEnd = 0;
    let bellPeakAmplitude = 0;
    let consecutiveHighAmplitudeSamples = 0;
    let minConsecutiveHighSamples = 3; // 복싱 벨소리를 더 잘 감지하기 위해 더 낮게 설정
    let bellAmplitudePattern = []; // 벨 소리의 진폭 패턴 저장

    // 마지막 감지된 벨 시간
    let lastBellTime = -options.minBellInterval;

    // 임시 벨 후보들 저장 (나중에 그룹화를 위해)
    const tempBellCandidates = [];

    // 진행 상황 보고용 변수
    const progressStep = Math.max(1, Math.floor(totalSamples / 20)); // 5% 단위

    // 분석 간격 (전체 샘플을 적절한 간격으로 분석)
    const analysisInterval = Math.max(1, Math.floor(windowSize / 4));

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
          bellAmplitudePattern = [amplitude]; // 진폭 패턴 기록 시작
        } else {
          // 진행 중인 벨의 피크 업데이트
          consecutiveHighAmplitudeSamples++;
          bellAmplitudePattern.push(amplitude); // 진폭 패턴 기록
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

            // 주파수 분석 수행
            let frequencyEnergy = 0;
            let patternSimilarity = 0;

            // 윈도우 크기보다 충분한 샘플이 있는 경우에만 주파수 분석 수행
            if (i >= windowSize) {
              // 벨 소리 주변 오디오 데이터 추출 (벨 소리 앞/중간/뒤 부분 모두 포함)
              const audioSamples = new Float32Array(windowSize);
              const startIdx = Math.max(
                0,
                bellStart - Math.floor(windowSize / 4)
              );

              // 샘플 데이터 추출
              for (let j = 0; j < windowSize; j++) {
                const sampleIdx = startIdx + j;
                if (sampleIdx < totalSamples) {
                  audioSamples[j] = channel.max_sample(sampleIdx);
                }
              }

              // 주파수 분석
              const frequencyData = this._analyzeFrequency(
                audioSamples,
                sampleRate,
                windowSize
              );

              // 벨 소리 주파수 범위의 에너지 계산
              frequencyEnergy = this._calculateBellFrequencyEnergy(
                frequencyData,
                options.boxingBellMinFreq,
                options.boxingBellMaxFreq
              );

              // 진폭 패턴 유사도 계산
              patternSimilarity =
                this._calculatePatternSimilarity(bellAmplitudePattern);

              // 디버깅용 주파수 데이터 저장
              this.debug.frequencyData.push({
                time: bellStartTime,
                frequencyData: frequencyData,
                bellFrequencyEnergy: frequencyEnergy,
                patternSimilarity: patternSimilarity,
              });
            }

            // 벨 후보로 추가
            tempBellCandidates.push({
              start: bellStartTime,
              end: bellStartTime + bellDuration,
              duration: bellDuration,
              peakAmplitude: bellPeakAmplitude,
              samples: consecutiveHighAmplitudeSamples,
              frequencyEnergy: frequencyEnergy,
              patternSimilarity: patternSimilarity,
              // 복합 점수 (진폭, 주파수 에너지, 패턴 유사도 결합)
              bellScore:
                bellPeakAmplitude * 0.4 +
                frequencyEnergy * 0.4 +
                patternSimilarity * 0.2,
            });

            // 디버깅 로그
            console.log(
              `벨 후보 발견: ${bellStartTime.toFixed(
                2
              )}초, 길이: ${bellDuration.toFixed(
                3
              )}초, 진폭: ${bellPeakAmplitude.toFixed(
                3
              )}, 주파수 에너지: ${frequencyEnergy.toFixed(
                3
              )}, 패턴 유사도: ${patternSimilarity.toFixed(3)}`
            );
          } else {
            // 연속된 높은 진폭 샘플이 충분하지 않으면 로그만
            if (consecutiveHighAmplitudeSamples > 0) {
              const bellStartTime = bellStart / sampleRate;
              console.log(
                `짧은 후보 무시: ${bellStartTime.toFixed(
                  2
                )}초, 샘플 수: ${consecutiveHighAmplitudeSamples}`
              );
            }
          }

          // 상태 초기화
          inBell = false;
          consecutiveHighAmplitudeSamples = 0;
          bellAmplitudePattern = [];
        }
      }
    }

    // 마지막 남은 벨 처리
    if (
      inBell &&
      consecutiveHighAmplitudeSamples >= minConsecutiveHighSamples
    ) {
      bellEnd = totalSamples - 1;
      const bellDuration = (bellEnd - bellStart) / sampleRate;
      const bellStartTime = bellStart / sampleRate;

      // 주파수 분석 (가능한 경우)
      let frequencyEnergy = 0;
      let patternSimilarity = 0;

      // 진폭 패턴 유사도 계산
      patternSimilarity =
        this._calculatePatternSimilarity(bellAmplitudePattern);

      tempBellCandidates.push({
        start: bellStartTime,
        end: bellStartTime + bellDuration,
        duration: bellDuration,
        peakAmplitude: bellPeakAmplitude,
        samples: consecutiveHighAmplitudeSamples,
        frequencyEnergy: frequencyEnergy,
        patternSimilarity: patternSimilarity,
        bellScore:
          bellPeakAmplitude * 0.4 +
          frequencyEnergy * 0.4 +
          patternSimilarity * 0.2,
      });

      console.log(
        `마지막 벨 후보 발견: ${bellStartTime.toFixed(
          2
        )}초, 길이: ${bellDuration.toFixed(
          3
        )}초, 진폭: ${bellPeakAmplitude.toFixed(3)}`
      );
    }

    // 서로 가까운 벨 후보들을 그룹화하여 하나의 벨로 만들기
    console.log(
      `총 ${tempBellCandidates.length}개의 벨 후보를 그룹화합니다...`
    );
    const groupedBells = this._groupBellCandidates(tempBellCandidates, 0.5); // 0.5초 이내 후보들은 그룹화

    // 그룹화된 벨 후보들을 점수 기준으로 정렬
    groupedBells.sort((a, b) => b.bellScore - a.bellScore);

    // 벨 점수가 높은 순서대로 처리
    for (const bell of groupedBells) {
      this.debug.candidateBells.push(bell);

      // 주파수 에너지와 패턴 유사도를 기준으로 벨 감지 결정
      const isFrequencyMatch =
        bell.frequencyEnergy >= options.frequencyEnergyThreshold;
      const isPatternMatch =
        bell.patternSimilarity >= options.patternSimilarityThreshold;
      const isHighAmplitude = bell.peakAmplitude >= effectiveThreshold;

      // 복싱 벨 소리는 진폭이 높고, 특정 주파수 범위에 에너지가 집중되며, 특정 패턴을 가짐
      const isBellSound =
        isHighAmplitude && (isFrequencyMatch || isPatternMatch);

      if (
        isBellSound &&
        bell.duration >= options.minBellDuration / 1000 &&
        bell.duration <= options.maxBellDuration / 1000
      ) {
        // 이전 벨과의 간격 확인
        if (bell.start - lastBellTime >= options.minBellInterval) {
          // 벨 소리로 채택
          bellTimestamps.push(bell.start);
          lastBellTime = bell.start;

          this.debug.acceptedBells.push(bell);

          console.log(
            `벨 소리 감지: ${bell.start.toFixed(
              2
            )}초, 길이: ${bell.duration.toFixed(
              2
            )}초, 진폭: ${bell.peakAmplitude.toFixed(
              3
            )}, 점수: ${bell.bellScore.toFixed(3)}, 그룹화됨: ${
              bell.grouped ? "Yes" : "No"
            }`
          );
        } else {
          // 간격 조건으로 거부
          this.debug.rejectedBells.push({
            ...bell,
            reason: "최소 간격 미달",
            interval: bell.start - lastBellTime,
          });
        }
      } else {
        // 조건 미달로 거부
        let reason = "";
        if (!isBellSound) {
          reason = "벨 소리 특성 미달";
          if (!isHighAmplitude) reason += " (낮은 진폭)";
          if (!isFrequencyMatch) reason += " (주파수 불일치)";
          if (!isPatternMatch) reason += " (패턴 불일치)";
        } else {
          reason = "길이 조건 미달";
        }

        this.debug.rejectedBells.push({
          ...bell,
          reason: reason,
          minDuration: options.minBellDuration / 1000,
          maxDuration: options.maxBellDuration / 1000,
        });
      }
    }

    // 분석 결과 요약
    console.log(
      `벨 소리 감지 완료. 소요 시간: ${(Date.now() - startTime) / 1000}초`
    );
    console.log(`총 후보 벨 소리: ${this.debug.candidateBells.length}개`);
    console.log(`거부된 벨 소리: ${this.debug.rejectedBells.length}개`);
    console.log(`감지된 벨 소리: ${bellTimestamps.length}개`);

    if (bellTimestamps.length === 0) {
      console.log("주의: 벨 소리가 감지되지 않았습니다.");
      console.log(
        "임계값을 낮추거나 (현재: " +
          effectiveThreshold.toFixed(2) +
          ") 주파수 설정을 조정해보세요."
      );

      // 후보 벨들의 정보 출력
      if (this.debug.candidateBells.length > 0) {
        console.log("후보 벨 소리들의 정보:");
        this.debug.candidateBells.forEach((bell) => {
          console.log(
            `시작: ${bell.start.toFixed(
              2
            )}초, 진폭: ${bell.peakAmplitude.toFixed(
              3
            )}, 길이: ${bell.duration.toFixed(2)}초, 점수: ${
              bell.bellScore ? bell.bellScore.toFixed(3) : "N/A"
            }`
          );
        });
      }

      // 진폭 임계값 자동 조정 제안
      if (this.debug.candidateBells.length > 0) {
        const suggestedThreshold = Math.max(
          0.05,
          this.debug.candidateBells.reduce(
            (min, b) => Math.min(min, b.peakAmplitude),
            1
          ) * 0.9
        );
        console.log(
          `제안: 진폭 임계값을 ${suggestedThreshold.toFixed(2)}로 시도해보세요.`
        );
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

        // 그룹 내에서 가장 높은 점수를 가진 후보의 속성으로 업데이트
        const currentScore = current.bellScore || 0;
        const groupScore = currentGroup.bellScore || 0;

        if (currentScore > groupScore) {
          currentGroup.bellScore = currentScore;
          currentGroup.frequencyEnergy = current.frequencyEnergy;
          currentGroup.patternSimilarity = current.patternSimilarity;
        }

        // 항상 최대 진폭 값과 샘플 수는 누적
        if (current.peakAmplitude > currentGroup.peakAmplitude) {
          currentGroup.peakAmplitude = current.peakAmplitude;
        }

        currentGroup.samples += current.samples;
        currentGroup.grouped = true;

        console.log(
          `후보 그룹화: ${current.start.toFixed(
            3
          )}초 후보를 ${currentGroup.start.toFixed(
            3
          )}초 그룹에 병합 (점수: ${currentGroup.bellScore.toFixed(3)})`
        );
      } else {
        // 이전 그룹 저장하고 새 그룹 시작
        result.push(currentGroup);
        currentGroup = { ...current, grouped: false };
      }
    }

    // 마지막 그룹 추가
    result.push(currentGroup);

    console.log(
      `${candidates.length}개의 후보를 ${result.length}개의 그룹으로 통합했습니다.`
    );

    // 벨 점수로 정렬
    result.sort((a, b) => (b.bellScore || 0) - (a.bellScore || 0));

    return result;
  }

  /**
   * 오디오 특성 분석을 통한 벨 소리 감지 설정 최적화
   * @param {WaveformData} waveformData 파형 데이터
   * @returns {Object} 최적화된 감지 옵션
   */
  optimizeDetectionSettings(waveformData) {
    console.log("감지 설정 최적화 중...");

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
      if (histogram[i] > sampleCount * 0.01) {
        // 1% 이상의 샘플
        significantBin = i;
        break;
      }
    }

    // 최적의 임계값 계산 (통계 기반)
    // 최대 진폭의 40%와 히스토그램 기반 분석의 중간값
    const histogramThreshold = (significantBin / 10) * 0.8;
    const amplitudeThreshold = Math.max(
      avgAmplitude * 2, // 평균 진폭의 2배
      maxAmplitude * 0.4, // 최대 진폭의 40%
      histogramThreshold // 히스토그램 기반 임계값
    );

    console.log(
      `진폭 분석: 최대=${maxAmplitude.toFixed(3)}, 평균=${avgAmplitude.toFixed(
        3
      )}`
    );
    console.log(
      `임계값 계산: 평균기반=${(avgAmplitude * 2).toFixed(3)}, 최대기반=${(
        maxAmplitude * 0.4
      ).toFixed(3)}, 히스토그램기반=${histogramThreshold.toFixed(3)}`
    );
    console.log(`설정 최적화 완료. 임계값: ${amplitudeThreshold.toFixed(3)}`);

    return {
      ...this.options,
      amplitudeThreshold,
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
