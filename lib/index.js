const { emptyDir, mkdirp, readFile, writeFile, remove } = require('fs-extra');
const { rimraf } = require('rimraf');

const obfuscate = require('./javascriptObfuscatorAPI');
const fs = require('fs');
const path = require('path');
const {
  TEMP_FOLDER,
  DIST_TEMP_FOLDER,
  SRC_TEMP_FOLDER,
  BEG_ANNOTATION,
  END_ANNOTATION,
  EXTS
} = require('./constants');
const {
  buildNormalizePath,
  wrapCodeWithTags,
  getBundlePath,
  skipObfuscation,
  stripTags
} = require('./utils');

const debug = !!process.env.DEBUG;

async function obfuscateBundle(
  { bundlePath, bundleSourceMapPath },
  fileNames,
  config,
  runConfig
) {
  // 检查是否需要保留调试文件
  const shouldKeepDebugFiles = runConfig && runConfig.logObfuscatedFiles;
  
  // 读取bundle内容
  const metroBundle = await readFile(bundlePath, 'utf8');
  const metroBundleChunks = metroBundle.split(BEG_ANNOTATION);
  const metroUserFilesOnly = metroBundleChunks
    .filter((c, i) => i > 0)
    .map((c, i) => {
      return c.split(END_ANNOTATION)[0];
    });

  let tempSrcPath;
  let tempDistPath;
  
  if (shouldKeepDebugFiles) {
    // 只有在需要保留调试文件时才创建.jso目录
    console.log('[obfuscator-io-metro-plugin] Creating debug directories for logObfuscatedFiles=true');
    await emptyDir(TEMP_FOLDER);
    
    // 过滤掉无效的文件名
    const validFileNames = fileNames.filter(n => n && typeof n === 'string');
    
    if (validFileNames.length !== fileNames.length) {
      console.warn(`[obfuscator-io-metro-plugin] Filtered out ${fileNames.length - validFileNames.length} invalid file names`);
    }
    
    // build tmp src folders structure
    await Promise.all(
      validFileNames.map(n =>
        mkdirp(`${SRC_TEMP_FOLDER}/${path.dirname(n)}`)
      )
    );

    // write user files to tmp folder
    await Promise.all(
      metroUserFilesOnly.map((c, i) => {
        const fileName = fileNames[i];
        if (!fileName || typeof fileName !== 'string') {
          console.warn(`[obfuscator-io-metro-plugin] Skipping invalid file name at index ${i}`);
          return Promise.resolve();
        }
        return writeFile(`${SRC_TEMP_FOLDER}/${fileName}`, c);
      })
    );
    
    tempSrcPath = SRC_TEMP_FOLDER;
    tempDistPath = DIST_TEMP_FOLDER;
  } else {
    // 不保留调试文件时，使用系统临时目录
    console.log('[obfuscator-io-metro-plugin] Using system temp directory for logObfuscatedFiles=false');
    const os = require('os');
    const crypto = require('crypto');
    
    // 创建系统临时目录中的随机目录
    const randomSuffix = crypto.randomBytes(8).toString('hex');
    const sysTempBase = path.join(os.tmpdir(), `jso_${randomSuffix}`);
    tempSrcPath = path.join(sysTempBase, 'src');
    tempDistPath = path.join(sysTempBase, 'dist');
    
    // 过滤掉无效的文件名
    const validFileNames = fileNames.filter(n => n && typeof n === 'string');
    
    if (validFileNames.length !== fileNames.length) {
      console.warn(`[obfuscator-io-metro-plugin] Filtered out ${fileNames.length - validFileNames.length} invalid file names`);
    }
    
    // 创建临时目录结构
    await Promise.all(
      validFileNames.map(n =>
        mkdirp(path.join(tempSrcPath, path.dirname(n)))
      )
    );

    // 写入文件到系统临时目录
    await Promise.all(
      metroUserFilesOnly.map((c, i) => {
        const fileName = fileNames[i];
        if (!fileName || typeof fileName !== 'string') {
          console.warn(`[obfuscator-io-metro-plugin] Skipping invalid file name at index ${i}`);
          return Promise.resolve();
        }
        return writeFile(path.join(tempSrcPath, fileName), c);
      })
    );
  }

  const filesSrc = `**/*.js?(.map)`;
  const filesDest = tempDistPath;
  const cwd = tempSrcPath;

  if (bundleSourceMapPath) {
    console.warn(`Metro is generating source maps that won't be useful after obfuscation.`);
  }

  // Loop through filesSrc and obfuscate files and save to filesDest.
  await obfuscate({ config, filesSrc, filesDest, cwd, runConfig });

  // read obfuscated user files
  const obfusctedUserFiles = await Promise.all(metroUserFilesOnly.map(async (c, i) => {
    const fileName = fileNames[i];
    if (!fileName || typeof fileName !== 'string') {
      // 如果文件名无效，返回原始代码（不混淆）
      console.warn(`[obfuscator-io-metro-plugin] Reading skipped for invalid file name at index ${i}, using original code`);
      return c;
    }
    try {
      return await readFile(path.join(tempDistPath, fileName), 'utf8');
    } catch (readError) {
      console.warn(`[obfuscator-io-metro-plugin] Failed to read obfuscated file ${fileName}, using original code:`, readError.message);
      return c;
    }
  }));

  // build final bundle (with JSO TAGS still)
  const finalBundle = metroBundleChunks.reduce((acc, c, i) => {
    if (i === 0) {
      return c;
    }

    const obfuscatedCode = obfusctedUserFiles[i - 1];
    const tillCodeEnd = c.substr(
      c.indexOf(END_ANNOTATION),
      c.length
    );
    return acc + BEG_ANNOTATION + obfuscatedCode + tillCodeEnd;
  }, '');

  await writeFile(bundlePath, stripTags(finalBundle));
  
  // 如果使用了系统临时目录，需要清理
  if (!shouldKeepDebugFiles) {
    console.log('[obfuscator-io-metro-plugin] Cleaning up system temp directory');
    try {
      const { rimrafSync } = require('rimraf');
      const sysTempBase = path.dirname(tempSrcPath); // 获取jso_xxx目录
      rimrafSync(sysTempBase);
      console.log('[obfuscator-io-metro-plugin] System temp directory cleaned successfully');
    } catch (cleanupError) {
      console.warn('[obfuscator-io-metro-plugin] System temp cleanup failed:', cleanupError.message);
      // 系统临时目录清理失败不影响主要功能
    }
  }
}

