import { mkdir, copyFile, cp } from 'node:fs/promises';
await mkdir('public', { recursive: true });
for (const file of ['index.html', 'obrigado.html', 'checkout.html']) await copyFile(file, `public/${file}`);
await cp('assets', 'public/assets', { recursive: true });
