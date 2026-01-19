console.log('=== AR 엔진 시작 ===');

// DOM 요소
const uploadScreen = document.getElementById('upload-screen');
const loadingScreen = document.getElementById('loading-screen');
const loadingText = document.getElementById('loading-text');
const loadingProgress = document.getElementById('loading-progress');
const arContainer = document.getElementById('ar-container');

const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const previewContainer = document.getElementById('preview-container');
const previewImage = document.getElementById('preview-image');
const startBtn = document.getElementById('start-btn');
const changeBtn = document.getElementById('change-btn');
const resetBtn = document.getElementById('reset-btn');

const status = document.getElementById('status');
const targetEntity = document.getElementById('target-entity');
const arScene = document.getElementById('ar-scene');

// 디버그
const debugContent = document.getElementById('debug-content');
const debugConsole = document.getElementById('debug-console');
const debugToggle = document.getElementById('debug-toggle');

const originalLog = console.log;
const originalError = console.error;

function addLog(msg) {
    const time = new Date().toLocaleTimeString();
    const div = document.createElement('div');
    div.className = 'debug-entry';
    div.innerHTML = `<span class="debug-time">[${time}]</span> ${msg}`;
    debugContent.appendChild(div);
    debugContent.scrollTop = debugContent.scrollHeight;
}

console.log = function(...args) {
    originalLog.apply(console, args);
    addLog(args.join(' '));
};

console.error = function(...args) {
    originalError.apply(console, args);
    addLog('❌ ' + args.join(' '));
};

debugToggle.addEventListener('click', () => {
    debugConsole.classList.toggle('hidden');
});

document.getElementById('clear-log').addEventListener('click', () => {
    debugContent.innerHTML = '';
    console.log('로그 초기화');
});

// 전역 변수
let selectedFile = null;
let compiledData = null;

// 드래그 앤 드롭
dropZone.addEventListener('click', () => {
    fileInput.click();
});

dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
});

dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
        handleFile(files[0]);
    }
});

// 파일 선택
fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        handleFile(e.target.files[0]);
    }
});

// 파일 처리
function handleFile(file) {
    if (!file.type.startsWith('image/')) {
        alert('이미지 파일만 선택 가능합니다.');
        return;
    }

    console.log('이미지 선택:', file.name, file.size, 'bytes');
    selectedFile = file;

    const reader = new FileReader();
    reader.onload = (e) => {
        previewImage.src = e.target.result;
        previewContainer.style.display = 'block';
        console.log('미리보기 로드 완료');
    };
    reader.readAsDataURL(file);
}

// 다른 이미지 선택
changeBtn.addEventListener('click', () => {
    previewContainer.style.display = 'none';
    selectedFile = null;
    fileInput.value = '';
});

// AR 시작
startBtn.addEventListener('click', async () => {
    if (!selectedFile) {
        alert('이미지를 먼저 선택하세요!');
        return;
    }

    console.log('AR 시작');
    uploadScreen.classList.add('hidden');
    loadingScreen.classList.remove('hidden');
    loadingText.textContent = '이미지 로딩 중...';
    loadingProgress.textContent = '0%';

    try {
        // 1. 이미지 로드
        const img = await loadImage(selectedFile);
        console.log('이미지 크기:', img.width, 'x', img.height);

        // 이미지 크기 검증
        if (img.width < 300 || img.height < 300) {
            throw new Error('이미지가 너무 작습니다. 최소 300x300 픽셀 이상 권장합니다.');
        }

        if (img.width > 2000 || img.height > 2000) {
            console.log('이미지가 큽니다. 리사이징...');
            img = await resizeImage(img, 1024);
        }

        loadingProgress.textContent = '25%';

        // 2. 컴파일
        loadingText.textContent = '타겟 컴파일 중... (최대 30초 소요)';
        compiledData = await compileImageTarget(img);
        
        loadingProgress.textContent = '75%';

        // 3. AR 씬 초기화
        loadingText.textContent = 'AR 씬 초기화 중...';
        await initializeARScene(compiledData);

        loadingProgress.textContent = '100%';
        
        console.log('✓ AR 시작 완료');
        
        // AR 화면 표시
        loadingScreen.classList.add('hidden');
        arContainer.style.display = 'block';

    } catch (error) {
        console.error('AR 시작 실패:', error);
        alert(`AR 시작 실패:\n${error.message}\n\n• 더 복잡한 이미지를 시도해보세요\n• 텍스트나 패턴이 많은 이미지가 좋습니다`);
        
        loadingScreen.classList.add('hidden');
        uploadScreen.classList.remove('hidden');
    }
});

// 이미지 로드
function loadImage(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('이미지 로드 실패'));
            img.src = e.target.result;
        };
        reader.onerror = () => reject(new Error('파일 읽기 실패'));
        reader.readAsDataURL(file);
    });
}

// 이미지 리사이징
function resizeImage(img, maxSize) {
    return new Promise((resolve) => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > height) {
            if (width > maxSize) {
                height = (height * maxSize) / width;
                width = maxSize;
            }
        } else {
            if (height > maxSize) {
                width = (width * maxSize) / height;
                height = maxSize;
            }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        const resizedImg = new Image();
        resizedImg.onload = () => resolve(resizedImg);
        resizedImg.src = canvas.toDataURL('image/jpeg', 0.9);
    });
}

