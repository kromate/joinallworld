/** Validate the unchanged app entries with existing owner dependencies and lane-local output. */
import app from '../../../vite.config.js';
import preview from './preview.config.mjs';
export default {...app,root:preview.root,resolve:preview.resolve,build:{...app.build,outDir:'src/campus/unilag/evidence/app-build',emptyOutDir:true}};
