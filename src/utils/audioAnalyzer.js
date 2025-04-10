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
   * 오디오 주파수 분석
   * @param {Array} audioData 오디오 샘플 데이터
   * @param {number} sampleRate 샘플레이트
   * @param {number} windowSize FFT 윈도우 크기
   * @returns {Object} 주파수 정보
   * @private
   */
  _analyzeFrequency(audioData, sampleRate, windowSize = this.options.fftSize) {
    // 유효한 오디오 데이터 확인
    if (!audioData || audioData.length === 0) {
      return { magnitudes: [], frequencies: [] };
    }

    // FFT 계산 준비
    const fftInput = new Array(windowSize).fill(0);
    const startIdx = 0;

    // 신호 복사 및 패딩
    for (let i = 0; i < windowSize && i + startIdx < audioData.length; i++) {
      fftInput[i] = audioData[i + startIdx];
    }

    // 해밍 윈도우 적용하여 스펙트럼 누출 감소
    for (let i = 0; i < windowSize; i++) {
      fftInput[i] *=
        0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (windowSize - 1));
    }

    // FFT 계산
    const fftResult = FFT(fftInput);

    // 진폭 및 주파수 계산
    const magnitudes = [];
    const frequencies = [];
    const spectrum = [];

    // 나이퀴스트 주파수까지만 계산 (nyquist = sampleRate / 2)
    const numBins = windowSize / 2;

    for (let i = 0; i < numBins; i++) {
      // 진폭 계산 (복소수 크기)
      const real = fftResult[i * 2];
      const imag = fftResult[i * 2 + 1];
      const magnitude = Math.sqrt(real * real + imag * imag) / windowSize;

      // 주파수 계산
      const frequency = (i * sampleRate) / windowSize;

      // 저장
      magnitudes.push(magnitude);
      frequencies.push(frequency);
      spectrum.push({ frequency, magnitude });
    }

    return {
      magnitudes,
      frequencies,
      spectrum,
      sampleRate,
    };
  }

  /**
   * 주파수 스펙트럼에서 벨 소리의 특징적인 주파수 범위의 에너지 계산
   * @param {Array<{frequency: number, magnitude: number}>} spectrum 주파수 스펙트럼 데이터
   * @param {number} minFreq 최소 주파수
   * @param {number} maxFreq 최대 주파수
   * @returns {number} 지정된 주파수 범위의 에너지 (0-1 사이 정규화)
   * @private
   */
  _calculateBellFrequencyEnergy(
    spectrum,
    minFreq = this.options.boxingBellMinFreq,
    maxFreq = this.options.boxingBellMaxFreq
  ) {
    // 전체 주파수 범위의 에너지 합
    const totalEnergy = spectrum.reduce((sum, item) => sum + item.magnitude, 0);

    // 벨 주파수 범위의 에너지 합
    const bellRangeEnergy = spectrum
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
   * 오디오 파형에서 벨 소리 감지
   * @param {Object} waveformData 파형 데이터
   * @param {Object} customOptions 사용자 정의 옵션
   * @returns {Array} 감지된 벨 소리 타임스탬프
   */
  detectBellSounds(waveformData, customOptions = {}) {
    console.log("벨 소리 감지 시작...");

    // 옵션 병합
    const options = { ...this.options, ...customOptions };
    console.log("사용 설정:", JSON.stringify(options, null, 2));

    // 디버그 정보 초기화
    this.debug = {
      candidateBells: [],
      rejectedBells: [],
      acceptedBells: [],
      frequencyData: [],
    };

    // 파형 데이터가 없으면 빈 배열 반환
    if (!waveformData || !waveformData.channel) {
      console.error("유효한 파형 데이터가 없습니다.");
      return [];
    }

    const channel = waveformData.channel(0);
    const sampleRate = waveformData.sample_rate;
    const samplesPerPixel = waveformData.samples_per_pixel;
    const length = channel.length;

    // 벨 소리 감지를 위한 시간 변환 계수
    const timePerSample = samplesPerPixel / sampleRate;

    // 벨 소리 후보 저장 배열
    const bellCandidates = [];

    // 임계값을 초과하는 피크 감지
    let isPeakActive = false;
    let peakStart = -1;
    let peakEnd = -1;
    let peakAmplitude = 0;
    let bellPatternSamples = [];

    console.log(
      `파형 분석: 길이=${length}포인트, 샘플레이트=${sampleRate}Hz, 샘플/픽셀=${samplesPerPixel}`
    );

    // 파형 스캔하여 진폭 임계값 초과 지점 찾기
    for (let i = 0; i < length; i++) {
      const maxAmp = Math.abs(channel.max_sample(i));
      const minAmp = Math.abs(channel.min_sample(i));
      const amplitude = Math.max(maxAmp, minAmp);

      // 임계값 초과 피크 발견
      if (!isPeakActive && amplitude >= options.amplitudeThreshold) {
        isPeakActive = true;
        peakStart = i;
        peakAmplitude = amplitude;
        bellPatternSamples = []; // 패턴 기록 초기화
      }

      // 활성 피크 중 최대 진폭 업데이트
      if (isPeakActive && amplitude > peakAmplitude) {
        peakAmplitude = amplitude;
      }

      // 활성 피크 중 패턴 샘플 기록
      if (isPeakActive) {
        bellPatternSamples.push(amplitude);
      }

      // 임계값 미만으로 내려가면 피크 종료
      if (isPeakActive && amplitude < options.amplitudeThreshold) {
        isPeakActive = false;
        peakEnd = i - 1;

        // 피크 기간 계산
        const peakDuration = (peakEnd - peakStart + 1) * timePerSample;
        const peakMiddle = Math.floor((peakStart + peakEnd) / 2);
        const timestamp = peakMiddle * timePerSample;

        // 벨 소리 후보로 추가
        if (
          peakDuration >= options.minBellDuration / 1000 &&
          peakDuration <= options.maxBellDuration / 1000
        ) {
          bellCandidates.push({
            timestamp,
            start: peakStart * timePerSample,
            end: peakEnd * timePerSample,
            duration: peakDuration,
            peakAmplitude,
            patternSamples: bellPatternSamples,
          });

          // 오디오 샘플 추출하여 주파수 분석 (벨 시작 지점 기준)
          const audioSamples = this._extractAudioSamples(
            channel,
            peakStart,
            peakEnd,
            samplesPerPixel
          );

          if (audioSamples && audioSamples.length > 0) {
            // 주파수 분석 수행
            const frequencyData = this._analyzeFrequency(
              audioSamples,
              sampleRate / samplesPerPixel
            );

            // 주파수 분석 데이터 저장 (디버깅용)
            this.debug.frequencyData.push({
              timestamp,
              spectrum: frequencyData.spectrum,
              sampleRate: frequencyData.sampleRate,
            });

            // 주파수 범위 내 에너지 계산
            const bellFrequencyEnergy = this._calculateBellFrequencyEnergy(
              frequencyData.spectrum,
              options.boxingBellMinFreq,
              options.boxingBellMaxFreq
            );

            // 기존 후보에 주파수 분석 결과 추가
            bellCandidates[bellCandidates.length - 1].frequencyEnergy =
              bellFrequencyEnergy;
          }
        }
      }
    }

    console.log(`후보 벨 소리 ${bellCandidates.length}개 감지됨`);

    // 후보를 디버그 정보에 복사
    this.debug.candidateBells = [...bellCandidates];

    // 벨소리 후보를 시간순으로 정렬
    bellCandidates.sort((a, b) => a.timestamp - b.timestamp);

    // 패턴 유사도와 주파수 특성을 평가하여 유효한 벨 소리만 필터링
    const validBells = [];

    for (let i = 0; i < bellCandidates.length; i++) {
      const candidate = bellCandidates[i];
      let isValid = true;
      let rejectionReason = "";

      // 1. 진폭 패턴 분석 (벨 소리 특유의 감쇠 패턴 확인)
      const patternSimilarity = this._calculatePatternSimilarity(
        candidate.patternSamples
      );

      // 2. 주파수 특성 확인
      const hasExpectedFrequency = candidate.frequencyEnergy
        ? candidate.frequencyEnergy >= options.frequencyEnergyThreshold
        : false;

      // 3. 이전 벨과의 시간 간격 확인 (최소 30초 간격)
      const sufficientInterval =
        validBells.length === 0 ||
        candidate.timestamp - validBells[validBells.length - 1].timestamp >=
          options.minBellInterval;

      // 패턴 유사도가 낮으면 제외
      if (patternSimilarity < options.patternSimilarityThreshold) {
        isValid = false;
        rejectionReason = `패턴 유사도(${patternSimilarity.toFixed(
          2
        )})가 임계값(${options.patternSimilarityThreshold})보다 낮음`;
      }
      // 주파수 특성이 맞지 않으면 제외
      else if (!hasExpectedFrequency) {
        isValid = false;
        rejectionReason = `주파수 에너지(${
          candidate.frequencyEnergy
            ? candidate.frequencyEnergy.toFixed(2)
            : "N/A"
        })가 임계값(${options.frequencyEnergyThreshold})보다 낮음`;
      }
      // 이전 벨과 간격이 너무 짧으면 제외 (30초 미만)
      else if (!sufficientInterval) {
        isValid = false;
        rejectionReason = `이전 벨과의 간격(${(
          candidate.timestamp - validBells[validBells.length - 1].timestamp
        ).toFixed(2)}초)이 최소 간격(${options.minBellInterval}초)보다 짧음`;
      }

      // 유효한 벨 소리만 추가
      if (isValid) {
        validBells.push({
          timestamp: candidate.timestamp,
          amplitude: candidate.peakAmplitude,
          duration: candidate.duration,
          patternSimilarity,
          frequencyEnergy: candidate.frequencyEnergy || 0,
        });
        this.debug.acceptedBells.push(candidate);
      } else {
        // 거부된 벨 소리 정보 저장 (디버깅용)
        this.debug.rejectedBells.push({
          ...candidate,
          rejectionReason,
        });
      }
    }

    console.log(`${validBells.length}개의 유효한 벨 소리 최종 감지됨`);

    // 감지된 벨 소리 타임스탬프 반환
    return validBells.map((bell) => bell.timestamp);
  }

  /**
   * 채널에서 오디오 샘플 추출
   * @param {Object} channel 오디오 채널
   * @param {number} start 시작 인덱스
   * @param {number} end 종료 인덱스
   * @param {number} samplesPerPixel 픽셀당 샘플 수
   * @returns {Array} 추출된 오디오 샘플
   * @private
   */
  _extractAudioSamples(channel, start, end, samplesPerPixel) {
    const samples = [];

    // 오디오 데이터 범위 확장 (앞뒤로 조금 더 추출)
    const window = 10; // 앞뒤로 10포인트 추가
    const expandedStart = Math.max(0, start - window);
    const expandedEnd = Math.min(channel.length - 1, end + window);

    for (let i = expandedStart; i <= expandedEnd; i++) {
      // min_sample과 max_sample 사이 값들을 샘플링하여 추출
      const min = channel.min_sample(i);
      const max = channel.max_sample(i);

      // 간단한 보간을 통해 샘플 추출 (실제는 더 정교한 방법이 필요할 수 있음)
      const numSamples = 10; // 각 포인트당 10개 샘플 생성
      for (let j = 0; j < numSamples; j++) {
        const t = j / numSamples;
        const sample = min * (1 - t) + max * t;
        samples.push(sample);
      }
    }

    return samples;
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
    return {
      candidateBells: this.debug.candidateBells || [],
      rejectedBells: this.debug.rejectedBells || [],
      acceptedBells: this.debug.acceptedBells || [],
      frequencyData: this.debug.frequencyData || [],
    };
  }
}

module.exports = new AudioAnalyzer();
