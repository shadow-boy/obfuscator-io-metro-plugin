# Obfuscator.io Metro Plugin

[![npm version](https://img.shields.io/npm/v/obfuscator-io-metro-plugin.svg)](https://www.npmjs.com/package/obfuscator-io-metro-plugin)
[![npm](https://img.shields.io/npm/dt/obfuscator-io-metro-plugin)](https://www.npmjs.com/package/obfuscator-io-metro-plugin)
<img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" alt="PRs welcome!" />


This metro plugin obfuscate your **React Native** bundle using [javascript-obfuscator](https://github.com/javascript-obfuscator/javascript-obfuscator) <br/>
It only obfuscates your code not the code of `node_modules`, you can verify the obfuscated bundle by either extracting the `index.android.bundle` from generated apk
or you can find the file at `project_root\android\app\build\generated\assets\react\release` after `assembleRelease` process

#### for iOS if you’re facing any issue check this [comment](https://github.com/whoami-shubham/obfuscator-io-metro-plugin/issues/2#issuecomment-932389379) by [@andresarezo](https://github.com/andresarezo)

## Installation

```bash
 npm i -D obfuscator-io-metro-plugin

```

## Docs
[Docs](https://whoami-shubham.github.io/obfuscator-io-metro-plugin/)

## Usage

Include the plugin in your `metro.config.js`:

```js
const jsoMetroPlugin = require("obfuscator-io-metro-plugin")(
  {
    // for these option look javascript-obfuscator library options from  above url
    compact: false,
    sourceMap: false, // source Map generated after obfuscation is not useful right now so use default value i.e. false
    controlFlowFlattening: true,
    controlFlowFlatteningThreshold: 1,
    numbersToExpressions: true,
    simplify: true,
    stringArrayShuffle: true,
    splitStrings: true,
    stringArrayThreshold: 1,
    // 固定混淆种子（可选）：不配置则每次构建随机种子，配置后构建结果可复现
    seed: 123456789,
  },
  {
    runInDev: false /* optional */,
    logObfuscatedFiles: true /* optional generated files will be located at ./.jso */,
    excludes: '**/*.assets.**' /* optional, A file names or globs which indicates files to exclude from obfuscation. */,
    // 当 config.seed 未设置时，可在此传入种子作为后备选择
    seed: 123456789,
  }
);

module.exports = {
  transformer: {
    getTransformOptions: async () => ({
      transform: {
        experimentalImportSupport: false,
        inlineRequires: false,
      },
    }),
  },
  ...jsoMetroPlugin,
};
```

For obfuscation options configuration docs see: [https://github.com/javascript-obfuscator/javascript-obfuscator](https://github.com/javascript-obfuscator/javascript-obfuscator)

## 固定 seed 与可重复构建

- 优先级：`config.seed` > `runConfig.seed`。两者都未设置时插件会在每次构建生成随机种子，从而提升反混淆成本。
- 需要可重复的产物（如 CI 对比、回溯问题）时，请显式配置固定种子。例如：

```js
// metro.config.js
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const jsoMetroPlugin = require("obfuscator-io-metro-plugin")(
  {
    compact: false,
    sourceMap: false,
    controlFlowFlattening: true,
    controlFlowFlatteningThreshold: 1,
    numbersToExpressions: true,
    simplify: true,
    stringArrayShuffle: true,
    splitStrings: true,
    stringArrayThreshold: 1,
    seed: 123456789, // 固定种子，最高优先级
  },
  {
    runInDev: false,
    logObfuscatedFiles: false,
    seed: 123456789, // 备用种子（当 config.seed 未配置时生效）
  }
);

module.exports = mergeConfig(getDefaultConfig(__dirname), {
  transformer: {
    getTransformOptions: async () => ({
      transform: {
        experimentalImportSupport: false,
        inlineRequires: true,
      },
    }),
  },
  ...jsoMetroPlugin,
});
```

> 提醒：设置固定 seed 可确保同一代码在不同机器/时间构建出相同的混淆结果；若希望提升多样性，可不设置 seed 让插件为每次构建自动生成随机种子。
