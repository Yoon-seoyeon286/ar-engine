// server.js
const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;
const { exec } = require('child_process');
const util = require('util');

const execPromise = util.promisify(exec);

const app = express();
const PORT = process.env.PORT || 3000;

// CORS 설정
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// 파일 업로드 설정
const storage = multer.diskStorage({
    destination: './uploads/',
    filename: (req, file, cb) => {
        const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueName + path.extname(file.originalname));
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        
        if (mimetype && extname) {
            return cb(null, true);
        }
        cb(new Error('이미지 파일만 업로드 가능합니다.'));
    }
});

// 폴더 생성
async function ensureDirectories() {
    const dirs = ['./uploads', './markers', './public/targets'];
    for (const dir of dirs) {
        try {
            await fs.mkdir(dir, { recursive: true });
        } catch (err) {
            console.error(`폴더 생성 오류 ${dir}:`, err);
        }
    }
}

// 서버 시작시 폴더 생성
ensureDirectories();

// 헬스 체크
app.get('/health', (req, res) => {
    res.json({ status: 'ok', message: 'Server is running' });
});

// 마커 생성 API
app.post('/api/generate-marker', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: '이미지가 업로드되지 않았습니다.' });
        }

        const inputPath = req.file.path;
        const filename = path.parse(req.file.filename).name;
        
        console.log('이미지 처리 시작:', filename);
        
        // 1단계: 이미지 최적화
        const optimizedPath = `./uploads/${filename}-optimized.jpg`;
        await sharp(inputPath)
            .resize(512, 512, { fit: 'inside' })
            .jpeg({ quality: 90 })
            .toFile(optimizedPath);
        
        console.log('이미지 최적화 완료');
        
        // 2단계: 타겟 이미지 생성 (테두리 추가)
        const targetPath = `./public/targets/${filename}.png`;
        await createTargetImage(optimizedPath, targetPath);
        
        console.log('타겟 이미지 생성 완료');
        
        // 3단계: .patt 파일 생성
        // AR.js marker generator 사용
        const markerPath = `./markers/${filename}.patt`;
        await generatePattFile(optimizedPath, markerPath);
        
        console.log('마커 파일 생성 완료');
        
        // 원본 파일 삭제
        await fs.unlink(inputPath);
        
        // 응답
        res.json({
            success: true,
            markerUrl: `/markers/${filename}.patt`,
            targetImageUrl: `/targets/${filename}.png`,
            message: '마커가 성공적으로 생성되었습니다.'
        });
        
    } catch (error) {
        console.error('마커 생성 오류:', error);
        res.status(500).json({ 
            error: '마커 생성 중 오류가 발생했습니다.',
            details: error.message 
        });
    }
});

// 타겟 이미지 생성 (테두리 추가)
async function createTargetImage(inputPath, outputPath) {
    const borderSize = 50;
    const imageSize = 412;
    
    // 이미지 로드
    const image = await sharp(inputPath)
        .resize(imageSize, imageSize, { fit: 'cover' })
        .toBuffer();
    
    // 테두리가 있는 캔버스 생성
    await sharp({
        create: {
            width: 512,
            height: 512,
            channels: 4,
            background: { r: 255, g: 255, b: 255, alpha: 1 }
        }
    })
    .composite([
        // 검은 외부 테두리
        {
            input: Buffer.from(`
                <svg width="512" height="512">
                    <rect width="512" height="512" fill="black"/>
                    <rect x="40" y="40" width="432" height="432" fill="white"/>
                </svg>
            `),
            top: 0,
            left: 0
        },
        // 이미지
        {
            input: image,
            top: borderSize,
            left: borderSize
        }
    ])
    .png()
    .toFile(outputPath);
}

// .patt 파일 생성
async function generatePattFile(imagePath, outputPath) {
    // 간단한 패턴 파일 생성
    // 실제로는 AR.js marker training tool을 사용하거나
    // OpenCV를 사용하여 특징점을 추출해야 합니다
    
    // 여기서는 간단한 데모용 패턴 생성
    const pattern = generateSimplePattern();
    await fs.writeFile(outputPath, pattern);
}

// 간단한 패턴 데이터 생성 (데모용)
function generateSimplePattern() {
    // AR.js .patt 파일 형식
    // 16x16 그리드, 각 셀은 0-255 값
    let pattern = '';
    
    for (let i = 0; i < 3; i++) {  // RGB 3개 채널
        for (let y = 0; y < 16; y++) {
            const row = [];
            for (let x = 0; x < 16; x++) {
                // 랜덤한 패턴 생성 (실제로는 이미지 분석 필요)
                const value = Math.floor(Math.random() * 256);
                row.push(value.toString().padStart(3, ' '));
            }
            pattern += row.join(' ') + '\n';
        }
        if (i < 2) pattern += '\n';
    }
    
    return pattern;
}

// 마커 파일 제공
app.use('/markers', express.static('markers'));

// 에러 핸들링
app.use((error, req, res, next) => {
    console.error('서버 오류:', error);
    res.status(500).json({ 
        error: '서버 오류가 발생했습니다.',
        details: error.message 
    });
});

app.listen(PORT, () => {
    console.log(`서버가 포트 ${PORT}에서 실행 중입니다.`);
    console.log(`http://localhost:${PORT}`);
});