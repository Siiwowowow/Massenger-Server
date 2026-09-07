const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '..', 'src', 'generated', 'prisma');
const distDir = path.join(__dirname, '..', 'dist', 'generated', 'prisma');

if (fs.existsSync(srcDir)) {
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }
  const files = fs.readdirSync(srcDir);
  for (const file of files) {
    if (file.endsWith('.node')) {
      const srcFile = path.join(srcDir, file);
      const distFile = path.join(distDir, file);
      fs.copyFileSync(srcFile, distFile);
      console.log(`Copied Prisma engine binary: ${file} -> dist/generated/prisma/`);
    }
  }
}
