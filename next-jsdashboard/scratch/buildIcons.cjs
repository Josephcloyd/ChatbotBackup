const fs = require('fs');
const path = require('path');

const baseDir = 'c:/Users/User/Documents/College Files/Software Development 2/Github/ChatbotBackup/next-jsdashboard';
const pngBuffer = fs.readFileSync(path.join(baseDir, 'public/lifeplan-leaf.png'));
const b64 = pngBuffer.toString('base64');

const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 120 120" width="100%" height="100%">
  <!-- Outer Green Rounded Square Frame -->
  <rect x="6" y="6" width="108" height="108" rx="24" fill="#FFFFFF" stroke="#256738" stroke-width="6" />
  
  <!-- Inner Gold Rounded Border -->
  <rect x="14" y="14" width="92" height="92" rx="17" fill="none" stroke="#E49B24" stroke-width="4" />

  <!-- Ascending Vertical Data Bars & Grid Lines (Exact Brand chart matching Brand.tsx) -->
  <g transform="translate(14, 14) scale(1.916)">
    <!-- Chart Baseline & Horizontal Grid Lines -->
    <line x1="4" y1="14" x2="44" y2="14" stroke="rgba(37, 103, 56, 0.15)" stroke-width="1" stroke-dasharray="2 2" />
    <line x1="4" y1="24" x2="44" y2="24" stroke="rgba(37, 103, 56, 0.15)" stroke-width="1" stroke-dasharray="2 2" />
    <line x1="4" y1="34" x2="44" y2="34" stroke="rgba(37, 103, 56, 0.15)" stroke-width="1" stroke-dasharray="2 2" />
    <line x1="4" y1="42" x2="44" y2="42" stroke="rgba(37, 103, 56, 0.3)" stroke-width="1.5" />

    <!-- Ascending Vertical Data Bars (Small -> Big) -->
    <rect x="7" y="34" width="5" height="8" rx="2" fill="#38a169" opacity="0.45" />
    <rect x="15" y="26" width="5" height="16" rx="2" fill="#256738" opacity="0.5" />
    <rect x="23" y="18" width="5" height="24" rx="2" fill="#e49b24" opacity="0.55" />
    <rect x="31" y="10" width="5" height="32" rx="2" fill="#f59e0b" opacity="0.6" />
    <rect x="39" y="4" width="5" height="38" rx="2" fill="#256738" opacity="0.65" />
  </g>

  <!-- Main Leaf Icon (lifeplan-leaf.png embedded) -->
  <image href="data:image/png;base64,${b64}" x="18" y="18" width="84" height="84" preserveAspectRatio="xMidYMid meet" />
</svg>`;

fs.writeFileSync(path.join(baseDir, 'public/lifeplan-mark.svg'), svgContent);
fs.writeFileSync(path.join(baseDir, 'public/lifeplan-badge.svg'), svgContent);
fs.writeFileSync(path.join(baseDir, 'app/icon.svg'), svgContent);
console.log('Successfully updated SVG icon files with embedded lifeplan-leaf.png!');
