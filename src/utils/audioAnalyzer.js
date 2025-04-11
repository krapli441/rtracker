const fs = require("fs");
const path = require("path");
const WaveformData = require("waveform-data");
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
      amplitudeThreshold: 0.45,
      // 벨 소리 주파수 범위 (Hz)
      minFrequency: 500,
      maxFrequency: 2000,
      // 최소 벨 소리 길이 (밀리초)
      minBellDuration: 30,
      // 최대 벨 소리 길이 (밀리초)
      maxBellDuration: 2000,
      // 벨 소리 간 최소 간격 (초)
      minBellInterval: 20,
    };

    // 디버깅 정보 저장
    this.debug = {
      candidateBells: [], // 임계값을 넘은 모든 후보 벨 소리들
      rejectedBells: [], // 길이나 간격 조건으로 제외된 벨 소리들
      acceptedBells: [], // 최종 채택된 벨 소리들
    };

    // 템플릿 벨 소리 관련 속성
    this.templateBellData = null;
    this.templateBellFeatures = null;
    this.templateLoaded = false;

    // 템플릿 매칭 설정
    this.matchingOptions = {
      // 매칭 임계값 (0-1)
      similarityThreshold: 0.65,
      // 매칭 윈도우 크기 (밀리초)
      windowSize: 500,
      // 윈도우 이동 크기 (밀리초)
      hopSize: 100,
      // 매칭 후 병합 시간 (밀리초)
      mergeTime: 300,
    };
  }

  /**
   * 템플릿 벨 소리 로드 및 분석
   * @param {string} templatePath 템플릿 벨 소리 파일 경로
   * @returns {Promise<boolean>} 로드 성공 여부
   */
  async loadTemplateBell(templatePath) {
    try {
      console.log(`템플릿 벨 소리 로드 중: ${templatePath}`);

      // 현재 프로젝트 경로에 상대적인 파일 경로로 변환
      const absolutePath = path.isAbsolute(templatePath)
        ? templatePath
        : path.join(__dirname, templatePath);

      // 파일 존재 확인
      if (!fs.existsSync(absolutePath)) {
        console.error(`템플릿 파일을 찾을 수 없습니다: ${absolutePath}`);
        return false;
      }

      // 템플릿 오디오 데이터 로드
      const audioContext = new AudioContext();
      const audioData = fs.readFileSync(absolutePath);

      // 오디오 디코딩
      const templateBuffer = await new Promise((resolve, reject) => {
        audioContext.decodeAudioData(
          audioData.buffer,
          (buffer) => resolve(buffer),
          (error) => reject(error)
        );
      });

      // 템플릿 특성 추출
      this.templateBellData = templateBuffer;
      this.templateBellFeatures = this._extractAudioFeatures(templateBuffer);
      this.templateLoaded = true;

      console.log("템플릿 벨 소리 로드 완료");
      console.log(
        `특성: 길이=${templateBuffer.duration.toFixed(2)}초, 채널=${
          templateBuffer.numberOfChannels
        }, 샘플레이트=${templateBuffer.sampleRate}Hz`
      );

      return true;
    } catch (error) {
      console.error("템플릿 벨 소리 로드 중 오류:", error);
      this.templateLoaded = false;
      return false;
    }
  }

  /**
   * 오디오 특성 추출 (템플릿 및 비교용)
   * @param {AudioBuffer} buffer 오디오 버퍼
   * @returns {Object} 오디오 특성 객체
   * @private
   */
  _extractAudioFeatures(buffer) {
    const channelData = buffer.getChannelData(0);
    const features = {};

    // 시간 도메인 특성
    features.duration = buffer.duration;
    features.sampleRate = buffer.sampleRate;

    // 에너지 프로파일
    features.energyProfile = this._calculateEnergyProfile(channelData);

    // 주파수 특성 (간단한 구현)
    const fftSize = 2048;
    const fftResults = [];
    const windowSize = Math.min(fftSize, channelData.length);

    // 오디오를 윈도우로 분할하여 FFT 수행
    for (let i = 0; i < channelData.length; i += windowSize / 2) {
      if (i + windowSize > channelData.length) break;

      const windowData = channelData.slice(i, i + windowSize);
      // 윈도우 함수 적용 (Hanning)
      for (let j = 0; j < windowSize; j++) {
        windowData[j] *=
          0.5 * (1 - Math.cos((2 * Math.PI * j) / (windowSize - 1)));
      }

      const fft = this._calculateFFT(windowData, fftSize);
      fftResults.push(fft);
    }

    // 모든 윈도우에서의 FFT 결과 평균
    if (fftResults.length > 0) {
      const avgFft = new Array(fftResults[0].length).fill(0);
      for (const fft of fftResults) {
        for (let i = 0; i < fft.length; i++) {
          avgFft[i] += fft[i] / fftResults.length;
        }
      }
      features.frequencyProfile = avgFft;
    } else {
      features.frequencyProfile = [];
    }

    // 주요 주파수 대역 에너지
    features.bandEnergies = {
      low: this._calculateBandEnergy(
        features.frequencyProfile,
        fftSize,
        buffer.sampleRate,
        100,
        500
      ),
      mid: this._calculateBandEnergy(
        features.frequencyProfile,
        fftSize,
        buffer.sampleRate,
        500,
        1000
      ),
      high: this._calculateBandEnergy(
        features.frequencyProfile,
        fftSize,
        buffer.sampleRate,
        1000,
        2000
      ),
    };

    return features;
  }

  /**
   * 에너지 프로파일 계산
   * @param {Float32Array} channelData 오디오 채널 데이터
   * @returns {Array<number>} 에너지 프로파일
   * @private
   */
  _calculateEnergyProfile(channelData) {
    const frameSize = 1024;
    const energyProfile = [];

    for (let i = 0; i < channelData.length; i += frameSize) {
      let energy = 0;
      const end = Math.min(i + frameSize, channelData.length);

      for (let j = i; j < end; j++) {
        energy += channelData[j] * channelData[j];
      }

      energyProfile.push(energy / frameSize);
    }

    return energyProfile;
  }

  /**
   * 템플릿 매칭을 사용하여 벨 소리를 감지합니다
   * @param {Array} audioData - 분석할 오디오 데이터
   * @param {Array} template - 비교할 템플릿 데이터
   * @returns {Object} - 감지 결과
   */
  detectBellSoundsWithTemplate(audioData, template) {
    // 템플릿이 없으면 기본 감지 메서드 사용
    if (!template || template.length === 0) {
      console.log(
        "템플릿이 없습니다. 기본 진폭 기반 감지 방법으로 대체합니다."
      );
      return this.detectBellSound(audioData);
    }

    try {
      // 템플릿 매칭 시도
      const templateResult = this._templateMatching(audioData, template);

      // 템플릿 매칭 결과가 충분히 강한 상관관계를 보이면 해당 결과 반환
      if (templateResult.found && templateResult.correlation > 0.7) {
        console.log("템플릿 매칭으로 벨 소리를 감지했습니다:", templateResult);
        return templateResult;
      }

      // 템플릿 매칭 실패시 주파수 스펙트럼 기반 감지 시도
      const spectrumResult = this._detectByFrequencySpectrum(audioData);
      if (spectrumResult.found && spectrumResult.confidence > 0.6) {
        console.log(
          "주파수 스펙트럼 분석으로 벨 소리를 감지했습니다:",
          spectrumResult
        );
        return spectrumResult;
      }

      // 주파수 스펙트럼 기반 감지도 실패시 진폭 기반 감지로 마지막 시도
      console.log(
        "템플릿 매칭 및 주파수 스펙트럼 분석 실패. 진폭 기반 감지 방법으로 대체합니다."
      );
      return this.detectBellSound(audioData);
    } catch (error) {
      console.error("템플릿 매칭 중 오류 발생:", error);
      return this.detectBellSound(audioData);
    }
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
        currentGroup.peakAmplitude = Math.max(
          currentGroup.peakAmplitude,
          current.peakAmplitude
        );
        currentGroup.samples += current.samples;
        currentGroup.grouped = true;

        console.log(
          `후보 그룹화: ${current.start.toFixed(
            3
          )}초 후보를 ${currentGroup.start.toFixed(3)}초 그룹에 병합`
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
    return result;
  }

  /**
   * 템플릿 매칭 수행
   * @param {Float32Array} audioData 오디오 데이터
   * @param {Object} options 매칭 옵션
   * @returns {Array<Object>} 매칭 결과
   * @private
   */
  _performTemplateMatching(audioData, sampleRate, options) {
    console.log("템플릿 매칭 수행 중...");

    const matches = [];

    // 윈도우와 홉 크기 계산 (샘플 단위)
    const windowSize = Math.floor((options.windowSize / 1000) * sampleRate);
    const hopSize = Math.floor((options.hopSize / 1000) * sampleRate);
    const mergeTime = options.mergeTime / 1000; // 초 단위로 변환

    // 모든 윈도우에 대해 템플릿과 유사도 계산
    for (let i = 0; i <= audioData.length - windowSize; i += hopSize) {
      // 현재 윈도우 데이터
      const windowData = audioData.slice(i, i + windowSize);

      // 윈도우의 특성 추출
      const windowFeatures = {
        energyProfile: this._calculateEnergyProfile(windowData),
      };

      // 템플릿과 유사도 계산
      const similarity = this._calculateSimilarity(
        windowFeatures,
        this.templateBellFeatures
      );

      // 임계값 이상의 유사도를 가진 경우 매치로 등록
      if (similarity >= options.similarityThreshold) {
        const time = i / sampleRate;
        matches.push({
          time,
          duration: windowSize / sampleRate,
          similarity,
          merged: false,
        });

        console.log(
          `매치 발견: ${time.toFixed(2)}초, 유사도: ${similarity.toFixed(3)}`
        );
      }
    }

    // 가까운 매치 병합
    const mergedMatches = this._mergeSimilarMatches(matches, mergeTime);

    console.log(
      `템플릿 매칭 완료: ${matches.length}개 매치 발견, ${mergedMatches.length}개로 병합`
    );
    return mergedMatches;
  }

  /**
   * 유사한 매치 병합
   * @param {Array<Object>} matches 매치 결과
   * @param {number} mergeTime 병합 시간 (초)
   * @returns {Array<Object>} 병합된 매치 결과
   * @private
   */
  _mergeSimilarMatches(matches, mergeTime) {
    if (matches.length <= 1) return matches;

    // 시간순 정렬
    matches.sort((a, b) => a.time - b.time);

    const result = [];
    let currentMatch = { ...matches[0] };

    for (let i = 1; i < matches.length; i++) {
      const match = matches[i];

      // 현재 그룹과 매치 사이의 시간 간격 계산
      const timeDiff = match.time - (currentMatch.time + currentMatch.duration);

      if (timeDiff <= mergeTime) {
        // 병합 (더 높은 유사도를 가진 쪽으로 업데이트)
        if (match.similarity > currentMatch.similarity) {
          currentMatch.time = match.time;
          currentMatch.similarity = match.similarity;
        }
        currentMatch.duration = Math.max(currentMatch.duration, match.duration);
        currentMatch.merged = true;

        console.log(
          `매치 병합: ${match.time.toFixed(3)}초 -> ${currentMatch.time.toFixed(
            3
          )}초 (간격: ${timeDiff.toFixed(3)}초)`
        );
      } else {
        // 이전 그룹 저장하고 새 그룹 시작
        result.push(currentMatch);
        currentMatch = { ...match };
      }
    }

    // 마지막 그룹 추가
    result.push(currentMatch);

    return result;
  }

  /**
   * 오디오 특성 간 유사도 계산
   * @param {Object} features1 첫 번째 특성
   * @param {Object} features2 두 번째 특성
   * @returns {number} 유사도 (0-1)
   * @private
   */
  _calculateSimilarity(features1, features2) {
    // 에너지 프로파일 유사도 (간단한 구현)
    // 실제 구현에서는 더 정교한 유사도 계산 알고리즘 사용 필요

    const energyProfile1 = features1.energyProfile;
    const energyProfile2 = features2.energyProfile;

    // 두 프로파일의 길이가 다를 경우 더 짧은 쪽에 맞춤
    const minLength = Math.min(energyProfile1.length, energyProfile2.length);

    // 두 에너지 프로파일 간의 상관관계 계산
    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (let i = 0; i < minLength; i++) {
      dotProduct += energyProfile1[i] * energyProfile2[i];
      norm1 += energyProfile1[i] * energyProfile1[i];
      norm2 += energyProfile2[i] * energyProfile2[i];
    }

    // 코사인 유사도 계산
    const similarity = dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2) || 1);

    // 0-1 범위로 정규화
    return Math.max(0, Math.min(1, similarity));
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
      effectiveThreshold = Math.max(0.3, maxAmplitude * 0.7);
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

    // 벨 감지 상태 변수
    let inBell = false;
    let bellStart = 0;
    let bellEnd = 0;
    let bellPeakAmplitude = 0;
    let consecutiveHighAmplitudeSamples = 0;
    let minConsecutiveHighSamples = 2;

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
      } else if (amplitude >= effectiveThreshold * 0.7) {
        if (inBell) {
          consecutiveHighAmplitudeSamples++;
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
              samples: consecutiveHighAmplitudeSamples,
            });

            // 디버깅 로그
            console.log(
              `벨 후보 발견: ${bellStartTime.toFixed(
                3
              )}초, 길이: ${bellDuration.toFixed(
                3
              )}초, 진폭: ${bellPeakAmplitude.toFixed(
                3
              )}, 샘플 수: ${consecutiveHighAmplitudeSamples}`
            );
          } else {
            // 연속된 높은 진폭 샘플이 충분하지 않으면 로그만
            if (consecutiveHighAmplitudeSamples > 0) {
              const bellStartTime = bellStart / sampleRate;
              console.log(
                `짧은 후보 무시: ${bellStartTime.toFixed(
                  3
                )}초, 샘플 수: ${consecutiveHighAmplitudeSamples}`
              );
            }
          }

          // 상태 초기화
          inBell = false;
          consecutiveHighAmplitudeSamples = 0;
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

      tempBellCandidates.push({
        start: bellStartTime,
        end: bellStartTime + bellDuration,
        duration: bellDuration,
        peakAmplitude: bellPeakAmplitude,
        samples: consecutiveHighAmplitudeSamples,
      });

      console.log(
        `마지막 벨 후보 발견: ${bellStartTime.toFixed(
          3
        )}초, 길이: ${bellDuration.toFixed(
          3
        )}초, 진폭: ${bellPeakAmplitude.toFixed(
          3
        )}, 샘플 수: ${consecutiveHighAmplitudeSamples}`
      );
    }

    // 서로 가까운 벨 후보들을 그룹화하여 하나의 벨로 만들기
    console.log(
      `총 ${tempBellCandidates.length}개의 벨 후보를 그룹화합니다...`
    );
    const groupedBells = this._groupBellCandidates(tempBellCandidates, 0.5); // 0.5초 이내 후보들은 그룹화

    // 그룹화된 벨 후보들을 처리
    for (const bell of groupedBells) {
      this.debug.candidateBells.push(bell);

      // 벨 길이 조건 확인 (최소 길이는 매우 짧게 설정)
      const effectiveMinDuration = 0.02; // 0.03에서 0.02로 낮춤 - 30ms에서 20ms로

      if (
        bell.duration >= effectiveMinDuration &&
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
            )}초, 진폭: ${bell.peakAmplitude.toFixed(3)}, 그룹화됨: ${
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
        // 길이 조건으로 거부
        this.debug.rejectedBells.push({
          ...bell,
          reason: "길이 조건 미달",
          minDuration: effectiveMinDuration,
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
          ") 길이 조건을 조정해보세요."
      );

      // 후보 벨들의 진폭 정보 출력
      if (this.debug.candidateBells.length > 0) {
        console.log("후보 벨 소리들의 진폭 정보:");
        this.debug.candidateBells.forEach((bell) => {
          console.log(
            `시작: ${bell.start.toFixed(
              2
            )}초, 진폭: ${bell.peakAmplitude.toFixed(
              3
            )}, 길이: ${bell.duration.toFixed(2)}초, 그룹화됨: ${
              bell.grouped ? "Yes" : "No"
            }`
          );
        });
      }

      // 거부된 벨들의 정보 출력
      if (this.debug.rejectedBells.length > 0) {
        console.log("거부된 벨 소리 정보:");
        this.debug.rejectedBells.forEach((bell) => {
          console.log(
            `시작: ${bell.start.toFixed(
              2
            )}초, 진폭: ${bell.peakAmplitude.toFixed(
              3
            )}, 길이: ${bell.duration.toFixed(2)}초, 거부 이유: ${bell.reason}`
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
      } else if (maxAmplitude > 0) {
        // 후보가 없다면 최대 진폭의 60%를 제안
        const suggestedThreshold = Math.max(0.05, maxAmplitude * 0.6);
        console.log(
          `제안: 진폭 임계값을 ${suggestedThreshold.toFixed(2)}로 시도해보세요.`
        );
      }
    }

    return bellTimestamps;
  }

  /**
   * 디버깅 정보 가져오기
   * @returns {Object} 디버깅 정보
   */
  getDebugInfo() {
    return this.debug;
  }

  /**
   * 복싱 종소리 스펙트럼 분석 (주파수 특성 파악)
   * @param {AudioBuffer} buffer 오디오 버퍼
   * @returns {Object} 분석 결과
   */
  analyzeBoxingBellSpectrum(buffer) {
    // FFT 설정
    const fftSize = 2048;
    const sampleRate = buffer.sampleRate;
    const channelData = buffer.getChannelData(0);

    // 결과 저장
    const analysisResults = {
      dominantFrequencies: [],
      energyDistribution: {},
      bellCandidateTimestamps: [],
    };

    // 주요 벨 소리 주파수 대역 (복싱 종소리)
    const bellFreqRanges = [
      { min: 500, max: 800 }, // 낮은 종소리
      { min: 800, max: 1200 }, // 중간 종소리
      { min: 1200, max: 2000 }, // 높은 종소리
    ];

    // 윈도우 크기와 이동량 계산
    const windowSize = Math.floor(0.05 * sampleRate); // 50ms 윈도우
    const hopSize = Math.floor(0.01 * sampleRate); // 10ms 이동

    // 모든 윈도우에 대한 스펙트럼 분석
    for (
      let startSample = 0;
      startSample < channelData.length - windowSize;
      startSample += hopSize
    ) {
      // 윈도우 내의 데이터 복사
      const windowData = channelData.slice(
        startSample,
        startSample + windowSize
      );

      // 윈도우 함수 적용 (Hanning)
      for (let i = 0; i < windowData.length; i++) {
        windowData[i] *=
          0.5 * (1 - Math.cos((2 * Math.PI * i) / (windowData.length - 1)));
      }

      // 스펙트럼 계산을 위한 FFT 적용
      const frequencyData = this._calculateFFT(windowData, fftSize);

      // 스펙트럼에서 피크 찾기
      const peaks = this._findSpectralPeaks(frequencyData, fftSize, sampleRate);

      // 피크 중 종소리 대역 내 피크 분석
      const bellPeaks = peaks.filter((peak) => {
        return bellFreqRanges.some(
          (range) => peak.frequency >= range.min && peak.frequency <= range.max
        );
      });

      // 종소리 후보 검출 (강한 피크가 복싱 종소리 주파수 범위에 있는 경우)
      if (bellPeaks.length > 0 && bellPeaks[0].magnitude > 0.3) {
        const timeStamp = startSample / sampleRate;
        analysisResults.bellCandidateTimestamps.push({
          time: timeStamp,
          frequency: bellPeaks[0].frequency,
          magnitude: bellPeaks[0].magnitude,
        });
      }

      // 주파수 대역별 에너지 계산
      bellFreqRanges.forEach((range) => {
        const rangeKey = `${range.min}-${range.max}Hz`;
        if (!analysisResults.energyDistribution[rangeKey]) {
          analysisResults.energyDistribution[rangeKey] = [];
        }

        const bandEnergy = this._calculateBandEnergy(
          frequencyData,
          fftSize,
          sampleRate,
          range.min,
          range.max
        );
        analysisResults.energyDistribution[rangeKey].push({
          time: startSample / sampleRate,
          energy: bandEnergy,
        });
      });
    }

    // 인접한 후보 타임스탬프 그룹핑 (중복 감지 방지)
    const groupedTimestamps = this._groupFrequencyCandidates(
      analysisResults.bellCandidateTimestamps,
      0.2
    );

    // 그룹핑된 결과를 최종 후보로 저장
    analysisResults.dominantFrequencies = groupedTimestamps;

    return analysisResults;
  }

  /**
   * FFT 계산 (간단한 구현)
   * @private
   */
  _calculateFFT(signal, fftSize) {
    // fft-js 라이브러리 사용
    try {
      const fftjs = require("fft-js");

      // 신호 길이가 2의 제곱이어야 함
      const paddedSignal = new Array(fftSize).fill(0);
      for (let i = 0; i < Math.min(signal.length, fftSize); i++) {
        paddedSignal[i] = signal[i];
      }

      // 실수/허수 배열 생성
      const signalComplex = paddedSignal.map((val) => [val, 0]);

      // FFT 변환 수행
      const fftComplexResult = fftjs.fft(signalComplex);

      // 반환할 주파수 스펙트럼 (크기)
      const fft = new Array(fftSize / 2).fill(0);

      // 주파수 영역 절반만 사용 (나머지는 대칭)
      for (let k = 0; k < fftSize / 2; k++) {
        const real = fftComplexResult[k][0];
        const imag = fftComplexResult[k][1];
        fft[k] = Math.sqrt(real * real + imag * imag) / signal.length;
      }

      return fft;
    } catch (error) {
      console.warn(
        "fft-js 라이브러리 사용 중 오류 발생, 내장 구현으로 대체합니다:",
        error
      );

      // fft-js 라이브러리가 없거나 오류 발생 시 기존 구현 사용
      const fft = new Array(fftSize / 2).fill(0);

      // 간단한 DFT 계산
      for (let k = 0; k < fftSize / 2; k++) {
        let real = 0;
        let imag = 0;

        for (let n = 0; n < signal.length; n++) {
          const angle = (-2 * Math.PI * k * n) / signal.length;
          real += signal[n] * Math.cos(angle);
          imag += signal[n] * Math.sin(angle);
        }

        fft[k] = Math.sqrt(real * real + imag * imag) / signal.length;
      }

      return fft;
    }
  }

  /**
   * 스펙트럼에서 피크 찾기
   * @private
   */
  _findSpectralPeaks(spectrum, fftSize, sampleRate) {
    const peaks = [];

    // 국소 최대값 찾기 (주변 값보다 큰 값)
    for (let i = 2; i < spectrum.length - 2; i++) {
      if (
        spectrum[i] > spectrum[i - 1] &&
        spectrum[i] > spectrum[i - 2] &&
        spectrum[i] > spectrum[i + 1] &&
        spectrum[i] > spectrum[i + 2]
      ) {
        const frequency = (i * sampleRate) / fftSize;
        peaks.push({
          frequency,
          magnitude: spectrum[i],
          index: i,
        });
      }
    }

    // 크기 순으로 정렬
    peaks.sort((a, b) => b.magnitude - a.magnitude);

    return peaks;
  }

  /**
   * 주파수 대역 에너지 계산
   * @private
   */
  _calculateBandEnergy(spectrum, fftSize, sampleRate, minFreq, maxFreq) {
    const minBin = Math.floor((minFreq * fftSize) / sampleRate);
    const maxBin = Math.ceil((maxFreq * fftSize) / sampleRate);

    let energy = 0;
    for (let i = minBin; i <= maxBin && i < spectrum.length; i++) {
      energy += spectrum[i] * spectrum[i];
    }

    return energy;
  }

  /**
   * 주파수 기반 후보들 그룹화
   * @private
   */
  _groupFrequencyCandidates(candidates, maxGap) {
    if (candidates.length <= 1) return candidates;

    // 시간순 정렬
    candidates.sort((a, b) => a.time - b.time);

    const result = [];
    let currentGroup = { ...candidates[0], grouped: false };

    for (let i = 1; i < candidates.length; i++) {
      const current = candidates[i];

      // 현재 그룹과 현재 후보 사이의 간격 계산
      const gap = current.time - currentGroup.time;

      if (gap <= maxGap) {
        // 그룹화 (더 강한 피크로 업데이트)
        if (current.magnitude > currentGroup.magnitude) {
          currentGroup.time = current.time;
          currentGroup.frequency = current.frequency;
          currentGroup.magnitude = current.magnitude;
        }
        currentGroup.grouped = true;
      } else {
        // 이전 그룹 저장하고 새 그룹 시작
        result.push(currentGroup);
        currentGroup = { ...current, grouped: false };
      }
    }

    // 마지막 그룹 추가
    result.push(currentGroup);

    return result;
  }

  /**
   * 진폭 기반 벨 소리 감지
   * @private
   */
  _detectByAmplitude(audioData) {
    const result = {
      found: false,
      timestamp: null,
      confidence: 0,
    };

    // 오디오 데이터가 없으면 분석 생략
    if (!audioData || audioData.length === 0) {
      return result;
    }

    // 샘플링 레이트 추정 (오디오 데이터에서 직접 가져올 수 없는 경우)
    const sampleRate = this.sampleRate || 44100; // 기본값 44.1kHz

    // 진폭 임계값
    const threshold = this.options.amplitudeThreshold;

    // 이동 평균 윈도우 크기
    const windowSize = Math.floor(0.05 * sampleRate); // 50ms 윈도우

    // 진폭 피크 찾기
    const peakIndices = [];
    let maxAmp = 0;

    for (let i = 0; i < audioData.length; i += windowSize / 2) {
      let sum = 0;
      const end = Math.min(i + windowSize, audioData.length);
      const count = end - i;

      for (let j = i; j < end; j++) {
        sum += Math.abs(audioData[j]);
      }

      const avgAmp = sum / count;
      maxAmp = Math.max(maxAmp, avgAmp);

      // 임계값보다 큰 진폭 피크 저장
      if (avgAmp > threshold) {
        peakIndices.push(i);
      }
    }

    // 피크가 발견되면 첫 번째 피크를 벨 소리 시작으로 간주
    if (peakIndices.length > 0) {
      const peakIndex = peakIndices[0];
      result.found = true;
      result.timestamp = peakIndex / sampleRate;
      result.confidence = Math.min(1.0, maxAmp / threshold);
    }

    return result;
  }

  /**
   * 함닝 윈도우 적용
   * @private
   */
  _applyWindow(signal) {
    const windowedSignal = new Array(signal.length);

    for (let i = 0; i < signal.length; i++) {
      // 함닝 윈도우 계수 계산: 0.5 * (1 - cos(2π*n/(N-1)))
      const windowCoef =
        0.5 * (1 - Math.cos((2 * Math.PI * i) / (signal.length - 1)));
      windowedSignal[i] = signal[i] * windowCoef;
    }

    return windowedSignal;
  }

  /**
   * 주파수 스펙트럼 기반 벨 소리 감지
   * @private
   */
  _detectByFrequencySpectrum(audioData) {
    const result = {
      found: false,
      timestamp: null,
      confidence: 0,
      frequencyProfile: null,
    };

    // 오디오 데이터가 없으면 분석 생략
    if (!audioData || audioData.length === 0) {
      return result;
    }

    // FFT 크기
    const fftSize = 2048;

    // 샘플링 레이트 추정 (오디오 데이터에서 직접 가져올 수 없는 경우)
    const sampleRate = this.sampleRate || 44100; // 기본값 44.1kHz

    // 벨 소리 특성 주파수 범위 (Hz)
    const bellFreqRange = [
      this.options.minFrequency,
      this.options.maxFrequency,
    ];

    // 윈도우 크기 (초 단위로 표현)
    const windowDuration = 0.2; // 200ms
    const windowSize = Math.floor(windowDuration * sampleRate);
    const hopSize = Math.floor(windowSize / 2); // 50% 오버랩

    // 윈도우 크기가 오디오 데이터보다 큰 경우 예외 처리
    if (windowSize > audioData.length) {
      const scaledWindowSize = Math.floor(audioData.length * 0.5);
      if (scaledWindowSize > 0) {
        // 오디오 데이터 크기에 맞게 윈도우 크기 조정
        const scaledFFT = this._calculateFFT(audioData, fftSize);
        const frequencyResolution = sampleRate / fftSize;
        const minBin = Math.floor(bellFreqRange[0] / frequencyResolution);
        const maxBin = Math.ceil(bellFreqRange[1] / frequencyResolution);

        // 벨 소리 주파수 범위 내 에너지 계산
        let bellRangeEnergy = 0;
        let totalEnergy = 0;
        for (let k = 0; k < scaledFFT.length; k++) {
          const energy = scaledFFT[k] * scaledFFT[k];
          totalEnergy += energy;
          if (k >= minBin && k <= maxBin && k < scaledFFT.length) {
            bellRangeEnergy += energy;
          }
        }

        const energyRatio = totalEnergy > 0 ? bellRangeEnergy / totalEnergy : 0;
        if (energyRatio > 0.3) {
          result.found = true;
          result.confidence = energyRatio;
          result.timestamp = 0;
          result.frequencyProfile = {
            dominantFrequency: ((minBin + maxBin) / 2) * frequencyResolution,
            energyRatio: energyRatio,
            peakCount: 1,
          };
        }
        return result;
      }
      return result;
    }

    let maxConfidence = 0;
    let bestTimestamp = null;
    let bestProfile = null;

    // 오디오 데이터를 윈도우로 분할하여 분석
    for (let i = 0; i < audioData.length - windowSize; i += hopSize) {
      // 현재 오디오 윈도우 추출
      const window = audioData.slice(i, i + windowSize);

      // 윈도우에 함닝 윈도우 적용
      const windowedSignal = this._applyWindow(window);

      // FFT 계산
      const fft = this._calculateFFT(windowedSignal, fftSize);

      // 주파수 해상도 계산 (Hz/bin)
      const frequencyResolution = sampleRate / fftSize;

      // 벨 소리 주파수 범위에 해당하는 FFT 빈 찾기
      const minBin = Math.floor(bellFreqRange[0] / frequencyResolution);
      const maxBin = Math.ceil(bellFreqRange[1] / frequencyResolution);

      // 해당 주파수 범위의 에너지 계산
      let bellRangeEnergy = 0;
      let totalEnergy = 0;

      for (let k = 0; k < fft.length; k++) {
        const energy = fft[k] * fft[k];
        totalEnergy += energy;

        if (k >= minBin && k <= maxBin && k < fft.length) {
          bellRangeEnergy += energy;
        }
      }

      // 전체 에너지에서 벨 주파수 범위 에너지의 비율 계산
      const energyRatio = totalEnergy > 0 ? bellRangeEnergy / totalEnergy : 0;

      // 피크 개수 찾기 (벨 소리는 보통 여러 하모닉스 피크를 가짐)
      let peakCount = 0;
      for (let k = minBin + 1; k < maxBin - 1; k++) {
        if (
          k < fft.length &&
          k > 0 &&
          fft[k] > fft[k - 1] &&
          fft[k] > fft[k + 1] &&
          fft[k] > 0.1 * Math.max(...fft)
        ) {
          peakCount++;
        }
      }

      // 신뢰도 점수 계산 (에너지 비율과 피크 개수 기반)
      const confidence = energyRatio * 0.7 + (Math.min(peakCount, 5) / 5) * 0.3;

      // 주요 주파수 추출
      const sliceStart = Math.max(0, minBin);
      const sliceEnd = Math.min(fft.length, maxBin + 1);
      const fftSlice = fft.slice(sliceStart, sliceEnd);

      // 슬라이스가 비어있지 않은지 확인
      if (fftSlice.length > 0) {
        const maxValue = Math.max(...fftSlice);
        const maxIndex = fftSlice.indexOf(maxValue);
        const dominantFreqBin = maxIndex + sliceStart;
        const dominantFreq = dominantFreqBin * frequencyResolution;

        // 주파수 프로필 생성
        const profile = {
          dominantFrequency: dominantFreq,
          energyRatio: energyRatio,
          peakCount: peakCount,
        };

        // 최대 신뢰도 업데이트
        if (confidence > maxConfidence && confidence > 0.6) {
          maxConfidence = confidence;
          bestTimestamp = i / sampleRate;
          bestProfile = profile;
        }
      }
    }

    // 결과 설정
    if (maxConfidence > 0) {
      result.found = true;
      result.confidence = maxConfidence;
      result.timestamp = bestTimestamp;
      result.frequencyProfile = bestProfile;
    }

    return result;
  }
}

module.exports = new AudioAnalyzer();
