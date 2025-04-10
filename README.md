# RTracker - 복싱 링 소리 분석 및 영상 분할 도구

복싱장 CCTV 영상에서 링 벨 소리를 감지하여 자동으로 영상을 분할하는 데스크톱 애플리케이션입니다.

## 주요 기능

- 복싱장 CCTV 영상 파일 업로드
- 오디오 분석을 통한 복싱 링 소리(벨) 자동 감지
- 감지된 벨 소리를 기준으로 영상 자동 분할
- 분할된 영상 미리보기, 저장, 삭제 기능
- 사용자 설정 가능한 감지 매개변수

## 설치 방법

### 개발 환경 설정

1. 저장소 클론
   ```bash
   git clone https://github.com/krapli441/rtracker.git
   cd rtracker
   ```

2. 의존성 패키지 설치
   ```bash
   npm install
   ```

   권한 문제가 발생하는 경우 다음 명령어를 실행:
   ```bash
   sudo chown -R $(whoami) "/Users/$(whoami)/.npm"
   sudo chown -R $(whoami) "$(pwd)"
   ```

3. FFmpeg 설치 (필수)
   
   **macOS**:
   ```bash
   brew install ffmpeg
   ```

   **Windows**:
   - [FFmpeg 공식 사이트](https://www.ffmpeg.org/download.html)에서 다운로드
   - 또는 Chocolatey를 통해 설치: `choco install ffmpeg`

   **Linux**:
   ```bash
   sudo apt-get install ffmpeg
   ```

## 실행 방법

개발 모드로 실행:
```bash
npm run dev
```

프로덕션 모드로 실행:
```bash
npm start
```

## 애플리케이션 빌드

다양한 플랫폼용 애플리케이션 빌드:

**모든 플랫폼**:
```bash
npm run build
```

**Windows**:
```bash
npm run build:win
```

**macOS**:
```bash
npm run build:mac
```

**Linux**:
```bash
npm run build:linux
```

빌드된 애플리케이션은 `dist` 디렉토리에 저장됩니다.

## 사용 방법

1. 애플리케이션을 실행합니다.
2. "파일 선택" 버튼을 클릭하거나 영상 파일을 드래그 앤 드롭하여 업로드합니다.
3. 업로드된 영상의 오디오가 추출되고 파형이 표시됩니다.
4. 필요에 따라 벨 소리 감지 설정을 조정합니다:
   - 진폭 임계값: 소리 크기 감지 기준 (높을수록 큰 소리만 감지)
   - 최소 벨 간격: 벨 소리 간 최소 시간 간격 (초 단위)
5. "벨 소리 감지" 버튼을 클릭하여 분석을 시작합니다.
6. 감지된 벨 소리가 표시되면 "영상 분할" 버튼을 클릭합니다.
7. 분할된 영상 목록이 표시됩니다.
8. 각 영상 세그먼트는 다음 작업이 가능합니다:
   - 미리보기 재생
   - 컴퓨터에 저장
   - 목록에서 삭제

## 기술 스택

- **Electron**: 크로스 플랫폼 데스크톱 애플리케이션 프레임워크
- **Node.js**: 백엔드 JavaScript 런타임
- **fluent-ffmpeg**: 비디오/오디오 처리 라이브러리
- **waveform-data**: 오디오 파형 분석 라이브러리

## 버그 및 기능 요청

버그 보고나 기능 요청은 [이슈 트래커](https://github.com/krapli441/rtracker/issues)를 통해 제출해주세요.

## 라이선스

ISC 라이선스 