const glob = require('glob');
const { mkdirp, readFile, writeFile } = require('fs-extra');
const path = require('path');
var JavaScriptObfuscator = require('javascript-obfuscator');
var convert = require('convert-source-map');
var combine = require('combine-source-map');
var generatedSourceMapLocation = "index.android.bundle.map";

module.exports = async function({ config, filesSrc, filesDest, cwd, runConfig }) {
  console.log({ config, filesSrc, filesDest, cwd });
  // 为单次构建提供固定的种子：优先使用 config.seed，其次 runConfig.seed，否则随机
  const baseConfig = config || {};
  const resolvedSeed = baseConfig.seed !== undefined
    ? baseConfig.seed
    : (runConfig && runConfig.seed !== undefined
      ? runConfig.seed
      : Math.floor(Math.random() * 1e9));
  const configWithSeed = { ...baseConfig, seed: resolvedSeed };
  console.log(`[obfuscator-io-metro-plugin] Using obfuscation seed: ${resolvedSeed}`);
  const files = await (new Promise((resolve, reject) => {
    glob(filesSrc, { cwd }, function (er, files) {
      if (er) {
        reject(er);
      } else {
        resolve(files);
      }
    })
  }));

  const excludeFiles = await (new Promise((resolve, reject) => {
    if (!runConfig?.excludes) return resolve([]);
    glob(runConfig.excludes, { cwd }, function (er, files) {
      if (er) {
        reject(er);
      } else {
        resolve(files);
      }
    })
  }));

  const postData = {};
  postData.Items = await Promise.all(files.map(async (f) => {
    return {
      FileName: f,
      FileCode: await readFile(`${cwd}/${f}`, 'utf8'),
    };
  }));
  
 var sourceMaps = combine.create('index.android.bundle.map');
 var offset = { line: 2 };

  postData.Items.map((item)=>
  {
    if (excludeFiles.indexOf(item.FileName) >= 0) {
      return;
    }
    sourceMaps = sourceMaps.addFile({source:`${item.FileCode}`,sourceFile:item.FileName},offset);
    try{
      const obfuscationResult = JavaScriptObfuscator.obfuscate(`${item.FileCode}`, configWithSeed);
      item.FileCode= obfuscationResult.getObfuscatedCode();
      // item.SourceMap = obfuscationResult.getSourceMap();
    }
    catch(error){
      console.log("Error while obfuscating, Error : ",error);
      process.exit(-1);
   }
  })

  sourceMaps  = sourceMaps.base64();
  var sm = convert.fromBase64(sourceMaps).toJSON();
  
  await Promise.all(postData.Items.map(async (item) => {
    await mkdirp(`${filesDest}/${path.dirname(item.FileName)}`)
    await writeFile(`${filesDest}/${item.FileName}`, item.FileCode);
  }));
  if(config && config.sourceMap){
    generatedSourceMapLocation = runConfig && runConfig.sourceMapLocation ? runConfig.sourceMapLocation : generatedSourceMapLocation;
    console.log("generating source map .....");
    await writeFile(`${generatedSourceMapLocation}`, sm); // generated source map of unobfuscated code 
    console.log(`generated source map file located at ${generatedSourceMapLocation}`);
  }
};
