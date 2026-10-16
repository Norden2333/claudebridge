import fs from 'node:fs/promises';
import { definitions } from '../companion/files.mjs';
await fs.writeFile(new URL('../extension/tools.js', import.meta.url), 'self.CFB_TOOL_DEFINITIONS = ' + JSON.stringify(definitions, null, 2) + ';\n');
console.log('Extension tool schemas synchronized.');
