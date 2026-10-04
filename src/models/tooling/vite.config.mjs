import base from '../../../vite.config.ts';
import { fileURLToPath } from 'node:url';
import { dirname,resolve } from 'node:path';
const threeRoot=dirname(fileURLToPath(import.meta.resolve('three')));
export default {...base,cacheDir:'src/models/.cache/vite-build',resolve:{alias:[
  {find:/^three\/addons\//,replacement:resolve(threeRoot,'../examples/jsm')+'/'},
  {find:/^three$/,replacement:resolve(threeRoot,'three.module.js')},
]}};
