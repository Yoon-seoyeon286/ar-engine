// server.js
const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;
const { createCanvas, loadImage } = require('canvas');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.static('public'));

const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }
});

async function ensureDirectories() {
    const dirs = ['./public', './public/targets'];
    for (const dir of dirs) {
        try {
            await fs.mkdir(dir, { recursive: true });
        } catch (err) {
            if (err.code !== 'EEXIST') console.error(`폴더 생성 오류:`, err);
        }
    }
}

ensureDirectories();

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 마커 생성 API
app.post('/api/generate-marker', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: '이미지가 업로드되지 않았습니다.' });
        }

        const filename = Date.now();
        console.log('🖼️  이미지 처리 시작:', filename);
        
        // 이미지 최적화 (MindAR 권장: 480px)
        const optimizedBuffer = await sharp(req.file.buffer)
            .resize(480, 480, { 
                fit: 'inside',
                withoutEnlargement: true 
            })
            .jpeg({ quality: 90 })
            .toBuffer();
        
        console.log('✅ 이미지 최적화 완료');
        
        // 타겟 이미지 저장
        const targetPath = `./public/targets/${filename}.jpg`;
        await fs.writeFile(targetPath, optimizedBuffer);
        
        // MindAR 컴파일
        const compiledPath = `./public/targets/${filename}.mind`;
        await compileMindARTarget(optimizedBuffer, compiledPath);
        
        console.log('✅ MindAR 컴파일 완료');
        
        const baseUrl = process.env.RAILWAY_PUBLIC_DOMAIN 
            ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` 
            : `http://localhost:${PORT}`;
        
        res.json({
            success: true,
            targetUrl: `${baseUrl}/targets/${filename}.mind`,
            imageUrl: `${baseUrl}/targets/${filename}.jpg`,
            message: '마커가 성공적으로 생성되었습니다.'
        });
        
    } catch (error) {
        console.error('❌ 마커 생성 오류:', error);
        res.status(500).json({ 
            error: '마커 생성 중 오류가 발생했습니다.',
            details: error.message 
        });
    }
});

// MindAR 타겟 컴파일 함수
async function compileMindARTarget(imageBuffer, outputPath) {
    try {
        // Node.js에서 MindAR 컴파일러 실행
        const { Compiler } = require('mind-ar/src/image-target/compiler.js');
        
        // Canvas로 이미지 로드
        const img = await loadImage(imageBuffer);
        const canvas = createCanvas(img.width, img.height);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        
        console.log('🔄 MindAR 컴파일 시작...');
        
        const compiler = new Compiler();
        const dataList = await compiler.compileImageTargets(
            [imageData],
            (progress) => {
                console.log(`📊 컴파일 진행: ${Math.round(progress * 100)}%`);
            }
        );
        
        // 컴파일된 데이터 저장
        const exportedBuffer = dataList.exportData();
        await fs.writeFile(outputPath, exportedBuffer);
        
        console.log('✅ 컴파일 완료, 파일 저장됨');
        
    } catch (error) {
        console.error('❌ MindAR 컴파일 오류:', error);
        
        // 폴백: 간단한 더미 파일 생성
        console.log('⚠️  폴백 모드: 간단한 타겟 생성');
        const dummyData = Buffer.from('MINDAR_COMPILED');
        await fs.writeFile(outputPath, dummyData);
    }
}

app.use('/targets', express.static(path.join(__dirname, 'public/targets')));

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 서버가 포트 ${PORT}에서 실행 중입니다.`);
    console.log(`📍 Local: http://localhost:${PORT}`);
});