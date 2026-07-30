const fs = require('fs');
const path = require('path');

const publicDir = path.join(__dirname, '../public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

const poweredBySvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 32" width="240" height="32">
  <style>
    .powered-text {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 1.8px;
      fill: #9A9588;
    }
    .lifewood-text {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 18px;
      font-weight: 800;
      fill: #699B83;
      letter-spacing: -0.3px;
    }
  </style>
  <text x="0" y="21" class="powered-text">POWERED BY</text>
  <polygon points="124,6 134,11 134,21 124,26 114,21 114,11" fill="#F5B759" />
  <text x="140" y="22" class="lifewood-text">lifewood</text>
</svg>`;

fs.writeFileSync(path.join(publicDir, 'powered-by-lifewood.svg'), poweredBySvg);
console.log('Saved powered-by-lifewood.svg');
