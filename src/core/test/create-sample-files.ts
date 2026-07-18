import * as fs from 'fs';
import * as path from 'path';

const SAMPLE_FILE = path.resolve(__dirname, 'sample', 'sample2.txt');
const TARGET_DIR = path.resolve(__dirname, '..', '..', '..', 'temp');

function main() {
  // 读取 sample2.txt 中的所有文件名（每行一个）
  const content = fs.readFileSync(SAMPLE_FILE, 'utf-8');
  const lines = content.split('\n')
    .map(line => line.trim())
    .filter(line => line !== '' && !line.startsWith('#'))
    .map(line => {
      const separator = line.indexOf('\t');
      return separator < 0 ? line : line.slice(separator + 1);
    });

  // 先清空目标目录，确保每次运行都是全新创建
  if (fs.existsSync(TARGET_DIR)) {
    fs.rmSync(TARGET_DIR, { recursive: true });
  }
  fs.mkdirSync(TARGET_DIR, { recursive: true });

  let created = 0;
  for (const filename of lines) {
    const filePath = path.join(TARGET_DIR, filename);
    fs.writeFileSync(filePath, '');
    created++;
  }

  console.log(`完成！在 ${TARGET_DIR} 下创建了 ${created} 个空文件（共 ${lines.length} 个文件名）。`);
}

main();
