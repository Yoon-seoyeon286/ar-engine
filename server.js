// server.js
const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: '*', methods: ['GET', 'POST'], allowedHeaders: ['Content-Type'] }));
app.use(express.json());
app.use(express.static('public'));

const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        if (mimetype && extname) return cb(null, true);
        cb(new Error('이미지 파일만 업로드 가능합니다.'));
    }
});

async function ensureDirectories() {
    const dirs = ['./public', './public/markers', './public/targets'];
    for (const dir of dirs) {
        try {
            await fs.mkdir(dir, { recursive: true });
        } catch (err) {
            if (err.code !== 'EEXIST') console.error(`폴더 생성 오류 ${dir}:`, err);
        }
    }
}

ensureDirectories();

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', message: 'Server is running', timestamp: new Date().toISOString() });
});

// 마커 생성 API
app.post('/api/generate-marker', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: '이미지가 업로드되지 않았습니다.' });
        }

        const filename = Date.now() + '-' + Math.round(Math.random() * 1E9);
        
        console.log('이미지 처리 시작:', filename);
        
        // 1. 이미지를 512x512로 리사이즈 (AR.js 최적 크기)
        const resizedBuffer = await sharp(req.file.buffer)
            .resize(512, 512, { fit: 'cover' })
            .jpeg({ quality: 95 })
            .toBuffer();
        
        console.log('이미지 리사이즈 완료');
        
        // 2. .patt 파일 생성 (실제 이미지 픽셀 기반)
        const markerPath = `./public/markers/${filename}.patt`;
        await generateRealPattFile(resizedBuffer, markerPath);
        
        console.log('마커 파일 생성 완료');
        
        // 3. 타겟 이미지 저장 (사용자에게 보여줄 원본)
        const targetPath = `./public/targets/${filename}.jpg`;
        await fs.writeFile(targetPath, resizedBuffer);
        
        console.log('타겟 이미지 저장 완료');
        
        const baseUrl = process.env.RAILWAY_PUBLIC_DOMAIN 
            ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` 
            : `http://localhost:${PORT}`;
        
        res.json({
            success: true,
            markerUrl: `${baseUrl}/markers/${filename}.patt`,
            targetImageUrl: `${baseUrl}/targets/${filename}.jpg`,
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

// 실제 이미지 기반 .patt 파일 생성
async function generateRealPattFile(imageBuffer, outputPath) {
    try {
        // 1. 이미지를 16x16 그리드로 변환
        const { data, info } = await sharp(imageBuffer)
            .resize(16, 16, { 
                kernel: sharp.kernel.nearest,
                fit: 'fill' 
            })
            .raw()
            .toBuffer({ resolveWithObject: true });
        
        console.log('이미지 데이터 추출:', info);
        
        let pattern = '';
        
        // 2. AR.js .patt 형식: RGB 각 채널별 16x16 행렬
        // 각 채널마다 16x16 = 256개 값
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
            // RGB 채널 사이에 빈 줄 추가 (마지막 제외)
            if (channel < 2) pattern += '\n';
        }
        
        await fs.writeFile(outputPath, pattern);
        console.log('.patt 파일 생성 완료');
        
    } catch (error) {
        console.error('.patt 생성 오류:', error);
        throw error;
    }
}

app.use('/markers', express.static(path.join(__dirname, 'public/markers')));
app.use('/targets', express.static(path.join(__dirname, 'public/targets')));

app.use((req, res) => {
    res.status(404).json({ error: '요청한 리소스를 찾을 수 없습니다.' });
});

app.use((error, req, res, next) => {
    console.error('서버 오류:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다.', details: error.message });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 서버가 포트 ${PORT}에서 실행 중입니다.`);
    console.log(`📍 Local: http://localhost:${PORT}`);
    if (process.env.RAILWAY_PUBLIC_DOMAIN) {
        console.log(`🌐 Public: https://${process.env.RAILWAY_PUBLIC_DOMAIN}`);
    }
});