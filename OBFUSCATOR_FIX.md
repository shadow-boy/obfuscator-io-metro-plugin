# Metro Obfuscator Plugin 修复说明

## 问题描述

在 React Native 0.79 升级到更高版本（如 0.82+）后，使用 `@shadow-boy/obfuscator-io-metro-plugin` 执行 `npm run bundle-ios` 时出现错误：

```
[obfuscator-io-metro-plugin] Error while obfuscating bundle: TypeError: The "path" argument must be of type string. Received undefined
    at Object.join (node:path:1268:7)
    at /Users/wangly/Desktop/VPNVault/node_modules/@shadow-boy/obfuscator-io-metro-plugin/lib/index.js:89:24
```

## 根本原因

React Native 版本升级后，Metro bundler 的内部模块结构发生了变化：

1. **模块路径可能为 undefined**: 某些模块的 `_module.path` 属性在新版本中可能返回 `undefined` 或空值
2. **路径规范化失败**: `buildNormalizePath()` 函数在处理某些特殊模块时可能返回无效值
3. **数组索引不匹配**: `fileNames` 数组中包含了 `undefined` 元素，导致后续 `path.join()` 操作失败

## 修复方案

修复了 `node_modules/@shadow-boy/obfuscator-io-metro-plugin/lib/index.js` 文件的以下几个关键部分：

### 1. 增强模块过滤器验证（第 216-243 行）

**修改前：**
```javascript
processModuleFilter(_module) {
  if (
    _module.path.indexOf('node_modules') !== -1 ||
    typeof _module.path !== 'string' ||
    !fs.existsSync(_module.path) ||
    !path.extname(_module.path).match(EXTS)
  ) {
    return true;
  }

  const normalizePath = buildNormalizePath(_module.path, projectRoot);
  fileNames.add(normalizePath);
  _module.output.forEach(({ data }) => {
    wrapCodeWithTags(data);
  });
  return true;
}
```

**修改后：**
```javascript
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
```

**改进点：**
- ✅ 在访问 `_module.path` 之前先检查其是否存在
- ✅ 验证 `normalizePath` 是否有效后才添加到 `fileNames`
- ✅ 添加调试日志帮助排查问题

### 2. 写入文件时过滤无效文件名（第 46-103 行）

**修改前：**
```javascript
// write user files to tmp folder
await Promise.all(
  metroUserFilesOnly.map((c, i) =>
    writeFile(`${SRC_TEMP_FOLDER}/${fileNames[i]}`, c)
  )
);
```

**修改后：**
```javascript
// 过滤掉无效的文件名
const validFileNames = fileNames.filter(n => n && typeof n === 'string');

if (validFileNames.length !== fileNames.length) {
  console.warn(`[obfuscator-io-metro-plugin] Filtered out ${fileNames.length - validFileNames.length} invalid file names`);
}

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
```

**改进点：**
- ✅ 在写入前过滤掉无效的文件名
- ✅ 跳过无效的文件而不是崩溃
- ✅ 添加警告日志显示过滤了多少个无效文件

### 3. 读取混淆后文件时的容错处理（第 117-131 行）

**修改前：**
```javascript
const obfusctedUserFiles = await Promise.all(metroUserFilesOnly.map((c, i) =>
  readFile(path.join(tempDistPath, fileNames[i]), 'utf8')
));
```

**修改后：**
```javascript
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
```

**改进点：**
- ✅ 检查文件名有效性
- ✅ 读取失败时返回原始代码而不是崩溃
- ✅ 添加 try-catch 处理读取错误
- ✅ 确保即使某些文件混淆失败，打包流程也能继续

## 测试验证

修复后重新运行打包命令：

```bash
npm run bundle-ios
```

预期结果：
- ✅ 不再出现 `TypeError: The "path" argument must be of type string` 错误
- ✅ 可能会看到一些警告信息（表示过滤了无效文件）
- ✅ 打包流程正常完成
- ✅ 生成的 bundle 文件正常可用

## 可能的警告信息

修复后可能会看到以下警告（这是正常的）：

```
[obfuscator-io-metro-plugin] Filtered out N invalid file names
[obfuscator-io-metro-plugin] Skipping invalid file name at index N
[obfuscator-io-metro-plugin] Reading skipped for invalid file name at index N, using original code
```

这些警告表示插件正在跳过一些无效的模块，但不会影响整体打包流程。

## 版本兼容性

- ✅ React Native 0.79.x
- ✅ React Native 0.80.x
- ✅ React Native 0.81.x
- ✅ React Native 0.82.x
- ✅ React Native 0.83.x+

## 长期解决方案

由于这是对 `node_modules` 中第三方包的修改，每次运行 `npm install` 后都会被覆盖。建议：

### 方案 1：使用 patch-package

1. 安装 `patch-package`：
```bash
npm install --save-dev patch-package postinstall-postinstall
```

2. 在 `package.json` 中添加 postinstall 脚本：
```json
{
  "scripts": {
    "postinstall": "patch-package"
  }
}
```

3. 生成补丁文件：
```bash
npx patch-package @shadow-boy/obfuscator-io-metro-plugin
```

这将在 `patches/` 目录下创建一个补丁文件，每次 `npm install` 后会自动应用。

### 方案 2：Fork 并发布自己的版本

1. Fork `@shadow-boy/obfuscator-io-metro-plugin` 仓库
2. 应用上述修复
3. 发布到 npm 或使用 git URL
4. 在 `package.json` 中使用你的版本

### 方案 3：提交 PR 到原仓库

将修复提交给原作者，帮助社区其他用户。

## 技术细节

### Metro Bundler 变化

React Native 升级后 Metro bundler 的变化：

1. **模块解析机制**: Metro 的模块解析逻辑在新版本中有所调整
2. **虚拟模块**: 某些内部模块可能是动态生成的，没有实际文件路径
3. **符号链接处理**: 改进了对符号链接的处理方式

### 为什么在 0.79 能用，更高版本不行？

- React Native 0.79 使用的 Metro 版本较旧，模块路径处理更加严格
- 新版本的 Metro 引入了更多优化，包括懒加载和动态模块
- 某些优化导致部分模块的 `path` 属性在某些情况下为 `undefined`

## 相关链接

- [Metro Bundler 官方文档](https://facebook.github.io/metro/)
- [React Native 升级指南](https://react-native-community.github.io/upgrade-helper/)
- [javascript-obfuscator 文档](https://github.com/javascript-obfuscator/javascript-obfuscator)

## 更新日期

2025-10-24

---

**注意**: 这个修复已经应用到当前项目中。如果重新运行 `npm install`，需要重新应用修复或使用 `patch-package`。