/**
 * Add serialize.processModuleFilter option to metro and attach listener to beforeExit event.
 * *config.fileSrc* and *config.filesDest* will be ignored.
 * @param {object} _config
 * @param {object} runConfig
 * @param {string} [projectRoot=process.cwd()]
 * @returns {{serializer: {processModuleFilter(*): boolean}}}
 */
module.exports = function (_config = {}, runConfig = {}, projectRoot = process.cwd()) {
  const skipReason = skipObfuscation(runConfig);
  if (skipReason) {
    console.log(`warning:  Obfuscation SKIPPED [${skipReason}]`);
    return {};
  }

  const config = _config;
  const bundlePath = getBundlePath();
  const fileNames = new Set();

  process.on('beforeExit', async function (exitCode) {
    try {
      // start obfuscation
      console.log('info: Obfuscating Code');
      await obfuscateBundle(bundlePath, Array.from(fileNames), config, runConfig);

    } catch (error) {
      console.error(
        '[obfuscator-io-metro-plugin] Error while obfuscating bundle:',
        error
      );
      exitCode = -1;
    }
    
    // 现在 .jso 目录只在 logObfuscatedFiles=true 时才创建
    // 所以这里的逻辑得到了大大简化
    if (!runConfig || !runConfig.logObfuscatedFiles) {
      console.log('[obfuscator-io-metro-plugin] logObfuscatedFiles=false, no .jso directory was created, no cleanup needed');
    } else {
      console.log('[obfuscator-io-metro-plugin] logObfuscatedFiles=true, keeping .jso directory for debugging');
    }
    
    process.exit(exitCode)
  });

  return {
    serializer: {
      /**
       * Select user files ONLY (no vendor) to be obfuscated. That code should be tagged with
       * {@BEG_ANNOTATION} and {@END_ANNOTATION}.
       * @param {{output: Array<*>, path: string, getSource: function():Buffer}} _module
       * @returns {boolean}
       */
      processModuleFilter(_module) {
        // 增强验证：确保 _module.path 存在且有效
        if (
          !_module.path ||
          typeof _module.path !== 'string' ||
          _module.path.indexOf('node_modules') !== -1 ||
          !fs.existsSync(_module.path) ||
          !path.extname(_module.path).match(EXTS)
        ) {
          return true;
        }

        const normalizePath = buildNormalizePath(_module.path, projectRoot);
        
        // 只添加有效的规范化路径
        if (normalizePath && typeof normalizePath === 'string' && normalizePath.length > 0) {
          fileNames.add(normalizePath);
          _module.output.forEach(({ data }) => {
            wrapCodeWithTags(data);
          });
        } else {
          if (debug) {
            console.warn(`[obfuscator-io-metro-plugin] Invalid normalizePath for module: ${_module.path}`);
          }
        }
        
        return true;
      }
    }
  };
};