// 타겟 컴파일
async function compileImageTarget(image) {
    console.log('컴파일 시작');

    return new Promise((resolve, reject) => {
        // 타임아웃 30초
        const timeout = setTimeout(() => {
            reject(new Error('컴파일 타임아웃 (30초 초과). 더 간단한 이미지를 시도해보세요.'));
        }, 30000);

        setTimeout(async () => {
            try {
                if (!window.MINDAR || !window.MINDAR.IMAGE || !window.MINDAR.IMAGE.Compiler) {
                    throw new Error('MindAR 라이브러리 로드 실패');
                }

                const compiler = new window.MINDAR.IMAGE.Compiler();

                const progressCallback = (progress) => {
                    const percent = Math.round(25 + progress * 50);
                    loadingProgress.textContent = percent + '%';
                    console.log('컴파일 진행:', percent + '%');
                };

                const data = await compiler.compileImageTargets(
                    [image],
                    progressCallback
                );

                clearTimeout(timeout);
                console.log('✓ 컴파일 완료, 크기:', data.byteLength);
                
                if (data.byteLength < 100) {
                    throw new Error('컴파일된 데이터가 너무 작습니다. 다른 이미지를 시도해보세요.');
                }
                
                resolve(data);

            } catch (error) {
                clearTimeout(timeout);
                console.error('컴파일 실패:', error);
                reject(error);
            }
        }, 100);
    });
}

// AR 씬 초기화
async function initializeARScene(compiledData) {
    console.log('AR 씬 초기화');

    return new Promise((resolve, reject) => {
        try {
            // Blob URL 생성
            const blob = new Blob([compiledData]);
            const url = URL.createObjectURL(blob);
            console.log('타겟 URL 생성');

            // MindAR 설정 (더 관대한 설정)
            const sceneEl = arScene;
            sceneEl.setAttribute('mindar-image', 
                `imageTargetSrc: ${url}; ` +
                `autoStart: false; ` +
                `filterMinCF: 0.00001; ` +  // 더 낮게
                `filterBeta: 0.001; ` +     // 더 낮게
                `warmupTolerance: 10; ` +   // 더 높게
                `missTolerance: 10; ` +     // 더 높게
                `maxTrack: 1;`
            );

            console.log('MindAR 설정 완료');

            // 씬 로드 대기
            let timeout = setTimeout(() => {
                reject(new Error('씬 로드 타임아웃 (20초)'));
            }, 20000);

            const onLoaded = async () => {
                clearTimeout(timeout);
                console.log('✓ 씬 로드 완료');

                try {
                    // MindAR 시작
                    const mindarSystem = sceneEl.systems['mindar-image-system'];
                    
                    if (!mindarSystem) {
                        throw new Error('MindAR 시스템을 찾을 수 없습니다');
                    }
                    
                    console.log('MindAR 시작...');
                    await mindarSystem.start();
                    console.log('✓ MindAR 시작 완료');

                    setupEventListeners();
                    resolve();
                    
                } catch (startError) {
                    console.error('MindAR 시작 실패:', startError);
                    reject(startError);
                }
            };

            if (sceneEl.hasLoaded) {
                onLoaded();
            } else {
                sceneEl.addEventListener('loaded', onLoaded, { once: true });
            }

        } catch (error) {
            console.error('씬 초기화 실패:', error);
            reject(error);
        }
    });
}

// 이벤트 리스너
function setupEventListeners() {
    console.log('이벤트 리스너 설정');

    targetEntity.addEventListener('targetFound', () => {
        console.log('✓✓✓ 타겟 발견! ✓✓✓');
        status.textContent = '✓ 타겟 인식 중!';
        status.style.color = '#00ff00';
    });

    targetEntity.addEventListener('targetLost', () => {
        console.log('타겟 손실');
        status.textContent = '타겟을 비추세요';
        status.style.color = '#ffaa00';
    });

    // AR 준비 완료
    arScene.addEventListener('arReady', () => {
        console.log('✓ AR 준비 완료');
        status.textContent = '준비 완료 - 이미지를 비추세요';
    });

    // AR 에러
    arScene.addEventListener('arError', (event) => {
        console.error('AR 에러:', event.detail);
    });
}

// 다시 시작
resetBtn.addEventListener('click', () => {
    console.log('재시작');
    
    try {
        // AR 정지
        const mindarSystem = arScene.systems['mindar-image-system'];
        if (mindarSystem) {
            mindarSystem.stop();
        }
    } catch (e) {
        console.error('정지 중 오류:', e);
    }
    
    // 초기화
    arContainer.style.display = 'none';
    uploadScreen.classList.remove('hidden');
    previewContainer.style.display = 'none';
    selectedFile = null;
    compiledData = null;
    fileInput.value = '';
});

// 전역 에러 핸들링
window.addEventListener('error', (event) => {
    console.error('전역 에러:', event.error);
});

window.addEventListener('unhandledrejection', (event) => {
    console.error('Promise 거부:', event.reason);
});

console.log('=== 초기화 완료 ===');