import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../../',import.meta.url));
const owner = new URL('../../../../JoinAllworld/package.json', import.meta.url);
const require = createRequire(existsSync(owner)?owner:new URL('../../../package.json',import.meta.url));
const three = require.resolve('three').replace(/build\/three\.cjs$/, 'build/three.module.js');
export default {
  root,
  resolve:{alias:{three}},
  server:{host:'127.0.0.1',port:3410,strictPort:true,fs:{allow:[root,fileURLToPath(new URL('../../../../JoinAllworld',import.meta.url))]}},
  build:{outDir:'src/campus/unilag/evidence/preview-build',emptyOutDir:true,rollupOptions:{input:root+'campus.html'}},
};
