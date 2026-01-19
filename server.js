// server.js
const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;

const app = express();
const PORT = process.env.PORT || 3000;

// CORS 설정 - 모든 도메인 허용
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type']
}));

app.use(express.json());
app.use(express.static('public'));

// 업로드된 파일을 메모리에 저장 (Railway는 임시 파일 시스템 사용)
const storage = multer.memoryStorage();

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

// 임시 디렉토리 생성 (Railway 환경)
async function ensureDirectories() {
    const dirs = ['./public', './public/markers', './public/targets'];
    for (const dir of dirs) {
        try {
            await fs.mkdir(dir, { recursive: true });
        } catch (err) {
            if (err.code !== 'EEXIST') {
                console.error(`폴더 생성 오류 ${dir}:`, err);
            }
        }
    }
}

ensureDirectories();

// 루트 경로 - HTML 제공
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 헬스 체크
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        message: 'Server is running',
        timestamp: new Date().toISOString()
    });
});

// 마커 생성 API
app.post('/api/generate-marker', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: '이미지가 업로드되지 않았습니다.' });
        }

        const filename = Date.now() + '-' + Math.round(Math.random() * 1E9);
        
        console.log('이미지 처리 시작:', filename);
        
        // 1단계: 이미지 최적화 (메모리에서 처리)
        const optimizedBuffer = await sharp(req.file.buffer)
            .resize(512, 512, { fit: 'inside' })
            .jpeg({ quality: 90 })
            .toBuffer();
        
        console.log('이미지 최적화 완료');
        
        // 2단계: 타겟 이미지 생성 (테두리 추가)
        const targetPath = `./public/targets/${filename}.png`;
        await createTargetImage(optimizedBuffer, targetPath);
        
        console.log('타겟 이미지 생성 완료');
        
        // 3단계: .patt 파일 생성
        const markerPath = `./public/markers/${filename}.patt`;
        await generatePattFile(optimizedBuffer, markerPath);
        
        console.log('마커 파일 생성 완료');
        
        // 응답 - Railway URL 사용
        const baseUrl = process.env.RAILWAY_PUBLIC_DOMAIN 
            ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` 
            : `http://localhost:${PORT}`;
        
        res.json({
            success: true,
            markerUrl: `${baseUrl}/markers/${filename}.patt`,
            targetImageUrl: `${baseUrl}/targets/${filename}.png`,
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
async function createTargetImage(imageBuffer, outputPath) {
    const borderSize = 50;
    const imageSize = 412;
    
    // 이미지 리사이즈
    const resizedImage = await sharp(imageBuffer)
        .resize(imageSize, imageSize, { fit: 'cover' })
        .toBuffer();
    
    // SVG 테두리 생성
    const svgBorder = Buffer.from(`
        <svg width="512" height="512">
            <rect width="512" height="512" fill="black"/>
            <rect x="40" y="40" width="432" height="432" fill="white"/>
        </svg>
    `);
    
    // 테두리가 있는 이미지 생성
    await sharp({
        create: {
            width: 512,
            height: 512,
            channels: 4,
            background: { r: 255, g: 255, b: 255, alpha: 1 }
        }
    })
    .composite([
        {
            input: svgBorder,
            top: 0,
            left: 0
        },
        {
            input: resizedImage,
            top: borderSize,
            left: borderSize
        }
    ])
    .png()
    .toFile(outputPath);
}

// .patt 파일 생성
async function generatePattFile(imageBuffer, outputPath) {
    // 이미지에서 실제 패턴 추출
    const image = sharp(imageBuffer);
    const { data, info } = await image
        .resize(16, 16, { fit: 'fill' })
        .raw()
        .toBuffer({ resolveWithObject: true });
    
    let pattern = '';
    
    // RGB 3개 채널에 대해 16x16 그리드 생성
    for (let channel = 0; channel < 3; channel++) {
        for (let y = 0; y < 16; y++) {
            const row = [];
            for (let x = 0; x < 16; x++) {
                const pixelIndex = (y * 16 + x) * info.channels;
                const value = data[pixelIndex + channel];
                row.push(value.toString().padStart(3, ' '));
            }
            pattern += row.join(' ') + '\n';
        }
        if (channel < 2) pattern += '\n';
    }
    
    await fs.writeFile(outputPath, pattern);
}

// 정적 파일 제공
app.use('/markers', express.static(path.join(__dirname, 'public/markers')));
app.use('/targets', express.static(path.join(__dirname, 'public/targets')));

// 404 처리
app.use((req, res) => {
    res.status(404).json({ error: '요청한 리소스를 찾을 수 없습니다.' });
});

// 에러 핸들링
app.use((error, req, res, next) => {
    console.error('서버 오류:', error);
    res.status(500).json({ 
        error: '서버 오류가 발생했습니다.',
        details: error.message 
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 서버가 포트 ${PORT}에서 실행 중입니다.`);
    console.log(`📍 Local: http://localhost:${PORT}`);
    if (process.env.RAILWAY_PUBLIC_DOMAIN) {
        console.log(`🌐 Public: https://${process.env.RAILWAY_PUBLIC_DOMAIN}`);
    }
});