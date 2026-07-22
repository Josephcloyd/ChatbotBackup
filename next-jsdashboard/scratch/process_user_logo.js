const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const inputPath = `C:\\Users\\hirof\\.gemini\\antigravity\\brain\\d1070a92-5e7a-4bed-aef3-13916ba8986d\\.user_uploaded\\media__1784701236767.png`;
const outputDir = path.join(__dirname, '../public');

async function processLogo() {
  console.log('Processing user logo from:', inputPath);

  const image = sharp(inputPath);
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });

  const width = info.width;
  const height = info.height;
  const channels = info.channels;

  // New buffer with RGBA (4 channels)
  const newData = Buffer.alloc(width * height * 4);

  let minX = width, minY = height, maxX = 0, maxY = 0;

  for (let i = 0; i < width * height; i++) {
    let r, g, b, a;
    if (channels === 3) {
      r = data[i * 3];
      g = data[i * 3 + 1];
      b = data[i * 3 + 2];
      a = 255;
    } else {
      r = data[i * 4];
      g = data[i * 4 + 1];
      b = data[i * 4 + 2];
      a = data[i * 4 + 3];
    }

    // Check if pixel is white / near white (background)
    // White background in the uploaded photo is pure/near white (e.g., RGB >= 242)
    const brightness = (r + g + b) / 3;
    let newAlpha = a;

    if (r > 235 && g > 235 && b > 235) {
      // Pure or near-pure white background -> transparent
      newAlpha = 0;
    } else if (r > 220 && g > 220 && b > 220) {
      // Feathered transition edge for smooth anti-aliasing
      const factor = (235 - brightness) / 15; // 0 to 1
      newAlpha = Math.round(255 * Math.max(0, Math.min(1, factor)));
    }

    const x = i % width;
    const y = Math.floor(i / width);

    if (newAlpha > 10) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }

    const idx = i * 4;
    newData[idx] = r;
    newData[idx + 1] = g;
    newData[idx + 2] = b;
    newData[idx + 3] = newAlpha;
  }

  console.log(`Bounding box of leaves: minX=${minX}, maxX=${maxX}, minY=${minY}, maxY=${maxY}`);

  // Create transparent PNG from raw RGBA buffer
  const transparentPng = await sharp(newData, {
    raw: {
      width,
      height,
      channels: 4
    }
  })
  .extract({
    left: Math.max(0, minX - 10),
    top: Math.max(0, minY - 10),
    width: Math.min(width - minX, (maxX - minX) + 20),
    height: Math.min(height - minY, (maxY - minY) + 20)
  })
  .png()
  .toBuffer();

  const outputPath = path.join(outputDir, 'lifeplan-leaf.png');
  fs.writeFileSync(outputPath, transparentPng);
  console.log('Saved transparent leaf logo PNG to:', outputPath);
}

processLogo().catch(err => {
  console.error('Error processing logo:', err);
});
